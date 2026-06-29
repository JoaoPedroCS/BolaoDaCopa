function compressImage(file, callback) {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = (event) => {
    const img = new Image();
    img.src = event.target.result;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Define o tamanho fixo e compacto
      const size = 128; 
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      
      // Nova matemática para o estilo Cover (redimensionar mantendo proporção)
      const scale = Math.max(size / img.width, size / img.height);
      const drawWidth = img.width * scale;
      const drawHeight = img.height * scale;
      
      // Centraliza a imagem no canvas
      const x = (size - drawWidth) / 2;
      const y = (size - drawHeight) / 2;
      
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size); // Fundo branco preventivo
      ctx.drawImage(img, x, y, drawWidth, drawHeight);
      
      // Converte para Base64 (JPEG com 70% de qualidade)
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      callback(dataUrl);
    };
  };
}
/* ============================================================
   CONFIGURAÇÃO 
   ============================================================ */
const CONFIG = {
  jsonbin: { enabled:true, binId:"6a2c15e9da38895dfeb5363d", accessKey:"$2a$10$sB4a4hNUpA93mz5lq7f27eSS.7mjLMuuMSMF8UcThQdIgBtuVyoSG" },
  // TODOS os jogos (calendario + placar + ao vivo) vindos do Worker da Cloudflare.
  // Vazio => usa o matches.json local do repo. Ponha aqui a URL do worker que devolve
  // {updatedAt, source, matches:[...]} pra ele virar a unica fonte dos jogos.
  matchesUrl: "https://bolao-jogos.joaohulck.workers.dev/",
  // Placares AO VIVO dedicados (legado). Com matchesUrl preenchido, deixe vazio:
  // o ao vivo ja vem junto na lista completa.
  liveUrl: ""
};

/* ---------- Estado ---------- */
let MATCHES=[], PROFILES=[], LIVE=null;
let VIEW="ranking";
let MODE="playoffs";   // "grupos" | "playoffs" — alterna todo o conjunto de abas
let KO_PHASE=0, KO_PHASE_AUTO=true;   // fase atual na aba Partidas do mata-mata
let GROUP_FILTER="ALL";
let JOGOS_ROUND="ALL";
let JOGOS_ROUND_AUTO=false;  // false = mantém "Todas as Rodadas" por padrão
let SHOW_CURRENT=false;      // desativado — fase de grupos encerrada
let IDENTITY=localStorage.getItem("bolao_identity")||null; 
let DIRTY=false, ENTRY_LOCK=false;

const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>[...el.querySelectorAll(s)];
const esc=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ============================================================ STATUS
   A fonte (football-data.org via worker) oscila o status de jogos rolando entre
   IN_PLAY, LIVE, PAUSED (intervalo) e HALFTIME. Tratamos todos como "ao vivo"
   pra que o placar parcial apareça e entre no ranking sem piscar. */
const LIVE_STATUSES = new Set(["IN_PLAY","LIVE","PAUSED","HALFTIME","LIVE_HT"]);
function isLive(m){ return !!(m && LIVE_STATUSES.has(m.status)); }
function normStatus(s){ return LIVE_STATUSES.has(s) ? "IN_PLAY" : s; }

/* ============================================================ NOMES (PT-BR)
   A fonte (football-data.org) manda os nomes das seleções em inglês. Aqui
   traduzimos pra português. O mapa é indexado por uma forma "normalizada"
   (minusculo, sem acento, só letras) pra aguentar variações da API
   (ex.: "Korea Republic", "Turkiye", "USA"). Traduzir é idempotente: passar
   um nome que já está em PT só devolve ele mesmo. Aplicado uma vez na carga
   (loadMatches), então o resto do app continua usando m.home/m.away normalmente. */
function normName(s){
  return String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z]/g,"");
}
const TEAM_PT = {
  algeria:"Argélia", argentina:"Argentina", australia:"Austrália", austria:"Áustria",
  belgium:"Bélgica", bosniaherzegovina:"Bósnia e Herzegovina", bosnia:"Bósnia e Herzegovina",
  bosniaandherzegovina:"Bósnia e Herzegovina", brazil:"Brasil", canada:"Canadá",
  capeverdeislands:"Cabo Verde", capeverde:"Cabo Verde", caboverde:"Cabo Verde",
  colombia:"Colômbia", congodr:"RD Congo", drcongo:"RD Congo",
  democraticrepublicofthecongo:"RD Congo", democraticrepublicofcongo:"RD Congo",
  croatia:"Croácia", curacao:"Curaçao", czechia:"Tchéquia", czechrepublic:"Tchéquia",
  ecuador:"Equador", egypt:"Egito", england:"Inglaterra", france:"França",
  germany:"Alemanha", ghana:"Gana", haiti:"Haiti", iran:"Irã", iraq:"Iraque",
  ivorycoast:"Costa do Marfim", cotedivoire:"Costa do Marfim", japan:"Japão",
  jordan:"Jordânia", mexico:"México", morocco:"Marrocos", netherlands:"Holanda",
  newzealand:"Nova Zelândia", norway:"Noruega", panama:"Panamá", paraguay:"Paraguai",
  portugal:"Portugal", qatar:"Catar", saudiarabia:"Arábia Saudita", scotland:"Escócia",
  senegal:"Senegal", southafrica:"África do Sul", southkorea:"Coreia do Sul",
  korearepublic:"Coreia do Sul", republicofkorea:"Coreia do Sul", spain:"Espanha",
  sweden:"Suécia", switzerland:"Suíça", tunisia:"Tunísia", turkey:"Turquia",
  turkiye:"Turquia", unitedstates:"Estados Unidos", usa:"Estados Unidos",
  unitedstatesofamerica:"Estados Unidos", uruguay:"Uruguai", uzbekistan:"Uzbequistão"
};
function teamName(name){
  if(name==null) return name;
  return TEAM_PT[normName(name)] || name;
}

/* ============================================================ TEMPO AO VIVO
   Mostra o minuto do jogo em andamento. Se o worker mandar o minuto exato
   (campo `minute` -> liveMinute), usamos ele. Senão, estimamos pelo horário
   de início (utcDate): 1o tempo, intervalo, 2o tempo. É uma aproximação
   (não conhece acréscimos/paradas), por isso vem marcada com "~". */
