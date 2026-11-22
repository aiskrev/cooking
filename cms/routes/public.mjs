// Публичен API за оценки, коментари и „Сготвих“. Публичните страници са статични – те зареждат данните оттук с JavaScript.
// Четенето е за всички. От въвеждането на профилите оценки, коментари, сигнали и „Сготвих“ се записват само от влезли потребители
// (/api/account/*); заявките на гости за запис получават 401 с обяснение. Старите оценки и коментари от гости остават видими.
import { readMemberToken } from '../lib/http.mjs';
import { guestRead, isPublished, ratingStats, allSummaries } from '../lib/community.mjs';
import { getUserSession, actorOfUser } from '../lib/members.mjs';
import { listCommentsFor, recipeCookStats } from '../lib/social.mjs';

export function registerPublic(app, ctx) {
  app.get('/api/public/summary', (c) => c.json({ summary: allSummaries(ctx) }, 200, { 'Cache-Control': 'no-cache' }));

  app.get('/api/public/recipes/:slug/community', (c) => {
    const slug = c.req.param('slug');
    if (!isPublished(ctx, slug)) return c.json({ error: 'Рецептата не е намерена.' }, 404);
    const s = getUserSession(ctx, readMemberToken(c));
    // влязъл потребител вижда своята оценка и своите чакащи коментари; гост – тези от старата гост-бисквитка (ако има)
    const actor = s ? actorOfUser(s.id) : guestRead(ctx, c);
    return c.json({
      slug,
      rating: ratingStats(ctx, slug, actor),
      comments: listCommentsFor(ctx, slug, actor),
      cooked: recipeCookStats(ctx, slug, s?.id ?? null),
      me: s ? {
        signedIn: true, verified: !!s.email_verified_at, displayName: s.display_name, role: s.role,
        favorite: !!ctx.db.get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND recipe_slug = ?', s.id, slug),
      } : { signedIn: false },
      limits: { maxBody: ctx.config.comments.maxBody, maxDepth: ctx.config.comments.memberMaxDepth },
    });
  });

  const signIn = (c) => c.json({ error: 'Влезте в профила си, за да продължите.', code: 'auth' }, 401);
  app.post('/api/public/recipes/:slug/rating', signIn);
  app.post('/api/public/recipes/:slug/comments', signIn);
  app.post('/api/public/comments/:id/report', signIn);
  app.post('/api/public/recipes/:slug/cooked', signIn);
}
