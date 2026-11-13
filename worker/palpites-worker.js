/**
 * Cloudflare Worker — proxy dos palpites (JsonBin).
 *
 * Por que existe: a chave do JsonBin NAO pode ficar no navegador (site estatico =
 * tudo e publico). Aqui a chave vive como SECRET do Worker; o navegador so fala
 * com este Worker, que valida o que chega antes de gravar no bin.
 *
 *   GET  /   -> devolve o registro atual do bin  ({updatedAt, profiles, live})
 *   PUT  /   -> valida e grava                    (body = {updatedAt, profiles})
 *
 * Configuracao (veja o README):
 *   secret  JSONBIN_KEY       chave do JsonBin (X-Access-Key ou X-Master-Key)
 *   var     JSONBIN_BIN_ID    id do bin
 *   var     ALLOWED_ORIGINS   (opcional) origens permitidas, separadas por virgula
 *   var     JSONBIN_KEY_TYPE  (opcional) "access" (padrao) ou "master"
 */

const DEFAULT_ORIGINS = ["https://joaopedrocs.github.io"];
const MAX_BODY_BYTES = 1_500_000;   // ~1,5 MB (fotos sao base64 de 128px)
const MAX_PROFILES = 100;
const BIN_API = "https://api.jsonbin.io/v3/b/";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = allowedOrigins(env);
    // localhost liberado so para desenvolvimento local.
    const originOk = !origin || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = corsHeaders(originOk ? origin : allowed[0]);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!env.JSONBIN_KEY || !env.JSONBIN_BIN_ID) return json({ error: "Worker nao configurado" }, 500, cors);

    if (request.method === "GET") {
      const r = await binFetch(env, "/latest");
      if (!r.ok) return json({ error: "JsonBin " + r.status }, 502, cors);
      const { record } = await r.json();
      return json(record || {}, 200, { ...cors, "Cache-Control": "no-store" });
    }

    if (request.method === "PUT") {
      if (!originOk) return json({ error: "Origem nao permitida" }, 403, cors);

      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return json({ error: "Payload grande demais" }, 413, cors);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "JSON invalido" }, 400, cors); }

      const problem = validateShape(body);
      if (problem) return json({ error: problem }, 400, cors);

      // Compara com o que esta salvo: nao deixa apagar/criar/renomear perfis
      // (os perfis sao fixos) nem sobrescrever o bloco "live".
      const cur = await binFetch(env, "/latest");
      if (!cur.ok) return json({ error: "JsonBin " + cur.status }, 502, cors);
      const current = (await cur.json()).record || {};
      const curIds = (current.profiles || []).map(p => p.id).sort().join("|");
      const newIds = body.profiles.map(p => p.id).sort().join("|");
      if (curIds && curIds !== newIds) return json({ error: "Lista de perfis nao pode mudar" }, 409, cors);

      const payload = {
        updatedAt: new Date().toISOString(),
        profiles: body.profiles.map(sanitizeProfile),
      };
      if (current.live) payload.live = current.live;   // mantem "live" por ultimo

      const w = await binFetch(env, "", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Bin-Versioning": "false" },
        body: JSON.stringify(payload),
      });
      if (!w.ok) return json({ error: "JsonBin " + w.status }, 502, cors);
      return json({ ok: true, updatedAt: payload.updatedAt }, 200, cors);
    }

    return json({ error: "Metodo nao permitido" }, 405, cors);
  },
};

function allowedOrigins(env) {
  return env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function binFetch(env, suffix, init = {}) {
  const keyHeader = env.JSONBIN_KEY_TYPE === "master" ? "X-Master-Key" : "X-Access-Key";
  return fetch(BIN_API + env.JSONBIN_BIN_ID + suffix, {
    ...init,
    headers: { ...(init.headers || {}), [keyHeader]: env.JSONBIN_KEY },
  });
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const isScore = v => v === null || v === "" || (Number.isInteger(v) && v >= 0 && v <= 99);

function validateShape(b) {
  if (!isObj(b) || !Array.isArray(b.profiles)) return "Formato invalido";
  if (b.profiles.length === 0 || b.profiles.length > MAX_PROFILES) return "Quantidade de perfis invalida";
  const seen = new Set();
  for (const p of b.profiles) {
    if (!isObj(p) || typeof p.id !== "string" || !p.id || p.id.length > 64) return "Perfil invalido";
    if (seen.has(p.id)) return "Perfil duplicado";
    seen.add(p.id);
    if (typeof p.name !== "string" || p.name.length > 80) return "Nome invalido";
    if (p.picks != null) {
      if (!isObj(p.picks)) return "picks invalido";
      for (const v of Object.values(p.picks)) {
        if (!isObj(v) || !isScore(v.home ?? null) || !isScore(v.away ?? null)) return "palpite invalido";
      }
    }
    if (p.ko != null) {
      if (!isObj(p.ko)) return "ko invalido";
      for (const v of Object.values(p.ko)) {
        if (!isObj(v)) return "palpite ko invalido";
        if (v.h != null && !isScore(v.h)) return "palpite ko invalido";
        if (v.a != null && !isScore(v.a)) return "palpite ko invalido";
        if (v.adv != null && v.adv !== "home" && v.adv !== "away") return "palpite ko invalido";
      }
    }
  }
  return null;
}

// Mantem os campos conhecidos do perfil (o resto e descartado).
function sanitizeProfile(p) {
  const out = { ...p };
  if (typeof out.photo !== "string" || out.photo.length > 200_000) out.photo = "";
  if (typeof out.bio !== "string") out.bio = "";
  out.bio = out.bio.slice(0, 500);
  return out;
}
