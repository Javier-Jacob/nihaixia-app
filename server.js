#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 8000;

function loadJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
  catch (e) { console.warn('load fail', name, e.message); return fallback; }
}

const library = loadJson('library.json', { books: [], sections: [] });
const cases = loadJson('cases.json', []);
const formulas = loadJson('formulas.json', []);
const quickref = loadJson('quickref.json', []);
const syndromes = loadJson('syndromes.json', {});
const stats = loadJson('stats.json', {});
const systemPrompt = fs.readFileSync(path.join(DATA, 'system-prompt.md'), 'utf8');

// 预计算小写检索文本
for (const s of library.sections) {
  s._t = (s.title + '\n' + s.text).toLowerCase();
  s._title = s.title.toLowerCase();
}
for (const c of cases) {
  c._t = [c.diagnosis, c.pathology, c.patient, c.formula, c.result, c.view, c.date].join('\n').toLowerCase();
}
const formulaByName = new Map(formulas.map((f) => [f.name, f]));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const CJK = /[\u4e00-\u9fff]/;
const STOP = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '有', '和', '就', '都', '吗', '呢', '啊', '这', '那', '什么', '怎么', '可以', '一个', '一下']);

function tokenize(q) {
  q = String(q || '').toLowerCase().trim().slice(0, 120);
  const out = new Set();
  const chunks = q.split(/[\s，。！？、；：,.!?;:()（）\[\]【】"'“”‘’/\\+*]+/).filter(Boolean);
  for (const ch of chunks) {
    if (CJK.test(ch)) {
      if (ch.length <= 6 && ch.length >= 2 && !STOP.has(ch)) out.add(ch);
      for (let i = 0; i < ch.length - 1; i++) {
        const bg = ch.slice(i, i + 2);
        if (!STOP.has(bg)) out.add(bg);
      }
    } else if (ch.length >= 2) {
      out.add(ch);
    }
  }
  return [...out].slice(0, 24);
}

function countIn(text, token, cap) {
  let n = 0, i = 0;
  while (n < cap) {
    const p = text.indexOf(token, i);
    if (p === -1) break;
    n++; i = p + token.length;
  }
  return n;
}

function snippet(text, tokens, radius) {
  let best = -1, bestToken = '';
  for (const t of tokens) {
    const p = text.indexOf(t);
    if (p !== -1 && (best === -1 || p < best)) { best = p; bestToken = t; }
  }
  if (best === -1) return text.slice(0, radius * 2).replace(/\s+/g, ' ');
  const start = Math.max(0, best - radius);
  const end = Math.min(text.length, best + bestToken.length + radius);
  return (start ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}

function phraseOf(q) {
  return String(q || '').toLowerCase().replace(/[\s，。！？、；：,.!?;:()（）\[\]【】"'“”‘’/\\+*|_-]+/g, '');
}

function searchLibrary(q, limit = 12, book) {
  const tokens = tokenize(q);
  const phrase = phraseOf(q);
  if (!tokens.length && phrase.length < 2) return [];
  const hits = [];
  for (const s of library.sections) {
    if (book && s.book !== book) continue;
    let score = 0;
    for (const t of tokens) {
      score += countIn(s._t, t, 8);
      if (s._title.includes(t)) score += 6;
    }
    if (phrase.length >= 2) {
      if (s._t.includes(phrase)) score += 18;
      if (s._title.includes(phrase)) score += 24;
    }
    if (score > 0) hits.push({ s, score });
  }
  hits.sort((a, b) => b.score - a.score || a.s.chars - b.s.chars);
  return hits.slice(0, limit).map(({ s, score }) => ({
    id: s.id, book: s.book, bookTitle: s.bookTitle, title: s.title,
    snippet: snippet(s.text, phrase.length >= 2 ? [phrase, ...tokens] : tokens, 80), score, chars: s.chars,
  }));
}

function searchCases(q, cat, page, size) {
  const tokens = tokenize(q);
  const phrase = phraseOf(q);
  let list = cases;
  if (cat && cat !== '全部') list = list.filter((c) => c.cat === cat);
  if (tokens.length || phrase.length >= 2) {
    const scored = [];
    for (const c of list) {
      let score = 0;
      for (const t of tokens) score += countIn(c._t, t, 6);
      if (phrase.length >= 2 && c._t.includes(phrase)) score += 14;
      if (score > 0) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score || a.c.no - b.c.no);
    list = scored.map((x) => x.c);
  }
  const total = list.length;
  const start = (page - 1) * size;
  const items = list.slice(start, start + size).map((c) => ({
    no: c.no, date: c.date, patient: c.patient, diagnosis: c.diagnosis,
    cat: c.cat, formula: c.formula, result: c.result, view: c.view,
  }));
  return { total, page, size, items };
}

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0; const bufs = [];
    req.on('data', (ch) => {
      size += ch.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      bufs.push(ch);
    });
    req.on('end', () => {
      try { resolve(bufs.length ? JSON.parse(Buffer.concat(bufs).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^[0-9.]+$/.test(h) && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function buildContext(question) {
  const hits = searchLibrary(question, 5);
  if (!hits.length) return { text: '（知识库没有检索到直接相关的原文。）', sources: [] };
  const sources = hits.map((h, i) => ({
    n: i + 1, id: h.id, title: h.title, book: h.bookTitle,
  }));
  let text = '';
  hits.forEach((h, i) => {
    const sec = library.sections.find((s) => s.id === h.id);
    const body = sec ? sec.text.slice(0, 1100) : h.snippet;
    text += `\n[${i + 1}] 《${h.bookTitle}》· ${h.title}\n${body}\n`;
  });
  // 命中的方剂卡
  const cardNames = [];
  for (const h of hits) {
    for (const name of formulaByName.keys()) {
      if (h.snippet.includes(name) || (library.sections.find((s) => s.id === h.id)?.text || '').includes(name)) {
        if (!cardNames.includes(name)) cardNames.push(name);
      }
    }
    if (cardNames.length >= 4) break;
  }
  if (cardNames.length) {
    text += '\n# 相关方剂卡（知识库原文剂量）\n';
    for (const name of cardNames.slice(0, 3)) {
      const f = formulaByName.get(name);
      text += `- ${name}：原方 ${f.original || '未载'}；倪师临床 ${f.clinical || '未载'}；注意 ${f.notes || '—'}\n`;
    }
  }
  return { text, sources };
}

async function handleChat(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { json(res, { error: '请求格式错误' }, 400); return; }
  const key = (req.headers['x-llm-key'] || '').trim();
  if (!key) { json(res, { error: 'NO_KEY', message: '还没有配置 API Key，请先点右上角设置。' }, 400); return; }
  const baseUrl = String(body.baseUrl || 'https://api.deepseek.com/v1').trim();
  const model = String(body.model || 'deepseek-chat').trim();
  let u;
  try { u = new URL(baseUrl); } catch { json(res, { error: 'API 地址格式不正确' }, 400); return; }
  if (u.protocol !== 'https:') { json(res, { error: 'API 地址必须是 https://' }, 400); return; }
  if (isPrivateHost(u.hostname)) { json(res, { error: 'API 地址不允许指向内网' }, 400); return; }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = lastUser ? String(lastUser.content).slice(0, 500) : '';
  const ctx = question ? buildContext(question) : { text: '', sources: [] };

  const sys = systemPrompt + (ctx.text ? '\n\n# 知识库检索结果（供本轮回答使用）\n' + ctx.text : '');
  const payload = {
    model,
    stream: true,
    temperature: 0.7,
    max_tokens: 1500,
    messages: [{ role: 'system', content: sys }, ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 4000),
    }))],
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
  send({ meta: { sources: ctx.sources, model } });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000);
  req.on('close', () => { clearTimeout(timer); ctrl.abort(); });
  try {
    const url = baseUrl.replace(/\/+$/, '') + (/\/chat\/completions$/.test(baseUrl) ? '' : '/chat/completions');
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!upstream.ok) {
      let msg = '';
      try { msg = (await upstream.text()).slice(0, 500); } catch {}
      const hint = upstream.status === 401 ? 'API Key 无效或已过期，请在设置里重新填写'
        : upstream.status === 402 ? '账户余额不足，请到服务商后台充值，或在设置里切换到免费服务商（如智谱 glm-4-flash）'
        : upstream.status === 403 ? '该 Key 没有此模型的调用权限，请到服务商后台开通'
        : upstream.status === 404 ? '接口地址或模型名不正确，请检查设置里的服务商、Base URL 与模型'
        : upstream.status === 429 ? '请求太频繁或额度已用尽，请稍后再试或换服务商'
        : '';
      let detail = msg;
      try { const j = JSON.parse(msg); detail = j.error?.message || j.message || msg; } catch {}
      send({ error: `上游返回 ${upstream.status}${hint ? '：' + hint : ''}`, detail: String(detail).slice(0, 200) });
      res.end(); return;
    }
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop();
      for (const line of parts) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content || j.choices?.[0]?.message?.content || '';
          if (delta) send({ t: delta });
        } catch {}
      }
    }
    send({ done: true });
    res.end();
  } catch (e) {
    if (e.name === 'AbortError') { try { res.end(); } catch {} return; }
    send({ error: '调用大模型失败', detail: String(e.message || e) });
    try { res.end(); } catch {}
  } finally {
    clearTimeout(timer);
  }
}

function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(PUBLIC, p));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    const ext = path.extname(full).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache = ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  if (process.env.NHX_DEBUG) console.log('REQ', req.method, req.url);
  try {
    if (p === '/api/health') return json(res, { ok: true, stats });
    if (p === '/api/bootstrap') {
      return json(res, {
        stats,
        books: library.books,
        quickref,
        syndromes,
        formulas: formulas.map((f) => ({
          name: f.name, original: f.original, clinical: f.clinical,
          notes: f.notes, indications: f.indications, source: f.source,
        })),
      });
    }
    if (p === '/api/library') {
      return json(res, {
        books: library.books,
        sections: library.sections.map((s) => ({ id: s.id, book: s.book, t: s.title, c: s.chars })),
      });
    }
    if (p === '/api/doc') {
      const s = library.sections.find((x) => x.id === u.searchParams.get('id'));
      if (!s) return json(res, { error: 'not found' }, 404);
      return json(res, { id: s.id, book: s.book, bookTitle: s.bookTitle, title: s.title, text: s.text });
    }
    if (p === '/api/search') {
      let q, book, limit;
      if (req.method === 'POST') {
        const b = await readBody(req);
        q = String(b.q || '');
        book = String(b.book || '');
        limit = Math.min(30, Number(b.limit) || 12);
      } else {
        q = u.searchParams.get('q') || '';
        book = u.searchParams.get('book') || '';
        limit = Math.min(30, Number(u.searchParams.get('limit')) || 12);
      }
      return json(res, { q, results: searchLibrary(q, limit, book) });
    }
    if (p === '/api/cases') {
      let q, cat, page, size;
      if (req.method === 'POST') {
        const b = await readBody(req);
        q = String(b.q || '');
        cat = String(b.cat || '全部');
        page = Math.max(1, Number(b.page) || 1);
        size = Math.min(50, Number(b.size) || 20);
      } else {
        q = u.searchParams.get('q') || '';
        cat = u.searchParams.get('cat') || '全部';
        page = Math.max(1, Number(u.searchParams.get('page')) || 1);
        size = Math.min(50, Number(u.searchParams.get('size')) || 20);
      }
      return json(res, searchCases(q, cat, page, size));
    }
    if (p === '/api/case') {
      const no = Number(u.searchParams.get('no'));
      const c = cases.find((x) => x.no === no);
      if (!c) return json(res, { error: 'not found' }, 404);
      return json(res, c);
    }
    if (p === '/api/formulas') {
      const q = (u.searchParams.get('q') || '').trim();
      const list = q
        ? formulas.filter((f) => (f.name + f.indications + f.notes + f.clinical).includes(q))
        : formulas;
      return json(res, { total: list.length, items: list.slice(0, 60) });
    }
    if (p === '/api/chat' && req.method === 'POST') return handleChat(req, res);
    if (p.startsWith('/api/')) return json(res, { error: 'unknown api' }, 404);
    return serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, { error: 'server error', detail: e.message }, 500);
    else { try { res.end(); } catch {} }
  }
});

server.on('clientError', (err, socket) => {
  try {
    console.log('CLIENT_ERROR', err.code, JSON.stringify(String(err.rawPacket || '').slice(0, 240)));
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  } catch {}
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`nihaixia app listening on 0.0.0.0:${PORT}`);
  console.log(`sections=${library.sections.length} cases=${cases.length} formulas=${formulas.length}`);
});
