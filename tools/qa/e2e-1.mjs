// Част 1 от проверките от край до край (Playwright + Chromium): достъп, вход, цикъл на рецепта със снимки, публикуване, оценки, коментари.
// Пуска се от tools/qa/run-e2e.sh. Част 2 (e2e-2.mjs) се изпълнява СЛЕД рестарт на услугата и проверява, че данните са запазени.
import fs from 'node:fs';
import { BASE, launch, newPage, login, expect, summary, makePng, EMAIL, PASSWORD, publishAndWait, log } from './lib.mjs';

const stamp = Date.now().toString(36);
const TITLE = `Тестова рецепта проверка ${stamp}`;
const UNIQUE_WORD = `тестовиум${stamp.replace(/[^a-z]/g, 'x')}`;
const state = { stamp, title: TITLE, slug: null, word: UNIQUE_WORD, expect: { rating: { count: 2, average: 3.5 }, approvedHidden: 'Много вкусна рецепта', rejected: 'Хакер', blockedActor: true } };
process.on('uncaughtException', (e) => { log(false, 'ИЗКЛЮЧЕНИЕ: ' + String(e.message).split('\n')[0]); try { fs.writeFileSync('/out/e2e/state.json', JSON.stringify(state)); } catch {} summary('Проверки от край до край – част 1 (прекъсната)'); process.exit(1); });
fs.mkdirSync('/out/e2e', { recursive: true });

const browser = await launch();
const dlg = (page, name) => page.locator('dialog[open]').getByRole('button', { name, exact: false }).first();
const toastText = (page) => page.locator('.toast').innerText().catch(() => '');
const settle = (page, ms = 400) => page.waitForTimeout(ms);

// =============== A. Достъп без вход ===============
{
  const { ctx, page } = await newPage(browser);
  const api = ctx.request;
  const r1 = await api.get(BASE + '/admin', { maxRedirects: 0 });
  expect([301, 302, 303].includes(r1.status()) && (r1.headers().location || '').includes('/admin/login'), `A1 GET /admin без вход → пренасочване към входа (${r1.status()})`);
  const protectedPages = ['/admin/recipes', '/admin/recipes/new', '/admin/recipes/kartofena-yahniya/edit', '/admin/recipes/kartofena-yahniya/preview', '/admin/media', '/admin/categories', '/admin/comments', '/admin/ratings', '/admin/publish', '/admin/settings', '/admin/media/thumb/kartofena-yahniya/01-x.webp'];
  let leaked = [];
  for (const p of protectedPages) { const r = await api.get(BASE + p, { maxRedirects: 0 }); if (r.status() === 200) leaked.push(p); }
  expect(!leaked.length, `A2 нито една защитена страница не се отваря без вход (${leaked.join(', ') || 'всички са защитени'})`);
  const calls = [
    ['GET', '/admin/api/recipes/kartofena-yahniya'], ['POST', '/admin/api/recipes'], ['PUT', '/admin/api/recipes/kartofena-yahniya'], ['POST', '/admin/api/recipes/kartofena-yahniya/state'],
    ['POST', '/admin/api/recipes/kartofena-yahniya/media'], ['DELETE', '/admin/api/recipes/kartofena-yahniya'], ['POST', '/admin/api/publish'], ['POST', '/admin/api/publish/rollback'],
    ['POST', '/admin/api/comments/1/action'], ['POST', '/admin/api/comments/1/reply'], ['POST', '/admin/api/ratings/1/status'], ['POST', '/admin/api/taxonomy/rename'],
    ['POST', '/admin/api/mfa/setup'], ['POST', '/admin/api/password'], ['POST', '/admin/api/backup'], ['GET', '/admin/api/publish/status'],
  ];
  const bad = [];
  for (const [m, p] of calls) {
    const r = await api.fetch(BASE + p, { method: m, data: {}, headers: { 'x-csrf-token': 'forged-token' }, maxRedirects: 0 });
    if (![401, 403].includes(r.status())) bad.push(`${m} ${p} → ${r.status()}`);
  }
  expect(!bad.length, `A3 всички ${calls.length} административни API заявки без сесия са отказани (${bad.join('; ') || 'ok'})`);
  const pub = await api.get(BASE + '/api/public/summary');
  expect(pub.status() === 200, 'A4 публичното API работи без вход');
  const site = await api.get(BASE + '/recepti/kartofena-yahniya/');
  expect(site.status() === 200, 'A5 публичният сайт се чете без вход');
  const fake = await ctx.addCookies([{ name: 'rsid', value: 'a'.repeat(43), url: BASE }]);
  const r6 = await api.get(BASE + '/admin', { maxRedirects: 0 });
  expect(r6.status() === 302, 'A6 фалшива/изтекла бисквитка → отново вход');
  await ctx.close();
}

