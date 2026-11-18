// Проверка на schema.org/Recipe в dist/. Това НЕ замества Rich Results Test на Google
// (https://search.google.com/test/rich-results) – проверява само структурата и изискванията на Google за Recipe.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] || 'dist');
const recipesDir = path.join(dist, 'recepti');
const iso = /^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/;
const abs = /^https?:\/\/[^\s]+$/;
let errors = 0, warnings = 0, pagesChecked = 0;
const err = (p, m) => { errors++; console.error(`ГРЕШКА  ${p}: ${m}`); };
const warn = (p, m) => { warnings++; console.warn(`ПРЕДУПР. ${p}: ${m}`); };

for (const slug of fs.readdirSync(recipesDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const file = path.join(recipesDir, slug.name, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const tag = `/recepti/${slug.name}/`;
  let recipe;
  for (const b of blocks) {
    let j;
    try { j = JSON.parse(b); } catch (e) { err(tag, 'невалиден JSON в ld+json: ' + e.message); continue; }
    for (const node of Array.isArray(j) ? j : [j]) if (node['@type'] === 'Recipe') recipe = node;
  }
  if (!recipe) { err(tag, 'няма Recipe в JSON-LD'); continue; }
  pagesChecked++;
  const r = recipe;
  if (r['@context'] !== 'https://schema.org') err(tag, '@context');
  // Задължителни по Google
  if (!r.name) err(tag, 'липсва name');
  const imgs = [].concat(r.image || []);
  if (!imgs.length) err(tag, 'липсва image (задължително)'); else for (const u of imgs) if (!abs.test(u)) err(tag, 'image не е абсолютен URL: ' + u);
  // Препоръчителни по Google
  for (const k of ['author', 'datePublished', 'description', 'prepTime', 'cookTime', 'totalTime', 'recipeYield', 'recipeCategory', 'recipeIngredient', 'recipeInstructions', 'keywords']) {
    if (r[k] === undefined || r[k] === '' || (Array.isArray(r[k]) && !r[k].length)) warn(tag, `липсва препоръчителното поле ${k}`);
  }
  for (const k of ['prepTime', 'cookTime', 'totalTime']) if (r[k] && !iso.test(r[k])) err(tag, `${k} не е ISO 8601: ${r[k]}`);
  if (r.datePublished && !/^\d{4}-\d{2}-\d{2}/.test(r.datePublished)) err(tag, 'datePublished не е ISO дата');
  if (!r.author || !(r.author.name)) err(tag, 'author без name');
  if (!Array.isArray(r.recipeIngredient) || r.recipeIngredient.some((i) => typeof i !== 'string' || !i.trim())) err(tag, 'recipeIngredient трябва да е масив от непразни низове');
  const steps = r.recipeInstructions || [];
  if (!steps.length) err(tag, 'recipeInstructions е празно');
  steps.forEach((s, i) => {
    if (s['@type'] !== 'HowToStep') err(tag, `стъпка ${i + 1}: @type трябва да е HowToStep`);
    if (!s.text) err(tag, `стъпка ${i + 1}: липсва text`);
    if (s.image && !abs.test(s.image)) err(tag, `стъпка ${i + 1}: image не е абсолютен URL`);
    if (s.url && !abs.test(s.url)) err(tag, `стъпка ${i + 1}: url не е абсолютен`);
  });
  // totalTime = prepTime + cookTime
  const mins = (d) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(d || ''); return m ? (+m[1] || 0) * 60 + (+m[2] || 0) : NaN; };
  if (mins(r.totalTime) < mins(r.prepTime) + mins(r.cookTime)) err(tag, "totalTime < prepTime + cookTime");
  // не трябва да има измислени неща
  for (const k of ['aggregateRating', 'review', 'nutrition', 'video']) if (r[k]) err(tag, `съдържа ${k} – не се допуска, докато няма реални данни`);
  // изображенията трябва да съществуват в dist
  const siteBase = new URL(imgs[0] || 'http://x/').origin;
  for (const u of [...imgs, ...steps.map((s) => s.image).filter(Boolean)]) {
    const p = path.join(dist, decodeURIComponent(new URL(u).pathname));
    if (!fs.existsSync(p)) err(tag, 'файлът на снимката липсва в dist: ' + u);
  }
  // каноничен адрес = url в Recipe
  const canon = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  if (canon && r.url && canon !== r.url) err(tag, `canonical (${canon}) ≠ Recipe.url (${r.url})`);
  console.log(`OK  ${tag}: Recipe със ${r.recipeIngredient?.length} съставки и ${steps.length} стъпки, ${imgs.length} снимки, ${r.totalTime}`);
}
console.log(`\nПроверени Recipe страници: ${pagesChecked}; грешки: ${errors}; предупреждения: ${warnings}`);
process.exit(errors ? 1 : 0);
