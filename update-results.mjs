#!/usr/bin/env node
/**
 * Atualiza data/matches.json com os jogos da fase de grupos da Copa 2026.
 * Fonte: football-data.org (gratis). Defina a env FOOTBALL_DATA_TOKEN.
 *
 * Uso local:  FOOTBALL_DATA_TOKEN=xxxx node scripts/update-results.mjs
 * No GitHub Actions o token vem do secret FOOTBALL_DATA_TOKEN.
 *
 * Requer Node 18+ (fetch nativo). Sem dependencias externas.
 */
import { readFileSync, writeFileSync } from "node:fs";

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const OUT = new URL("../data/matches.json", import.meta.url);
const API = "https://api.football-data.org/v4/competitions/WC/matches?stage=GROUP_STAGE";

function mapStatus(s) {
  // football-data: SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, SUSPENDED, POSTPONED, CANCELLED, AWARDED
  if (s === "FINISHED" || s === "AWARDED") return "FINISHED";
  if (s === "IN_PLAY" || s === "PAUSED") return "IN_PLAY";
  return "TIMED";
}

function groupLetter(g) {
  if (!g) return "?";
  return String(g).replace(/^GROUP[_\s]*/i, "").trim().toUpperCase();
}

async function main() {
  if (!TOKEN) {
    console.error("ERRO: defina a variavel de ambiente FOOTBALL_DATA_TOKEN.");
    process.exit(1);
  }

  const res = await fetch(API, { headers: { "X-Auth-Token": TOKEN } });
  if (!res.ok) {
    console.error(`API respondeu ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  const raw = data.matches || [];

  // Rodada (1/2/3): usa matchday quando disponível; senão deriva por ordem
  // cronológica dentro de cada grupo (2 jogos por rodada num grupo de 4).
  const mdays = raw.map((m) => m.matchday).filter((x) => Number.isInteger(x));
  const hasMatchday = mdays.length === raw.length && mdays.length > 0;
  const minMd = hasMatchday ? Math.min(...mdays) : 1;
  const roundFallback = {};
  if (!hasMatchday) {
    const byGroup = {};
    for (const m of raw) (byGroup[m.group || "?"] ||= []).push(m);
    for (const g of Object.values(byGroup)) {
      g.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
      g.forEach((m, i) => { roundFallback[m.id] = Math.floor(i / 2) + 1; });
    }
  }

  const matches = raw.map((m) => {
    const ft = m.score?.fullTime || {};
    const round = hasMatchday ? (m.matchday - minMd + 1) : (roundFallback[m.id] || 1);
    return {
      id: "wc-" + m.id,
      group: groupLetter(m.group),
      round,
      utcDate: m.utcDate,
      home: m.homeTeam?.name ?? "A definir",
      away: m.awayTeam?.name ?? "A definir",
      homeCrest: m.homeTeam?.crest ?? null,
      awayCrest: m.awayTeam?.crest ?? null,
      status: mapStatus(m.status),
      homeScore: ft.home ?? null,
      awayScore: ft.away ?? null,
    };
  });

  // Mantem ids estaveis: nao mexe se a API nao trouxe nada novo.
  if (!matches.length) {
    console.error("A API nao retornou jogos. Mantendo arquivo atual.");
    process.exit(0);
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    source: "football-data.org",
    matches: matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)),
  };

  // So reescreve se algo mudou (evita commits vazios).
  let prev = "";
  try { prev = readFileSync(OUT, "utf8"); } catch {}
  const next = JSON.stringify(payload, null, 2) + "\n";
  const stripTs = (s) => s.replace(/"updatedAt":\s*"[^"]*"/, "");
  if (stripTs(prev) === stripTs(next)) {
    console.log("Sem mudancas nos placares. Nada a fazer.");
    process.exit(0);
  }

  writeFileSync(OUT, next);
  const fin = matches.filter((m) => m.status === "FINISHED").length;
  console.log(`OK: ${matches.length} jogos (${fin} encerrados) gravados em data/matches.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