// =============== B. Вход ===============
let adminCtx, admin;
{
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + '/admin/login');
  expect((await page.locator('h1').innerText()).includes('Вход'), 'B1 страница за вход');
  await page.fill('#email', EMAIL); await page.fill('#password', 'грешна-парола-1234');
  await Promise.all([page.waitForLoadState('load'), page.click('button[type=submit]')]);
  expect((await page.locator('.notice.bad').innerText()).includes('Грешен имейл или парола'), 'B2 грешна парола → общо съобщение (без да разкрива дали имейлът съществува)');
  expect(page.url().includes('/admin/login'), 'B3 остава на входа');
  await login(page);
  expect(page.url().replace(BASE, '') === '/admin', 'B4 успешен вход → табло');
  const cookies = await ctx.cookies();
  const sid = cookies.find((c) => c.name.endsWith('rsid'));
  expect(sid && sid.httpOnly && sid.sameSite === 'Strict', `B5 бисквитката е HttpOnly и SameSite=Strict (${sid?.httpOnly}/${sid?.sameSite})`);
  expect(sid && !sid.secure, 'B6 по HTTP (локално) бисквитката не е Secure; при HTTPS става Secure (потвърдено в юнит тестовете на конфигурацията)');
  const tok = await page.locator('meta[name=csrf-token]').getAttribute('content');
  const noTok = await ctx.request.post(BASE + '/admin/api/backup', { data: {} });
  const badTok = await ctx.request.post(BASE + '/admin/api/backup', { data: {}, headers: { 'x-csrf-token': 'wrong-token' } });
  const evil = await ctx.request.post(BASE + '/admin/api/backup', { data: {}, headers: { 'x-csrf-token': tok, origin: 'https://evil.example' } });
  const good = await ctx.request.post(BASE + '/admin/api/backup', { data: {}, headers: { 'x-csrf-token': tok } });
  expect(noTok.status() === 403 && badTok.status() === 403, `B7 без/с грешен CSRF токен → 403 (${noTok.status()}/${badTok.status()})`);
  expect(evil.status() === 403, `B8 чужд Origin → 403 дори с верен токен (${evil.status()})`);
  expect(good.status() === 200, `B9 верен токен → приета заявка (${good.status()})`);
  const csp = (await page.request.get(BASE + '/admin')).headers()['content-security-policy'] || '';
  expect(/script-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp), 'B10 административните страници имат строга политика за сигурност (CSP)');
  adminCtx = ctx; admin = page;
}

