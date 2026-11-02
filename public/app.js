/* 倪海厦 · 经方中医 —— 移动端应用逻辑 */
'use strict';

const LS_MSG = 'nhx_messages_v1';
const LS_CFG = 'nhx_settings_v1';

const PRESETS = [
  { name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '智谱', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: '通义', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '自定义', base: '', model: '' },
];

const QUICK_ASKS = [
  '感冒了，怕冷没汗，怎么办？',
  '小柴胡汤什么时候用？',
  '失眠怎么辨？',
  '生附子和炮附子有什么区别？',
  '倪师的六健康标准是什么？',
];

const CASE_CATS = ['全部', '癌症', '心血管', '代谢', '自身免疫', '神经精神', '其他'];

const S = {
  boot: null,
  lib: null,
  view: 'chat',
  messages: [],
  symptoms: new Set(),
  diag: null,
  caseQ: '',
  caseCat: '全部',
  casePage: 1,
  caseTotal: 0,
  caseItems: [],
  libBook: null,
  libQ: '',
  cfg: { base: '', model: '', key: '' },
  busy: false,
};

/* ---------------- 工具 ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:90;background:rgba(35,28,22,.9);color:#fff5ea;font-size:13px;padding:9px 16px;border-radius:999px;max-width:80%;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.2)';
  document.body.appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .3s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 350); }, 2000);
}

function saveMessages() {
  try { localStorage.setItem(LS_MSG, JSON.stringify(S.messages.slice(-30))); } catch {}
}
function loadMessages() {
  try { S.messages = JSON.parse(localStorage.getItem(LS_MSG) || '[]'); } catch { S.messages = []; }
  if (!Array.isArray(S.messages)) S.messages = [];
}
function saveCfg() { try { localStorage.setItem(LS_CFG, JSON.stringify(S.cfg)); } catch {} }
function loadCfg() {
  try { S.cfg = Object.assign({ base: '', model: '', key: '' }, JSON.parse(localStorage.getItem(LS_CFG) || '{}')); } catch {}
}

/* ---------------- Markdown ---------------- */
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
function splitPipe(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
function mdToHtml(md) {
  md = String(md || '').replace(/\r/g, '');
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  const isSpecial = (l) => /^(#{1,4}\s|```|>\s?|\s*[-*+]\s|\s*\d+\.\s|---+$)/.test(l) || (l.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1]));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1])) {
      const head = splitPipe(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(splitPipe(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const lv = h[1].length;
      out.push(`<${lv <= 1 ? 'h2' : lv === 2 ? 'h3' : 'h4'}>` + inline(h[2]) + `</${lv <= 1 ? 'h2' : lv === 2 ? 'h3' : 'h4'}>`);
      i++; continue;
    }
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>/.test(line)) {
      const q = [];
      while (i < lines.length && /^>/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + q.map((x) => inline(x)).join('<br>') + '</blockquote>');
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const m = line.match(/^\s*(\d+\.|[-*+])\s+/)[1];
      const ordered = /\d/.test(m);
      const items = [];
      while (i < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>` + items.map((x) => '<li>' + inline(x) + '</li>').join('') + `</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const p = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isSpecial(lines[i])) { p.push(lines[i]); i++; }
    out.push('<p>' + p.map(inline).join('<br>') + '</p>');
  }
  return out.join('');
}

/* ---------------- 通用弹层 ---------------- */
function openSheet({ eyebrow = '', title = '', body = '' }) {
  $('#sheetEyebrow').textContent = eyebrow;
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  $('#sheetMask').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#sheetBody').scrollTop = 0;
}
function closeSheet() {
  $('#sheetMask').hidden = true;
  document.body.style.overflow = '';
}

/* ---------------- 数据加载 ---------------- */
async function boot() {
  loadCfg();
  loadMessages();
  renderChat();
  bindEvents();
  try {
    const r = await fetch('/api/bootstrap');
    S.boot = await r.json();
    renderQuickAsks();
    renderSymptoms();
    renderQuickGrid();
    renderCaseCats();
    renderBooks();
    setStatus(true);
  } catch (e) {
    setStatus(false);
    toast('服务连接失败，请刷新重试');
  }
}
function setStatus(ok) { $('#statusDot').classList.toggle('off', !ok); }

/* ---------------- 对话 ---------------- */
function renderQuickAsks() {
  $('#quickAsks').innerHTML = QUICK_ASKS.map((q) => `<button class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
  $('#quickAsks').onclick = (e) => {
    const b = e.target.closest('[data-ask]');
    if (!b) return;
    $('#chatInput').value = b.dataset.ask;
    autoGrow();
    sendChat();
  };
}

function renderChat() {
  const box = $('#messages');
  if (!S.messages.length) {
    box.innerHTML = '';
    $('#chatIntro').style.display = '';
    return;
  }
  $('#chatIntro').style.display = 'none';
  box.innerHTML = S.messages.map((m, idx) => msgHtml(m, idx)).join('');
  scrollChat();
}
function msgHtml(m, idx) {
  if (m.role === 'user') {
    return `<div class="msg user"><div class="avatar">你</div><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
  }
  const src = (m.sources && m.sources.length)
    ? `<div class="src"><b>引用</b>${m.sources.map((s) => `<span>${esc(s.book)}·${esc(s.title)}</span>`).join('')}</div>` : '';
  const body = m.streaming && !m.content
    ? '<span class="typing"><i></i><i></i><i></i></span>'
    : mdToHtml(m.content) + (m.streaming ? '<span class="typing" style="padding-left:4px"><i></i></span>' : '');
  return `<div class="msg assistant" data-idx="${idx}"><div class="avatar">倪</div><div class="bubble md">${body}${src}</div></div>`;
}
function scrollChat() {
  const el = $('#messages');
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}
function autoGrow() {
  const t = $('#chatInput');
  t.style.height = 'auto';
  t.style.height = Math.min(110, t.scrollHeight) + 'px';
}
function updateComposerHint() {
  const h = $('#composerHint');
  h.textContent = S.cfg.key
    ? `已连接 ${S.cfg.model || '大模型'} · 内容仅供学习参考，不构成医疗建议`
    : '未配置大模型，点右上角设置后即可对话';
}

async function sendChat() {
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (S.busy) { toast('倪师还在讲，等一等'); return; }
  if (!S.cfg.key) {
    openSettings();
    toast('先填一个 API Key，就能和倪师对话了');
    return;
  }
  S.messages.push({ role: 'user', content: text });
  S.messages.push({ role: 'assistant', content: '', streaming: true, sources: [] });
  input.value = ''; autoGrow();
  renderChat(); saveMessages();
  S.busy = true;
  $('#sendBtn').disabled = true;

  const history = S.messages.slice(0, -1).filter((m) => m.content && !m.error).slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-llm-key': S.cfg.key },
      body: JSON.stringify({ baseUrl: S.cfg.base, model: S.cfg.model, messages: history }),
    });
    if (!res.ok) {
      let err = '请求失败';
      try { const j = await res.json(); err = j.message || j.error || err; } catch {}
      finishAssistant('⚠ ' + err);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop();
      for (const ev of events) {
        const line = ev.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let j;
        try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (j.meta) {
          const last = S.messages[S.messages.length - 1];
          last.sources = j.meta.sources || [];
        } else if (j.t) {
          const last = S.messages[S.messages.length - 1];
          last.content += j.t;
          updateAssistantStreaming();
        } else if (j.error) {
          finishAssistant(`\n\n⚠ ${j.error}${j.detail ? '：' + j.detail : ''}`);
        }
      }
    }
    const last = S.messages[S.messages.length - 1];
    if (last.streaming) finishAssistant();
  } catch (e) {
    finishAssistant('⚠ 网络中断：' + (e.message || e));
  } finally {
    S.busy = false;
    $('#sendBtn').disabled = false;
    saveMessages();
  }
}

