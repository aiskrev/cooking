// HTML страници на администрацията (сървърно изобразяване; интерактивността е във външни скриптове, CSP позволява само 'self').
import fs from 'node:fs';
import path from 'node:path';
import { esc, fmtDate, fmtDay, plural } from '../lib/util.mjs';
import { layout, badge, pubBadge, notice, table, stars } from '../views/ui.mjs';
import { renderPreview } from '../views/preview.mjs';
import {
  allSummaries, readRecipe, slugs, contentHash, vocabulary, listPhotoFiles, SLUG_RE, COLLECTIONS, DIFFICULTIES, STATUSES, PUBLICATIONS, PLACEHOLDER_ALT, listRevisions, validate, normalize,
} from '../lib/recipes.mjs';
import { currentRelease, siteState, listReleases, lastJobs, runningJob, currentReleaseId } from '../lib/publish.mjs';
import sharp from 'sharp';
import { thumbnail, quotaUsed, mediaFor } from '../lib/media.mjs';
import { commentCounts, listAdminComments, ratingOverview, ratingsFor, STATUS_BG } from '../lib/community.mjs';

const SITE_STATE = {
  live: ['', '~Действия'], pending: ['Промени, чакащи публикуване', 'warn'], removing: ['Ще бъде свалена от сайта', 'warn'], none: ['', '~Действия'],
};