// =============== C. Нова рецепта през интерфейса ===============
const fill = async (loc, v) => { await loc.fill(String(v)); };
await admin.goto(BASE + '/admin/recipes/new');
await admin.waitForSelector('#basics');
await fill(admin.getByLabel('Заглавие (на български)'), TITLE);
await fill(admin.getByLabel('Кратко описание (до 240 знака)'), `Проверка на редактора: ${UNIQUE_WORD} – рецепта, създадена автоматично и изтривана след теста.`);
await fill(admin.getByLabel('Категория (вид ястие)'), 'Основни ястия');
await admin.getByLabel('Начин на готвене (техника)').fill('Печене'); await admin.keyboard.press('Enter');
await admin.getByLabel('Етикети').fill('проверка'); await admin.keyboard.press('Enter');
await fill(admin.getByLabel('Подготовка (мин)'), 15); await fill(admin.getByLabel('Готвене (мин)'), 30); await fill(admin.getByLabel('Порции'), 4);
await admin.getByLabel('Покажи бележка „чернова/чака проверка“ на страницата').uncheck();
const ingRow = (i) => admin.locator('#ingredients .ing-row').nth(i);
await ingRow(0).getByLabel('Количество').fill('200'); await ingRow(0).getByLabel('Мерна единица').fill('г'); await ingRow(0).getByLabel('Име на съставката').fill('брашно');
await admin.getByRole('button', { name: '+ Съставка' }).first().click();
await ingRow(1).getByLabel('Количество').fill('300'); await ingRow(1).getByLabel('Мерна единица').fill('мл'); await ingRow(1).getByLabel('Име на съставката').fill('вода');
await admin.getByRole('button', { name: '+ Съставка' }).first().click();
await ingRow(2).getByLabel('Име на съставката').fill('сол'); await ingRow(2).getByLabel('Забележка').fill('на вкус'); await ingRow(2).locator('input[type=checkbox]').uncheck();
const step = (i) => admin.locator('#steps .rep-item[data-step]').nth(i);
await step(0).getByLabel('Какво се прави').fill('Първа стъпка: смесете брашното с водата.');
await admin.locator('[data-add-step]').click();
await step(1).getByLabel('Какво се прави').fill('Втора стъпка: оставете тестото да почине.');
await admin.locator('[data-add-step]').click();
await step(2).getByLabel('Какво се прави').fill('Трета стъпка: изпечете.');
expect((await admin.locator('#ingredients .ing-row').count()) === 3 && (await admin.locator('#steps .rep-item[data-step]').count()) === 3, 'C1 редакторът добавя съставки и стъпки');
await admin.click('#save-btn');
await admin.waitForURL(/\/admin\/recipes\/[a-z0-9-]+\/edit/, { timeout: 15000 });
state.slug = admin.url().match(/recipes\/([a-z0-9-]+)\/edit/)[1];
expect(state.slug.startsWith('testova-retsepta'), `C2 рецептата е създадена като чернова, адресът е образуван от заглавието (${state.slug})`);
await admin.waitForSelector('#basics');
expect((await admin.locator('#pubpanel .badge').first().innerText()).includes('Чернова'), 'C3 новата рецепта е „Чернова“');

// ---- Качване на снимки ----
const png = (n) => ({ name: `снимка-${n}.png`, mimeType: 'image/png', buffer: makePng(900, 600, n) });
await admin.setInputFiles('#file-input', [png(1), png(2), png(3), { name: 'не-е-картинка.png', mimeType: 'image/png', buffer: Buffer.from('<?php echo 1; ?> това не е изображение, но е достатъчно дълго') }]);
await admin.waitForSelector('.pcard[data-file]', { timeout: 30000 });
await settle(admin, 1500);
expect((await admin.locator('.pcard[data-file]').count()) === 3, `C4 качени са 3 снимки, четвъртият файл (текст под име .png) е отхвърлен (${await admin.locator('.pcard[data-file]').count()})`);
expect((await admin.locator('.upl').innerText()).includes('отхвърлена'), 'C5 за отхвърления файл се показва причина');
const loaded = await admin.locator('.pcard img').evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0));
expect(loaded, 'C6 умалените копия се виждат');
await admin.setInputFiles('#file-input', [png(1)]);
await settle(admin, 1500);
expect((await admin.locator('.upl').innerText()).includes('вече е качена') && (await admin.locator('.pcard[data-file]').count()) === 3, 'C7 повторно качване на същата снимка се отхвърля като дубликат');
const files = await admin.locator('.pcard[data-file]').evaluateAll((n) => n.map((x) => x.dataset.file));
state.files = files;
expect(files.every((f) => /^u[a-z0-9]+-[0-9a-f]{8}\.webp$/.test(f)), 'C8 имената на файловете са безопасно генерирани');

// описания, заглавна снимка, привързване към стъпка
const card = (i) => admin.locator('.pcard[data-file]').nth(i);
for (let i = 0; i < 3; i++) await card(i).getByLabel('Описание на снимката (alt)').fill(`Тестова снимка номер ${i + 1} от автоматичната проверка`);
await card(0).getByLabel('Подпис на снимката').fill('Подпис на първата снимка');
await card(1).getByRole('radio').check();
await card(0).getByLabel('Към стъпка').selectOption('0');
await card(2).getByLabel('Във фото-историята').check();
expect((await step(0).locator('select').inputValue()) === files[0], 'C9 снимката е привързана към стъпка 1 (виждат се в двата панела)');

