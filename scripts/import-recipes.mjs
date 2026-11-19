// Идемпотентен импорт на рецепти и снимки.
//   node scripts/import-recipes.mjs --source /src --inventory reports/_work/inventory.json --defs _private-imports/source-recipes [--dry-run] [--only slug,slug] [--overwrite-edited]
// Изходните снимки се четат САМО за четене; в проекта се записват курирани копии (WebP, ≤1600 px, без метаданни).
// Идемпотентност: манифестът пази SHA-256 на изходния файл и хеш на последно генерирания index.md.
// Ръчно редактиран index.md НЕ се презаписва (докладва се конфликт и се записва index.generated.md).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[i + 1]) : def; };
const SRC = opt('source', '/src');
const INV = opt('inventory', 'reports/_work/inventory.json');
const DEFS = opt('defs', '_private-imports/source-recipes');
const OUT = opt('out', 'src/content/recipes');
const REPORTS = opt('reports', 'reports');
const DRY = !!opt('dry-run', false);
const OVERWRITE = !!opt('overwrite-edited', false);
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// --inventory може да е списък, разделен със запетая (напр. стария и инвентара на новите снимки; номерата им не се застъпват)
const inv = String(INV).split(',').flatMap((f) => JSON.parse(fs.readFileSync(f.trim(), 'utf8')));
const byIdx = new Map(inv.map((r) => [r.idx, r]));

// ---------- YAML (блоков стил, всички низове в двойни кавички = JSON) ----------
const q = (s) => JSON.stringify(s);
function toYaml(v, ind = 0) {
  const pad = '  '.repeat(ind);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return v.map((x) => {
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        const lines = toYamlObj(x, ind + 1).split('\n');
        return `${pad}- ${lines[0].trimStart()}` + (lines.length > 1 ? '\n' + lines.slice(1).join('\n') : '');
      }
      return `${pad}- ${scalar(x)}`;
    }).join('\n');
  }
  return scalar(v);
}
function scalar(x) { return typeof x === 'string' ? q(x) : String(x); }
function toYamlObj(o, ind = 0) {
  const pad = '  '.repeat(ind);
  return Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => {
    if (Array.isArray(v)) return v.length ? `${pad}${k}:\n${toYaml(v, ind + 1)}` : `${pad}${k}: []`;
    if (v && typeof v === 'object') return Object.keys(v).length ? `${pad}${k}:\n${toYamlObj(v, ind + 1)}` : `${pad}${k}: {}`;
    return `${pad}${k}: ${scalar(v)}`;
  }).join('\n');
}

// ---------- Съставки: "400 г кайма (свинско и телешко)" -> структура ----------
const FR = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667 };
const UNITS = ['с. л.', 'ч. л.', 'кг', 'мл', 'г', 'л', 'бр.', 'скилидки', 'скилидка', 'връзка', 'връзки', 'щипка', 'глава', 'глави', 'шепа', 'стръка', 'стрък', 'листа', 'лист', 'филии', 'филия', 'пакет', 'парче', 'парчета', 'ленти'];
export function parseIngredient(text) {
  const s = text.trim();
  if (/^\d+\s*[–-]\s*\d+/.test(s) || /^~/.test(s) || /на вкус|за пържене|за намазване|за поръсване|за сервиране|за смазване/i.test(s)) {
    return noAmount(s, false);
  }
  const m = /^(\d+(?:[.,]\d+)?)?\s*([½¼¾⅓⅔])?\s*(.*)$/.exec(s);
  let amount = null, rest = s;
  if (m && (m[1] || m[2])) {
    amount = (m[1] ? parseFloat(m[1].replace(',', '.')) : 0) + (m[2] ? FR[m[2]] : 0);
    rest = m[3];
  } else return noAmount(s, false);
  let unit = null;
  for (const u of UNITS) {
    if (rest === u || rest.startsWith(u + ' ')) { unit = u; rest = rest.slice(u.length).trim(); break; }
  }
  let note;
  const pm = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(rest);
  if (pm) { rest = pm[1]; note = pm[2]; }
  return { name: rest.trim(), amount: +amount.toFixed(3), ...(unit ? { unit } : {}), ...(note ? { note } : {}), scale: true };
}
function noAmount(s, scale) {
  const pm = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(s);
  return { name: (pm ? pm[1] : s).trim(), ...(pm ? { note: pm[2] } : {}), scale };
}

