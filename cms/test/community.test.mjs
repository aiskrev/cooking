import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './helpers.mjs';

const { ctx, cleanup } = await makeCtx({ recipes: { 'testova-supa': {}, 'chernova': { publication: 'draft' } } });
const C = await import('../lib/community.mjs');
test.after(cleanup);
// модераторските действия сочат към администратор (външен ключ)
ctx.db.run("INSERT INTO admin_users (id, email, display_name, password_hash, created_at) VALUES (1, 'a@example.invalid', 'Тест', 'x', 0)");
const slug = 'testova-supa';
const ip = '203.0.113.5';

test('оценки: допустими 1–5, невалидните се отхвърлят', () => {
  for (const bad of [0, 6, -1, 2.5, '4', null, undefined, NaN]) assert.equal(C.setRating(ctx, { slug, actorId: 'a1', ip, score: bad }).status, 400, `score=${bad}`);
  assert.equal(C.setRating(ctx, { slug: 'няма-такава', actorId: 'a1', ip, score: 5 }).status, 404);
  assert.equal(C.setRating(ctx, { slug: 'chernova', actorId: 'a1', ip, score: 5 }).status, 404, 'чернова не се оценява');
  assert.equal(C.setRating(ctx, { slug: '../etc', actorId: 'a1', ip, score: 5 }).status, 404);
});

test('без оценки: нула, без средна стойност', () => {
  const s = C.ratingStats(ctx, slug);
  assert.deepEqual([s.count, s.average, s.mine], [0, null, null]);
  assert.deepEqual(C.allSummaries(ctx), {});
});

test('една текуща оценка на участник; промяна и преизчисляване на средната', () => {
  assert.equal(C.setRating(ctx, { slug, actorId: 'a1', ip, score: 4 }).ok, true);
  assert.equal(C.setRating(ctx, { slug, actorId: 'a2', ip, score: 5 }).changed, false);
  let s = C.ratingStats(ctx, slug, 'a1');
  assert.deepEqual([s.count, s.average, s.mine], [2, 4.5, 4]);
  const again = C.setRating(ctx, { slug, actorId: 'a1', ip, score: 2 });
  assert.equal(again.changed, true);
  s = C.ratingStats(ctx, slug, 'a1');
  assert.deepEqual([s.count, s.average, s.mine], [2, 3.5, 2], 'втори глас не се добавя – сменя се съществуващият');
  assert.equal(s.distribution[5], 1); assert.equal(s.distribution[2], 1);
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM ratings').n, 2);
  assert.throws(() => ctx.db.run('INSERT INTO ratings (recipe_slug, actor_id, score, created_at, updated_at) VALUES (?, ?, 3, 0, 0)', slug, 'a1'), /UNIQUE/);
  assert.throws(() => ctx.db.run('INSERT INTO ratings (recipe_slug, actor_id, score, created_at, updated_at) VALUES (?, ?, 9, 0, 0)', slug, 'zz'), /CHECK/);
});

test('премахната от администратор оценка не се брои и не може да се върне от госта', () => {
  const id = ctx.db.get('SELECT id FROM ratings WHERE actor_id = ?', 'a2').id;
  assert.equal(C.setRatingStatus(ctx, id, 'removed', 1), true);
  assert.equal(C.ratingStats(ctx, slug).count, 1);
  assert.equal(C.setRating(ctx, { slug, actorId: 'a2', ip, score: 5 }).status, 403);
  C.setRatingStatus(ctx, id, 'accepted', 1);
  assert.equal(C.ratingStats(ctx, slug).count, 2);
});

test('ограничаване на честотата на оценките', () => {
  let last;
  for (let i = 0; i < 40; i++) last = C.setRating(ctx, { slug, actorId: 'spam', ip: '198.51.100.1', score: 1 + (i % 5) });
  assert.equal(last.status, 429);
});

