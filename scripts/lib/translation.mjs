// Превод на рецептите BG -> EN: извличане на преводимия текст, сглобяване на index.en.md, проверка на двойките.
// Ползва се от скриптовете (npm run translations:*) и от администрацията (cms/), за да има една логика на двете места.
// Български (index.md) е единственият източник; английският файл (index.en.md) е негов превод със същите снимки и числа.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';

export const EN_FILE = 'index.en.md';
export const BG_FILE = 'index.md';
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const KEY_ORDER = ['title', 'description', 'intro', 'context', 'date', 'updated', 'status', 'review', 'illustrative', 'featured', 'publication',
  'collection', 'category', 'method', 'cuisine', 'tags', 'prepTime', 'cookTime', 'restTime', 'servings', 'difficulty', 'cover', 'carousel',
  'photos', 'mise', 'technique', 'temperature', 'balance', 'ingredients', 'steps', 'tips', 'mistakes', 'substitutions', 'plating', 'serving',
  'storage', 'allergens', 'translation'];

// Полета, които са общи за двата езика и трябва да са еднакви (проверява се автоматично)
export const SHARED_FIELDS = ['date', 'status', 'review', 'illustrative', 'featured', 'collection', 'prepTime', 'cookTime', 'restTime', 'servings', 'cover', 'carousel'];
// Незадължителни текстови полета – ако ги има в оригинала, трябва да ги има и в превода
const OPT_TEXT = ['intro', 'context', 'technique', 'temperature', 'balance', 'plating', 'serving', 'storage'];
const LIST_TEXT = ['mise', 'tips', 'mistakes', 'substitutions'];

export const TRANSLATION_STATUSES = ['draft', 'needs-review', 'ready', 'published'];

// ---------- Файлове ----------
export function parseMarkdown(raw) {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/.exec(raw.replace(/\r\n/g, '\n'));
  if (!m) throw new Error('липсва frontmatter');
  return { data: YAML.parse(m[1]) ?? {}, body: (m[2] ?? '').replace(/^\n+/, '').replace(/\s+$/, '') };
}

export function serialize(d, body = '') {
  const ordered = {};
  for (const k of KEY_ORDER) if (d[k] !== undefined) ordered[k] = d[k];
  for (const k of Object.keys(d)) if (!(k in ordered)) ordered[k] = d[k];
  const yaml = YAML.stringify(ordered, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
  return `---\n${yaml}---\n${body ? '\n' + body.trim() + '\n' : ''}`;
}

export function loadTaxonomy(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/taxonomy.json'), 'utf8'));
}
export function loadPolicy(root = process.cwd()) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/policy.json'), 'utf8')); } catch { return { publishBulgarianWithoutEnglish: true }; }
}

/** Всички рецепти в папка: [{ slug, dir, bg, bgBody, en, enBody, error }] – безопасно: само папки със валиден адрес */
export function readAll(contentDir) {
  const out = [];
  for (const e of fs.readdirSync(contentDir, { withFileTypes: true })) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
    const dir = path.join(contentDir, e.name);
    const item = { slug: e.name, dir, bg: null, bgBody: '', en: null, enBody: '', error: null };
    try {
      const bgFile = path.join(dir, BG_FILE);
      if (fs.existsSync(bgFile)) { const p = parseMarkdown(fs.readFileSync(bgFile, 'utf8')); item.bg = p.data; item.bgBody = p.body; }
      const enFile = path.join(dir, EN_FILE);
      if (fs.existsSync(enFile)) { const p = parseMarkdown(fs.readFileSync(enFile, 'utf8')); item.en = p.data; item.enBody = p.body; }
    } catch (err) { item.error = err.message; }
    out.push(item);
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

// ---------- Преводим текст и хеш на източника ----------
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; return o; };

