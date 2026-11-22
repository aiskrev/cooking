// API за профилите на посетителите: /api/account/*.
// Защита: същият произход (Origin/Sec-Fetch-Site), задължителен JSON (чужд сайт не може да го изпрати без CORS проверка, която не разрешаваме),
// CSRF токен от сесията (заглавка x-csrf-token) за всяко действие на влязъл потребител, ограничаване на честотата и проверки на сървъра.
import { bodyLimit } from 'hono/body-limit';
import { clientIp, originOk, readMemberToken, setMemberCookie, clearMemberCookie, safeEq } from '../lib/http.mjs';
import { mailEnabled } from '../lib/mailer.mjs';
import {
  register, verifyEmail, resendVerification, login, createUserSession, getUserSession, destroyUserSession, destroyUserSessions, sessionCount,
  forgotPassword, resetPassword, changePassword, updateProfile, deleteAccount, exportData, publicUser,
} from '../lib/members.mjs';
import {
  listFavorites, setFavorite, mergeFavorites, addCookEvent, updateCookEvent, deleteCookEvent, listCookEvents, recipeCookStats,
  setUserRating, deleteUserRating, listUserRatings, addUserComment, editUserComment, withdrawUserComment, listUserComments, reportUserComment,
} from '../lib/social.mjs';
import { ratingStats } from '../lib/community.mjs';
import { actorOfUser } from '../lib/members.mjs';