function liveMinuteText(m){
  if(!m || m.status!=="IN_PLAY") return "";
  if(m.liveMinute!=null){
    const n=String(m.liveMinute).trim();
    return n ? (/['+a-zA-Z]/.test(n) ? n : n+"'") : "";
  }
  const start=new Date(m.utcDate).getTime();
  if(!Number.isFinite(start)) return "";
  const el=Math.floor((Date.now()-start)/60000);
  if(el<0) return "";
  if(el<=45) return "~"+Math.max(1,el)+"'";
  if(el<=60) return "Intervalo";
  if(el<=105) return "~"+Math.min(90,45+(el-60))+"'";
  return "~90+'";
}

/* ============================================================ PONTUAÇÃO */
function pointsFor(pick,ah,aa){
  if(!pick||pick.home==null||pick.away==null) return 0;
  const ph=+pick.home,pa=+pick.away;
  if(ph===ah&&pa===aa) return 5;
  const ps=Math.sign(ph-pa),as=Math.sign(ah-aa);
  if(ps!==as) return 0;
  if(as===0) return 3;
  return 2.5;
}
// Pontos OFICIAIS: so existem quando o jogo terminou.
function scorePick(pick,m){
  if(m.status!=="FINISHED"||m.homeScore==null||m.awayScore==null) return null;
  return pointsFor(pick,+m.homeScore,+m.awayScore);
}
// Pontos PARCIAIS de um jogo EM ANDAMENTO (placar atual).
function partialScore(pick,m){
  if(m.status!=="IN_PLAY"||m.homeScore==null||m.awayScore==null) return null;
  return pointsFor(pick,+m.homeScore,+m.awayScore);
}
// Pontos que CONTAM no ranking: jogo terminado OU em andamento (parcial ao vivo entra no total).
function effScore(pick,m){
  if(m.homeScore==null||m.awayScore==null) return null;
  if(m.status!=="FINISHED"&&m.status!=="IN_PLAY") return null;
  return pointsFor(pick,+m.homeScore,+m.awayScore);
}
const tagClass=(p)=>p===5?"p5":p===3?"p3":p===2.5?"p25":"p0";
const fmtPts=(n)=>Number.isInteger(n)?String(n):String(n).replace(".",",");

function statsFor(prof){
  let total=0,c5=0,c3=0,c25=0,c0=0,played=0;
  for(const m of MATCHES){
    const p=effScore(prof.picks?.[m.id],m);
    if(p===null) continue;
    played++; total+=p;
    if(p===5)c5++; else if(p===3)c3++; else if(p===2.5)c25++; else c0++;
  }
  return {total,c5,c3,c25,c0,played};
}
function ranking(){
  return PROFILES.map(p=>({prof:p,...statsFor(p)}))
    .sort((a,b)=> b.total-a.total || b.c5-a.c5 || b.c3-a.c3 || a.prof.name.localeCompare(b.prof.name,"pt"));
}

/* ============================================================ IDENTIDADE */
const profileById=(id)=>PROFILES.find(p=>p.id===id);
const me=()=>IDENTITY&&IDENTITY!=="guest"?profileById(IDENTITY):null;
function setIdentity(id){ IDENTITY=id; localStorage.setItem("bolao_identity",id); renderIdentBar(); buildTabs(); render(); }

function renderIdentBar(){
  const m=me();
  $("#whoAm").innerHTML = m
    ? `<span class="lbl">Bem-vindo,</span> ${avatar(m,"")} <span class="nm">${esc(m.name)}</span>`
    : `<span class="lbl">Navegando como</span> <span class="nm">Visitante</span>`;
}

function openEntry(force){
  ENTRY_LOCK = !IDENTITY || !!force ? true : false;
  const profs = PROFILES.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt")).map(p=>`<button class="entry-prof" data-id="${esc(p.id)}">${avatar(p,"")}<span class="nm">${esc(p.name)}</span></button>`).join("");
  $("#modal").innerHTML = `
    ${IDENTITY?'<button class="x" id="m-x">✕</button>':''}
    <h3>Quem é você?</h3>
    <p style="color:var(--muted); margin-bottom:16px; font-size:15px;">Escolha seu perfil para fazer seus palpites e aparecer no ranking.</p>
    <div class="entry-grid">${profs}</div>
    <button class="btn ghost entry-guest" id="m-guest" style="border: 2px solid var(--line); color: var(--chalk)">Entrar apenas para olhar (Visitante)</button>`;
  openModal();
  $$(".entry-prof").forEach(b=>b.onclick=()=>{ setIdentity(b.dataset.id); closeModal(true); });
  if($("#m-guest")) $("#m-guest").onclick=()=>{ setIdentity("guest"); closeModal(true); };
  if($("#m-x")) $("#m-x").onclick=()=>closeModal(true);
}

/* ============================================================ DADOS */
// Um jogo só é "definitivo" quando terminou COM placar válido.
function isFinal(m){ return !!(m && m.status==="FINISHED" && m.homeScore!=null && m.awayScore!=null); }
function updateSyncInfo(d){
  const when=d&&d.updatedAt?new Date(d.updatedAt):null;
  const live=MATCHES.some(m=>m.status==="IN_PLAY");
  $("#syncInfo").innerHTML=(live?'<span style="color:#FDE047; font-weight:bold;">● AO VIVO</span> · ':'')+
    "Atualizado em: "+(when?when.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—");
}
async function loadMatches(){
  const base=CONFIG.matchesUrl||"data/matches.json";
  const src=base+(base.includes("?")?"&":"?")+"t="+Date.now();
  const r=await fetch(src); if(!r.ok) throw new Error("matches");
  const d=await r.json();
  // O worker ja entrega o ao vivo embutido: mapeia minute -> liveMinute pros jogos IN_PLAY.
  // Normaliza status "ao vivo" (LIVE/PAUSED/HALFTIME) pra IN_PLAY — a fonte oscila entre
  // eles durante o jogo e o resto do app trata só IN_PLAY como ao vivo.
  const incoming=(d.matches||[]).map(m=>({round:1,...m, status:normStatus(m.status), home:teamName(m.home), away:teamName(m.away), ...(m.minute!=null?{liveMinute:m.minute}:{})}));
  // Proteção 1: um fetch vazio NÃO apaga os jogos que já temos (evita "zerar" tudo num soluço da fonte).
  if(!incoming.length && MATCHES.length){ updateSyncInfo(d); return; }
  // Proteção 2 (congelar jogos passados): os já finalizados ficam com o placar que já temos.
  // Só jogos NÃO finalizados são atualizados pela busca — um jogo que já aconteceu nunca mais "zera".
  const frozen=new Map();
  for(const m of MATCHES){ if(isFinal(m)) frozen.set(m.id, m); }
  const merged=incoming.map(m=> frozen.has(m.id)?frozen.get(m.id):m);
  for(const [id,m] of frozen){ if(!merged.some(x=>x.id===id)) merged.push(m); }   // finalizado sumiu do fetch? mantém
  MATCHES=merged.sort((a,b)=> new Date(a.utcDate)-new Date(b.utcDate));
  updateSyncInfo(d);
}
async function loadPredictions(){
  if(CONFIG.jsonbin.enabled&&CONFIG.jsonbin.binId){
    const h={}; if(CONFIG.jsonbin.accessKey) h["X-Access-Key"]=CONFIG.jsonbin.accessKey;
    const r=await fetch(`https://api.jsonbin.io/v3/b/${CONFIG.jsonbin.binId}/latest`,{headers:h});
    if(!r.ok) throw new Error("JsonBin "+r.status);
    const rec=(await r.json()).record||{};
    PROFILES=rec.profiles||[];
    if(!CONFIG.liveUrl&&!CONFIG.matchesUrl) LIVE=normLive(rec.live);
  }else{
    const r=await fetch(`data/predictions.json?t=${Date.now()}`); if(!r.ok) throw new Error("predictions.json");
    const d=await r.json();
    PROFILES=d.profiles||[];
    if(!CONFIG.liveUrl&&!CONFIG.matchesUrl) LIVE=normLive(d.live);
  }
}
// Mantem no LIVE apenas jogos EM ANDAMENTO com um placar valido.
function normLive(blk){
  if(!blk||!Array.isArray(blk.matches)) return null;
  const matches=blk.matches
    .filter(x=>x&&x.id&&isLive(x))
    .map(x=>({...x,status:"IN_PLAY"}));
  return matches.length?{updatedAt:blk.updatedAt||null,matches}:null;
}
// Fonte dedicada de placares ao vivo (CONFIG.liveUrl), quando configurada.
async function loadLive(){
  if(!CONFIG.liveUrl) return;            // sem URL dedicada o LIVE ja veio do predictions
  try{
    const u=CONFIG.liveUrl+(CONFIG.liveUrl.includes("?")?"&":"?")+"t="+Date.now();
    const r=await fetch(u); if(!r.ok) return;
    const d=await r.json();
    LIVE=normLive(d.live||(d.record&&d.record.live)||d);
  }catch(e){}
}
// Sobrepoe o placar ao vivo (LIVE) sobre os jogos vindos do matches.json.
function applyLive(){
  if(!LIVE) return;
  const byId=new Map(LIVE.matches.map(x=>[x.id,x]));
  MATCHES.forEach(m=>{
    const lv=byId.get(m.id);
    if(!lv||m.status==="FINISHED") return;   // resultado final sempre prevalece
    if(lv.homeScore!=null) m.homeScore=lv.homeScore;
    if(lv.awayScore!=null) m.awayScore=lv.awayScore;
    m.status=normStatus(lv.status||m.status);
    if(lv.minute!=null) m.liveMinute=lv.minute;
  });
}
async function loadAll(){
  try{
    await Promise.all([loadMatches(),loadPredictions()]);
    await loadLive(); applyLive();
    renderIdentBar(); buildModeBar(); buildTabs();
    if(!IDENTITY) openEntry(true); else render();
  }catch(e){
    $("#content").innerHTML=`<div class="empty">Não consegui carregar os dados. Verifique sua conexão.</div>`;
  }
}

/* ============================================================ SALVAR */
async function save(){
  const payload={updatedAt:new Date().toISOString(),profiles:PROFILES};
  if(LIVE) payload.live=LIVE;   // mantem o bloco "live" por ULTIMO no JSON
  if(CONFIG.jsonbin.enabled&&CONFIG.jsonbin.binId){
    const r=await fetch(`https://api.jsonbin.io/v3/b/${CONFIG.jsonbin.binId}`,{method:"PUT",
      headers:{"Content-Type":"application/json","X-Access-Key":CONFIG.jsonbin.accessKey,"X-Bin-Versioning":"false"},body:JSON.stringify(payload)});
    if(!r.ok){ alert("Falha ao salvar no JsonBin ("+r.status+")."); return; }
    DIRTY=false; flash("Palpites Salvos com Sucesso! ✓");
  }else{
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="predictions.json"; a.click(); URL.revokeObjectURL(a.href);
    DIRTY=false; flash("Baixado: dê commit em data/predictions.json");
  }
}
function flash(msg){
  const f=document.createElement("div"); f.textContent=msg;
  f.style.cssText="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--signal);color:#0E1A06;font-weight:800;font-size:15px;padding:14px 24px;border-radius:12px;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.3)";
  document.body.appendChild(f); setTimeout(()=>f.remove(),3000);
}

/* ============================================================ HELPERS DE RENDER */
function avatar(prof,cls=""){
  if(prof.photo) return `<img class="av ${cls}" src="${esc(prof.photo)}" alt="" onerror="this.outerHTML='<div class=\\'av ph ${cls}\\'>${esc((prof.name||'?')[0])}</div>'">`;
  return `<div class="av ph ${cls}">${esc((prof.name||"?")[0])}</div>`;
}
function statusBadge(m){
  if(m.status==="FINISHED") return `<span class="status fin">Encerrado</span>`;
  if(m.status==="IN_PLAY"){
    const t=liveMinuteText(m);
    return `<span class="status live">● Ao vivo${t?` <b class="js-livemin" data-mid="${esc(m.id)}">${esc(t)}</b>`:""}</span>`;
  }
  return `<span class="status">A jogar</span>`;
}
// Data do jogo em PT-BR, com atalho amigável "Hoje/Amanhã/Ontem, HH:MM".
function kickoff(m){
  const d=new Date(m.utcDate); if(isNaN(d)) return "";
  const hm=d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  const day=(x)=>new Date(x.getFullYear(),x.getMonth(),x.getDate());
  const diff=Math.round((day(d)-day(new Date()))/86400000);
  if(diff===0) return `Hoje, ${hm}`;
  if(diff===1) return `Amanhã, ${hm}`;
  if(diff===-1) return `Ontem, ${hm}`;
  return d.toLocaleString("pt-BR",{weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
}
const roundsAvailable=()=>[...new Set(MATCHES.map(m=>m.round))].sort((a,b)=>a-b);
const groupsAvailable=()=>[...new Set(MATCHES.map(m=>m.group))].sort();
// 1a rodada que ainda tem jogo NAO encerrado (pra abrir o filtro ja na fase "atual").
// Generico: serve pros grupos (rodadas 1,2,3) e, no futuro, pros playoffs (16-avos, oitavas...).
function firstPendingRound(){
  const rounds=roundsAvailable();
  if(!rounds.length) return "ALL";
  for(const r of rounds){ if(MATCHES.some(m=>m.round===r && m.status!=="FINISHED")) return r; }
  return rounds[rounds.length-1];   // tudo encerrado -> mostra a ultima rodada
}
// Jogo "atual": o que está AO VIVO; senão, o próximo a acontecer (não finalizado). null se acabou tudo.
function currentMatch(){
  const cand=MATCHES.filter(m=>m.status!=="FINISHED");
  if(!cand.length) return null;
  cand.sort((a,b)=>{
    const la=a.status==="IN_PLAY"?0:1, lb=b.status==="IN_PLAY"?0:1;
    if(la!==lb) return la-lb;                        // ao vivo primeiro
    return new Date(a.utcDate)-new Date(b.utcDate);  // depois, o mais próximo no tempo
  });
  return cand[0];
}

/* ============================================================ TABS */
const TABS={
  grupos:[["ranking","Ranking"],["jogos","Jogos"],["tabela","Tabela"],["perfis","Palpiteiros"],["meus","Meus Palpites"]],
  playoffs:[["ranking","Ranking"],["partidas","Partidas"],["chave","Chaveamento"],["perfis","Palpiteiros"],["meus","Meus Palpites"]]
};
function buildModeBar(){
  const mb=$("#modebar");
  if(mb){
    const modes=[["playoffs","Playoffs"],["grupos","Grupos · Encerrada ✓"]];
    mb.innerHTML=modes.map(([m,l])=>`<button class="modebtn" data-mode="${m}" aria-selected="${MODE===m}">${l}</button>`).join("");
    $$(".modebtn",mb).forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  }
  const eb=$("#eyebrow");
  if(eb) eb.innerHTML='<span class="dot"></span> '+(MODE==="playoffs"?"Mata-mata · Copa 2026":"Fase de grupos · Copa 2026");
}
function setMode(m){
  if(MODE===m) return;
  MODE=m; VIEW="ranking"; JOGOS_ROUND_AUTO=false; KO_PHASE_AUTO=true;
  buildModeBar(); buildTabs(); render();
}
function buildTabs(){
  let base=TABS[MODE].slice();
  if(!me()) base=base.filter(t=>t[0]!=="meus");
  if(!base.find(t=>t[0]===VIEW)) VIEW=base[0][0];
  $("#tabs").innerHTML=base.map(([v,l])=>`<button class="tab" role="tab" data-view="${v}" aria-selected="${VIEW===v}">${l}</button>`).join("");
  $$(".tab").forEach(t=>t.onclick=()=>{ VIEW=t.dataset.view; buildTabs(); render(); });
}

/* ============================================================ RENDER DISPATCH */
function render(){
  if(MODE==="playoffs"){
    if(VIEW==="ranking") renderKoRanking();
    else if(VIEW==="partidas") renderKoPartidas();
    else if(VIEW==="chave") renderMataMata();
    else if(VIEW==="perfis") renderKoPerfis();
    else if(VIEW==="meus") renderKoMeus();
    return;
  }
  if(VIEW==="ranking") renderRanking();
  else if(VIEW==="jogos") renderJogos();
  else if(VIEW==="tabela") renderTabela();
  else if(VIEW==="perfis") renderPerfis();
  else if(VIEW==="meus") renderMeus();
}

/* ---- Ranking ---- */
function renderRanking(){
  if(!PROFILES.length){ $("#content").innerHTML=`<div class="empty">Nenhum palpiteiro cadastrado.</div>`; return; }
  const rk=ranking();
  const rows=rk.map((e,i)=>{
    const cls=(i===0?"r1":i===1?"r2":i===2?"r3":"")+(me()&&me().id===e.prof.id?" me":"");
    const tag=me()&&me().id===e.prof.id?`<span class="youtag">Você</span>`:"";
    const nameHtml = i===0
      ? `<span class="flame-name" data-text="${esc(e.prof.name)}">${esc(e.prof.name)}</span><span class="flame-torch">\u{1F525}</span>`
      : esc(e.prof.name);
    const champBadge = i===0
      ? `<div style="font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold);margin-bottom:2px;display:flex;align-items:center;gap:4px;">🏆 Campeão dos Grupos</div>`
      : '';

    // Novo Visual de Metadados (Bolinhas)
    const badges = `
      <div class="badge-row" aria-label="Acertos: ${e.c5} exatos, ${e.c3} empates, ${e.c25} vencedores, ${e.c0} erros">
        ${e.c5 > 0 ? `<span class="score-badge sb-5">${e.c5}</span>` : ''}
        ${e.c3 > 0 ? `<span class="score-badge sb-3">${e.c3}</span>` : ''}
        ${e.c25 > 0 ? `<span class="score-badge sb-25">${e.c25}</span>` : ''}
        ${e.c0 > 0 ? `<span class="score-badge sb-0">${e.c0}</span>` : ''}
        <span style="font-size: 13px; color: var(--muted); margin-left: 4px; font-weight: 500;">(${e.played} jogos)</span>
      </div>`;

    return `<div class="row ${cls}">
      <div class="rank">${i+1}</div>
      <div class="who">${avatar(e.prof)}<div style="min-width:0">${champBadge}<div class="nm${i===0?' flame-host':''}">${nameHtml}${tag}</div>
        ${badges}</div></div>
      <div class="pts">${fmtPts(e.total)}<small>pontos</small></div>
    </div>`;
  }).join("");
  $("#content").innerHTML=`<div class="board"><div class="row head"><div>#</div><div>Palpiteiro</div><div style="text-align:right">Pts</div></div>${rows}</div>`;
}

/* ---- Jogos ---- */
function renderJogos(){
  const groups=groupsAvailable();
  const rounds=roundsAvailable();
  if(JOGOS_ROUND_AUTO) JOGOS_ROUND=firstPendingRound();   // foco automatico na fase com jogos pendentes
  const rchips=[`<button class="chip" data-r="ALL" aria-pressed="${JOGOS_ROUND==='ALL'}">Todas as Rodadas</button>`]
    .concat(rounds.map(r=>`<button class="chip" data-r="${r}" aria-pressed="${JOGOS_ROUND===r}">Rodada ${r}</button>`)).join("");
  const gchips=[`<button class="chip" data-g="ALL" aria-pressed="${GROUP_FILTER==='ALL'}">Todos os Grupos</button>`]
    .concat(groups.map(g=>`<button class="chip" data-g="${g}" aria-pressed="${GROUP_FILTER===g}">Grupo ${g}</button>`)).join("");
  const cur=currentMatch();
  const showCur = SHOW_CURRENT && !!cur;
  // o card em destaque sai da lista de baixo (pra não aparecer duplicado)
  const list=MATCHES.filter(m=>(GROUP_FILTER==="ALL"||m.group===GROUP_FILTER)&&(JOGOS_ROUND==="ALL"||m.round===JOGOS_ROUND)&&!(showCur&&m.id===cur.id));
  // chip liga/desliga o destaque (só aparece se ainda houver jogo em aberto)
  const curChip = cur ? `<div class="filters"><button class="chip" id="curToggle" aria-pressed="${SHOW_CURRENT}">${SHOW_CURRENT?'✓ ':''}Jogo atual</button></div>` : "";
  let curHtml="";
  if(showCur){
    const live=cur.status==="IN_PLAY";
    const t=live?liveMinuteText(cur):"";
    const headTxt=live
      ? `<span class="cur-dot"></span> Ao vivo agora${t?` <span class="cur-min js-livemin" data-mid="${esc(cur.id)}">${esc(t)}</span>`:""}`
      : '⏱ Próximo jogo';
    curHtml=`<div class="cur-card${live?' live':''}"><div class="cur-head${live?' live':''}">${headTxt}</div>${matchCard(cur)}</div>`;
  }
  let html=`<div class="filters">${rchips}</div><div class="filters">${gchips}</div>${curChip}${curHtml}`;
  if(!list.length && !showCur) html+=`<div class="empty">Sem jogos neste filtro.</div>`;
  else for(const r of rounds){
    const inR=list.filter(m=>m.round===r);
    if(!inR.length) continue;
    html+=`<div class="roundhead">Rodada ${r}</div>`+inR.map(matchCard).join("");
  }
  $("#content").innerHTML=html;
  $$(".chip[data-r]").forEach(c=>c.onclick=()=>{ JOGOS_ROUND_AUTO=false; JOGOS_ROUND=c.dataset.r==="ALL"?"ALL":+c.dataset.r; renderJogos(); });
  $$(".chip[data-g]").forEach(c=>c.onclick=()=>{ GROUP_FILTER=c.dataset.g; renderJogos(); });
  if($("#curToggle")) $("#curToggle").onclick=()=>{ SHOW_CURRENT=!SHOW_CURRENT; renderJogos(); };
  $$(".match").forEach(el=>el.onclick=()=>openMatch(el.dataset.id));
}
function matchCard(m){
  const fin=m.status==="FINISHED"&&m.homeScore!=null;
  const live=m.status==="IN_PLAY"&&m.homeScore!=null;
  const show=fin||live;
  const nPicks=PROFILES.filter(p=>p.picks?.[m.id]?.home!=null).length;
  return `<div class="match" data-id="${esc(m.id)}">
    <div class="top"><span class="g">Grupo ${esc(m.group)} · Rodada ${m.round}</span>${statusBadge(m)}</div>
    <div class="scoreline">
      <div class="team home"><img src="${esc(m.homeCrest||'')}" alt="" onerror="this.style.visibility='hidden'"><span class="tn">${esc(m.home)}</span></div>
      <div style="display:flex;align-items:center;gap:12px"><span class="bignum">${show?m.homeScore:"–"}</span><span class="vs">×</span><span class="bignum">${show?m.awayScore:"–"}</span></div>
      <div class="team away"><span class="tn">${esc(m.away)}</span><img src="${esc(m.awayCrest||'')}" alt="" onerror="this.style.visibility='hidden'"></div>
    </div>
    ${show?"":`<div class="kickoff">${esc(kickoff(m))}</div>`}
    <div class="cardfoot"><span>${nPicks} palpite${nPicks===1?"":"s"} registrados</span><span class="go">Ver palpites →</span></div>
  </div>`;
}

/* ---- Tabela / Classificação dos grupos ---- */
// Monta a classificação de cada grupo somando SÓ jogos encerrados (FINISHED).
function computeStandings(){
  const groups={}, crest={};
  for(const m of MATCHES){
    const g=m.group; if(g==null) continue;
    (groups[g]||(groups[g]={}));
    for(const name of [m.home,m.away]){
      if(name==null) continue;
      if(!groups[g][name]) groups[g][name]={name,pj:0,v:0,e:0,d:0,gp:0,gc:0,pts:0};
    }
    if(m.homeCrest) crest[m.home]=m.homeCrest;
    if(m.awayCrest) crest[m.away]=m.awayCrest;
    if(m.status==="FINISHED"&&m.homeScore!=null&&m.awayScore!=null){
      const h=groups[g][m.home], a=groups[g][m.away], hs=+m.homeScore, as=+m.awayScore;
      h.pj++; a.pj++; h.gp+=hs; h.gc+=as; a.gp+=as; a.gc+=hs;
      if(hs>as){ h.v++; h.pts+=3; a.d++; }
      else if(hs<as){ a.v++; a.pts+=3; h.d++; }
      else { h.e++; a.e++; h.pts++; a.pts++; }
    }
  }
  return Object.keys(groups).sort().map(g=>{
    const teams=Object.values(groups[g]).map(t=>({...t,sg:t.gp-t.gc,crest:crest[t.name]||""}));
    // Desempate: pontos > saldo > gols pró > nome.
    teams.sort((x,y)=> y.pts-x.pts || y.sg-x.sg || y.gp-x.gp || x.name.localeCompare(y.name,"pt"));
    return {group:g,teams};
  });
}
function renderTabela(){
  const standings=computeStandings();
  if(!standings.length){ $("#content").innerHTML=`<div class="empty">Sem grupos para exibir.</div>`; return; }
  const note=`<div class="st-note"><span class="st-dot"></span> Verde = 2 primeiros de cada grupo · considera apenas jogos encerrados</div>`;
  const blocks=standings.map(({group,teams})=>{
    const rows=teams.map((t,i)=>`<tr class="${i<2?'qual':''}">
        <td class="st-pos">${i+1}</td>
        <td class="st-team"><div class="st-team-in"><img class="st-flag" src="${esc(t.crest)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(t.name)}</span></div></td>
        <td class="st-pts">${t.pts}</td>
        <td>${t.v}</td>
        <td>${t.e}</td>
        <td>${t.d}</td>
        <td class="st-sg">${t.sg>0?'+':''}${t.sg}</td>
      </tr>`).join("");
    return `<div class="roundhead" style="margin:24px 0 12px">Grupo ${esc(group)}</div>
      <table class="standings">
        <thead><tr><th class="st-pos">#</th><th class="st-team">Time</th><th>Pts</th><th>V</th><th>E</th><th>D</th><th class="st-sg">SG</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join("");
  $("#content").innerHTML=note+blocks;
}

/* ============================================================ MATA-MATA (chaveamento) */
let R32T=null;   // tabela do Anexo C (495 combinações), carregada sob demanda
// De onde vem cada confronto a partir dos vencedores anteriores (estrutura oficial FIFA):
const KO_FEED={
  89:[74,77], 90:[73,75], 91:[76,78], 92:[79,80],
  93:[83,84], 94:[81,82], 95:[86,88], 96:[85,87],
  97:[89,90], 98:[93,94], 99:[91,92], 100:[95,96],
  101:[97,98], 102:[99,100], 104:[101,102]
};
const KO_ROUNDS=[
  ["16-avos de final",[73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88]],
  ["Oitavas de final",[89,90,91,92,93,94,95,96]],
  ["Quartas de final",[97,98,99,100]],
  ["Semifinais",[101,102]],
  ["3º Lugar",[103]],
  ["Final",[104]]
];
async function loadR32Thirds(){
  if(R32T) return R32T;
  const r=await fetch("data/r32-thirds.json?t="+Date.now());
  if(!r.ok) throw new Error("r32-thirds "+r.status);
  R32T=await r.json(); return R32T;
}
function crestMap(){ const c={}; for(const m of MATCHES){ if(m.homeCrest)c[m.home]=m.homeCrest; if(m.awayCrest)c[m.away]=m.awayCrest; } return c; }

// Monta os 16 confrontos do R32 pela classificação ATUAL: 1º e 2º de cada grupo +
// os 8 melhores 3º lugares (regras FIFA), com a alocação dos 3º vinda do Anexo C.
function koSeeds(){
  const st=computeStandings();
  const byG={}, thirds=[];
  for(const {group,teams} of st){ byG[group]=teams; if(teams[2]) thirds.push({...teams[2],group}); }
  thirds.sort((x,y)=> y.pts-x.pts || y.sg-x.sg || y.gp-x.gp || x.name.localeCompare(y.name,"pt") || x.group.localeCompare(y.group));
  const qualGroups=thirds.slice(0,8).map(t=>t.group).sort();
  const assign=R32T?R32T[qualGroups.join("")]:null;   // 8 letras na ordem das colunas [A,B,D,E,G,I,K,L]
  const cols=["A","B","D","E","G","I","K","L"], slotMatch={A:79,B:85,D:81,E:74,G:82,I:77,K:87,L:80};
  const thirdGroupFor={};
  if(assign) cols.forEach((c,i)=> thirdGroupFor[slotMatch[c]]=assign[i]);
  const cr=crestMap(), T=(name)=> name?{name,crest:cr[name]||""}:null;
  const w=(g)=>T(byG[g]&&byG[g][0]&&byG[g][0].name), ru=(g)=>T(byG[g]&&byG[g][1]&&byG[g][1].name), th=(g)=>T(byG[g]&&byG[g][2]&&byG[g][2].name);
  const tm=(slot)=> thirdGroupFor[slot]?th(thirdGroupFor[slot]):null;   // 3º do grupo definido pelo Anexo C
  return {
    73:[ru("A"),ru("B")], 74:[w("E"),tm(74)], 75:[w("F"),ru("C")], 76:[w("C"),ru("F")],
    77:[w("I"),tm(77)], 78:[ru("E"),ru("I")], 79:[w("A"),tm(79)], 80:[w("L"),tm(80)],
    81:[w("D"),tm(81)], 82:[w("G"),tm(82)], 83:[ru("K"),ru("L")], 84:[w("H"),ru("J")],
    85:[w("B"),tm(85)], 86:[w("J"),ru("H")], 87:[w("K"),tm(87)], 88:[ru("D"),ru("G")]
  };
}
// Vencedor de um jogo a partir do palpite de placar (empate -> quem avança nos pênaltis).
// Para fases além dos 16-avos, o pick pode ser só {adv} sem h/a.
function koWinner(teams,pick){
  if(!teams||!teams[0]||!teams[1]||!pick||typeof pick!=="object") return null;
  if(pick.h==null&&pick.a==null) return pick.adv==="home"?teams[0]:(pick.adv==="away"?teams[1]:null);
  if(pick.h==null||pick.a==null) return null;
  if(+pick.h>+pick.a) return teams[0];
  if(+pick.a>+pick.h) return teams[1];
  return pick.adv==="home"?teams[0]:(pick.adv==="away"?teams[1]:null);
}
// Foto do chaveamento AGORA: usa os confrontos REAIS do worker (times definidos a
// cada jogo) e cai na projeção pela classificação só nos 16-avos quando o worker
// ainda não trouxe o confronto. Conforme os jogos terminam, o worker já preenche
// os times da fase seguinte (ex.: vencedor do 73 vira mandante do 90), então aqui
// basta espelhar m.home/m.away — o avanço propaga sozinho.
function koResolveProjection(){
  const M={...koSeeds()};                         // R32 projetado (fallback)
  const cr=crestMap();
  const side=(name,crest)=> name!=null?{name,crest:crest||cr[name]||""}:null;
  for(let mid=73; mid<=104; mid++){
    const m=MATCHES.find(x=>+x.id===mid);
    if(!m){ if(mid>=89) M[mid]=[null,null]; continue; }
    const a=side(m.home,m.homeCrest), b=side(m.away,m.awayCrest);
    if(a||b) M[mid]=[a,b];                         // confronto real já definido
    else if(mid>=89) M[mid]=[null,null];           // oitavas+ ainda a definir
  }
  return M;
}
// Bracket pessoal: o vencedor que a pessoa previu avança pra próxima fase.
function koResolvePicks(picks){
  const M={...koSeeds()};
  for(const mid of [89,90,91,92,93,94,95,96,97,98,99,100,101,102,104]){
    const f=KO_FEED[mid];
    M[mid]=[ koWinner(M[f[0]],picks&&picks[f[0]]), koWinner(M[f[1]],picks&&picks[f[1]]) ];
  }
  // 3º lugar: perdedores das semis 101 e 102
  const koLoser=(teams,pick)=>{ if(!teams||!teams[0]||!teams[1]) return null; const w=koWinner(teams,pick); return w?(w===teams[0]?teams[1]:teams[0]):null; };
  M[103]=[koLoser(M[101],picks&&picks[101]), koLoser(M[102],picks&&picks[102])];
  return M;
}

/* ----- Aba Mata-mata: bracket inteiro, só leitura, com zoom e arrasto ----- */
const KO_BRACKET_COLS=[
  {label:"16-avos", ids:[74,77,73,75,83,84,81,82,76,78,79,80,86,88,85,87]},
  {label:"Oitavas", ids:[89,90,93,94,91,92,95,96], childN:16},
  {label:"Quartas", ids:[97,98,99,100], childN:8},
  {label:"Semis",   ids:[101,102], childN:4},
  {label:"Final",   ids:[104], childN:2}
];
const KO_H=1320;   // altura base (px) da área de jogos, p/ alinhar as fases (mais alto = menos "wide")
let MEUS_OPEN={grupos:false, mata:false};
let koZoom=1, koPanX=12, koPanY=12, koViewInit=false;
function koCell(teams, cellClass){
  const slot=(t)=> t?`<div class="kb-team"><img src="${esc(t.crest||'')}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(t.name)}</span></div>`:`<div class="kb-team tbd">A definir</div>`;
  const cls=typeof cellClass==='string'?cellClass:(cellClass?'kb-hasright':'');
  return `<div class="kb-cell${cls?' '+cls:''}">${slot(teams[0])}${slot(teams[1])}</div>`;
}
function koMountPanZoom(stage,inner){
  let z=koZoom, ox=koPanX, oy=koPanY;
  const clamp=(v)=>Math.max(0.2,Math.min(3,v));
  const apply=()=>{ inner.style.transform=`translate(${ox}px,${oy}px) scale(${z})`; koZoom=z; koPanX=ox; koPanY=oy; };
  if(!koViewInit){ const sw=stage.clientWidth||360, bw=inner.scrollWidth||910; z=clamp(Math.min(1,(sw-24)/bw)); ox=12; oy=12; koViewInit=true; }
  apply();
  const zoomAt=(nz,mx,my)=>{ nz=clamp(nz); ox=mx-(mx-ox)*(nz/z); oy=my-(my-oy)*(nz/z); z=nz; apply(); };
  const pts=new Map(); let pan=null, pinch=null;
  stage.onpointerdown=(e)=>{ stage.setPointerCapture(e.pointerId); pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1){ pan={x:e.clientX,y:e.clientY,ox,oy}; pinch=null; }
    else if(pts.size===2){ const a=[...pts.values()], r=stage.getBoundingClientRect();
      pinch={d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y), z, mx:(a[0].x+a[1].x)/2-r.left, my:(a[0].y+a[1].y)/2-r.top}; pan=null; } };
  stage.onpointermove=(e)=>{ if(!pts.has(e.pointerId)) return; pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch&&pts.size>=2){ const a=[...pts.values()], d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y); zoomAt(pinch.z*d/pinch.d, pinch.mx, pinch.my); }
    else if(pan){ ox=pan.ox+(e.clientX-pan.x); oy=pan.oy+(e.clientY-pan.y); apply(); } };
  const end=(e)=>{ pts.delete(e.pointerId); pinch=null; if(pts.size===1){ const q=[...pts.values()][0]; pan={x:q.x,y:q.y,ox,oy}; } else if(pts.size===0){ pan=null; } };
  stage.onpointerup=end; stage.onpointercancel=end; stage.onlostpointercapture=end;
  stage.onwheel=(e)=>{ e.preventDefault(); const r=stage.getBoundingClientRect(); zoomAt(z*(e.deltaY<0?1.12:0.89), e.clientX-r.left, e.clientY-r.top); };
  const ctr=(f)=>{ const r=stage.getBoundingClientRect(); zoomAt(f(z), r.width/2, r.height/2); };
  if($("#koZin")) $("#koZin").onclick=()=>ctr(v=>v*1.2);
  if($("#koZout")) $("#koZout").onclick=()=>ctr(v=>v/1.2);
  if($("#koZfit")) $("#koZfit").onclick=()=>{ const sw=stage.clientWidth||360, bw=inner.scrollWidth||910; z=clamp(Math.min(1,(sw-24)/bw)); ox=12; oy=12; apply(); };
}
async function renderMataMata(){
  if(!R32T){
    $("#content").innerHTML=`<div class="empty">Carregando chaveamento…</div>`;
    try{ await loadR32Thirds(); }catch(e){ $("#content").innerHTML=`<div class="empty">Não consegui carregar o chaveamento. Tente recarregar a página.</div>`; return; }
    if(MODE!=="playoffs"||VIEW!=="chave") return;
  }
  const M=koResolveProjection();
  // Dois lados do chaveamento (8 times por lado)
  const LEFT=[
    {label:"16-avos", ids:[74,77,73,75,83,84,81,82]},
    {label:"Oitavas", ids:[89,90,93,94], childN:8},
    {label:"Quartas", ids:[97,98], childN:4},
    {label:"Semis",   ids:[101], childN:2}
  ];
  const RIGHT=[ // DOM order: visual right→left (row-reverse)
    {label:"16-avos", ids:[76,78,79,80,86,88,85,87]},
    {label:"Oitavas", ids:[91,92,95,96], childN:8},
    {label:"Quartas", ids:[99,100], childN:4},
    {label:"Semis",   ids:[102], childN:2}
  ];
  const buildCol=(col,isRight)=>{
    const cells=col.ids.map(mid=>{
      const join=col.childN
        ?`<span class="${isRight?'kb-join-r':'kb-join'}" style="--conn:${KO_H/col.childN}px"></span>`:"";
      return `<div class="kb-slot">${join}${koCell(M[mid], isRight?'kb-hasleft':'kb-hasright')}</div>`;
    }).join("");
    return `<div class="kb-col"><div class="kb-head">${esc(col.label)}</div><div class="kb-cells">${cells}</div></div>`;
  };
  const leftHtml =LEFT.map(c=>buildCol(c,false)).join("");
  const rightHtml=RIGHT.map(c=>buildCol(c,true)).join("");
  const finalHtml=`<div class="kb-col kb-final-col">
    <div class="kb-head">Final</div>
    <div class="kb-cells"><div class="kb-slot">${koCell(M[104],'kb-hasleft kb-hasright')}</div></div>
  </div>`;
  const bracket=`<div class="kb-bracket-two" style="height:${KO_H+26}px">
    <div class="kb-half">${leftHtml}</div>
    ${finalHtml}
    <div class="kb-half kb-half-r">${rightHtml}</div>
  </div>`;
  $("#content").innerHTML=`
    <div class="kb-wrap">
      <div class="kb-ctrls"><button class="btn small" id="koZout" aria-label="Diminuir zoom">−</button><button class="btn small" id="koZfit">Ajustar</button><button class="btn small" id="koZin" aria-label="Aumentar zoom">+</button></div>
      <div class="kb-stage" id="koStage"><div id="koBracket" style="transform-origin:0 0">${bracket}</div></div>
    </div>`;
  koMountPanZoom($("#koStage"), $("#koBracket"));
}

/* ----- Editor de palpites do mata-mata (na aba Palpites) ----- */
function koEditorHtml(picks){
  const M=koResolvePicks(picks), champ=koWinner(M[104], picks&&picks[104]);
  const rounds=KO_ROUNDS.map(([label,ids])=>{
    const rows=ids.map(mid=>{
      const A=M[mid][0], B=M[mid][1], known=!!(A&&B);
      const pk=(picks&&typeof picks[mid]==="object")?picks[mid]:null;
      const nm=(t)=> t?`<span class="ke-tn">${esc(t.name)}</span>`:`<span class="ke-tn tbd">A definir</span>`;
      const fl=(t)=> t?`<img class="pl-flag" src="${esc(t.crest||'')}" alt="" onerror="this.style.display='none'">`:"";
      if(KO_R32_IDS.has(mid)){
        const hv=pk&&pk.h!=null?pk.h:"", av=pk&&pk.a!=null?pk.a:"";
        const draw=known && hv!=="" && av!=="" && (+hv===+av);
        const pen=draw?`<div class="ke-pen">
          <span class="ke-pen-q">⚽ Empate! Quem passa nos pênaltis?</span>
          <div class="ke-pen-btns">
            <button class="ke-adv${pk&&pk.adv==='home'?' on':''}" data-mid="${mid}" data-adv="home"><span class="ke-mark">✕</span>${esc(A.name)}</button>
            <button class="ke-adv${pk&&pk.adv==='away'?' on':''}" data-mid="${mid}" data-adv="away"><span class="ke-mark">✕</span>${esc(B.name)}</button>
          </div>
        </div>`:"";
        return `<div class="ke-row${known?'':' off'}">
          <div class="ke-line">
            <div class="ke-side">${fl(A)}${nm(A)}</div>
            <input class="fld ke-in" type="number" min="0" inputmode="numeric" data-mid="${mid}" data-side="h" value="${hv}"${known?'':' disabled'}>
            <span class="vs">×</span>
            <input class="fld ke-in" type="number" min="0" inputmode="numeric" data-mid="${mid}" data-side="a" value="${av}"${known?'':' disabled'}>
            <div class="ke-side away">${nm(B)}${fl(B)}</div>
          </div>${pen}
        </div>`;
      } else {
        const picked=pk?pk.adv:null;
        return `<div class="ke-row${known?'':' off'}">
          <div class="ke-line">
            <div class="ke-side">${fl(A)}${nm(A)}</div>
            <button class="ke-adv ke-xbox${picked==='home'?' on':''}" data-mid="${mid}" data-adv="home"${known?'':' disabled'} aria-label="${esc(A?A.name:'')} avança"><span class="ke-mark">✕</span></button>
            <span class="vs">×</span>
            <button class="ke-adv ke-xbox${picked==='away'?' on':''}" data-mid="${mid}" data-adv="away"${known?'':' disabled'} aria-label="${esc(B?B.name:'')} avança"><span class="ke-mark">✕</span></button>
            <div class="ke-side away">${nm(B)}${fl(B)}</div>
          </div>
        </div>`;
      }
    }).join("");
    const phase=koPhaseFor(ids[0]);
    const qpts=phase?KO_QUAL_PTS[phase]:null;
    const ptLabel=qpts?` <span style="font-size:12px;color:var(--muted);font-weight:400">· acertar = ${qpts} pts</span>`:'';
    return `<div class="ke-round">${label}${ptLabel}</div>${rows}`;
  }).join("");
  return `<div class="ke-champ">Seu campeão previsto: <b>${champ?esc(champ.name):'—'}</b></div>
    <p style="font-size:13px;color:var(--muted);margin:0 0 14px">Nos 16-avos, crave o placar (exato=5, vencedor=2,5, empate 90min=3) e quem passa (+5 bônus). Nas demais fases, escolha apenas quem avança.</p>
    ${rounds}
    <div class="ko-save"><button class="btn primary" id="koSaveBtn">Salvar meu mata-mata</button></div>`;
}
function bindKoEditor(){
  const host=$("#koEditor"); if(!host) return;
  const refresh=()=>{ const p=me(); host.innerHTML=koEditorHtml(p?p.ko||{}:{}); bindKoEditor(); };
  $$(".ke-in",host).forEach(inp=> inp.onchange=()=>{
    const p=me(); if(!p) return; p.ko=p.ko||{};
    const mid=+inp.dataset.mid, side=inp.dataset.side==="h"?"h":"a";
    const cur=(typeof p.ko[mid]==="object"&&p.ko[mid])?p.ko[mid]:{};
    cur[side]= inp.value===""?null:Math.max(0,parseInt(inp.value,10)||0);
    if(cur.h==null&&cur.a==null) delete p.ko[mid]; else p.ko[mid]=cur;
    if(p.ko[mid]&&p.ko[mid].h!=null&&p.ko[mid].a!=null&&+p.ko[mid].h!==+p.ko[mid].a) delete p.ko[mid].adv;
    PROFILES=PROFILES.map(x=>x.id===p.id?p:x); DIRTY=true; MEUS_OPEN.mata=true; refresh();
  });
  $$(".ke-adv",host).forEach(b=> b.onclick=()=>{
    const p=me(); if(!p) return; p.ko=p.ko||{};
    const mid=+b.dataset.mid, cur=(typeof p.ko[mid]==="object"&&p.ko[mid])?p.ko[mid]:{};
    cur.adv=b.dataset.adv; p.ko[mid]=cur;
    PROFILES=PROFILES.map(x=>x.id===p.id?p:x); DIRTY=true; MEUS_OPEN.mata=true; refresh();
  });
  const sb=$("#koSaveBtn",host); if(sb) sb.onclick=()=>save();
}

/* ============================================================ PLAYOFFS (modo mata-mata) */
const KO_PHASES=[
  ["16-avos",[73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88]],
  ["Oitavas",[89,90,91,92,93,94,95,96]],
  ["Quartas",[97,98,99,100]],
  ["Semifinais",[101,102]],
  ["3º Lugar",[103]],
  ["Final",[104]]
];
const KO_ALL_IDS=[73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104];
// Garante o Anexo C carregado antes dos renders que dependem do chaveamento.
function ensureR32(cb){
  if(R32T){ cb(); return; }
  $("#content").innerHTML=`<div class="empty">Carregando chaveamento…</div>`;
  loadR32Thirds().then(()=>{ if(MODE==="playoffs") cb(); }).catch(()=>{ $("#content").innerHTML=`<div class="empty">Não consegui carregar o chaveamento. Tente recarregar a página.</div>`; });
}
// IDs dos 16-avos e pontuação por fase (classificado certo).
const KO_R32_IDS=new Set([73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88]);
const KO_QUAL_PTS={r32:5,r16:10,qf:20,sf:40,third:60,final:80};
function koPhaseFor(mid){
  const id=+mid;
  if(KO_R32_IDS.has(id)) return "r32";
  if(id>=89&&id<=96) return "r16";
  if(id>=97&&id<=100) return "qf";
  if(id===101||id===102) return "sf";
  if(id===103) return "third";
  if(id===104) return "final";
  return null;
}
// Pontos de placar nos 16-avos (baseado nos 90 min): exato=5, vencedor=2.5, empate=3.
function pointsForKo90(ph,pa,ah,aa){
  if(ph===ah&&pa===aa) return 5;
  const ps=Math.sign(ph-pa),as_=Math.sign(ah-aa);
  if(ps!==as_) return 0;
  return as_===0?3:2.5;
}
// Quem a pessoa previu que avança (pick {h,a,adv} ou {adv} para fases além dos 16-avos).
function koPickedAdvancer(pick){
  if(!pick) return null;
  if(pick.h==null||pick.a==null) return pick.adv||null;
  const ph=+pick.h,pa=+pick.a;
  if(ph>pa) return "home"; if(pa>ph) return "away"; return pick.adv||null;
}
// Quem realmente avançou (draw => m.koWinner do worker, "home"|"away").
function koActualAdvancer(m){
  if(m.homeScore==null||m.awayScore==null) return null;
  const ah=+m.homeScore,aa=+m.awayScore;
  if(ah>aa) return "home"; if(aa>ah) return "away"; return m.koWinner||null;
}
function scoreKnockout(prof){
  const ko=prof.ko||{}; let total=0,played=0;
  for(const m of MATCHES){
    const phase=koPhaseFor(m.id); if(!phase) continue;
    if(m.status!=="FINISHED"||m.homeScore==null||m.awayScore==null) continue;
    const pick=ko[m.id]; const adv=koActualAdvancer(m);
    if(phase==="r32"){
      if(!pick||pick.h==null||pick.a==null) continue;
      played++;
      total+=pointsForKo90(+pick.h,+pick.a,+m.homeScore,+m.awayScore);
      if(adv&&koPickedAdvancer(pick)===adv) total+=KO_QUAL_PTS.r32;
    } else {
      const predAdv=koPickedAdvancer(pick); if(!predAdv) continue;
      played++;
      if(adv&&predAdv===adv) total+=KO_QUAL_PTS[phase];
    }
  }
  return played>0?total:null;
}
function koStatsFor(prof){
  const ko=prof.ko||{};
  let picks=0;
  for(const mid of KO_ALL_IDS){
    const pk=ko[mid]; if(!pk||typeof pk!=="object") continue;
    if(KO_R32_IDS.has(mid)){if(pk.h!=null&&pk.a!=null) picks++;} else {if(pk.adv) picks++;}
  }
  const M=koResolvePicks(ko), ch=koWinner(M[104], ko[104]);
  return { picks, champ: ch?ch.name:null, pts: scoreKnockout(prof) };
}
function koRanking(){
  return PROFILES.map(p=>({prof:p, ...koStatsFor(p)}))
    .sort((a,b)=> (b.pts||0)-(a.pts||0) || b.picks-a.picks || a.prof.name.localeCompare(b.prof.name,"pt"));
}

/* ---- Playoffs: Ranking ---- */
function renderKoRanking(){
  if(!R32T) return ensureR32(renderKoRanking);
  if(!PROFILES.length){ $("#content").innerHTML=`<div class="empty">Nenhum palpiteiro cadastrado.</div>`; return; }
  const rk=koRanking();
  const hasScores=rk.some(e=>e.pts!==null);
  const note=hasScores
    ?`<div class="ko-note">Ranking do mata-mata. <b>16-avos:</b> placar exato=5, vencedor=2,5, empate 90min=3, classificado=+5. Demais fases (acertar quem passa): oitavas=10, quartas=20, semi=40, 3º lugar=60, final=80.</div>`
    :`<div class="ko-note">Os jogos do mata-mata ainda não começaram. <b>16-avos:</b> placar exato=5, vencedor=2,5, empate 90min=3, classificado=+5. Demais fases (acertar quem passa): oitavas=10, quartas=20, semi=40, 3º lugar=60, final=80. Por enquanto mostra campeão cravado e palpites feitos.</div>`;
  const rows=rk.map((e,i)=>{
    const mine=me()&&me().id===e.prof.id;
    const cls=(i===0?"r1":i===1?"r2":i===2?"r3":"")+(mine?" me":"");
    const champ=e.champ?`<span class="ko-champ-mini">🏆 ${esc(e.champ)}</span>`:`<span style="color:var(--muted);font-size:13px">sem campeão</span>`;
    return `<div class="row ${cls}">
      <div class="rank">${i+1}</div>
      <div class="who">${avatar(e.prof)}<div style="min-width:0"><div class="nm">${esc(e.prof.name)}${mine?'<span class="youtag">Você</span>':''}</div>
        <div class="badge-row">${champ}<span style="font-size:13px;color:var(--muted);margin-left:4px">${e.picks} palpites</span></div></div></div>
      <div class="pts">${e.pts==null?'—':fmtPts(e.pts)}<small>${e.pts==null?'a definir':'pontos'}</small></div>
    </div>`;
  }).join("");
  $("#content").innerHTML=note+`<div class="board"><div class="row head"><div>#</div><div>Palpiteiro</div><div style="text-align:right">Pts</div></div>${rows}</div>`;
}

/* ---- Playoffs: Partidas (por fase, projetadas) ---- */
function koFixtureCard(mid, teams){
  const a=teams&&teams[0], b=teams&&teams[1];
  const tn=(t)=> t?`<span class="tn">${esc(t.name)}</span>`:`<span class="tn" style="color:var(--muted);font-weight:600">A definir</span>`;
  const fl=(t)=> `<img src="${esc((t&&t.crest)||'')}" alt="" style="${t&&t.crest?'':'visibility:hidden'}" onerror="this.style.visibility='hidden'">`;
  return `<div class="match" style="cursor:default">
    <div class="top"><span class="g">Jogo ${mid}</span><span class="status">A jogar</span></div>
    <div class="scoreline">
      <div class="team home">${fl(a)}${tn(a)}</div>
      <div style="display:flex;align-items:center;gap:12px"><span class="bignum">–</span><span class="vs">×</span><span class="bignum">–</span></div>
      <div class="team away">${tn(b)}${fl(b)}</div>
    </div></div>`;
}
function renderKoPartidas(){
  if(!R32T) return ensureR32(renderKoPartidas);
  const M=koResolveProjection();
  if(KO_PHASE_AUTO){   // 1a fase com confronto definido (hoje: 16-avos, pois não há resultados de KO)
    KO_PHASE=0;
    for(let i=0;i<KO_PHASES.length;i++){ if(KO_PHASES[i][1].some(mid=>M[mid]&&M[mid][0]&&M[mid][1])){ KO_PHASE=i; break; } }
  }
  const chips=KO_PHASES.map((p,i)=>`<button class="chip" data-ph="${i}" aria-pressed="${KO_PHASE===i}">${esc(p[0])}</button>`).join("");
  const [label,ids]=KO_PHASES[KO_PHASE];
  const cards=ids.map(mid=>koFixtureCard(mid, M[mid])).join("");
  $("#content").innerHTML=`<div class="ko-note">Partidas do mata-mata por fase. Os 16-avos vêm da classificação atual (projeção); as fases seguintes aparecem conforme os jogos acontecem.</div>
    <div class="filters">${chips}</div>
    <div class="roundhead" style="margin-top:8px">${esc(label)}</div>${cards}`;
  $$(".chip[data-ph]").forEach(c=>c.onclick=()=>{ KO_PHASE_AUTO=false; KO_PHASE=+c.dataset.ph; renderKoPartidas(); });
}

/* ---- Playoffs: Palpiteiros ---- */
function renderKoPerfis(){
  if(!R32T) return ensureR32(renderKoPerfis);
  if(!PROFILES.length){ $("#content").innerHTML=`<div class="empty">Nenhum palpiteiro cadastrado.</div>`; return; }
  const cards=PROFILES.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt")).map(p=>{
    const s=koStatsFor(p); const mine=me()&&me().id===p.id;
    return `<div class="pcard${mine?' me':''}" data-id="${esc(p.id)}">${avatar(p)}
      <div style="min-width:0"><div class="nm">${esc(p.name)}</div>
        <div style="font-size:14px;font-weight:700;color:var(--signal);margin-top:4px">${s.champ?'🏆 '+esc(s.champ):'sem campeão'}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:2px">${s.picks} palpites no mata-mata</div></div></div>`;
  }).join("");
  $("#content").innerHTML=`<div class="pgrid">${cards}</div>`;
  $$(".pcard").forEach(el=>el.onclick=()=>openKoProfile(el.dataset.id));
}
function openKoProfile(id){
  const p=profileById(id); if(!p) return;
  const ko=p.ko||{}, M=koResolvePicks(ko);
  const body=KO_ROUNDS.map(([label,ids])=>{
    const rows=ids.map(mid=>{
      const A=M[mid][0], B=M[mid][1]; if(!A||!B) return "";
      const pk=(typeof ko[mid]==="object")?ko[mid]:null;
      const m=MATCHES.find(x=>+x.id===mid);
      const fin=!!(m&&m.status==="FINISHED"&&m.homeScore!=null&&m.awayScore!=null);
      let sc="—";
      if(KO_R32_IDS.has(mid)){
        if(pk&&pk.h!=null&&pk.a!=null){ sc=`${pk.h} – ${pk.a}`; if(+pk.h===+pk.a&&pk.adv) sc+=` <span style="color:var(--muted)">(pen: ${pk.adv==='home'?esc(A.name):esc(B.name)})</span>`; }
      } else {
        if(pk&&pk.adv) sc=`→ ${pk.adv==='home'?esc(A.name):esc(B.name)}`;
      }
      let ptTag="";
      if(fin&&pk){
        const phase=koPhaseFor(mid); const adv=koActualAdvancer(m); const predAdv=koPickedAdvancer(pk);
        if(phase==="r32"&&pk.h!=null&&pk.a!=null){
          const sp=pointsForKo90(+pk.h,+pk.a,+m.homeScore,+m.awayScore);
          const qp=(adv&&predAdv===adv)?KO_QUAL_PTS.r32:0;
          const tot=sp+qp; const cls=tot===0?"p0":sp===5?"p5":sp===3?"p3":"p25";
          ptTag=`<span class="ptag ${cls}">${fmtPts(tot)} pts${qp>0?` +${qp}Q`:""}</span>`;
        } else if(phase&&phase!=="r32"&&predAdv){
          const pts=(adv&&predAdv===adv)?KO_QUAL_PTS[phase]:0;
          ptTag=`<span class="ptag ${pts>0?'p5':'p0'}">${pts} pts</span>`;
        }
      }
      return `<div class="pick-line"><div class="pl-who"><span class="nm" style="font-size:14px">${esc(A.name)} <span class="vs">×</span> ${esc(B.name)}</span></div>
        <div class="pl-right"><span class="pscore${pk?'':' none'}">${sc}</span>${fin?`<span style="font-size:12px;color:var(--muted);margin:0 4px">${m.homeScore}–${m.awayScore}</span>`:""}${ptTag}</div></div>`;
    }).filter(Boolean).join("");
    return rows?`<div class="ke-round">${label}</div>${rows}`:"";
  }).join("") || `<div class="empty">Sem palpites de mata-mata ainda.</div>`;
  const ch=koWinner(M[104], ko[104]);
  const totalKo=scoreKnockout(p);
  $("#modal").innerHTML=`<button class="x" id="m-x">✕</button>
    <div class="mhead">${avatar(p)}<div><h3 style="padding:0">${esc(p.name)}</h3>
      <div style="color:var(--signal);font-size:15px;font-weight:700">${ch?'🏆 Campeão: '+esc(ch.name):'Sem campeão definido'}</div>
      ${totalKo!==null?`<div style="font-size:14px;color:var(--muted);margin-top:2px">Mata-mata: ${fmtPts(totalKo)} pts</div>`:""}</div></div>
    ${body}`;
  openModal(); $("#m-x").onclick=()=>closeModal();
}

/* ---- Playoffs: Meus Palpites (editor de placares do KO) ---- */
function renderKoMeus(){
  const p=me(); if(!p){ VIEW="ranking"; buildTabs(); render(); return; }
  if(!R32T) return ensureR32(renderKoMeus);
  $("#content").innerHTML=`<div id="koEditor"></div>`;
  fillKoEditor();
}

/* ---- Detalhe do jogo (modal) ---- */
function openMatch(id){
  const m=MATCHES.find(x=>x.id===id); if(!m) return;
  const fin=m.status==="FINISHED"&&m.homeScore!=null;
  const live=m.status==="IN_PLAY"&&m.homeScore!=null;   // jogo em andamento com placar atual
  let rows=PROFILES.map(p=>{
    const pk=p.picks?.[m.id];
    const sc=scorePick(pk,m);                 // oficial (so quando termina)
    const psc=live?partialScore(pk,m):null;   // parcial ao vivo (nao conta no ranking)
    return {p,pk,sc,psc,has:!!(pk&&pk.home!=null)};
  });
  // Desempate pelo PLACAR palpitado: maior vitória da casa no topo -> maior vitória do
  // visitante na base. Saldo (casa-fora) desc -> total de gols desc -> mesmo placar = alfabético.
  function cmpByPick(a,b){
    if(a.has!==b.has) return b.has-a.has;                       // quem palpitou vem antes de quem não palpitou
    if(!a.has) return a.p.name.localeCompare(b.p.name,"pt");    // ambos sem palpite -> alfabético
    const sa=(+a.pk.home)-(+a.pk.away), sb=(+b.pk.home)-(+b.pk.away);
    if(sb!==sa) return sb-sa;                                   // saldo desc (casa ganha mais no topo)
    const ta=(+a.pk.home)+(+a.pk.away), tb=(+b.pk.home)+(+b.pk.away);
    if(tb!==ta) return tb-ta;                                   // mais gols primeiro
    return a.p.name.localeCompare(b.p.name,"pt");               // mesmo placar -> alfabético
  }
  if(fin) rows.sort((a,b)=> (b.sc??-1)-(a.sc??-1) || cmpByPick(a,b));         // pontos desc, depois placar
  else if(live) rows.sort((a,b)=> (b.psc??-1)-(a.psc??-1) || cmpByPick(a,b)); // parcial desc, depois placar
  else rows.sort(cmpByPick);                                                  // ainda sem pontos: só o placar
  const ranked=fin||live;   // listas pontuadas mostram posicao (1o, 2o...)
  const list=rows.map((r,i)=>{
    const scoreTxt=r.has?`${r.pk.home} – ${r.pk.away}`:"—";
    const shown=fin?r.sc:(live?r.psc:null);
    const tag = shown===null
      ? `<span class="ptag pending">··</span>`
      : `<span class="ptag ${tagClass(shown)}${live?' parcial':''}">${fmtPts(shown)} pts${live?'*':''}</span>`;
    const mine=me()&&me().id===r.p.id;
    return `<div class="pick-line${mine?' me':''}">
      <div class="pl-who">${ranked?`<span class="pl-rank">${i+1}º</span>`:""}${avatar(r.p)}<span class="nm">${esc(r.p.name)}${mine?'<span class="youtag">Você</span>':''}</span></div>
      <div class="pl-right"><span class="pscore${r.has?'':' none'}">${scoreTxt}</span>${tag}</div></div>`;
  }).join("") || `<div class="empty">Ninguém palpitou ainda.</div>`;
  
  const lmt = m.status==="IN_PLAY" ? liveMinuteText(m) : "";
  const liveMin = lmt ? ` · ${esc(lmt)}` : "";
  const headNote = fin
    ? ''
    : live
      ? '<p style="color:var(--live); margin-bottom:16px; font-size:13px; font-weight:600;">Pontuação parcial ao vivo, com o placar atual — <u>já entra no ranking</u> e muda conforme o jogo.</p>'
      : `<p style="color:var(--muted); margin-bottom:16px; font-size:15px; font-weight:600;">Data: ${esc(kickoff(m))}</p>`;
  $("#modal").innerHTML=`<button class="x" id="m-x">✕</button>
    <span class="status ${fin?'fin':(m.status==='IN_PLAY'?'live':'')}" style="display:inline-block;margin-bottom:12px;font-size:14px;">${fin?'Jogo Encerrado':(m.status==='IN_PLAY'?'● Ao vivo no momento'+liveMin:'Aguardando início')}</span>
    <div class="modal-score">
      <div class="team home"><img src="${esc(m.homeCrest||'')}" alt="" onerror="this.style.visibility='hidden'"><span class="tn">${esc(m.home)}</span></div>
      <div style="display:flex;align-items:center;gap:12px"><span class="bignum">${(fin||live)?m.homeScore:"–"}</span><span class="vs">×</span><span class="bignum">${(fin||live)?m.awayScore:"–"}</span></div>
      <div class="team away"><span class="tn">${esc(m.away)}</span><img src="${esc(m.awayCrest||'')}" alt="" onerror="this.style.visibility='hidden'"></div>
    </div>
    ${headNote}
    ${list}`;
  openModal(); $("#m-x").onclick=()=>closeModal();
}

/* ---- Palpiteiros ---- */
function renderPerfis(){
  if(!PROFILES.length){ $("#content").innerHTML=`<div class="empty">Nenhum palpiteiro cadastrado.</div>`; return; }
  const cards=PROFILES.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt")).map(p=>{
    const s=statsFor(p); const mine=me()&&me().id===p.id;
    
    const badges = `
      <div class="badge-row" style="margin-top:8px">
        ${s.c5 > 0 ? `<span class="score-badge sb-5">${s.c5}</span>` : ''}
        ${s.c3 > 0 ? `<span class="score-badge sb-3">${s.c3}</span>` : ''}
        ${s.c25 > 0 ? `<span class="score-badge sb-25">${s.c25}</span>` : ''}
        ${s.c0 > 0 ? `<span class="score-badge sb-0">${s.c0}</span>` : ''}
      </div>`;

    return `<div class="pcard${mine?' me':''}" data-id="${esc(p.id)}">${avatar(p)}
      <div style="min-width:0"><div class="nm">${esc(p.name)}</div><div style="font-size:15px; font-weight:600; color:var(--signal); margin-top:4px;">${fmtPts(s.total)} pts · ${s.played} jogos</div>${badges}</div></div>`;
  }).join("");
  $("#content").innerHTML=`<div class="pgrid">${cards}</div>`;
  $$(".pcard").forEach(el=>el.onclick=()=>openProfile(el.dataset.id));
}

