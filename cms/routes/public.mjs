// Публичен API за оценки, коментари и отметки „Сготвих“. Публичните страници са статични – те зареждат данните оттук с JavaScript.
// Защита на заявките, променящи състояние: същият произход (Origin), задължителен Content-Type: application/json (изисква CORS предварителна проверка
// от чужд сайт, която не разрешаваме), ограничаване на честотата и проверка на данните на сървъра.
import { bodyLimit } from 'hono/body-limit';
import { clientIp, originOk } from '../lib/http.mjs';
import { requestLocale, translateBody } from '../lib/i18n.mjs';
import {
  guestRead, guestEnsure, isPublished, ratingStats, setRating, allSummaries, listPublicComments, addComment, reportComment, verifyTurnstile, markCooked, cookedStats,
} from '../lib/community.mjs';

export function registerPublic(app, ctx) {
  // Съобщенията се превеждат според заглавката x-site-language (само bg/en); данните и сигурността не зависят от езика.
  app.use('/api/public/*', async (c, next) => {
    await next();
    const locale = requestLocale(c);
    if (locale === 'bg' || !(c.res.headers.get('content-type') || '').includes('application/json')) return;
    let data;
    try { data = await c.res.clone().json(); } catch { return; }
    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    headers.append('Vary', 'X-Site-Language');
    c.res = new Response(JSON.stringify(translateBody(data, locale)), { status: c.res.status, headers });
  });

  const small =bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'Заявката е твърде голяма.' }, 413) });

  const guardWrite = async (c) => {
    if (!originOk(ctx, c)) return c.json({ error: 'Заявката е от друг произход.' }, 403);
    if (!(c.req.header('content-type') || '').toLowerCase().startsWith('application/json')) return c.json({ error: 'Очаква се JSON.' }, 415);
    try { return { body: await c.req.json() }; } catch { return c.json({ error: 'Невалиден JSON.' }, 400); }
  };

  app.get('/api/public/summary', (c) => c.json({ summary: allSummaries(ctx) }, 200, { 'Cache-Control': 'no-cache' }));

  app.get('/api/public/recipes/:slug/community', (c) => {
    const slug = c.req.param('slug');
    if (!isPublished(ctx, slug)) return c.json({ error: 'Рецептата не е намерена.' }, 404);
    const actor = guestRead(ctx, c);
    return c.json({
      slug,
      rating: ratingStats(ctx, slug, actor),
      comments: listPublicComments(ctx, slug, actor ?? ''),
      cooked: cookedStats(ctx, slug, actor ?? ''),
      limits: { maxBody: ctx.config.comments.maxBody, maxName: ctx.config.comments.maxName, maxDepth: ctx.config.comments.maxDepth },
      turnstileSiteKey: ctx.config.turnstileSiteKey || null,
    });
  });

  app.post('/api/public/recipes/:slug/rating', small, async (c) => {
    const g = await guardWrite(c); if (g instanceof Response) return g;
    const slug = c.req.param('slug');
    const actor = guestEnsure(ctx, c);
    const r = setRating(ctx, { slug, actorId: actor, ip: clientIp(c), score: g.body?.score });
    if (!r.ok) return c.json({ error: r.error }, r.status);
    return c.json({ ok: true, changed: r.changed, rating: ratingStats(ctx, slug, actor) });
  });

  app.post('/api/public/recipes/:slug/comments', small, async (c) => {
    const g = await guardWrite(c); if (g instanceof Response) return g;
    const b = g.body ?? {};
    const ip = clientIp(c);
    if (!(await verifyTurnstile(ctx, b.turnstileToken, ip))) return c.json({ error: 'Проверката срещу автоматични съобщения не успя.' }, 400);
    const actor = guestEnsure(ctx, c);
    const r = addComment(ctx, { slug: c.req.param('slug'), name: b.name, email: b.email, body: b.body, parentId: b.parentId ?? null, actorId: actor, ip, honeypot: b.website });
    if (!r.ok) return c.json({ error: r.error }, r.status);
    return c.json({ ok: true, pending: true, message: 'Благодарим ви! Коментарът ще се покаже, след като бъде одобрен.' }, 201);
  });

  app.post('/api/public/comments/:id/report', small, async (c) => {
    const g = await guardWrite(c); if (g instanceof Response) return g;
    const r = reportComment(ctx, { id: c.req.param('id'), actorId: guestEnsure(ctx, c), ip: clientIp(c), reason: g.body?.reason });
    return r.ok ? c.json({ ok: true, already: r.already }) : c.json({ error: r.error }, r.status);
  });

  app.post('/api/public/recipes/:slug/cooked', small, async (c) => {
    const g = await guardWrite(c); if (g instanceof Response) return g;
    const slug = c.req.param('slug');
    const actor = guestEnsure(ctx, c);
    const r = markCooked(ctx, { slug, actorId: actor, ip: clientIp(c), on: g.body?.on !== false });
    return r.ok ? c.json({ ok: true, cooked: cookedStats(ctx, slug, actor) }) : c.json({ error: r.error }, r.status);
  });
}