/** Само текстът, който се превежда (в български) – формат на файловете за превод */
export function extractSource(bg) {
  const photos = {}; const sessions = new Set();
  for (const [file, m] of Object.entries(bg.photos ?? {})) {
    // alt = „<Заглавие>: <подпис>“ се извежда автоматично и от превода – така файлът за превод е по-кратък
    const derived = m.caption && m.alt === `${bg.title}: ${m.caption}`;
    photos[file] = clean({ alt: derived ? undefined : m.alt, caption: m.caption });
    if (m.session) sessions.add(m.session);
  }
  return clean({
    title: bg.title, description: bg.description, intro: bg.intro, context: bg.context,
    mise: bg.mise, technique: bg.technique, temperature: bg.temperature, balance: bg.balance,
    ingredients: (bg.ingredients ?? []).map((g) => clean({
      title: g.title,
      items: g.items.map((it) => (typeof it === 'string' ? { name: it } : clean({ name: it.name, note: it.note }))),
    })),
    steps: (bg.steps ?? []).map((s) => clean({ title: s.title, text: s.text, why: s.why, cue: s.cue, avoid: s.avoid })),
    tips: bg.tips, mistakes: bg.mistakes, substitutions: bg.substitutions,
    plating: bg.plating, serving: bg.serving, storage: bg.storage,
    photos,
    sessions: Object.fromEntries([...sessions].map((s) => [s, s])),
  });
}

/** Всичко останало, което влияе на превода: числа, снимки, таксономия – при промяна преводът е „остарял“ */
function structureOf(bg) {
  return {
    shared: Object.fromEntries(SHARED_FIELDS.map((k) => [k, bg[k] ?? null])),
    taxonomy: { category: bg.category, method: bg.method ?? [], cuisine: bg.cuisine ?? null, tags: bg.tags ?? [], difficulty: bg.difficulty ?? null, allergens: bg.allergens ?? [] },
    ingredients: (bg.ingredients ?? []).map((g) => g.items.map((it) => (typeof it === 'string' ? null : [it.amount ?? null, it.unit ?? null, it.scale ?? null]))),
    steps: (bg.steps ?? []).map((s) => [s.time ?? null, s.photo ?? null]),
    photos: Object.fromEntries(Object.entries(bg.photos ?? {}).map(([f, m]) => [f, [m.order ?? null, m.provenance ?? null]])),
  };
}

export function sourceHash(bg, bgBody = '') {
  return crypto.createHash('sha256').update(JSON.stringify({ s: extractSource(bg), t: structureOf(bg), b: bgBody })).digest('hex').slice(0, 16);
}

/** Състояние на превода на една рецепта: missing | draft | needs-review | ready | published | outdated */
export function translationState(item) {
  if (!item.bg) return 'no-source';
  if (!item.en) return 'missing';
  const tr = item.en.translation ?? {};
  if (tr.sourceHash && tr.sourceHash !== sourceHash(item.bg, item.bgBody)) return 'outdated';
  return tr.status ?? 'draft';
}

// ---------- Сглобяване на английската рецепта ----------
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Прави данните на index.en.md от оригинала и файл с превод ({title, steps, ...} – виж extractSource).
 * Числата, снимките и общите полета се копират от оригинала; таксономията и мерните единици – от речника.
 */