function updateAssistantStreaming() {
  const nodes = $$('.msg.assistant');
  const el = nodes[nodes.length - 1];
  if (!el) { renderChat(); return; }
  const last = S.messages[S.messages.length - 1];
  const bubble = el.querySelector('.bubble');
  bubble.innerHTML = mdToHtml(last.content) + '<span class="typing" style="padding-left:4px"><i></i></span>' +
    ((last.sources && last.sources.length) ? `<div class="src"><b>引用</b>${last.sources.map((s) => `<span>${esc(s.book)}·${esc(s.title)}</span>`).join('')}</div>` : '');
  scrollChat();
}
function finishAssistant(errText) {
  const last = S.messages[S.messages.length - 1];
  if (!last || last.role !== 'assistant') return;
  last.streaming = false;
  if (errText) last.content = (last.content ? last.content + '\n\n' : '') + errText;
  if (!last.content) last.content = '⚠ 没有收到回复，请检查 API Key / 模型名 / 余额。';
  saveMessages();
  renderChat();
}

/* ---------------- 辨证 ---------------- */
function renderSymptoms() {
  const groups = S.boot.syndromes.groups;
  $('#symptomGroups').innerHTML = groups.map((g) => `
    <div class="sym-group">
      <h4>${esc(g.name)}</h4>
      <div class="sym-chips">${g.symptoms.map((s) => `<button class="sym" data-sym="${s.id}">${esc(s.label)}</button>`).join('')}</div>
    </div>`).join('');
  $('#symptomGroups').onclick = (e) => {
    const b = e.target.closest('[data-sym]');
    if (!b) return;
    const id = b.dataset.sym;
    if (S.symptoms.has(id)) S.symptoms.delete(id); else S.symptoms.add(id);
    b.classList.toggle('active');
    $('#symptomCount').textContent = S.symptoms.size;
  };
}

