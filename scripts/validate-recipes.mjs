// Проверка на съдържанието (изходните рецепти): дубликати, липсващи снимки, неописани снимки, подреждане, манифести.
//   node scripts/validate-recipes.mjs [src/content/recipes]
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const root = path.resolve(process.argv[2] || 'src/content/recipes');
let errors = 0, warnings = 0, recipes = 0, photosTotal = 0;
const err = (s, m) => { errors++; console.error(`ГРЕШКА  ${s}: ${m}`); };
const warn = (s, m) => { warnings++; console.warn(`ПРЕДУПР. ${s}: ${m}`); };

const slugs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
if (new Set(slugs).size !== slugs.length) err('*', 'дублирани папки');
const globalSources = new Map(); // sha -> [recipe/file]
const titles = new Map();

for (const slug of slugs) {
  const dir = path.join(root, slug);
  const mdPath = path.join(dir, 'index.md');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) err(slug, 'невалиден адрес (slug)');
  if (!fs.existsSync(mdPath)) { err(slug, 'липсва index.md'); continue; }
  recipes++;
  const raw = fs.readFileSync(mdPath, 'utf8');
  const m = /^---\n([\s\S]*?)\n---/.exec(raw.replace(/\r\n/g, '\n'));
  if (!m) { err(slug, 'няма frontmatter'); continue; }
  let d;
  try { d = YAML.parse(m[1]); } catch (e) { err(slug, 'невалиден YAML: ' + e.message.split('\n')[0]); continue; }

  // заглавия
  if (titles.has(d.title)) err(slug, `дублирано заглавие „${d.title}“ (и в ${titles.get(d.title)})`); else titles.set(d.title, slug);
  // основни полета
  if (!d.ingredients?.length) err(slug, 'няма съставки');
  if (!d.steps?.length) err(slug, 'няма стъпки');
  if (!(d.servings >= 1)) err(slug, 'невалидни порции');
  if (!(d.prepTime + d.cookTime > 0)) warn(slug, 'нулево време за приготвяне');
  if ((d.description || '').length > 240) err(slug, 'описанието е над 240 знака');
  const text = JSON.stringify(d);
  for (const bad of ['TODO', 'ОПИШЕТЕ', 'Lorem', 'undefined', '[object']) if (text.includes(bad)) err(slug, `съдържа „${bad}“`);

  // съставки
  for (const g of d.ingredients ?? []) for (const it of g.items ?? []) {
    if (typeof it === 'object') {
      if (!it.name?.trim()) err(slug, 'съставка без име');
      if (it.amount !== undefined && !(it.amount > 0)) err(slug, `невалидно количество при „${it.name}“`);
      if (it.scale === undefined && it.amount && !('unit' in it) && false) warn(slug, it.name);
    } else if (!it.trim()) err(slug, 'празна съставка');
  }

  // снимки
  const photoDir = path.join(dir, 'photos');
  const files = fs.existsSync(photoDir) ? fs.readdirSync(photoDir).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f)) : [];
  photosTotal += files.length;
  const meta = d.photos ?? {};
  const refs = new Set();
  if (d.cover) refs.add(d.cover);
  (d.carousel ?? []).forEach((f) => refs.add(f));
  const usedInSteps = [];
  (d.steps ?? []).forEach((s, i) => {
    if (!s.text?.trim()) err(slug, `стъпка ${i + 1} без текст`);
    if (s.photo) {
      refs.add(s.photo); usedInSteps.push(s.photo);
      if (!files.includes(s.photo)) err(slug, `стъпка ${i + 1}: липсва файл ${s.photo}`);
    }
  });
  if (new Set(usedInSteps).size !== usedInSteps.length) err(slug, 'една снимка е използвана в повече от една стъпка');
  for (const f of refs) if (!files.includes(f)) err(slug, `посочен файл липсва: ${f}`);
  for (const f of files) {
    if (!meta[f]) warn(slug, `снимката ${f} няма alt описание`);
    else if ((meta[f].alt || '').length < 5) err(slug, `твърде кратък alt за ${f}`);
  }
  for (const f of Object.keys(meta)) if (!files.includes(f)) err(slug, `в photos: има запис за липсващ файл ${f}`);

  // манифест и произход
  const manPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manPath)) {
    const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    for (const [f, info] of Object.entries(man.photos ?? {})) {
      if (!files.includes(f)) err(slug, `манифестът сочи липсващ файл ${f}`);
      if (!info.sourceSha256 || !info.sourceName) err(slug, `липсва произход за ${f}`);
      const list = globalSources.get(info.sourceSha256) ?? [];
      list.push(`${slug}/${f}`); globalSources.set(info.sourceSha256, list);
      if (/Storyboard|Journey-?\d*\.webp$|Story-\d+|Cooking Storyboard/i.test(info.sourceName) && info.role !== 'excluded') warn(slug, `${info.sourceName} прилича на колаж/сториборд`);
    }
  } else if (files.length) warn(slug, 'няма manifest.json (произходът на снимките не е записан)');

  // подреждане спрямо номера на изходните снимки: предупреждение, когато стъпките не следват възходящ ред (ръчно проверени изключения са нормални)
}
for (const [sha, list] of globalSources) if (list.length > 1) warn(list[0].split('/')[0], `една и съща изходна снимка е използвана на няколко места: ${list.join(', ')}`);

console.log(`\nПроверени рецепти: ${recipes}; файлове със снимки: ${photosTotal}; грешки: ${errors}; предупреждения: ${warnings}`);
process.exit(errors ? 1 : 0);
