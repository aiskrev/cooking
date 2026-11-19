// Рецептите остават в Markdown (src/content/recipes/<адрес>/index.md + photos/): това е единственият източник на истината.
// Тук: четене, нормализиране, проверка, атомарен запис, ревизии и хеш на съдържанието.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { sha256 } from './crypto.mjs';

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const COLLECTIONS = { traditional: 'Традиционна кухня', 'fine-dining': 'Съвременна кухня и фино ядене' };
export const DIFFICULTIES = ['лесна', 'средна', 'сложна'];
export const STATUSES = { verified: 'Проверена', reconstruction: 'Реконструкция', review: 'За преглед', incomplete: 'Непълна' };
export const PUBLICATIONS = { draft: 'Чернова', published: 'Публикувана', archived: 'Архив' };
export const PLACEHOLDER_ALT = '(добавете описание)';

const KEY_ORDER = ['title', 'description', 'intro', 'context', 'date', 'updated', 'status', 'review', 'illustrative', 'featured', 'publication',
  'collection', 'category', 'method', 'cuisine', 'tags', 'prepTime', 'cookTime', 'restTime', 'servings', 'difficulty', 'cover', 'carousel',
  'photos', 'mise', 'technique', 'temperature', 'balance', 'ingredients', 'steps', 'tips', 'mistakes', 'substitutions', 'plating', 'serving',
  'storage', 'allergens'];

const dirOf = (ctx, slug) => path.join(ctx.config.contentDir, slug);
export const photoDir = (ctx, slug) => path.join(dirOf(ctx, slug), 'photos');
const IMG_RE = /\.(jpe?g|png|webp|avif)$/i;

export function slugs(ctx) {
  if (!fs.existsSync(ctx.config.contentDir)) return [];
  return fs.readdirSync(ctx.config.contentDir, { withFileTypes: true }).filter((e) => e.isDirectory() && SLUG_RE.test(e.name)).map((e) => e.name).sort();
}

export function listPhotoFiles(ctx, slug) {
  const d = photoDir(ctx, slug);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => IMG_RE.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : [];
}

export function parseMarkdown(raw) {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/.exec(raw.replace(/\r\n/g, '\n'));
  if (!m) throw new Error('липсва frontmatter');
  return { data: YAML.parse(m[1]) ?? {}, body: (m[2] ?? '').replace(/^\n+/, '').replace(/\s+$/, '') };
}

export function readRecipe(ctx, slug) {
  const file = path.join(dirOf(ctx, slug), 'index.md');
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  try {
    const { data, body } = parseMarkdown(fs.readFileSync(file, 'utf8'));
    return { slug, data, body, mtime: st.mtimeMs, error: null };
  } catch (e) {
    return { slug, data: {}, body: '', mtime: st.mtimeMs, error: e.message };
  }
}

