// Профили на посетителите през HTTP API: регистрация, потвърждаване, вход/изход, нова парола, сесии, CSRF,
// любими, „Сготвих“, оценки, коментари, жалби, модерация, роли, изтриване и износ на данни.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.mjs';

process.env.MAIL_TRANSPORT = 'memory';
process.env.SITE_URL = 'http://localhost:8080';
const { ctx, cleanup } = await makeCtx({ recipes: { 'testova-supa': {}, 'vtora-retsepta': {}, chernova: { publication: 'draft' } } });
const { createApp } = await import('../app.mjs');
const { memoryOutbox } = await import('../lib/mailer.mjs');
const app = createApp(ctx);
test.after(cleanup);
const slug = 'testova-supa';
const PW = 'дълга-тестова-парола-42';

// ---------- помощници: „браузър“ с бисквитки ----------
let ipN = 0;
function browser(ip = `198.51.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`) {
  const jar = new Map();
  let csrf = null;
  const b = {
    jar,
    get csrf() { return csrf; },
    set csrf(v) { csrf = v; },
    async req(method, path, body, extra = {}) {
      const headers = { 'x-forwarded-for': ip, ...extra };
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (csrf && method !== 'GET' && !('x-csrf-token' in extra)) headers['x-csrf-token'] = csrf;
      const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const sc of res.headers.getSetCookie()) {
        const [pair, ...attrs] = sc.split(';');
        const [k, v] = pair.split('=');
        if (attrs.some((a) => /max-age=0/i.test(a)) || v === '') jar.delete(k.trim()); else jar.set(k.trim(), v);
      }
      let data = null;
      try { data = await res.clone().json(); } catch { /* не е JSON */ }
      if (data?.csrf) csrf = data.csrf;
      return { status: res.status, data, res };
    },
  };
  return b;
}
const lastMail = (to) => [...memoryOutbox].reverse().find((m) => m.to === to);
const tokenIn = (m) => /#token=([A-Za-z0-9_-]+)/.exec(m?.text ?? '')?.[1];

async function signup(email, name = 'Тестов Готвач', { verify = true } = {}) {
  const b = browser();
  const r = await b.req('POST', '/api/account/register', { email, password: PW, displayName: name, locale: 'bg', acceptTerms: true });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  if (verify) assert.equal((await b.req('POST', '/api/account/verify', { token: tokenIn(lastMail(email)) })).status, 200);
  const l = await b.req('POST', '/api/account/login', { email, password: PW });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  b.user = l.data.user;
  return b;
}

// ================= AUTH =================
test('регистрация: 202, писмо за потвърждение, имейлът не е потвърден', async () => {
  const b = browser();
  const r = await b.req('POST', '/api/account/register', { email: 'Ana@Example.invalid', password: PW, displayName: 'Ана', locale: 'bg', acceptTerms: true });
  assert.equal(r.status, 202);
  const u = ctx.db.get("SELECT * FROM users WHERE email = 'ana@example.invalid'");
  assert.ok(u && !u.email_verified_at && u.role === 'user' && u.status === 'active');
  assert.match(u.password_hash, /^\$argon2id\$/);
  const m = lastMail('ana@example.invalid');
  assert.ok(tokenIn(m), 'писмото съдържа еднократен код');
  assert.ok(!ctx.db.get('SELECT 1 FROM user_tokens WHERE token_hash = ?', tokenIn(m)), 'в базата е само хешът на кода');
  assert.equal(r.data.user, undefined, 'регистрацията не влиза автоматично');
});

test('регистрация: невалидни данни, без съгласие, капан за ботове', async () => {
  const b = browser();
  const base = { email: 'x@example.invalid', password: PW, displayName: 'Хикс', acceptTerms: true };
  assert.equal((await b.req('POST', '/api/account/register', { ...base, email: 'не-е-имейл' })).status, 400);
  assert.equal((await b.req('POST', '/api/account/register', { ...base, password: 'кратка' })).status, 400);
  assert.equal((await b.req('POST', '/api/account/register', { ...base, displayName: 'www.spam.com' })).status, 400);
  assert.equal((await b.req('POST', '/api/account/register', { ...base, acceptTerms: false })).status, 400);
  const hp = await b.req('POST', '/api/account/register', { ...base, website: 'http://spam' });
  assert.equal(hp.status, 202);
  assert.equal(ctx.db.get("SELECT COUNT(*) n FROM users WHERE email = 'x@example.invalid'").n, 0, 'ботът „успява“, но нищо не се записва');
});

