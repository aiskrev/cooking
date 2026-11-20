// Превод на рецептите BG -> EN (без външни услуги и ключове).
//   node scripts/translations.mjs report                        – таблица със състоянието на всяка рецепта
//   node scripts/translations.mjs check [--allow-missing]       – проверка (изход ≠ 0 при грешка); това е „translations:check“
//   node scripts/translations.mjs export [--only a,b] [--all]   – записва преводимия български текст в translations/export/<рецепта>.bg.json
//   node scripts/translations.mjs generate [опции]              – сглобява index.en.md от готови файлове с превод (translations/inbox/<рецепта>.json)
//       --dry-run            само показва какво би се случило
//       --only a,b           само избрани рецепти
//       --overwrite          презаписва и вече съществуващ превод (по подразбиране се пропускат – „само липсващите“)
//       --force-reviewed     позволява презаписване на превод, белязан reviewed: true
//       --status <s>         draft | needs-review | ready | published (по подразбиране needs-review)
//       --dir <папка>        папка с файловете за превод (по подразбиране translations/inbox)
// Файлът с превод има същата форма като експорта: същите ключове, преведени стойности. Виж docs/TRANSLATION_WORKFLOW.md.
import fs from 'node:fs';
import path from 'node:path';
import { readAll, loadTaxonomy, loadPolicy, extractSource, buildEnglish, checkPair, serialize, translationState, sourceHash, EN_FILE, TRANSLATION_STATUSES } from './lib/translation.mjs';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'report';
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const root = process.cwd();
const contentDir = path.resolve(opt('content', 'src/content/recipes'));
const tax = loadTaxonomy(root);
const only = opt('only', '') ? new Set(opt('only').split(',').map((s) => s.trim()).filter(Boolean)) : null;

const items = readAll(contentDir).filter((i) => !only || only.has(i.slug));
const published = (i) => i.bg && (i.bg.publication ?? 'published') === 'published';
const photoFiles = (i) => { const d = path.join(i.dir, 'photos'); return fs.existsSync(d) ? fs.readdirSync(d) : []; };

function classify(msg) {
  if (/^ingredients|^няма превод .*unit|единица|количеството|scale/.test(msg)) return 'ingredient';
  if (/^steps/.test(msg)) return 'step';
  if (/снимк|photos|cover|carousel/.test(msg)) return 'photo';
  return 'other';
}

