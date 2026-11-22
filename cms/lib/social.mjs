// Действия на влезлите посетители: любими, история „Сготвих“, оценки, коментари, жалби – и модерация от модератори/администратори.
// Всяка заявка се проверява на сървъра: кой е потребителят, дали записът е негов (без чужди идентификатори → 404), роля за модерацията.
import { sha256 } from './crypto.mjs';
import { allow, isPublished, moderate, dismissReports, STATUS_BG } from './community.mjs';
import { actorOfUser } from './members.mjs';

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|bg|info|ru|xyz|top|io|me|click|site|shop|online|link)\b)/i;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const page = (p) => Math.max(1, Math.min(1000, parseInt(p, 10) || 1));
export const REPORT_CATEGORIES = ['spam', 'harassment', 'personal_data', 'inappropriate', 'other'];

// ---------- Любими ----------
export const listFavorites = (ctx, userId) => ctx.db.all('SELECT recipe_slug AS slug, created_at AS createdAt FROM favorites WHERE user_id = ? ORDER BY created_at DESC', userId);

export function setFavorite(ctx, userId, slug, on) {
  if (!SLUG_RE.test(slug || '')) return { status: 404, error: 'Рецептата не е намерена.' };
  if (on) {
    if (!isPublished(ctx, slug)) return { status: 404, error: 'Рецептата не е намерена.' };
    if (!allow(ctx, 'fav:' + userId, 300, 3600e3)) return { status: 429, error: 'Твърде много заявки.' };
    ctx.db.run('INSERT OR IGNORE INTO favorites (user_id, recipe_slug, created_at) VALUES (?, ?, ?)', userId, slug, Date.now());
  } else {
    ctx.db.run('DELETE FROM favorites WHERE user_id = ? AND recipe_slug = ?', userId, slug);
  }
  return { ok: true, on: !!on };
}

/** Сливане на любимите от браузъра: само добавя (никога не изтрива от профила); идемпотентно. */
export function mergeFavorites(ctx, userId, slugs) {
  if (!Array.isArray(slugs)) return { status: 400, error: 'Очаква се списък.' };
  const list = [...new Set(slugs.filter((s) => typeof s === 'string' && SLUG_RE.test(s)))].slice(0, 500);
  if (!allow(ctx, 'fav-merge:' + userId, 20, 3600e3)) return { status: 429, error: 'Твърде много заявки.' };
  let added = 0;
  const t = Date.now();
  ctx.db.tx(() => {
    for (const s of list) {
      if (!isPublished(ctx, s)) continue;
      added += ctx.db.run('INSERT OR IGNORE INTO favorites (user_id, recipe_slug, created_at) VALUES (?, ?, ?)', userId, s, t).changes;
    }
  });
  return { ok: true, added, favorites: listFavorites(ctx, userId).map((f) => f.slug) };
}

// ---------- „Сготвих“ ----------
function cookInput(b) {
  const out = {};
  if (b.servings !== undefined && b.servings !== null && b.servings !== '') {
    const n = Number(b.servings);
    if (!Number.isInteger(n) || n < 1 || n > 48) return { error: 'Порциите трябва да са цяло число от 1 до 48.' };
    out.servings = n;
  } else if (b.servings === null || b.servings === '') out.servings = null;
  if (b.note !== undefined) {
    const n = clean(b.note);
    if (n.length > 500) return { error: 'Бележката е твърде дълга (най-много 500 знака).' };
    out.note = n || null;
  }
  if (b.cookedAt !== undefined) {
    const at = Number(b.cookedAt);
    if (!Number.isFinite(at) || at > Date.now() + 86400e3 || at < Date.UTC(2020, 0, 1)) return { error: 'Невалидна дата.' };
    out.cookedAt = Math.floor(at);
  }
  return { value: out };
}

