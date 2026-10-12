'use strict';
/*
 * Leilão Maluco: servidor do jogo.
 * Sem dependências: precisa só de Node 20+.
 * O servidor guarda o estado de cada sala em memória, controla lances e tempo,
 * e fala com a API do Gemini (Nano Banana para imagens, modelo de texto para itens e avaliação).
 * A chave da API fica só aqui, nunca vai para o navegador.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- .env opcional (sem dependências) ---------- */
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !m[1].startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch (e) { /* sem .env, segue com o ambiente */ }

/* ---------- configuração (variáveis de ambiente) ---------- */
const PORT = Number(process.env.PORT) || 3000;
const KEY = process.env.GEMINI_API_KEY || '';
const API = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const IMG_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1';
const TXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
const ACCESS = process.env.ACCESS_CODE || '';              // se definido, só quem souber cria sala
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 5;       // salas ao mesmo tempo
const MAX_GAMES_PER_DAY = Number(process.env.MAX_GAMES_PER_DAY) || 20; // trava de gasto
const API_MODE = (process.env.GEMINI_API_MODE || 'auto').toLowerCase(); // auto | interactions | generatecontent
const IMG_CONCURRENCY = Number(process.env.GEMINI_CONCURRENCY) || 3;

const TRUST_PROXY = process.env.TRUST_PROXY !== '0';        // atrás de proxy (Render, Railway, Fly...) usa X-Forwarded-For
const MAX_SSE_PER_IP = Number(process.env.MAX_SSE_PER_IP) || 24;

const START_MONEY = 1000, N_ITEMS = 10, OPEN_MS = 25000, EXT_MS = 10000, GAP_MS = 6000, INC = 10, MAX_PL = 8;

const ENVS = [
  { n: 'Praia deserta', e: '🏖️', t: 'sobrevivência e luxo', d: 'uma faixa de areia vazia, mar calmo e céu aberto', en: 'a wide, empty tropical beach with soft sand, calm turquoise sea and a few clouds, nothing built, no objects, no people' },
  { n: 'Quintal de casa', e: '🏡', t: 'luxo', d: 'um quintal com grama rala, muro velho e um canto vazio', en: 'an empty suburban backyard with patchy grass, an old plastered wall and bare soil, no furniture, no objects, no people' },
  { n: 'Ilha minúscula', e: '🏝️', t: 'sobrevivência', d: 'uma ilhota no meio do oceano, só com areia e uma palmeira', en: 'a tiny desert island with a strip of sand and a single palm tree in the middle of the open ocean, no other objects, no people' },
  { n: 'Casa vazia', e: '🏠', t: 'luxo', d: 'uma casa recém-construída, só paredes, piso e janelas', en: 'the empty living area of a newly built house, bare walls, plain floor and large windows, no furniture, no people' },
  { n: 'Carro popular', e: '🚗', t: 'luxo', d: 'um carro simples, por dentro e por fora, sem nenhum acessório', en: 'the interior of a basic compact car seen from the back seat towards the dashboard, plain fabric seats, no accessories, no people' },
  { n: 'Mesa de computador', e: '💻', t: 'luxo', d: 'uma mesa com monitor, teclado e mouse básicos, tudo sem graça', en: 'a plain desk with a basic monitor, keyboard and mouse in a bare room, everything dull and generic, no people' },
  { n: 'Quarto', e: '🛏️', t: 'luxo', d: 'um quarto com cama simples, paredes brancas e piso liso', en: 'a small bedroom with a plain single bed with white sheets, white walls and a bare floor, no decorations, no people' },
  { n: 'Sala de estar', e: '🛋️', t: 'luxo', d: 'uma sala vazia com um tapete e uma janela', en: 'an empty living room with a plain rug, one window and bare walls, no furniture, no people' },
  { n: 'Cozinha', e: '🍳', t: 'luxo', d: 'uma cozinha com pia, fogão e bancada vazia', en: 'a bare kitchen with a sink, a basic stove and an empty countertop, no appliances or utensils, no people' },
  { n: 'Cobertura', e: '🌇', t: 'luxo', d: 'uma varanda ampla de cobertura com vista para a cidade, sem móveis', en: 'a large empty penthouse terrace with a railing and a city skyline view at golden hour, no furniture, no people' },
  { n: 'Barco à deriva', e: '⛵', t: 'sobrevivência e luxo', d: 'um barquinho simples flutuando num lago calmo', en: 'a small plain boat floating on a calm lake with nothing on board, no people' },
  { n: 'Food truck', e: '🚚', t: 'sobrevivência e luxo', d: 'um furgão vazio, com balcão e janela de atendimento', en: 'the inside of an empty food truck with a counter and a serving window, bare walls, no equipment, no people' },
  { n: 'Escritório', e: '🏢', t: 'luxo', d: 'uma sala de escritório com uma mesa e uma cadeira', en: 'a small office room with one plain desk and one chair, bare walls, no decorations, no people' },
  { n: 'Sítio isolado', e: '🌾', t: 'sobrevivência', d: 'um terreno de sítio com cerca, porteira e pasto vazio', en: 'an empty rural farm plot with a wooden fence, a gate and bare pasture, no animals, no buildings, no people' },
  { n: 'Floresta fechada', e: '🌲', t: 'sobrevivência', d: 'uma clareira no meio de uma mata densa, sem trilha', en: 'a small clearing in a dense forest with no trail, no objects, no people, overcast light' },
  { n: 'Deserto', e: '🏜️', t: 'sobrevivência', d: 'dunas e céu aberto, sem sombra e sem água por perto', en: 'open desert dunes under a harsh sun, no shade, no water, no objects, no people' },
  { n: 'Cabana na neve', e: '🏔️', t: 'sobrevivência', d: 'uma cabana de madeira vazia no alto de uma montanha nevada', en: 'the bare interior of an empty wooden cabin on a snowy mountain, plain floor and walls, a window showing snow, no furniture, no people' },
  { n: 'Bunker', e: '🕳️', t: 'sobrevivência e luxo', d: 'um bunker subterrâneo de concreto, vazio e frio', en: 'an empty underground concrete bunker room with a metal door and bare walls, dim cold light, no furniture, no people' }
];