function labelOf(id) {
  for (const g of S.boot.syndromes.groups) for (const s of g.symptoms) if (s.id === id) return s.label;
  return id;
}

function computeDiagnosis() {
  const syn = S.boot.syndromes.syndromes;
  const W = { must: 3, key: 2, support: 1 };
  const results = syn.map((s) => {
    let score = 0, max = 0;
    const hit = [];
    for (const k of ['must', 'key', 'support']) {
      for (const id of s[k]) {
        max += W[k];
        if (S.symptoms.has(id)) { score += W[k]; hit.push(id); }
      }
    }
    return { s, score, max, pct: max ? Math.round((score / max) * 100) : 0, hit };
  }).filter((r) => r.pct > 0).sort((a, b) => b.pct - a.pct);
  return results;
}

function formulaCard(name, compact) {
  const f = S.boot.formulas.find((x) => x.name === name);
  if (!f) return '';
  return `<div class="formula-card">
    <div class="fc-name">${esc(f.name)} <em>${esc(f.source || '知识库')}</em></div>
    ${f.indications && !compact ? `<div class="fc-line"><b>主症</b>：${esc(f.indications)}</div>` : ''}
    <div class="fc-line"><b>原方</b>：${esc(f.original || '未载')}</div>
    <div class="fc-line"><b>倪师临床</b>：${esc(f.clinical || '未载')}</div>
    ${f.notes ? `<div class="fc-note">注意：${esc(f.notes)}</div>` : ''}
  </div>`;
}

