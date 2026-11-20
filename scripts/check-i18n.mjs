// Проверка на двуезичната сглобена версия (dist/): адреси, език на страниците, взаимни hreflang, превключвател на езика,
// липса на български текст в английските страници, карта на сайта, емисии, индекс за търсене (по един на език) и резервната страница на корена.
//   node scripts/check-i18n.mjs [dist]
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] || 'dist');
let errors = 0, checked = 0;
const err = (p, m) => { errors++; if (errors <= 60) console.error(`ГРЕШКА  ${p}: ${m}`); };
const read = (rel) => { const f = path.join(dist, rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const page = (url) => read(url.replace(/^\//, '') + 'index.html');
const dirs = (rel) => { const d = path.join(dist, rel); return fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []; };

const ROUTES = {
  bg: { home: '/bg/', recipes: '/bg/recepti/', categories: '/bg/kategorii/', search: '/bg/tursene/', favorites: '/bg/lyubimi/', shopping: '/bg/spisak/' },
  en: { home: '/en/', recipes: '/en/recipes/', categories: '/en/categories/', search: '/en/search/', favorites: '/en/favorites/', shopping: '/en/shopping-list/' },
};
const attr = (html, re) => re.exec(html)?.[1];
const mainText = (html) => {
  const m = /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? '';
  return m.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
};
const CYR_RUN = /([Ѐ-ӿ]{2,}[\s,.;:()«»„“"–—-]+){2,}[Ѐ-ӿ]{2,}/;

// 1) основни страници и на двата езика
for (const [loc, r] of Object.entries(ROUTES)) for (const [name, url] of Object.entries(r)) {
  const html = page(url);
  if (!html) { err(url, 'липсва страницата'); continue; }
  checked++;
  if (attr(html, /<html lang="([^"]+)"/) !== loc) err(url, `html lang ≠ ${loc}`);
  if (!/<link rel="alternate" type="application\/rss\+xml"[^>]*href="\/\w\w\/rss\.xml"/.test(html)) err(url, 'няма връзка към емисията на езика');
}

// 2) рецепти: двойки, превключвател, hreflang, canonical, без български в английските страници
const bgSlugs = dirs('bg/recepti'), enSlugs = new Set(dirs('en/recipes'));
for (const slug of enSlugs) if (!bgSlugs.includes(slug)) err(`/en/recipes/${slug}/`, 'английска страница без български оригинал');
for (const slug of bgSlugs) {
  const bgUrl = `/bg/recepti/${slug}/`, enUrl = `/en/recipes/${slug}/`;
  const bgHtml = page(bgUrl); checked++;
  const hasEn = enSlugs.has(slug);
  const sw = [...bgHtml.matchAll(/<a lang="(bg|en)" hreflang="\1" href="([^"]+)"[^>]*data-lang="\1"/g)].map((m) => [m[1], m[2]]);
  const swEn = sw.find(([l]) => l === 'en')?.[1];
  if (hasEn && swEn !== enUrl) err(bgUrl, `превключвателят води към ${swEn}, очаквано ${enUrl}`);
  if (!hasEn && swEn !== '/en/recipes/') err(bgUrl, `няма превод, превключвателят трябва да води към каталога (/en/recipes/), а води към ${swEn}`);
  const canon = attr(bgHtml, /<link rel="canonical" href="https?:\/\/[^/]+([^"]+)"/);
  if (canon !== bgUrl) err(bgUrl, `canonical ${canon}`);
  const alts = [...bgHtml.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="https?:\/\/[^/]+([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`);
  if (hasEn && !(alts.includes(`bg=${bgUrl}`) && alts.includes(`en=${enUrl}`) && alts.includes(`x-default=${bgUrl}`))) err(bgUrl, `hreflang: ${alts.join(', ') || 'няма'}`);
  if (!hasEn && alts.length) err(bgUrl, 'hreflang без реална двойка');
  if (!hasEn) continue;
  const enHtml = page(enUrl); checked++;
  if (attr(enHtml, /<html lang="([^"]+)"/) !== 'en') err(enUrl, 'html lang ≠ en');
  const swBg = [...enHtml.matchAll(/<a lang="(bg|en)" hreflang="\1" href="([^"]+)"[^>]*data-lang="\1"/g)].find((m) => m[1] === 'bg')?.[2];
  if (swBg !== bgUrl) err(enUrl, `превключвателят води към ${swBg}, очаквано ${bgUrl}`);
  if (attr(enHtml, /<link rel="canonical" href="https?:\/\/[^/]+([^"]+)"/) !== enUrl) err(enUrl, 'canonical');
  const eAlts = [...enHtml.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="https?:\/\/[^/]+([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`);
  if (!(eAlts.includes(`bg=${bgUrl}`) && eAlts.includes(`en=${enUrl}`) && eAlts.includes(`x-default=${bgUrl}`))) err(enUrl, `hreflang: ${eAlts.join(', ') || 'няма'}`);
  if (CYR_RUN.test(mainText(enHtml))) err(enUrl, `български текст в английската страница: „${CYR_RUN.exec(mainText(enHtml))[0].trim().slice(0, 60)}“`);
}

// 3) главни страници на английски без български текст
for (const url of [ROUTES.en.home, ROUTES.en.recipes, ROUTES.en.categories, ROUTES.en.search, ROUTES.en.favorites, ROUTES.en.shopping]) {
  const html = page(url); if (html && CYR_RUN.test(mainText(html))) err(url, 'български текст в английската страница');
}

// 4) категории и етикети: еднакви групи (по ключ) – броят страници съвпада, когато всички рецепти са преведени
if (enSlugs.size === bgSlugs.length) {
  for (const kind of [['kategorii', 'categories'], ['etiketi', 'tags']]) {
    const b = dirs(`bg/${kind[0]}`).length, e = dirs(`en/${kind[1]}`).length;
    if (b !== e) err(`/bg/${kind[0]}/ ↔ /en/${kind[1]}/`, `различен брой страници: ${b} ≠ ${e}`);
  }
}

// 5) карта на сайта
const sitemaps = fs.readdirSync(dist).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => read(f)).join('\n');
const urls = new Set([...sitemaps.matchAll(/<loc>https?:\/\/[^/]+([^<]+)<\/loc>/g)].map((m) => m[1]));
for (const slug of bgSlugs) if (!urls.has(`/bg/recepti/${slug}/`)) err('sitemap', `липсва /bg/recepti/${slug}/`);
for (const slug of enSlugs) if (!urls.has(`/en/recipes/${slug}/`)) err('sitemap', `липсва /en/recipes/${slug}/`);
for (const bad of ['/', '/bg/lyubimi/', '/en/favorites/']) if (urls.has(bad)) err('sitemap', `не трябва да съдържа ${bad}`);
if (![...urls].every((u) => /^\/(bg|en)\//.test(u))) err('sitemap', 'има адрес извън /bg/ и /en/: ' + [...urls].find((u) => !/^\/(bg|en)\//.test(u)));

// 6) емисии, корен, търсачка
for (const loc of ['bg', 'en']) { if (!read(`${loc}/rss.xml`)) err(`/${loc}/rss.xml`, 'липсва'); }
const root = read('index.html');
if (!root || !/http-equiv="refresh" content="0; url=\/bg\/"/.test(root) || !/name="robots" content="noindex"/.test(root)) err('/', 'резервната страница на корена е неправилна');
const pf = read('pagefind/pagefind-entry.json');
if (!pf) err('/pagefind', 'няма индекс за търсене');
else { const langs = Object.keys(JSON.parse(pf).languages ?? {}).sort(); if (!(langs.includes('bg') && (enSlugs.size === 0 || langs.includes('en')))) err('/pagefind', `езици в индекса: ${langs.join(',')}`); }

console.log(`Проверени ${checked} страници; български рецепти: ${bgSlugs.length}, английски: ${enSlugs.size}; адреси в картата на сайта: ${urls.size}.`);
if (errors) { console.error(`Грешки: ${errors}`); process.exit(1); }
console.log('Двуезичната версия е в ред.');
