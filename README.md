# Bolão da Copa 2026 ⚽

Site estático (estilo GitHub Pages) com vários palpiteiros, identidade por perfil e um
**ranking que se atualiza sozinho** de hora em hora puxando os placares reais.

**Pontuação**

| Acerto | Pontos |
|---|---|
| Placar exato | **5** |
| Empate certo (placar diferente) | **3** |
| Acertou só o vencedor | **2,5** |
| Errou | **0** |

A conta é feita no navegador, ao vivo, cruzando os placares reais com os palpites.

---

## Objetivo do projeto

Um site **estático** (hospedável no GitHub Pages, sem servidor) para um **bolão da fase de
grupos da Copa do Mundo 2026** entre amigos. Cada participante tem um perfil com seus
palpites de placar para os jogos. O site:

- guarda os **palpites de cada pessoa** para cada jogo;
- **puxa os placares reais sozinho, de hora em hora**, e recalcula tudo;
- mostra **quantos pontos** cada um fez e monta o **ranking** automaticamente.

A ideia é não precisar atualizar nada na mão durante a Copa: você cadastra os palpites uma
vez e o site cuida de buscar resultados e ranquear.

## O que foi pedido (a "lista de desejos")

- [x] Site estático, estilo GitHub Pages.
- [x] Vários perfis com previsões para os jogos da fase de grupos.
- [x] Cálculo automático do score de cada pessoa e ranking de pontos.
- [x] Pontuação: **5** placar exato · **3** empate certo (placar diferente) · **2,5** só o vencedor.
- [x] Palpites e dados do perfil **editáveis** (e a opção de usar **JsonBin**, como você já fazia).
- [x] **Foto** por perfil — feita do jeito simples, via URL de imagem (sem upload de arquivo).
- [x] **Atualização a cada hora**: um robô (GitHub Actions) busca os placares e recalcula o ranking.
- [x] **Janela de entrada**: escolher um perfil **ou** entrar como visitante (sem cadastro de perfil pelo site).
- [x] **Logado como perfil**: vê os próprios palpites e ganha **destaque no ranking**.
- [x] **Aba Palpiteiros**: lista todo mundo; clicar num perfil mostra os palpites dele nos jogos.
- [x] **Jogos clicáveis**: abrem com os dois times no topo e a lista de palpites de todos; se o
      jogo já passou, fica **ordenado por quem acertou melhor**.
- [x] **Ranking filtrável por rodada**: Rodada 1, 2, 3 ou Total da fase de grupos.
- [x] **10 perfis** fixos por enquanto: Amanda, Tiago, Ednelson, Duda, Leny, Mah, João, Thaísa, Bela, Mateus
      (os palpites de cada um entram depois).

Ideia em aberto que ainda não foi ligada: **esconder o palpite dos outros até o jogo
começar** (útil se cada um for cadastrar o próprio palpite, pra ninguém copiar).

## Como funciona por baixo

- Tudo é **calculado no navegador**: ele carrega os placares (`data/matches.json`) e os
  palpites (`data/predictions.json` ou um bin do JsonBin) e cruza os dois pra gerar pontos
  e ranking — não há "servidor" calculando nada.
- O **robô de hora em hora** é uma GitHub Action que roda `scripts/update-results.mjs`,
  busca os jogos na API gratuita football-data.org, escreve o `matches.json` atualizado e
  faz commit. Como o GitHub Pages serve o repositório, o site passa a mostrar os novos
  placares — e o ranking se ajusta sozinho.
- A **identidade** (qual perfil você é, ou visitante) fica salva no seu próprio navegador;
  não é login com senha, é só pra personalizar a visão e o destaque.

---

## Como o site funciona

- **Ao abrir**, aparece a janela **"Quem é você?"** — escolha um dos perfis ou entre como
  **visitante**. A escolha fica salva no navegador; o botão **Trocar** (no topo) reabre a janela.
- **Entrando como um perfil:** ganha a aba **Meus palpites** (ver e editar os seus) e seu
  nome ganha **destaque no ranking**.
- **Ranking:** filtro por **Rodada 1 / 2 / 3 / Total da fase de grupos**.
- **Jogos:** agrupados por rodada; **cada jogo é clicável** e abre os dois times com a
  lista de palpites de todos. Se o jogo já acabou, a lista vem **ordenada por quem acertou
  melhor**.