function runDiagnosis() {
  if (S.symptoms.size === 0) { toast('先勾几个症状，我才有得辨啊'); return; }
  const results = computeDiagnosis();
  const box = $('#diagnoseResult');
  if (!results.length) {
    box.innerHTML = '<div class="result-card"><h3 style="font-family:var(--serif);margin:0 0 6px">还辨不出来</h3><p class="muted" style="font-size:13px;margin:0">这些症状在六经里没有明显对应，可能是信息不够，或者不是单纯六经证。建议补上脉象、舌象、二便，或直接问倪师。</p></div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const top = results.slice(0, 2);
  const selected = [...S.symptoms];

  let html = '';
  top.forEach((r, idx) => {
    const s = r.s;
    let sub = null;
    for (const st of (s.subtypes || [])) {
      if (st.when.every((w) => S.symptoms.has(w))) { sub = st; break; }
    }
    if (!sub && s.subtypes && s.subtypes.length && idx === 0) {
      sub = s.subtypes.find((st) => st.when.some((w) => S.symptoms.has(w))) || s.subtypes[0];
    }
    const miss = [...s.must, ...s.key].filter((id) => !S.symptoms.has(id));
    html += `<div class="result-card">
      <div class="result-top">
        <div class="score-ring" style="--p:${r.pct}"><span>${r.pct}%</span></div>
        <div><h3>${esc(s.name)} <span style="font-size:12px;color:var(--muted);font-weight:400">${esc(s.short)}</span></h3>
        <p>${esc(s.tig)}</p></div>
      </div>
      <div class="match-list">${r.hit.map((id) => `<span>${esc(labelOf(id))}</span>`).join('')}
        ${miss.slice(0, 3).map((id) => `<span class="miss">缺 ${esc(labelOf(id))}</span>`).join('')}</div>
      <p class="muted" style="font-size:12.5px;margin:6px 0 0">${esc(s.pathogenesis)}</p>
      <ul class="result-points">${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      ${sub ? `<div class="subtype">倾向：<b>${esc(sub.name)}</b> · ${esc(sub.formula)}<br><span class="muted" style="font-size:12px">${esc(sub.hint)}</span></div>` : ''}
      ${(sub ? [sub.formula] : []).map((n) => formulaCard(n)).join('')}
      ${s.formulas.filter((n) => !sub || n !== sub.formula).slice(0, 2).map((n) => `<div style="margin-top:8px">${formulaCard(n, true)}</div>`).join('')}
      <div class="result-actions">
        <button data-act="read" data-q="${esc(s.name)}">看原文</button>
        <button data-act="ask" data-q="${esc(s.name)}">问倪师</button>
      </div>
    </div>`;
  });

  // 合病提示
  if (top.length === 2 && top[0].pct >= 45 && top[1].pct >= 45) {
    const pair = S.boot.syndromes.combined.find((c) =>
      (c.pair[0] === top[0].s.id && c.pair[1] === top[1].s.id) ||
      (c.pair[1] === top[0].s.id && c.pair[0] === top[1].s.id));
    if (pair) {
      html += `<div class="result-card"><div class="combined-tip"><b>疑似合病：${esc(pair.name)}</b><br>${esc(pair.hint)}</div>
        <div style="margin-top:8px">${formulaCard(pair.formula, true)}</div></div>`;
    }
  }

  const names = top.map((r) => `${r.s.name}（${r.pct}%）`).join('、');
  html += `<div class="result-card" style="background:var(--paper-2)">
    <p style="font-size:11.5px;color:var(--muted);margin:0;line-height:1.7">⚠ 向导只能给出六经方向，不能代替面诊。脉象、舌象、腹诊、病程都要看。若症状急重或持续加重，请立即就医。<br>本次匹配：${esc(names)}</p>
  </div>`;

  box.innerHTML = html;
  box.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.act === 'read') {
        switchView('library');
        $('#libSearch').value = b.dataset.q;
        searchLibrary(b.dataset.q);
      } else {
        const summary = selected.map(labelOf).join('、');
        const diag = top.map((r) => `${r.s.name}（${r.s.short}，匹配度${r.pct}%）`).join('；');
        $('#chatInput').value = `我的症状：${summary}。六经辨证向导提示：${diag}。请帮我进一步辨证，并给出方剂与剂量参考。`;
        switchView('chat');
        autoGrow();
        toast('已把辨证结果放进输入框');
      }
    };
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- 速查 ---------------- */
function renderQuickGrid() {
  const q = S.boot.quickref;
  $('#quickGrid').innerHTML = q.map((c) => `
    <button class="quick-card" data-q="${c.id}">
      <span class="q-icon">${c.icon}</span>
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.desc)}</p>
    </button>`).join('');
  $('#quickGrid').onclick = (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const c = q.find((x) => x.id === b.dataset.q);
    let body = '';
    if (c.kind === 'table') {
      body = `<div class="q-table"><table><thead><tr>${c.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${c.rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else {
      body = `<ul class="q-list">${c.items.map((it) => `<li><b>${esc(it[0])}</b><br>${esc(it[1])}</li>`).join('')}</ul>`;
    }
    if (c.note) body += `<div class="sheet-note ${c.warn ? 'warn' : ''}">${esc(c.note)}</div>`;
    openSheet({ eyebrow: '速查', title: c.title, body });
  };
}

/* ---------------- 医案 ---------------- */
function renderCaseCats() {
  $('#caseCats').innerHTML = CASE_CATS.map((c) => `<button class="chip ${c === S.caseCat ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('');
  $('#caseCats').onclick = (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    S.caseCat = b.dataset.cat;
    $$('#caseCats .chip').forEach((x) => x.classList.toggle('active', x.dataset.cat === S.caseCat));
    loadCases(true);
  };
}
async function loadCases(reset) {
  if (reset) { S.casePage = 1; S.caseItems = []; $('#caseList').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; }
  try {
    const r = await fetch('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: S.caseQ, cat: S.caseCat, page: S.casePage, size: 20 }),
    });
    const j = await r.json();
    S.caseTotal = j.total;
    S.caseItems = reset ? j.items : S.caseItems.concat(j.items);
    renderCaseList();
    $('#caseMore').classList.toggle('hidden', S.caseItems.length >= S.caseTotal);
  } catch { toast('医案加载失败'); }
}
function renderCaseList() {
  if (!S.caseItems.length) { $('#caseList').innerHTML = '<div class="empty">没有找到相关医案，换个关键词试试</div>'; return; }
  $('#caseList').innerHTML = S.caseItems.map((c) => `
    <button class="case-card" data-no="${c.no}">
      <div class="cc-top"><h3>${esc(c.diagnosis || '未载诊断')}</h3><span class="cc-no">#${c.no}</span></div>
      <div class="cc-meta">${c.date && c.date !== '---' ? `<span>${esc(c.date)}</span>` : ''}<span>${esc(c.cat)}</span>${c.formula ? `<span>${esc(c.formula.slice(0, 26))}</span>` : ''}</div>
      ${c.result ? `<p class="cc-result">${esc(c.result)}</p>` : ''}
    </button>`).join('');
  $('#caseList').onclick = async (e) => {
    const b = e.target.closest('[data-no]');
    if (!b) return;
    try {
      const r = await fetch('/api/case?no=' + b.dataset.no);
      const c = await r.json();
      const rows = [
        ['日期', c.date], ['患者', c.patient], ['主要诊断', c.diagnosis], ['中医病机', c.pathology],
        ['西医背景', c.western], ['具体方剂', c.formula], ['针灸方案', c.acupuncture],
        ['治法原则', c.method], ['疗程/结果', c.result], ['生活医嘱', c.advice], ['倪师观点', c.view],
      ].filter((x) => x[1] && x[1] !== '未提及' && x[1] !== '---');
      openSheet({
        eyebrow: `医案 #${c.no} · ${c.cat}`,
        title: c.diagnosis || '医案',
        body: `<div class="case-detail"><div class="cd-head"><p>${esc(c.date || '')} ${esc(c.patient || '')}</p></div><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          <div class="sheet-note">医案为倪师临床记录，个体差异大，请勿照方抓药。用药须执业中医师辨证。</div></div>`,
      });
    } catch { toast('医案详情加载失败'); }
  };
}

/* ---------------- 典籍 ---------------- */
function renderBooks() {
  const books = S.boot.books;
  const max = Math.max(...books.map((b) => b.count), 1);
  $('#bookGrid').innerHTML = books.map((b) => `
    <button class="book-card" data-book="${b.id}">
      <span class="bc-count">${b.count} 节</span>
      <span class="bc-cat">${esc(b.cat)}</span>
      <h3>${esc(b.title)}</h3>
      <p>${esc(b.desc)}</p>
      <div class="bc-bar"><i style="width:${Math.max(12, Math.round(b.count / max * 100))}%"></i></div>
    </button>`).join('');
  $('#bookGrid').onclick = (e) => {
    const b = e.target.closest('[data-book]');
    if (!b) return;
    openBook(b.dataset.book);
  };
}
async function ensureLib() {
  if (S.lib) return S.lib;
  const r = await fetch('/api/library');
  S.lib = await r.json();
  return S.lib;
}
async function openBook(bookId) {
  const lib = await ensureLib();
  const b = S.boot.books.find((x) => x.id === bookId);
  S.libBook = bookId;
  $('#bookGrid').classList.add('hidden');
  $('#libSearchResults').innerHTML = '';
  const list = lib.sections.filter((s) => s.book === bookId);
  $('#sectionList').classList.remove('hidden');
  $('#sectionList').innerHTML = `<button class="back-link" id="backBooks">‹ 返回书目</button>
    <div class="page-head" style="margin-bottom:10px"><h2 style="font-size:20px">${esc(b.title)}</h2><p class="muted">${esc(b.desc)} · ${list.length} 节</p></div>` +
    list.map((s) => `<button class="section-item" data-doc="${s.id}"><span>${esc(s.t)}</span><em>${s.c}</em></button>`).join('');
  $('#backBooks').onclick = () => { S.libBook = null; $('#sectionList').classList.add('hidden'); $('#bookGrid').classList.remove('hidden'); };
  $('#sectionList').querySelectorAll('[data-doc]').forEach((el) => { el.onclick = () => openDoc(el.dataset.doc); });
  $('#sectionList').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function openDoc(id) {
  try {
    const r = await fetch('/api/doc?id=' + encodeURIComponent(id));
    const d = await r.json();
    if (d.error) { toast('原文加载失败'); return; }
    openSheet({
      eyebrow: `${d.bookTitle} · 原文`,
      title: d.title,
      body: `<div class="md">${mdToHtml(d.text)}</div>
        <div class="sheet-note">原文来自倪海厦 skill 知识库（${esc(d.bookTitle)}），仅供学习参考。</div>`,
    });
  } catch { toast('原文加载失败'); }
}
let searchLibTimer;
async function searchLibrary(q) {
  q = String(q || '').trim();
  S.libQ = q;
  const box = $('#libSearchResults');
  if (!q) { box.innerHTML = ''; $('#bookGrid').classList.remove('hidden'); if (!S.libBook) $('#sectionList').classList.add('hidden'); return; }
  $('#bookGrid').classList.add('hidden');
  $('#sectionList').classList.add('hidden');
  box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const r = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, limit: 16 }),
    });
    const j = await r.json();
    box.innerHTML = j.results.length
      ? j.results.map((h) => `<button class="hit" data-doc="${h.id}"><span class="hit-book">${esc(h.bookTitle)}</span><h3>${esc(h.title)}</h3><p>${esc(h.snippet)}</p></button>`).join('')
      : '<div class="empty">没有找到，换个词试试</div>';
    box.querySelectorAll('[data-doc]').forEach((el) => { el.onclick = () => openDoc(el.dataset.doc); });
  } catch { box.innerHTML = '<div class="empty">检索失败</div>'; }
}

