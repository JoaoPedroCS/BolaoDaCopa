# Próximos passos — Bolão da Copa 2026

> Roteiro do que vem **depois** da versão atual (tema dark "MATCHDAY", aba Mata-mata de visualização com zoom/arrasto, e palpites de mata-mata dentro de "Meus Palpites").
> Nada aqui está implementado ainda — é planejamento.

## Estado atual (de onde partimos)

- Abas únicas pra tudo: **Ranking · Jogos · Tabela · Mata-mata · Palpiteiros · Meus Palpites**.
- O mata-mata **compartilha** a estrutura da fase de grupos: ranking e pontuação saem só dos jogos de grupo; a aba Mata-mata é só visualização (bracket projetado) e os palpites de KO ficam dentro de "Meus Palpites".
- Dados dos palpiteiros no **JsonBin** (`profiles[].picks` = grupos, `profiles[].ko` = mata-mata). Jogos vêm do **worker da Cloudflare**. Anexo C (chaveamento dos 8 melhores 3º) em `data/r32-thirds.json`.

---

## 1. Separar o mata-mata num módulo próprio (Playoffs)

Transformar o mata-mata num "mundo paralelo" à fase de grupos, com tudo dele independente:

- **Palpites próprios** — editor de KO separado dos palpites de grupo (a base já existe em `profile.ko`).
- **Ranking próprio** — leaderboard só do mata-mata, independente do ranking de grupos.
- **Partidas próprias** — lista dos jogos de playoff (16-avos → final), separada da aba Jogos dos grupos.
- **Regras de pontuação próprias** — definir como o KO pontua (ex.: acertar quem avança, placar exato, acertar os pênaltis). Hoje o KO **não** pontua.
- **Tabela própria** = o bracket de playoffs (a aba Mata-mata atual vira a "tabela" desse módulo).

**Sugestão de implementação**

- Um seletor no topo **"Fase de Grupos | Playoffs"** que troca todo o conjunto de abas, **ou** uma página separada (`playoffs.html`) espelhando a estrutura do `index.html`.
- Dados: guardar os resultados reais do KO nos jogos 73–104 (quando existirem); criar uma `scoreKnockout()` própria; ranking de KO calculado de `profile.ko` × resultados reais.

---

## 2. Filtro de fase inteligente na aba Partidas — ✅ FEITO (grupos)

- A aba de partidas **abre já no filtro da fase que ainda tem jogos**.
- Ex.: se a Rodada 1 dos grupos já foi toda jogada, o filtro abre direto na **Rodada 2**.
- **Lógica**: achar a menor rodada/fase com pelo menos um jogo `≠ FINISHED` e deixar como filtro padrão (mantendo a troca manual pelo usuário).
- **Implementação atual**: helper `firstPendingRound()` (genérico) + flag `JOGOS_ROUND_AUTO` — segue a fase pendente sozinho até o usuário clicar num filtro.
- **Falta**: reaproveitar o mesmo `firstPendingRound()` na futura página de playoffs (**16-avos → oitavas → quartas → semis → final**) quando ela existir (item 1).

---

## 3. Congelar jogos passados no carregamento — ✅ FEITO

- **Objetivo**: assim que um jogo fica `FINISHED`, congelar (não sobrescrever nas próximas buscas). Só jogos **ao vivo e futuros** continuam atualizando — assim um jogo que já aconteceu nunca mais "zera".
- **Implementação atual** (`loadMatches`):
  - `isFinal(m)` = `FINISHED` com placar válido. Os finalizados que já temos são guardados num mapa e **mantidos como estão** no merge com a busca nova.
  - Só os **não-finalizados** recebem o que vem do worker.
  - Um finalizado que **sumir** da resposta continua na lista.
  - **Proteção extra**: se a busca voltar **vazia**, a lista atual é mantida (não apaga nada num soluço da fonte).
- **Benefícios**: acaba o "tudo zerado por um tempo", menos reprocessamento/piscadas, menos carga no worker.
- Obs.: uma eventual **correção** de placar de um jogo já encerrado só entra ao **recarregar a página** (no reload a lista começa vazia e pega tudo de novo). Comportamento aceitável.

---

## 4. Otimizar o worker (response time) — ✅ FEITO (`worker.js`)

- **Stale-while-revalidate**: toda requisição responde na hora pelo cache; quando vence (`FRESH_TTL=30s`), 1 request revalida em segundo plano (`ctx.waitUntil`) — ninguém espera a API. "Claim" anti-rajada limita as chamadas.
- **Busca leve por janela** (`dateFrom`/`dateTo`, ontem → +3 dias): depois do 1º build completo, só consulta a API na janela próxima. Ignora jogos da semana que vem e congela os antigos (ficam fora da janela), mas ainda captura jogo recém-encerrado.
- **Congelar finalizados** no servidor: `FINISHED` com placar nunca é sobrescrito.
- **Servir o último bom**: API falhou/voltou vazia → devolve o cache anterior; nunca retorna `matches: []` (acaba o "tudo zerado").
- **Decisão**: não usei KV (latência extra + bind novo) — o Cache API resolve o "último bom" e é mais rápido.
- **Deploy**: colar `worker.js` no editor do Worker (ou `wrangler deploy`). Variáveis **inalteradas** (`FOOTBALL_DATA_TOKEN`, `MATCHES_URL`). Tunáveis no topo do arquivo.
- ⚠️ Como finalizados ficam congelados no cache, uma **correção** de placar já encerrado só aparece quando o cache do edge expira/é purgado (ou redeploy).

## Pontos de atenção

- `data/r32-thirds.json` (Anexo C) precisa continuar indo no deploy junto com o `index.html`.
- Definir as **regras de pontuação do KO** antes de construir o ranking de playoffs.
- Manter o JsonBin como fonte única dos palpites (schema compartilhado entre grupos e KO).