export function registerAccount(app, ctx) {
  const small = bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'Заявката е твърде голяма.' }, 413) });
  const fail = (c, r) => c.json({ error: r.error }, r.status ?? 400);

  /** JSON тяло от същия произход */
  const readJson = async (c) => {
    if (!originOk(ctx, c)) return c.json({ error: 'Заявката е от друг произход.' }, 403);
    if (!(c.req.header('content-type') || '').toLowerCase().startsWith('application/json')) return c.json({ error: 'Очаква се JSON.' }, 415);
    try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return c.json({ error: 'Невалиден JSON.' }, 400); }
  };

  /** Влязъл потребител; при промяна – и CSRF токен. Връща сесията или готов отговор за грешка. */
  const member = async (c, { write = false, verified = false } = {}) => {
    const s = getUserSession(ctx, readMemberToken(c));
    if (!s) { clearMemberCookie(ctx, c); return c.json({ error: 'Необходим е вход.', code: 'auth' }, 401); }
    if (write) {
      if (!originOk(ctx, c)) return c.json({ error: 'Заявката е от друг произход.' }, 403);
      const tok = c.req.header('x-csrf-token');
      if (!tok || !safeEq(s.csrf_token, tok)) return c.json({ error: 'Невалиден или липсващ CSRF токен. Презаредете страницата.', code: 'csrf' }, 403);
    }
    if (verified && !s.email_verified_at) return c.json({ error: 'Потвърдете имейла си, за да продължите.', code: 'verify' }, 403);
    return s;
  };
  const writeJson = async (c, opts = {}) => {
    const s = await member(c, { ...opts, write: true });
    if (s instanceof Response) return [s];
    if (c.req.method === 'DELETE' && !(c.req.header('content-type') || '')) return [null, s, {}];
    const b = await readJson(c);
    return b instanceof Response ? [b] : [null, s, b];
  };
  const me = (s) => ({ user: publicUser(s), csrf: s.csrf_token });

  // ---------- Сесия ----------
  app.get('/api/account/me', (c) => {
    const s = getUserSession(ctx, readMemberToken(c));
    if (!s) { if (readMemberToken(c) || c.req.header('cookie')?.includes('mstate=')) clearMemberCookie(ctx, c); return c.json({ user: null, mail: mailEnabled(ctx) }); }
    return c.json({ ...me(s), mail: mailEnabled(ctx), sessions: sessionCount(ctx, s.id) });
  });

  app.post('/api/account/register', small, async (c) => {
    const b = await readJson(c); if (b instanceof Response) return b;
    if (b.website) return c.json({ ok: true, message: 'Проверете пощата си: изпратихме писмо с указания.' }, 202); // капан за ботове
    const r = await register(ctx, { email: b.email, password: b.password, displayName: b.displayName, locale: b.locale, acceptTerms: b.acceptTerms, ip: clientIp(c) });
    if (!r.ok) return fail(c, r);
    return c.json({ ok: true, message: 'Проверете пощата си: изпратихме писмо с указания.' }, 202);
  });

  app.post('/api/account/verify', small, async (c) => {
    const b = await readJson(c); if (b instanceof Response) return b;
    const r = verifyEmail(ctx, b.token);
    return r.ok ? c.json({ ok: true, message: 'Имейлът е потвърден.' }) : fail(c, r);
  });

  app.post('/api/account/verify/resend', small, async (c) => {
    const [e, s] = await writeJson(c); if (e) return e;
    const r = resendVerification(ctx, s);
    return r.ok ? c.json({ ok: true, already: !!r.already, message: r.already ? 'Имейлът вече е потвърден.' : 'Изпратихме ново писмо за потвърждение.' }) : fail(c, r);
  });

  app.post('/api/account/login', small, async (c) => {
    const b = await readJson(c); if (b instanceof Response) return b;
    const ip = clientIp(c);
    const r = await login(ctx, { email: b.email, password: b.password, ip });
    if (!r.ok) return fail(c, r);
    destroyUserSession(ctx, readMemberToken(c)); // нова сесия при всеки вход (без фиксиране на сесия)
    const token = createUserSession(ctx, r.user, { ip, ua: c.req.header('user-agent') });
    setMemberCookie(ctx, c, token);
    return c.json(me(getUserSession(ctx, token)));
  });

  app.post('/api/account/logout', async (c) => {
    const token = readMemberToken(c);
    const s = getUserSession(ctx, token);
    // изходът изисква CSRF токен, за да не може чужд сайт да изведе потребителя
    if (s) {
      if (!originOk(ctx, c) || !safeEq(s.csrf_token, c.req.header('x-csrf-token') || '')) return c.json({ error: 'Невалиден или липсващ CSRF токен. Презаредете страницата.' }, 403);
      destroyUserSession(ctx, token);
    }
    clearMemberCookie(ctx, c);
    return c.json({ ok: true });
  });

  app.post('/api/account/forgot', small, async (c) => {
    const b = await readJson(c); if (b instanceof Response) return b;
    const r = forgotPassword(ctx, { email: b.email, ip: clientIp(c) });
    return r.ok ? c.json({ ok: true, message: 'Ако има профил с този адрес, ще получите писмо с връзка за нова парола.' }, 202) : fail(c, r);
  });

  app.post('/api/account/reset', small, async (c) => {
    const b = await readJson(c); if (b instanceof Response) return b;
    const r = await resetPassword(ctx, { token: b.token, password: b.password, ip: clientIp(c) });
    if (!r.ok) return fail(c, r);
    clearMemberCookie(ctx, c);
    return c.json({ ok: true, message: 'Паролата е сменена. Влезте с новата парола.' });
  });

  // ---------- Настройки ----------
  app.patch('/api/account/profile', small, async (c) => {
    const [e, s, b] = await writeJson(c); if (e) return e;
    const r = updateProfile(ctx, s, { displayName: b.displayName, locale: b.locale });
    return r.ok ? c.json({ ok: true, user: publicUser(ctx.db.get('SELECT * FROM users WHERE id = ?', s.id)) }) : fail(c, r);
  });

  app.post('/api/account/password', small, async (c) => {
    const [e, s, b] = await writeJson(c); if (e) return e;
    const r = await changePassword(ctx, s, { current: b.current, next: b.next });
    if (!r.ok) return fail(c, r);
    // всички сесии са прекратени; текущото устройство получава нова сесия
    const token = createUserSession(ctx, r.user, { ip: clientIp(c), ua: c.req.header('user-agent') });
    setMemberCookie(ctx, c, token);
    return c.json({ ok: true, message: 'Паролата е сменена. Излязохте от другите устройства.', ...me(getUserSession(ctx, token)) });
  });

  app.post('/api/account/sessions/revoke-others', small, async (c) => {
    const [e, s] = await writeJson(c); if (e) return e;
    destroyUserSessions(ctx, s.id, s.sid);
    return c.json({ ok: true, message: 'Излязохте от другите устройства.' });
  });

  app.post('/api/account/delete', small, async (c) => {
    const [e, s, b] = await writeJson(c); if (e) return e;
    const r = await deleteAccount(ctx, s, { password: b.password, ip: clientIp(c) });
    if (!r.ok) return fail(c, r);
    clearMemberCookie(ctx, c);
    return c.json({ ok: true, message: 'Профилът е изтрит.' });
  });

  app.get('/api/account/export', async (c) => {
    const s = await member(c); if (s instanceof Response) return s;
    return c.body(JSON.stringify(exportData(ctx, s), null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="moite-danni.json"',
    });
  });

  // ---------- Любими ----------
  app.get('/api/account/favorites', async (c) => {
    const s = await member(c); if (s instanceof Response) return s;
    return c.json({ favorites: listFavorites(ctx, s.id) });
  });
  app.put('/api/account/favorites/:slug', small, async (c) => {
    const [e, s] = await writeJson(c); if (e) return e;
    const r = setFavorite(ctx, s.id, c.req.param('slug'), true);
    return r.ok ? c.json(r) : fail(c, r);
  });
  app.delete('/api/account/favorites/:slug', async (c) => {
    const [e, s] = await writeJson(c); if (e) return e;
    const r = setFavorite(ctx, s.id, c.req.param('slug'), false);
    return r.ok ? c.json(r) : fail(c, r);
  });
  app.post('/api/account/favorites/merge', small, async (c) => {
    const [e, s, b] = await writeJson(c); if (e) return e;
    const r = mergeFavorites(ctx, s.id, b.slugs);
    return r.ok ? c.json(r) : fail(c, r);
  });

  // ---------- Сготвих ----------
  app.get('/api/account/cooked', async (c) => {
    const s = await member(c); if (s instanceof Response) return s;
    return c.json(listCookEvents(ctx, s.id, { page: c.req.query('page') }));
  });
  app.post('/api/account/recipes/:slug/cooked', small, async (c) => {
    const [e, s, b] = await writeJson(c); if (e) return e;
    const slug = c.req.param('slug');
    const r = addCookEvent(ctx, s.id, slug, b);
    return r.ok ? c.json({ ok: true, id: r.id, cooked: recipeCookStats(ctx, slug, s.id) }, 201) : fail(c, r);
  });
  app.patch('/api/account/cooked/:id', small, async (c) => {
    const [e, s, b] = await writeJson(c); if (e) return e;
    const r = updateCookEvent(ctx, s.id, c.req.param('id'), b);
    return r.ok ? c.json(r) : fail(c, r);
  });
  app.delete('/api/account/cooked/:id', async (c) => {
    const [e, s] = await writeJson(c); if (e) return e;
    const r = deleteCookEvent(ctx, s.id, c.req.param('id'));
    return r.ok ? c.json(r) : fail(c, r);
  });

  // ---------- Оценки ----------
  app.get('/api/account/ratings', async (c) => {
    const s = await member(c); if (s instanceof Response) return s;
    return c.json({ ratings: listUserRatings(ctx, s.id) });
  });
  app.put('/api/account/recipes/:slug/rating', small, async (c) => {
    const [e, s, b] = await writeJson(c, { verified: true }); if (e) return e;
    const slug = c.req.param('slug');
    const r = setUserRating(ctx, s, slug, b.score);
    return r.ok ? c.json({ ok: true, changed: r.changed, rating: ratingStats(ctx, slug, actorOfUser(s.id)) }) : fail(c, r);
  });
  app.delete('/api/account/recipes/:slug/rating', async (c) => {
    const [e, s] = await writeJson(c); if (e) return e;
    const slug = c.req.param('slug');
    const r = deleteUserRating(ctx, s.id, slug);
    return r.ok ? c.json({ ok: true, rating: ratingStats(ctx, slug, actorOfUser(s.id)) }) : fail(c, r);
  });

  // ---------- Коментари ----------
  app.get('/api/account/comments', async (c) => {
    const s = await member(c); if (s instanceof Response) return s;
    return c.json(listUserComments(ctx, s.id, { page: c.req.query('page') }));
  });
  app.post('/api/account/recipes/:slug/comments', small, async (c) => {
    const [e, s, b] = await writeJson(c, { verified: true }); if (e) return e;
    const r = addUserComment(ctx, { user: s, slug: c.req.param('slug'), body: b.body, parentId: b.parentId ?? null, ip: clientIp(c), honeypot: b.website });
    return r.ok ? c.json({ ok: true, pending: true, message: 'Коментарът ви очаква одобрение.' }, 201) : fail(c, r);
  });
  app.patch('/api/account/comments/:id', small, async (c) => {
    const [e, s, b] = await writeJson(c, { verified: true }); if (e) return e;
    const r = editUserComment(ctx, { userId: s.id, id: c.req.param('id'), body: b.body });
    return r.ok ? c.json({ ok: true, pending: true, message: 'Коментарът ви очаква одобрение.' }) : fail(c, r);
  });
  app.delete('/api/account/comments/:id', async (c) => {
    const [e, s] = await writeJson(c); if (e) return e;
    const r = withdrawUserComment(ctx, { userId: s.id, id: c.req.param('id') });
    return r.ok ? c.json({ ok: true, message: 'Коментарът е изтрит.' }) : fail(c, r);
  });
  app.post('/api/account/comments/:id/report', small, async (c) => {
    const [e, s, b] = await writeJson(c); if (e) return e;
    const r = reportUserComment(ctx, { user: s, id: c.req.param('id'), category: b.category, reason: b.reason });
    return r.ok ? c.json({ ok: true, already: r.already, message: r.already ? 'Вече сте докладвали този коментар.' : 'Благодарим – ще го прегледаме.' }) : fail(c, r);
  });
}