/* ---------- utilidades ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR');
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/* ---------- Gemini ---------- */
let active = 0; const waiters = [];
async function limited(fn) {
  if (active >= IMG_CONCURRENCY) await new Promise(r => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; const w = waiters.shift(); if (w) w(); }
}
async function gcall(model, body, tries = 3, url) {
  for (let a = 0; a < tries; a++) {
    let res, txt;
    try {
      res = await fetch(url || `${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(150000)
      });
      txt = await res.text();
    } catch (e) {
      if (a === tries - 1) throw e;
      await sleep(1500 * (a + 1)); continue;
    }
    if (res.ok) return JSON.parse(txt);
    if ((res.status === 429 || res.status >= 500) && a < tries - 1) { await sleep(2500 * (a + 1)); continue; }
    const err = new Error(`Gemini ${res.status}: ${txt.slice(0, 400)}`); err.status = res.status; throw err;
  }
}
function partsOf(data) {
  const c = (data.candidates || [])[0];
  return { parts: (c && c.content && c.content.parts) || [], finish: c && c.finishReason };
}
async function genImageGC(prompt, ref) {
  const parts = [{ text: prompt }];
  if (ref) parts.push({ inlineData: { mimeType: ref.mime || 'image/png', data: ref.buf.toString('base64') } });
  const body = fmt => ({
    contents: [{ role: 'user', parts }],
    generationConfig: Object.assign({ responseModalities: ['TEXT', 'IMAGE'] },
      fmt ? { responseFormat: { image: { aspectRatio: '3:2', imageSize: '1K' } } } : {})
  });
  let data;
  try { data = await limited(() => gcall(IMG_MODEL, body(true))); }
  catch (e) { if (e.status === 400) data = await limited(() => gcall(IMG_MODEL, body(false))); else throw e; }
  const { parts: ps, finish } = partsOf(data);
  const imgs = ps.filter(p => (p.inlineData || p.inline_data) && !p.thought);
  const pick = imgs[imgs.length - 1] || ps.filter(p => p.inlineData || p.inline_data).pop();
  if (!pick) throw new Error('A resposta não trouxe imagem' + (finish ? ' (' + finish + ')' : ''));
  const d = pick.inlineData || pick.inline_data;
  return { buf: Buffer.from(d.data, 'base64'), mime: d.mimeType || d.mime_type || 'image/png' };
}
function parseJson(t) {
  try { return JSON.parse(t); } catch (e) { /* tenta extrair */ }
  const m = String(t).match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* cai no erro abaixo */ } }
  throw new Error('JSON inválido na resposta');
}
async function genJsonGC(prompt, imgs) {
  const parts = [{ text: prompt }];
  (imgs || []).forEach(im => parts.push({ inlineData: { mimeType: im.mime || 'image/png', data: im.buf.toString('base64') } }));
  const data = await limited(() => gcall(TXT_MODEL, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 1 }
  }));
  const { parts: ps } = partsOf(data);
  const txt = ps.filter(p => p.text && !p.thought).map(p => p.text).join('');
  return parseJson(txt);
}

/* ---------- Interactions API (novos modelos) + escolha automática ---------- */
function sniffMime(buf, fallback) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return fallback || 'image/png';
}
function findBlocks(node, type, out) {
  out = out || [];
  if (Array.isArray(node)) { node.forEach(n => findBlocks(n, type, out)); return out; }
  if (node && typeof node === 'object') {
    if (node.type === 'thought') return out;                       // ignora rascunhos do modelo
    if (node.type === type && (type === 'image' ? node.data : typeof node.text === 'string')) out.push(node);
    for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') findBlocks(node[k], type, out);
  }
  return out;
}
const icall = body => gcall(null, body, 3, `${API}/interactions`);

async function genImageIA(prompt, ref) {
  const input = [{ type: 'text', text: prompt }];
  if (ref) input.push({ type: 'image', mime_type: ref.mime || 'image/png', data: ref.buf.toString('base64') });
  const body = fmt => Object.assign({ model: IMG_MODEL, input, store: false },
    fmt ? { response_format: { type: 'image', aspect_ratio: '3:2', image_size: '1K' } } : {});
  let data;
  try { data = await limited(() => icall(body(true))); }
  catch (e) { if (e.status === 400) data = await limited(() => icall(body(false))); else throw e; }
  const imgs = findBlocks(data, 'image');
  const pick = imgs[imgs.length - 1];
  if (!pick) throw new Error('A resposta não trouxe imagem');
  const buf = Buffer.from(pick.data, 'base64');
  return { buf, mime: sniffMime(buf, pick.mime_type) };
}
async function genJsonIA(prompt, imgs) {
  const input = [{ type: 'text', text: prompt }];
  (imgs || []).forEach(im => input.push({ type: 'image', mime_type: im.mime || 'image/png', data: im.buf.toString('base64') }));
  const data = await limited(() => icall({ model: TXT_MODEL, input, store: false, generation_config: { temperature: 1 } }));
  const txt = findBlocks(data, 'text').map(b => b.text).join('');
  return parseJson(txt);
}

const pref = { img: 'interactions', txt: 'generatecontent' };   // lembra qual caminho funcionou
const canFallback = e => e && [400, 404, 405, 501].includes(e.status);
async function viaBoth(kind, ...args) {
  if (API_MODE === 'interactions') return (kind === 'img' ? genImageIA : genJsonIA)(...args);
  if (API_MODE === 'generatecontent') return (kind === 'img' ? genImageGC : genJsonGC)(...args);
  const fns = { interactions: kind === 'img' ? genImageIA : genJsonIA, generatecontent: kind === 'img' ? genImageGC : genJsonGC };
  const first = pref[kind], second = first === 'interactions' ? 'generatecontent' : 'interactions';
  try { return await fns[first](...args); }
  catch (e1) {
    if (!canFallback(e1)) throw e1;
    log('caminho', first, 'falhou (' + e1.status + '), tentando', second);
    try { const r = await fns[second](...args); pref[kind] = second; return r; }
    catch (e2) { throw new Error(clip(e1.message, 170) + ' || ' + clip(e2.message, 170)); }
  }
}
const genImage = (prompt, ref) => viaBoth('img', prompt, ref);
const genJson = (prompt, imgs) => viaBoth('txt', prompt, imgs);

/* ---------- prompts ---------- */
function themeText(env) {
  if (env.t === 'sobrevivência') return 'SOBREVIVÊNCIA: itens que ajudam a sobreviver nesse lugar (comida, água, abrigo, fogo, ferramentas, segurança, primeiros socorros, orientação), com algumas pegadinhas inúteis, falsas ou perigosas';
  if (env.t === 'luxo') return 'LUXO: itens caros, sofisticados e exagerados que deixam o lugar mais chique e confortável, com algumas pegadinhas cafonas, falsificadas ou de mau gosto';
  return 'MISTO: metade de itens de SOBREVIVÊNCIA e metade de itens de LUXO, para os jogadores decidirem se o lugar vira um abrigo ou um resort';
}
async function genItems(env) {
  const prompt = 'Você é o apresentador de um jogo de leilão entre amigos. O ambiente sorteado é "' + env.n + '" (' + env.d + '). O tema deste leilão é ' + themeText(env) + '. Crie exatamente ' + N_ITEMS + ' itens para serem leiloados um a um e colocados nesse ambiente. Misture itens excelentes, medianos e algumas pegadinhas, em ordem embaralhada. Todo item precisa fazer sentido no ambiente, ser um objeto concreto (não uma pessoa nem um animal) e ser visualmente fácil de fotografar. Responda SOMENTE com um array JSON de ' + N_ITEMS + ' objetos com os campos: "n" (nome curto, até 28 caracteres), "e" (um emoji), "d" (uma frase curta de até 90 caracteres que descreve o item de forma atraente ou suspeita, sem entregar se vale a pena) e "m" (lance mínimo em reais, múltiplo de 10, entre 10 e 100). Exemplo: [{"n":"Filtro de água portátil","e":"💧","d":"Promete água limpa até do pântano mais feio.","m":60}]. Escreva em português do Brasil.';
  const raw = await genJson(prompt);
  let arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  arr = arr.filter(x => x && typeof x.n === 'string').slice(0, N_ITEMS);
  if (arr.length < N_ITEMS) throw new Error('A IA devolveu poucos itens');
  return arr.map(x => ({
    n: clip(x.n, 30), e: clip(x.e || '🎁', 8), d: clip(x.d, 100),
    m: Math.max(10, Math.min(200, Math.round((Number(x.m) || 50) / 10) * 10))
  }));
}
const basePrompt = env => 'A photorealistic photograph, 3:2 landscape, of ' + env.en + '. Natural, realistic lighting, 35mm lens, high detail, shot at eye level. No text, no watermark. Leave clear open space in the scene where objects could be added later.';
const editPrompt = it => 'Edit this photograph: add the following item to the scene: "' + it.n + '" (' + it.d + '). Keep everything else exactly the same: same camera angle, same composition, same lighting and every object that is already there. Place the new item in a plausible spot, at a realistic size, with matching shadows, reflections and lighting, photorealistic. If the item sounds low quality, fake, broken or tacky, make it look exactly like that. Do not add text, watermarks or people.';

async function evalPlayer(room, pl) {
  const its = pl.items.map(i => { const it = room.items[i]; const r = room.results.find(x => x[0] === i); return it.n + ' (' + it.d + ') por ' + brl(r ? r[2] : 0); });
  const img = pl.scene.png ? { buf: pl.scene.png, mime: pl.scene.mime } : room.base;
  const prompt = 'Você é um crítico bem-humorado e honesto de um jogo de leilão entre amigos. Ambiente: "' + room.env.n + '" (' + room.env.d + '). Tema: ' + room.env.t + '. O jogador "' + pl.name + '" começou com R$ 1.000 e montou o ambiente dele comprando itens em leilão. Itens que ele levou: ' + (its.length ? its.join('; ') : 'nenhum (o ambiente ficou vazio)') + '. Sobrou ' + brl(pl.balance) + '. A imagem anexada é a cena final dele. Avalie a cena olhando a imagem e os itens. NÃO dê nota, pontuação nem ranking: só prós e contras para os amigos discutirem. Considere o tema, a coerência entre os itens, o que faltou, o que foi gasto e o dinheiro que sobrou. Responda SOMENTE com um objeto JSON com os campos: "resumo" (uma frase), "pros" (array de 2 a 4 frases curtas), "contras" (array de 2 a 4 frases curtas) e "debate" (uma pergunta provocativa sobre esse ambiente para os amigos discutirem). Escreva em português do Brasil.';
  const o = await genJson(prompt, img ? [img] : []);
  const list = a => (Array.isArray(a) ? a : []).slice(0, 5).map(x => clip(x, 220)).filter(Boolean);
  const ev = { resumo: clip(o.resumo, 260), pros: list(o.pros), contras: list(o.contras), debate: clip(o.debate, 260) };
  if (!ev.resumo && !ev.pros.length && !ev.contras.length) throw new Error('avaliação vazia');
  return ev;
}

/* ---------- salas ---------- */
const rooms = new Map();
let gamesToday = { day: '', count: 0 };

function newCode() {
  const a = 'BCDFGHJKLMNPQRSTVWXZ';
  for (let k = 0; k < 50; k++) {
    let c = ''; for (let i = 0; i < 4; i++) c += a[crypto.randomInt(a.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('sem códigos livres');
}
function makeRoom(hostPid, name) {
  const room = {
    code: newCode(), hostPid, phase: 'lobby', players: new Map(), clients: new Set(),
    env: null, items: [], base: null, idx: 0, hi: null, endsAt: 0, results: [], rv: [], last: null,
    evalBusy: false, evalErr: '', error: '', lastEmit: 0, touched: Date.now(), emitTimer: null
  };
  addPlayer(room, hostPid, name);
  rooms.set(room.code, room);
  return room;
}
function addPlayer(room, pid, name) {
  const pl = {
    pid, name: clip(name, 14) || 'Jogador', balance: START_MONEY, items: [], online: 0, offlineAt: 0, passIdx: -1,
    eval: null, scene: { png: null, mime: 'image/png', ver: 0, queue: [], busy: false, failed: [] }
  };
  room.players.set(pid, pl);
  return pl;
}
function snapshot(room, pid) {
  const pls = [...room.players.values()];
  const now = Date.now();
  const me = pls.findIndex(p => p.pid === pid);
  const hiIdx = room.hi ? pls.findIndex(p => p.pid === room.hi.pid) : -1;
  const it = room.items[room.idx];
  return {
    ph: room.phase, code: room.code,
    env: room.env ? { n: room.env.n, e: room.env.e, t: room.env.t, d: room.env.d } : null,
    i: room.idx, n: N_ITEMS, rem: Math.max(0, room.endsAt - now),
    hi: room.hi ? [hiIdx, room.hi.amt] : null,
    cur: room.phase === 'bid' && it ? { n: it.n, e: it.e, d: it.d, m: it.m } : null,
    me, host: room.hostPid === pid,
    pl: pls.map(p => ({ n: p.name, b: p.balance, c: p.items.length, on: p.online > 0, sv: p.scene.ver, sb: p.scene.busy || p.scene.queue.length > 0, sf: p.scene.failed.length })),
    rs: room.results, rv: room.rv, lr: room.last, bv: room.base ? 1 : 0,
    ev: room.phase === 'end' ? pls.map(p => p.eval) : null, evb: room.evalBusy, eve: room.evalErr, err: room.error
  };
}
function emit(room) {
  if (room.emitTimer) return;
  room.emitTimer = setTimeout(() => {
    room.emitTimer = null; room.lastEmit = Date.now();
    for (const c of room.clients) {
      try { c.res.write('event: s\ndata: ' + JSON.stringify(snapshot(room, c.pid)) + '\n\n'); } catch (e) { /* conexão caiu */ }
    }
  }, 40);
}
function minNext(room) { const it = room.items[room.idx]; return room.hi ? room.hi.amt + INC : (it ? it.m : 10); }

function openItem(room) {
  const it = room.items[room.idx];
  room.rv.push([it.n, it.e, it.d]);
  room.hi = null; room.phase = 'bid'; room.endsAt = Date.now() + OPEN_MS;
}
function resolveItem(room) {
  const i = room.idx; let w = -1, price = 0;
  const pls = [...room.players.values()];
  if (room.hi) {
    const pl = room.players.get(room.hi.pid);
    if (pl) {
      pl.balance -= room.hi.amt; pl.items.push(i); w = pls.indexOf(pl); price = room.hi.amt;
      pl.scene.queue.push(i); pumpScene(room, pl);
    }
  }
  room.results.push([i, w, price]); room.last = [i, w, price]; room.hi = null;
  room.phase = 'gap'; room.endsAt = Date.now() + GAP_MS;
  emit(room);
}
function nextItem(room) {
  room.idx++;
  if (room.idx >= N_ITEMS) { room.phase = 'end'; room.endsAt = 0; maybeEval(room); }
  else openItem(room);
  emit(room);
}
function allPassed(room) {
  const others = [...room.players.values()].filter(p => !room.hi || p.pid !== room.hi.pid);
  return others.every(p => p.online <= 0 || p.passIdx === room.idx);
}
function tick() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === 'bid') { if (now >= room.endsAt || allPassed(room)) resolveItem(room); }
    else if (room.phase === 'gap') { if (now >= room.endsAt) nextItem(room); }
    else if (room.phase === 'lobby') {
      for (const [k, p] of room.players) {
        if (p.online <= 0 && p.offlineAt && now - p.offlineAt > 20000 && p.pid !== room.hostPid) { room.players.delete(k); emit(room); }
      }
    }
    if (now - room.lastEmit > 3000) emit(room);
    const idle = now - room.touched;
    const nobody = room.clients.size === 0;
    if ((nobody && idle > 30 * 60 * 1000) || idle > 4 * 3600 * 1000) { rooms.delete(room.code); log('sala removida', room.code); }
  }
}
setInterval(tick, 250);

async function startGame(room) {
  const day = new Date().toISOString().slice(0, 10);
  if (gamesToday.day !== day) gamesToday = { day, count: 0 };
  if (gamesToday.count >= MAX_GAMES_PER_DAY) { room.error = 'Limite de partidas de hoje atingido. Tente amanhã.'; emit(room); return; }
  gamesToday.count++;
  room.error = ''; room.phase = 'prep';
  room.env = ENVS[crypto.randomInt(ENVS.length)];
  emit(room);
  try {
    const [items, base] = await Promise.all([genItems(room.env), genImage(basePrompt(room.env))]);
    room.items = items; room.base = base; room.idx = 0; room.results = []; room.rv = []; room.last = null;
    openItem(room);
  } catch (e) {
    log('falha ao preparar', room.code, e.message);
    room.phase = 'lobby'; room.env = null; gamesToday.count = Math.max(0, gamesToday.count - 1);
    room.error = 'Não deu para preparar o leilão: ' + clip(e.message, 360);
  }
  emit(room);
}
async function pumpScene(room, pl) {
  const sc = pl.scene;
  if (sc.busy) return;
  while (sc.queue.length) {
    const i = sc.queue.shift(); sc.busy = true; emit(room);
    const it = room.items[i];
    let ok = false;
    for (let a = 0; a < 2 && !ok; a++) {
      try {
        const ref = sc.png ? { buf: sc.png, mime: sc.mime } : room.base;
        const r = await genImage(editPrompt(it), ref);
        sc.png = r.buf; sc.mime = r.mime; sc.ver++; ok = true;
      } catch (e) { log('falha imagem', room.code, pl.name, e.message); await sleep(2000); }
    }
    if (!ok) sc.failed.push(it.n);
    sc.busy = false; emit(room);
  }
  maybeEval(room);
}
async function maybeEval(room) {
  if (room.phase !== 'end' || room.evalBusy) return;
  const pls = [...room.players.values()];
  if (pls.some(p => p.scene.busy || p.scene.queue.length)) return;
  const todo = pls.filter(p => !p.eval);
  if (!todo.length) return;
  room.evalBusy = true; room.evalErr = ''; emit(room);
  await Promise.all(todo.map(async pl => {
    try { pl.eval = await evalPlayer(room, pl); }
    catch (e) { log('falha avaliação', room.code, pl.name, e.message); }
  }));
  room.evalBusy = false;
  if (pls.some(p => !p.eval)) room.evalErr = 'Não deu para avaliar todos os ambientes.';
  emit(room);
}

/* ---------- proteção: IP, limite de requisições, cabeçalhos ---------- */
function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
    if (xf.length) return xf[xf.length - 1];   // o último é o que o proxy mais próximo viu
  }
  return req.socket.remoteAddress || 'x';
}
const hits = new Map(), sseByIp = new Map();
function limit(key, max, windowMs) {
  const now = Date.now(); let h = hits.get(key);
  if (!h || now > h.reset) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  return ++h.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now > h.reset) hits.delete(k); }, 60000).unref();
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function secure(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

/* ---------- HTTP ---------- */
const PUBLIC = path.join(__dirname, 'public');
const indexHtml = () => {
  // aceita public/index.html (padrão) ou index.html ao lado do server.js
  for (const f of [path.join(PUBLIC, 'index.html'), path.join(__dirname, 'index.html')]) {
    if (fs.existsSync(f)) return fs.readFileSync(f);
  }
  throw new Error('index.html não encontrado');
};
function send(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 10000) { reject(new Error('corpo grande')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}
const okPid = p => typeof p === 'string' && /^[a-f0-9]{16,64}$/.test(p);
const okCode = c => typeof c === 'string' && /^[A-Z]{4}$/.test(c);

async function handleApi(req, res, url) {
  const p = url.pathname;
  const ip = clientIp(req);
  if (req.method === 'POST' && !limit('api:' + ip, 240, 60000)) return send(res, 429, { error: 'Muitas ações em pouco tempo. Respire um instante.' });
  if (req.method === 'GET' && p === '/api/config') return send(res, 200, { needsAccess: !!ACCESS, ready: !!KEY, imageModel: IMG_MODEL });
  if (req.method === 'GET' && p === '/api/events') {
    const code = (url.searchParams.get('code') || '').toUpperCase(), pid = url.searchParams.get('pid') || '';
    const room = rooms.get(code);
    if (!room || !okPid(pid)) return send(res, 404, { error: 'sala não encontrada' });
    if ((sseByIp.get(ip) || 0) >= MAX_SSE_PER_IP) return send(res, 429, { error: 'Conexões demais deste endereço.' });
    sseByIp.set(ip, (sseByIp.get(ip) || 0) + 1);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const client = { res, pid }; room.clients.add(client);
    const pl = room.players.get(pid); if (pl) { pl.online++; pl.offlineAt = 0; }
    room.touched = Date.now();
    res.write('event: s\ndata: ' + JSON.stringify(snapshot(room, pid)) + '\n\n');
    emit(room);
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (e) { /* ignora */ } }, 15000);
    req.on('close', () => {
      clearInterval(hb); room.clients.delete(client);
      const left = (sseByIp.get(ip) || 1) - 1; if (left > 0) sseByIp.set(ip, left); else sseByIp.delete(ip);
      const q = room.players.get(pid); if (q) { q.online = Math.max(0, q.online - 1); if (q.online === 0) q.offlineAt = Date.now(); }
      emit(room);
    });
    return;
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'não encontrado' });
  const b = await readBody(req);
  if (p === '/api/create') {
    if (!KEY) return send(res, 503, { error: 'O servidor está sem GEMINI_API_KEY.' });
    if (!limit('create:' + ip, 8, 10 * 60000)) return send(res, 429, { error: 'Você criou salas demais. Tente em alguns minutos.' });
    if (ACCESS) {
      const a = Buffer.from(String(b.access || '')), c = Buffer.from(ACCESS);
      if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return send(res, 403, { error: 'Código de acesso incorreto.' });
    }
    if (!okPid(b.pid)) return send(res, 400, { error: 'identificação inválida' });
    if (rooms.size >= MAX_ROOMS) return send(res, 429, { error: 'Já existem salas demais abertas. Tente daqui a pouco.' });
    const room = makeRoom(b.pid, b.name);
    log('sala criada', room.code);
    return send(res, 200, { code: room.code });
  }
  const code = String(b.code || '').toUpperCase();
  const room = rooms.get(code);
  if (!okCode(code) || !room || !okPid(b.pid)) {
    if (!limit('miss:' + ip, 30, 5 * 60000)) return send(res, 429, { error: 'Muitas tentativas de código. Espere um pouco.' });
    return send(res, 404, { error: 'Sala não encontrada. Confira o código.' });
  }
  room.touched = Date.now();
  const pl = room.players.get(b.pid);
  if (p === '/api/join') {
    if (pl) { if (room.phase === 'lobby') pl.name = clip(b.name, 14) || pl.name; return send(res, 200, { ok: true }); }
    if (room.phase !== 'lobby') return send(res, 200, { ok: true, spectator: true });
    if (room.players.size >= MAX_PL) return send(res, 409, { error: 'A sala está cheia.' });
    addPlayer(room, b.pid, b.name); emit(room);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/start') {
    if (room.hostPid !== b.pid) return send(res, 403, { error: 'Só quem criou a sala começa o leilão.' });
    if (room.phase !== 'lobby') return send(res, 409, { error: 'O leilão já começou.' });
    startGame(room);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/bid') {
    if (!pl) return send(res, 403, { error: 'Você está só assistindo.' });
    if (room.phase !== 'bid') return send(res, 409, { error: 'Nenhum item em leilão agora.' });
    const a = Math.round(Number(b.amount));
    if (!Number.isFinite(a)) return send(res, 400, { error: 'valor inválido' });
    if (room.hi && room.hi.pid === pl.pid) return send(res, 409, { error: 'Você já está na frente.' });
    const min = minNext(room);
    if (a < min) return send(res, 409, { error: 'O lance mínimo agora é ' + brl(min) + '.', min });
    if (a > pl.balance) return send(res, 409, { error: 'Saldo insuficiente.' });
    room.hi = { pid: pl.pid, amt: a }; pl.passIdx = -1;
    room.endsAt = Math.max(room.endsAt, Date.now() + EXT_MS);
    emit(room);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/pass') {
    if (!pl) return send(res, 403, { error: 'Você está só assistindo.' });
    if (room.phase === 'bid') { pl.passIdx = room.idx; emit(room); }
    return send(res, 200, { ok: true });
  }
  if (p === '/api/eval') {
    if (room.hostPid !== b.pid) return send(res, 403, { error: 'Só o anfitrião pede de novo.' });
    maybeEval(room);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'não encontrado' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    secure(res);
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const m = url.pathname.match(/^\/img\/([A-Z]{4})\/(base|\d+)\/(\d+)$/);
    if (m) {
      const room = rooms.get(m[1]); let img = null;
      if (room) {
        if (m[2] === 'base') img = room.base;
        else { const pl = [...room.players.values()][Number(m[2])]; if (pl && pl.scene.png) img = { buf: pl.scene.png, mime: pl.scene.mime }; }
      }
      if (!img) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=86400', 'Content-Length': img.buf.length });
      return res.end(img.buf);
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(indexHtml());
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    res.writeHead(404); res.end('não encontrado');
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: clip(e.message, 120) }); else res.end();
  }
});
process.on('unhandledRejection', e => log('erro não tratado:', e && e.message));
server.listen(PORT, '0.0.0.0', () => log(`Leilão Maluco rodando na porta ${PORT}`, KEY ? '(chave Gemini ok)' : '(ATENÇÃO: GEMINI_API_KEY ausente)', ACCESS ? '(código de acesso ativo)' : ''));

function shutdown(sig) {
  log('recebido', sig, '— encerrando');
  for (const room of rooms.values()) for (const c of room.clients) { try { c.res.end(); } catch (e) { /* ignora */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
