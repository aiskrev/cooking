import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeCtx } from './helpers.mjs';

const { ctx, cleanup, rec } = await makeCtx({ recipes: { 'testova-supa': { tags: ['супа'], method: ['Варене'], difficulty: 'лесна' } } });
const T = await import('../lib/translations.mjs');
const { contentHash } = rec;
const slug = 'testova-supa';
const bg = () => rec.readRecipe(ctx, slug);
test.after(cleanup);

const fullPayload = () => ({
  title: 'Test soup', description: 'A test soup with a long enough description for validation.',
  ingredients: [{ items: [{ name: 'water' }] }],
  steps: [{ text: 'Boil the water.' }],
});

test('няма превод: състояние „missing“, а публикуването на български не се засяга', () => {
  const info = T.translationInfo(ctx, slug, bg());
  assert.equal(info.state, 'missing');
  assert.equal(info.exists, false);
  assert.equal(T.readTranslation(ctx, slug), null);
});

test('чернова на превода: структурата, числата и таксономията са от оригинала, текстовете са празни', () => {
  const r = T.createSkeleton(ctx, slug, bg(), null);
  assert.equal(r.ok, true);
  const tr = T.readTranslation(ctx, slug);
  assert.equal(tr.data.translation.status, 'draft');
  assert.equal(tr.data.category, 'Main Courses');
  assert.deepEqual(tr.data.method, ['Boiling']);
  assert.deepEqual(tr.data.tags, ['soup']);
  assert.equal(tr.data.difficulty, 'Easy');
  assert.equal(tr.data.servings, 4);
  assert.equal(tr.data.ingredients[0].items[0].amount, 1);
  assert.equal(tr.data.ingredients[0].items[0].unit, 'L'); // л -> L автоматично
  assert.equal(tr.data.title, '');
  assert.equal(T.createSkeleton(ctx, slug, bg(), null).error, 'Вече има превод на тази рецепта.', 'второ създаване се отказва');
});

test('непълна чернова може да се запише, но „готов“ и „публикуван“ изискват пълен превод', () => {
  const draft = T.saveTranslation(ctx, slug, bg(), { payload: { title: 'Soup' }, status: 'draft', reviewed: false }, null);
  assert.equal(draft.ok, true);
  const pub = T.saveTranslation(ctx, slug, bg(), { payload: { title: 'Soup' }, status: 'published', reviewed: false }, null);
  assert.equal(pub.status, 422);
  assert.ok(pub.errors.length > 0);
  assert.equal(T.readTranslation(ctx, slug).data.translation.status, 'draft', 'отказаният запис не променя файла');
});

test('пълен превод: количествата не могат да се променят от английската страна', () => {
  const r = T.saveTranslation(ctx, slug, bg(), { payload: { ...fullPayload(), ingredients: [{ items: [{ name: 'water', amount: 999, unit: 'ml' }] }] }, status: 'published', reviewed: true }, null);
  assert.equal(r.ok, true, JSON.stringify(r));
  const tr = T.readTranslation(ctx, slug);
  assert.equal(tr.data.ingredients[0].items[0].amount, 1, 'числото е от оригинала');
  assert.equal(tr.data.ingredients[0].items[0].unit, 'L');
  assert.equal(tr.data.translation.status, 'published');
  assert.equal(tr.data.translation.reviewed, true);
  assert.equal(T.translationInfo(ctx, slug, bg()).state, 'published');
});

test('неизвестен статус се отхвърля', () => {
  assert.equal(T.saveTranslation(ctx, slug, bg(), { payload: fullPayload(), status: 'live', reviewed: false }, null).status, 400);
  assert.equal(T.setTranslationStatus(ctx, slug, bg(), 'whatever', null).status, 400);
});

test('промяна на английския превод променя хеша на съдържанието (значи „чака публикуване“)', () => {
  const before = contentHash(ctx, slug);
  T.saveTranslation(ctx, slug, bg(), { payload: { ...fullPayload(), description: 'A different but still long enough test description.' }, status: 'published', reviewed: true }, null);
  assert.notEqual(contentHash(ctx, slug), before);
});

test('промяна в оригинала: общите полета се синхронизират, текстът прави превода „остарял“, а публикуваното остава', () => {
  const r = bg();
  const d = { ...r.data, servings: 6, title: 'Тестова супа – нов вариант' };
  rec.writeRecipe(ctx, slug, d, r.body);
  const x = T.afterSourceSaved(ctx, slug, d, r.body, null);
  assert.equal(x.translation, 'outdated');
  assert.equal(x.unpublished, false);
  assert.equal(T.readTranslation(ctx, slug).data.servings, 6, 'порциите се пренасят автоматично');
  const approve = T.approveCurrent(ctx, slug, bg(), null);
  assert.equal(approve.ok, true);
  assert.equal(T.translationInfo(ctx, slug, bg()).state, 'published', 'след потвърждение преводът е актуален');
});

test('публикуван остарял превод не може да се „публикува“ отново без потвърждение', () => {
  const r = bg();
  const d = { ...r.data, description: 'Съвсем различно описание на тестовата рецепта, достатъчно дълго.' };
  rec.writeRecipe(ctx, slug, d, r.body);
  T.afterSourceSaved(ctx, slug, d, r.body, null);
  const x = T.setTranslationStatus(ctx, slug, bg(), 'published', null);
  assert.equal(x.status, 409);
});

