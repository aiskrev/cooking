import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { makeCtx } from './helpers.mjs';

const { ctx, cleanup } = await makeCtx({ recipes: { 'testova-supa': {} } });
const M = await import('../lib/media.mjs');
const slug = 'testova-supa';
test.after(cleanup);

const img = (w, h, color, fmt = 'png', extra) => sharp({ create: { width: w, height: h, channels: 3, background: color } })[fmt](extra).toBuffer();
const photoPath = (f) => path.join(ctx.config.contentDir, slug, 'photos', f);

test('подписът определя типа (не името и не Content-Type)', async () => {
  assert.equal(M.sniff(await img(40, 40, '#a00', 'jpeg')), 'jpeg');
  assert.equal(M.sniff(await img(40, 40, '#a00', 'png')), 'png');
  assert.equal(M.sniff(await img(40, 40, '#a00', 'webp')), 'webp');
  assert.equal(M.sniff(await img(40, 40, '#a00', 'avif')), 'avif');
  assert.equal(M.sniff(Buffer.from('<?php system($_GET[0]); ?>' + ' '.repeat(40))), null);
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(20)]);
  assert.equal(M.sniff(heic), 'heic');
});

test('валидна снимка: публикува се WebP без метаданни, оригиналът се пази извън папката на рецептата', async () => {
  const jpeg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#c33' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'тайна-за-проверка', Artist: 'Някой' } } }).toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif, 'тестовият файл има EXIF');
  const r = await M.processUpload(ctx, { slug, name: '../../evil.jpg', buffer: jpeg, userId: null });
  assert.equal(r.ok, true, r.error);
  assert.match(r.file, /^u[a-z0-9]+-[0-9a-f]{8}\.webp$/, 'безопасно генерирано име');
  const meta = await sharp(photoPath(r.file)).metadata();
  assert.equal(meta.format, 'webp'); assert.equal(meta.width, 1600);
  assert.equal(meta.exif, undefined, 'EXIF е премахнат');
  assert.equal(fs.readFileSync(photoPath(r.file)).includes(Buffer.from('тайна-за-проверка')), false);
  const row = M.mediaFor(ctx, slug, r.file);
  assert.ok(row.original_path.startsWith(ctx.paths.originals), 'оригиналът е в /data/originals');
  assert.equal(fs.existsSync(row.original_path), true);
  assert.equal(row.original_name.includes('/'), false, 'пътят от името на файла не се използва');
});

test('отхвърляне: текст под името .png, повреден файл, празен, HEIC, твърде голям', async () => {
  assert.equal((await M.processUpload(ctx, { slug, name: 'a.png', buffer: Buffer.from('това не е картинка, но има достатъчно дължина'), userId: null })).code, 'type');
  const corrupt = (await img(300, 300, '#0a0', 'png')).subarray(0, 120);
  assert.equal((await M.processUpload(ctx, { slug, name: 'b.png', buffer: corrupt, userId: null })).ok, false);
  assert.equal((await M.processUpload(ctx, { slug, name: 'c.png', buffer: Buffer.alloc(0), userId: null })).code, 'empty');
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40)]);
  assert.equal((await M.processUpload(ctx, { slug, name: 'd.heic', buffer: heic, userId: null })).code, 'heic');
  const big = Buffer.alloc(ctx.config.upload.maxFileBytes + 1, 1);
  assert.equal((await M.processUpload(ctx, { slug, name: 'e.png', buffer: big, userId: null })).code, 'size');
  assert.equal((await M.processUpload(ctx, { slug: '../x', name: 'f.png', buffer: await img(40, 40, '#111'), userId: null })).code, 'slug');
});

test('защита от „decompression bomb“: прекалено много пиксели се отказват', async () => {
  const old = ctx.config.upload.maxPixels;
  ctx.config.upload.maxPixels = 10_000;
  const r = await M.processUpload(ctx, { slug, name: 'big.png', buffer: await img(400, 400, '#00f'), userId: null });
  ctx.config.upload.maxPixels = old;
  assert.equal(r.ok, false);
  assert.ok(['corrupt', 'pixels'].includes(r.code));
});