function evaluate() {
  const policy = loadPolicy(root);
  const allowMissing = flag('allow-missing') || policy.publishBulgarianWithoutEnglish === true;
  const rows = [];
  for (const i of items) {
    if (i.error) { rows.push({ i, state: 'invalid', errors: [`невалиден файл: ${i.error}`], warnings: [] }); continue; }
    if (!i.bg) continue;
    const state = translationState(i);
    if (!i.en) { rows.push({ i, state, errors: published(i) && !allowMissing ? ['липсва превод (index.en.md)'] : [], warnings: published(i) && allowMissing ? ['няма превод (политика: публикуване на български без английски)'] : [] }); continue; }
    const r = checkPair(i, tax, { photoFiles: photoFiles(i) });
    rows.push({ i, state, ...r });
  }
  return rows;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function countPages(dir) {
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  const pages = (loc) => walk(path.join(dir, loc)).filter((f) => f.endsWith('index.html')).length;
  return fs.existsSync(dir) ? { bg: pages('bg'), en: pages('en') } : null;
}

if (cmd === 'report' || cmd === 'check') {
  const rows = evaluate();
  const bgRows = rows.filter((r) => r.i.bg);
  const pub = bgRows.filter((r) => published(r.i));
  const have = bgRows.filter((r) => r.i.en);
  const errs = rows.flatMap((r) => r.errors.map((e) => [r.i.slug, e]));
  const complete = pub.filter((r) => r.i.en && !r.errors.length && r.state === 'published');
  const incomplete = pub.filter((r) => r.i.en && r.errors.length);
  const missing = pub.filter((r) => !r.i.en);
  const outdated = pub.filter((r) => r.state === 'outdated');
  const cnt = (k) => errs.filter(([, m]) => classify(m) === k).length;
  const metaBad = rows.filter((r) => r.errors.some((m) => /translation|общо поле|taxonomy|невалиден/.test(m))).length;
  const nonPublished = pub.filter((r) => r.i.en && r.state !== 'published' && r.state !== 'outdated');

  if (cmd === 'report') {
    console.log(pad('РЕЦЕПТА', 46), pad('СЪСТОЯНИЕ', 14), pad('ГРЕШКИ', 7), 'ПРЕДУПР.');
    for (const r of rows) console.log(pad(r.i.slug, 46), pad(r.state, 14), pad(r.errors.length, 7), r.warnings.length);
    console.log('');
  }
  for (const [slug, m] of errs.slice(0, cmd === 'check' ? 200 : 40)) console.error(`ГРЕШКА  ${slug}: ${m}`);
  if (cmd === 'check') for (const r of rows) for (const w of r.warnings) console.warn(`ПРЕДУПР. ${r.i.slug}: ${w}`);

  const pages = countPages(path.resolve(opt('dist', 'dist')));
  let links = 'не е проверено (сглобете сайта и пуснете npm run check)';
  try {
    const rep = JSON.parse(fs.readFileSync(path.resolve(opt('dist', 'dist'), '.link-report.json'), 'utf8'));
    links = `${rep.broken} (проверени ${rep.checked} връзки в ${rep.pages} страници)`;
  } catch { /* още няма отчет */ }
  const failed = errs.length > 0;
  console.log('TRANSLATION VALIDATION\n');
  console.log(`Bulgarian recipes found:      ${bgRows.length} (published: ${pub.length})`);
  console.log(`English translations found:   ${have.length}`);
  console.log('');
  console.log(`Complete translations:        ${complete.length}`);
  console.log(`Incomplete translations:      ${incomplete.length}`);
  console.log(`Missing translations:         ${missing.length}`);
  console.log(`Outdated translations:        ${outdated.length}`);
  console.log(`Not yet published (status):   ${nonPublished.length}`);
  console.log('');
  console.log(`Ingredient mismatches:        ${cnt('ingredient')}`);
  console.log(`Step-count mismatches:        ${cnt('step')}`);
  console.log(`Photo-reference mismatches:   ${cnt('photo')}`);
  console.log(`Invalid metadata:             ${metaBad}`);
  console.log(`Broken internal links:        ${links}`);
  console.log('');
  console.log(`Published BG pages:           ${pages ? pages.bg : 'n/a (no dist/)'}`);
  console.log(`Published EN pages:           ${pages ? pages.en : 'n/a (no dist/)'}`);
  console.log(`\nRESULT: ${failed ? 'FAIL' : 'PASS'}${failed ? ` (${errs.length} errors)` : ''}`);
  if (cmd === 'check' && failed) process.exit(1);
} else if (cmd === 'export') {
  const out = path.resolve(opt('out', 'translations/export'));
  fs.mkdirSync(out, { recursive: true });
  let n = 0;
  for (const i of items) {
    if (!i.bg || !published(i)) continue;
    if (i.en && !flag('all') && !only) continue; // по подразбиране само липсващите
    // компактен вид: един ред за ключ – по-лесен за четене и превод
    const src = extractSource(i.bg);
    const text = '{\n' + Object.entries(src).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n';
    fs.writeFileSync(path.join(out, `${i.slug}.bg.json`), text, 'utf8');
    n++;
  }
  console.log(`Записани са ${n} файла в ${path.relative(root, out)}`);
} else if (cmd === 'generate') {
  const dir = path.resolve(opt('dir', 'translations/inbox'));
  const status = opt('status', 'needs-review');
  if (!TRANSLATION_STATUSES.includes(status)) { console.error(`Невалиден --status „${status}“`); process.exit(2); }
  const dry = flag('dry-run');
  if (!fs.existsSync(dir)) { console.error(`Няма папка с преводи: ${path.relative(root, dir)}`); process.exit(2); }
  let created = 0, updated = 0, skipped = 0, failed = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const slug = file.replace(/\.(en\.)?json$/, '');
    if (only && !only.has(slug)) continue;
    const item = items.find((x) => x.slug === slug);
    if (!item?.bg) { console.error(`ГРЕШКА  ${slug}: няма такава рецепта (оригинал)`); failed++; continue; }
    if (item.en && !flag('overwrite')) { console.log(`пропуснат  ${slug}: вече има превод (ползвайте --overwrite)`); skipped++; continue; }
    if (item.en?.translation?.reviewed && !flag('force-reviewed')) { console.error(`ГРЕШКА  ${slug}: преводът е проверен (reviewed: true) – няма да бъде презаписан без --force-reviewed`); failed++; continue; }
    let payload;
    try { payload = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { console.error(`ГРЕШКА  ${slug}: невалиден JSON: ${e.message}`); failed++; continue; }
    const built = buildEnglish(item.bg, payload, tax, { status, bgBody: item.bgBody, reviewed: false });
    if (built.problems.length) { console.error(`ГРЕШКА  ${slug}:\n  - ${built.problems.join('\n  - ')}`); failed++; continue; }
    const probe = { ...item, en: built.data, enBody: '' };
    const chk = checkPair(probe, tax, { photoFiles: photoFiles(item) });
    if (chk.errors.length) { console.error(`ГРЕШКА  ${slug} (проверка на двойката):\n  - ${chk.errors.join('\n  - ')}`); failed++; continue; }
    const text = serialize(built.data, '');
    if (dry) { console.log(`ще се ${item.en ? 'обнови' : 'създаде'}  ${slug}/${EN_FILE} (${text.length} знака)`); }
    else {
      const target = path.join(item.dir, EN_FILE);
      const tmp = target + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, target);
      console.log(`${item.en ? 'обновен' : 'създаден'}  ${slug}/${EN_FILE}`);
    }
    item.en ? updated++ : created++;
  }
  console.log(`\nСъздадени: ${created}, обновени: ${updated}, пропуснати: ${skipped}, неуспешни: ${failed}${dry ? ' (dry-run – нищо не е записано)' : ''}`);
  if (failed) process.exit(1);
} else {
  console.error(`Непозната команда „${cmd}“. Ползвайте: report | check | export | generate`);
  process.exit(2);
}