export function addCookEvent(ctx, userId, slug, body = {}) {
  if (!isPublished(ctx, slug)) return { status: 404, error: 'Рецептата не е намерена.' };
  const v = cookInput(body);
  if (v.error) return { status: 400, error: v.error };
  if (!allow(ctx, 'cook:' + userId, 30, 3600e3)) return { status: 429, error: 'Твърде много заявки.' };
  const t = Date.now();
  const id = ctx.db.run('INSERT INTO cook_events (user_id, recipe_slug, cooked_at, servings, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId, slug, v.value.cookedAt ?? t, v.value.servings ?? null, v.value.note ?? null, t, t).id;
  return { ok: true, id };
}

export function updateCookEvent(ctx, userId, id, body = {}) {
  const ev = ctx.db.get('SELECT id FROM cook_events WHERE id = ? AND user_id = ?', Number(id), userId);
  if (!ev) return { status: 404, error: 'Записът не е намерен.' }; // чужд запис изглежда като несъществуващ
  const v = cookInput(body);
  if (v.error) return { status: 400, error: v.error };
  const sets = [], args = [];
  if ('servings' in v.value) { sets.push('servings = ?'); args.push(v.value.servings); }
  if ('note' in v.value) { sets.push('note = ?'); args.push(v.value.note); }
  if ('cookedAt' in v.value) { sets.push('cooked_at = ?'); args.push(v.value.cookedAt); }
  if (sets.length) ctx.db.run(`UPDATE cook_events SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`, ...args, Date.now(), ev.id, userId);
  return { ok: true };
}

export function deleteCookEvent(ctx, userId, id) {
  const r = ctx.db.run('DELETE FROM cook_events WHERE id = ? AND user_id = ?', Number(id), userId);
  return r.changes ? { ok: true } : { status: 404, error: 'Записът не е намерен.' };
}

export function listCookEvents(ctx, userId, { page: p = 1, per = 20 } = {}) {
  const total = ctx.db.get('SELECT COUNT(*) AS n FROM cook_events WHERE user_id = ?', userId).n;
  const rows = ctx.db.all('SELECT id, recipe_slug AS slug, cooked_at AS cookedAt, servings, note FROM cook_events WHERE user_id = ? ORDER BY cooked_at DESC, id DESC LIMIT ? OFFSET ?', userId, per, (page(p) - 1) * per);
  return { total, pages: Math.max(1, Math.ceil(total / per)), events: rows };
}

/** Брой готвачи на рецептата: различните профили + старите отметки от браузъри (преди профилите). */
export function recipeCookStats(ctx, slug, userId = null) {
  const users = ctx.db.get('SELECT COUNT(DISTINCT user_id) AS n FROM cook_events WHERE recipe_slug = ?', slug).n;
  const legacy = ctx.db.get('SELECT COUNT(*) AS n FROM cooked_marks WHERE recipe_slug = ?', slug).n;
  const mine = userId ? ctx.db.get('SELECT COUNT(*) AS n, MAX(cooked_at) AS last FROM cook_events WHERE recipe_slug = ? AND user_id = ?', slug, userId) : null;
  return { count: users + legacy, mine: mine?.n ?? 0, lastCookedAt: mine?.last ?? null };
}

// ---------- Оценки ----------
export function setUserRating(ctx, user, slug, score) {
  if (!isPublished(ctx, slug)) return { status: 404, error: 'Рецептата не е намерена.' };
  if (!Number.isInteger(score) || score < 1 || score > 5) return { status: 400, error: 'Оценката трябва да е цяло число от 1 до 5.' };
  if (!allow(ctx, 'urating:' + user.id, 60, 3600e3)) return { status: 429, error: 'Твърде много заявки. Опитайте по-късно.' };
  const t = Date.now();
  const actor = actorOfUser(user.id);
  // Една атомарна заявка (вмъкване или промяна): при едновременни заявки няма двоен запис и средната се смята от таблицата.
  const before = ctx.db.get('SELECT status FROM ratings WHERE recipe_slug = ? AND actor_id = ?', slug, actor);
  if (before?.status === 'removed') return { status: 403, error: 'Оценката ви е премахната от администратор.' };
  ctx.db.run(`INSERT INTO ratings (recipe_slug, actor_id, user_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(recipe_slug, actor_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at WHERE ratings.status = 'accepted'`,
  slug, actor, user.id, score, t, t);
  return { ok: true, changed: !!before };
}

export function deleteUserRating(ctx, userId, slug) {
  const r = ctx.db.run("DELETE FROM ratings WHERE recipe_slug = ? AND user_id = ? AND status = 'accepted'", String(slug ?? ''), userId);
  return r.changes ? { ok: true } : { status: 404, error: 'Оценката не е намерена.' };
}

export const listUserRatings = (ctx, userId) => ctx.db.all("SELECT recipe_slug AS slug, score, updated_at AS updatedAt FROM ratings WHERE user_id = ? AND status = 'accepted' ORDER BY updated_at DESC", userId);

// ---------- Коментари ----------
export function listCommentsFor(ctx, slug, viewer) {
  const actor = viewer ?? '';
  const rows = ctx.db.all(
    `SELECT c.id, c.parent_id, c.depth, COALESCE(u.display_name, c.author_name) AS author, c.body, c.status, c.is_admin, c.actor_id, c.user_id, c.created_at, c.edited_at
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.recipe_slug = ? AND (c.status = 'approved' OR (c.status = 'pending' AND c.actor_id = ?)) ORDER BY c.created_at ASC`, slug, actor);
  const byId = new Map(rows.map((r) => [r.id, {
    id: r.id, parentId: r.parent_id, depth: r.depth, author: r.author, body: r.body, createdAt: r.created_at, editedAt: r.edited_at,
    isAdmin: !!r.is_admin, pending: r.status === 'pending', mine: !!actor && r.actor_id === actor, member: r.user_id != null, replies: [],
  }]));
  const roots = [];
  for (const c of byId.values()) {
    if (c.parentId == null) roots.push(c);
    else byId.get(c.parentId)?.replies.push(c); // отговор към непоказан коментар не се показва
  }
  return roots;
}

function checkBody(ctx, body) {
  const L = ctx.config.comments;
  const b = clean(body);
  if (b.length < L.minBody) return { status: 400, error: 'Коментарът е твърде кратък.' };
  if (b.length > L.maxBody) return { status: 400, error: `Коментарът е твърде дълъг (най-много ${L.maxBody} знака).` };
  if (URL_RE.test(b)) return { status: 400, error: 'Коментарите не могат да съдържат връзки.' };
  return { value: b };
}

export function addUserComment(ctx, { user, slug, body, parentId, ip, honeypot }) {
  if (!isPublished(ctx, slug)) return { status: 404, error: 'Рецептата не е намерена.' };
  if (honeypot) return { status: 201, ok: true, pending: true, silent: true }; // автоматичните заявки получават „успех“, но нищо не се записва
  if (!user.email_verified_at) return { status: 403, error: 'Потвърдете имейла си, за да коментирате.' };
  const v = checkBody(ctx, body);
  if (v.error) return v;
  let parent = null;
  if (parentId != null) {
    parent = ctx.db.get('SELECT id, depth, recipe_slug, status FROM comments WHERE id = ?', Number(parentId));
    if (!parent || parent.recipe_slug !== slug || parent.status !== 'approved') return { status: 400, error: 'Коментарът, на който отговаряте, не е наличен.' };
    if (parent.depth + 1 > ctx.config.comments.memberMaxDepth) return { status: 400, error: 'Достигнато е максималното ниво на отговори.' };
  }
  const actor = actorOfUser(user.id);
  const bodyHash = sha256(v.value.toLowerCase().replace(/\s+/g, ' ')).slice(0, 24);
  const dup = ctx.db.get("SELECT id FROM comments WHERE actor_id = ? AND body_hash = ? AND created_at > ? AND status != 'deleted'", actor, bodyHash, Date.now() - 86400e3);
  if (dup) return { status: 409, error: 'Този коментар вече е изпратен.' };
  const ih = ctx.ipHash(ip);
  if (!allow(ctx, 'ucomment:10m:' + user.id, 3, 600e3) || !allow(ctx, 'ucomment:day:' + user.id, 10, 86400e3) || !allow(ctx, 'comment:ip:day:' + ih, 30, 86400e3)) {
    return { status: 429, error: 'Изпращате твърде често. Опитайте след малко.' };
  }
  const t = Date.now();
  const id = ctx.db.run(
    'INSERT INTO comments (recipe_slug, parent_id, depth, author_name, body, status, actor_id, user_id, ip_hash, body_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    slug, parent?.id ?? null, parent ? parent.depth + 1 : 0, user.display_name, v.value, 'pending', actor, user.id, ih, bodyHash, t, t).id;
  return { status: 201, ok: true, pending: true, id };
}

/** Редакция на собствен коментар. Одобрен коментар се връща за преглед (без „подмяна“ след одобрение). */
export function editUserComment(ctx, { userId, id, body }) {
  const c = ctx.db.get('SELECT * FROM comments WHERE id = ? AND user_id = ?', Number(id), userId);
  if (!c || c.status === 'deleted') return { status: 404, error: 'Коментарът не е намерен.' };
  if (c.status !== 'pending' && c.status !== 'approved') return { status: 409, error: 'Този коментар не може да се редактира.' };
  const v = checkBody(ctx, body);
  if (v.error) return v;
  if (!allow(ctx, 'ucomment-edit:' + userId, 20, 3600e3)) return { status: 429, error: 'Твърде много заявки.' };
  const t = Date.now();
  ctx.db.run("UPDATE comments SET body = ?, body_hash = ?, status = 'pending', edited_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    v.value, sha256(v.value.toLowerCase().replace(/\s+/g, ' ')).slice(0, 24), t, t, c.id, userId);
  return { ok: true, pending: true };
}

/** Оттегляне на собствен коментар: текстът се изтрива, записът остава като „изтрит“ (отговорите към него не се показват). */
export function withdrawUserComment(ctx, { userId, id }) {
  const c = ctx.db.get('SELECT id, status FROM comments WHERE id = ? AND user_id = ?', Number(id), userId);
  if (!c || c.status === 'deleted') return { status: 404, error: 'Коментарът не е намерен.' };
  const t = Date.now();
  ctx.db.tx(() => {
    ctx.db.run("UPDATE comments SET status = 'deleted', body = '', updated_at = ? WHERE id = ?", t, c.id);
    ctx.db.run('UPDATE comment_reports SET resolved_at = ? WHERE comment_id = ? AND resolved_at IS NULL', t, c.id);
  });
  ctx.audit('user:' + userId, 'comment.withdrawn', String(c.id));
  return { ok: true };
}

export function listUserComments(ctx, userId, { page: p = 1, per = 20 } = {}) {
  const total = ctx.db.get("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND status != 'deleted'", userId).n;
  const rows = ctx.db.all("SELECT id, recipe_slug AS slug, parent_id AS parentId, body, status, created_at AS createdAt, edited_at AS editedAt FROM comments WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT ? OFFSET ?",
    userId, per, (page(p) - 1) * per);
  return { total, pages: Math.max(1, Math.ceil(total / per)), comments: rows };
}

export function reportUserComment(ctx, { user, id, category, reason }) {
  if (!REPORT_CATEGORIES.includes(category)) return { status: 400, error: 'Изберете причина за сигнала.' };
  const c = ctx.db.get("SELECT id, user_id FROM comments WHERE id = ? AND status = 'approved'", Number(id));
  if (!c) return { status: 404, error: 'Коментарът не е намерен.' };
  if (c.user_id === user.id) return { status: 409, error: 'Не можете да докладвате собствен коментар.' };
  if (!allow(ctx, 'ureport:' + user.id, 10, 3600e3)) return { status: 429, error: 'Твърде много заявки.' };
  const r = ctx.db.run('INSERT OR IGNORE INTO comment_reports (comment_id, actor_id, reporter_user_id, category, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    c.id, actorOfUser(user.id), user.id, category, clean(reason).slice(0, 300) || null, Date.now());
  return { ok: true, already: r.changes === 0 };
}

// ---------- Модерация (модератор / администратор на сайта) ----------
export const canModerate = (u) => u && (u.role === 'moderator' || u.role === 'admin');
export const isAdmin = (u) => u && u.role === 'admin';
const MOD_ACTIONS = { approve: 'approve', reject: 'reject', hide: 'hide', restore: 'restore' };

export function modQueue(ctx, { view = 'pending', page: p = 1, per = 20 }) {
  const where = view === 'reported' ? 'EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.resolved_at IS NULL)'
    : view === 'pending' ? "c.status = 'pending'"
      : view === 'hidden' ? "c.status IN ('hidden', 'rejected')" : "c.status != 'deleted'";
  const total = ctx.db.get(`SELECT COUNT(*) AS n FROM comments c WHERE ${where}`).n;
  const rows = ctx.db.all(
    `SELECT c.id, c.recipe_slug AS slug, c.parent_id AS parentId, COALESCE(u.display_name, c.author_name) AS author, c.user_id AS userId, c.is_admin AS isAdmin,
            c.body, c.status, c.created_at AS createdAt, c.edited_at AS editedAt, (u.email_verified_at IS NOT NULL) AS verified
       FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE ${where} ORDER BY c.created_at ASC LIMIT ? OFFSET ?`, per, (page(p) - 1) * per);
  // жалбите за показаните коментари – с една заявка (без N+1)
  const ids = rows.map((r) => r.id);
  const reports = ids.length ? ctx.db.all(`SELECT comment_id AS id, category, reason, created_at AS at FROM comment_reports WHERE resolved_at IS NULL AND comment_id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const byId = new Map();
  for (const r of reports) (byId.get(r.id) ?? byId.set(r.id, []).get(r.id)).push({ category: r.category ?? 'other', reason: r.reason, at: r.at });
  const counts = {
    pending: ctx.db.get("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'").n,
    reported: ctx.db.get('SELECT COUNT(DISTINCT comment_id) AS n FROM comment_reports WHERE resolved_at IS NULL').n,
  };
  return { total, pages: Math.max(1, Math.ceil(total / per)), counts, comments: rows.map((r) => ({ ...r, verified: !!r.verified, isAdmin: !!r.isAdmin, statusLabel: STATUS_BG[r.status], reports: byId.get(r.id) ?? [] })) };
}

export function modAct(ctx, moderator, { id, action, reason }) {
  const a = MOD_ACTIONS[action];
  if (!a && action !== 'dismiss') return { status: 400, error: 'Непознато действие.' };
  const note = clean(reason).slice(0, 300);
  if ((action === 'reject' || action === 'hide') && note.length < 3) return { status: 400, error: 'Посочете причина.' };
  const c = ctx.db.get('SELECT id, status FROM comments WHERE id = ?', Number(id));
  if (!c) return { status: 404, error: 'Коментарът не е намерен.' };
  // оттеглен от автора коментар (deleted) не се възстановява от модератор
  if (c.status === 'deleted') return { status: 409, error: 'Коментарът е изтрит от автора си.' };
  const r = action === 'dismiss'
    ? (dismissReports(ctx, c.id, null, { moderatorUserId: moderator.id, note }), { ok: true, status: c.status })
    : moderate(ctx, { id: c.id, action: a, moderatorUserId: moderator.id, note });
  if (!r.ok) return r;
  ctx.audit('user:' + moderator.id, 'mod.' + action, String(c.id), { from: c.status, to: r.status, reason: note || null });
  return r;
}

export function modHistory(ctx, commentId) {
  return ctx.db.all(
    `SELECT e.action, e.note, e.created_at AS at, COALESCE(u.display_name, a.display_name, '—') AS by, CASE WHEN u.id IS NOT NULL THEN u.role WHEN a.id IS NOT NULL THEN 'owner' ELSE NULL END AS byRole
       FROM moderation_events e LEFT JOIN users u ON u.id = e.moderator_user_id LEFT JOIN admin_users a ON a.id = e.admin_id
      WHERE e.comment_id = ? ORDER BY e.created_at ASC, e.id ASC`, Number(commentId));
}

/** Журнал на модерацията и управлението на профили (само администратор). Без IP адреси и без тайни. */
export function modAudit(ctx, { page: p = 1, per = 50 } = {}) {
  const where = "(action LIKE 'mod.%' OR action LIKE 'user.role' OR action LIKE 'user.status' OR action = 'user.deleted')";
  const total = ctx.db.get(`SELECT COUNT(*) AS n FROM audit_events WHERE ${where}`).n;
  const rows = ctx.db.all(`SELECT e.at, e.actor, e.action, e.target, e.detail, u.display_name AS actorName FROM audit_events e
    LEFT JOIN users u ON e.actor = 'user:' || u.id WHERE ${where} ORDER BY e.at DESC, e.id DESC LIMIT ? OFFSET ?`, per, (page(p) - 1) * per);
  return { total, pages: Math.max(1, Math.ceil(total / per)), events: rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) };
}
