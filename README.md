# Bolão da Copa 2026

Site **estático** (sem backend próprio) que gerencia um bolão da Copa do Mundo 2026 entre
amigos: cada palpiteiro tem um perfil com seus palpites, o site **busca os placares reais
sozinho** e **recalcula o ranking ao vivo no navegador** — tanto na fase de grupos quanto no
mata-mata.

> **Projeto de portfólio.** Os dados de demonstração usam **apelidos genéricos**
> (ex.: "Zebra Sonolenta", "Tatu Furioso") e **nenhuma foto**. Nomes, fotos e palpites reais
> dos participantes não fazem parte deste repositório.

**Stack:** HTML + CSS + JavaScript puro (sem framework, sem build) · Cloudflare Worker como
proxy/cache da API de jogos · football-data.org · JsonBin (opcional) para guardar palpites ·
Chart.js na página de evolução · GitHub Pages para hospedar.

---

## O que o site faz

Um seletor no topo alterna entre dois modos:

- **Grupos** (fase encerrada) — Ranking, Jogos, Tabela, Palpiteiros, Meus Palpites.
- **Mata-mata** — Ranking, Partidas, Chaveamento, Palpiteiros, Meus Palpites.

Há ainda a página **`evolucao.html`**, com um gráfico dos pontos acumulados de cada pessoa ao
longo dos jogos.

### Abas

**Grupos**
- **Ranking:** filtro por Rodada 1 / 2 / 3 / Total.
- **Jogos:** agrupados por rodada; cada jogo abre a lista de palpites de todos (ordenada por
  quem acertou melhor, quando encerrado).
- **Tabela:** classificação de cada grupo, com os 2 primeiros em verde.
- **Palpiteiros:** lista todo mundo; clique para ver os palpites da pessoa.

**Mata-mata**
- **Ranking:** pontos do mata-mata e campeão escolhido por cada um.
- **Partidas:** jogos em ordem de data/hora, filtro "Jogo atual", vencedor em destaque e
  placar de pênaltis quando houver. Cada card abre os palpites de todos.
- **Chaveamento:** bracket completo até a final, com zoom/arrasto; os times avançam
  conforme os resultados reais.
- **Meus Palpites:** editor do mata-mata (ver regras abaixo).

Os perfis são fixos — não há cadastro pelo site. A "identidade" (qual perfil você é, ou
visitante) fica salva no `localStorage` do navegador; **não é login com senha**, serve só para
personalizar a visão e o destaque.

---

## Pontuação

### Fase de grupos

| Acerto | Pontos |
|---|---|
| Placar exato | **5** |
| Empate certo (placar diferente) | **3** |
| Acertou só o vencedor | **2,5** |
| Errou | **0** |

```
placar exato        → 5     (palpite 2–0, resultado 2–0)
empate certo        → 3     (palpite 1–1, resultado 2–2)
acertou o vencedor  → 2,5   (palpite 2–0, resultado 3–1)
errou               → 0
jogo não terminou   → não pontua ainda
```

Empate só pontua se o resultado real também foi empate; "vencedor" exige o lado certo
(casa/fora) vencendo. Desempate: mais placares exatos, depois mais empates certos.

### Mata-mata

- **16-avos** (crava o placar dos 90 min): exato **5** · empate **3** · só o vencedor
  **2,5** · **+5** de bônus se acertar quem se classifica.
- **Demais fases** (só escolhe quem avança): oitavas **10** · quartas **20** · semifinal
  **40** · 3º lugar **60** · final **80**.

---

## Como funciona por baixo

- **Tudo é calculado no navegador.** O site carrega jogos e palpites e cruza os dois para
  gerar pontos, ranking e chaveamento.
- **Jogos:** um **Cloudflare Worker** consulta a football-data.org, junta fase de grupos +
  mata-mata + placar ao vivo numa única resposta JSON em cache, e o site lê dali
  (`CONFIG.matchesUrl` em `assets/app.js`). Com a aba aberta, rebusca a cada 60 s.
- **`data/matches.json`** é a **semente**: os 72 jogos de grupo com ids estáveis
  (`wc-001`…`wc-072`). É o fallback quando o Worker não está configurado.
- **Palpites:** vêm de um arquivo `predictions.json` **ou** de um bin do JsonBin, sempre por
  uma rota do Worker (`/palpites`) que guarda a chave — o navegador nunca vê a chave (ver abaixo).
- Jogos **finalizados são congelados** (o placar não "zera" por um soluço da fonte), mas o app
  ainda adota dados tardios, como pênaltis e quem avançou.

---

## Estrutura