// ---------- Алергени (редакционна индикация по ключови думи) ----------
const ALLERGENS = [
  ['Глутен', /брашно|хляб|галета|тесто|кори|бишкот|паста|равиоли|козунак|юфка|грис|кори|пшени/i],
  ['Яйца', /яйц|жълтък|белтък/i],
  ['Мляко и млечни продукти', /мляко|кисело мляко|сирене|масло|сметана|кашкавал|извара|рикота|пармезан|краве|кефир|крем/i],
  ['Ядки', /орех|бадем|лешник|фъстък/i],
  ['Риба', /сьомга|треска|риба/i],
  ['Ракообразни и мекотели', /скарид|октопод|стрид|миди|гребенк|скалоп/i],
  ['Целина', /целина/i],
  ['Горчица', /горчица/i],
  ['Сулфити (вино)', /вино|винен/i],
  ['Соя', /мисо|соев/i],
];
const allergensOf = (texts) => ALLERGENS.filter(([, re]) => texts.some((t) => re.test(t))).map(([n]) => n);

// ---------- Зареждане на дефинициите ----------
const defFiles = fs.readdirSync(DEFS).filter((f) => f.endsWith('.mjs')).sort();
const defs = [];
const siteAssets = [];
const addExtras = {}; // { slug: [{ph, cap, session, confidence}] } – допълнителни кадри към вече описани рецепти
for (const f of defFiles) {
  const mod = await import(path.resolve(DEFS, f));
  defs.push(...(mod.default ?? []));
  siteAssets.push(...(mod.siteAssets ?? []));
  for (const [slug, list] of Object.entries(mod.addExtras ?? {})) (addExtras[slug] ||= []).push(...list);
}
for (const [slug, list] of Object.entries(addExtras)) {
  const d = defs.find((x) => x.slug === slug);
  if (!d) throw new Error(`addExtras: няма рецепта „${slug}“`);
  d.extraAdded = [...(d.extraAdded ?? []), ...list]; // вземат се след заглавната снимка, за да не се променят номерата на вече внесените файлове
}
const selected = defs.filter((d) => !ONLY.length || ONLY.includes(d.slug));

const report = { created: [], updated: [], unchanged: [], conflicts: [], errors: [], photos: { converted: 0, reused: 0, pruned: 0, missing: [] } };
const usedSources = new Set();
const today = new Date().toISOString().slice(0, 10);

