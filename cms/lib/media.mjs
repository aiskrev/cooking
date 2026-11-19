// Качване и обработка на снимки (OWASP File Upload): проверка на подписа и съдържанието, ограничения, безопасни имена,
// публикуван вариант без метаданни (WebP ≤1600 px), оригиналът – извън публичната папка и извън Git.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { sha256 } from './crypto.mjs';
import { moveSync } from './util.mjs';
import { photoDir, listPhotoFiles } from './recipes.mjs';

sharp.cache(false);
sharp.concurrency(2);

/** Определя типа по подписа на файла (не по името или по Content-Type). */
export function sniff(buf) {
  if (buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'heic';
  }
  return null;
}
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };
const SHARP_FORMAT = { jpeg: 'jpeg', png: 'png', webp: 'webp', avif: 'heif' };

async function dhash(buf, opts) {
  const raw = await sharp(buf, opts).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
export function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b), c = 0;
  while (x) { c += Number(x & 1n); x >>= 1n; }
  return c;
}

export function quotaUsed(ctx) {
  return ctx.db.get('SELECT COALESCE(SUM(original_bytes), 0) AS b FROM media_assets').b;
}

const safeSlug = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

async function writeDerivative(ctx, slug, file, original, crop) {
  const U = ctx.config.upload;
  const opts = { limitInputPixels: U.maxPixels, failOn: 'error' };
  let pipe = sharp(original, opts).rotate();
  if (crop) {
    const m = await sharp(original, opts).metadata();
    const swap = (m.orientation ?? 1) >= 5;
    const W = swap ? m.height : m.width, H = swap ? m.width : m.height;
    const left = Math.max(0, Math.min(W - 1, Math.round(crop.x * W)));
    const top = Math.max(0, Math.min(H - 1, Math.round(crop.y * H)));
    const width = Math.max(16, Math.min(W - left, Math.round(crop.w * W)));
    const height = Math.max(16, Math.min(H - top, Math.round(crop.h * H)));
    pipe = pipe.extract({ left, top, width, height });
  }
  // без .withMetadata(): EXIF/GPS/ICC не се копират в публикуваната снимка
  const { data, info } = await pipe.resize({ width: U.publishWidth, withoutEnlargement: true }).webp({ quality: U.publishQuality, effort: 4 }).toBuffer({ resolveWithObject: true });
  const dir = photoDir(ctx, slug);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  fs.writeFileSync(target + '.tmp', data);
  fs.renameSync(target + '.tmp', target);
  return { width: info.width, height: info.height, bytes: data.length };
}

/**
 * Обработва един качен файл. Връща { ok, file, width, height, warnings } или { ok:false, code, error }.
 * Файлът не се публикува (не се записва в photos/), докато проверката и обработката не успеят.
 */
