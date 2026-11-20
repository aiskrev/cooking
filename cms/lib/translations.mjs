// Превод на рецептите в администрацията: чете/пише index.en.md до оригинала, проверява двойката BG/EN, следи „остарели“ преводи.
// Логиката за сглобяване и проверка е обща със скриптовете (scripts/lib/translation.mjs) – една и съща на двете места.
import fs from 'node:fs';
import path from 'node:path';
import {
  parseMarkdown, serialize, buildEnglish, buildSkeleton, checkPair, extractEnglishPayload, sourceHash, syncFromSource, loadTaxonomy, loadPolicy,
  EN_FILE, OVERLAY_FILE, TRANSLATION_STATUSES,
} from '../../scripts/lib/translation.mjs';
import { readRecipe, listPhotoFiles, photoDir, recordRevision } from './recipes.mjs';

export { TRANSLATION_STATUSES };

export const TRANSLATION_STATUS_LABELS = {
  missing: 'Няма превод', draft: 'Чернова на превода', 'needs-review': 'За преглед', ready: 'Готов за публикуване', published: 'Публикуван', outdated: 'Остарял превод',
};

const dirOf = (ctx, slug) => path.join(ctx.config.contentDir, slug);
const fileOf = (ctx, slug) => path.join(dirOf(ctx, slug), EN_FILE);

export const taxonomy = (ctx) => loadTaxonomy(ctx.config.appDir, ctx.config.contentDir);
export const policy = (ctx) => loadPolicy(ctx.config.appDir);

export function readTranslation(ctx, slug) {
  const file = fileOf(ctx, slug);
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  try {
    const { data, body } = parseMarkdown(fs.readFileSync(file, 'utf8'));
    return { slug, data, body, mtime: st.mtimeMs, error: null };
  } catch (e) {
    return { slug, data: {}, body: '', mtime: st.mtimeMs, error: e.message };
  }
}

/** Атомарен запис: временен файл + преименуване */
export function writeTranslation(ctx, slug, data, body = '') {
  const target = fileOf(ctx, slug);
  const tmp = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, serialize(data, body), 'utf8');
  fs.renameSync(tmp, target);
}

/** Състояние на превода: missing | draft | needs-review | ready | published | outdated (остарял = оригиналът е променен след превода) */
export function translationState(bg, bgBody, en) {
  if (!en) return 'missing';
  const tr = en.translation ?? {};
  if (tr.sourceHash && tr.sourceHash !== sourceHash(bg, bgBody)) return 'outdated';
  return TRANSLATION_STATUSES.includes(tr.status) ? tr.status : 'draft';
}

/** Стойности от оригинала, които още нямат английски етикет в речника на таксономията */
export function unmappedTerms(ctx, bg) {
  const tax = taxonomy(ctx);
  const out = [];
  const chk = (group, v) => { if (v && !(v in (tax[group] ?? {}))) out.push({ group, value: v }); };
  chk('category', bg.category); chk('cuisine', bg.cuisine); chk('difficulty', bg.difficulty);
  (bg.method ?? []).forEach((v) => chk('method', v)); (bg.tags ?? []).forEach((v) => chk('tag', v)); (bg.allergens ?? []).forEach((v) => chk('allergen', v));
  for (const g of bg.ingredients ?? []) for (const it of g.items ?? []) if (typeof it === 'object' && it.unit) chk('unit', it.unit);
  for (const m of Object.values(bg.photos ?? {})) chk('session', m.session);
  return out;
}

/** Всичко за редактора и списъците: състояние, проверка на двойката, дали може да се публикува */
export function translationInfo(ctx, slug, bgRec) {
  const bg = bgRec.data;
  const tr = readTranslation(ctx, slug);
  const state = tr && !tr.error ? translationState(bg, bgRec.body, tr.data) : tr?.error ? 'draft' : 'missing';
  const info = { state, label: TRANSLATION_STATUS_LABELS[state], exists: !!tr, error: tr?.error ?? null, errors: [], warnings: [], unmapped: unmappedTerms(ctx, bg), canPublish: false };
  if (tr && !tr.error) {
    const files = listPhotoFiles(ctx, slug);
    const res = checkPair({ slug, bg, bgBody: bgRec.body, en: tr.data, enBody: tr.body }, taxonomy(ctx), { photoFiles: files });
    info.errors = res.errors; info.warnings = res.warnings;
    info.canPublish = res.errors.length === 0 && info.unmapped.length === 0;
    info.status = tr.data.translation?.status ?? 'draft';
    info.reviewed = !!tr.data.translation?.reviewed;
    info.sourceHash = tr.data.translation?.sourceHash ?? null;
    info.currentHash = sourceHash(bg, bgRec.body);
  }
  return info;
}

/** Създава празна чернова на превода (структурата, числата, снимките и таксономията са от оригинала) */
export function createSkeleton(ctx, slug, bgRec, userId) {
  if (readTranslation(ctx, slug)) return { error: 'Вече има превод на тази рецепта.' };
  const data = buildSkeleton(bgRec.data, taxonomy(ctx), { bgBody: bgRec.body, translator: 'Редактор' });
  writeTranslation(ctx, slug, data, '');
  recordRevision(ctx, slug, 'translation', data, '', userId);
  return { ok: true, data };
}

/**
 * Записва превод от редактора. Приема само преводимия текст ({payload}); числата, снимките и таксономията винаги идват от оригинала.
 * Чернова и „за преглед“ могат да са непълни; „готов“ и „публикуван“ изискват пълна и валидна двойка.
 */
