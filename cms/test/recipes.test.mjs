import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeCtx, minimal } from './helpers.mjs';

const { ctx, rec, cleanup } = await makeCtx({ recipes: { 'prva': {}, 'vtora': { title: 'Втора рецепта' } } });
const P = await import('../lib/publish.mjs');
test.after(cleanup);

test('четене и запис на рецепта: кръгов обмен без загуба и запазване на непознати ключове', () => {
  const r = rec.readRecipe(ctx, 'prva');
  assert.equal(r.data.title, 'Рецепта prva');
  const d = rec.normalize({ ...r.data, title: 'Нова Заглавие' }, { ...r.data, customKey: 'запазено' });
  rec.writeRecipe(ctx, 'prva', d, 'Бележки\n\nвтори ред');
  const again = rec.readRecipe(ctx, 'prva');
  assert.equal(again.data.title, 'Нова Заглавие');
  assert.equal(again.data.customKey, 'запазено');
  assert.equal(again.body, 'Бележки\n\nвтори ред');
  assert.deepEqual(again.data.ingredients, r.data.ingredients);
  assert.equal(fs.readdirSync(path.join(ctx.config.contentDir, 'prva')).some((f) => f.includes('.tmp')), false, 'няма останали временни файлове');
});

test('нормализиране: числа, празни полета, преоразмеряване без количество', () => {
  const d = rec.normalize({
    title: '  Заглавие  ', description: 'x', category: ' Супи ', prepTime: '15', cookTime: 'abc', servings: '6', tags: ['а', '', ' б '], difficulty: 'невалидна',
    ingredients: [{ title: '', items: [{ name: 'сол', amount: '', unit: '', scale: true }, { name: 'брашно', amount: '1,5', unit: 'г', scale: true }, { name: '' }] }, { items: [] }],
    steps: [{ title: '', text: 'Стъпка', time: '0', photo: '' }, { text: '' }],
  }, {});
  assert.equal(d.title, 'Заглавие'); assert.equal(d.category, 'Супи');
  assert.equal(d.prepTime, 15); assert.equal(d.cookTime, 0); assert.equal(d.servings, 6);
  assert.deepEqual(d.tags, ['а', 'б']);
  assert.equal('difficulty' in d, false);
  assert.equal(d.ingredients.length, 1, 'празната група се премахва');
  assert.equal(d.ingredients[0].items.length, 2);
  assert.equal(d.ingredients[0].items[0].scale, false, 'без количество не се преоразмерява');
  assert.equal(d.ingredients[0].items[1].amount, 1.5);
  assert.equal(d.steps.length, 1); assert.equal('time' in d.steps[0], false);
});

test('проверка: задължителни полета, дублирано заглавие, липсваща снимка, един и същ кадър в две стъпки', () => {
  const base = rec.normalize(minimal('prva'), {});
  assert.equal(rec.validate(ctx, 'prva', base).errors.length, 0);
  assert.ok(rec.validate(ctx, 'prva', { ...base, title: '' }).errors.some((e) => e.field === 'title'));
  assert.ok(rec.validate(ctx, 'prva', { ...base, description: 'x'.repeat(241) }).errors.some((e) => e.field === 'description'));
  assert.ok(rec.validate(ctx, 'prva', { ...base, ingredients: [] }).errors.length);
  assert.ok(rec.validate(ctx, 'prva', { ...base, title: 'Втора рецепта' }).errors.some((e) => /вече е използвано/.test(e.msg)), 'дублирано заглавие');
  assert.ok(rec.validate(ctx, 'prva', { ...base, steps: [{ text: 'а', photo: 'няма.webp' }] }).errors.length);
  assert.ok(rec.validate(ctx, 'prva', { ...base, cover: 'няма.webp' }).errors.length);
  assert.ok(rec.validate(ctx, 'BAD slug', base).errors.length);
  assert.ok(rec.validate(ctx, 'prva', { ...base, title: 'Съдържа TODO в текста' }).errors.length);
  fs.mkdirSync(path.join(ctx.config.contentDir, 'prva', 'photos'), { recursive: true });
  fs.writeFileSync(path.join(ctx.config.contentDir, 'prva', 'photos', 'a.webp'), 'x');
  const withPhoto = { ...base, photos: { 'a.webp': { alt: 'Супа в чиния' } }, steps: [{ text: 'а', photo: 'a.webp' }, { text: 'б', photo: 'a.webp' }] };
  assert.ok(rec.validate(ctx, 'prva', withPhoto).errors.some((e) => /същата снимка/.test(e.msg)));
  assert.ok(rec.validate(ctx, 'prva', { ...base, photos: {} }).errors.some((e) => /описанието \(alt\)/.test(e.msg)), 'снимка без описание');
  const ph = rec.validate(ctx, 'prva', { ...base, cover: 'a.webp', photos: { 'a.webp': { alt: `Снимка ${rec.PLACEHOLDER_ALT}` } } });
  assert.equal(ph.errors.length, 0);
  assert.ok(ph.publishBlockers.length, 'алт по подразбиране блокира публикуването');
  fs.rmSync(path.join(ctx.config.contentDir, 'prva', 'photos'), { recursive: true });
});