export function registerPages(app, ctx) {
  const render = (c, o) => c.html(layout({ user: c.get('user'), csrf: c.get('session').csrf_token, badges: badges(), ...o }));
  const badges = () => ({ comments: commentCounts(ctx).pending || 0 });

  function recipeRows() {
    const rel = currentRelease(ctx);
    return allSummaries(ctx).map((s) => ({ ...s, site: siteState(rel, s, contentHash(ctx, s.slug)) }));
  }
  const thumbImg = (s, cls = 'thumb') => (s.cover ? `<img class="${cls}" loading="lazy" src="/admin/media/thumb/${esc(s.slug)}/${esc(s.cover)}" alt="">` : `<span class="${cls}" aria-hidden="true"></span>`);
  const siteBadge = (st) => (SITE_STATE[st]?.[0] ? badge(SITE_STATE[st][0], SITE_STATE[st][1]) : '');

  // ---------- Табло ----------
  app.get('/admin', (c) => {
    const rows = recipeRows();
    const counts = commentCounts(ctx);
    const rating = ratingOverview(ctx);
    const rel = currentRelease(ctx);
    const pending = rows.filter((r) => r.site === 'pending' || r.site === 'removing');
    const recent = [...rows].sort((a, b) => b.updatedMs - a.updatedMs).slice(0, 8);
    const recentComments = listAdminComments(ctx, { status: '', per: 5 }).rows;
    const review = rows.filter((r) => r.review || r.status === 'review' || r.status === 'incomplete').length;
    const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
    const body = `
<div class="page-head"><h1>Табло</h1><div class="btn-row"><a class="btn" href="/admin/recipes/new">Нова рецепта</a><a class="btn secondary" href="/admin/publish">Публикуване</a></div></div>
<section class="stats" aria-label="Обобщение">
  ${stat(rows.length, 'Рецепти общо')}${stat(rows.filter((r) => r.publication === 'published').length, 'Публикувани')}
  ${stat(rows.filter((r) => r.publication === 'draft').length, 'Чернови')}${stat(review, 'За редакторски преглед')}
  ${stat(rows.reduce((n, r) => n + r.photos, 0), 'Качени снимки')}${stat(counts.pending, 'Коментари за одобрение')}
  ${stat(rating.total.count ? `${String(rating.total.average).replace('.', ',')} ★ <span class="small muted">(${rating.total.count})</span>` : '—', rating.total.count ? 'Средна оценка от посетители' : 'Още няма оценки')}
</section>
<section class="card" aria-labelledby="h-site"><h2 id="h-site">Сайт</h2>
  <p>Текуща публикувана версия: <strong>${rel ? esc(rel.id) : 'няма'}</strong>${rel?.created_at ? ` · ${fmtDate(rel.created_at)}` : ''}.</p>
  ${pending.length ? notice('warn', `<strong>${plural(pending.length, 'рецепта чака', 'рецепти чакат')} публикуване на сайта:</strong> ${pending.slice(0, 6).map((r) => `<a href="/admin/recipes/${esc(r.slug)}/edit">${esc(r.title)}</a>`).join(', ')}${pending.length > 6 ? ' …' : ''}`) : '<p class="muted">Няма непубликувани промени.</p>'}
  <p><a class="btn small" href="/admin/publish">Към публикуването</a></p>
</section>
<section class="card" aria-labelledby="h-rec"><h2 id="h-rec">Последни рецепти</h2>
${table(['~Снимка', 'Рецепта', 'Категория', 'Състояние', 'Обновена', '~Действия'], recent.map((r) => [
    thumbImg(r), `<a href="/admin/recipes/${esc(r.slug)}/edit"><strong>${esc(r.title)}</strong></a>`, esc(r.category),
    `${pubBadge(r.publication)} ${siteBadge(r.site)}`, `<span class="nowrap">${fmtDay(r.updatedMs)}</span>`,
    `<div class="btn-row"><a class="btn small" href="/admin/recipes/${esc(r.slug)}/edit">Редактирай</a><a class="btn small ghost" href="/admin/recipes/${esc(r.slug)}/preview" target="_blank" rel="noopener">Преглед</a></div>`,
  ]), 'Още няма рецепти.')}
</section>
<section class="card" aria-labelledby="h-com"><h2 id="h-com">Последни коментари</h2>
${recentComments.length ? recentComments.map((m) => commentCard(m, true)).join('') : '<div class="empty">Още няма коментари. Когато посетители пишат под рецептите, ще ги видите тук.</div>'}
<p><a href="/admin/comments">Всички коментари →</a></p></section>`;
    return render(c, { title: 'Табло', active: 'dashboard', body, scripts: ['/admin/assets/admin.js'] });
  });

  function commentCard(m, compact = false) {
    const actions = [];
    const btn = (action, label, cls = 'secondary', confirm = '') => `<button type="button" class="btn small ${cls}" data-api="/admin/api/comments/${m.id}/action" data-body='${JSON.stringify({ action })}'${confirm ? ` data-confirm="${esc(confirm)}"` : ''}>${label}</button>`;
    if (['pending', 'rejected', 'hidden'].includes(m.status)) actions.push(btn('approve', 'Одобри', ''));
    if (m.status === 'pending') actions.push(btn('reject', 'Отхвърли'));
    if (m.status === 'approved') actions.push(btn('hide', 'Скрий'));
    if (['rejected', 'deleted'].includes(m.status)) actions.push(btn('restore', 'Върни за одобрение'));
    if (m.status !== 'deleted') actions.push(btn('delete', 'Изтрий', 'danger', 'Да се изтрие ли коментарът? Остава в журнала на модерацията.'));
    if (m.status === 'approved' && !compact) actions.push(`<button type="button" class="btn small ghost" data-reply-toggle="${m.id}">Отговор</button>`);
    if (m.actor_id && !compact && !m.blocked) actions.push(`<button type="button" class="btn small ghost" data-api="/admin/api/comments/${m.id}/block" data-body='${JSON.stringify({ reason: 'блокиран от модератор' })}' data-confirm="Да се блокира ли този посетител? Няма да може да коментира и оценява.">Блокирай автора</button>`);
    if (m.reports && !compact) actions.push(`<button type="button" class="btn small ghost" data-api="/admin/api/comments/${m.id}/dismiss">Игнорирай жалбите</button>`);
    return `<article class="comment" id="c${m.id}" data-comment="${m.id}">
  <div class="meta"><strong>${esc(m.author_name)}</strong>${m.is_admin ? badge('Редакция', 'info') : ''}
    ${badge(STATUS_BG[m.status] ?? m.status, m.status === 'approved' ? 'ok' : m.status === 'pending' ? 'warn' : m.status === 'deleted' || m.status === 'rejected' ? 'bad' : '')}
    ${m.reports ? badge(`${plural(m.reports, 'жалба', 'жалби')}`, 'bad') : ''}${m.blocked ? badge('Блокиран автор', 'bad') : ''}
    <span class="muted small">${fmtDate(m.created_at)} · <a href="/admin/comments?slug=${esc(m.recipe_slug)}">${esc(m.recipe_slug)}</a>${m.parent_id ? ` · отговор към #${m.parent_id}` : ''}${m.author_email ? ` · ${esc(m.author_email)}` : ''}</span></div>
  <div class="body">${esc(compact && m.body.length > 160 ? m.body.slice(0, 160) + '…' : m.body)}</div>
  <div class="btn-row" style="margin-top:.5rem">${actions.join('')}</div>
  ${!compact ? `<form class="reply-form" data-reply-form="${m.id}" hidden><label for="r${m.id}">Отговор от редакцията</label><textarea id="r${m.id}" maxlength="${ctx.config.comments.maxBody}" required></textarea><button class="btn small" type="submit">Публикувай отговора</button></form>` : ''}
</article>`;
  }

  // ---------- Рецепти ----------
  app.get('/admin/recipes', (c) => {
    const q = (c.req.query('q') || '').trim().toLowerCase();
    const f = { pub: c.req.query('pub') || '', collection: c.req.query('collection') || '', category: c.req.query('category') || '', review: c.req.query('review') || '' };
    const page = Math.max(1, Number(c.req.query('page')) || 1);
    let rows = recipeRows();
    if (q) rows = rows.filter((r) => (r.title + ' ' + r.slug + ' ' + r.tags.join(' ')).toLowerCase().includes(q));
    if (f.pub) rows = rows.filter((r) => r.publication === f.pub);
    if (f.collection) rows = rows.filter((r) => r.collection === f.collection);
    if (f.category) rows = rows.filter((r) => r.category === f.category);
    if (f.review === '1') rows = rows.filter((r) => r.review || r.status === 'review' || r.status === 'incomplete');
    if (f.review === 'pending') rows = rows.filter((r) => r.site === 'pending' || r.site === 'removing');
    rows.sort((a, b) => b.updatedMs - a.updatedMs);
    const per = 25, pages = Math.max(1, Math.ceil(rows.length / per)), slice = rows.slice((page - 1) * per, page * per);
    const vocab = vocabulary(ctx);
    const opt = (v, label, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(label)}</option>`;
    const qs = (p) => '?' + new URLSearchParams({ ...Object.fromEntries(Object.entries({ q, ...f }).filter(([, v]) => v)), page: String(p) });
    const body = `
<div class="page-head"><h1>Рецепти <span class="muted small">(${rows.length})</span></h1><a class="btn" href="/admin/recipes/new">Нова рецепта</a></div>
<form class="filters" method="get" action="/admin/recipes" role="search">
  <div><label for="q">Търсене</label><input id="q" name="q" type="search" value="${esc(q)}" placeholder="заглавие, адрес, етикет"></div>
  <div><label for="pub">Публикуване</label><select id="pub" name="pub">${opt('', 'Всички', f.pub)}${Object.entries(PUBLICATIONS).map(([k, v]) => opt(k, v, f.pub)).join('')}</select></div>
  <div><label for="collection">Раздел</label><select id="collection" name="collection">${opt('', 'Всички', f.collection)}${Object.entries(COLLECTIONS).map(([k, v]) => opt(k, v, f.collection)).join('')}</select></div>
  <div><label for="category">Категория</label><select id="category" name="category">${opt('', 'Всички', f.category)}${vocab.categories.map((x) => opt(x.name, x.name, f.category)).join('')}</select></div>
  <div><label for="review">Преглед</label><select id="review" name="review">${opt('', 'Всички', f.review)}${opt('1', 'Чакат редакторски преглед', f.review)}${opt('pending', 'Чакат публикуване на сайта', f.review)}</select></div>
  <div><button class="btn secondary" type="submit">Филтрирай</button></div>
</form>
<div class="card">${table(['~Снимка', 'Рецепта', 'Раздел и категория', 'Състояние', 'Снимки', 'Обновена', '~Действия'], slice.map((r) => [
    thumbImg(r),
    `<a href="/admin/recipes/${esc(r.slug)}/edit"><strong>${esc(r.title)}</strong></a><br><span class="muted small">${esc(r.slug)}</span>${r.error ? `<br>${badge('Грешка във файла', 'bad')}` : ''}`,
    `${esc(COLLECTIONS[r.collection] ?? r.collection)}<br><span class="muted small">${esc(r.category)}</span>`,
    `${pubBadge(r.publication)} ${r.review ? badge('Чака преглед', 'info') : ''}<br>${siteBadge(r.site)}`,
    r.photos, `<span class="nowrap">${fmtDay(r.updatedMs)}</span>`,
    `<div class="btn-row"><a class="btn small" href="/admin/recipes/${esc(r.slug)}/edit">Редактирай</a><a class="btn small ghost" href="/admin/recipes/${esc(r.slug)}/preview" target="_blank" rel="noopener">Преглед</a></div>`,
  ]), 'Няма рецепти по зададените условия.')}
${pages > 1 ? `<nav class="pager" aria-label="Страници">${page > 1 ? `<a class="btn small ghost" href="${qs(page - 1)}">← Назад</a>` : ''}<span class="muted">Страница ${page} от ${pages}</span>${page < pages ? `<a class="btn small ghost" href="${qs(page + 1)}">Напред →</a>` : ''}</nav>` : ''}</div>`;
    return render(c, { title: 'Рецепти', active: 'recipes', body, scripts: ['/admin/assets/admin.js'] });
  });

  // ---------- Редактор ----------
  const blankModel = () => ({
    title: '', description: '', collection: 'traditional', category: '', method: [], tags: [], status: 'reconstruction', review: true, illustrative: false, featured: false,
    prepTime: 20, cookTime: 30, restTime: 0, servings: 4, ingredients: [{ title: '', items: [{ name: '', amount: '', unit: '', note: '', scale: true }] }],
    steps: [{ title: '', text: '' }], photos: {}, mise: [], tips: [], mistakes: [], substitutions: [], allergens: [], publication: 'draft',
  });
  function editorPage(c, slug, r) {
    const isNew = !r;
    const files = r ? listPhotoFiles(ctx, slug) : [];
    const rel = r ? currentRelease(ctx) : null;
    const model = r ? { data: { publication: 'published', ...r.data }, body: r.body, mtime: r.mtime } : { data: blankModel(), body: '', mtime: 0 };
    const sum = r ? allSummaries(ctx).find((s) => s.slug === slug) : null;
    const state = r ? siteState(rel, sum, contentHash(ctx, slug)) : 'none';
    const data = {
      isNew, slug: slug ?? null, model, files, vocab: vocabulary(ctx), revisions: r ? listRevisions(ctx, slug) : [],
      enums: { collections: COLLECTIONS, difficulties: DIFFICULTIES, statuses: STATUSES, publications: PUBLICATIONS, placeholder: PLACEHOLDER_ALT },
      limits: { maxFileMB: Math.round(ctx.config.upload.maxFileBytes / 1048576), maxFiles: ctx.config.upload.maxFiles },
      siteState: state, building: !!runningJob(ctx),
      crops: r ? Object.fromEntries(ctx.db.all('SELECT file, crop FROM media_assets WHERE recipe_slug = ? AND crop IS NOT NULL', slug).map((x) => [x.file, JSON.parse(x.crop)])) : {},
    };
    const title = isNew ? 'Нова рецепта' : `Редакция: ${r.data.title ?? slug}`;
    const body = `
<div class="page-head"><h1>${esc(isNew ? 'Нова рецепта' : r.data.title ?? slug)}</h1>
  <div class="btn-row">${isNew ? '' : `<a class="btn ghost" href="/admin/recipes/${esc(slug)}/preview" target="_blank" rel="noopener">Преглед</a>`}<a class="btn ghost" href="/admin/recipes">← Всички рецепти</a></div></div>
<div id="editor-root" data-editor><div class="empty">Зареждане на редактора… (нужен е JavaScript)</div></div>`;
    return render(c, { title, active: isNew ? 'new' : 'recipes', body, data, scripts: ['/admin/assets/admin.js', '/admin/assets/editor.js'] });
  }
  app.get('/admin/recipes/new', (c) => editorPage(c, null, null));
  app.get('/admin/recipes/:slug/edit', (c) => {
    const slug = c.req.param('slug');
    const r = SLUG_RE.test(slug) ? readRecipe(ctx, slug) : null;
    if (!r) return c.text('Рецептата не е намерена.', 404);
    if (r.error) return render(c, { title: 'Грешка във файла', active: 'recipes', body: `<h1>Грешка във файла на рецептата</h1>${notice('bad', `Файлът „${esc(slug)}/index.md“ не може да се прочете: ${esc(r.error)}. Поправете го ръчно.`)}` });
    return editorPage(c, slug, r);
  });
  app.get('/admin/recipes/:slug/preview', (c) => {
    const slug = c.req.param('slug');
    const r = SLUG_RE.test(slug) ? readRecipe(ctx, slug) : null;
    if (!r || r.error) return c.text('Рецептата не е намерена.', 404);
    return c.html(renderPreview(ctx, r));
  });

  // ---------- Снимки: умалени копия за списъци и преглед ----------
  const sendImg = async (c, width) => {
    const buf = await thumbnail(ctx, c.req.param('slug'), c.req.param('file'), width);
    return buf ? c.body(buf, 200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=60' }) : c.text('Не е намерено.', 404);
  };
  // Оригиналът (умален за показване) – за диалога за изрязване; самият оригинал не се сервира и не е публичен
  app.get('/admin/media/original/:slug/:file', async (c) => {
    const m = mediaFor(ctx, c.req.param('slug'), c.req.param('file'));
    if (!m || !fs.existsSync(m.original_path)) return c.text('Оригиналът не е наличен.', 404);
    const buf = await sharp(m.original_path, { limitInputPixels: ctx.config.upload.maxPixels }).rotate().resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return c.body(buf, 200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' });
  });
  app.get('/admin/media/thumb/:slug/:file', (c) => sendImg(c, 360));
  app.get('/admin/media/photo/:slug/:file', (c) => sendImg(c, 1200));

  // ---------- Медия ----------
  app.get('/admin/media', (c) => {
    const rows = allSummaries(ctx).map((s) => {
      const r = readRecipe(ctx, s.slug);
      const files = listPhotoFiles(ctx, s.slug);
      const meta = r?.data?.photos ?? {};
      const noAlt = files.filter((f) => !meta[f] || (meta[f].alt ?? '').length < 5).length;
      const placeholder = files.filter((f) => (meta[f]?.alt ?? '').includes(PLACEHOLDER_ALT)).length;
      return { ...s, noAlt, placeholder, notIllustrative: !r?.data?.illustrative };
    }).filter((s) => s.photos > 0 || true).sort((a, b) => b.photos - a.photos);
    const total = rows.reduce((n, r) => n + r.photos, 0);
    const used = quotaUsed(ctx), quota = ctx.config.upload.quotaBytes;
    const fmtMB = (b) => (b / 1048576 >= 1024 ? (b / 1073741824).toFixed(2) + ' GB' : Math.round(b / 1048576) + ' MB');
    const body = `
<div class="page-head"><h1>Медия</h1></div>
<section class="stats"><div class="stat"><div class="n">${total}</div><div class="l">Снимки в рецептите</div></div>
<div class="stat"><div class="n">${rows.reduce((n, r) => n + r.placeholder, 0)}</div><div class="l">Чакат собствено описание (alt)</div></div>
<div class="stat"><div class="n">${rows.reduce((n, r) => n + r.noAlt, 0)}</div><div class="l">Без описание</div></div>
<div class="stat"><div class="n">${fmtMB(used)}</div><div class="l">Качени оригинали (от ${fmtMB(quota)})</div></div></section>
<div class="notice">Качването, подреждането, изрязването и описанията се правят в редактора на рецептата – раздел „Снимки“. Оригиналите се пазят извън публичната папка и извън Git; в сайта влиза само обработен WebP без метаданни.</div>
<div class="card">${table(['~Снимка', 'Рецепта', 'Снимки', 'Без описание', 'Чакат описание', '~Действия'], rows.map((r) => [
      thumbImg(r), `<a href="/admin/recipes/${esc(r.slug)}/edit#photos"><strong>${esc(r.title)}</strong></a>`, r.photos,
      r.noAlt ? badge(String(r.noAlt), 'bad') : '0', r.placeholder ? badge(String(r.placeholder), 'warn') : '0',
      `<a class="btn small ghost" href="/admin/recipes/${esc(r.slug)}/edit#photos">Снимки</a>`,
    ]), 'Няма рецепти.')}</div>`;
    return render(c, { title: 'Медия', active: 'media', body, scripts: ['/admin/assets/admin.js'] });
  });

  // ---------- Категории ----------
  app.get('/admin/categories', (c) => {
    const v = vocabulary(ctx);
    const block = (kind, title, list) => `<section class="card"><h2>${title}</h2>${table(['Име', 'Рецепти', '~Действия'], list.map((x) => [
      esc(x.name), x.count, `<button type="button" class="btn small ghost" data-rename="${kind}" data-from="${esc(x.name)}">Преименувай / обедини</button>`,
    ]), 'Няма записи.')}</section>`;
    const body = `<div class="page-head"><h1>Категории и етикети</h1></div>
${notice('', 'Преименуването се прилага във всички рецепти. Ако новото име вече съществува, двете се обединяват. Промяната се вижда на сайта след публикуване.')}
${block('category', 'Категории (вид ястие)', v.categories)}${block('method', 'Начини на готвене', v.methods)}${block('tag', 'Етикети', v.tags)}`;
    return render(c, { title: 'Категории', active: 'categories', body, scripts: ['/admin/assets/admin.js'] });
  });

  // ---------- Коментари ----------
  app.get('/admin/comments', (c) => {
    const status = c.req.query('status') ?? 'pending';
    const reported = status === 'reported';
    const page = Math.max(1, Number(c.req.query('page')) || 1);
    const q = (c.req.query('q') || '').trim(), slug = c.req.query('slug') || '';
    const res = listAdminComments(ctx, { status: reported ? '' : status === 'all' ? '' : status, slug, reported, q, page });
    const counts = commentCounts(ctx);
    const tab = (k, label, n) => `<a class="btn small ${status === k ? '' : 'ghost'}" href="/admin/comments?status=${k}${slug ? '&slug=' + esc(slug) : ''}"${status === k ? ' aria-current="page"' : ''}>${label}${n != null ? ` (${n})` : ''}</a>`;
    const blocked = ctx.db.all('SELECT actor_id, reason, created_at FROM blocked_actors ORDER BY created_at DESC LIMIT 20');
    const body = `<div class="page-head"><h1>Коментари</h1></div>
<nav class="btn-row" aria-label="Състояние">${tab('pending', 'Чакащи', counts.pending)}${tab('reported', 'Докладвани', counts.reported)}${tab('approved', 'Одобрени', counts.approved)}${tab('rejected', 'Отхвърлени', counts.rejected)}${tab('hidden', 'Скрити', counts.hidden)}${tab('deleted', 'Изтрити', counts.deleted)}${tab('all', 'Всички', null)}</nav>
<form class="filters" method="get" action="/admin/comments" style="margin-top:1rem"><input type="hidden" name="status" value="${esc(status)}">
  <div><label for="q">Търсене в текста или автора</label><input id="q" name="q" type="search" value="${esc(q)}"></div>
  <div><label for="slug">Рецепта (адрес)</label><input id="slug" name="slug" type="text" value="${esc(slug)}"></div>
  <div><button class="btn secondary" type="submit">Търси</button></div></form>
${res.rows.length ? res.rows.map((m) => commentCard(m)).join('') : '<div class="empty">Няма коментари в това състояние.</div>'}
${res.pages > 1 ? `<nav class="pager">${page > 1 ? `<a class="btn small ghost" href="/admin/comments?status=${esc(status)}&page=${page - 1}">← Назад</a>` : ''}<span class="muted">Страница ${page} от ${res.pages}</span>${page < res.pages ? `<a class="btn small ghost" href="/admin/comments?status=${esc(status)}&page=${page + 1}">Напред →</a>` : ''}</nav>` : ''}
<section class="card"><h2>Блокирани автори</h2>${blocked.length ? table(['Идентификатор (кратък)', 'Причина', 'От', '~Действия'], blocked.map((b) => [
      `<code>${esc(b.actor_id.slice(0, 8))}</code>`, esc(b.reason ?? ''), fmtDay(b.created_at), `<button class="btn small ghost" data-api="/admin/api/actors/${esc(b.actor_id)}/unblock">Отблокирай</button>`])) : '<p class="muted">Няма блокирани автори.</p>'}
<p class="muted small">Блокира се „гост-бисквитка“, а не човек: посетител, който изчисти бисквитките си, получава нова. Политика и ограничения – в docs/RATINGS_COMMENTS_DESIGN.md.</p></section>`;
    return render(c, { title: 'Коментари', active: 'comments', body, scripts: ['/admin/assets/admin.js'] });
  });

  // ---------- Оценки ----------
  app.get('/admin/ratings', (c) => {
    const ov = ratingOverview(ctx);
    const titles = new Map(allSummaries(ctx).map((s) => [s.slug, s.title]));
    const slug = c.req.query('slug') || '';
    const bar = (n, t) => `<div class="bar" role="img" aria-label="${n} от ${t}"><i style="width:${t ? Math.round((n / t) * 100) : 0}%"></i></div>`;
    const detail = slug ? ratingsFor(ctx, slug) : [];
    const body = `<div class="page-head"><h1>Оценки</h1></div>
${ov.total.count ? `<section class="stats"><div class="stat"><div class="n">${String(ov.total.average).replace('.', ',')} ★</div><div class="l">Средна оценка (${plural(ov.total.count, 'оценка', 'оценки')})</div></div><div class="stat"><div class="n">${ov.removed}</div><div class="l">Премахнати оценки</div></div></section>` : notice('', 'Още няма оценки от посетители. Тук се показват само реални оценки – няма примерни или начални стойности.')}
${ov.rows.length ? `<div class="card">${table(['Рецепта', 'Оценки', 'Средна', '5★', '4★', '3★', '2★', '1★', '~Действия'], ov.rows.map((r) => [
      `<a href="/admin/recipes/${esc(r.slug)}/edit"><strong>${esc(titles.get(r.slug) ?? r.slug)}</strong></a>`, r.n, `${String(Math.round(r.a * 10) / 10).replace('.', ',')} ★`,
      r.s5, r.s4, r.s3, r.s2, r.s1, `<a class="btn small ghost" href="/admin/ratings?slug=${esc(r.slug)}">Подробно</a>`,
    ]))}</div>` : ''}
${slug ? `<section class="card"><h2>Отделни оценки: ${esc(titles.get(slug) ?? slug)}</h2>${table(['Участник (кратко)', 'Оценка', 'Състояние', 'Обновена', '~Действия'], detail.map((r) => [
      `<code>${esc(r.actor)}</code>`, `<span class="stars" aria-label="${r.score} от 5">${'★'.repeat(r.score)}${'☆'.repeat(5 - r.score)}</span>`, r.status === 'accepted' ? badge('Приета', 'ok') : badge('Премахната', 'bad'), fmtDate(r.updated_at),
      r.status === 'accepted' ? `<button class="btn small danger" data-api="/admin/api/ratings/${r.id}/status" data-body='{"status":"removed"}' data-confirm="Да се премахне ли тази оценка от средната?">Премахни</button>` : `<button class="btn small ghost" data-api="/admin/api/ratings/${r.id}/status" data-body='{"status":"accepted"}'>Върни</button>`,
    ]), 'Няма оценки.')}</section>` : ''}
${notice('', '<strong>Ограничение:</strong> посетителят се познава само по гост-бисквитка. Това не доказва, че един човек е един глас – подходящо е за локален преглед, но преди публично пускане е нужна потвърдена самоличност (виж docs/RATINGS_COMMENTS_DESIGN.md).')}`;
    return render(c, { title: 'Оценки', active: 'ratings', body, scripts: ['/admin/assets/admin.js'] });
  });

  // ---------- Публикуване ----------
  app.get('/admin/publish', (c) => {
    const rows = recipeRows();
    const rel = currentRelease(ctx);
    const changed = rows.filter((r) => r.site === 'pending' || r.site === 'removing');
    const releases = listReleases(ctx);
    const jobs = lastJobs(ctx, 8);
    const cur = currentReleaseId(ctx);
    const body = `<div class="page-head"><h1>Публикуване на сайта</h1></div>
<section class="card"><h2>Как работи</h2><p>Промените по рецептите се записват веднага, но <strong>публичният сайт се променя само при публикуване</strong>: сглобява се нова версия в отделна папка, проверява се (връзки, структурирани данни, снимки) и чак тогава се включва с една атомарна смяна. Ако нещо се провали, остава старата версия. Предишните версии могат да се върнат оттук.</p></section>
<section class="card" aria-labelledby="h-state"><h2 id="h-state">Текущо състояние</h2>
<p>Публикувана версия: <strong>${rel ? esc(rel.id) : 'няма'}</strong>${rel?.created_at ? ` · ${fmtDate(rel.created_at)}` : ''}</p>
${changed.length ? `${notice('warn', `<strong>${plural(changed.length, 'рецепта чака', 'рецепти чакат')}:</strong><ul>${changed.map((r) => `<li><a href="/admin/recipes/${esc(r.slug)}/edit">${esc(r.title)}</a> – ${esc(SITE_STATE[r.site][0])}</li>`).join('')}</ul>`)}` : '<p class="muted">Няма промени, които да чакат публикуване.</p>'}
<div class="btn-row"><button type="button" class="btn" data-publish-start>Публикувай сайта</button><span class="muted small">Със студен кеш за снимките отнема десетки минути; обикновено – около 1–3 минути.</span></div>
<div data-publish-box hidden style="margin-top:1rem"><p><strong data-publish-stage></strong></p><div class="progress" aria-hidden="true"><i></i></div><pre class="log" data-publish-log tabindex="0" aria-label="Журнал на сглобяването"></pre></div></section>
<section class="card"><h2>Версии</h2>${table(['Версия', 'Създадена', 'Рецепти', 'Бележка', '~Действия'], releases.map((r) => [
      `<strong>${esc(r.id)}</strong> ${r.id === cur ? badge('Текуща', 'ok') : ''}`, fmtDate(r.created_at), r.recipe_count ?? '—', esc(r.note ?? (r.source === 'seed' ? 'Начална версия' : '')),
      r.id === cur ? '' : `<button class="btn small ghost" data-api="/admin/api/publish/rollback" data-body='${JSON.stringify({ id: r.id })}' data-confirm="Да се включи ли версия ${esc(r.id)}? Публичният сайт веднага ще се върне към нея.">Върни тази версия</button>`,
    ]), 'Няма версии.')}</section>
<section class="card"><h2>Последни сглобявания</h2>${table(['Начало', 'Версия', 'Резултат', 'Етап', 'Грешка'], jobs.map((j) => [
      fmtDate(j.started_at), esc(j.release_id ?? ''), j.status === 'succeeded' ? badge('Успешно', 'ok') : j.status === 'running' ? badge('В ход', 'warn') : badge('Неуспешно', 'bad'), esc(j.stage ?? ''), esc(j.error ?? ''),
    ]), 'Още няма сглобявания.')}</section>`;
    return render(c, { title: 'Публикуване', active: 'publish', body, scripts: ['/admin/assets/admin.js'] });
  });

  // ---------- Настройки ----------
  app.get('/admin/settings', (c) => {
    const u = ctx.db.get('SELECT * FROM admin_users WHERE id = ?', c.get('user').id);
    const backups = fs.existsSync(ctx.paths.backups) ? fs.readdirSync(ctx.paths.backups).filter((f) => f.endsWith('.sqlite')).sort().reverse().slice(0, 8) : [];
    const audit = ctx.db.all('SELECT * FROM audit_events ORDER BY id DESC LIMIT 25');
    const dbSize = fs.existsSync(ctx.paths.db) ? fs.statSync(ctx.paths.db).size : 0;
    const body = `<div class="page-head"><h1>Настройки</h1></div>
<section class="card"><h2>Профил</h2><dl class="kv"><dt>Имейл</dt><dd>${esc(u.email)}</dd><dt>Име</dt><dd>${esc(u.display_name)}</dd><dt>Последен вход</dt><dd>${fmtDate(u.last_login_at)}</dd></dl></section>
<section class="card"><h2>Смяна на парола</h2>
<form data-json-form action="/admin/api/password" data-success="Паролата е сменена. Другите сесии са прекратени." style="max-width:420px">
  <div class="field"><label for="cur">Текуща парола</label><input id="cur" name="current" type="password" required autocomplete="current-password"></div>
  <div class="field"><label for="new">Нова парола (поне 12 знака)</label><input id="new" name="next" type="password" required minlength="12" autocomplete="new-password"></div>
  <button class="btn" type="submit">Смени паролата</button></form></section>
<section class="card" id="mfa"><h2>Двустепенна защита (TOTP)</h2>
${u.totp_enabled ? `<p>${badge('Включена', 'ok')} При вход се иска код от приложение за удостоверяване (или еднократен код за възстановяване).</p>
<form data-json-form action="/admin/api/mfa/disable" data-success="Двустепенната защита е изключена." data-reload style="max-width:420px">
  <div class="field"><label for="dp">Парола</label><input id="dp" name="password" type="password" required autocomplete="current-password"></div>
  <div class="field"><label for="dc">Текущ код или код за възстановяване</label><input id="dc" name="code" type="text" required autocomplete="one-time-code"></div>
  <button class="btn danger" type="submit">Изключи</button></form>`
        : `<p>${badge('Изключена')} Препоръчва се за всеки достъп извън този компютър.</p><div id="mfa-box"><button type="button" class="btn secondary" data-mfa-start>Настрой двустепенна защита</button></div>`}</section>
<section class="card"><h2>Резервно копие на базата</h2><p class="muted small">Копие на оценките, коментарите, потребителите и ревизиите (SQLite). Пълното резервно копие (с оригиналите и ключа) се прави с командата <code>cms:cli backup</code> – вижте docs/LOCAL_RUNBOOK.md.</p>
<button type="button" class="btn secondary" data-api="/admin/api/backup">Направи копие сега</button>
${backups.length ? `<ul>${backups.map((b) => `<li><code>${esc(b)}</code></li>`).join('')}</ul>` : '<p class="muted">Още няма копия.</p>'}</section>
<section class="card"><h2>Система</h2><dl class="kv"><dt>Адрес на сайта</dt><dd>${esc(ctx.config.siteUrl)}</dd><dt>Индексиране от търсачки</dt><dd>${ctx.config.indexable ? 'разрешено' : 'забранено (локален режим)'}</dd>
<dt>Проверка срещу ботове (Turnstile)</dt><dd>${ctx.config.turnstileSecret ? 'включена' : 'изключена (локално)'}</dd><dt>Бисквитки „Secure“</dt><dd>${esc(ctx.config.cookieSecure)}</dd>
<dt>База данни</dt><dd>${Math.round(dbSize / 1024)} KB · миграции: ${ctx.db.all('SELECT name FROM schema_migrations ORDER BY version').map((m) => esc(m.name)).join(', ')}</dd><dt>Node.js</dt><dd>${esc(process.version)}</dd></dl></section>
<section class="card"><h2>Журнал на действията</h2>${table(['Кога', 'Кой', 'Действие', 'Обект'], audit.map((a) => [fmtDate(a.at), esc(a.actor), esc(a.action), esc(a.target ?? '')]), 'Още няма записи.')}</section>`;
    return render(c, { title: 'Настройки', active: 'settings', body, scripts: ['/admin/assets/admin.js', '/admin/assets/settings.js'] });
  });
}
