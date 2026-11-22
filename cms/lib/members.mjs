// Профили на посетителите: регистрация, потвърждаване на имейл, вход/изход, сесии, нова парола, настройки, изтриване и износ на данни.
// Без собствена криптография: Argon2id (@node-rs/argon2) за паролите, node:crypto за случайните кодове и хешовете.
// Отговорите не разкриват дали даден имейл е регистриран (регистрация, забравена парола, вход).
import { hashPassword, verifyPassword, validatePassword, lockedUntil, recordFailure, clearFailures } from './auth.mjs';
import { sha256, randomToken } from './crypto.mjs';
import { allow } from './community.mjs';
import { mailEnabled, sendMailLater, templates } from './mailer.mjs';

export const ROLES = ['user', 'moderator', 'admin'];
export const STATUSES = ['active', 'suspended'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|bg|info|ru|xyz|top|io|me|click|site|shop|online|link)\b)/i;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export const normEmail = (e) => String(e ?? '').trim().toLowerCase();
export const actorOfUser = (id) => `u:${id}`;
const loc = (l) => (l === 'en' ? 'en' : 'bg');

export function validateDisplayName(n) {
  const v = clean(n);
  if (v.length < 2 || v.length > 40) return { error: 'Името трябва да е между 2 и 40 знака.' };
  if (URL_RE.test(v) || v.includes('@')) return { error: 'Името не може да съдържа връзки или имейл адреси.' };
  return { value: v };
}

/** Публичен изглед на профила (без хеш на паролата и без вътрешни полета) */
export const publicUser = (u) => u && ({
  id: u.id, email: u.email, displayName: u.display_name, role: u.role, status: u.status, locale: u.locale,
  emailVerified: !!u.email_verified_at, emailVerifiedAt: u.email_verified_at, createdAt: u.created_at,
});

let dummyHash;
const equalizeTiming = async (pw) => { dummyHash ??= await hashPassword(randomToken(16)); await verifyPassword(dummyHash, String(pw ?? '')); };

// ---------- Еднократни кодове от писмата ----------
function issueToken(ctx, userId, purpose) {
  const token = randomToken(32);
  const t = Date.now();
  const ttl = purpose === 'reset' ? ctx.config.members.resetTtlMs : ctx.config.members.verifyTtlMs;
  ctx.db.tx(() => {
    // винаги само един активен код за целта: предишните спират да важат
    ctx.db.run('UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', t, userId, purpose);
    ctx.db.run('INSERT INTO user_tokens (user_id, purpose, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', userId, purpose, sha256(token), t, t + ttl);
  });
  return token;
}

function takeToken(ctx, token, purpose) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const r = ctx.db.get('SELECT * FROM user_tokens WHERE token_hash = ? AND purpose = ?', sha256(token), purpose);
  if (!r || r.used_at || r.expires_at < Date.now()) return null;
  return r;
}

function sendVerification(ctx, user) {
  const token = issueToken(ctx, user.id, 'verify');
  sendMailLater(ctx, { to: user.email, ...templates.verify(ctx, { locale: user.locale, name: user.display_name, token }) }, 'verify');
}

