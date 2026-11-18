// Свързва вече съществуващи снимки в проекта с изходните файлове по перцептивен хеш (dHash) и записва manifest.json.
//   node match-existing.mjs <рецепта-папка> <inventory.json>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [dir, invPath] = process.argv.slice(2);
const inv = JSON.parse(fs.readFileSync(invPath, 'utf8')).filter((r) => !r.exactDuplicateOf);
const ham = (a, b) => { let x = BigInt('0x' + a) ^ BigInt('0x' + b), c = 0; while (x) { c += Number(x & 1n); x >>= 1n; } return c; };
async function dhash(file) {
  const raw = await sharp(file).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
const photoDir = path.join(dir, 'photos');
const man = { slug: path.basename(dir), photos: {}, note: 'Снимките са преди импорта; произходът е определен по перцептивен хеш (не по SHA-256 – файловете са прекодирани).' };
for (const f of fs.readdirSync(photoDir).sort()) {
  const h = await dhash(path.join(photoDir, f));
  const best = inv.map((r) => ({ r, d: ham(h, r.dhash) })).sort((a, b) => a.d - b.d)[0];
  man.photos[f] = { sourceName: best.r.name, sourceIdx: best.r.idx, sourceSha256: best.r.sha256, hammingDistance64: best.d, matchConfidence: best.d <= 8 ? 'HIGH' : best.d <= 16 ? 'MEDIUM' : 'LOW', role: 'step', provenance: 'ChatGPT Image (AI-генерирана илюстрация)' };
  console.log(f, '→', '#' + best.r.idx, best.r.name.slice(0, 40), 'd=' + best.d);
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 2));
