// Намира нови снимки в изходната папка спрямо стария инвентар (само четене): по SHA-256 и по перцептивен хеш.
// node diff.mjs <изходна папка> <стар-инвентар.json> <нов-инвентар.json>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const [src = '/src', oldFile, outFile] = process.argv.slice(2);
const old = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
const oldSha = new Map(old.map((r) => [r.sha256, r]));
const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.tif', '.tiff', '.gif']);
const files = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isFile() && exts.has(path.extname(e.name).toLowerCase())).map((e) => e.name);
const ham = (a, b) => { let x = BigInt('0x' + a) ^ BigInt('0x' + b), c = 0; while (x) { c += Number(x & 1n); x >>= 1n; } return c; };

const rows = [];
for (const name of files) {
  const buf = fs.readFileSync(path.join(src, name));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (oldSha.has(sha)) continue; // вече внесена (по съдържание)
  const meta = await sharp(buf).metadata();
  const raw = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0';
  const dhash = BigInt('0b' + bits).toString(16).padStart(16, '0');
  const st = fs.statSync(path.join(src, name));
  rows.push({ name, bytes: st.size, sha256: sha, width: meta.width, height: meta.height, format: meta.format, exif: !!meta.exif, mtime: st.mtimeMs, dhash });
}
// дубликати вътре в новите
const seen = new Map();
for (const r of rows) {
  r.exactDuplicateOf = seen.get(r.sha256) ?? null;
  if (!seen.has(r.sha256)) seen.set(r.sha256, r.name);
}
// близки до вече внесени (визуално)
for (const r of rows) {
  r.similarToOld = old.filter((o) => ham(o.dhash, r.dhash) <= 4).map((o) => ({ idx: o.idx, name: o.name, d: ham(o.dhash, r.dhash) })).slice(0, 3);
}
rows.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name, 'en', { numeric: true }));
rows.forEach((r, i) => { r.newIdx = i + 1; r.idx = 1000 + i + 1; }); // номерата от 1001 нагоре не се бъркат със старите (1–570)
{ let b = 0, prev = null; for (const r of rows) { if (prev !== null && r.mtime - prev > 6000) b++; r.batch = b; prev = r.mtime; } }
fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
const uniq = rows.filter((r) => !r.exactDuplicateOf);
console.log(JSON.stringify({
  filesInFolder: files.length, alreadyImported: files.length - rows.length, newFiles: rows.length, newExactDuplicatesInsideNew: rows.length - uniq.length,
  newUnique: uniq.length, newUniqueVisuallyCloseToOld: uniq.filter((r) => r.similarToOld.length).length,
  formats: rows.reduce((m, r) => ((m[r.format] = (m[r.format] || 0) + 1), m), {}), withExif: rows.filter((r) => r.exif).length,
  dims: Object.entries(rows.reduce((m, r) => ((m[`${r.width}x${r.height}`] = (m[`${r.width}x${r.height}`] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 6),
}, null, 1));