// ---------- Регистрация ----------
export async function register(ctx, { email, password, displayName, locale, ip, acceptTerms }) {
  if (!mailEnabled(ctx)) return { status: 503, error: 'Регистрацията временно не е налична.' };
  const e = normEmail(email);
  if (!EMAIL_RE.test(e) || e.length > 120) return { status: 400, error: 'Невалиден имейл адрес.' };
  const name = validateDisplayName(displayName);
  if (name.error) return { status: 400, error: name.error };
  const bad = validatePassword(password, e);
  if (bad) return { status: 400, error: bad };
  if (acceptTerms !== true) return { status: 400, error: 'Необходимо е да приемете правилата и политиката за поверителност.' };
  const ih = ctx.ipHash(ip);
  if (!allow(ctx, 'register:ip:' + ih, 5, 3600e3) || !allow(ctx, 'register:email:' + sha256(e).slice(0, 24), 3, 86400e3)) {
    return { status: 429, error: 'Твърде много опити. Опитайте по-късно.' };
  }
  const hash = await hashPassword(password); // хешира се и при съществуващ имейл – еднакво време за отговор
  const existing = ctx.db.get('SELECT * FROM users WHERE email = ?', e);
  if (existing) {
    sendMailLater(ctx, { to: existing.email, ...templates.exists(ctx, { locale: existing.locale, name: existing.display_name }) }, 'exists');
    return { status: 202, ok: true };
  }
  const t = Date.now();
  const id = ctx.db.run('INSERT INTO users (email, display_name, password_hash, locale, created_at, updated_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    e, name.value, hash, loc(locale), t, t, t).id;
  ctx.audit('user:' + id, 'user.registered', String(id), null, ip);
  sendVerification(ctx, ctx.db.get('SELECT * FROM users WHERE id = ?', id));
  return { status: 202, ok: true };
}

export function verifyEmail(ctx, token) {
  const r = takeToken(ctx, token, 'verify');
  if (!r) return { status: 400, error: 'Връзката е невалидна или е изтекла.' };
  const t = Date.now();
  ctx.db.tx(() => {
    ctx.db.run('UPDATE user_tokens SET used_at = ? WHERE id = ?', t, r.id);
    ctx.db.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?', t, t, r.user_id);
  });
  ctx.audit('user:' + r.user_id, 'user.verified', String(r.user_id));
  return { ok: true };
}

export function resendVerification(ctx, user) {
  if (user.email_verified_at) return { ok: true, already: true };
  if (!mailEnabled(ctx)) return { status: 503, error: 'Изпращането на писма временно не е налично.' };
  if (!allow(ctx, 'verify-resend:' + user.id, 3, 3600e3)) return { status: 429, error: 'Твърде много опити. Опитайте по-късно.' };
  sendVerification(ctx, user);
  return { ok: true };
}

// ---------- Вход ----------
export async function login(ctx, { email, password, ip }) {
  const e = normEmail(email);
  const keys = ['m-ip:' + ctx.ipHash(ip), 'm-email:' + sha256(e).slice(0, 24)];
  const lock = lockedUntil(ctx, keys);
  if (lock) return { status: 429, error: 'Твърде много неуспешни опити. Опитайте по-късно.', until: lock };
  const user = e ? ctx.db.get('SELECT * FROM users WHERE email = ?', e) : null;
  const valid = user ? await verifyPassword(user.password_hash, String(password ?? '')) : (await equalizeTiming(password), false);
  if (!valid) {
    keys.forEach((k) => recordFailure(ctx, k));
    ctx.audit('visitor', 'member.login_failed', null, null, ip);
    return { status: 401, error: 'Грешен имейл или парола.' };
  }
  clearFailures(ctx, keys[1]);
  if (user.status !== 'active') return { status: 403, error: 'Профилът е спрян. Свържете се с редакцията.' };
  return { ok: true, user };
}

// ---------- Сесии ----------
export function createUserSession(ctx, user, { ip, ua }) {
  const token = randomToken(32);
  const t = Date.now();
  ctx.db.run('INSERT INTO user_sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    sha256(token), user.id, randomToken(24), t, t, t + ctx.config.members.absoluteMs, ctx.ipHash(ip), String(ua ?? '').slice(0, 200));
  ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', t, user.id);
  return token;
}

/** Сесия + профил. Спрян профил или изтекла сесия → null (и сесията се изтрива). */
export function getUserSession(ctx, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const id = sha256(token);
  const s = ctx.db.get('SELECT s.id AS sid, s.csrf_token, s.created_at AS s_created, s.last_seen_at, s.expires_at, u.* FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?', id);
  if (!s) return null;
  const t = Date.now();
  if (t > s.expires_at || t - s.last_seen_at > ctx.config.members.idleMs || s.status !== 'active') {
    ctx.db.run('DELETE FROM user_sessions WHERE id = ?', id);
    return null;
  }
  if (t - s.last_seen_at > 5 * 60e3) ctx.db.run('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?', t, id);
  return s;
}

export const destroyUserSession = (ctx, token) => { if (token) ctx.db.run('DELETE FROM user_sessions WHERE id = ?', sha256(token)); };
export const destroyUserSessions = (ctx, userId, exceptSid = null) => ctx.db.run('DELETE FROM user_sessions WHERE user_id = ? AND id != ?', userId, exceptSid ?? '');
export const sessionCount = (ctx, userId) => ctx.db.get('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?', userId).n;

export function purgeMembers(ctx) {
  const t = Date.now();
  ctx.db.run('DELETE FROM user_sessions WHERE expires_at < ? OR last_seen_at < ?', t, t - ctx.config.members.idleMs);
  ctx.db.run('DELETE FROM user_tokens WHERE (used_at IS NOT NULL OR expires_at < ?) AND created_at < ?', t, t - ctx.config.members.tokenRetentionMs);
}

// ---------- Забравена и нова парола ----------
export function forgotPassword(ctx, { email, ip }) {
  if (!mailEnabled(ctx)) return { status: 503, error: 'Изпращането на писма временно не е налично.' };
  const e = normEmail(email);
  if (!EMAIL_RE.test(e)) return { status: 400, error: 'Невалиден имейл адрес.' };
  if (!allow(ctx, 'forgot:ip:' + ctx.ipHash(ip), 5, 3600e3)) return { status: 429, error: 'Твърде много опити. Опитайте по-късно.' };
  // Ограничението по имейл е тихо: отговорът е еднакъв, за да не издава регистрирани адреси.
  const user = ctx.db.get('SELECT * FROM users WHERE email = ?', e);
  if (user && user.status === 'active' && allow(ctx, 'forgot:email:' + user.id, 3, 3600e3)) {
    const token = issueToken(ctx, user.id, 'reset');
    sendMailLater(ctx, { to: user.email, ...templates.reset(ctx, { locale: user.locale, name: user.display_name, token }) }, 'reset');
  }
  return { status: 202, ok: true };
}

export async function resetPassword(ctx, { token, password, ip }) {
  if (!allow(ctx, 'reset:ip:' + ctx.ipHash(ip), 10, 3600e3)) return { status: 429, error: 'Твърде много опити. Опитайте по-късно.' };
  const r = takeToken(ctx, token, 'reset');
  if (!r) return { status: 400, error: 'Връзката е невалидна или е изтекла. Поискайте нова.' };
  const user = ctx.db.get('SELECT * FROM users WHERE id = ?', r.user_id);
  if (!user || user.status !== 'active') return { status: 400, error: 'Връзката е невалидна или е изтекла. Поискайте нова.' };
  const bad = validatePassword(password, user.email);
  if (bad) return { status: 400, error: bad };
  const hash = await hashPassword(password);
  const t = Date.now();
  ctx.db.tx(() => {
    ctx.db.run('UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', t, user.id, 'reset');
    // писмото доказва, че адресът е на потребителя – имейлът се смята за потвърден
    ctx.db.run('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', hash, t, t, t, user.id);
    ctx.db.run('DELETE FROM user_sessions WHERE user_id = ?', user.id); // всички отворени сесии спират да важат
  });
  ctx.audit('user:' + user.id, 'user.password_reset', String(user.id), null, ip);
  return { ok: true, user };
}

export async function changePassword(ctx, user, { current, next }) {
  const u = ctx.db.get('SELECT * FROM users WHERE id = ?', user.id);
  if (!u || !(await verifyPassword(u.password_hash, String(current ?? '')))) return { status: 400, error: 'Текущата парола не е вярна.' };
  const bad = validatePassword(next, u.email);
  if (bad) return { status: 400, error: bad };
  const t = Date.now();
  ctx.db.run('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?', await hashPassword(next), t, t, u.id);
  ctx.db.run('DELETE FROM user_sessions WHERE user_id = ?', u.id); // и текущата: маршрутът издава нова (ротация)
  ctx.audit('user:' + u.id, 'user.password_changed', String(u.id));
  return { ok: true, user: u };
}

export function updateProfile(ctx, user, { displayName, locale }) {
  const sets = [], args = [];
  if (displayName !== undefined) {
    const n = validateDisplayName(displayName);
    if (n.error) return { status: 400, error: n.error };
    sets.push('display_name = ?'); args.push(n.value);
  }
  if (locale !== undefined) {
    if (locale !== 'bg' && locale !== 'en') return { status: 400, error: 'Невалиден език.' };
    sets.push('locale = ?'); args.push(locale);
  }
  if (!sets.length) return { ok: true };
  ctx.db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, Date.now(), user.id);
  return { ok: true };
}

// ---------- Изтриване и износ ----------
/** Етикет за автора на одобрените коментари на изтрит профил */
export const DELETED_AUTHOR = 'Изтрит профил';

export async function deleteAccount(ctx, user, { password, ip }) {
  const u = ctx.db.get('SELECT * FROM users WHERE id = ?', user.id);
  if (!u || !(await verifyPassword(u.password_hash, String(password ?? '')))) return { status: 400, error: 'Паролата не е вярна.' };
  const t = Date.now();
  ctx.db.tx(() => {
    // Одобрените коментари остават без връзка с човека (анонимизирани); всички останали се изтриват по съдържание.
    ctx.db.run("UPDATE comments SET author_name = ?, author_email = NULL, actor_id = NULL, ip_hash = NULL, user_id = NULL, updated_at = ? WHERE user_id = ? AND status = 'approved'", DELETED_AUTHOR, t, u.id);
    ctx.db.run("UPDATE comments SET status = 'deleted', body = '', author_name = ?, author_email = NULL, actor_id = NULL, ip_hash = NULL, user_id = NULL, updated_at = ? WHERE user_id = ?", DELETED_AUTHOR, t, u.id);
    ctx.db.run('UPDATE comment_reports SET actor_id = ? WHERE reporter_user_id = ?', 'deleted:' + randomToken(9), u.id);
    // оценки, любими, история, сесии и кодове се изтриват каскадно
    ctx.db.run('DELETE FROM users WHERE id = ?', u.id);
  });
  ctx.audit('system', 'user.deleted', String(u.id), null, ip);
  return { ok: true };
}

export function exportData(ctx, user) {
  const u = ctx.db.get('SELECT * FROM users WHERE id = ?', user.id);
  return {
    exportedAt: new Date().toISOString(),
    profile: publicUser(u),
    favorites: ctx.db.all('SELECT recipe_slug AS recipe, created_at AS createdAt FROM favorites WHERE user_id = ? ORDER BY created_at', u.id),
    cooked: ctx.db.all('SELECT recipe_slug AS recipe, cooked_at AS cookedAt, servings, note FROM cook_events WHERE user_id = ? ORDER BY cooked_at', u.id),
    ratings: ctx.db.all("SELECT recipe_slug AS recipe, score, created_at AS createdAt, updated_at AS updatedAt FROM ratings WHERE user_id = ?", u.id),
    comments: ctx.db.all("SELECT recipe_slug AS recipe, body, status, created_at AS createdAt, edited_at AS editedAt FROM comments WHERE user_id = ? AND status != 'deleted' ORDER BY created_at", u.id),
    reports: ctx.db.all('SELECT comment_id AS commentId, category, reason, created_at AS createdAt FROM comment_reports WHERE reporter_user_id = ?', u.id),
    sessions: ctx.db.all('SELECT created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt, user_agent AS userAgent FROM user_sessions WHERE user_id = ?', u.id),
  };
}

// ---------- Администриране на профили (роля admin) ----------
export function listUsers(ctx, { q = '', page = 1, per = 25 }) {
  const where = [], args = [];
  if (q) { where.push("(email LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')"); const like = '%' + String(q).slice(0, 80).replace(/[\\%_]/g, '\\$&') + '%'; args.push(like, like); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = ctx.db.get(`SELECT COUNT(*) AS n FROM users ${w}`, ...args).n;
  const rows = ctx.db.all(`SELECT * FROM users ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...args, per, (Math.max(1, page) - 1) * per);
  return { total, pages: Math.max(1, Math.ceil(total / per)), users: rows.map((u) => ({ ...publicUser(u), lastLoginAt: u.last_login_at })) };
}

export function setUserRoleStatus(ctx, actor, targetId, { role, status, reason }) {
  const target = ctx.db.get('SELECT * FROM users WHERE id = ?', Number(targetId));
  if (!target) return { status: 404, error: 'Профилът не е намерен.' };
  if (target.id === actor.id) return { status: 409, error: 'Не можете да променяте собствената си роля или статус.' };
  if (role !== undefined && !ROLES.includes(role)) return { status: 400, error: 'Невалидна роля.' };
  if (status !== undefined && !STATUSES.includes(status)) return { status: 400, error: 'Невалиден статус.' };
  const note = clean(reason).slice(0, 300) || null;
  const t = Date.now();
  ctx.db.tx(() => {
    if (role !== undefined && role !== target.role) {
      ctx.db.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', role, t, target.id);
      ctx.audit('user:' + actor.id, 'user.role', String(target.id), { from: target.role, to: role, reason: note });
    }
    if (status !== undefined && status !== target.status) {
      ctx.db.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, t, target.id);
      if (status === 'suspended') ctx.db.run('DELETE FROM user_sessions WHERE user_id = ?', target.id);
      ctx.audit('user:' + actor.id, 'user.status', String(target.id), { from: target.status, to: status, reason: note });
    }
    // промяна на ролята → нов вход (правата в отворените сесии не остават „стари“)
    if (role !== undefined && role !== target.role) ctx.db.run('DELETE FROM user_sessions WHERE user_id = ?', target.id);
  });
  return { ok: true };
}