/* ---- Detalhe Palpiteiro (modal) ---- */
function openProfile(id){
  const p=profileById(id); if(!p) return;
  const s=statsFor(p);
  const list=MATCHES.map(m=>{
    const pk=p.picks?.[m.id]; const has=!!(pk&&pk.home!=null);
    const fin=m.status==="FINISHED"&&m.homeScore!=null;
    const isLive=m.status==="IN_PLAY"&&m.homeScore!=null;
    const sc=effScore(pk,m);
    const tag=sc===null?`<span class="ptag pending">··</span>`:`<span class="ptag ${tagClass(sc)}${isLive?' parcial':''}">${fmtPts(sc)} pts</span>`;
    return `<div class="pick-line">
      <div class="pl-who"><span class="tn" style="font-size:15px; font-weight:600;"><img class="pl-flag" src="${esc(m.homeCrest||'')}" alt="" onerror="this.style.display='none'">${esc(m.home)} <span class="vs" style="font-size:14px">×</span> ${esc(m.away)}<img class="pl-flag" src="${esc(m.awayCrest||'')}" alt="" onerror="this.style.display='none'"></span></div>
      <div class="pl-right">
        <div style="display:flex; flex-direction:column; align-items:flex-end">
          <span class="pscore${has?'':' none'}">${has?`${pk.home} – ${pk.away}`:"—"}</span>
          ${(fin||isLive)?`<span style="color:var(--muted); font-size:13px; font-weight:500;">(${isLive?'Parcial':'Real'}: ${m.homeScore}–${m.awayScore})</span>`:""}
        </div>
        ${tag}</div></div>`;
  }).join("");
  $("#modal").innerHTML=`<button class="x" id="m-x">✕</button>
    <div class="mhead">${avatar(p)}<div><h3 style="padding:0">${esc(p.name)}</h3>
      <div style="color:var(--signal);font-size:16px; font-weight:700;">${fmtPts(s.total)} Pontos Totais</div></div></div>
    <div class="badge-row" style="margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap;">
        <span class="score-badge sb-5"></span> ${s.c5} Exatos
        <span class="score-badge sb-3" style="margin-left:8px"></span> ${s.c3} Empates
        <span class="score-badge sb-25" style="margin-left:8px"></span> ${s.c25} Vencedores
        <span class="score-badge sb-0" style="margin-left:8px"></span> ${s.c0} Erros
    </div>
    ${p.bio?`<p style="margin-bottom:16px; font-size:15px; color:var(--chalk); background:var(--panel-2); padding:12px; border-radius:8px;">${esc(p.bio)}</p>`:""}
    <div>${list}</div>`;
  openModal(); $("#m-x").onclick=()=>closeModal();
}