test('повторна регистрация: същият отговор (без разкриване), без втори профил, писмо до собственика', async () => {
  const b = browser();
  const first = await b.req('POST', '/api/account/register', { email: 'dup@example.invalid', password: PW, displayName: 'Първи', acceptTerms: true });
  const before = memoryOutbox.length;
  const second = await browser().req('POST', '/api/account/register', { email: 'DUP@example.invalid', password: PW + 'x', displayName: 'Втори', acceptTerms: true });
  assert.equal(second.status, first.status);
  assert.deepEqual(second.data, first.data);
  assert.equal(ctx.db.get("SELECT COUNT(*) n FROM users WHERE email = 'dup@example.invalid'").n, 1);
  assert.equal(memoryOutbox.length, before + 1);
  assert.equal(tokenIn(memoryOutbox.at(-1)), undefined, 'писмото „вече имате профил“ не съдържа код');
});

test('потвърждаване: кодът важи веднъж; грешен и изтекъл код се отхвърлят', async () => {
  const b = browser();
  await b.req('POST', '/api/account/register', { email: 'ver@example.invalid', password: PW, displayName: 'Вера', acceptTerms: true });
  const token = tokenIn(lastMail('ver@example.invalid'));
  assert.equal((await b.req('POST', '/api/account/verify', { token: 'x'.repeat(43) })).status, 400);
  assert.equal((await b.req('POST', '/api/account/verify', { token })).status, 200);
  assert.ok(ctx.db.get("SELECT email_verified_at FROM users WHERE email = 'ver@example.invalid'").email_verified_at);
  assert.equal((await b.req('POST', '/api/account/verify', { token })).status, 400, 'втори път не важи');
  // изтекъл код
  const b2 = browser();
  await b2.req('POST', '/api/account/register', { email: 'old@example.invalid', password: PW, displayName: 'Стар', acceptTerms: true });
  const t2 = tokenIn(lastMail('old@example.invalid'));
  ctx.db.run("UPDATE user_tokens SET expires_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = 'old@example.invalid')");
  assert.equal((await b2.req('POST', '/api/account/verify', { token: t2 })).status, 400);
});

test('вход: сесия с HttpOnly бисквитка и CSRF; грешна парола и непознат имейл – еднакъв отговор', async () => {
  await signup('login@example.invalid', 'Логин');
  const b = browser();
  const ok = await b.req('POST', '/api/account/login', { email: 'login@example.invalid', password: PW });
  assert.equal(ok.status, 200);
  const sc = ok.res.headers.getSetCookie().join('\n');
  assert.match(sc, /msid=[^;]+;.*HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
  assert.ok(ok.data.csrf && ok.data.user.email === 'login@example.invalid');
  assert.equal(ok.data.user.password_hash, undefined);
  assert.equal(ok.data.user.passwordHash, undefined);
  const wrong = await browser().req('POST', '/api/account/login', { email: 'login@example.invalid', password: 'грешна-парола-1234' });
  const unknown = await browser().req('POST', '/api/account/login', { email: 'nobody@example.invalid', password: 'грешна-парола-1234' });
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.data, unknown.data);
  const me = await b.req('GET', '/api/account/me');
  assert.equal(me.data.user.email, 'login@example.invalid');
});

test('вход: заключване след 5 неуспешни опита от един адрес', async () => {
  await signup('lock@example.invalid', 'Ключ');
  const b = browser('192.0.2.77');
  for (let i = 0; i < 5; i++) await b.req('POST', '/api/account/login', { email: 'lock@example.invalid', password: 'неправилна-парола-' + i });
  const r = await b.req('POST', '/api/account/login', { email: 'lock@example.invalid', password: PW });
  assert.equal(r.status, 429, 'дори вярната парола не минава по време на заключването');
});

test('изход: сесията спира да важи; без CSRF токен изходът се отказва', async () => {
  const b = await signup('out@example.invalid', 'Изход');
  const noCsrf = await b.req('POST', '/api/account/logout', undefined, { 'x-csrf-token': '' });
  assert.equal(noCsrf.status, 403);
  const token = b.jar.get('msid');
  assert.equal((await b.req('POST', '/api/account/logout')).status, 200);
  assert.equal(b.jar.has('msid'), false);
  // старата бисквитка вече не отваря сесия
  const replay = browser(); replay.jar.set('msid', token);
  assert.equal((await replay.req('GET', '/api/account/favorites')).status, 401);
});

test('нова сесия при всеки вход (без фиксиране на сесия)', async () => {
  const b = await signup('fix@example.invalid', 'Фикс');
  const first = b.jar.get('msid');
  await b.req('POST', '/api/account/login', { email: 'fix@example.invalid', password: PW });
  assert.notEqual(b.jar.get('msid'), first);
  const old = browser(); old.jar.set('msid', first);
  assert.equal((await old.req('GET', '/api/account/me')).data.user, null, 'старата сесия е унищожена');
});