test('ревизии: номерация, ограничаване до 60, възстановяване', () => {
  const r = rec.readRecipe(ctx, 'vtora');
  for (let i = 1; i <= 65; i++) rec.recordRevision(ctx, 'vtora', 'save', { ...r.data, title: 'Версия ' + i }, '', null);
  const list = rec.listRevisions(ctx, 'vtora');
  assert.equal(list.length, 60);
  assert.equal(list[0].rev, 65);
  assert.equal(rec.getRevision(ctx, 'vtora', 65).snapshot.data.title, 'Версия 65');
  assert.equal(rec.getRevision(ctx, 'vtora', 1), null, 'най-старите се изтриват');
});

test('речник: категории, етикети, начини', () => {
  rec.writeRecipe(ctx, 'treta', { ...minimal('treta'), title: 'Трета', category: 'Супи', tags: ['бобена', 'зима'], method: ['Варене'] }, '');
  const v = rec.vocabulary(ctx);
  assert.deepEqual(v.categories.map((c) => c.name).sort(), ['Основни ястия', 'Супи']);
  assert.ok(v.tags.some((t) => t.name === 'зима'));
});

test('състояние спрямо публикуваната версия: live / pending / removing / none', () => {
  const rel = { manifest: { prva: { hash: 'h1' }, stara: { hash: null }, skrita: { hash: 'z' } } };
  const s = (slug, publication) => ({ slug, publication });
  assert.equal(P.siteState(rel, s('prva', 'published'), 'h1'), 'live');
  assert.equal(P.siteState(rel, s('prva', 'published'), 'h2'), 'pending', 'променена след публикуване');
  assert.equal(P.siteState(rel, s('nova', 'published'), 'x'), 'pending', 'нова');
  assert.equal(P.siteState(rel, s('stara', 'published'), 'каквото-и-да-е'), 'live', 'версия без хеш (начална) се счита актуална');
  assert.equal(P.siteState(rel, s('skrita', 'draft'), 'z'), 'removing');
  assert.equal(P.siteState(rel, s('чернова', 'draft'), 'z'), 'none');
  assert.equal(P.siteState(null, s('prva', 'published'), 'h1'), 'pending');
});

test('версии: регистриране на начална, атомарно включване и връщане назад', () => {
  const root = ctx.config.releasesDir;
  for (const id of ['r-1', 'r-2']) { fs.mkdirSync(path.join(root, id, 'recepti', 'prva'), { recursive: true }); fs.writeFileSync(path.join(root, id, 'index.html'), id); fs.writeFileSync(path.join(root, id, 'recepti', 'prva', 'index.html'), 'x'); }
  fs.mkdirSync(path.join(root, '.tmp-r-zzz')); // останало от прекъснато сглобяване
  P.registerExistingReleases(ctx);
  assert.equal(P.listReleases(ctx).length, 2);
  assert.equal(fs.existsSync(path.join(root, '.tmp-r-zzz')), false, 'остатъците се почистват');
  assert.equal(P.activateRelease(ctx, 'r-1').ok, true);
  assert.equal(P.currentReleaseId(ctx), 'r-1');
  assert.equal(fs.lstatSync(path.join(root, 'current')).isSymbolicLink(), true);
  assert.equal(P.activateRelease(ctx, 'r-2').ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'current', 'index.html'), 'utf8'), 'r-2');
  assert.equal(P.activateRelease(ctx, 'няма').error !== undefined, true);
  assert.deepEqual(Object.keys(P.currentRelease(ctx).manifest), ['prva']);
});