export function buildEnglish(bg, payload, tax, { status = 'draft', reviewed = false, translator = 'AI-assisted translation', today = new Date().toISOString().slice(0, 10), bgBody = '' } = {}) {
  const problems = [];
  const P = (m) => problems.push(m);
  const need = (v, what) => { const s = str(v); if (!s) P(`липсва превод: ${what}`); return s; };
  const en = {};
  en.title = need(payload.title, 'title');
  en.description = need(payload.description, 'description');
  for (const k of ['intro', 'context']) if (bg[k]) en[k] = need(payload[k], k);
  en.date = bg.date; if (bg.updated) en.updated = bg.updated;
  for (const k of ['status', 'review', 'illustrative', 'featured', 'collection']) en[k] = bg[k];

  const term = (group, v) => {
    const t = tax[group]?.[v];
    if (t === undefined) P(`няма превод в taxonomy.json (${group}): „${v}“`);
    return t ?? v;
  };
  en.category = term('category', bg.category);
  en.method = (bg.method ?? []).map((v) => term('method', v));
  if (bg.cuisine) en.cuisine = term('cuisine', bg.cuisine);
  en.tags = (bg.tags ?? []).map((v) => term('tag', v));
  for (const k of ['prepTime', 'cookTime', 'restTime', 'servings']) en[k] = bg[k];
  if (bg.difficulty) en.difficulty = term('difficulty', bg.difficulty);
  if (bg.cover) en.cover = bg.cover;
  if (bg.carousel) en.carousel = [...bg.carousel];

  const sessions = payload.sessions ?? {};
  en.photos = {};
  for (const [file, m] of Object.entries(bg.photos ?? {})) {
    const pm = payload.photos?.[file] ?? {};
    const derived = m.caption && m.alt === `${bg.title}: ${m.caption}`;
    const cap = m.caption ? need(pm.caption, `photos.${file}.caption`) : undefined;
    const o = { alt: derived && !str(pm.alt) ? `${str(payload.altName) || en.title}: ${cap}` : need(pm.alt, `photos.${file}.alt`) };
    if (m.caption) o.caption = cap;
    if (m.session) { const s = str(sessions[m.session]) || str(tax.session?.[m.session]); if (!s || s === m.session) P(`липсва превод на сесията „${m.session}“`); o.session = s || m.session; }
    if (m.order !== undefined) o.order = m.order;
    if (m.provenance) o.provenance = m.provenance; // произходът на снимката не се превежда и не се променя
    en.photos[file] = o;
  }

  const listOf = (k) => {
    const src = bg[k] ?? []; const tr = payload[k] ?? [];
    if (src.length !== tr.length) P(`${k}: ${tr.length} реда в превода, ${src.length} в оригинала`);
    return src.map((_, i) => str(tr[i]));
  };
  for (const k of LIST_TEXT) { const v = listOf(k); if (v.length) en[k] = v; if (v.some((x) => !x)) P(`${k}: празен превод`); }
  for (const k of ['technique', 'temperature', 'balance']) if (bg[k]) en[k] = need(payload[k], k);

  const pg = payload.ingredients ?? [];
  if (pg.length !== (bg.ingredients ?? []).length) P(`ingredients: ${pg.length} групи в превода, ${(bg.ingredients ?? []).length} в оригинала`);
  en.ingredients = (bg.ingredients ?? []).map((g, gi) => {
    const pgi = pg[gi] ?? {};
    const g2 = {};
    if (g.title) g2.title = need(pgi.title, `ingredients.${gi}.title`);
    if ((pgi.items ?? []).length !== g.items.length) P(`ingredients.${gi}: ${(pgi.items ?? []).length} съставки в превода, ${g.items.length} в оригинала`);
    g2.items = g.items.map((it, ii) => {
      const pi = pgi.items?.[ii] ?? {};
      if (typeof it === 'string') return need(typeof pi === 'string' ? pi : pi.name, `ingredients.${gi}.${ii}`);
      const o = { name: need(pi.name, `ingredients.${gi}.${ii}.name`) };
      if (it.amount !== undefined) o.amount = it.amount;
      if (it.unit) { const u = term('unit', it.unit); if (u) o.unit = u; }
      if (it.note) o.note = need(pi.note, `ingredients.${gi}.${ii}.note`);
      o.scale = it.scale;
      return o;
    });
    return g2;
  });

  const ps = payload.steps ?? [];
  if (ps.length !== (bg.steps ?? []).length) P(`steps: ${ps.length} стъпки в превода, ${(bg.steps ?? []).length} в оригинала`);
  en.steps = (bg.steps ?? []).map((s, i) => {
    const p = ps[i] ?? {};
    const o = {};
    if (s.title) o.title = need(p.title, `steps.${i}.title`);
    o.text = need(p.text, `steps.${i}.text`);
    for (const k of ['why', 'cue', 'avoid']) if (s[k]) o[k] = need(p[k], `steps.${i}.${k}`);
    if (s.time !== undefined) o.time = s.time;
    if (s.photo) o.photo = s.photo;
    return o;
  });
  for (const k of ['plating', 'serving', 'storage']) if (bg[k]) en[k] = need(payload[k], k);
  en.allergens = (bg.allergens ?? []).map((v) => term('allergen', v));
  en.translation = {
    status,
    sourceHash: sourceHash(bg, bgBody),
    reviewed,
    translator,
    updated: today,
  };
  return { data: en, problems };
}