test('изтекла сесия: след 14 дни без активност и след абсолютния срок – 401 и бисквитката се изчиства', async () => {
  const b = await signup('expire@example.invalid', 'Изтичане');
  ctx.db.run('UPDATE user_sessions SET last_seen_at = ? WHERE user_id = ?', Date.now() - 15 * 86400e3, b.user.id);
  const r = await b.req('GET', '/api/account/favorites');
  assert.equal(r.status, 401);
  assert.equal(b.jar.has('msid'), false, 'бисквитката е изчистена');
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM user_sessions WHERE user_id = ?', b.user.id).n, 0, 'сесията е изтрита');
  await b.req('POST', '/api/account/login', { email: 'expire@example.invalid', password: PW });
  ctx.db.run('UPDATE user_sessions SET expires_at = ? WHERE user_id = ?', Date.now() - 1, b.user.id);
  assert.equal((await b.req('GET', '/api/account/favorites')).status, 401, 'абсолютният срок');
});

test('забравена парола: еднакъв отговор за непознат имейл; нова парола прекратява всички сесии', async () => {
  const phone = await signup('reset@example.invalid', 'Ресет');
  const laptop = browser(); await laptop.req('POST', '/api/account/login', { email: 'reset@example.invalid', password: PW });
  const known = await browser().req('POST', '/api/account/forgot', { email: 'reset@example.invalid' });
  const unknown = await browser().req('POST', '/api/account/forgot', { email: 'nobody-here@example.invalid' });
  assert.equal(known.status, 202); assert.deepEqual(known.data, unknown.data);
  const token = tokenIn(lastMail('reset@example.invalid'));
  assert.ok(token);
  const r = await browser().req('POST', '/api/account/reset', { token, password: 'съвсем-нова-парола-77' });
  assert.equal(r.status, 200);
  assert.equal((await phone.req('GET', '/api/account/favorites')).status, 401, 'отворените сесии са прекратени');
  assert.equal((await laptop.req('GET', '/api/account/favorites')).status, 401);
  assert.equal((await browser().req('POST', '/api/account/login', { email: 'reset@example.invalid', password: PW })).status, 401, 'старата парола не важи');
  assert.equal((await browser().req('POST', '/api/account/login', { email: 'reset@example.invalid', password: 'съвсем-нова-парола-77' })).status, 200);
  assert.equal((await browser().req('POST', '/api/account/reset', { token, password: 'трета-нова-парола-88' })).status, 400, 'кодът е еднократен');
});

test('забравена парола: изтекъл код се отхвърля', async () => {
  await signup('exp@example.invalid', 'Изтекъл');
  await browser().req('POST', '/api/account/forgot', { email: 'exp@example.invalid' });
  const token = tokenIn(lastMail('exp@example.invalid'));
  ctx.db.run("UPDATE user_tokens SET expires_at = ? WHERE purpose = 'reset' AND user_id = (SELECT id FROM users WHERE email = 'exp@example.invalid')", Date.now() - 1);
  assert.equal((await browser().req('POST', '/api/account/reset', { token, password: 'нова-парола-изтекла-1' })).status, 400);
});

test('смяна на паролата: другите сесии се прекратяват, текущото устройство получава нова сесия', async () => {
  const a = await signup('chg@example.invalid', 'Смяна');
  const other = browser(); await other.req('POST', '/api/account/login', { email: 'chg@example.invalid', password: PW });
  assert.equal((await a.req('POST', '/api/account/password', { current: 'грешна-текуща-1234', next: 'новата-парола-123456' })).status, 400);
  const r = await a.req('POST', '/api/account/password', { current: PW, next: 'новата-парола-123456' });
  assert.equal(r.status, 200);
  assert.equal((await a.req('GET', '/api/account/favorites')).status, 200, 'текущото устройство остава влязло');
  assert.equal((await other.req('GET', '/api/account/favorites')).status, 401, 'другото – не');
});

test('писмата са изключени → регистрация и нова парола връщат 503', async () => {
  const prev = ctx.config.mail.transport;
  ctx.config.mail.transport = 'disabled';
  try {
    assert.equal((await browser().req('POST', '/api/account/register', { email: 'm@example.invalid', password: PW, displayName: 'Мейл', acceptTerms: true })).status, 503);
    assert.equal((await browser().req('POST', '/api/account/forgot', { email: 'm@example.invalid' })).status, 503);
  } finally { ctx.config.mail.transport = prev; }
});