export function saveTranslation(ctx, slug, bgRec, { payload, status, reviewed }, userId) {
  const tax = taxonomy(ctx);
  if (!TRANSLATION_STATUSES.includes(status)) return { status: 400, error: 'Непознат статус на превода.' };
  const existing = readTranslation(ctx, slug);
  const built = buildEnglish(bgRec.data, payload ?? {}, tax, { status, reviewed: !!reviewed, translator: existing?.data?.translation?.translator || 'Редактор', bgBody: bgRec.body });
  const data = built.data;
  const files = listPhotoFiles(ctx, slug);
  const res = checkPair({ slug, bg: bgRec.data, bgBody: bgRec.body, en: data, enBody: '' }, tax, { photoFiles: files });
  const incomplete = [...new Set([...built.problems, ...res.errors])];
  if (status === "ready" || status === "published") {
    if (incomplete.length) return { status: 422, error: "Преводът не е пълен – не може да бъде „готов“ или „публикуван“.", errors: incomplete };
    const un = unmappedTerms(ctx, bgRec.data);
    if (un.length) return { status: 422, error: "Има стойности без английски етикет в речника на таксономията.", errors: un.map((u) => `${u.group}: „${u.value}“`) };
  }
  fs.mkdirSync(dirOf(ctx, slug), { recursive: true });
  writeTranslation(ctx, slug, data, '');
  const rev = recordRevision(ctx, slug, 'translation', data, '', userId);
  return { ok: true, rev, state: translationState(bgRec.data, bgRec.body, data), errors: incomplete, mtime: readTranslation(ctx, slug).mtime };
}

/** „Преводът е актуален“: собственикът е прегледал промените в оригинала и потвърждава превода */
export function approveCurrent(ctx, slug, bgRec, userId) {
  const tr = readTranslation(ctx, slug);
  if (!tr || tr.error) return { status: 404, error: 'Няма превод.' };
  const data = structuredClone(tr.data);
  data.translation = { ...(data.translation ?? {}), sourceHash: sourceHash(bgRec.data, bgRec.body), updated: new Date().toISOString().slice(0, 10) };
  writeTranslation(ctx, slug, data, tr.body);
  recordRevision(ctx, slug, 'translation', data, tr.body, userId);
  return { ok: true };
}

/** Промяна на статуса (чернова / за преглед / готов / публикуван) без редакция на текста */
export function setTranslationStatus(ctx, slug, bgRec, status, userId) {
  const tr = readTranslation(ctx, slug);
  if (!tr || tr.error) return { status: 404, error: 'Няма превод.' };
  if (!TRANSLATION_STATUSES.includes(status)) return { status: 400, error: 'Непознат статус на превода.' };
  if (status === 'ready' || status === 'published') {
    const info = translationInfo(ctx, slug, bgRec);
    if (info.state === 'outdated') return { status: 409, error: 'Оригиналът е променен след превода. Прегледайте превода и го потвърдете като актуален, преди да го публикувате.' };
    if (!info.canPublish) return { status: 422, error: 'Преводът не е пълен или има грешки.', errors: [...info.errors, ...info.unmapped.map((u) => `няма английски етикет (${u.group}): „${u.value}“`)] };
  }
  const data = structuredClone(tr.data);
  data.translation = { ...(data.translation ?? {}), status, updated: new Date().toISOString().slice(0, 10) };
  writeTranslation(ctx, slug, data, tr.body);
  recordRevision(ctx, slug, 'translation', data, tr.body, userId);
  return { ok: true, status };
}

/**
 * След запис на оригинала: общите полета се обновяват в превода; ако текстът е променен, преводът става „остарял“ (хешът не се пипа).
 * Ако структурата вече не съвпада (друг брой съставки/стъпки/снимки), публикуван превод се връща „за преглед“, за да не се покаже грешна страница.
 */
export function afterSourceSaved(ctx, slug, bgData, bgBody, userId) {
  const tr = readTranslation(ctx, slug);
  if (!tr || tr.error) return { translation: 'missing' };
  const { data, structural } = syncFromSource(bgData, tr.data, taxonomy(ctx));
  let unpublished = false;
  if (structural && (data.translation?.status === 'published' || data.translation?.status === 'ready')) {
    data.translation = { ...(data.translation ?? {}), status: 'needs-review' };
    unpublished = true;
  }
  if (JSON.stringify(data) !== JSON.stringify(tr.data)) { writeTranslation(ctx, slug, data, tr.body); }
  const state = translationState(bgData, bgBody, data);
  return { translation: state, structural, unpublished };
}

/** Допълва речника на таксономията (файл _taxonomy.json до рецептите): нов български термин -> английски етикет */
export function saveTaxonomyTerm(ctx, group, value, label) {
  const ok = ['category', 'method', 'cuisine', 'difficulty', 'allergen', 'tag', 'unit', 'session'];
  if (!ok.includes(group)) return { status: 400, error: 'Непозната група.' };
  const v = String(value ?? '').trim(), l = String(label ?? '').trim();
  if (!v || (!l && group !== 'unit') || v.length > 120 || l.length > 120) return { status: 400, error: 'Невалидна стойност.' };
  const file = path.join(ctx.config.contentDir, OVERLAY_FILE);
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* още няма */ }
  (cur[group] ??= {})[v] = l;
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return { ok: true };
}

export { photoDir };