// подреждане на снимките: бутон ▶ и влачене
await card(0).getByRole('button', { name: 'Премести напред' }).click();
let order = await admin.locator('.pcard[data-file]').evaluateAll((n) => n.map((x) => x.dataset.file));
expect(order[1] === files[0] && order[0] === files[1], 'C10 подреждане на снимки с бутон');
await admin.locator('.pcard[data-file]').nth(2).locator('.handle').dragTo(admin.locator('.pcard[data-file]').nth(0));
await settle(admin, 300);
order = await admin.locator('.pcard[data-file]').evaluateAll((n) => n.map((x) => x.dataset.file));
expect(order[0] === files[2], `C11 подреждане на снимки с влачене (${order.map((f) => files.indexOf(f)).join(',')})`);

// подреждане на съставки: бутон ▼ и влачене
const ingItem = (i) => admin.locator('#ingredients li.rep-item:has(> .ing-row)').nth(i);
const ingNames = () => admin.locator('#ingredients .ing-row').evaluateAll((rows) => rows.map((r) => r.querySelector('input[aria-label="Име на съставката"]').value));
await ingItem(0).getByRole('button', { name: 'Премести надолу' }).click();
expect((await ingNames()).join() === 'вода,брашно,сол', `C12 съставка се премества с бутон (${(await ingNames()).join()})`);
await ingItem(2).locator('.handle').dragTo(ingItem(0));
await settle(admin, 300);
expect((await ingNames()).join() === 'сол,вода,брашно', `C13 съставка се премества с влачене (${(await ingNames()).join()})`);

// подреждане на стъпките – снимката остава при стъпката си
await step(0).getByRole('button', { name: 'Премести надолу' }).click();
const afterMove = await admin.locator('#steps .rep-item[data-step]').evaluateAll((els) => els.map((e) => ({ t: e.querySelector('textarea').value.slice(0, 6), p: e.querySelector('select').value })));
expect(afterMove[1].t === 'Първа ' && afterMove[1].p === files[0] && afterMove[0].p === '', `C14 при преместване на стъпка снимката я следва (${JSON.stringify(afterMove)})`);

// запис, презареждане, трайност
await admin.click('#save-btn');
await admin.waitForFunction(() => /Запазено/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 15000 });
await admin.reload(); await admin.waitForSelector('#basics'); await settle(admin, 800);
const persisted = {
  title: await admin.getByLabel('Заглавие (на български)').inputValue(),
  ings: (await ingNames()).join(),
  cover: await admin.locator('.pcard input[type=radio]:checked').evaluate((r) => r.closest('.pcard').dataset.file),
  order: (await admin.locator('.pcard[data-file]').evaluateAll((n) => n.map((x) => x.dataset.file))).map((f) => files.indexOf(f)).join(),
  stepPhoto: await admin.locator('#steps .rep-item[data-step]').nth(1).locator('select').inputValue(),
  alt: await admin.locator('.pcard[data-file]').first().getByLabel('Описание на снимката (alt)').inputValue(),
};
expect(persisted.title === TITLE && persisted.ings === 'сол,вода,брашно', `C15 текстът и редът на съставките се запазват след презареждане (${persisted.ings})`);
expect(persisted.cover === files[1] && persisted.stepPhoto === files[0], 'C16 заглавната снимка и снимката към стъпка се запазват');
expect(persisted.order === '2,1,0', `C17 редът на снимките се запазва (${persisted.order})`);
expect(persisted.alt.includes('Тестова снимка'), 'C18 описанията (alt) се запазват');