// ================= CSRF / произход =================
test('защита: без CSRF токен, от чужд произход или без JSON – отказ', async () => {
  const b = await signup('csrf@example.invalid', 'Цсрф');
  assert.equal((await b.req('PUT', `/api/account/favorites/${slug}`, {}, { 'x-csrf-token': '' })).status, 403);
  assert.equal((await b.req('PUT', `/api/account/favorites/${slug}`, {}, { 'x-csrf-token': 'fake-token-value' })).status, 403);
  assert.equal((await b.req('PUT', `/api/account/favorites/${slug}`, {}, { origin: 'https://evil.example', host: 'localhost' })).status, 403);
  assert.equal((await b.req('PUT', `/api/account/favorites/${slug}`, {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
  const form = await app.request('/api/account/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
  assert.equal(form.status, 415, 'обикновена HTML форма от чужд сайт не стига до входа');
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM favorites').n, 0);
});

test('съобщенията се превеждат на английски по заглавката x-site-language', async () => {
  const r = await browser().req('POST', '/api/account/login', { email: 'nobody@example.invalid', password: 'грешна-парола-1234' }, { 'x-site-language': 'en' });
  assert.equal(r.data.error, 'Wrong email or password.');
});

// ================= ЛЮБИМИ =================
test('любими: добавяне, повторно добавяне (идемпотентно), премахване; чернова и непозната рецепта – 404', async () => {
  const b = await signup('fav@example.invalid', 'Любими');
  assert.equal((await b.req('PUT', `/api/account/favorites/${slug}`, {})).status, 200);
  assert.equal((await b.req('PUT', `/api/account/favorites/${slug}`, {})).status, 200);
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM favorites WHERE user_id = ?', b.user.id).n, 1, 'UNIQUE(userId, recipeId)');
  assert.throws(() => ctx.db.run('INSERT INTO favorites (user_id, recipe_slug, created_at) VALUES (?, ?, 0)', b.user.id, slug), /UNIQUE|PRIMARY/);
  assert.equal((await b.req('PUT', '/api/account/favorites/chernova', {})).status, 404);
  assert.equal((await b.req('PUT', '/api/account/favorites/nyama-takava', {})).status, 404);
  assert.equal((await b.req('DELETE', `/api/account/favorites/${slug}`)).status, 200);
  assert.equal((await b.req('GET', '/api/account/favorites')).data.favorites.length, 0);
});

test('любими: сливане от браузъра само добавя и никога не изтрива; без вход – 401', async () => {
  const b = await signup('merge@example.invalid', 'Сливане');
  await b.req('PUT', '/api/account/favorites/vtora-retsepta', {});
  const r = await b.req('POST', '/api/account/favorites/merge', { slugs: [slug, slug, 'chernova', '../etc', 42] });
  assert.equal(r.status, 200);
  assert.equal(r.data.added, 1);
  assert.deepEqual(new Set(r.data.favorites), new Set([slug, 'vtora-retsepta']));
  const empty = await b.req('POST', '/api/account/favorites/merge', { slugs: [] });
  assert.equal(empty.data.favorites.length, 2, 'празен списък от браузъра не изтрива любимите в профила');
  assert.equal((await browser().req('POST', '/api/account/favorites/merge', { slugs: [slug] })).status, 401);
});

// ================= СГОТВИХ =================
test('„Сготвих“: първо и повторно сготвяне, редакция и изтриване на собствен запис; чужд запис – 404', async () => {
  const a = await signup('cook@example.invalid', 'Готвач А');
  const b = await signup('cook2@example.invalid', 'Готвач Б');
  const first = await a.req('POST', `/api/account/recipes/${slug}/cooked`, {});
  assert.equal(first.status, 201);
  assert.deepEqual([first.data.cooked.mine, first.data.cooked.count], [1, 1]);
  const second = await a.req('POST', `/api/account/recipes/${slug}/cooked`, { servings: 6, note: 'С повече копър' });
  assert.deepEqual([second.data.cooked.mine, second.data.cooked.count], [2, 1], 'двете сготвяния са история; готвачът е един');
  assert.equal((await a.req('POST', `/api/account/recipes/${slug}/cooked`, { servings: 0 })).status, 400);
  const hist = await a.req('GET', '/api/account/cooked');
  assert.equal(hist.data.total, 2);
  assert.equal(hist.data.events[0].note, 'С повече копър');
  const id = second.data.id;
  assert.equal((await a.req('PATCH', `/api/account/cooked/${id}`, { note: 'Без копър' })).status, 200);
  assert.equal((await b.req('PATCH', `/api/account/cooked/${id}`, { note: 'чуждо' })).status, 404, 'IDOR: чужд запис');
  assert.equal((await b.req('DELETE', `/api/account/cooked/${id}`)).status, 404);
  assert.equal(ctx.db.get('SELECT note FROM cook_events WHERE id = ?', id).note, 'Без копър');
  assert.equal((await a.req('DELETE', `/api/account/cooked/${id}`)).status, 200);
  assert.equal((await a.req('GET', '/api/account/cooked')).data.total, 1);
  assert.equal((await browser().req('POST', `/api/public/recipes/${slug}/cooked`, { on: true })).status, 401, 'гост – само с вход');
});

// ================= ОЦЕНКИ =================
test('оценки: само с потвърден имейл; една на профил; промяна; средна от таблицата', async () => {
  const unverified = await signup('unv@example.invalid', 'Непотвърден', { verify: false });
  assert.equal((await unverified.req('PUT', `/api/account/recipes/vtora-retsepta/rating`, { score: 5 })).status, 403);
  const a = await signup('rate1@example.invalid', 'Оценител А');
  const b = await signup('rate2@example.invalid', 'Оценител Б');
  assert.equal((await a.req('PUT', '/api/account/recipes/vtora-retsepta/rating', { score: 7 })).status, 400);
  assert.equal((await a.req('PUT', '/api/account/recipes/vtora-retsepta/rating', { score: '4' })).status, 400);
  const r1 = await a.req('PUT', '/api/account/recipes/vtora-retsepta/rating', { score: 4 });
  assert.equal(r1.data.changed, false);
  await b.req('PUT', '/api/account/recipes/vtora-retsepta/rating', { score: 5 });
  const r2 = await a.req('PUT', '/api/account/recipes/vtora-retsepta/rating', { score: 2 });
  assert.equal(r2.data.changed, true);
  assert.deepEqual([r2.data.rating.count, r2.data.rating.average, r2.data.rating.mine], [2, 3.5, 2]);
  assert.equal(ctx.db.get("SELECT COUNT(*) n FROM ratings WHERE recipe_slug = 'vtora-retsepta'").n, 2);
  assert.throws(() => ctx.db.run("INSERT INTO ratings (recipe_slug, actor_id, user_id, score, created_at, updated_at) VALUES ('vtora-retsepta', 'друг', ?, 3, 0, 0)", a.user.id), /UNIQUE/);
  // едновременни заявки на един профил: остава един запис
  await Promise.all([1, 2, 3, 4, 5].map((s) => a.req('PUT', '/api/account/recipes/vtora-retsepta/rating', { score: s })));
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM ratings WHERE user_id = ?', a.user.id).n, 1);
  const pub = await browser().req('GET', '/api/public/recipes/vtora-retsepta/community');
  assert.equal(pub.data.rating.count, 2);
  assert.equal(pub.data.rating.mine, null);
  assert.equal((await browser().req('POST', '/api/public/recipes/vtora-retsepta/rating', { score: 5 })).status, 401, 'гост не оценява');
  assert.equal((await a.req('DELETE', '/api/account/recipes/vtora-retsepta/rating')).data.rating.count, 1);
  assert.deepEqual((await b.req('GET', '/api/account/ratings')).data.ratings.map((r) => r.score), [5]);
});

// ================= КОМЕНТАРИ И МОДЕРАЦИЯ =================
let mod, admin, author, reader;
test('подготовка: модератор и администратор (ролите се задават на сървъра)', async () => {
  author = await signup('author@example.invalid', 'Авторка');
  reader = await signup('reader@example.invalid', 'Читател');
  await signup('mod@example.invalid', 'Модератор');
  await signup('admin@example.invalid', 'Админ');
  ctx.db.run("UPDATE users SET role = 'moderator' WHERE email = 'mod@example.invalid'");
  ctx.db.run("UPDATE users SET role = 'admin' WHERE email = 'admin@example.invalid'");
  mod = browser(); await mod.req('POST', '/api/account/login', { email: 'mod@example.invalid', password: PW });
  admin = browser(); await admin.req('POST', '/api/account/login', { email: 'admin@example.invalid', password: PW });
});

let cid;
test('коментар: нов е „чака одобрение“; вижда го само авторът; без потвърден имейл – отказ', async () => {
  const unv = await signup('unv2@example.invalid', 'Без потвърждение', { verify: false });
  assert.equal((await unv.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'Чудесна рецепта!' })).status, 403);
  const r = await author.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'Сготвих я за неделя – стана чудесно.' });
  assert.equal(r.status, 201);
  assert.equal(r.data.message, 'Коментарът ви очаква одобрение.');
  cid = ctx.db.get('SELECT id FROM comments WHERE user_id = ?', author.user.id).id;
  const mine = await author.req('GET', `/api/public/recipes/${slug}/community`);
  assert.equal(mine.data.comments.length, 1);
  assert.equal(mine.data.comments[0].pending, true);
  assert.equal(mine.data.comments[0].mine, true);
  assert.equal((await browser().req('GET', `/api/public/recipes/${slug}/community`)).data.comments.length, 0, 'гостът не вижда чакащия коментар');
  assert.equal((await reader.req('GET', `/api/public/recipes/${slug}/community`)).data.comments.length, 0);
  assert.equal((await browser().req('POST', `/api/public/recipes/${slug}/comments`, { name: 'Гост', body: 'опит без профил' })).status, 401);
});

test('коментар: XSS се пази като обикновен текст; връзки не се приемат; дубликат – 409', async () => {
  const xss = '<img src=x onerror=alert(1)><script>alert(1)</script> чудесно';
  const r = await reader.req('POST', `/api/account/recipes/${slug}/comments`, { body: xss });
  assert.equal(r.status, 201);
  const row = ctx.db.get('SELECT body FROM comments WHERE user_id = ? ORDER BY id DESC', reader.user.id);
  assert.equal(row.body, xss, 'текстът не се „поправя“ – показва се само с textContent');
  const view = await reader.req('GET', `/api/public/recipes/${slug}/community`);
  assert.match(view.res.headers.get('content-type'), /application\/json/);
  assert.equal((await reader.req('POST', `/api/account/recipes/${slug}/comments`, { body: xss })).status, 409);
  assert.equal((await reader.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'вижте https://spam.example' })).status, 400);
});