const ok = (o) => C.addComment(ctx, { slug, name: 'Мария', email: '', body: 'Много вкусна рецепта, благодаря!', parentId: null, actorId: 'c1', ip: '203.0.113.20', honeypot: '', ...o });

test('коментар: валидиране на име, текст, връзки, имейл', () => {
  assert.equal(ok({ name: 'М' }).status, 400);
  assert.equal(ok({ name: 'https://spam.example' }).status, 400);
  assert.equal(ok({ body: 'a' }).status, 400);
  assert.equal(ok({ body: 'x'.repeat(2001) }).status, 400);
  assert.equal(ok({ body: 'Вижте www.spam.bg за още' }).status, 400);
  assert.equal(ok({ body: 'Заходете в http://evil.test сега' }).status, 400);
  assert.equal(ok({ email: 'не-имейл' }).status, 400);
  assert.equal(ok({ slug: 'chernova' }).status, 404);
});

test('новият коментар е „pending“, невидим за други, видим само за автора', () => {
  const r = ok({ actorId: 'author1', ip: '203.0.113.31' });
  assert.equal(r.status, 201); assert.equal(r.pending, true);
  assert.equal(ctx.db.get('SELECT status FROM comments WHERE id = ?', r.id).status, 'pending');
  assert.equal(C.listPublicComments(ctx, slug, 'other').length, 0);
  const mine = C.listPublicComments(ctx, slug, 'author1');
  assert.equal(mine.length, 1); assert.equal(mine[0].pending, true); assert.equal(mine[0].mine, true);
  assert.equal(C.allSummaries(ctx)[slug].comments, 0, 'броят включва само одобрените');
});

test('honeypot: ботът получава „успех“, но нищо не се записва', () => {
  const before = ctx.db.get('SELECT COUNT(*) n FROM comments').n;
  const r = ok({ honeypot: 'http://bot', actorId: 'bot' });
  assert.equal(r.silent, true);
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM comments').n, before);
});

test('повторен коментар от същия участник е отхвърлен', () => {
  assert.equal(ok({ actorId: 'dup1', ip: '203.0.113.41', body: 'Уникален текст за проверка' }).status, 201);
  assert.equal(ok({ actorId: 'dup1', ip: '203.0.113.41', body: 'Уникален   текст за проверка' }).status, 409);
});

test('ограничаване: най-много 3 коментара за 10 минути', () => {
  const res = [1, 2, 3, 4].map((i) => ok({ actorId: 'rate1', ip: '203.0.113.51', body: `Различен коментар номер ${i}` }).status);
  assert.deepEqual(res, [201, 201, 201, 429]);
});

test('XSS: HTML в коментар се пази като обикновен текст (показва се с textContent)', () => {
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const r = ok({ actorId: 'xss1', ip: '203.0.113.61', body: payload });
  assert.equal(r.status, 201);
  assert.equal(ctx.db.get('SELECT body FROM comments WHERE id = ?', r.id).body, payload);
});

test('модерация: одобряване, отговор, скриване, изтриване, възстановяване, блокиране', () => {
  const r = ok({ actorId: 'mod1', ip: '203.0.113.71', body: 'Коментар за модерация' });
  assert.equal(C.moderate(ctx, { id: r.id, action: 'hide', adminId: 1 }).status, 409, 'не може да се скрие чакащ');
  assert.equal(C.moderate(ctx, { id: r.id, action: 'approve', adminId: 1 }).ok, true);
  assert.equal(C.listPublicComments(ctx, slug, 'x').some((c) => c.id === r.id), true, 'одобреният се вижда');
  const reply = C.adminReply(ctx, { parentId: r.id, body: 'Благодарим!', adminId: 1, adminName: 'Редакция' });
  assert.equal(reply.ok, true);
  const tree = C.listPublicComments(ctx, slug, 'x').find((c) => c.id === r.id);
  assert.equal(tree.replies[0].isAdmin, true);
  assert.equal(C.moderate(ctx, { id: r.id, action: 'hide', adminId: 1 }).ok, true);
  assert.equal(C.listPublicComments(ctx, slug, 'x').some((c) => c.id === r.id), false, 'скритият не се вижда (и отговорите към него – също)');
  assert.equal(C.moderate(ctx, { id: r.id, action: 'delete', adminId: 1 }).ok, true);
  assert.equal(C.moderate(ctx, { id: r.id, action: 'restore', adminId: 1 }).status, 'pending');
  assert.equal(C.blockActorOf(ctx, { commentId: r.id, adminId: 1, reason: 'тест' }).ok, true);
  assert.equal(ok({ actorId: 'mod1', ip: '203.0.113.72', body: 'Още един коментар' }).status, 403);
  assert.equal(C.setRating(ctx, { slug, actorId: 'mod1', ip, score: 5 }).status, 403);
  assert.ok(ctx.db.all('SELECT * FROM moderation_events WHERE comment_id = ?', r.id).length >= 5, 'има журнал на модерацията');
});