/* ---- Meus palpites ---- */
function renderMeus(){
  const p=me(); if(!p){ VIEW="ranking"; buildTabs(); render(); return; }
  const s=statsFor(p);
  const list=MATCHES.map(m=>{
    const pk=p.picks?.[m.id]; const has=!!(pk&&pk.home!=null);
    const fin=m.status==="FINISHED"&&m.homeScore!=null;
    const isLive=m.status==="IN_PLAY"&&m.homeScore!=null;
    const sc=effScore(pk,m);
    const tag=sc===null?`<span class="ptag pending">··</span>`:`<span class="ptag ${tagClass(sc)}${isLive?' parcial':''}">${fmtPts(sc)} pts</span>`;
    return `<div class="pick-line">
      <div class="pl-who"><span class="tn" style="font-size:15px; font-weight:600;"><img class="pl-flag" src="${esc(m.homeCrest||'')}" alt="" onerror="this.style.display='none'">${esc(m.home)} <span class="vs" style="font-size:14px">×</span> ${esc(m.away)}<img class="pl-flag" src="${esc(m.awayCrest||'')}" alt="" onerror="this.style.display='none'"></span>
        <span class="status" style="font-size:10px; padding:2px 6px;">${(fin||isLive)?m.homeScore+"–"+m.awayScore:"R"+m.round}</span></div>
      <div class="pl-right"><span class="pscore${has?'':' none'}">${has?`${pk.home} – ${pk.away}`:"—"}</span>${tag}</div></div>`;
  }).join("");
  $("#content").innerHTML=`
    <div class="board" style="margin-bottom:20px; background:linear-gradient(150deg,#16202F 0%,#0D1420 100%); border-color:rgba(191,242,52,.28); color:#EAF0F7;"><div class="row">
      <div class="who">${avatar(p, "av-white-border")}<div><div class="nm" style="color:white; font-size:20px;">${esc(p.name)}</div>
        <div style="font-size:14px; color:#9FB0C2; margin-top:4px;">${s.played} jogos palpitados</div></div></div>
      <div class="pts" style="color:var(--signal);">${fmtPts(s.total)}<small style="color:#9FB0C2;">pontos</small></div></div></div>
    ${list}`;
}
function fillKoEditor(){
  const host=$("#koEditor"), p=me(); if(!host||!p) return;
  host.innerHTML=koEditorHtml(p.ko||{}); bindKoEditor();
}
function openPickEditor(){
  const p=me(); if(!p) return;
  const rows=MATCHES.map(m=>{
    const pk=p.picks?.[m.id]||{}; const locked=m.status!=="TIMED"; 
    return `<div class="pe-row" data-mid="${esc(m.id)}">
      <span class="lbl">${esc(m.home)}</span>
      <div class="mid">
        <input class="fld scoreinput ph" type="number" min="0" inputmode="numeric" value="${pk.home??""}" placeholder="–" ${locked?"disabled":""}>
        <span class="vs" style="font-size:20px">×</span>
        <input class="fld scoreinput pa" type="number" min="0" inputmode="numeric" value="${pk.away??""}" placeholder="–" ${locked?"disabled":""}>
      </div>
      <span class="lbl away">${esc(m.away)}</span></div>`;
  }).join("");
  $("#modal").innerHTML=`<button class="x" id="m-x">✕</button>
    <h3>Seus Palpites</h3>
    <div style="display:flex;align-items:center;gap:16px;margin:16px 0 20px">
      ${avatar(p,"")}
      <div style="flex:1;min-width:0">
        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px; color:var(--muted);">Sua foto (escolha do celular/PC)</label>
        <input class="fld" id="m-photo-file" type="file" accept="image/*" style="width:100%; padding:8px; font-weight:400; font-size:14px;">
        <input type="hidden" id="m-photo-base64" value="${esc(p.photo||"")}">
        <img id="m-photo-preview" src="${esc(p.photo||"")}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; margin-top:8px; display:${p.photo ? 'block' : 'none'}; border:2px solid var(--line);">
      </div>
    </div>
    <p style="margin:12px 0 20px; font-size:14px; color:#FFD08A; background:rgba(255,180,60,.10); padding:12px; border-radius:10px; border:1px solid rgba(255,180,60,.30);">Atenção: Você só pode editar os jogos que ainda não começaram.</p>
    ${rows}
    <div class="modal-actions"><button class="btn ghost" id="m-cancel" style="border:2px solid var(--line);">Cancelar</button><button class="btn primary" id="m-ok">Salvar Palpites</button></div>`;
  openModal();
  $("#m-x").onclick=()=>closeModal(); $("#m-cancel").onclick=()=>closeModal();
  // Ouve a escolha do arquivo para gerar a prévia comprimida na hora
  const fileInput = $("#m-photo-file");
  if(fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if(file) {
        compressImage(file, (base64Str) => {
          $("#m-photo-base64").value = base64Str; // Guarda o texto base64
          $("#m-photo-preview").src = base64Str;  // Atualiza a prévia visual
          $("#m-photo-preview").style.display = "block";
        });
      }
    });
  }
  $("#m-ok").onclick=()=>{
    const picks={...(p.picks||{})};
    $$(".pe-row").forEach(row=>{
      const mid=row.dataset.mid, h=$(".ph",row).value, a=$(".pa",row).value;
      if($(".ph",row).disabled) return; 
      if(h!==""&&a!=="") picks[mid]={home:+h,away:+a}; else delete picks[mid];
    });
    p.picks=picks; p.photo = $("#m-photo-base64").value;
    PROFILES=PROFILES.map(x=>x.id===p.id?p:x);
    DIRTY=true; closeModal(); render(); save();
  };
}