test('модерация: потребител няма достъп; модераторът одобрява с история; коментарът става публичен', async () => {
  assert.equal((await reader.req('GET', '/api/mod/comments')).status, 403);
  assert.equal((await browser().req('GET', '/api/mod/comments')).status, 401);
  const q = await mod.req('GET', '/api/mod/comments?view=pending');
  assert.equal(q.status, 200);
  assert.ok(q.data.comments.some((c) => c.id === cid));
  assert.equal((await reader.req('POST', `/api/mod/comments/${cid}/action`, { action: 'approve' })).status, 403, 'обикновен потребител не модерира');
  assert.equal((await mod.req('POST', `/api/mod/comments/${cid}/action`, { action: 'approve' }, { 'x-csrf-token': '' })).status, 403, 'и модераторът – само с CSRF');
  assert.equal((await mod.req('POST', `/api/mod/comments/${cid}/action`, { action: 'approve' })).status, 200);
  const pub = await browser().req('GET', `/api/public/recipes/${slug}/community`);
  assert.equal(pub.data.comments.length, 1);
  assert.equal(pub.data.comments[0].author, 'Авторка');
  assert.equal(pub.data.comments[0].pending, false);
  const h = await mod.req('GET', `/api/mod/comments/${cid}/history`);
  assert.equal(h.data.events.at(-1).action, 'approve');
  assert.equal(h.data.events.at(-1).by, 'Модератор');
  assert.ok(ctx.db.get("SELECT 1 FROM audit_events WHERE action = 'mod.approve' AND target = ?", String(cid)));
});

