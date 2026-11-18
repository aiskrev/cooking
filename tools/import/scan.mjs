// Инвентаризация на изходните снимки (само четене): SHA-256, размери, формат, EXIF, перцептивен хеш, време, партиди.
// node scan.mjs <изходна папка> <изход.json>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const [src = '/src', outFile = '/out/inventory.json'] = process.argv.slice(2);
const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif', '.tif', '.tiff', '.gif']);
const files = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isFile() && exts.has(path.extname(e.name).toLowerCase())).map((e) => e.name);

const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function nameTime(n) {
  const m = /ChatGPT Image (\w{3}) (\d+), (\d{4}), (\d+)_(\d+)_(\d+) (AM|PM)/.exec(n);
  if (!m) return null;
  let h = +m[4] % 12; if (m[7] === 'PM') h += 12;
  return Date.UTC(+m[3], months[m[1]], +m[2], h, +m[5], +m[6]);
}

const rows = [];
for (const name of files) {
  const p = path.join(src, name);
  const st = fs.statSync(p);
  const buf = fs.readFileSync(p);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const img = sharp(buf);
  const meta = await img.metadata();
  const raw = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0';
  const dhash = BigInt('0b' + bits).toString(16).padStart(16, '0');
  rows.push({
    name, bytes: st.size, sha256: sha, width: meta.width, height: meta.height, format: meta.format,
    exif: !!meta.exif, xmp: !!meta.xmp, icc: !!meta.icc, orientation: meta.orientation ?? null,
    mtime: st.mtimeMs, nameTime: nameTime(name), dhash,
    copyMarker: / - Copy( \(\d+\))?(?=\.\w+$)/.test(name),
  });
}
rows.forEach((r) => (r.ts = r.nameTime ?? r.mtime));
rows.sort((a, b) => a.ts - b.ts || a.name.localeCompare(b.name, 'en', { numeric: true }));

// партиди по времеви разстояние
let batch = 0, prev = null;
for (const r of rows) {
  if (prev !== null && r.ts - prev > 6000) batch++;
  r.batch = batch; prev = r.ts;
}
// точни дубликати
const bySha = new Map();
for (const r of rows) (bySha.get(r.sha256) || bySha.set(r.sha256, []).get(r.sha256)).push(r.name);
for (const r of rows) {
  const g = bySha.get(r.sha256);
  r.exactDuplicateOf = g.length > 1 && g[0] !== r.name ? g[0] : null;
}
// близки по визия (Hamming <= 6 между dhash), без точните
const ham = (a, b) => { let x = BigInt('0x' + a) ^ BigInt('0x' + b), c = 0; while (x) { c += Number(x & 1n); x >>= 1n; } return c; };
const uniq = rows.filter((r) => !r.exactDuplicateOf);
for (const r of uniq) r.similar = [];
for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
  const d = ham(uniq[i].dhash, uniq[j].dhash);
  if (d <= 6) { uniq[i].similar.push({ name: uniq[j].name, d }); uniq[j].similar.push({ name: uniq[i].name, d }); }
}
rows.forEach((r, i) => (r.idx = i + 1));
fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
const summary = {
  files: rows.length, totalMB: Math.round(rows.reduce((s, r) => s + r.bytes, 0) / 1048576),
  uniqueBySha: uniq.length, exactDuplicates: rows.length - uniq.length, batches: batch + 1,
  withExif: rows.filter((r) => r.exif).length,
  dims: Object.entries(rows.reduce((m, r) => ((m[`${r.width}x${r.height}`] = (m[`${r.width}x${r.height}`] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8),
  formats: rows.reduce((m, r) => ((m[r.format] = (m[r.format] || 0) + 1), m), {}),
};
console.log(JSON.stringify(summary, null, 1));
