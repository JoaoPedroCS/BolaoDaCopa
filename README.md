# Bolão da Copa 2026 

Site **estático** (estilo GitHub Pages, sem servidor) para um bolão entre amigos da Copa do
Mundo 2026. Cada palpiteiro tem um perfil com seus palpites; o site **puxa os placares reais
sozinho** e recalcula o ranking ao vivo no navegador — tanto na **fase de grupos** quanto no
**mata-mata**.

Toda a conta é feita no navegador, cruzando os placares reais (vindos de um Worker da
Cloudflare que consulta a football-data.org) com os palpites de cada um.

---

## Dois modos

O seletor no topo alterna entre os dois conjuntos de abas:

- **Grupos** (fase encerrada) — Ranking, Jogos, Tabela, Palpiteiros, Meus Palpites.
- **Playoffs / Mata-mata** — Ranking, Partidas, Chaveamento, Palpiteiros, Meus Palpites.

### Pontuação — fase de grupos

| Acerto | Pontos |
|---|---|
| Placar exato | **5** |
| Empate certo (placar diferente) | **3** |
| Acertou só o vencedor | **2,5** |
| Errou | **0** |

### Pontuação — mata-mata

- **16-avos** (crava o placar): placar exato **5** · empate de 90min **3** · só o vencedor
  **2,5** · **+5** de bônus se acertar quem se classifica.
- **Demais fases** (só escolhe quem avança): oitavas **10** · quartas **20** · semifinal
  **40** · 3º lugar **60** · final **80**.

---

## Como funciona por baixo

- **Tudo é calculado no navegador.** Ele carrega os jogos e os palpites e cruza os dois pra
  gerar pontos, ranking e chaveamento — não há servidor calculando nada.
- **Fonte dos jogos: um Worker da Cloudflare** (`worker.js`). Ele consulta a
  football-data.org, junta **fase de grupos + mata-mata + placar ao vivo** numa única
  resposta JSON cacheada e barata, e o site lê tudo de lá (`CONFIG.matchesUrl` no
  `assets/app.js`). Com a aba aberta, o site rebusca a cada **60s**.
- O **`data/matches.json`** funciona como **semente** (os 72 jogos de grupo com ids estáveis
  `wc-001`…`wc-072`) usada pelo Worker e como fallback se o Worker não estiver configurado.
- A **identidade** (qual perfil você é, ou visitante) fica salva no seu próprio navegador;
  não é login com senha, é só pra personalizar a visão e o destaque.
- Jogos **finalizados são congelados** (o placar não “zera” num soluço da fonte), mas o app
  ainda adota dados que cheguem depois, como **placar de pênaltis** e quem avançou.

---

## O site, aba por aba

**Grupos**

- **Ranking:** filtro por Rodada 1 / 2 / 3 / Total da fase de grupos.
- **Jogos:** agrupados por rodada; cada jogo é **clicável** e abre os dois times com a lista
  de palpites de todos. Encerrado, a lista vem ordenada por quem acertou melhor.
- **Tabela:** classificação de cada grupo (só jogos encerrados), 2 primeiros em verde.
- **Palpiteiros:** lista todo mundo; clique para ver os palpites da pessoa.

**Mata-mata**

- **Ranking:** pontos do mata-mata e campeão cravado por cada um.
- **Partidas:** jogos **em ordem de data e hora**, com filtro **“Jogo atual”** (fixa o jogo
  atual no topo, sem trocar a fase selecionada). Jogos encerrados mostram o **vencedor em
  destaque** (🏆) e, quando houver, o **placar de pênaltis** menor abaixo do placar normal.
  Cada card é **clicável** e abre os palpites de todos, ordenados da maior vitória do
  mandante até a maior derrota (empates em ordem alfabética).
- **Chaveamento:** bracket completo dos dois lados até a final, com zoom/arrasto; os times
  avançam conforme os resultados reais e o vencedor de cada confronto fica destacado.
- **Meus Palpites:** editor do mata-mata. Nos 16-avos você crava o placar (e, se cravar
  empate, marca quem passa nos pênaltis); nas demais fases é só **marcar o X** no time que
  avança.

Os perfis são fixos (definidos em `data/predictions.json`/JsonBin) — não há cadastro pelo
site.

---

## Estrutura

```
index.html                           → casca do site (carrega CSS/JS com cache-bust ?v=)
evolucao.html                        → página de evolução do ranking
assets/app.js                        → toda a lógica (grupos + mata-mata)
assets/styles.css                    → estilos
worker.js                            → Cloudflare Worker: fonte única dos jogos (grupos+KO+live)
data/matches.json                    → semente dos 72 jogos de grupo (ids estáveis)
data/predictions.json                → perfis e palpites (grupos em `picks`, mata-mata em `ko`)
data/r32-thirds.json                 → Anexo C da FIFA (alocação dos 8 melhores 3º lugares)
scripts/update-results.mjs           → script que atualiza o matches.json (fase de grupos)
.github/workflows/update-results.yml → agenda o script
```

---

## 1. Publicar no GitHub Pages