test('модерация: отхвърляне и скриване изискват причина', async () => {
  const other = ctx.db.get('SELECT id FROM comments WHERE user_id = ? AND status = ?', reader.user.id, 'pending').id;
  assert.equal((await mod.req('POST', `/api/mod/comments/${other}/action`, { action: 'reject' })).status, 400);
  assert.equal((await mod.req('POST', `/api/mod/comments/${other}/action`, { action: 'reject', reason: 'Съдържа код' })).status, 200);
  assert.equal(ctx.db.get('SELECT status FROM comments WHERE id = ?', other).status, 'rejected');
  assert.equal((await mod.req('POST', `/api/mod/comments/${other}/action`, { action: 'nuke', reason: 'x' })).status, 400);
});

test('отговор: само едно ниво; редакция на чужд коментар – 404; собствена редакция връща за преглед', async () => {
  const reply = await reader.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'И при мен стана хубаво!', parentId: cid });
  assert.equal(reply.status, 201);
  const rid = ctx.db.get('SELECT id FROM comments WHERE parent_id = ?', cid).id;
  await mod.req('POST', `/api/mod/comments/${rid}/action`, { action: 'approve' });
  assert.equal((await author.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'Отговор на отговора', parentId: rid })).status, 400, 'максимум едно ниво');
  assert.equal((await reader.req('PATCH', `/api/account/comments/${cid}`, { body: 'подменен текст от друг' })).status, 404, 'IDOR');
  assert.equal((await reader.req('DELETE', `/api/account/comments/${cid}`)).status, 404, 'IDOR');
  const e = await author.req('PATCH', `/api/account/comments/${cid}`, { body: 'Сготвих я за неделя – стана чудесно, с повече чесън.' });
  assert.equal(e.status, 200);
  const row = ctx.db.get('SELECT status, edited_at FROM comments WHERE id = ?', cid);
  assert.equal(row.status, 'pending', 'редактиран одобрен коментар се преглежда отново');
  assert.ok(row.edited_at);
  await mod.req('POST', `/api/mod/comments/${cid}/action`, { action: 'approve' });
});