test('структурна промяна в оригинала (нова стъпка) връща публикувания превод „за преглед“', () => {
  T.approveCurrent(ctx, slug, bg(), null);
  const r = bg();
  const d = { ...r.data, steps: [...r.data.steps, { text: 'Овкусете.' }] };
  rec.writeRecipe(ctx, slug, d, r.body);
  const x = T.afterSourceSaved(ctx, slug, d, r.body, null);
  assert.equal(x.structural, true);
  assert.equal(x.unpublished, true);
  assert.equal(T.readTranslation(ctx, slug).data.translation.status, 'needs-review', 'английската страница не се показва с грешна структура');
});

test('таксономия: нова стойност без превод блокира публикуването, докато не се добави етикет', () => {
  const r = bg();
  const d = { ...r.data, tags: ['супа', 'нов-етикет'], steps: [{ text: 'Сварете водата.' }] };
  rec.writeRecipe(ctx, slug, d, r.body);
  T.afterSourceSaved(ctx, slug, d, r.body, null);
  assert.deepEqual(T.unmappedTerms(ctx, bg().data), [{ group: 'tag', value: 'нов-етикет' }]);
  const p = { ...fullPayload() };
  assert.equal(T.saveTranslation(ctx, slug, bg(), { payload: p, status: 'published', reviewed: true }, null).status, 422);
  assert.equal(T.saveTaxonomyTerm(ctx, 'tag', 'нов-етикет', 'new tag').ok, true);
  assert.ok(fs.existsSync(path.join(ctx.config.contentDir, '_taxonomy.json')), 'допълнителният речник е до рецептите');
  assert.deepEqual(T.unmappedTerms(ctx, bg().data), []);
  assert.equal(T.saveTranslation(ctx, slug, bg(), { payload: p, status: 'published', reviewed: true }, null).ok, true);
  assert.deepEqual(T.readTranslation(ctx, slug).data.tags, ['soup', 'new tag']);
});

test('речникът на таксономията: невалидни групи и стойности се отхвърлят', () => {
  assert.equal(T.saveTaxonomyTerm(ctx, '../etc', 'x', 'y').status, 400);
  assert.equal(T.saveTaxonomyTerm(ctx, 'tag', '', 'y').status, 400);
  assert.equal(T.saveTaxonomyTerm(ctx, 'tag', 'x'.repeat(200), 'y').status, 400);
});

test('манифест на публикуването: езиците на всяка рецепта и откриване на двете дървета на сайта', async () => {
  const { currentManifest } = await import('../lib/publish.mjs');
  const m = currentManifest(ctx);
  assert.deepEqual(m[slug].locales, ['bg', 'en']);
  T.setTranslationStatus(ctx, slug, bg(), 'draft', null);
  assert.deepEqual(currentManifest(ctx)[slug].locales, ['bg'], 'чернова на превода не се публикува');
});

test('API на публичната част: съобщенията се превеждат само за bg/en', async () => {
  const I = await import('../lib/i18n.mjs');
  assert.equal(I.translateMessage('Рецептата не е намерена.', 'en'), 'The recipe was not found.');
  assert.equal(I.translateMessage('Рецептата не е намерена.', 'bg'), 'Рецептата не е намерена.');
  assert.equal(I.translateMessage('Името трябва да е между 2 и 40 знака.', 'en'), 'The name must be between 2 and 40 characters.');
  assert.equal(I.translateMessage('Непознато съобщение', 'en'), 'Непознато съобщение', 'непознатото остава непроменено');
  const fakeReq = (v) => ({ req: { header: () => v } });
  assert.equal(I.requestLocale(fakeReq('en')), 'en');
  assert.equal(I.requestLocale(fakeReq('EN ')), 'en');
  assert.equal(I.requestLocale(fakeReq('../../etc/passwd')), 'bg', 'езикът е само от списъка');
  assert.equal(I.requestLocale(fakeReq(undefined)), 'bg');
});

test('версии на сайта: двуезичната (/bg, /en) и старата (/recepti) се разпознават; езиците се записват в манифеста', async () => {
  const P = await import('../lib/publish.mjs');
  const mk = (rel) => { const d = path.join(ctx.config.releasesDir, rel); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'index.html'), '<html></html>'); };
  mk('r-20260101000000/bg/recepti/aaa'); mk('r-20260101000000/en/recipes/aaa'); mk('r-20260101000000/bg/recepti/bbb');
  mk('r-20250101000000/recepti/old-one'); // преди двуезичната версия
  P.registerExistingReleases(ctx);
  const rows = ctx.db.all('SELECT id, manifest FROM site_releases ORDER BY id');
  const byId = Object.fromEntries(rows.map((r) => [r.id, JSON.parse(r.manifest)]));
  assert.deepEqual(byId['r-20260101000000'].aaa.locales, ['bg', 'en']);
  assert.deepEqual(byId['r-20260101000000'].bbb.locales, ['bg']);
  assert.deepEqual(Object.keys(byId['r-20250101000000']), ['old-one'], 'старата версия остава разпознаваема (за връщане назад)');
});