/** Хеш на цялото съдържание на рецептата (текст + списък и размер на снимките) – за „има непубликувани промени“. */
export function contentHash(ctx, slug) {
  const file = path.join(dirOf(ctx, slug), 'index.md');
  if (!fs.existsSync(file)) return null;
  const parts = [fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')];
  for (const f of listPhotoFiles(ctx, slug)) parts.push(f + ':' + fs.statSync(path.join(photoDir(ctx, slug), f)).size);
  return sha256(parts.join('\n')).slice(0, 20);
}

export function summary(ctx, r) {
  const d = r.data;
  const files = listPhotoFiles(ctx, r.slug);
  return {
    slug: r.slug, title: d.title ?? r.slug, category: d.category ?? '', collection: d.collection ?? 'traditional',
    publication: d.publication ?? 'published', status: d.status ?? 'reconstruction', review: !!d.review,
    cover: d.cover && files.includes(d.cover) ? d.cover : (files[0] ?? null), photos: files.length,
    updatedMs: r.mtime, error: r.error, tags: d.tags ?? [], difficulty: d.difficulty ?? '', method: d.method ?? [],
    steps: (d.steps ?? []).length,
  };
}

export function allSummaries(ctx) {
  return slugs(ctx).map((s) => readRecipe(ctx, s)).filter(Boolean).map((r) => summary(ctx, r));
}

// ---------- Нормализиране на данните от формата ----------
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const optStr = (o, k, v) => { const s = str(v); if (s) o[k] = s; };
const intOr = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Превръща данните от редактора в обект, съвместим със схемата на сайта (src/content.config.ts). */
export function normalize(input, existing = {}) {
  const d = {};
  d.title = str(input.title);
  d.description = str(input.description);
  optStr(d, 'intro', input.intro);
  optStr(d, 'context', input.context);
  d.date = str(input.date) || str(existing.date) || new Date().toISOString().slice(0, 10);
  d.updated = new Date().toISOString().slice(0, 10);
  d.status = input.status in STATUSES ? input.status : 'reconstruction';
  d.review = !!input.review;
  d.illustrative = !!input.illustrative;
  d.featured = !!input.featured;
  d.publication = input.publication in PUBLICATIONS ? input.publication : (existing.publication ?? 'published');
  d.collection = input.collection in COLLECTIONS ? input.collection : 'traditional';
  d.category = str(input.category);
  d.method = list(input.method);
  optStr(d, 'cuisine', input.cuisine);
  d.tags = list(input.tags);
  d.prepTime = intOr(input.prepTime); d.cookTime = intOr(input.cookTime); d.restTime = intOr(input.restTime);
  d.servings = intOr(input.servings, 4);
  if (DIFFICULTIES.includes(input.difficulty)) d.difficulty = input.difficulty;
  optStr(d, 'cover', input.cover);
  const car = list(input.carousel); if (car.length) d.carousel = car;
  d.photos = {};
  for (const [file, m] of Object.entries(input.photos ?? {})) {
    const o = { alt: str(m?.alt) };
    optStr(o, 'caption', m?.caption); optStr(o, 'session', m?.session); optStr(o, 'provenance', m?.provenance);
    if (Number.isInteger(m?.order)) o.order = m.order;
    d.photos[file] = o;
  }
  d.mise = list(input.mise);
  optStr(d, 'technique', input.technique); optStr(d, 'temperature', input.temperature); optStr(d, 'balance', input.balance);
  d.ingredients = (input.ingredients ?? []).map((g) => {
    const out = {}; optStr(out, 'title', g.title);
    out.items = (g.items ?? []).map((it) => {
      if (typeof it === 'string') return { name: str(it), scale: false };
      const o = { name: str(it.name) };
      const a = typeof it.amount === 'string' ? parseFloat(it.amount.replace(',', '.')) : it.amount;
      if (Number.isFinite(a) && a > 0) o.amount = a;
      optStr(o, 'unit', it.unit); optStr(o, 'note', it.note);
      o.scale = it.scale !== false && o.amount !== undefined;
      return o;
    }).filter((o) => o.name);
    return out;
  }).filter((g) => g.items.length);
  d.steps = (input.steps ?? []).map((s) => {
    const o = {}; optStr(o, 'title', s.title); o.text = str(s.text);
    optStr(o, 'why', s.why); optStr(o, 'cue', s.cue); optStr(o, 'avoid', s.avoid);
    const t = intOr(s.time, 0); if (t > 0) o.time = t;
    optStr(o, 'photo', s.photo);
    return o;
  }).filter((s) => s.text || s.title);
  d.tips = list(input.tips); d.mistakes = list(input.mistakes); d.substitutions = list(input.substitutions);
  optStr(d, 'plating', input.plating); optStr(d, 'serving', input.serving); optStr(d, 'storage', input.storage);
  d.allergens = list(input.allergens);
  // Непознатите ключове от съществуващия файл се запазват
  for (const [k, v] of Object.entries(existing)) if (!KEY_ORDER.includes(k)) d[k] = v;
  return d;
}

// ---------- Проверка ----------
/** Връща {errors, warnings, publishBlockers}: грешките пречат на запис, блокиращите условия – на публикуване. */
export function validate(ctx, slug, d, { checkTitleAgainstOthers = true } = {}) {
  const errors = [], warnings = [], publishBlockers = [];
  const E = (field, msg) => errors.push({ field, msg });
  const files = listPhotoFiles(ctx, slug);
  if (!SLUG_RE.test(slug)) E('slug', 'Адресът може да съдържа само малки латински букви, цифри и тирета.');
  if (!d.title) E('title', 'Заглавието е задължително.');
  else if (d.title.length > 120) E('title', 'Заглавието е твърде дълго (най-много 120 знака).');
  if (d.description.length > 240) E('description', 'Описанието е над 240 знака.');
  if (!d.category) E('category', 'Изберете категория.');
  if (!(d.servings >= 1)) E('servings', 'Порциите трябва да са поне 1.');
  if (d.prepTime + d.cookTime <= 0) warnings.push({ field: 'prepTime', msg: 'Не е посочено време за приготвяне.' });
  if (!d.ingredients.length) E('ingredients', 'Добавете поне една съставка.');
  if (!d.steps.length) E('steps', 'Добавете поне една стъпка.');
  d.ingredients.forEach((g, gi) => g.items.forEach((it, ii) => {
    if (!it.name) E(`ingredients.${gi}.${ii}`, 'Съставка без име.');
    if (it.scale && !it.amount) E(`ingredients.${gi}.${ii}`, `„${it.name}“: преоразмеряването изисква количество.`);
  }));
  const used = new Set();
  d.steps.forEach((s, i) => {
    if (!s.text) E(`steps.${i}`, `Стъпка ${i + 1}: липсва текст.`);
    if (s.photo) {
      if (!files.includes(s.photo)) E(`steps.${i}`, `Стъпка ${i + 1}: снимката „${s.photo}“ не съществува.`);
      if (used.has(s.photo)) E(`steps.${i}`, `Стъпка ${i + 1}: същата снимка е вече при друга стъпка.`);
      used.add(s.photo);
    }
  });
  if (d.cover && !files.includes(d.cover)) E('cover', 'Заглавната снимка не съществува.');
  if ((d.carousel ?? []).length > 10) E('carousel', 'Фото-историята е до 10 кадъра.');
  for (const f of d.carousel ?? []) if (!files.includes(f)) E('carousel', `Фото-история: липсва „${f}“.`);
  for (const f of files) {
    const m = d.photos[f];
    if (!m || m.alt.length < 5) E('photos', `Снимка „${f}“: описанието (alt) е задължително, поне 5 знака.`);
    else if (m.alt.includes(PLACEHOLDER_ALT)) publishBlockers.push(`Снимка „${f}“ още няма собствено описание (alt).`);
  }
  for (const f of Object.keys(d.photos)) if (!files.includes(f)) E('photos', `Има описание за липсваща снимка „${f}“.`);
  if (checkTitleAgainstOthers && d.title) {
    for (const o of slugs(ctx)) {
      if (o === slug) continue;
      const r = readRecipe(ctx, o);
      if (r && r.data.title === d.title) E('title', `Заглавие „${d.title}“ вече е използвано в „${o}“.`);
    }
  }
  if (d.description.length < 20) publishBlockers.push('Описанието е твърде кратко (поне 20 знака).');
  if (files.length && !d.cover) publishBlockers.push('Изберете заглавна снимка.');
  if (d.illustrative && !files.length) warnings.push({ field: 'illustrative', msg: 'Белязана е като илюстративна, но няма снимки.' });
  const text = JSON.stringify(d);
  for (const bad of ['TODO', 'ОПИШЕТЕ', 'Lorem', 'undefined', '[object']) if (text.includes(bad)) E('title', `Текстът съдържа „${bad}“.`);
  return { errors, warnings, publishBlockers };
}

// ---------- Запис ----------
export function serialize(d, body = '') {
  const ordered = {};
  for (const k of KEY_ORDER) if (d[k] !== undefined) ordered[k] = d[k];
  for (const k of Object.keys(d)) if (!(k in ordered)) ordered[k] = d[k];
  const yaml = YAML.stringify(ordered, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
  return `---\n${yaml}---\n${body ? '\n' + body.trim() + '\n' : ''}`;
}

/** Атомарен запис: временен файл + преименуване – при срив остава старият файл. */
export function writeRecipe(ctx, slug, d, body = '') {
  const dir = dirOf(ctx, slug);
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  const target = path.join(dir, 'index.md');
  const tmp = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, serialize(d, body), 'utf8');
  fs.renameSync(tmp, target);
}

// ---------- Ревизии ----------
export function recordRevision(ctx, slug, action, data, body, userId) {
  return ctx.db.tx(() => {
    const rev = (ctx.db.get('SELECT MAX(rev) AS m FROM recipe_revisions WHERE slug = ?', slug)?.m ?? 0) + 1;
    ctx.db.run('INSERT INTO recipe_revisions (slug, rev, action, snapshot, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      slug, rev, action, JSON.stringify({ data, body }), userId ?? null, Date.now());
    ctx.db.run('DELETE FROM recipe_revisions WHERE slug = ? AND rev <= ?', slug, rev - 60); // пазят се последните 60
    return rev;
  });
}
export const listRevisions = (ctx, slug) =>
  ctx.db.all('SELECT r.rev, r.action, r.created_at, u.display_name AS author FROM recipe_revisions r LEFT JOIN admin_users u ON u.id = r.author_id WHERE r.slug = ? ORDER BY r.rev DESC', slug);
export const getRevision = (ctx, slug, rev) => {
  const r = ctx.db.get('SELECT * FROM recipe_revisions WHERE slug = ? AND rev = ?', slug, rev);
  return r ? { ...r, snapshot: JSON.parse(r.snapshot) } : null;
};

// ---------- Категории и етикети (за списъци и редактора) ----------
export function vocabulary(ctx) {
  const cats = new Map(), tags = new Map(), methods = new Map();
  for (const s of slugs(ctx)) {
    const r = readRecipe(ctx, s); if (!r || r.error) continue;
    if (r.data.category) cats.set(r.data.category, (cats.get(r.data.category) ?? 0) + 1);
    for (const t of r.data.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
    for (const t of r.data.method ?? []) methods.set(t, (methods.get(t) ?? 0) + 1);
  }
  const sort = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'bg')).map(([name, count]) => ({ name, count }));
  return { categories: sort(cats), tags: sort(tags), methods: sort(methods) };
}