test('откриване на дубликати и подобни снимки', async () => {
  const a = await img(800, 600, '#e91', 'png');
  const first = await M.processUpload(ctx, { slug, name: 'orig.png', buffer: a, userId: null });
  assert.equal(first.ok, true);
  const dup = await M.processUpload(ctx, { slug, name: 'copy.png', buffer: a, userId: null });
  assert.equal(dup.code, 'duplicate'); assert.equal(dup.duplicateOf, first.file);
  const forced = await M.processUpload(ctx, { slug, name: 'copy.png', buffer: a, userId: null, allowDuplicate: true });
  assert.equal(forced.ok, true);
  const similar = await M.processUpload(ctx, { slug, name: 'close.jpg', buffer: await img(800, 600, '#e92', 'jpeg'), userId: null });
  assert.equal(similar.ok, true);
  assert.ok(similar.warnings.some((w) => w.includes('Прилича')), 'предупреждение за подобна снимка');
});

test('изрязване от оригинала; оригиналът не се променя', async () => {
  const buf = await sharp({ create: { width: 1000, height: 500, channels: 3, background: '#369' } }).png().toBuffer();
  const r = await M.processUpload(ctx, { slug, name: 'crop.png', buffer: buf, userId: null });
  const orig = M.mediaFor(ctx, slug, r.file).original_path;
  const before = fs.readFileSync(orig);
  const out = await M.applyCrop(ctx, slug, r.file, { x: 0, y: 0, w: 0.5, h: 1 });
  assert.equal(out.ok, true);
  assert.equal(out.width, 500); assert.equal(out.height, 500);
  assert.deepEqual(fs.readFileSync(orig), before, 'оригиналът е същият');
  assert.equal((await M.applyCrop(ctx, slug, r.file, { x: 0.9, y: 0, w: 0.5, h: 1 })).error !== undefined, true, 'извън кадъра');
  const back = await M.applyCrop(ctx, slug, r.file, null);
  assert.equal(back.width, 1000);
});

test('изтриване: файлът отива в кошче и може да се върне; умалените копия се кешират', async () => {
  const r = await M.processUpload(ctx, { slug, name: 'del.png', buffer: await img(300, 200, '#7a2', 'png'), userId: null });
  const t = await M.thumbnail(ctx, slug, r.file, 120);
  assert.equal((await sharp(t).metadata()).width, 120);
  assert.equal(await M.thumbnail(ctx, slug, '../../etc/passwd', 120), null);
  assert.equal(M.trashPhoto(ctx, slug, r.file), true);
  assert.equal(fs.existsSync(photoPath(r.file)), false);
  assert.equal(M.mediaFor(ctx, slug, r.file), null);
  assert.equal(M.restoreFromTrash(ctx, slug, r.file), true);
  assert.equal(fs.existsSync(photoPath(r.file)), true);
  assert.equal(M.trashPhoto(ctx, slug, '../index.md'), false, 'обход на пътя не е позволен');
});

test('moveSync премества файл и папка (при EXDEV – копира и изтрива)', async () => {
  const { moveSync } = await import('../lib/util.mjs');
  const dir = path.join(ctx.config.dataDir, 'mv'); fs.mkdirSync(path.join(dir, 'a', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'sub', 'f.txt'), 'x'); fs.writeFileSync(path.join(dir, 'one.txt'), 'y');
  moveSync(path.join(dir, 'one.txt'), path.join(dir, 'two.txt'));
  moveSync(path.join(dir, 'a'), path.join(dir, 'b'));
  assert.equal(fs.readFileSync(path.join(dir, 'two.txt'), 'utf8'), 'y');
  assert.equal(fs.readFileSync(path.join(dir, 'b', 'sub', 'f.txt'), 'utf8'), 'x');
  assert.equal(fs.existsSync(path.join(dir, 'a')), false);
  assert.throws(() => moveSync(path.join(dir, 'няма'), path.join(dir, 'x')), /ENOENT/);
});