// ---- Преглед на чернова ----
const pv = await adminCtx.newPage();
await pv.goto(BASE + `/admin/recipes/${state.slug}/preview`);
await pv.waitForLoadState('load'); await pv.waitForTimeout(800);
expect((await pv.locator('h1').innerText()) === TITLE, 'C19 прегледът показва заглавието');
expect(await pv.locator('img').evaluateAll((i) => i.length > 0 && i.every((x) => x.complete && x.naturalWidth > 0)), 'C20 прегледът показва качените снимки');
expect((await pv.locator('.preview-bar').innerText()).includes('ПРЕГЛЕД'), 'C21 прегледът е ясно означен');
await pv.screenshot({ path: '/out/e2e/preview-draft.png', fullPage: true });
await pv.close();

// ---- Чернова не е публична ----
const anon = await browser.newContext();
const pubGet = (p) => anon.request.get(BASE + p);
expect((await pubGet(`/recepti/${state.slug}/`)).status() === 404, 'C22 чернова няма публична страница (404)');

// ---- Публикуване: блокери, после публикуване на рецептата ----
await admin.setInputFiles('#file-input', [png(7)]);
await settle(admin, 1800);
await admin.locator('[data-state=published]').click();
await settle(admin, 800);
const blockers = await admin.locator('#editor-root').innerText();
expect(/описание \(alt\)/.test(blockers), 'C23 рецепта със снимка без собствено описание не може да се публикува (блокер)');
const newCard = admin.locator('.pcard[data-file]').filter({ has: admin.locator('.badge.warn:not([hidden])') }).first();
await newCard.getByLabel('Описание на снимката (alt)').fill('Четвърта тестова снимка с вече попълнено описание');
await admin.click('#save-btn'); await settle(admin, 1200);
await admin.locator('[data-state=published]').click();
await dlg(admin, 'Отказ').click({ timeout: 8000 }).catch(() => {});
await settle(admin, 800);
expect((await admin.locator('#pubpanel .badge').first().innerText()).includes('Публикувана'), 'C24 рецептата е маркирана като публикувана');
expect((await pubGet(`/recepti/${state.slug}/`)).status() === 404, 'C25 докато сайтът не е публикуван, публичната страница още не съществува');

// ---- Публикуване на сайта ----
await admin.goto(BASE + '/admin/publish');
expect((await admin.locator('.notice.warn').innerText()).includes(TITLE), 'C26 страницата „Публикуване“ показва, че рецептата чака');
const job1 = await publishAndWait(admin);
expect(job1.status === 'succeeded', `C27 публикуването на сайта завърши успешно (${job1.status} ${job1.error ?? ''})`);
await admin.screenshot({ path: '/out/e2e/publish-done.png' });

// ---- Публично: страница, каталог, търсене, sitemap, RSS, JSON-LD ----
const rp = await pubGet(`/recepti/${state.slug}/`);
const html = await rp.text();
expect(rp.status() === 200 && html.includes(TITLE), 'C28 публикуваната рецепта е достъпна');
expect(!/aggregateRating/.test(html), 'C29 в структурираните данни няма aggregateRating (няма оценки/не са проверени)');
expect(html.includes('"@type":"Recipe"') && html.includes('recipeInstructions'), 'C30 JSON-LD на рецептата е налично');
expect((await (await pubGet('/recepti/')).text()).includes(TITLE), 'C31 рецептата е в каталога');
const sm = await (await pubGet('/sitemap-0.xml')).text();
expect(sm.includes(`/recepti/${state.slug}/`), 'C32 рецептата е в sitemap');
expect((await (await pubGet('/rss.xml')).text()).includes(TITLE), 'C33 рецептата е в RSS');
const pubPage = await adminCtx.newPage();
await pubPage.goto(BASE + `/tursene/?q=${encodeURIComponent(UNIQUE_WORD)}`);
await pubPage.waitForTimeout(2500);
const searchText = await pubPage.locator('main').innerText();
expect(searchText.includes(TITLE) || searchText.toLowerCase().includes(UNIQUE_WORD), 'C34 търсенето намира новата рецепта (индексът е обновен)');
await pubPage.close();

