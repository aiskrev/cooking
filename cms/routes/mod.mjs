// Модерация от модератори и администратори на сайта: /api/mod/*.
// Ролята се проверява на сървъра при всяка заявка (интерфейсът само скрива бутоните). Действията се записват в moderation_events и audit_events.
import { bodyLimit } from 'hono/body-limit';
import { originOk, readMemberToken, safeEq } from '../lib/http.mjs';
import { getUserSession, listUsers, setUserRoleStatus } from '../lib/members.mjs';
import { canModerate, isAdmin, modQueue, modAct, modHistory, modAudit } from '../lib/social.mjs';

export function registerModeration(app, ctx) {
  const small = bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'Заявката е твърде голяма.' }, 413) });

  const staff = async (c, { admin = false } = {}) => {
    const s = getUserSession(ctx, readMemberToken(c));
    if (!s) return c.json({ error: 'Необходим е вход.', code: 'auth' }, 401);
    if (!(admin ? isAdmin(s) : canModerate(s))) return c.json({ error: 'Нямате права за това действие.' }, 403);
    if (c.req.method !== 'GET') {
      if (!originOk(ctx, c)) return c.json({ error: 'Заявката е от друг произход.' }, 403);
      if (!safeEq(s.csrf_token, c.req.header('x-csrf-token') || '')) return c.json({ error: 'Невалиден или липсващ CSRF токен. Презаредете страницата.' }, 403);
      if (!(c.req.header('content-type') || '').toLowerCase().startsWith('application/json')) return c.json({ error: 'Очаква се JSON.' }, 415);
      try { c.set('body', (await c.req.json()) ?? {}); } catch { return c.json({ error: 'Невалиден JSON.' }, 400); }
    }
    return s;
  };

  app.get('/api/mod/comments', async (c) => {
    const s = await staff(c); if (s instanceof Response) return s;
    const view = ['pending', 'reported', 'hidden', 'all'].includes(c.req.query('view')) ? c.req.query('view') : 'pending';
    return c.json({ view, ...modQueue(ctx, { view, page: c.req.query('page') }) });
  });

  app.get('/api/mod/comments/:id/history', async (c) => {
    const s = await staff(c); if (s instanceof Response) return s;
    return c.json({ events: modHistory(ctx, c.req.param('id')) });
  });

  app.post('/api/mod/comments/:id/action', small, async (c) => {
    const s = await staff(c); if (s instanceof Response) return s;
    const b = c.get('body');
    const r = modAct(ctx, s, { id: c.req.param('id'), action: b.action, reason: b.reason });
    return r.ok ? c.json({ ok: true, status: r.status }) : c.json({ error: r.error }, r.status ?? 400);
  });

  // ---------- Само администратор ----------
  app.get('/api/mod/users', async (c) => {
    const s = await staff(c, { admin: true }); if (s instanceof Response) return s;
    return c.json(listUsers(ctx, { q: c.req.query('q') || '', page: parseInt(c.req.query('page'), 10) || 1 }));
  });

  app.patch('/api/mod/users/:id', small, async (c) => {
    const s = await staff(c, { admin: true }); if (s instanceof Response) return s;
    const b = c.get('body');
    const r = setUserRoleStatus(ctx, s, c.req.param('id'), { role: b.role, status: b.status, reason: b.reason });
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, r.status ?? 400);
  });

  app.get('/api/mod/audit', async (c) => {
    const s = await staff(c, { admin: true }); if (s instanceof Response) return s;
    return c.json(modAudit(ctx, { page: c.req.query('page') }));
  });
}