test('сигнал: с категория; собствен – отказ; повторен – „вече“; модераторът го вижда и може да скрие', async () => {
  assert.equal((await reader.req('POST', `/api/account/comments/${cid}/report`, { category: 'нещо' })).status, 400);
  assert.equal((await author.req('POST', `/api/account/comments/${cid}/report`, { category: 'spam' })).status, 409);
  const r = await reader.req('POST', `/api/account/comments/${cid}/report`, { category: 'personal_data', reason: 'има телефон' });
  assert.equal(r.status, 200); assert.equal(r.data.already, false);
  assert.equal((await reader.req('POST', `/api/account/comments/${cid}/report`, { category: 'spam' })).data.already, true);
  const q = await mod.req('GET', '/api/mod/comments?view=reported');
  const item = q.data.comments.find((c) => c.id === cid);
  assert.equal(item.reports[0].category, 'personal_data');
  assert.equal(q.data.counts.reported, 1);
  assert.equal((await mod.req('POST', `/api/mod/comments/${cid}/action`, { action: 'hide', reason: 'Лични данни' })).status, 200);
  assert.equal((await mod.req('GET', '/api/mod/comments?view=reported')).data.counts.reported, 0, 'скриването приключва сигналите');
  assert.equal((await browser().req('GET', `/api/public/recipes/${slug}/community`)).data.comments.length, 0);
  await mod.req('POST', `/api/mod/comments/${cid}/action`, { action: 'approve' });
});

test('коментари: ограничение на честотата (3 за 10 минути)', async () => {
  const s = await signup('spam@example.invalid', 'Бърз');
  for (let i = 0; i < 3; i++) assert.equal((await s.req('POST', `/api/account/recipes/vtora-retsepta/comments`, { body: `Коментар номер ${i} за рецептата` })).status, 201);
  assert.equal((await s.req('POST', `/api/account/recipes/vtora-retsepta/comments`, { body: 'Четвърти коментар твърде бързо' })).status, 429);
});

test('собствен коментар: оттегляне изтрива текста; модераторът не може да го възстанови', async () => {
  const mine = await author.req('GET', '/api/account/comments');
  assert.ok(mine.data.comments.some((c) => c.id === cid));
  assert.equal((await author.req('DELETE', `/api/account/comments/${cid}`)).status, 200);
  assert.deepEqual({ ...ctx.db.get('SELECT status, body FROM comments WHERE id = ?', cid) }, { status: 'deleted', body: '' });
  assert.equal((await mod.req('POST', `/api/mod/comments/${cid}/action`, { action: 'approve' })).status, 409);
});

// ================= РОЛИ =================
test('роли: модераторът няма достъп до профили и журнал; администраторът управлява роли и статус', async () => {
  assert.equal((await mod.req('GET', '/api/mod/users')).status, 403);
  assert.equal((await mod.req('GET', '/api/mod/audit')).status, 403);
  assert.equal((await reader.req('PATCH', `/api/mod/users/${reader.user.id}`, { role: 'admin' })).status, 403, 'повишаване на собствените права');
  const list = await admin.req('GET', '/api/mod/users?q=reader');
  assert.equal(list.status, 200);
  assert.equal(list.data.users[0].email, 'reader@example.invalid');
  assert.equal(list.data.users[0].password_hash, undefined);
  const adminId = (await admin.req('GET', '/api/account/me')).data.user.id;
  assert.equal((await admin.req('PATCH', `/api/mod/users/${adminId}`, { role: 'user' })).status, 409, 'не и собствената роля');
  assert.equal((await admin.req('PATCH', `/api/mod/users/${reader.user.id}`, { role: 'superuser' })).status, 400);
  assert.equal((await admin.req('PATCH', `/api/mod/users/${reader.user.id}`, { role: 'moderator', reason: 'помага' })).status, 200);
  assert.equal((await reader.req('GET', '/api/account/me')).data.user, null, 'промяната на ролята изисква нов вход');
  await reader.req('POST', '/api/account/login', { email: 'reader@example.invalid', password: PW });
  assert.equal((await reader.req('GET', '/api/mod/comments')).status, 200);
  assert.equal((await admin.req('PATCH', `/api/mod/users/${reader.user.id}`, { status: 'suspended', reason: 'тест' })).status, 200);
  assert.equal((await reader.req('GET', '/api/mod/comments')).status, 401, 'спрян профил – сесиите са прекратени');
  assert.equal((await browser().req('POST', '/api/account/login', { email: 'reader@example.invalid', password: PW })).status, 403);
  const audit = await admin.req('GET', '/api/mod/audit');
  assert.ok(audit.data.events.some((e) => e.action === 'user.status' && e.detail.to === 'suspended'));
  assert.ok(audit.data.events.every((e) => !('ip_hash' in e)));
});

