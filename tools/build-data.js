#!/usr/bin/env node
/* 把倪海厦 skill 的 Markdown 知识库编译成小程序可用的 JSON 数据 */
const fs = require('fs');
const path = require('path');

const SRC = process.env.SKILL_DIR || '/workspace/skills/nihaixia';
const OUT = path.join(__dirname, '..', 'data');
fs.mkdirSync(OUT, { recursive: true });

const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const clean = (s) => s.replace(/\r/g, '');

const BOOKS = [
  { id: 'zonggang', title: '倪师总纲', cat: '核心', desc: '表达风格 · 六经速查 · 方剂规矩', files: ['SKILL.md'] },
  { id: 'shanghan', title: '伤寒论', cat: '经典', desc: '太阳篇 129 条 + 阳明/少阳/太阴/少阴/厥阴 + 太阳下篇阳明篇补条', files: ['modules/01_shanghan_sun.md', 'modules/02_shanghan_other.md', 'modules/13_shanghan_quebing.md'] },
  { id: 'jingui', title: '金匮要略', cat: '经典', desc: '23 篇完整解读（含第 5/6/7 篇讲课实录）', files: ['modules/04_jingui.md', 'modules/05_huangdi_neijing.md'] },
  { id: 'neijing', title: '黄帝内经', cat: '经典', desc: '461 页讲义详细篇目', files: ['modules/08_huangdi_detail.md'] },
  { id: 'bencao', title: '针灸 · 本草 · 天纪', cat: '本草针灸', desc: '针灸教程 + 神农本草经 374 种 + 紫微斗数/易经/风水', files: ['modules/09_zhenjiu_bencao.md'] },
  { id: 'talks', title: '演讲与对话', cat: '演讲', desc: '扶阳论坛 / 仲景心法 / 斯坦福 / 梁冬对话 / 闭门课 / 易筋经', files: ['modules/10_fuyang_luntan.md', 'modules/11_zhongjing_xinfa.md', 'modules/12_stanford_jingfang.md', 'modules/14_yijinjing_bidu.md', 'modules/06_liangdong.md', 'modules/07_bimen_hantang.md'] },
  { id: 'bianzheng', title: '辨证与速查', cat: '速查', desc: '六经辨证公式 / 诊断经验 / 针灸速查 / 临床剂量', files: ['references/distilled/01-six-meridian-formulas.md', 'references/distilled/03-clinical-experience.md', 'references/distilled/02-acupuncture-quick-ref.md', 'references/distilled/04-acupuncture-highlights.md', 'references/distilled/05-clinical-dose-quickref.md', 'references/distilled/06-clinical-dose-c99.md'] },
  { id: 'yian', title: '医案与叙事', cat: '医案', desc: '243 例分类叙事医案 + 243 条超长医案清单 + 医案集', files: ['cases/01_cancer.md', 'cases/02_cardiovascular.md', 'cases/03_metabolic.md', 'cases/04_autoimmune.md', 'cases/05_neurological.md', 'cases/06_other.md', 'distilled_cases.md', 'modules/03_yian.md'] },
  { id: 'biaoda', title: '倪师口述风格', cat: '核心', desc: '表达 DNA 与口述范例', files: ['expression_style.md'] },
];

const MAX_CHUNK = 7000;

function splitLong(text, baseTitle) {
  if (text.length <= MAX_CHUNK) return [{ title: baseTitle, text }];
  const paras = text.split(/\n{2,}/);
  const out = [];
  let buf = '';
  for (const p of paras) {
    if (buf.length && buf.length + p.length + 2 > MAX_CHUNK) {
      out.push(buf);
      buf = '';
    }
    buf += (buf ? '\n\n' : '') + p;
  }
  if (buf.trim()) out.push(buf);
  return out.map((t, i) => ({ title: i === 0 ? baseTitle : `${baseTitle}（续${i + 1}）`, text: t }));
}

const sections = [];
const books = [];