// =============== D. Оценки (публично, нов гост) ===============
const guest = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'bg-BG' });
const gp = await guest.newPage(); gp.problems = [];
gp.on('pageerror', (e) => gp.problems.push(e.message));
gp.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) gp.problems.push(m.text()); });
let dialogs = 0; gp.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
await gp.goto(BASE + `/recepti/${state.slug}/`);
await gp.waitForSelector('[data-community]');
await settle(gp, 800);
expect(await gp.locator('[data-rating-empty]').isVisible() && !(await gp.locator('[data-rating-summary]').isVisible()), 'D1 без оценки – празно състояние, без измислени стойности');
expect(!(await gp.locator('[data-rating-line]').isVisible()), 'D2 без оценки няма ред със звезди в заглавието');
await gp.locator('[data-score="4"]').click(); await settle(gp, 700);
expect((await gp.locator('[data-avg]').innerText()) === '4' && (await gp.locator('[data-count-text]').innerText()).includes('1 оценка'), 'D3 оценка 4 → средна 4, 1 оценка');
expect((await gp.locator('[data-score="4"]').getAttribute('aria-pressed')) === 'true', 'D4 показва се избраната от посетителя оценка');
await gp.reload(); await gp.waitForSelector('[data-community]'); await settle(gp, 800);
expect((await gp.locator('[data-avg]').innerText()) === '4' && (await gp.locator('[data-score="4"]').getAttribute('aria-pressed')) === 'true', 'D5 оценката се запазва след презареждане (сървърна база, не localStorage)');
await gp.locator('[data-score="2"]').click(); await settle(gp, 700);
expect((await gp.locator('[data-avg]').innerText()) === '2' && (await gp.locator('[data-count-text]').innerText()).includes('1 оценка'), 'D6 промяна на оценката не създава втори глас');
const guest2 = await browser.newContext(); const g2 = await guest2.newPage();
await g2.goto(BASE + `/recepti/${state.slug}/`); await g2.waitForSelector('[data-community]'); await settle(g2, 600);
await g2.locator('[data-score="5"]').click(); await settle(g2, 700);
expect((await g2.locator('[data-avg]').innerText()) === '3,5' && (await g2.locator('[data-count-text]').innerText()).includes('2 оценки'), 'D7 втори посетител: средна 3,5 от 2 оценки (преизчислява се)');
const dist = await g2.locator('[data-dist] li').allInnerTexts();
expect(dist.length === 5 && /5 ★/.test(dist[0]) && /1$/.test(dist[0].trim()), 'D8 разпределение на оценките 1–5');
const ls = await g2.evaluate(() => JSON.stringify(Object.entries(localStorage)));
expect(!/rating|score/i.test(ls), 'D9 localStorage не съдържа оценки');
for (const bad of [0, 6, 2.5, 'x', null]) {
  const r = await guest2.request.post(BASE + `/api/public/recipes/${state.slug}/rating`, { data: { score: bad } });
  if (r.status() !== 400) { expect(false, `D10 невалидна оценка ${bad} → ${r.status()}`); }
}
expect(true, 'D10 невалидни оценки (0, 6, 2.5, текст, null) се отхвърлят с 400');
const noCt = await guest2.request.post(BASE + `/api/public/recipes/${state.slug}/rating`, { headers: { 'content-type': 'text/plain' }, data: '{"score":5}' });
expect(noCt.status() === 415, `D11 заявка без application/json (CSRF чрез форма) → 415 (${noCt.status()})`);
const crossOrigin = await guest2.request.post(BASE + `/api/public/recipes/${state.slug}/rating`, { data: { score: 1 }, headers: { origin: 'https://evil.example' } });
expect(crossOrigin.status() === 403, `D12 чужд Origin → 403 (${crossOrigin.status()})`);
const missing = await guest2.request.post(BASE + `/api/public/recipes/няма-такава/rating`, { data: { score: 3 } });
expect(missing.status() === 404, 'D13 оценка за несъществуваща рецепта → 404');
await guest2.close();

// каталог: оценката се показва само когато има реални данни
const cat = await guest.newPage();
await cat.goto(BASE + '/recepti/'); await cat.waitForSelector('[data-card]'); await settle(cat, 1200);
const slot = cat.locator(`[data-card][data-slug="${state.slug}"] [data-rating-slot]`);
expect((await slot.innerText()).includes('3,5') && (await cat.locator('[data-rating-slot]:visible').count()) === 1, 'D14 карта в каталога показва оценка само за рецептата с реални оценки');
expect(await cat.locator('[data-rating-field]').isVisible(), 'D15 филтърът по оценка се показва, когато има реални оценки');
await cat.close();

