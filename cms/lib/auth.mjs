// Удостоверяване на администратора: Argon2id, сървърни сесии, CSRF, ограничаване на опитите, TOTP и кодове за възстановяване.
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { sha256, hmac, randomToken, safeEq, encrypt, decrypt, newTotpSecret, verifyTotp, otpauthUri } from './crypto.mjs';

const ARGON = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };
export const MIN_PASSWORD = 12;

export const hashPassword = (pw) => argonHash(pw, ARGON);
export async function verifyPassword(hash, pw) {
  try { return await argonVerify(hash, pw); } catch { return false; }
}

export function validatePassword(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Паролата трябва да е поне ${MIN_PASSWORD} знака.`;
  if (pw.length > 200) return 'Паролата е твърде дълга.';
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length > 3) return 'Паролата не бива да съдържа имейла ви.';
  if (/^(.)\1+$/.test(pw)) return 'Паролата е твърде проста.';
  return null;
}

let dummyHash;
async function dummyVerify(pw) {
  dummyHash ??= await hashPassword(randomToken(16));
  await verifyPassword(dummyHash, pw); // изравнява времето, когато имейлът не съществува
}

// ---------- Ограничаване на опитите за вход ----------
export function lockedUntil(ctx, keys) {
  const t = Date.now();
  let max = 0;
  for (const k of keys) {
    const r = ctx.db.get('SELECT locked_until FROM login_attempts WHERE key = ?', k);
    if (r && r.locked_until > t) max = Math.max(max, r.locked_until);
  }
  return max;
}

export function recordFailure(ctx, key) {
  const { maxFailures, windowMs, baseLockMs, maxLockMs } = ctx.config.login;
  const t = Date.now();
  ctx.db.tx(() => {
    const r = ctx.db.get('SELECT * FROM login_attempts WHERE key = ?', key);
    if (!r) { ctx.db.run('INSERT INTO login_attempts (key, failures, first_at) VALUES (?, 1, ?)', key, t); return; }
    const fresh = t - r.first_at > windowMs;
    const failures = (fresh ? 0 : r.failures) + 1;
    if (failures >= maxFailures) {
      const lock = Math.min(maxLockMs, baseLockMs * 2 ** r.lock_count); // нарастващо заключване: 15 мин, 30 мин, 1 ч…
      ctx.db.run('UPDATE login_attempts SET failures = 0, first_at = ?, locked_until = ?, lock_count = lock_count + 1 WHERE key = ?', t, t + lock, key);
    } else {
      ctx.db.run('UPDATE login_attempts SET failures = ?, first_at = ? WHERE key = ?', failures, fresh ? t : r.first_at, key);
    }
  });
}
export const clearFailures = (ctx, key) => ctx.db.run('DELETE FROM login_attempts WHERE key = ?', key);

/** Проверка на имейл и парола. Не разкрива дали имейлът съществува. */
export async function attemptLogin(ctx, { email, password, ip }) {
  const emailNorm = String(email || '').trim().toLowerCase();
  const ipKey = 'ip:' + ctx.ipHash(ip);
  const emailKey = 'email:' + sha256(emailNorm).slice(0, 24);
  const lock = lockedUntil(ctx, [ipKey, emailKey]);
  if (lock) return { ok: false, locked: true, until: lock };
  const user = emailNorm ? ctx.db.get('SELECT * FROM admin_users WHERE email = ?', emailNorm) : null;
  const valid = user ? await verifyPassword(user.password_hash, String(password || '')) : (await dummyVerify(String(password || '')), false);
  if (!valid) {
    recordFailure(ctx, ipKey); recordFailure(ctx, emailKey);
    ctx.audit(emailNorm || 'неизвестен', 'login.failed', null, null, ip);
    const again = lockedUntil(ctx, [ipKey, emailKey]);
    return again ? { ok: false, locked: true, until: again } : { ok: false };
  }
  clearFailures(ctx, emailKey);
  return { ok: true, user };
}

export async function createOwner(ctx, { email, name, password }) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Невалиден имейл.');
  const bad = validatePassword(password, e);
  if (bad) throw new Error(bad);
  if (ctx.db.get('SELECT id FROM admin_users LIMIT 1')) throw new Error('Вече има администратор. Нов се създава само с командата reset-owner.');
  const id = ctx.db.run('INSERT INTO admin_users (email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
    e, (name || e.split('@')[0]).slice(0, 60), await hashPassword(password), Date.now()).id;
  ctx.audit('system', 'owner.created', e);
  return id;
}

// ---------- Сесии ----------
export function createSession(ctx, user, { ip, ua, mfaVerified = true }) {
  const token = randomToken(32);
  const t = Date.now();
  ctx.db.run(
    'INSERT INTO admin_sessions (id, user_id, csrf_token, mfa_verified, created_at, last_seen_at, expires_at, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    sha256(token), user.id, randomToken(24), mfaVerified ? 1 : 0, t, t, t + ctx.config.session.absoluteMs, ctx.ipHash(ip), String(ua || '').slice(0, 200),
  );
  if (mfaVerified) ctx.db.run('UPDATE admin_users SET last_login_at = ? WHERE id = ?', t, user.id);
  return token;
}

export function getSession(ctx, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const id = sha256(token);
  const s = ctx.db.get(
    `SELECT s.*, u.email, u.display_name, u.totp_enabled, u.role FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.id = ?`, id);
  if (!s) return null;
  const t = Date.now();
  const idle = s.mfa_verified ? ctx.config.session.idleMs : 10 * 60e3; // на междинна стъпка (MFA) – 10 минути
  if (t > s.expires_at || t - s.last_seen_at > idle) { ctx.db.run('DELETE FROM admin_sessions WHERE id = ?', id); return null; }
  if (t - s.last_seen_at > 60e3) ctx.db.run('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?', t, id);
  return s;
}

export function destroySession(ctx, token) {
  if (token) ctx.db.run('DELETE FROM admin_sessions WHERE id = ?', sha256(token));
}
export function destroyOtherSessions(ctx, userId, exceptId) {
  ctx.db.run('DELETE FROM admin_sessions WHERE user_id = ? AND id != ?', userId, exceptId);
}
export function purgeExpired(ctx) {
  const t = Date.now();
  ctx.db.run('DELETE FROM admin_sessions WHERE expires_at < ? OR last_seen_at < ?', t, t - ctx.config.session.idleMs);
  ctx.db.run('DELETE FROM rate_events WHERE at < ?', t - 48 * 3600e3);
  ctx.db.run('DELETE FROM login_attempts WHERE locked_until < ? AND first_at < ?', t, t - 24 * 3600e3);
}

export function csrfOk(session, supplied) {
  return !!session && !!supplied && safeEq(session.csrf_token, supplied);
}

// ---------- Двустепенна защита (TOTP) и кодове за възстановяване ----------
const recoveryHash = (ctx, code) => hmac(ctx.secret, 'recovery:' + code.replace(/[^a-z0-9]/gi, '').toLowerCase());

export function startTotpSetup(ctx, user) {
  const secret = newTotpSecret();
  ctx.db.run('UPDATE admin_users SET totp_secret = ?, totp_enabled = 0, totp_last_step = 0 WHERE id = ?', encrypt(ctx.secret, secret), user.id);
  return { secret, uri: otpauthUri(user.email, secret) };
}

export function enableTotp(ctx, userId, code) {
  const u = ctx.db.get('SELECT * FROM admin_users WHERE id = ?', userId);
  if (!u?.totp_secret) return { ok: false };
  const step = verifyTotp(decrypt(ctx.secret, u.totp_secret), code);
  if (!step) return { ok: false };
  const codes = Array.from({ length: 8 }, () => { const r = randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8); return r.slice(0, 4) + '-' + r.slice(4, 8); });
  ctx.db.tx(() => {
    ctx.db.run('UPDATE admin_users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', step, userId);
    ctx.db.run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
    for (const c of codes) ctx.db.run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', userId, recoveryHash(ctx, c));
  });
  return { ok: true, codes };
}

/** Код от приложението или еднократен код за възстановяване. */
export function checkSecondFactor(ctx, userId, input) {
  const u = ctx.db.get('SELECT * FROM admin_users WHERE id = ?', userId);
  if (!u?.totp_enabled || !u.totp_secret) return false;
  const clean = String(input || '').trim();
  if (/^\d{3}\s?\d{3}$/.test(clean)) {
    const step = verifyTotp(decrypt(ctx.secret, u.totp_secret), clean);
    if (!step || step <= u.totp_last_step) return false; // един и същ код не се приема втори път
    ctx.db.run('UPDATE admin_users SET totp_last_step = ? WHERE id = ?', step, userId);
    return true;
  }
  const h = recoveryHash(ctx, clean);
  const r = ctx.db.get('SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', userId, h);
  if (!r) return false;
  ctx.db.run('UPDATE recovery_codes SET used_at = ? WHERE id = ?', Date.now(), r.id);
  return true;
}

export function disableTotp(ctx, userId) {
  ctx.db.tx(() => {
    ctx.db.run('UPDATE admin_users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?', userId);
    ctx.db.run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
  });
}

export async function changePassword(ctx, userId, current, next) {
  const u = ctx.db.get('SELECT * FROM admin_users WHERE id = ?', userId);
  if (!u || !(await verifyPassword(u.password_hash, String(current || '')))) return { ok: false, error: 'Текущата парола не е вярна.' };
  const bad = validatePassword(next, u.email);
  if (bad) return { ok: false, error: bad };
  ctx.db.run('UPDATE admin_users SET password_hash = ? WHERE id = ?', await hashPassword(next), userId);
  return { ok: true };
}
