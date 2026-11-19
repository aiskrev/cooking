// JSON API на администрацията (само за влезли администратори; сесията и CSRF се проверяват в server.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { bodyLimit } from 'hono/body-limit';
import {
  slugs, readRecipe, normalize, validate, writeRecipe, recordRevision, listRevisions, getRevision, listPhotoFiles, photoDir, contentHash, vocabulary, PUBLICATIONS, PLACEHOLDER_ALT, SLUG_RE,
} from '../lib/recipes.mjs';
import { processUpload, trashPhoto, restoreFromTrash, applyCrop } from '../lib/media.mjs';
import { startBuild, activateRelease, runningJob, readLogTail } from '../lib/publish.mjs';
import { moderate, adminReply, blockActorOf, unblockActor, dismissReports, setRatingStatus } from '../lib/community.mjs';
import { startTotpSetup, enableTotp, disableTotp, changePassword, verifyPassword, destroyOtherSessions, checkSecondFactor } from '../lib/auth.mjs';
import { slugify, moveSync } from '../lib/util.mjs';

export function registerApi(app, ctx) {
  const A = '/admin/api';
  const err = (c, status, error, extra = {}) => c.json({ error, ...extra }, status);
  const busy = (c) => (runningJob(ctx) ? err(c, 409, 'Тече публикуване на сайта – промените са временно заключени. Изчакайте го да приключи.') : null);
  const json = async (c) => { try { return await c.req.json(); } catch { return null; } };
  const who = (c) => c.get('user');
  const loadOr404 = (c) => {
    const slug = c.req.param('slug');
    if (!SLUG_RE.test(slug)) return [null, err(c, 404, 'Рецептата не е намерена.')];
    const r = readRecipe(ctx, slug);
    return r ? [r, null] : [null, err(c, 404, 'Рецептата не е намерена.')];
  };

  /** Моделът на редактора: данните + списък на снимките + проверка. */
  function editorModel(r) {
    const files = listPhotoFiles(ctx, r.slug);
    const v = validate(ctx, r.slug, { ...blank(), ...normalizeLoose(r.data) });
    return { slug: r.slug, data: r.data, body: r.body, files, mtime: r.mtime, hash: contentHash(ctx, r.slug), validation: v, error: r.error };
  }
  const blank = () => ({ title: '', description: '', ingredients: [], steps: [], photos: {}, tags: [], method: [], mise: [], tips: [], mistakes: [], substitutions: [], allergens: [] });
  const normalizeLoose = (d) => { try { return normalize(d, d); } catch { return d; } };

  // ---- Рецепти ----
  app.get(`${A}/recipes/:slug`, (c) => {
    const [r, e] = loadOr404(c); if (e) return e;
    return c.json(editorModel(r));
  });

  app.post(`${A}/recipes`, bodyLimit({ maxSize: 2 * 1024 * 1024 }), async (c) => {
    const b = busy(c); if (b) return b;
    const input = await json(c); if (!input?.data) return err(c, 400, 'Липсват данни.');
    let slug = slugify(input.slug || input.data.title || '');
    if (!slug) return err(c, 422, 'Въведете заглавие, от което да се образува адрес.', { errors: [{ field: 'title', msg: 'Заглавието е задължително.' }] });
    if (!SLUG_RE.test(slug)) return err(c, 422, 'Невалиден адрес.', { errors: [{ field: 'slug', msg: 'Адресът може да съдържа само малки латински букви, цифри и тирета.' }] });
    if (slugs(ctx).includes(slug)) return err(c, 409, `Вече има рецепта с адрес „${slug}“. Променете заглавието или адреса.`, { errors: [{ field: 'slug', msg: 'Адресът е зает.' }] });
    const d = normalize({ ...input.data, publication: 'draft', date: undefined }, {});
    const v = validate(ctx, slug, d);
    if (v.errors.length) return err(c, 422, 'Рецептата има грешки.', { errors: v.errors });
    writeRecipe(ctx, slug, d, String(input.body ?? ''));
    const rev = recordRevision(ctx, slug, 'create', d, String(input.body ?? ''), who(c).id);
    ctx.audit(who(c).email, 'recipe.create', slug, null, c.get('ip'));
    return c.json({ ok: true, slug, rev, warnings: v.warnings, url: `/admin/recipes/${slug}/edit` }, 201);
  });

  app.put(`${A}/recipes/:slug`, bodyLimit({ maxSize: 2 * 1024 * 1024 }), async (c) => {
    const bz = busy(c); if (bz) return bz;
    const [r, e] = loadOr404(c); if (e) return e;
    const input = await json(c); if (!input?.data) return err(c, 400, 'Липсват данни.');
    if (typeof input.expectedMtime === 'number' && Math.abs(input.expectedMtime - r.mtime) > 1 && !input.force) {
      return err(c, 409, 'Рецептата е променена от друго място, откакто сте я отворили. Презаредете, за да не загубите чужда промяна.', { conflict: true, mtime: r.mtime });
    }
    const d = normalize({ ...input.data, publication: r.data.publication ?? 'published', date: input.data.date || r.data.date }, r.data);
    d.date = String(r.data.date ?? d.date).slice(0, 10);
    const v = validate(ctx, r.slug, d);
    if (v.errors.length) return err(c, 422, 'Рецептата има грешки.', { errors: v.errors });
    const body = input.body === undefined ? r.body : String(input.body);
    writeRecipe(ctx, r.slug, d, body);
    const rev = recordRevision(ctx, r.slug, 'save', d, body, who(c).id);
    ctx.audit(who(c).email, 'recipe.save', r.slug, { rev }, c.get('ip'));
    const fresh = readRecipe(ctx, r.slug);
    return c.json({ ok: true, rev, mtime: fresh.mtime, warnings: v.warnings, publishBlockers: v.publishBlockers, hash: contentHash(ctx, r.slug) });
  });

  app.post(`${A}/recipes/:slug/state`, async (c) => {
    const bz = busy(c); if (bz) return bz;
    const [r, e] = loadOr404(c); if (e) return e;
    const input = await json(c);
    const to = input?.publication;
    if (!(to in PUBLICATIONS)) return err(c, 400, 'Непознато състояние.');
    const d = normalize({ ...r.data, publication: to }, r.data);
    d.date = String(r.data.date).slice(0, 10);
    const v = validate(ctx, r.slug, d, { checkTitleAgainstOthers: false });
    if (v.errors.length) return err(c, 422, 'Рецептата има грешки.', { errors: v.errors });
    if (to === 'published' && v.publishBlockers.length) return err(c, 422, 'Рецептата още не е готова за публикуване.', { blockers: v.publishBlockers });
    writeRecipe(ctx, r.slug, d, r.body);
    recordRevision(ctx, r.slug, 'state', d, r.body, who(c).id);
    ctx.audit(who(c).email, 'recipe.state', r.slug, { to }, c.get('ip'));
    return c.json({ ok: true, publication: to, needsSitePublish: true });
  });

  app.post(`${A}/recipes/:slug/duplicate`, async (c) => {
    const bz = busy(c); if (bz) return bz;
    const [r, e] = loadOr404(c); if (e) return e;
    let n = 1, slug;
    do { slug = `${r.slug}-kopie${n > 1 ? '-' + n : ''}`; n++; } while (slugs(ctx).includes(slug));
    const d = { ...r.data, title: `${r.data.title} (копие)`, publication: 'draft', featured: false, date: new Date().toISOString().slice(0, 10) };
    fs.mkdirSync(path.join(ctx.config.contentDir, slug, 'photos'), { recursive: true });
    for (const f of listPhotoFiles(ctx, r.slug)) fs.copyFileSync(path.join(photoDir(ctx, r.slug), f), path.join(photoDir(ctx, slug), f));
    for (const m of ctx.db.all('SELECT * FROM media_assets WHERE recipe_slug = ?', r.slug)) {
      ctx.db.run('INSERT INTO media_assets (recipe_slug, file, original_sha256, original_name, original_path, original_bytes, width, height, dhash, crop, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        slug, m.file, m.original_sha256, m.original_name, m.original_path, m.original_bytes, m.width, m.height, m.dhash, m.crop, m.uploaded_by, Date.now());
    }
    writeRecipe(ctx, slug, d, r.body);
    recordRevision(ctx, slug, 'duplicate', d, r.body, who(c).id);
    ctx.audit(who(c).email, 'recipe.duplicate', slug, { from: r.slug }, c.get('ip'));
    return c.json({ ok: true, slug, url: `/admin/recipes/${slug}/edit` }, 201);
  });

  app.delete(`${A}/recipes/:slug`, async (c) => {
    const bz = busy(c); if (bz) return bz;
    const [r, e] = loadOr404(c); if (e) return e;
    const input = await json(c);
    if (input?.confirm !== r.slug) return err(c, 400, 'Потвърдете, като въведете адреса на рецептата.');
    if ((r.data.publication ?? 'published') === 'published') return err(c, 409, 'Публикувана рецепта не се изтрива. Първо я архивирайте или върнете в чернова.');
    const dest = path.join(ctx.paths.trash, 'recipes');
    fs.mkdirSync(dest, { recursive: true });
    moveSync(path.join(ctx.config.contentDir, r.slug), path.join(dest, `${r.slug}-${Date.now()}`));
    ctx.db.run('DELETE FROM media_assets WHERE recipe_slug = ?', r.slug);
    ctx.audit(who(c).email, 'recipe.delete', r.slug, null, c.get('ip'));
    return c.json({ ok: true });
  });

  // ---- Ревизии ----
  app.get(`${A}/recipes/:slug/revisions`, (c) => {
    const [r, e] = loadOr404(c); if (e) return e;
    return c.json({ revisions: listRevisions(ctx, r.slug) });
  });
  app.post(`${A}/recipes/:slug/revisions/:rev/restore`, async (c) => {
    const bz = busy(c); if (bz) return bz;
    const [r, e] = loadOr404(c); if (e) return e;
    const rev = getRevision(ctx, r.slug, Number(c.req.param('rev')));
    if (!rev) return err(c, 404, 'Ревизията не е намерена.');
    const { data, body } = rev.snapshot;
    const files = new Set(listPhotoFiles(ctx, r.slug));
    const missing = [];
    for (const f of Object.keys(data.photos ?? {})) if (!files.has(f) && !restoreFromTrash(ctx, r.slug, f)) missing.push(f);
    // снимки, които ревизията не знае (качени по-късно), остават и получават описание, за да не се счупи рецептата
    const now = new Set(listPhotoFiles(ctx, r.slug));
    for (const f of now) if (!data.photos?.[f]) (data.photos ??= {})[f] = { alt: `Снимка за „${data.title}“ ${PLACEHOLDER_ALT}` };
    for (const f of missing) delete data.photos[f];
    if (data.cover && !now.has(data.cover)) delete data.cover;
    data.steps = (data.steps ?? []).map((s) => (s.photo && !now.has(s.photo) ? { ...s, photo: undefined } : s));
    data.carousel = (data.carousel ?? []).filter((f) => now.has(f));
    data.publication = r.data.publication ?? data.publication ?? 'published';
    data.updated = new Date().toISOString().slice(0, 10);
    const v = validate(ctx, r.slug, data, { checkTitleAgainstOthers: false });
    if (v.errors.length) return err(c, 422, 'Ревизията не може да се върне: ' + v.errors[0].msg, { errors: v.errors });
    writeRecipe(ctx, r.slug, data, body);
    recordRevision(ctx, r.slug, 'restore', data, body, who(c).id);
    ctx.audit(who(c).email, 'recipe.restore', r.slug, { rev: rev.rev }, c.get('ip'));
    return c.json({ ok: true });
  });

  // ---- Снимки ----
  app.post(`${A}/recipes/:slug/media`, bodyLimit({ maxSize: ctx.config.upload.maxBatchBytes + 1024 * 1024, onError: (c) => err(c, 413, 'Общият размер на качването е твърде голям.') }), async (c) => {
    const bz = busy(c); if (bz) return bz;
    const [r, e] = loadOr404(c); if (e) return e;
    const form = await c.req.parseBody({ all: true });
    const raw = form.files; const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f) => typeof f === 'object' && 'arrayBuffer' in f);
    if (!list.length) return err(c, 400, 'Не са избрани файлове.');
    if (list.length > ctx.config.upload.maxFiles) return err(c, 413, `Най-много ${ctx.config.upload.maxFiles} файла наведнъж.`);
    const allowDuplicate = form.allowDuplicate === '1';
    const results = [];
    let data = { ...r.data, photos: { ...(r.data.photos ?? {}) } };
    let order = Math.max(0, ...Object.values(data.photos).map((m) => (Number.isInteger(m.order) ? m.order : 0)), listPhotoFiles(ctx, r.slug).length);
    for (const f of list) {
      const buffer = Buffer.from(await f.arrayBuffer());
      const res = await processUpload(ctx, { slug: r.slug, name: f.name || 'снимка', buffer, userId: who(c).id, allowDuplicate });
      results.push(res);
      if (res.ok) {
        data.photos[res.file] = { alt: `Снимка за „${data.title}“ ${PLACEHOLDER_ALT}`, order: ++order };
        if (!data.cover) data.cover = res.file;
      }
    }
    if (results.some((x) => x.ok)) {
      const d = normalize({ ...data, publication: r.data.publication }, r.data);
      d.date = String(r.data.date).slice(0, 10);
      writeRecipe(ctx, r.slug, d, r.body);
      recordRevision(ctx, r.slug, 'save', d, r.body, who(c).id);
      ctx.audit(who(c).email, 'media.upload', r.slug, { files: results.filter((x) => x.ok).length }, c.get('ip'));
    }
    const fresh = readRecipe(ctx, r.slug);
    return c.json({ results, data: fresh.data, files: listPhotoFiles(ctx, r.slug), mtime: fresh.mtime });
  });

  app.post(`${A}/recipes/:slug/media/:file/crop`, async (c) => {
    const bz = busy(c); if (bz) return bz;
    const [r, e] = loadOr404(c); if (e) return e;
    const file = c.req.param('file');
    if (!listPhotoFiles(ctx, r.slug).includes(file)) return err(c, 404, 'Снимката не е намерена.');
    const input = await json(c);
    const out = await applyCrop(ctx, r.slug, file, input?.crop ?? null);
    if (out.error) return err(c, 422, out.error);
    ctx.audit(who(c).email, 'media.crop', `${r.slug}/${file}`, null, c.get('ip'));
    return c.json({ ok: true, width: out.width, height: out.height, v: Date.now() });
  });

  app.delete(`${A}/recipes/:slug/media/:file`, async (c) => {
    const bz = busy(c); if (bz) return bz;
    const [r, e] = loadOr404(c); if (e) return e;
    const file = c.req.param('file');
    if (!trashPhoto(ctx, r.slug, file)) return err(c, 404, 'Снимката не е намерена.');
    const d = normalize({
      ...r.data, publication: r.data.publication,
      cover: r.data.cover === file ? '' : r.data.cover,
      carousel: (r.data.carousel ?? []).filter((f) => f !== file),
      steps: (r.data.steps ?? []).map((s) => (s.photo === file ? { ...s, photo: '' } : s)),
      photos: Object.fromEntries(Object.entries(r.data.photos ?? {}).filter(([f]) => f !== file)),
    }, r.data);
    d.date = String(r.data.date).slice(0, 10);
    writeRecipe(ctx, r.slug, d, r.body);
    recordRevision(ctx, r.slug, 'save', d, r.body, who(c).id);
    ctx.audit(who(c).email, 'media.delete', `${r.slug}/${file}`, null, c.get('ip'));
    const fresh = readRecipe(ctx, r.slug);
    return c.json({ ok: true, data: fresh.data, files: listPhotoFiles(ctx, r.slug), mtime: fresh.mtime });
  });

  // ---- Категории и етикети ----
  app.post(`${A}/taxonomy/rename`, async (c) => {
    const bz = busy(c); if (bz) return bz;
    const input = await json(c);
    const { kind, from, to } = input ?? {};
    const t = String(to ?? '').trim();
    if (!['category', 'tag', 'method'].includes(kind) || !from || !t) return err(c, 400, 'Невалидна заявка.');
    let changed = 0;
    for (const s of slugs(ctx)) {
      const r = readRecipe(ctx, s); if (!r || r.error) continue;
      const d = { ...r.data };
      if (kind === 'category' && d.category === from) d.category = t;
      else if (kind !== 'category') {
        const key = kind === 'tag' ? 'tags' : 'method';
        if (!(d[key] ?? []).includes(from)) continue;
        d[key] = [...new Set(d[key].map((x) => (x === from ? t : x)))];
      } else continue;
      writeRecipe(ctx, s, d, r.body);
      recordRevision(ctx, s, 'save', d, r.body, who(c).id);
      changed++;
    }
    ctx.audit(who(c).email, 'taxonomy.rename', kind, { from, to: t, changed }, c.get('ip'));
    return c.json({ ok: true, changed, vocabulary: vocabulary(ctx) });
  });

  // ---- Публикуване на сайта ----
  app.post(`${A}/publish`, async (c) => {
    const input = (await json(c)) ?? {};
    const r = startBuild(ctx, who(c).id, { note: String(input.note ?? '').slice(0, 200) });
    return r.error ? err(c, 409, r.error) : c.json({ ok: true, ...r }, 202);
  });
  app.get(`${A}/publish/status`, (c) => {
    const job = ctx.db.get('SELECT * FROM build_jobs ORDER BY id DESC LIMIT 1');
    if (!job) return c.json({ job: null });
    return c.json({ job: { id: job.id, status: job.status, stage: job.stage, startedAt: job.started_at, finishedAt: job.finished_at, releaseId: job.release_id, error: job.error }, log: readLogTail(job.log_path, 30), running: !!runningJob(ctx) });
  });
  app.post(`${A}/publish/rollback`, async (c) => {
    const input = await json(c);
    const r = activateRelease(ctx, String(input?.id ?? ''));
    return r.error ? err(c, 409, r.error) : c.json({ ok: true });
  });

  // ---- Коментари и оценки ----
  const cid = (c) => Number(c.req.param('id'));
  app.post(`${A}/comments/:id/action`, async (c) => {
    const input = await json(c);
    const r = moderate(ctx, { id: cid(c), action: input?.action, adminId: who(c).id, note: input?.note });
    if (!r.ok) return err(c, r.status, r.error);
    ctx.audit(who(c).email, 'comment.' + input.action, String(cid(c)), null, c.get('ip'));
    return c.json(r);
  });
  app.post(`${A}/comments/:id/reply`, async (c) => {
    const input = await json(c);
    const r = adminReply(ctx, { parentId: cid(c), body: input?.body, adminId: who(c).id, adminName: who(c).display_name });
    if (!r.ok) return err(c, r.status, r.error);
    ctx.audit(who(c).email, 'comment.reply', String(cid(c)), null, c.get('ip'));
    return c.json(r, 201);
  });
  app.post(`${A}/comments/:id/block`, async (c) => {
    const input = await json(c);
    const r = blockActorOf(ctx, { commentId: cid(c), adminId: who(c).id, reason: input?.reason });
    if (!r.ok) return err(c, r.status, r.error);
    ctx.audit(who(c).email, 'actor.block', String(cid(c)), null, c.get('ip'));
    return c.json(r);
  });
  app.post(`${A}/comments/:id/dismiss`, (c) => c.json(dismissReports(ctx, cid(c), who(c).id)));
  app.post(`${A}/actors/:id/unblock`, (c) => { unblockActor(ctx, c.req.param('id')); ctx.audit(who(c).email, 'actor.unblock', null, null, c.get('ip')); return c.json({ ok: true }); });
  app.post(`${A}/ratings/:id/status`, async (c) => {
    const input = await json(c);
    if (!['accepted', 'removed'].includes(input?.status)) return err(c, 400, 'Невалидно състояние.');
    return setRatingStatus(ctx, cid(c), input.status, who(c).id) ? c.json({ ok: true }) : err(c, 404, 'Оценката не е намерена.');
  });

  // ---- Настройки: двустепенна защита, парола, резервно копие ----
  app.post(`${A}/mfa/setup`, (c) => c.json(startTotpSetup(ctx, ctx.db.get('SELECT * FROM admin_users WHERE id = ?', who(c).id))));
  app.post(`${A}/mfa/enable`, async (c) => {
    const input = await json(c);
    const r = enableTotp(ctx, who(c).id, input?.code);
    if (!r.ok) return err(c, 422, 'Кодът не е верен.');
    ctx.audit(who(c).email, 'mfa.enabled', null, null, c.get('ip'));
    return c.json({ ok: true, codes: r.codes });
  });
  app.post(`${A}/mfa/disable`, async (c) => {
    const input = await json(c);
    const u = ctx.db.get('SELECT * FROM admin_users WHERE id = ?', who(c).id);
    if (!(await verifyPassword(u.password_hash, String(input?.password ?? ''))) || !checkSecondFactor(ctx, u.id, input?.code)) return err(c, 422, 'Паролата или кодът не са верни.');
    disableTotp(ctx, u.id);
    ctx.audit(u.email, 'mfa.disabled', null, null, c.get('ip'));
    return c.json({ ok: true });
  });
  app.post(`${A}/password`, async (c) => {
    const input = await json(c);
    const r = await changePassword(ctx, who(c).id, input?.current, input?.next);
    if (!r.ok) return err(c, 422, r.error);
    destroyOtherSessions(ctx, who(c).id, c.get('session').id);
    ctx.audit(who(c).email, 'password.changed', null, null, c.get('ip'));
    return c.json({ ok: true });
  });
  app.post(`${A}/backup`, (c) => {
    const name = `cms-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.sqlite`;
    ctx.db.snapshot(path.join(ctx.paths.backups, name));
    ctx.audit(who(c).email, 'backup.create', name, null, c.get('ip'));
    return c.json({ ok: true, name });
  });
}