/* ---------------- 设置 ---------------- */
function openSettings() {
  $('#cfgBase').value = S.cfg.base;
  $('#cfgModel').value = S.cfg.model;
  $('#cfgKey').value = S.cfg.key;
  $('#presetRow').innerHTML = PRESETS.map((p) => `<button class="preset ${p.base && p.base === S.cfg.base ? 'active' : ''}" data-base="${esc(p.base)}" data-model="${esc(p.model)}">${esc(p.name)}</button>`).join('');
  $('#settingsMask').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSettings() {
  $('#settingsMask').hidden = true;
  document.body.style.overflow = '';
}

function bindEvents() {
  $$('.tab').forEach((t) => { t.onclick = () => switchView(t.dataset.view); });
  $('#settingsBtn').onclick = openSettings;
  $('#settingsClose').onclick = closeSettings;
  $('#settingsMask').onclick = (e) => { if (e.target === e.currentTarget) closeSettings(); };
  $('#sheetClose').onclick = closeSheet;
  $('#sheetMask').onclick = (e) => { if (e.target === e.currentTarget) closeSheet(); };
  $('#presetRow').onclick = (e) => {
    const b = e.target.closest('[data-base]');
    if (!b) return;
    $$('#presetRow .preset').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#cfgBase').value = b.dataset.base;
    $('#cfgModel').value = b.dataset.model;
  };
  $('#cfgSave').onclick = () => {
    S.cfg.base = $('#cfgBase').value.trim() || 'https://api.deepseek.com/v1';
    S.cfg.model = $('#cfgModel').value.trim() || 'deepseek-chat';
    S.cfg.key = $('#cfgKey').value.trim();
    saveCfg();
    updateComposerHint();
    closeSettings();
    toast(S.cfg.key ? '已保存，可以对话了' : '只保存了地址和模型，还没有 Key');
  };
  $('#cfgClear').onclick = () => {
    S.messages = [];
    saveMessages();
    renderChat();
    toast('对话已清除');
  };
  $('#diagnoseBtn').onclick = runDiagnosis;
  $('#sendBtn').onclick = sendChat;
  const ta = $('#chatInput');
  ta.addEventListener('input', autoGrow);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
  });
  $('#caseSearch').addEventListener('input', debounce((e) => { S.caseQ = e.target.value.trim(); loadCases(true); }, 350));
  $('#caseMore').onclick = () => { S.casePage++; loadCases(false); };
  $('#libSearch').addEventListener('input', debounce((e) => searchLibrary(e.target.value), 350));
}

function switchView(v) {
  S.view = v;
  $$('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-' + v));
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (v === 'cases' && !S.caseItems.length) loadCases(true);
  updateComposerVisibility();
}
function updateComposerVisibility() {
  const wrap = document.querySelector('.composer-wrap');
  const stick = document.querySelector('#view-diagnose .sticky-action');
  if (wrap) wrap.style.display = S.view === 'chat' ? '' : 'none';
  if (stick) stick.style.display = S.view === 'diagnose' ? '' : 'none';
}

/* ---------------- 启动 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  boot();
  updateComposerVisibility();
  updateComposerHint();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
