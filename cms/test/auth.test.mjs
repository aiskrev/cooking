import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.mjs';

const { ctx, cleanup } = await makeCtx();
const A = await import('../lib/auth.mjs');
const C = await import('../lib/crypto.mjs');
test.after(cleanup);

test('паролата се хешира с Argon2id и се проверява', async () => {
  const h = await A.hashPassword('Дълга-парола-123!');
  assert.match(h, /^\$argon2id\$/);
  assert.equal(await A.verifyPassword(h, 'Дълга-парола-123!'), true);
  assert.equal(await A.verifyPassword(h, 'друга парола 123'), false);
  assert.equal(await A.verifyPassword('невалиден хеш', 'x'), false);
});

test('правила за паролата', () => {
  assert.ok(A.validatePassword('къса'));
  assert.ok(A.validatePassword('aaaaaaaaaaaaaaaa'));
  assert.ok(A.validatePassword('owner-owner-123', 'owner@example.invalid'), 'съдържа имейла');
  assert.equal(A.validatePassword('Добра-Парола-2026'), null);
});

test('само един собственик се създава през createOwner', async () => {
  const id = await A.createOwner(ctx, { email: 'Owner@Example.Invalid', name: 'Собственик', password: 'Силна-парола-2026!' });
  assert.ok(id > 0);
  assert.equal(ctx.db.get('SELECT email FROM admin_users').email, 'owner@example.invalid');
  await assert.rejects(() => A.createOwner(ctx, { email: 'x@example.invalid', password: 'Силна-парола-2026!' }), /Вече има администратор/);
});

test('вход: грешна парола, непознат имейл и заключване след 5 неуспеха', async () => {
  const ip = '203.0.113.9';
  assert.equal((await A.attemptLogin(ctx, { email: 'nobody@example.invalid', password: 'x', ip })).ok, false);
  for (let i = 0; i < 3; i++) assert.equal((await A.attemptLogin(ctx, { email: 'owner@example.invalid', password: 'грешна' + i, ip })).ok, false);
  const r = await A.attemptLogin(ctx, { email: 'owner@example.invalid', password: 'грешна-4', ip });
  assert.equal(r.locked, true, 'след 5 неуспешни опита има заключване');
  const ok = await A.attemptLogin(ctx, { email: 'owner@example.invalid', password: 'Силна-парола-2026!', ip });
  assert.equal(ok.locked, true, 'и вярната парола е отказана по време на заключването');
  const other5 = await A.attemptLogin(ctx, { email: 'owner@example.invalid', password: 'грешна-5', ip: '198.51.100.7' });
  assert.equal(other5.locked, true, 'петият неуспех по имейл (от друг адрес) също заключва');
  const other = await A.attemptLogin(ctx, { email: 'owner@example.invalid', password: 'Силна-парола-2026!', ip: '198.51.100.7' });
  assert.equal(other.locked, true, 'заключването по имейл важи и за вярна парола от друг адрес');
  ctx.db.run('DELETE FROM login_attempts');
  assert.equal((await A.attemptLogin(ctx, { email: 'owner@example.invalid', password: 'Силна-парола-2026!', ip })).ok, true);
});

test('заключването нараства при повторение', async () => {
  ctx.db.run('DELETE FROM login_attempts');
  const key = 'email:test';
  for (let i = 0; i < 5; i++) A.recordFailure(ctx, key);
  const first = ctx.db.get('SELECT * FROM login_attempts WHERE key = ?', key);
  ctx.db.run('UPDATE login_attempts SET locked_until = 0 WHERE key = ?', key);
  for (let i = 0; i < 5; i++) A.recordFailure(ctx, key);
  const second = ctx.db.get('SELECT * FROM login_attempts WHERE key = ?', key);
  assert.ok(second.locked_until - Date.now() > (first.locked_until - Date.now()) * 1.5, 'второто заключване е по-дълго');
  ctx.db.run('DELETE FROM login_attempts');
});