test('отговори: само към одобрен коментар; ограничена дълбочина', () => {
  const root = ok({ actorId: 'th1', ip: '203.0.113.81', body: 'Корен на нишката' });
  assert.equal(ok({ actorId: 'th2', ip: '203.0.113.82', body: 'Отговор към чакащ', parentId: root.id }).status, 400);
  C.moderate(ctx, { id: root.id, action: 'approve', adminId: 1 });
  let parent = root.id;
  const out = [];
  for (let d = 1; d <= 5; d++) {
    const r = ok({ actorId: 'th' + (10 + d), ip: '203.0.113.' + (90 + d), body: `Ниво ${d} на отговорите`, parentId: parent });
    out.push(r.status);
    if (r.status === 201) { C.moderate(ctx, { id: r.id, action: 'approve', adminId: 1 }); parent = r.id; }
  }
  assert.deepEqual(out, [201, 201, 201, 400, 400], 'най-много 3 нива отговори');
});

test('жалби: един участник – една жалба; решаване при скриване', () => {
  const r = ok({ actorId: 'rp1', ip: '203.0.113.101', body: 'Коментар, който ще бъде докладван' });
  C.moderate(ctx, { id: r.id, action: 'approve', adminId: 1 });
  assert.equal(C.reportComment(ctx, { id: r.id, actorId: 'viewer', ip, reason: 'спам' }).ok, true);
  assert.equal(C.reportComment(ctx, { id: r.id, actorId: 'viewer', ip, reason: 'спам' }).already, true);
  assert.equal(C.commentCounts(ctx).reported >= 1, true);
  C.moderate(ctx, { id: r.id, action: 'hide', adminId: 1 });
  assert.equal(ctx.db.get('SELECT COUNT(*) n FROM comment_reports WHERE comment_id = ? AND resolved_at IS NULL', r.id).n, 0);
  assert.equal(C.reportComment(ctx, { id: 99999, actorId: 'v', ip, reason: '' }).status, 404);
});

test('търсенето в админ списъка екранира специалните знаци на LIKE', () => {
  const r = C.listAdminComments(ctx, { q: '100%_', page: 1 });
  assert.equal(r.total, 0);
  assert.ok(C.listAdminComments(ctx, { status: 'pending', page: 1 }).total >= 1);
});

test('„Сготвих“: отметка по участник, без дублиране', () => {
  assert.equal(C.markCooked(ctx, { slug, actorId: 'k1', ip, on: true }).ok, true);
  C.markCooked(ctx, { slug, actorId: 'k1', ip, on: true });
  C.markCooked(ctx, { slug, actorId: 'k2', ip, on: true });
  assert.equal(C.cookedStats(ctx, slug, 'k1').count, 2);
  C.markCooked(ctx, { slug, actorId: 'k1', ip, on: false });
  assert.deepEqual(C.cookedStats(ctx, slug, 'k1'), { count: 1, mine: false });
});