for (const b of BOOKS) {
  let count = 0;
  for (const f of b.files) {
    const full = path.join(SRC, f);
    if (!fs.existsSync(full)) { console.warn('missing', f); continue; }
    const raw = clean(fs.readFileSync(full, 'utf8'));
    const lines = raw.split('\n');
    let current = { title: '', level: 2, body: [] };
    let docTitle = '';
    const flush = () => {
      const text = current.body.join('\n').trim();
      if (!text) return;
      for (const chunk of splitLong(text, current.title || docTitle || b.title)) {
        const id = `${b.id}-${++count}`;
        sections.push({
          id, book: b.id, bookTitle: b.title, cat: b.cat,
          title: chunk.title, text: chunk.text, chars: chunk.text.length,
        });
      }
    };
    for (const line of lines) {
      const h1 = line.match(/^#\s+(.+)$/);
      const h2 = line.match(/^##\s+(.+)$/);
      if (h1) { docTitle = h1[1].trim(); continue; }
      if (h2) { flush(); current = { title: h2[1].trim(), level: 2, body: [] }; continue; }
      if (!current.title) {
        if (!docTitle) {
          if (line.trim()) docTitle = line.replace(/^#+\s*/, '').trim();
          continue;
        }
        current.title = docTitle;
      }
      current.body.push(line);
    }
    flush();
  }
  books.push({ id: b.id, title: b.title, cat: b.cat, desc: b.desc, count });
}

fs.writeFileSync(path.join(OUT, 'library.json'), JSON.stringify({ books, sections }, null, 0));

/* ---------- 医案：解析 1257 例合并表 ---------- */
const caseRaw = clean(read('cases/00_merged_table.md'));
const caseRows = [];
const cats = [
  ['癌症', /癌|瘤|白血病|血癌|淋巴/],
  ['心血管', /心脏|血压|中风|动脉|血管|心衰|瓣膜/],
  ['代谢', /糖尿病|肾|肝|腹水|尿酸|痛风|肥胖|胆|结石/],
  ['自身免疫', /类风湿|红斑狼疮|风湿|过敏|干癣|牛皮癣|关节炎/],
  ['神经精神', /癫痫|帕金森|忧郁|失眠|自闭|渐冻|ALS|焦虑|神经/],
];
const categorize = (s) => {
  for (const [name, re] of cats) if (re.test(s)) return name;
  return '其他';
};
const splitRow = (line) => {
  let s = line.trim();
  if (!s.startsWith('|')) return null;
  s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  s = s.replace(/\\\|/g, '\u0001');
  const cells = s.split('|').map((c) => c.replace(/\u0001/g, '|').trim());
  return cells;
};
for (const line of caseRaw.split('\n')) {
  const cells = splitRow(line);
  if (!cells || cells.length < 12) continue;
  if (!/^\d+$/.test(cells[0])) continue;
  const [no, date, patient, diagnosis, pathology, western, formula, acupuncture, method, result, advice, view] = cells;
  if (diagnosis === '主要诊断(中医)' || /^-+$/.test(diagnosis)) continue;
  caseRows.push({
    no: Number(no), date, patient, diagnosis, pathology, western, formula,
    acupuncture, method, result, advice, view, cat: categorize(diagnosis + ' ' + pathology),
  });
}
fs.writeFileSync(path.join(OUT, 'cases.json'), JSON.stringify(caseRows, null, 0));

/* ---------- 方剂：解析剂量速查表 ---------- */
const formulas = {};
const ensure = (name) => {
  name = name.replace(/\*\*/g, '').replace(/（.*?）/g, '').trim();
  if (!name || name.length > 22) return null;
  if (!formulas[name]) formulas[name] = { name, original: '', clinical: '', notes: '', indications: '', source: '' };
  return formulas[name];
};

function parseTableFile(file, colMap, source) {
  const raw = clean(read(file));
  for (const line of raw.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line);
    if (!cells || cells.length < 3) continue;
    const name = cells[colMap.name];
    if (!name || /^-+$/.test(name) || name.includes('方名')) continue;
    const item = ensure(name);
    if (!item) continue;
    if (colMap.original != null && cells[colMap.original]) item.original = item.original || cells[colMap.original];
    if (colMap.clinical != null && cells[colMap.clinical]) item.clinical = item.clinical || cells[colMap.clinical];
    if (colMap.notes != null && cells[colMap.notes]) item.notes = item.notes ? item.notes : cells[colMap.notes];
    if (!item.source) item.source = source;
  }
}
parseTableFile('references/distilled/05-clinical-dose-quickref.md', { name: 0, original: 1, clinical: 2, notes: 3 }, '倪师临床剂量速查');

// 06 文件里不同小节列数不同：3 列（方名/临床/要点）或 4 列（方名/原方/临床/备注）
const raw06 = clean(read('references/distilled/06-clinical-dose-c99.md'));
for (const line of raw06.split('\n')) {
  if (!line.trim().startsWith('|')) continue;
  const cells = splitRow(line);
  if (!cells || cells.length < 3) continue;
  const name = cells[0];
  if (!name || /^-+$/.test(name) || name.includes('方名')) continue;
  const item = ensure(name);
  if (!item) continue;
  if (cells.length === 3) {
    if (cells[1]) item.clinical = item.clinical || cells[1];
    if (cells[2]) item.notes = item.notes ? item.notes : cells[2];
  } else {
    if (cells[1]) item.original = item.original || cells[1];
    if (cells[2]) item.clinical = item.clinical || cells[2];
    if (cells[3]) item.notes = item.notes ? item.notes : cells[3];
  }
  if (!item.source) item.source = 'C类方临床剂量速查';
}

// SKILL.md 感冒六方表：补充主症
const skillRaw = clean(read('SKILL.md'));
const eStart = skillRaw.indexOf('## E. 感冒六大经方速查');
const eEnd = skillRaw.indexOf('## F.', eStart);
if (eStart > 0 && eEnd > eStart) {
  for (const line of skillRaw.slice(eStart, eEnd).split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line);
    if (!cells || cells.length < 4) continue;
    if (cells[0].includes('方剂') || /^-+$/.test(cells[0])) continue;
    const item = ensure(cells[0]);
    if (!item) continue;
    item.indications = cells[1];
    item.original = item.original || cells[2].replace(/（源.*?）/g, '');
    item.clinical = item.clinical || cells[3].replace(/（源.*?）/g, '');
    item.source = item.source || 'SKILL.md 感冒六方';
  }
}

// 手工补充核心方（原方来自六经诊断公式，临床按 一两=一钱 换算并标注）
const extrasPath = path.join(OUT, 'formula-extras.json');
if (fs.existsSync(extrasPath)) {
  for (const ex of JSON.parse(fs.readFileSync(extrasPath, 'utf8'))) {
    const item = ensure(ex.name);
    if (!item) continue;
    item.original = item.original || ex.original;
    item.clinical = item.clinical || ex.clinical;
    item.notes = item.notes || ex.notes || '';
    item.indications = item.indications || ex.indications || '';
    item.source = item.source || ex.source || '六经辨证公式（原方）';
  }
}

fs.writeFileSync(path.join(OUT, 'formulas.json'), JSON.stringify(Object.values(formulas), null, 0));

const stats = {
  books: books.length,
  sections: sections.length,
  chars: sections.reduce((a, s) => a + s.chars, 0),
  cases: caseRows.length,
  formulas: Object.keys(formulas).length,
};
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats));
console.log(stats);