for (const d of selected) {
  try {
    const dir = path.join(OUT, d.slug);
    const photoDir = path.join(dir, 'photos');
    const manPath = path.join(dir, 'manifest.json');
    const mdPath = path.join(dir, 'index.md');
    const manifest = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { slug: d.slug, photos: {} };
    if (!DRY) fs.mkdirSync(photoDir, { recursive: true });

    // 1. Подреждане на снимките: стъпки (ph), след това допълнителни (extra)
    const photoRows = []; // {file, idx, role, cap, session}
    let n = 0;
    const take = (idx, role, cap, session, hint, confidence) => {
      const row = byIdx.get(idx);
      if (!row) throw new Error(`${d.slug}: липсва снимка с номер #${idx}`);
      if (row.exactDuplicateOf) throw new Error(`${d.slug}: #${idx} е точен дубликат – посочете оригинала`);
      if (d.excludeIdx?.includes(idx)) return null;
      let existing = photoRows.find((p) => p.idx === idx);
      if (existing) return existing;
      n++;
      const file = `${String(n).padStart(2, '0')}-${hint}.webp`;
      const p = { file, idx, role, cap, session, row, confidence };
      photoRows.push(p); usedSources.add(row.name);
      return p;
    };
    const stepsOut = d.steps.map((s, i) => {
      let photo;
      if (s.ph) {
        const p = take(s.ph, 'step', s.cap, d.session, d.slug.split('-')[0] + '-stapka-' + (i + 1));
        photo = p?.file;
      }
      const { ph, cap, ...rest } = s;
      return { ...(s.title ? { title: s.title } : {}), text: s.text, ...(s.why ? { why: s.why } : {}), ...(s.cue ? { cue: s.cue } : {}), ...(s.avoid ? { avoid: s.avoid } : {}), ...(s.time ? { time: s.time } : {}), ...(photo ? { photo } : {}) };
    });
    for (const [k, e] of (d.extra ?? []).entries()) take(e.ph, 'extra', e.cap, e.session ?? 'Допълнителна сесия', `dopalnitelen-${k + 1}`, e.confidence);
    const cover = d.cover ? (photoRows.find((p) => p.idx === d.cover) ?? take(d.cover, 'hero', d.coverCap ?? 'Готовото ястие', d.session, 'gotovo-yastie')) : photoRows[0];
    for (const [k, e] of (d.extraAdded ?? []).entries()) take(e.ph, 'extra', e.cap, e.session ?? 'Допълнителна сесия', `dopalnitelen-${(d.extra ?? []).length + k + 1}`, e.confidence);

    // 2. Конвертиране (идемпотентно): само ако целевият файл липсва или изходният SHA се е променил
    const photosMeta = {};
    for (const p of photoRows) {
      const target = path.join(photoDir, p.file);
      const prev = manifest.photos[p.file];
      const need = !fs.existsSync(target) || !prev || prev.sourceSha256 !== p.row.sha256;
      if (need && !DRY) {
        const buf = fs.readFileSync(path.join(SRC, p.row.name));
        const out = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 86, effort: 4 }).toBuffer(); // без метаданни
        fs.writeFileSync(target, out);
        report.photos.converted++;
      } else report.photos.reused++;
      manifest.photos[p.file] = {
        sourceName: p.row.name, sourceSha256: p.row.sha256, sourceIdx: p.row.idx, sourceBytes: p.row.bytes,
        sourceSize: `${p.row.width}x${p.row.height}`, role: p.role, batch: p.row.batch, confidence: p.confidence ?? d.confidence ?? 'HIGH',
        provenance: 'ChatGPT Image (AI-генерирана илюстрация)',
      };
      photosMeta[p.file] = {
        alt: `${d.title}: ${p.cap}`.slice(0, 220),
        caption: p.cap,
        ...(p.session ? { session: p.session } : {}),
      };
    }

    // 2а. Почистване: внесени по-рано файлове, които вече не участват (напр. след пренареждане на стъпките).
    //     Пипат се само файлове, записани в манифеста; ръчно добавени снимки остават.
    const keep = new Set(photoRows.map((p) => p.file));
    for (const f of Object.keys(manifest.photos)) {
      if (keep.has(f)) continue;
      const stale = path.join(photoDir, f);
      if (!DRY) { if (fs.existsSync(stale)) fs.unlinkSync(stale); delete manifest.photos[f]; }
      report.photos.pruned++;
    }

    // 3. Frontmatter
    const flatTexts = d.ingredients.flatMap((g) => g.items.map((t) => (typeof t === 'string' ? t : t.name))).concat(d.steps.map((s) => s.text));
    // Датата не се мени при повторен импорт: взима се от описанието, после от съществуващия файл, накрая – днешната.
    const prevDate = fs.existsSync(mdPath) ? /^date:\s*"?(\d{4}-\d{2}-\d{2})/m.exec(fs.readFileSync(mdPath, 'utf8'))?.[1] : undefined;
    const fm = {
      title: d.title, description: d.description, intro: d.intro, context: d.context, date: d.date ?? prevDate ?? today,
      status: d.status ?? 'reconstruction', review: d.review ?? true, illustrative: d.illustrative ?? true, featured: d.featured ?? false,
      collection: d.collection ?? 'traditional', category: d.category, method: d.method ?? [], cuisine: d.cuisine, tags: d.tags ?? [],
      prepTime: d.prepTime, cookTime: d.cookTime, restTime: d.restTime ?? 0, servings: d.servings, difficulty: d.difficulty,
      cover: cover?.file, carousel: d.carousel ? d.carousel.map((i) => photoRows.find((p) => p.idx === i)?.file).filter(Boolean) : undefined,
      photos: photosMeta, mise: d.mise ?? [], technique: d.technique, temperature: d.temperature, balance: d.balance,
      ingredients: d.ingredients.map((g) => ({ ...(g.title ? { title: g.title } : {}), items: g.items.map((t) => (typeof t === 'string' ? parseIngredient(t) : t)) })),
      steps: stepsOut, tips: d.tips ?? [], mistakes: d.mistakes ?? [], substitutions: d.substitutions ?? [],
      plating: d.plating, serving: d.serving, storage: d.storage,
      allergens: d.allergens ?? allergensOf(flatTexts),
    };
    const notesMd = d.notes ? `\n## Бележки\n\n${d.notes}\n` : '';
    const md = `---\n${toYamlObj(fm)}\n---\n${notesMd}`;
    const mdHash = sha(Buffer.from(md));

    // 4. Запис с проверка за ръчни редакции
    if (!fs.existsSync(mdPath)) {
      if (!DRY) { fs.writeFileSync(mdPath, md); manifest.generatedHash = mdHash; }
      report.created.push(d.slug);
    } else {
      // Git на Windows (autocrlf) превежда окончанията на редовете в CRLF – не е ръчна редакция.
      const cur = sha(Buffer.from(fs.readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n')));
      if (cur === mdHash) report.unchanged.push(d.slug);
      else if (manifest.generatedHash && cur === manifest.generatedHash || OVERWRITE) {
        if (!DRY) { fs.writeFileSync(mdPath, md); manifest.generatedHash = mdHash; }
        report.updated.push(d.slug);
      } else {
        if (!DRY) fs.writeFileSync(path.join(dir, 'index.generated.md'), md);
        report.conflicts.push(d.slug);
      }
    }
    manifest.sessions = d.sessions ?? manifest.sessions;
    manifest.excludedSources = (d.excludeNames ?? manifest.excludedSources ?? []);
    manifest.importedAt = new Date().toISOString();
    if (!DRY) fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));
  } catch (e) {
    report.errors.push(`${d.slug}: ${e.message}`);
  }
}