export async function processUpload(ctx, { slug, name, buffer, userId, allowDuplicate = false }) {
  const U = ctx.config.upload;
  const fail = (code, error) => ({ ok: false, code, error, name });
  if (!safeSlug(slug)) return fail('slug', 'Невалиден адрес на рецептата.');
  if (buffer.length === 0) return fail('empty', 'Файлът е празен.');
  if (buffer.length > U.maxFileBytes) return fail('size', `Файлът е по-голям от ${Math.round(U.maxFileBytes / 1048576)} MB.`);
  const kind = sniff(buffer);
  if (kind === 'heic') return fail('heic', 'HEIC/HEIF не се поддържа. Експортирайте снимката като JPEG или PNG.');
  if (!kind) return fail('type', 'Неподдържан или повреден файл. Допустими са JPEG, PNG, WebP и AVIF.');
  const opts = { limitInputPixels: U.maxPixels, failOn: 'error' };
  let meta;
  try { meta = await sharp(buffer, opts).metadata(); } catch (e) { return fail('corrupt', 'Файлът е повреден или е с недопустимо голям размер.'); }
  if (meta.format !== SHARP_FORMAT[kind] || !meta.width || !meta.height) return fail('type', 'Съдържанието на файла не съответства на типа му.');
  if (meta.width * meta.height > U.maxPixels) return fail('pixels', 'Снимката е с твърде висока резолюция.');
  if (listPhotoFiles(ctx, slug).length >= U.maxPhotosPerRecipe) return fail('quota', `Достигнат е максимумът от ${U.maxPhotosPerRecipe} снимки за рецепта.`);
  if (quotaUsed(ctx) + buffer.length > U.quotaBytes) return fail('quota', 'Достигнат е общият лимит за място на оригиналите.');

  const sha = sha256(buffer);
  const warnings = [];
  const same = ctx.db.get('SELECT file FROM media_assets WHERE recipe_slug = ? AND original_sha256 = ?', slug, sha);
  if (same && !allowDuplicate) return { ok: false, code: 'duplicate', error: `Тази снимка вече е качена (${same.file}).`, name, duplicateOf: same.file };
  const elsewhere = ctx.db.get('SELECT recipe_slug FROM media_assets WHERE recipe_slug != ? AND original_sha256 = ? LIMIT 1', slug, sha);
  if (elsewhere) warnings.push(`Същата снимка е използвана и в рецептата „${elsewhere.recipe_slug}“.`);

  let hash;
  try { hash = await dhash(buffer, opts); } catch { return fail('corrupt', 'Файлът не може да се обработи.'); }
  for (const r of ctx.db.all('SELECT file, dhash FROM media_assets WHERE recipe_slug = ?', slug)) {
    if (hamming(hash, r.dhash) <= 4) { warnings.push(`Прилича на вече качената „${r.file}“.`); break; }
  }

  let file = `u${Date.now().toString(36)}-${sha.slice(0, 8)}.webp`;
  if (fs.existsSync(path.join(photoDir(ctx, slug), file))) file = `u${Date.now().toString(36)}-${sha.slice(8, 16)}.webp`;
  let out;
  try { out = await writeDerivative(ctx, slug, file, buffer, null); } catch (e) { return fail('corrupt', 'Снимката не може да се обработи.'); }

  const origDir = path.join(ctx.paths.originals, slug);
  fs.mkdirSync(origDir, { recursive: true, mode: 0o700 });
  const origPath = path.join(origDir, `${sha}.${EXT[kind]}`);
  if (!fs.existsSync(origPath)) fs.writeFileSync(origPath, buffer, { mode: 0o600 });
  ctx.db.run(
    'INSERT INTO media_assets (recipe_slug, file, original_sha256, original_name, original_path, original_bytes, width, height, dhash, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    slug, file, sha, String(name).replace(/[\u0000-\u001f]/g, '').replace(/[\\/]+/g, '_').slice(0, 200), origPath, buffer.length, out.width, out.height, hash, userId ?? null, Date.now());
  return { ok: true, file, width: out.width, height: out.height, warnings, name };
}

export const mediaFor = (ctx, slug, file) => ctx.db.get('SELECT * FROM media_assets WHERE recipe_slug = ? AND file = ?', slug, file);

/** Изрязване: публикуваният вариант се прави наново от оригинала; самият оригинал не се променя. crop=null връща целия кадър. */
export async function applyCrop(ctx, slug, file, crop) {
  const m = mediaFor(ctx, slug, file);
  if (!m || !fs.existsSync(m.original_path)) return { error: 'Оригиналът не е наличен.' };
  if (crop) {
    const ok = ['x', 'y', 'w', 'h'].every((k) => typeof crop[k] === 'number' && crop[k] >= 0 && crop[k] <= 1) && crop.w > 0.02 && crop.h > 0.02 && crop.x + crop.w <= 1.001 && crop.y + crop.h <= 1.001;
    if (!ok) return { error: 'Невалидна област за изрязване.' };
  }
  const out = await writeDerivative(ctx, slug, file, fs.readFileSync(m.original_path), crop);
  ctx.db.run('UPDATE media_assets SET crop = ?, width = ?, height = ? WHERE id = ?', crop ? JSON.stringify(crop) : null, out.width, out.height, m.id);
  return { ok: true, width: out.width, height: out.height };
}

/** Изтриване от рецептата: публикуваният файл отива в кошче (може да се върне); оригиналът се пази. */
export function trashPhoto(ctx, slug, file) {
  const src = path.join(photoDir(ctx, slug), file);
  if (!/^[A-Za-z0-9._-]+$/.test(file) || !fs.existsSync(src)) return false;
  const dir = path.join(ctx.paths.trash, slug);
  fs.mkdirSync(dir, { recursive: true });
  moveSync(src, path.join(dir, `${Date.now()}-${file}`));
  ctx.db.run('DELETE FROM media_assets WHERE recipe_slug = ? AND file = ?', slug, file);
  return true;
}

/** Връща файл от кошчето (при възстановяване на ревизия). */
export function restoreFromTrash(ctx, slug, file) {
  const dir = path.join(ctx.paths.trash, slug);
  if (!fs.existsSync(dir)) return false;
  const hit = fs.readdirSync(dir).filter((f) => f.endsWith('-' + file)).sort().pop();
  if (!hit) return false;
  fs.mkdirSync(photoDir(ctx, slug), { recursive: true });
  moveSync(path.join(dir, hit), path.join(photoDir(ctx, slug), file));
  return true;
}

export async function thumbnail(ctx, slug, file, width = 360) {
  if (!safeSlug(slug) || !/^[A-Za-z0-9._-]+$/.test(file)) return null;
  const src = path.join(photoDir(ctx, slug), file);
  if (!fs.existsSync(src)) return null;
  const st = fs.statSync(src);
  const key = sha256(`${slug}/${file}/${st.mtimeMs}/${st.size}/${width}`).slice(0, 24);
  const cached = path.join(ctx.paths.thumbs, key + '.webp');
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const buf = await sharp(src, { limitInputPixels: ctx.config.upload.maxPixels }).resize({ width, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
  fs.mkdirSync(ctx.paths.thumbs, { recursive: true });
  fs.writeFileSync(cached, buf);
  return buf;
}
