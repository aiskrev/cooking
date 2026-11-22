// Сглобяване на HTTP приложението (без пускане на сървър) – използва се от server.mjs и от тестовете.
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { clientIp, originOk, securityHeaders, readSessionToken, UNSAFE } from './lib/http.mjs';
import { getSession, csrfOk } from './lib/auth.mjs';
import { requestLocale, translateBody } from './lib/i18n.mjs';
import { registerAuthRoutes } from './routes/auth.mjs';
import { registerPages } from './routes/pages.mjs';
import { registerApi } from './routes/api.mjs';
import { registerPublic } from './routes/public.mjs';
import { registerAccount } from './routes/account.mjs';
import { registerModeration } from './routes/mod.mjs';

export function createApp(ctx) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const p = c.req.path;
    securityHeaders(c, { admin: p.startsWith('/admin') });
    if (p.startsWith('/api/')) c.header('Cache-Control', 'no-store');
    await next();
  });

  // Съобщенията на API се превеждат според заглавката x-site-language (само bg/en); данните и сигурността не зависят от езика.
  app.use('/api/*', async (c, next) => {
    await next();
    const locale = requestLocale(c);
    if (locale === 'bg' || !(c.res.headers.get('content-type') || '').includes('application/json') || c.res.headers.get('content-disposition')) return;
    let data;
    try { data = await c.res.clone().json(); } catch { return; }
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    headers.append('Vary', 'X-Site-Language');
    c.res = new Response(JSON.stringify(translateBody(data, locale)), { status: c.res.status, headers });
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Статични файлове на администрацията (стилове, скриптове) – публични, без тайни
  app.use('/admin/assets/*', serveStatic({ root: './cms/public', rewriteRequestPath: (p) => p.replace(/^\/admin\/assets/, ''), onFound: (_p, c) => c.header('Cache-Control', 'no-cache') }));
  app.get('/admin/assets/site.css', (c) => {
    const f = path.join(ctx.config.appDir, 'src/styles/global.css');
    return c.body(fs.readFileSync(f), 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
  });

  // ---- Защита на /admin/** (освен вход) ----
  const OPEN = new Set(['/admin/login', '/admin/login/mfa', '/admin/logout']); // сами проверяват сесията и CSRF
  app.use('/admin/*', async (c, next) => {
    const p = c.req.path;
    if (p.startsWith('/admin/assets/') || OPEN.has(p)) return next();
    const isApi = p.startsWith('/admin/api/');
    const session = getSession(ctx, readSessionToken(c));
    const deny = (status, msg) => (isApi ? c.json({ error: msg }, status) : status === 401 ? c.redirect('/admin/login?next=' + encodeURIComponent(p)) : c.text(msg, status));
    if (!session) return deny(401, 'Необходим е вход.');
    if (!session.mfa_verified) return isApi ? c.json({ error: 'Необходим е вторият фактор.' }, 401) : c.redirect('/admin/login/mfa');
    if (UNSAFE.has(c.req.method)) {
      if (!originOk(ctx, c)) return deny(403, 'Заявката е от друг произход.');
      let token = c.req.header('x-csrf-token');
      if (!token && (c.req.header('content-type') || '').startsWith('application/x-www-form-urlencoded')) token = (await c.req.parseBody())._csrf;
      if (!csrfOk(session, token)) return deny(403, 'Невалиден или липсващ CSRF токен. Презаредете страницата.');
    }
    c.set('session', session);
    c.set('user', { id: session.user_id, email: session.email, display_name: session.display_name, totp_enabled: session.totp_enabled });
    c.set('ip', clientIp(c));
    return next();
  });

  registerAuthRoutes(app, ctx);
  registerPages(app, ctx);
  registerApi(app, ctx);
  registerPublic(app, ctx);
  registerAccount(app, ctx);
  registerModeration(app, ctx);

  app.notFound((c) => (c.req.path.startsWith('/api/') || c.req.path.startsWith('/admin/api/') ? c.json({ error: 'Не е намерено.' }, 404) : c.text('Не е намерено.', 404)));
  app.onError((err, c) => {
    console.error('[cms] грешка:', err?.stack || err);
    const msg = 'Възникна вътрешна грешка.'; // без подробности към клиента
    return c.req.path.startsWith('/api/') || c.req.path.startsWith('/admin/api/') ? c.json({ error: msg }, 500) : c.text(msg, 500);
  });
  return app;
}