// ---------- Снимки за сайта (заглавни кадри) ----------
if (!ONLY.length) {
  const siteDir = opt('site-assets', 'src/assets/site');
  const sm = fs.existsSync(path.join(siteDir, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(siteDir, 'manifest.json'), 'utf8')) : {};
  if (!DRY) fs.mkdirSync(siteDir, { recursive: true });
  for (const a of siteAssets) {
    const row = byIdx.get(a.idx);
    if (!row) { report.errors.push(`site asset #${a.idx}: липсва`); continue; }
    usedSources.add(row.name);
    const target = path.join(siteDir, a.file);
    if (!fs.existsSync(target) || sm[a.file]?.sourceSha256 !== row.sha256) {
      if (!DRY) {
        const buf = fs.readFileSync(path.join(SRC, row.name));
        fs.writeFileSync(target, await sharp(buf).rotate().resize({ width: 1800, withoutEnlargement: true }).webp({ quality: 84, effort: 4 }).toBuffer());
      }
      report.photos.converted++;
    }
    sm[a.file] = { sourceName: row.name, sourceSha256: row.sha256, sourceIdx: row.idx, alt: a.alt, caption: a.cap, width: row.width, height: row.height };
  }
  if (!DRY) fs.writeFileSync(path.join(siteDir, 'manifest.json'), JSON.stringify(sm, null, 2));
}

// ---------- Обобщение ----------
fs.mkdirSync(REPORTS, { recursive: true });
const summary = {
  mode: DRY ? 'dry-run' : 'import', definitions: selected.length, created: report.created.length, updated: report.updated.length,
  unchanged: report.unchanged.length, conflicts: report.conflicts, errors: report.errors,
  photosConverted: report.photos.converted, photosReused: report.photos.reused, photosPruned: report.photos.pruned, distinctSourcesUsed: usedSources.size,
};
console.log(JSON.stringify(summary, null, 1));
if (!DRY) fs.writeFileSync(path.join(REPORTS, '_work', 'last-import.json'), JSON.stringify({ ...summary, createdSlugs: report.created, updatedSlugs: report.updated, usedSources: [...usedSources] }, null, 1));
process.exit(report.errors.length ? 1 : 0);
