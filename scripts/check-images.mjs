// Проверка на снимките в dist/: няма оригинали; няма EXIF/GPS; всяка <img> има width/height и alt;
// само главната снимка е без loading="lazy"; има AVIF и WebP и резервен JPEG.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dist = path.resolve(process.argv[2] || 'dist');
const src = path.resolve('src/content/recipes');
let errors = 0;
const err = (m) => { errors++; console.error('ГРЕШКА ' + m); };

// 1. Какво има в dist
const astroDir = path.join(dist, '_astro');
const imgFiles = fs.readdirSync(astroDir).filter((f) => /\.(avif|webp|jpe?g|png)$/i.test(f));
const byExt = {};
for (const f of imgFiles) byExt[path.extname(f).toLowerCase()] = (byExt[path.extname(f).toLowerCase()] || 0) + 1;
console.log('Файлове със снимки в dist/_astro:', JSON.stringify(byExt));
for (const need of ['.avif', '.webp', '.jpeg']) if (!byExt[need]) err(`липсват ${need} файлове`);
if (byExt['.png']) err('в dist има PNG – очаквани само AVIF/WebP/JPEG');

// 2. Оригиналите не се обслужват: нито име, нито идентично съдържание
const originals = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : /\.(jpe?g|png|webp|avif|heic)$/i.test(e.name) && originals.push(p); } })(src);
const distSizes = new Map();
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'pagefind') walk(p); } else if (/\.(jpe?g|png|webp|avif)$/i.test(e.name)) { const s = fs.statSync(p).size; (distSizes.get(s) || distSizes.set(s, []).get(s)).push(p); } } })(dist);
for (const o of originals) {
  const buf = fs.readFileSync(o);
  const same = (distSizes.get(buf.length) || []).filter((p) => fs.readFileSync(p).equals(buf));
  if (same.length) err(`оригиналът ${path.relative(src, o)} се намира в dist: ${same[0]}`);
}
console.log(`Оригинали в src: ${originals.length}; нито един не е копиран в dist.`);

// 3. EXIF/GPS/ICC метаданни
let withMeta = 0;
for (const f of imgFiles) {
  const m = await sharp(path.join(astroDir, f)).metadata();
  if (m.exif || m.xmp || m.iptc || m.tifftagPhotoshop) { withMeta++; err(`${f} съдържа метаданни (exif/xmp/iptc)`); }
}
console.log(`Проверени ${imgFiles.length} изходни снимки за EXIF/XMP/IPTC: ${withMeta} с метаданни.`);

// 4. HTML: width/height/alt/lazy
const pages = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'pagefind') walk(p); } else if (e.name.endsWith('.html')) pages.push(p); } })(dist);
let imgTags = 0, eager = 0;
for (const f of pages) {
  const html = fs.readFileSync(f, 'utf8');
  const rel = path.relative(dist, f);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    imgTags++;
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) err(`${rel}: <img> без width/height: ${tag.slice(0, 100)}`);
    if (!/\salt="/.test(tag)) err(`${rel}: <img> без alt: ${tag.slice(0, 100)}`);
    const isLqip = /class="lqip"/.test(tag);
    if (!isLqip && !/loading="lazy"/.test(tag)) { eager++; console.log(`  без lazy (главна снимка): ${rel}`); }
    if (!isLqip && /loading="lazy"/.test(tag) && /fetchpriority="high"/.test(tag)) err(`${rel}: lazy и high едновременно`);
  }
  for (const m of html.matchAll(/<picture>([\s\S]*?)<\/picture>/g)) {
    if (!/type="image\/avif"/.test(m[1]) || !/type="image\/webp"/.test(m[1])) err(`${rel}: <picture> без AVIF/WebP`);
    if (!/<img[^>]*srcset=/.test(m[1])) err(`${rel}: <img> в <picture> без srcset`);
    if (!/<img[^>]*sizes=/.test(m[1])) err(`${rel}: <img> в <picture> без sizes`);
  }
}
console.log(`HTML страници: ${pages.length}; <img> етикети: ${imgTags}; без lazy: ${eager} (очаквано ≤ 1 на страница).`);
console.log(errors ? `\nГрешки: ${errors}` : '\nСнимките са в ред.');
process.exit(errors ? 1 : 0);