test('сесии: създаване, четене, изтичане при бездействие и абсолютно, унищожаване', () => {
  const user = ctx.db.get('SELECT * FROM admin_users');
  const token = A.createSession(ctx, user, { ip: '1.1.1.1', ua: 'test' });
  const s = A.getSession(ctx, token);
  assert.equal(s.email, user.email);
  assert.equal(ctx.db.get('SELECT id FROM admin_sessions WHERE id = ?', token), null, 'токенът не се пази в базата в суров вид');
  assert.ok(A.csrfOk(s, s.csrf_token));
  assert.equal(A.csrfOk(s, 'друг'), false);
  ctx.db.run('UPDATE admin_sessions SET last_seen_at = ?', Date.now() - ctx.config.session.idleMs - 1000);
  assert.equal(A.getSession(ctx, token), null, 'изтича при бездействие');
  const t2 = A.createSession(ctx, user, { ip: '1.1.1.1' });
  ctx.db.run('UPDATE admin_sessions SET expires_at = ?', Date.now() - 1);
  assert.equal(A.getSession(ctx, t2), null, 'изтича абсолютно');
  const t3 = A.createSession(ctx, user, { ip: '1.1.1.1' });
  A.destroySession(ctx, t3);
  assert.equal(A.getSession(ctx, t3), null, 'унищожена при изход');
  assert.equal(A.getSession(ctx, 'x'.repeat(500)), null);
});

test('TOTP: вектор от RFC 6238, прозорец и защита от повторение', () => {
  const secret = C.base32encode(Buffer.from('12345678901234567890'));
  assert.equal(C.hotp(secret, 1), '287082');
  assert.equal(C.verifyTotp(secret, '287082', 59_000), 1);
  assert.equal(C.verifyTotp(secret, '287082', 89_000), 1, 'допустима е съседна стъпка');
  assert.equal(C.verifyTotp(secret, '287082', 200_000), null);
  assert.equal(C.verifyTotp(secret, 'abcdef', 59_000), null);
});

test('двустепенна защита: включване, повторен код, кодове за възстановяване', () => {
  const user = ctx.db.get('SELECT * FROM admin_users');
  const { secret } = A.startTotpSetup(ctx, user);
  const code = C.hotp(secret, Math.floor(Date.now() / 30000));
  const en = A.enableTotp(ctx, user.id, code);
  assert.equal(en.ok, true);
  assert.equal(en.codes.length, 8);
  assert.equal(A.checkSecondFactor(ctx, user.id, code), false, 'същият код не се приема втори път');
  const next = C.hotp(secret, Math.floor(Date.now() / 30000) + 1);
  assert.equal(A.checkSecondFactor(ctx, user.id, next), true);
  assert.equal(A.checkSecondFactor(ctx, user.id, en.codes[0]), true, 'код за възстановяване работи веднъж');
  assert.equal(A.checkSecondFactor(ctx, user.id, en.codes[0]), false);
  assert.equal(A.checkSecondFactor(ctx, user.id, '000000'), false);
  A.disableTotp(ctx, user.id);
  assert.equal(ctx.db.get('SELECT totp_enabled FROM admin_users').totp_enabled, 0);
});

test('шифроване на тайните и сравнение с постоянно време', () => {
  const blob = C.encrypt(ctx.secret, 'тайна');
  assert.equal(C.decrypt(ctx.secret, blob), 'тайна');
  assert.throws(() => C.decrypt(Buffer.alloc(32, 1), blob));
  assert.equal(C.safeEq('a', 'a'), true);
  assert.equal(C.safeEq('a', 'ab'), false);
});

test('смяна на парола изисква текущата', async () => {
  const user = ctx.db.get('SELECT * FROM admin_users');
  assert.equal((await A.changePassword(ctx, user.id, 'грешна', 'Нова-парола-2026!')).ok, false);
  assert.equal((await A.changePassword(ctx, user.id, 'Силна-парола-2026!', 'къса')).ok, false);
  assert.equal((await A.changePassword(ctx, user.id, 'Силна-парола-2026!', 'Нова-парола-2026!')).ok, true);
  assert.equal((await A.attemptLogin(ctx, { email: user.email, password: 'Нова-парола-2026!', ip: '9.9.9.9' })).ok, true);
});
