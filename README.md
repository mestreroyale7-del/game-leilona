# Leilão Maluco

Jogo de leilão para jogar com amigos. Cada jogador recebe R$ 1.000 e monta o mesmo ambiente vazio
(praia, casa, bunker...) comprando 10 itens surpresa em leilão. A cada item arrematado, a imagem do
ambiente do jogador é refeita com o item. No fim, a IA dá prós e contras de cada ambiente.

## Como rodar

Precisa só de Node 20 ou mais novo. Não há dependências para instalar.

```bash
export GEMINI_API_KEY="sua_chave"
node server.js
# abra http://localhost:3000
```

A chave fica só no servidor e nunca vai para o navegador.

## Estrutura

```
server.js          servidor (salas, lances, tempo, chamadas ao Gemini)
public/index.html  o jogo (interface)
package.json
.env.example       lista das variáveis de ambiente
Dockerfile         imagem para hospedar
render.yaml        configuração pronta para a Render
```

## Variáveis de ambiente

| Variável | Para que serve | Padrão |
| --- | --- | --- |
| `GEMINI_API_KEY` | chave da API do Gemini (obrigatória) | vazio |
| `PORT` | porta do servidor | 3000 |
| `ACCESS_CODE` | se definido, só quem souber cria sala | desligado |
| `MAX_ROOMS` | salas abertas ao mesmo tempo | 5 |
| `MAX_GAMES_PER_DAY` | partidas por dia (trava de gasto) | 20 |
| `GEMINI_CONCURRENCY` | chamadas simultâneas à API | 3 |
| `GEMINI_IMAGE_MODEL` | modelo de imagem | `gemini-nano-banana-2.1` |
| `GEMINI_TEXT_MODEL` | modelo de texto (itens e avaliação) | `gemini-3.8-flash` |
| `TRUST_PROXY` | `0` se não houver proxy na frente | ligado |
| `MAX_SSE_PER_IP` | conexões abertas por IP | 24 |
| `GEMINI_API_BASE` | endereço base da API (precisa ser `v1beta`) | `https://generativelanguage.googleapis.com/v1beta` |
| `GEMINI_API_MODE` | `auto`, `interactions` ou `generatecontent` | `auto` |

Os modelos padrão existem na documentação do Google em outubro de 2026. Se um dia mudarem, troque pelas variáveis acima.

### Sobre a API do Gemini

Os modelos novos (como o `gemini-nano-banana-2.1`) só existem na versão `v1beta` da API. Com `v1` o Google
responde 404 ("models/... is not found for API version v1"). O servidor usa `v1beta` por padrão e, no modo `auto`,
tenta a Interactions API e cai no `generateContent` (ou o contrário) se um dos caminhos falhar.
Use `GEMINI_API_MODE` só se quiser forçar um deles.

## Como o jogo funciona

- Salas de até 8 jogadores, código de 4 letras.
- 10 itens por partida. Cada item abre com 25 s; cada lance novo garante pelo menos mais 10 s.
- Aumento mínimo de R$ 10. Se todos passarem, o item é vendido na hora.
- Quem entra depois do início só assiste.
- Salas e imagens ficam só na memória; reiniciar o servidor apaga tudo.

## Hospedagem

O jogo é um único processo Node que guarda as salas **na memória**. Por isso:

- rode **uma instância só** (não ligue escala automática com mais de 1 cópia);
- se o servidor reiniciar ou "dormir", as salas em andamento se perdem;
- o servidor precisa ficar ligado o tempo todo (nada de hospedagem estática ou "serverless").

Os arquivos `Dockerfile` e `render.yaml` já estão prontos.

### Opção 1: Render (mais simples)

1. Suba esta pasta para um repositório no GitHub (o `.gitignore` já protege o `.env`).
2. Na Render: **New > Blueprint**, escolha o repositório. Ela lê o `render.yaml`.
3. Quando pedir, cole `GEMINI_API_KEY` e escolha um `ACCESS_CODE` (só quem souber cria sala).
4. Abra o endereço `https://leilao-maluco.onrender.com` (o nome pode variar) e mande o link aos amigos.

No plano grátis o serviço dorme depois de um tempo sem uso e a primeira visita demora cerca de um minuto.
Para jogar sem susto, troque `plan: free` por `plan: starter` no `render.yaml`.

### Opção 2: Railway, Fly.io ou qualquer lugar com Docker

Aponte para esta pasta (eles detectam o `Dockerfile`), defina as variáveis de ambiente da tabela acima
e exponha a porta `3000` (ou a que a plataforma passar em `PORT`). Health check: `GET /healthz`.

### Opção 3: VPS própria

```bash
git clone <seu-repo> && cd leilao-maluco
cp .env.example .env     # preencha GEMINI_API_KEY e ACCESS_CODE
node server.js           # ou use pm2/systemd para manter ligado
```

Coloque um proxy com HTTPS na frente (Caddy ou nginx). No nginx, desligue o buffer para a rota
`/api/events` (`proxy_buffering off;`), senão a tela atualiza com atraso.

### Controle de gasto

Cada partida faz 1 foto do ambiente vazio, 1 chamada de texto para os itens, 1 refação de imagem por item
comprado e 1 avaliação por jogador. Com 8 jogadores comprando tudo, são perto de 90 imagens. Por isso:

- defina `ACCESS_CODE` para que desconhecidos não criem salas;
- mantenha `MAX_GAMES_PER_DAY` baixo (padrão 20) e `MAX_ROOMS` baixo (padrão 5);
- configure também um limite de gasto no painel da sua conta do Google AI.

### Segurança embutida

Cabeçalhos de segurança (CSP, anti-iframe), limite de requisições por IP, limite de criação de salas,
proteção contra adivinhar códigos de sala, limite de conexões abertas por IP, comparação segura do código
de acesso e encerramento limpo com `SIGTERM`. Se o servidor **não** estiver atrás de proxy, defina
`TRUST_PROXY=0` para não confiar no cabeçalho `X-Forwarded-For`.