/* ============================================================ MODAL */
function openModal(){ $("#scrim").classList.add("open"); document.body.style.overflow="hidden"; }
function closeModal(fromEntry){ if(ENTRY_LOCK&&!fromEntry) return; ENTRY_LOCK=false; $("#scrim").classList.remove("open"); $("#modal").innerHTML=""; document.body.style.overflow=""; }
$("#scrim").addEventListener("click",e=>{ if(e.target.id==="scrim") closeModal(); });

/* ============================================================ EVENTOS */
$("#switchBtn").onclick=()=>openEntry(false);
window.addEventListener("beforeunload",e=>{ if(DIRTY){ e.preventDefault(); e.returnValue=""; }});
// Auto-atualizacao. Com fonte na cloud (matchesUrl ou liveUrl, cacheada e barata) atualiza
// a cada 60s; sem ela, recarrega tudo a cada 5 min pra nao estourar a cota do JsonBin.
const FAST = !!(CONFIG.matchesUrl || CONFIG.liveUrl);
const REFRESH_MS = FAST ? 60*1000 : 5*60*1000;
let lastFull = Date.now();
setInterval(()=>{
  if(DIRTY) return;
  const jobs=[];
  if(CONFIG.matchesUrl){
    // O worker entrega tudo (calendario+placar+ao vivo) cacheado: recarrega a lista sempre.
    jobs.push(loadMatches());
    if(Date.now()-lastFull >= 5*60*1000){ lastFull=Date.now(); jobs.push(loadPredictions()); }
  }else if(CONFIG.liveUrl){
    if(Date.now()-lastFull >= 5*60*1000){ lastFull=Date.now(); jobs.push(loadMatches()); }
    jobs.push(loadLive());
  }else{
    if(Date.now()-lastFull >= 5*60*1000){ lastFull=Date.now(); jobs.push(loadMatches()); jobs.push(loadPredictions()); }
  }
  Promise.all(jobs).then(()=>{ applyLive(); if(!$("#scrim").classList.contains("open")) render(); }).catch(()=>{});
}, REFRESH_MS);

// Relogio ao vivo: atualiza só os minutos na tela (sem re-render) a cada 20s,
// pra estimativa "correr" suave entre os fetches de 60s.
setInterval(()=>{
  const els=$$(".js-livemin"); if(!els.length) return;
  for(const el of els){
    const m=MATCHES.find(x=>x.id===el.dataset.mid);
    const t=m?liveMinuteText(m):"";
    if(t && el.textContent!==t) el.textContent=t;
  }
}, 20*1000);

loadAll();
