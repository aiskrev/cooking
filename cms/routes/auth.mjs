// Вход и изход: парола (Argon2id), по желание втори фактор (TOTP / код за възстановяване), нова сесия след успешен вход.
import { esc } from '../lib/util.mjs';
import { loginLayout } from '../views/ui.mjs';
import { clientIp, originOk, readSessionToken, setSessionCookie, clearSessionCookie, getCookie, setCookie, isHttps, safeEq } from '../lib/http.mjs';
import { randomToken } from '../lib/crypto.mjs';
import { attemptLogin, createSession, getSession, destroySession, csrfOk, checkSecondFactor, lockedUntil, recordFailure, clearFailures } from '../lib/auth.mjs';

const safeNext = (n) => (typeof n === 'string' && n.startsWith('/admin') && !n.startsWith('//') && !/[\r\n\\]/.test(n) ? n : '/admin');

function loginForm({ csrf, next, error, email = '' }) {
  return loginLayout({
    title: 'Вход',
    body: `<h1>Вход в администрацията</h1>
${error ? `<div class="notice bad" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login" autocomplete="on">
  <input type="hidden" name="_csrf" value="${esc(csrf)}">
  <input type="hidden" name="next" value="${esc(next)}">
  <div class="field"><label for="email">Имейл</label><input id="email" name="email" type="email" required autocomplete="username" value="${esc(email)}" autofocus></div>
  <div class="field"><label for="password">Парола</label><input id="password" name="password" type="password" required autocomplete="current-password"></div>
  <button class="btn" type="submit" style="width:100%">Вход</button>
</form>
<p class="muted small">Достъпът е само за собственика на сайта. Първият администратор се създава с командата <code>cms:cli create-owner</code> – вижте docs/LOCAL_RUNBOOK.md.</p>`,
  });
}

export function registerAuthRoutes(app, ctx) {
  const issueLoginCsrf = (c) => {
    const t = randomToken(24);
    setCookie(c, 'rlc', t, { httpOnly: true, sameSite: 'Strict', secure: isHttps(ctx, c), path: '/admin', maxAge: 3600 });
    return t;
  };

  app.get('/admin/login', (c) => {
    if (getSession(ctx, readSessionToken(c))?.mfa_verified) return c.redirect('/admin');
    return c.html(loginForm({ csrf: issueLoginCsrf(c), next: safeNext(c.req.query('next')) }));
  });

  app.post('/admin/login', async (c) => {
    const ip = clientIp(c);
    const form = await c.req.parseBody();
    const next = safeNext(form.next);
    const again = (status, error, email) => c.html(loginForm({ csrf: issueLoginCsrf(c), next, error, email }), status);
    if (!originOk(ctx, c)) return again(403, 'Заявката е от друг произход.');
    const cookieToken = getCookie(c, 'rlc');
    if (!cookieToken || !safeEq(cookieToken, String(form._csrf || ''))) return again(403, 'Формата е изтекла. Опитайте отново.');
    const r = await attemptLogin(ctx, { email: form.email, password: form.password, ip });
    if (r.locked) {
      const min = Math.max(1, Math.ceil((r.until - Date.now()) / 60000));
      return again(429, `Твърде много неуспешни опити. Опитайте отново след ${min} мин.`);
    }
    if (!r.ok) return again(401, 'Грешен имейл или парола.', String(form.email || ''));
    // нова сесия след вход (ротация); старата, ако има, се унищожава
    destroySession(ctx, readSessionToken(c));
    const user = r.user;
    if (user.totp_enabled) {
      setSessionCookie(ctx, c, createSession(ctx, user, { ip, ua: c.req.header('user-agent'), mfaVerified: false }));
      return c.redirect('/admin/login/mfa?next=' + encodeURIComponent(next));
    }
    setSessionCookie(ctx, c, createSession(ctx, user, { ip, ua: c.req.header('user-agent') }));
    ctx.audit(user.email, 'login.ok', null, null, ip);
    return c.redirect(next);
  });

  const mfaForm = (csrf, error, next) => loginLayout({
    title: 'Втори фактор',
    body: `<h1>Потвърдете вход</h1>
${error ? `<div class="notice bad" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login/mfa" autocomplete="off">
  <input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="next" value="${esc(next)}">
  <div class="field"><label for="code">Код от приложението или код за възстановяване</label><input id="code" name="code" type="text" inputmode="text" autocomplete="one-time-code" required autofocus></div>
  <button class="btn" type="submit" style="width:100%">Потвърди</button>
</form>
<form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn ghost small" type="submit">Отказ</button></form>`,
  });

  app.get('/admin/login/mfa', (c) => {
    const s = getSession(ctx, readSessionToken(c));
    if (!s) return c.redirect('/admin/login');
    if (s.mfa_verified) return c.redirect('/admin');
    return c.html(mfaForm(s.csrf_token, '', safeNext(c.req.query('next'))));
  });

  app.post('/admin/login/mfa', async (c) => {
    const ip = clientIp(c);
    const token = readSessionToken(c);
    const s = getSession(ctx, token);
    if (!s) return c.redirect('/admin/login');
    if (s.mfa_verified) return c.redirect('/admin');
    const form = await c.req.parseBody();
    const next = safeNext(form.next);
    if (!originOk(ctx, c) || !csrfOk(s, form._csrf)) return c.html(mfaForm(s.csrf_token, 'Заявката е невалидна. Опитайте отново.', next), 403);
    const keys = ['mfa:' + s.user_id, 'ip:' + ctx.ipHash(ip)];
    const lock = lockedUntil(ctx, keys);
    if (lock) return c.html(mfaForm(s.csrf_token, `Твърде много опити. Опитайте след ${Math.ceil((lock - Date.now()) / 60000)} мин.`, next), 429);
    if (!checkSecondFactor(ctx, s.user_id, form.code)) {
      keys.forEach((k) => recordFailure(ctx, k));
      ctx.audit(s.email, 'login.mfa_failed', null, null, ip);
      return c.html(mfaForm(s.csrf_token, 'Кодът не е верен.', next), 401);
    }
    clearFailures(ctx, keys[0]);
    destroySession(ctx, token); // нова пълна сесия (ротация)
    const user = ctx.db.get('SELECT * FROM admin_users WHERE id = ?', s.user_id);
    setSessionCookie(ctx, c, createSession(ctx, user, { ip, ua: c.req.header('user-agent') }));
    ctx.audit(user.email, 'login.ok', null, { mfa: true }, ip);
    return c.redirect(next);
  });

  app.post('/admin/logout', async (c) => {
    const token = readSessionToken(c);
    const s = getSession(ctx, token);
    const form = await c.req.parseBody();
    if (s && originOk(ctx, c) && csrfOk(s, form._csrf)) {
      destroySession(ctx, token);
      ctx.audit(s.email, 'logout', null, null, clientIp(c));
    }
    clearSessionCookie(ctx, c);
    return c.redirect('/admin/login');
  });
}
