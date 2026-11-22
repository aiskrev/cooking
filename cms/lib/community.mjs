// Оценки и коментари на посетителите + модерация.
// Идентичността на госта е само „гост-бисквитка“: не доказва, че един човек е един глас (виж docs/RATINGS_COMMENTS_DESIGN.md).
import { getCookie, setCookie } from 'hono/cookie';
import { hmac, randomToken, safeEq, sha256 } from './crypto.mjs';
import { clientIp, isHttps } from './http.mjs';
import { readRecipe } from './recipes.mjs';

const GUEST_RE = /^[A-Za-z0-9_-]{20,64}$/;

const actorOf = (ctx, g) => hmac(ctx.secret, 'actor:' + g).slice(0, 32);

/** Само четене: идентификатор на госта, ако вече има бисквитка (при разглеждане не се записва нищо в браузъра). */
export function guestRead(ctx, c) {
  const g = getCookie(c, 'rguest');
  return g && GUEST_RE.test(g) ? actorOf(ctx, g) : null;
}

/** При първо действие (оценка, коментар, отметка) се създава гост-бисквитка: 1 година, HttpOnly. В базата се пази HMAC. */
export function guestEnsure(ctx, c) {
  let g = getCookie(c, 'rguest');
  if (!g || !GUEST_RE.test(g)) {
    g = randomToken(24);
    setCookie(c, 'rguest', g, { httpOnly: true, sameSite: 'Lax', secure: isHttps(ctx, c), path: '/', maxAge: 365 * 86400 });
  }
  return actorOf(ctx, g);
}

export function allow(ctx, bucket, max, windowMs) {
  const t = Date.now();
  const n = ctx.db.get('SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND at > ?', bucket, t - windowMs).n;
  if (n >= max) return false;
  ctx.db.run('INSERT INTO rate_events (bucket, at) VALUES (?, ?)', bucket, t);
  return true;
}

export const isPublished = (ctx, slug) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '')) return false;
  const r = readRecipe(ctx, slug);
  return !!r && !r.error && (r.data.publication ?? 'published') === 'published';
};

export const isBlocked = (ctx, actorId) => !!ctx.db.get('SELECT 1 AS x FROM blocked_actors WHERE actor_id = ?', actorId);

// ---------- Оценки ----------
export function ratingStats(ctx, slug, actorId = null) {
  const rows = ctx.db.all("SELECT score, COUNT(*) AS n FROM ratings WHERE recipe_slug = ? AND status = 'accepted' GROUP BY score", slug);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0, sum = 0;
  for (const r of rows) { dist[r.score] = r.n; count += r.n; sum += r.score * r.n; }
  const mine = actorId ? ctx.db.get('SELECT score, status FROM ratings WHERE recipe_slug = ? AND actor_id = ?', slug, actorId) : null;
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution: dist, mine: mine && mine.status === 'accepted' ? mine.score : null };
}

export function setRating(ctx, { slug, actorId, ip, score }) {
  if (!isPublished(ctx, slug)) return { status: 404, error: 'Рецептата не е намерена.' };
  if (!Number.isInteger(score) || score < 1 || score > 5) return { status: 400, error: 'Оценката трябва да е цяло число от 1 до 5.' };
  if (isBlocked(ctx, actorId)) return { status: 403, error: 'Не можете да оценявате.' };
  if (!allow(ctx, 'rating:actor:' + actorId, 30, 3600e3) || !allow(ctx, 'rating:ip:' + ctx.ipHash(ip), 120, 3600e3)) return { status: 429, error: 'Твърде много заявки. Опитайте по-късно.' };
  const t = Date.now();
  const res = ctx.db.tx(() => {
    const ex = ctx.db.get('SELECT id, status FROM ratings WHERE recipe_slug = ? AND actor_id = ?', slug, actorId);
    if (ex?.status === 'removed') return { status: 403, error: 'Оценката ви е премахната от администратор.' };
    if (ex) ctx.db.run('UPDATE ratings SET score = ?, updated_at = ? WHERE id = ?', score, t, ex.id);
    else ctx.db.run('INSERT INTO ratings (recipe_slug, actor_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', slug, actorId, score, t, t);
    return { ok: true, changed: !!ex };
  });
  return res;
}

export function allSummaries(ctx) {
  const out = {};
  for (const r of ctx.db.all("SELECT recipe_slug AS s, COUNT(*) AS n, AVG(score) AS a FROM ratings WHERE status = 'accepted' GROUP BY recipe_slug")) {
    out[r.s] = { ratings: r.n, average: Math.round(r.a * 10) / 10, comments: 0 };
  }
  for (const r of ctx.db.all("SELECT recipe_slug AS s, COUNT(*) AS n FROM comments WHERE status = 'approved' GROUP BY recipe_slug")) {
    (out[r.s] ??= { ratings: 0, average: null, comments: 0 }).comments = r.n;
  }
  return out;
}