// ---------- Проверка на двойка BG/EN ----------
const CYR = /[А-Яа-яЁёЀ-ӿ]/;
/** 3+ последователни кирилски думи = непреведен български текст (отделни български думи – напр. имена на ястия – са позволени) */
export function untranslatedProse(text) {
  if (typeof text !== 'string' || !CYR.test(text)) return false;
  const tokens = text.split(/[\s,.;:()«»„“"/–—-]+/).filter(Boolean);
  let run = 0;
  for (const tk of tokens) { if (/^[Ѐ-ӿ]{2,}$/.test(tk)) { if (++run >= 3) return true; } else run = 0; }
  return false;
}

function eq(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

/** { errors: string[], warnings: string[] } за една двойка (оригинал + превод) */
export function checkPair(item, tax, { photoFiles = null } = {}) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  const { bg, en } = item;
  if (!bg) { E('липсва index.md'); return { errors, warnings }; }
  if (!en) { E('липсва index.en.md'); return { errors, warnings }; }

  for (const k of SHARED_FIELDS) if (!eq(bg[k], en[k])) E(`общо поле „${k}“ се различава (bg=${JSON.stringify(bg[k])}, en=${JSON.stringify(en[k])})`);
  if (en.publication !== undefined) W('index.en.md не трябва да има „publication“ – публикуването е по оригинала');

  const mapped = (group, v) => (v === undefined || v === null ? v : tax[group]?.[v]);
  const chkTerm = (group, bv, ev, label) => {
    const want = mapped(group, bv);
    if (bv !== undefined && want === undefined) E(`няма превод в taxonomy.json (${group}): „${bv}“`);
    else if (want !== ev) E(`${label}: очаквано „${want}“, има „${ev}“`);
  };
  chkTerm('category', bg.category, en.category, 'category');
  chkTerm('cuisine', bg.cuisine, en.cuisine, 'cuisine');
  chkTerm('difficulty', bg.difficulty, en.difficulty, 'difficulty');
  const arrTerm = (group, a, b, label) => {
    if ((a ?? []).length !== (b ?? []).length) { E(`${label}: ${(b ?? []).length} елемента, в оригинала ${(a ?? []).length}`); return; }
    (a ?? []).forEach((v, i) => chkTerm(group, v, b[i], `${label}[${i}]`));
  };
  arrTerm('method', bg.method, en.method, 'method');
  arrTerm('tag', bg.tags, en.tags, 'tags');
  arrTerm('allergen', bg.allergens, en.allergens, 'allergens');

  // текстове: задължителни и преведени
  const textOk = (v, label) => {
    if (typeof v !== 'string' || !v.trim()) { E(`празен/липсващ превод: ${label}`); return; }
    if (untranslatedProse(v)) E(`има непреведен български текст: ${label}`);
    if (/TODO|Translation pending|Coming soon|ПРЕВЕДЕТЕ|undefined|\[object/i.test(v)) E(`заместващ текст в ${label}`);
    const src = label.split('.').reduce((o, k) => o?.[k], bg);
    if (typeof src === 'string' && src.length > 12 && src.trim() === v.trim()) E(`преводът съвпада с оригинала: ${label}`);
  };
  textOk(en.title, 'title'); textOk(en.description, 'description');
  if ((en.description ?? '').length > 240) E('description е над 240 знака');
  for (const k of OPT_TEXT) { if (bg[k]) textOk(en[k], k); else if (en[k]) W(`„${k}“ го няма в оригинала`); }
  for (const k of LIST_TEXT) {
    if ((bg[k] ?? []).length !== (en[k] ?? []).length) E(`${k}: ${(en[k] ?? []).length} реда, в оригинала ${(bg[k] ?? []).length}`);
    (en[k] ?? []).forEach((v, i) => textOk(v, `${k}.${i}`));
  }

  // съставки
  const bi = bg.ingredients ?? [], ei = en.ingredients ?? [];
  if (bi.length !== ei.length) E(`ingredients: ${ei.length} групи, в оригинала ${bi.length}`);
  else bi.forEach((g, gi) => {
    if (!!g.title !== !!ei[gi].title) E(`ingredients.${gi}: заглавието на групата не съвпада по наличие`);
    else if (g.title) textOk(ei[gi].title, `ingredients.${gi}.title`);
    if (g.items.length !== ei[gi].items.length) { E(`ingredients.${gi}: ${ei[gi].items.length} съставки, в оригинала ${g.items.length}`); return; }
    g.items.forEach((it, ii) => {
      const x = ei[gi].items[ii]; const at = `ingredients.${gi}.${ii}`;
      if (typeof it === 'string' || typeof x === 'string') { textOk(typeof x === 'string' ? x : '', at); return; }
      textOk(x.name, `${at}.name`);
      if (it.amount !== x.amount) E(`${at}: количеството се различава (${it.amount} ≠ ${x.amount})`);
      if ((it.scale ?? null) !== (x.scale ?? null)) E(`${at}: „scale“ се различава`);
      const wantUnit = it.unit ? (tax.unit?.[it.unit] ?? undefined) : undefined;
      if (it.unit && wantUnit === undefined) E(`${at}: няма превод на мерната единица „${it.unit}“`);
      else if ((wantUnit || undefined) !== (x.unit || undefined)) E(`${at}: единица „${x.unit}“, очаквана „${wantUnit}“`);
      if (!!it.note !== !!x.note) E(`${at}: бележката (note) не съвпада по наличие`);
      else if (it.note) textOk(x.note, `${at}.note`);
    });
  });

  // стъпки
  const bs = bg.steps ?? [], es = en.steps ?? [];
  if (bs.length !== es.length) E(`steps: ${es.length} стъпки, в оригинала ${bs.length}`);
  else bs.forEach((s, i) => {
    textOk(es[i].text, `steps.${i}.text`);
    if (!!s.title !== !!es[i].title) E(`steps.${i}: заглавието не съвпада по наличие`); else if (s.title) textOk(es[i].title, `steps.${i}.title`);
    for (const k of ['why', 'cue', 'avoid']) { if (!!s[k] !== !!es[i][k]) E(`steps.${i}.${k}: не съвпада по наличие`); else if (s[k]) textOk(es[i][k], `steps.${i}.${k}`); }
    if ((s.time ?? null) !== (es[i].time ?? null)) E(`steps.${i}: времето се различава`);
    if ((s.photo ?? null) !== (es[i].photo ?? null)) E(`steps.${i}: снимката се различава`);
  });

  // снимки
  const bk = Object.keys(bg.photos ?? {}).sort(), ek = Object.keys(en.photos ?? {}).sort();
  if (!eq(bk, ek)) E(`снимките в „photos“ не съвпадат (bg: ${bk.length}, en: ${ek.length})`);
  else for (const f of bk) {
    const b = bg.photos[f], e = en.photos[f];
    textOk(e.alt, `photos.${f}.alt`);
    if (!!b.caption !== !!e.caption) E(`photos.${f}: подписът не съвпада по наличие`); else if (b.caption) textOk(e.caption, `photos.${f}.caption`);
    if (!!b.session !== !!e.session) E(`photos.${f}: сесията не съвпада по наличие`); else if (b.session && untranslatedProse(e.session)) E(`photos.${f}.session: непреведен текст`);
    if ((b.order ?? null) !== (e.order ?? null)) E(`photos.${f}: редът се различава`);
    if ((b.provenance ?? null) !== (e.provenance ?? null)) E(`photos.${f}: произходът (provenance) се различава – не се превежда`);
  }
  if (photoFiles) {
    for (const f of [...(en.cover ? [en.cover] : []), ...(en.carousel ?? []), ...es.flatMap((s) => (s.photo ? [s.photo] : []))]) if (!photoFiles.includes(f)) E(`липсваща снимка: ${f}`);
  }

  // метаданни на превода
  const tr = en.translation;
  if (!tr) E('липсва блокът „translation“');
  else {
    if (!TRANSLATION_STATUSES.includes(tr.status)) E(`невалиден translation.status „${tr.status}“`);
    const h = sourceHash(bg, item.bgBody);
    if (tr.sourceHash !== h) W(`преводът е ОСТАРЯЛ: оригиналът е променен след превода (${tr.sourceHash} ≠ ${h})`);
  }
  if (item.enBody && !item.bgBody) W('index.en.md има тяло, а оригиналът няма');
  return { errors, warnings };
}