```
index.html                           → casca do site
evolucao.html                        → gráfico de evolução dos pontos
assets/app.js                        → toda a lógica (grupos + mata-mata)
assets/styles.css                    → estilos
data/matches.json                    → semente dos 72 jogos de grupo
data/r32-thirds.json                 → Anexo C da FIFA (alocação dos 8 melhores 3º lugares)
scripts/update-results.mjs           → regenera o matches.json a partir da football-data.org
.github/workflows/update-results.yml → botão manual que roda o script acima
predictions.json                     → (não versionado) perfis e palpites
worker.js                            → (não versionado) Cloudflare Worker dos jogos + rota /palpites
worker/palpites-worker.js            → mesmo proxy de palpites, versão standalone (referência)
worker/wrangler.toml                 → config de deploy da versão standalone (sem segredos)
```

`predictions.json` e `worker.js` estão no `.gitignore` de propósito: o primeiro é o estado
ao vivo do bolão e o segundo contém a configuração privada do Worker.

---

## Formato dos palpites

Cada perfil:

- **`picks`** — fase de grupos. Chave = id do jogo (`wc-001`…), valor = placar previsto.
- **`ko`** — mata-mata. Chave = id do jogo (73–104). Nos 16-avos: `{ "h": 2, "a": 1 }`
  (mais `"adv": "home"|"away"` se cravar empate, para dizer quem passa nos pênaltis); nas
  fases seguintes só `{ "adv": "home"|"away" }`.

```json
{
  "id": "zebra-sonolenta", "name": "Zebra Sonolenta", "photo": "", "bio": "",
  "picks": { "wc-001": { "home": 2, "away": 1 } },
  "ko":    { "73": { "h": 1, "a": 1, "adv": "away" }, "89": { "adv": "home" } }
}
```

`photo` pode ser uma URL ou uma imagem em base64 (o site comprime uploads para 128 px). Em
branco, mostra a inicial do nome.

### Onde ficam os palpites

**Modo A — arquivo.** Com `CONFIG.palpitesUrl` vazio, o site lê `data/predictions.json`.
Ao salvar em "Meus Palpites", baixa um JSON atualizado para você commitar.

**Modo B — JsonBin via Worker (recomendado).** Com `CONFIG.palpitesUrl` apontando para a rota
`/palpites` do Worker, o site lê e grava os palpites por ele, sem commit. A chave do JsonBin
fica **só como secret do Worker** — nunca no código do site (chave embutida em site estático é
pública, e uma com permissão de escrita deixa qualquer um apagar o bolão).

A rota `/palpites` (código em `worker/palpites-worker.js`):
- `GET` devolve o registro do bin; `PUT` valida e grava.
- Só aceita gravação de `https://joaopedrocs.github.io` (e `localhost` p/ desenvolvimento).
- Valida formato e tamanho, **não deixa criar/apagar/renomear perfis** e preserva o bloco `live`.

**Configurar:**
1. No JsonBin, crie uma Access Key com Read + Update **só neste bin** (e apague chaves antigas).
2. No painel da Cloudflare, no Worker dos jogos: cole o código com a rota `/palpites` e deploy.
3. *Settings → Variables and Secrets*: **Secret** `JSONBIN_KEY` (a chave) e textos
   `JSONBIN_BIN_ID` e `ALLOWED_ORIGINS` (`https://joaopedrocs.github.io`).
4. Teste abrindo `https://SEU-WORKER.workers.dev/palpites` — deve mostrar os perfis em JSON.

> ⚠️ **Limites.** Isso protege a *sua chave*, mas os perfis não têm login: quem montar um `PUT`
> válido (ex.: `curl`, que ignora a checagem de origem) ainda consegue editar palpites. Para
> proteção real, adicione um PIN por perfil validado no Worker. Mantenha versionamento do bin
> ou backup periódico.

---

## Rodando e publicando

**Localmente** (precisa de um servidor estático por causa dos `fetch`):
```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

**GitHub Pages:** *Settings → Pages → Deploy from a branch → `main` / root*.

> **Cache:** `index.html` carrega os assets com `?v=...`. Ao alterar `app.js` ou
> `styles.css`, incremente esse número.

**Atualizar a semente de jogos** (opcional; precisa de token grátis da
[football-data.org](https://www.football-data.org/)):
```bash
FOOTBALL_DATA_TOKEN=seu_token node scripts/update-results.mjs
```
Ou use *Actions → Atualizar semente → Run workflow* (com o secret `FOOTBALL_DATA_TOKEN`).

---

## Personalizar

- Cores e fontes: bloco `:root` em `assets/styles.css`.
- Fonte dos jogos: `CONFIG.matchesUrl` em `assets/app.js` (vazio usa o `matches.json` local).
- Origem dos palpites: `CONFIG.palpitesUrl` em `assets/app.js` (e também em `evolucao.html`); vazio usa `data/predictions.json`.