// ---------- Коментари: публична част ----------
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|bg|info|ru|xyz|top|io|me|click|site|shop|online|link)\b)/i;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

export function listPublicComments(ctx, slug, actorId) {
  const rows = ctx.db.all(
    `SELECT id, parent_id, author_name, body, status, is_admin, actor_id, created_at FROM comments
     WHERE recipe_slug = ? AND (status = 'approved' OR (status = 'pending' AND actor_id = ?)) ORDER BY created_at ASC`, slug, actorId);
  const byId = new Map(rows.map((r) => [r.id, { id: r.id, parentId: r.parent_id, author: r.author_name, body: r.body, createdAt: r.created_at, isAdmin: !!r.is_admin, pending: r.status === 'pending', mine: r.actor_id === actorId, replies: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    if (c.parentId == null) roots.push(c);
    else byId.get(c.parentId)?.replies.push(c); // отговор към непубликуван коментар не се показва
  }
  return roots;
}

export function addComment(ctx, { slug, name, email, body, parentId, actorId, ip, honeypot }) {
  const L = ctx.config.comments;
  if (!isPublished(ctx, slug)) return { status: 404, error: 'Рецептата не е намерена.' };
  if (honeypot) return { status: 200, ok: true, pending: true, silent: true }; // ботовете получават „успех“, но нищо не се записва
  if (isBlocked(ctx, actorId)) return { status: 403, error: 'Не можете да коментирате.' };
  const n = clean(name), b = clean(body), e = clean(email);
  if (n.length < 2 || n.length > L.maxName) return { status: 400, error: `Името трябва да е между 2 и ${L.maxName} знака.` };
  if (URL_RE.test(n) || /@/.test(n)) return { status: 400, error: 'Името не може да съдържа връзки или имейл адреси.' };
  if (b.length < L.minBody) return { status: 400, error: 'Коментарът е твърде кратък.' };
  if (b.length > L.maxBody) return { status: 400, error: `Коментарът е твърде дълъг (най-много ${L.maxBody} знака).` };
  if (URL_RE.test(b)) return { status: 400, error: 'Коментарите не могат да съдържат връзки.' };
  if (e && (e.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return { status: 400, error: 'Невалиден имейл адрес.' };
  const ih = ctx.ipHash(ip);
  // Всички проверки на съдържанието минават ПРЕДИ ограничаването на честотата: отхвърлена заявка не изразходва квотата на добронамерения посетител.
  let depth = 0, parent = null;
  if (parentId != null) {
    parent = ctx.db.get("SELECT id, depth, recipe_slug, status FROM comments WHERE id = ?", Number(parentId));
    if (!parent || parent.recipe_slug !== slug || parent.status !== 'approved') return { status: 400, error: 'Коментарът, на който отговаряте, не е наличен.' };
    depth = parent.depth + 1;
    if (depth > L.maxDepth) return { status: 400, error: 'Достигнато е максималното ниво на отговори.' };
  }
  const bodyHash = sha256(b.toLowerCase().replace(/\s+/g, ' ')).slice(0, 24);
  const dup = ctx.db.get("SELECT id FROM comments WHERE actor_id = ? AND body_hash = ? AND recipe_slug = ? AND created_at > ? AND status != 'deleted'", actorId, bodyHash, slug, Date.now() - 86400e3);
  if (dup) return { status: 409, error: 'Този коментар вече е изпратен.' };
  if (!allow(ctx, 'comment:actor:10m:' + actorId, 3, 600e3) || !allow(ctx, 'comment:ip:10m:' + ih, 5, 600e3)
    || !allow(ctx, 'comment:actor:day:' + actorId, 10, 86400e3) || !allow(ctx, 'comment:ip:day:' + ih, 20, 86400e3)) {
    return { status: 429, error: 'Изпращате твърде често. Опитайте след малко.' };
  }
  const t = Date.now();
  const id = ctx.db.run(
    'INSERT INTO comments (recipe_slug, parent_id, depth, author_name, author_email, body, status, actor_id, ip_hash, body_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    slug, parent?.id ?? null, depth, n, e || null, b, 'pending', actorId, ih, bodyHash, t, t).id;
  return { status: 201, ok: true, pending: true, id };
}

export function reportComment(ctx, { id, actorId, ip, reason }) {
  const c = ctx.db.get("SELECT id FROM comments WHERE id = ? AND status = 'approved'", Number(id));
  if (!c) return { status: 404, error: 'Коментарът не е намерен.' };
  if (!allow(ctx, 'report:actor:' + actorId, 10, 3600e3) || !allow(ctx, 'report:ip:' + ctx.ipHash(ip), 30, 3600e3)) return { status: 429, error: 'Твърде много заявки.' };
  const r = clean(reason).slice(0, 300);
  const res = ctx.db.run('INSERT OR IGNORE INTO comment_reports (comment_id, actor_id, reason, created_at) VALUES (?, ?, ?, ?)', c.id, actorId, r || null, Date.now());
  return { status: 200, ok: true, already: res.changes === 0 };
}

export async function verifyTurnstile(ctx, token, ip) {
  if (!ctx.config.turnstileSecret) return true; // локално – изключено; в продукция се задава TURNSTILE_SECRET
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: ctx.config.turnstileSecret, response: String(token), remoteip: ip || '' }), signal: AbortSignal.timeout(5000),
    });
    return !!(await r.json()).success;
  } catch { return false; }
}

// ---------- Модерация ----------
export const STATUS_BG = { pending: 'Чака одобрение', approved: 'Одобрен', rejected: 'Отхвърлен', hidden: 'Скрит', deleted: 'Изтрит' };
const TRANSITIONS = {
  approve: { from: ['pending', 'rejected', 'hidden'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  hide: { from: ['approved'], to: 'hidden' },
  delete: { from: ['pending', 'approved', 'rejected', 'hidden'], to: 'deleted' },
  restore: { from: ['deleted', 'rejected'], to: 'pending' },
};

/** Модерация от собственика (adminId → admin_users) или от модератор на сайта (moderatorUserId → users). */
export function moderate(ctx, { id, action, adminId = null, moderatorUserId = null, note }) {
  const c = ctx.db.get('SELECT * FROM comments WHERE id = ?', id);
  if (!c) return { status: 404, error: 'Коментарът не е намерен.' };
  const tr = TRANSITIONS[action];
  if (!tr) return { status: 400, error: 'Непознато действие.' };
  if (!tr.from.includes(c.status)) return { status: 409, error: `Действието не е позволено за коментар със статус „${STATUS_BG[c.status]}“.` };
  const t = Date.now();
  ctx.db.tx(() => {
    ctx.db.run('UPDATE comments SET status = ?, moderated_by = ?, moderated_at = ?, updated_at = ? WHERE id = ?', tr.to, adminId, t, t, id);
    ctx.db.run('INSERT INTO moderation_events (comment_id, admin_id, moderator_user_id, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, adminId, moderatorUserId, action, clean(note).slice(0, 300) || null, t);
    if (action === 'hide' || action === 'delete' || action === 'reject') ctx.db.run('UPDATE comment_reports SET resolved_at = ? WHERE comment_id = ? AND resolved_at IS NULL', t, id);
  });
  return { ok: true, status: tr.to };
}

export function dismissReports(ctx, id, adminId, { moderatorUserId = null, note = null } = {}) {
  const t = Date.now();
  ctx.db.tx(() => {
    ctx.db.run('UPDATE comment_reports SET resolved_at = ? WHERE comment_id = ? AND resolved_at IS NULL', t, id);
    ctx.db.run('INSERT INTO moderation_events (comment_id, admin_id, moderator_user_id, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, adminId, moderatorUserId, 'dismiss-reports', clean(note).slice(0, 300) || null, t);
  });
  return { ok: true };
}

export function adminReply(ctx, { parentId, body, adminId, adminName }) {
  const p = ctx.db.get('SELECT * FROM comments WHERE id = ?', parentId);
  if (!p) return { status: 404, error: 'Коментарът не е намерен.' };
  if (p.status !== 'approved') return { status: 409, error: 'Може да отговаряте само на одобрен коментар.' };
  const b = clean(body);
  if (b.length < 2 || b.length > ctx.config.comments.maxBody) return { status: 400, error: 'Невалиден текст на отговора.' };
  const depth = Math.min(p.depth + 1, ctx.config.comments.maxDepth);
  const t = Date.now();
  const id = ctx.db.tx(() => {
    const nid = ctx.db.run(
      'INSERT INTO comments (recipe_slug, parent_id, depth, author_name, body, status, is_admin, body_hash, created_at, updated_at, moderated_by, moderated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)',
      p.recipe_slug, p.id, depth, adminName, b, 'approved', sha256(b).slice(0, 24), t, t, adminId, t).id;
    ctx.db.run('INSERT INTO moderation_events (comment_id, admin_id, action, created_at) VALUES (?, ?, ?, ?)', nid, adminId, 'reply', t);
    return nid;
  });
  return { ok: true, id };
}

export function blockActorOf(ctx, { commentId, adminId, reason }) {
  const c = ctx.db.get('SELECT actor_id FROM comments WHERE id = ?', commentId);
  if (!c?.actor_id) return { status: 404, error: 'Няма какво да се блокира.' };
  const t = Date.now();
  ctx.db.tx(() => {
    ctx.db.run('INSERT OR REPLACE INTO blocked_actors (actor_id, reason, created_at, created_by) VALUES (?, ?, ?, ?)', c.actor_id, clean(reason).slice(0, 200) || null, t, adminId);
    ctx.db.run('INSERT INTO moderation_events (comment_id, admin_id, action, note, created_at) VALUES (?, ?, ?, ?, ?)', commentId, adminId, 'block', clean(reason).slice(0, 200) || null, t);
  });
  return { ok: true };
}
export const unblockActor = (ctx, actorId) => ctx.db.run('DELETE FROM blocked_actors WHERE actor_id = ?', actorId);

export function listAdminComments(ctx, { status = '', slug = '', reported = false, q = '', page = 1, per = 20 }) {
  const where = [], args = [];
  if (status) { where.push('c.status = ?'); args.push(status); }
  if (slug) { where.push('c.recipe_slug = ?'); args.push(slug); }
  if (reported) where.push('EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.resolved_at IS NULL)');
  if (q) { where.push("(c.body LIKE ? ESCAPE '\\' OR c.author_name LIKE ? ESCAPE '\\')"); const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'; args.push(like, like); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = ctx.db.get(`SELECT COUNT(*) AS n FROM comments c ${w}`, ...args).n;
  const rows = ctx.db.all(
    `SELECT c.*, (SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id = c.id AND r.resolved_at IS NULL) AS reports,
            EXISTS (SELECT 1 FROM blocked_actors b WHERE b.actor_id = c.actor_id) AS blocked
     FROM comments c ${w} ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT ? OFFSET ?`, ...args, per, (page - 1) * per);
  return { total, rows, pages: Math.max(1, Math.ceil(total / per)) };
}

export function commentCounts(ctx) {
  const o = { pending: 0, approved: 0, rejected: 0, hidden: 0, deleted: 0 };
  for (const r of ctx.db.all('SELECT status, COUNT(*) AS n FROM comments GROUP BY status')) o[r.status] = r.n;
  o.reported = ctx.db.get('SELECT COUNT(DISTINCT comment_id) AS n FROM comment_reports WHERE resolved_at IS NULL').n;
  return o;
}

export function ratingOverview(ctx) {
  const rows = ctx.db.all("SELECT recipe_slug AS slug, COUNT(*) AS n, AVG(score) AS a, SUM(score = 5) AS s5, SUM(score = 4) AS s4, SUM(score = 3) AS s3, SUM(score = 2) AS s2, SUM(score = 1) AS s1, MAX(updated_at) AS last FROM ratings WHERE status = 'accepted' GROUP BY recipe_slug ORDER BY n DESC, a DESC");
  const total = ctx.db.get("SELECT COUNT(*) AS n, AVG(score) AS a FROM ratings WHERE status = 'accepted'");
  return { rows, total: { count: total.n, average: total.n ? Math.round(total.a * 10) / 10 : null }, removed: ctx.db.get("SELECT COUNT(*) AS n FROM ratings WHERE status = 'removed'").n };
}
export const ratingsFor = (ctx, slug) => ctx.db.all('SELECT id, score, status, created_at, updated_at, substr(actor_id, 1, 8) AS actor FROM ratings WHERE recipe_slug = ? ORDER BY updated_at DESC LIMIT 200', slug);
export function setRatingStatus(ctx, id, status, adminId) {
  const r = ctx.db.run('UPDATE ratings SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), id);
  if (r.changes) ctx.audit('admin', status === 'removed' ? 'rating.removed' : 'rating.restored', String(id), { by: adminId });
  return r.changes > 0;
}

export function markCooked(ctx, { slug, actorId, ip, on }) {
  if (!isPublished(ctx, slug)) return { status: 404, error: 'Рецептата не е намерена.' };
  if (isBlocked(ctx, actorId)) return { status: 403, error: 'Не можете да отбелязвате.' };
  if (!allow(ctx, 'cooked:actor:' + actorId, 30, 3600e3) || !allow(ctx, 'cooked:ip:' + ctx.ipHash(ip), 120, 3600e3)) return { status: 429, error: 'Твърде много заявки.' };
  if (on) ctx.db.run('INSERT OR IGNORE INTO cooked_marks (recipe_slug, actor_id, created_at) VALUES (?, ?, ?)', slug, actorId, Date.now());
  else ctx.db.run('DELETE FROM cooked_marks WHERE recipe_slug = ? AND actor_id = ?', slug, actorId);
  return { ok: true };
}
export const cookedStats = (ctx, slug, actorId) => ({
  count: ctx.db.get('SELECT COUNT(*) AS n FROM cooked_marks WHERE recipe_slug = ?', slug).n,
  mine: !!ctx.db.get('SELECT 1 AS x FROM cooked_marks WHERE recipe_slug = ? AND actor_id = ?', slug, actorId),
});