// =============== E. Коментари ===============
const comment = async (page, name, body) => {
  await page.locator('[data-comment-form] [name=name]').fill(name);
  await page.locator('[data-comment-form] [name=body]').fill(body);
  await page.locator('[data-comment-form] [type=submit]').click(); await settle(page, 900);
};
await comment(gp, 'Мария', 'Много вкусна рецепта, благодаря!');
expect((await gp.locator('[data-form-status]').innerText()).includes('след като бъде одобрен'), 'E1 ясно съобщение, че коментарът чака одобрение');
expect((await gp.locator('#komentari .comment.is-pending').count()) === 1 && (await gp.locator('#komentari .comment.is-pending').innerText()).includes('Чака одобрение'), 'E2 авторът вижда коментара си със статус „чака одобрение“');
const viewer = await browser.newContext(); const vp = await viewer.newPage();
await vp.goto(BASE + `/recepti/${state.slug}/`); await vp.waitForSelector('[data-community]'); await settle(vp, 800);
expect((await vp.locator('#komentari .comment').count()) === 0 && await vp.locator('[data-comments-empty]').isVisible(), 'E3 чакащ коментар не се вижда публично');
// XSS
await comment(gp, 'Хакер', '<img src=x onerror=alert(1)> <script>alert(2)</script> &lt;b&gt;');
const xssNode = gp.locator('#komentari .comment.is-pending').filter({ hasText: 'Хакер' });
expect((await xssNode.locator('.cm-body').innerText()).includes('<img src=x onerror=alert(1)>') && (await xssNode.locator('img').count()) === 0 && dialogs === 0, 'E4 XSS: HTML се показва като текст, не се изпълнява (без диалог alert)');
// връзки, дубликат, прекалено кратко
await comment(gp, 'Спамър', 'Вижте http://evil.example сега');
expect((await gp.locator('[data-form-status]').innerText()).includes('не могат да съдържат връзки'), 'E5 коментар с връзка се отхвърля');
await comment(gp, 'Мария', 'Много вкусна рецепта, благодаря!');
expect((await gp.locator('[data-form-status]').innerText()).includes('вече е изпратен'), 'E6 повторен коментар се отхвърля');
// ограничаване на честотата: 3 за 10 минути (изпратени са 2 валидни досега)
await comment(gp, 'Мария', 'Трети различен коментар за проверка');
await comment(gp, 'Мария', 'Четвърти различен коментар за проверка');
expect((await gp.locator('[data-form-status]').innerText()).includes('твърде често'), 'E7 четвърти коментар за кратко време се ограничава (429)');
// honeypot
const hp = await guest.request.post(BASE + `/api/public/recipes/${state.slug}/comments`, { data: { name: 'Бот', body: 'Купете евтино сега', website: 'http://spam' } });
expect(hp.status() === 201, 'E8 honeypot: ботът получава „успех“ (но нищо не се записва)');