- **Palpiteiros:** lista todo mundo; **clique em qualquer um** para ver os palpites dele
  em todos os jogos.

Os perfis são fixos (definidos no `data/predictions.json`) — não há cadastro pelo site.

---

## Estrutura

```
index.html                           → o site inteiro (HTML + CSS + JS)
data/matches.json                    → jogos, rodada e placares (atualizado pela Action)
data/predictions.json                → perfis e palpites
scripts/update-results.mjs           → busca placares na API
.github/workflows/update-results.yml → roda o script de hora em hora
```

---

## 1. Publicar no GitHub Pages

1. Suba estes arquivos num repositório.
2. **Settings → Pages → Source: Deploy from a branch**, escolha `main` e pasta `/ (root)`.
3. Pronto — já funciona com os dados de exemplo.

## 2. Atualização automática dos placares

Fonte: [football-data.org](https://www.football-data.org/) (plano **gratuito**, inclui a
Copa do Mundo, código `WC`).

1. Crie a conta grátis e copie o **API token**.
2. **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FOOTBALL_DATA_TOKEN` · Value: *(seu token)*
3. **Settings → Actions → General → Workflow permissions → Read and write permissions**.
4. A Action roda de hora em hora. Pra testar agora: **Actions → Atualizar placares → Run workflow**.

A primeira execução troca o `matches.json` de exemplo pela lista completa dos 72 jogos de
grupo (com nomes, escudos e a rodada de cada um).

Rodar localmente:
```bash
FOOTBALL_DATA_TOKEN=seu_token node scripts/update-results.mjs
```

---

## 3. Os palpites de cada pessoa

Cada perfil tem um objeto `picks` no `data/predictions.json`. A chave é o **id do jogo**
(o mesmo `id` que está no `matches.json`) e o valor é o placar previsto:

```json
{
  "id": "amanda", "name": "Amanda", "photo": "", "bio": "",
  "picks": {
    "wc-001": { "home": 2, "away": 1 },
    "wc-005": { "home": 0, "away": 0 }
  }
}
```

Duas formas de preencher:

**Modo A — arquivo no repositório (padrão).** Edite o `predictions.json` e dê commit.
A pessoa logada também pode usar **Meus palpites → Editar meus palpites**; ao salvar, o
site baixa um `predictions.json` atualizado pra você commitar. (Só dá pra editar jogos que
ainda não começaram.)

**Modo B — JsonBin (ao vivo, sem commit).** No topo do `<script>` em `index.html`:
```js
const CONFIG = { jsonbin: { enabled:true, binId:"SEU_BIN_ID", accessKey:"CHAVE_DE_LEITURA" } };
```
Coloque o conteúdo do `predictions.json` num bin. Em **Meus palpites → Editar**, ao salvar
o site pede a **chave de escrita** uma vez (fica só na aba) e grava direto no bin — assim
cada pessoa entra como ela mesma e preenche os próprios palpites, sem commit.

> ⚠️ Em site estático, qualquer chave embutida no `index.html` fica visível no código. Por
> isso só a de **leitura** vai no arquivo; a de **escrita** é digitada na hora. Pra um
> bolão entre amigos costuma bastar. Se quiser controle real de quem edita, use o Modo A.

### Foto
A foto é só uma **URL de imagem** no campo `photo` (`https://…`) — funciona inclusive no
JsonBin por ser texto, sem upload de arquivo. Em branco, mostra a inicial do nome.

---

## A regra de pontuação (exata)

```
placar exato        → 5     (palpite 2–0, resultado 2–0)
empate certo        → 3     (palpite 1–1, resultado 2–2)
acertou o vencedor  → 2,5   (palpite 2–0, resultado 3–1)
errou               → 0
jogo não terminou   → não pontua ainda
```

Empate só pontua se o resultado real também foi empate; "vencedor" exige o lado certo
(casa/fora) vencendo. Desempate no ranking: mais placares exatos, depois mais empates certos.

## Personalizar
- Cores e fontes: bloco `:root`/`<style>` no `index.html`.
- Frequência do auto-update: `cron` em `.github/workflows/update-results.yml`.
- O site também rebusca os placares a cada 5 min com a aba aberta.