// ================= ИЗТРИВАНЕ И ИЗНОС =================
test('износ на данни: само собствените, без хеш на паролата', async () => {
  const b = await signup('export@example.invalid', 'Износ');
  await b.req('PUT', `/api/account/favorites/${slug}`, {});
  await b.req('POST', `/api/account/recipes/${slug}/cooked`, { note: 'бележка' });
  const r = await b.req('GET', '/api/account/export');
  assert.equal(r.status, 200);
  assert.match(r.res.headers.get('content-disposition'), /attachment/);
  const text = await r.res.text();
  assert.ok(!text.includes('argon2'));
  const d = JSON.parse(text);
  assert.equal(d.profile.email, 'export@example.invalid');
  assert.deepEqual(d.favorites.map((f) => f.recipe), [slug]);
  assert.equal(d.cooked[0].note, 'бележка');
});

test('изтриване на профил: изисква парола; одобрените коментари се анонимизират, останалото се изтрива, сесиите спират', async () => {
  const d = await signup('del@example.invalid', 'За изтриване');
  await d.req('PUT', `/api/account/favorites/${slug}`, {});
  await d.req('PUT', `/api/account/recipes/${slug}/rating`, { score: 5 });
  await d.req('POST', `/api/account/recipes/${slug}/cooked`, {});
  await d.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'Одобрен коментар за изтриване' });
  await d.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'Чакащ коментар за изтриване' });
  const [approved, pending] = ctx.db.all('SELECT id FROM comments WHERE user_id = ? ORDER BY id', d.user.id).map((r) => r.id);
  await mod.req('POST', `/api/mod/comments/${approved}/action`, { action: 'approve' });
  const other = browser(); await other.req('POST', '/api/account/login', { email: 'del@example.invalid', password: PW });
  assert.equal((await d.req('POST', '/api/account/delete', { password: 'грешна-парола-за-изтр' })).status, 400);
  assert.equal((await d.req('POST', '/api/account/delete', { password: PW })).status, 200);
  assert.equal(ctx.db.get("SELECT COUNT(*) n FROM users WHERE email = 'del@example.invalid'").n, 0);
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM user_sessions WHERE user_id = ?', d.user.id).n, 0);
  assert.equal((await other.req('GET', '/api/account/favorites')).status, 401, 'и на другите устройства');
  for (const t of ['favorites', 'cook_events', 'user_tokens']) assert.equal(ctx.db.get(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`, d.user.id).n, 0, t);
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM ratings WHERE user_id = ?', d.user.id).n, 0);
  const a = ctx.db.get('SELECT * FROM comments WHERE id = ?', approved);
  assert.deepEqual([a.status, a.author_name, a.user_id, a.actor_id, a.ip_hash], ['approved', 'Изтрит профил', null, null, null]);
  const p = ctx.db.get('SELECT * FROM comments WHERE id = ?', pending);
  assert.deepEqual([p.status, p.body, p.user_id], ['deleted', '', null]);
  assert.equal((await browser().req('POST', '/api/account/login', { email: 'del@example.invalid', password: PW })).status, 401);
});

test('блокиране от собственика в /admin важи и за профила: без нови коментари и оценки', async () => {
  const { blockActorOf } = await import('../lib/community.mjs');
  ctx.db.run("INSERT OR IGNORE INTO admin_users (id, email, display_name, password_hash, created_at) VALUES (1, 'owner@example.invalid', 'Собственик', 'x', 0)");
  const b = await signup('blocked@example.invalid', 'Блокиран');
  await b.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'Коментар преди блокиране' });
  const id = ctx.db.get('SELECT id FROM comments WHERE user_id = ?', b.user.id).id;
  assert.equal(blockActorOf(ctx, { commentId: id, adminId: 1, reason: 'тест' }).ok, true);
  assert.equal((await b.req('POST', `/api/account/recipes/${slug}/comments`, { body: 'Коментар след блокиране' })).status, 403);
  assert.equal((await b.req('PUT', `/api/account/recipes/${slug}/rating`, { score: 1 })).status, 403);
});

test('журналът не съдържа пароли и кодове от писмата', () => {
  const dump = JSON.stringify(ctx.db.all('SELECT * FROM audit_events'));
  assert.ok(!dump.includes(PW));
  for (const m of memoryOutbox) { const t = tokenIn(m); if (t) assert.ok(!dump.includes(t)); }
});