1. Suba os arquivos num repositório.
2. **Settings → Pages → Source: Deploy from a branch**, escolha `main` e pasta `/ (root)`.
3. Pronto — já funciona com os dados de exemplo/semente.

> **Cache:** o `index.html` carrega os assets com `?v=...` (ex.: `assets/app.js?v=20260630b`).
> Ao publicar uma mudança em `app.js` ou `styles.css`, **incremente esse número** pra forçar
> os navegadores a baixarem a versão nova.

## 2. O Worker da Cloudflare (fonte dos jogos)

O `worker.js` é o que entrega o JSON com **todos** os jogos (grupos + mata-mata + ao vivo).
A URL dele fica em `CONFIG.matchesUrl` (em `assets/app.js`).

- Variáveis do Worker: `FOOTBALL_DATA_TOKEN` (secret, token da football-data.org) e
  `MATCHES_URL` (texto, URL do `matches.json` publicado, usado como semente).
- O **`KO_ID_MAP`** no topo do `worker.js` mapeia o id de cada jogo do mata-mata na
  football-data.org para o id fixo do app (73–104). É o que liga os resultados reais do
  mata-mata ao chaveamento.
- O Worker já trata **pênaltis** (`score.penalties` → `penHome`/`penAway`) e quem avançou
  (`koWinner`), além de congelar jogos finalizados e usar cache adaptativo (mais rápido com
  jogo ao vivo, mais lento ocioso).
- **Ao publicar uma mudança no `worker.js`, faça o deploy dele de novo na Cloudflare.**

## 3. Atualização da fase de grupos (alternativa via GitHub Action)

Fonte: [football-data.org](https://www.football-data.org/) (plano gratuito, código `WC`).

1. Crie a conta grátis e copie o **API token**.
2. **Settings → Secrets and variables → Actions → New repository secret** —
   Name: `FOOTBALL_DATA_TOKEN` · Value: *(seu token)*.
3. **Settings → Actions → General → Workflow permissions → Read and write permissions**.
4. Pra testar: **Actions → Atualizar placares → Run workflow**.

Rodar localmente:
```bash
FOOTBALL_DATA_TOKEN=seu_token node scripts/update-results.mjs
```

---

## 4. Os palpites de cada pessoa

Cada perfil tem, em `data/predictions.json`:

- **`picks`** — palpites da **fase de grupos**. Chave = id do jogo (`wc-001`…), valor =
  placar previsto.
- **`ko`** — palpites do **mata-mata**. Chave = id do jogo (73–104). Nos 16-avos o valor é
  `{ "h": 2, "a": 1 }` (e `"adv": "home"|"away"` se cravar empate, pra dizer quem passa nos
  pênaltis); nas fases seguintes é só `{ "adv": "home"|"away" }`.

```json
{
  "id": "amanda", "name": "Amanda", "photo": "", "bio": "",
  "picks": { "wc-001": { "home": 2, "away": 1 } },
  "ko":    { "73": { "h": 1, "a": 1, "adv": "away" }, "89": { "adv": "home" } }
}
```

Duas formas de preencher:

**Modo A — arquivo no repositório.** Edite o `predictions.json` e dê commit. A pessoa logada
também pode usar **Meus Palpites**; ao salvar, o site baixa um `predictions.json` atualizado
pra você commitar.

**Modo B — JsonBin (ao vivo, sem commit).** Em `assets/app.js`:
```js
const CONFIG = { jsonbin: { enabled:true, binId:"SEU_BIN_ID", accessKey:"CHAVE_DE_LEITURA" } };
```
Em **Meus Palpites → Salvar**, o site grava direto no bin — cada pessoa entra como ela mesma
e preenche os próprios palpites, sem commit.

> ⚠️ Em site estático, qualquer chave embutida no código fica visível. Por isso só a de
> **leitura** vai no arquivo; a de **escrita** é digitada na hora. Pra um bolão entre amigos
> costuma bastar.

### Foto
A foto pode ser uma **URL de imagem** ou um upload pequeno (o site comprime para um quadrado
de 128px em base64). Em branco, mostra a inicial do nome.

---

## A regra de pontuação dos grupos (exata)

```
placar exato        → 5     (palpite 2–0, resultado 2–0)
empate certo        → 3     (palpite 1–1, resultado 2–2)
acertou o vencedor  → 2,5   (palpite 2–0, resultado 3–1)
errou               → 0
jogo não terminou   → não pontua ainda
```

Empate só pontua se o resultado real também foi empate; "vencedor" exige o lado certo
(casa/fora) vencendo. Desempate no ranking: mais placares exatos, depois mais empates certos.

---

## Personalizar
- Cores e fontes: bloco `:root` em `assets/styles.css`.
- Fonte dos jogos: `CONFIG.matchesUrl` em `assets/app.js` (Worker) — vazio usa o `matches.json` local.
- Com a aba aberta, o site rebusca os jogos a cada 60s (com Worker) e os palpites a cada 5 min.
- Ao mexer em `app.js`/`styles.css`, lembre de subir o `?v=` no `index.html`.