// ---- Модерация през интерфейса ----
const mod = await adminCtx.newPage(); mod.problems = [];
let pending = 0;
for (let i = 0; i < 8; i++) { await mod.goto(BASE + `/admin/comments?status=pending&slug=${state.slug}`); await settle(mod, 500); pending = await mod.locator(".comment").count(); if (pending >= 3) break; await settle(mod, 1500); }
expect(pending === 3, `E9 в администрацията чакат 3 коментара (${pending}; „Бот“ не е записан)`);
const approveBtn = mod.locator('.comment').filter({ hasText: 'Много вкусна рецепта' }).getByRole('button', { name: 'Одобри' });
await approveBtn.click(); await dlg(mod, 'Да').click({ timeout: 2000 }).catch(() => {}); await settle(mod, 1200);
await mod.goto(BASE + `/admin/comments?status=approved&slug=${state.slug}`); await settle(mod, 500);
expect((await mod.locator('.comment').count()) === 1, 'E10 администраторът одобрява коментар');
// отговор от редакцията
await mod.locator('.comment').first().getByRole('button', { name: 'Отговор' }).click();
await mod.locator('[data-reply-form] textarea').first().fill('Благодарим ви, Мария! Радваме се, че ви хареса.');
await mod.locator('[data-reply-form] button[type=submit]').first().click(); await settle(mod, 1200);
await vp.reload(); await vp.waitForSelector('[data-community]'); await settle(vp, 900);
const pubTxt = await vp.locator('#komentari').innerText();
expect(pubTxt.includes('Много вкусна рецепта') && pubTxt.includes('Радваме се, че ви хареса') && pubTxt.includes('Редакция'), 'E11 одобреният коментар и отговорът на редакцията се виждат публично');
expect(!pubTxt.includes('Хакер') && !pubTxt.includes('Спамър'), 'E12 неодобрените коментари остават невидими');
// отхвърляне и скриване
await mod.goto(BASE + `/admin/comments?status=pending&slug=${state.slug}`); await settle(mod, 500);
await mod.locator('.comment').filter({ hasText: 'Хакер' }).getByRole('button', { name: 'Отхвърли' }).click(); await settle(mod, 1200);
await mod.goto(BASE + `/admin/comments?status=rejected&slug=${state.slug}`); await settle(mod, 500);
expect((await mod.locator('.comment').count()) === 1, 'E13 администраторът отхвърля коментар');
// докладване и блокиране
await vp.locator('#komentari .comment').first().locator(':scope > .cm-actions').getByRole('button', { name: 'Докладвай' }).click(); await settle(vp, 700);
await mod.goto(BASE + `/admin/comments?status=reported`); await settle(mod, 500);
expect((await mod.locator('.comment').filter({ hasText: 'Много вкусна рецепта' }).count()) === 1, 'E14 докладван коментар се вижда в „Докладвани“');
await mod.locator('.comment').filter({ hasText: 'Много вкусна рецепта' }).getByRole('button', { name: 'Скрий' }).click(); await dlg(mod, 'Да').click({ timeout: 2000 }).catch(() => {}); await settle(mod, 1200);
await vp.reload(); await vp.waitForSelector('[data-community]'); await settle(vp, 800);
expect(!(await vp.locator('#komentari').innerText()).includes('Много вкусна рецепта'), 'E15 скритият коментар изчезва от публичната страница');
await mod.goto(BASE + `/admin/comments?status=hidden&slug=${state.slug}`); await settle(mod, 500);
await mod.locator('.comment').first().getByRole('button', { name: 'Блокирай автора' }).click(); await dlg(mod, 'Да').click(); await settle(mod, 1200);
await comment(gp, 'Мария', 'Нов коментар след блокиране на автора');
expect((await gp.locator('[data-form-status]').innerText()).includes('Не можете да коментирате'), 'E16 блокиран автор не може да коментира');
await gp.locator('[data-score="1"]').click(); await settle(gp, 600);
expect((await gp.locator('[data-rating-status]').innerText()).includes('Не можете'), 'E17 блокиран автор не може и да оценява');
await mod.goto(BASE + '/admin/ratings'); await settle(mod, 500);
expect((await mod.locator('main').innerText()).includes(TITLE), 'E18 страницата „Оценки“ показва реалните оценки');
await mod.screenshot({ path: '/out/e2e/admin-ratings.png', fullPage: true });
await mod.goto(BASE + '/admin/comments?status=all'); await mod.screenshot({ path: '/out/e2e/admin-comments.png', fullPage: true });
await gp.goto(BASE + `/recepti/${state.slug}/`); await settle(gp, 1200);
await gp.screenshot({ path: '/out/e2e/public-community.png', fullPage: true });
expect(gp.problems.length === 0, `E19 няма грешки в конзолата на публичната страница (${gp.problems.slice(0, 2).join(' | ')})`);

// запис на очакваното състояние за част 2 (след рестарт)
state.expect = { rating: { count: 2, average: 3.5 }, approvedHidden: 'Много вкусна рецепта', rejected: 'Хакер', blockedActor: true };
fs.writeFileSync('/out/e2e/state.json', JSON.stringify(state));
await browser.close();
process.exit(summary('Проверки от край до край – част 1') ? 1 : 0);
