// Функционален одит (локално): сценариите от матрицата AUTH/FAV/COOK/COM/SEC/UX с доказателства (снимки в /out/audit).
// Създава собствени тестови профили (случайни пароли, само в паметта на теста) и накрая ги изтрива. Не пипа продукция.
//   docker compose --profile qa run --rm -T qa-local node e2e-audit.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { BASE, launch, newPage, expect, summary, log, waitMail, tokenIn, newMember } from './lib.mjs';

const OUT = '/out/audit';
fs.mkdirSync(OUT, { recursive: true });
const SLUG = 'kartofena-yahniya';
const RECIPE = `/bg/recepti/${SLUG}/`;
const stamp = Date.now().toString(36);
const pw = () => crypto.randomBytes(18).toString('base64url');
const settle = (p, ms = 600) => p.waitForTimeout(ms);
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(() => {});
const rec = [];
const check = (id, ok, msg) => { rec.push({ id, ok: !!ok, msg }); expect(ok, `${id} ${msg}`); };
process.on('uncaughtException', (e) => { log(false, 'ИЗКЛЮЧЕНИЕ: ' + String(e.message).split('\n')[0]); fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rec, null, 2)); summary('Одит (прекъснат)'); process.exit(1); });

const browser = await launch();
const csrfOf = async (ctx) => (await (await ctx.request.get(BASE + '/api/account/me')).json()).csrf;
const created = [];

// ================= AUTH =================
const A = { email: `audit-a-${stamp}@example.invalid`, name: `Одит А ${stamp}`, password: pw() };
const { ctx, page } = await newPage(browser);
await page.goto(BASE + '/bg/registratsia/'); await settle(page, 300);
// валидация в браузъра и на сървъра
await page.fill('#a-name', A.name); await page.fill('#a-email', 'не-е-имейл'); await page.fill('#a-pw', A.password);
await page.locator('input[name=acceptTerms]').check();
await page.locator('[data-form] [type=submit]').click(); await settle(page, 300);
check('AUTH-01a', await page.locator('[data-error]').isVisible() && (await page.locator('#a-email').getAttribute('aria-invalid')) === 'true', 'невалиден имейл → грешка до полето (aria-invalid)');
await page.fill('#a-email', A.email); await page.fill('#a-pw', 'кратка');
await page.locator('[data-form] [type=submit]').click(); await settle(page, 300);
check('AUTH-01b', await page.locator('[data-error]').isVisible(), 'кратка парола (<12) → грешка');
await page.fill('#a-pw', A.password);
const since = Date.now() - 1000;
await page.locator('[data-form] [type=submit]').click(); await settle(page, 1200);
check('AUTH-01', (await page.locator('[data-status]').innerText()).includes('Проверете пощата'), 'регистрация през формата → „Проверете пощата си“');
await shot(page, 'AUTH-01-register');
created.push(A);
const token = tokenIn(await waitMail(A.email, since));
check('AUTH-01d', !!token, 'писмото за потвърждение е изпратено (локална пощенска кутия)');
// повторна регистрация – същият отговор; собственикът на адреса получава писмо „вече имате профил“ (без код)
const since1 = Date.now() - 1;
const dup = await (await browser.newContext()).request.post(BASE + '/api/account/register', { data: { email: A.email, password: pw(), displayName: 'Друг', acceptTerms: true } });
check('AUTH-01c', dup.status() === 202 && (await dup.json()).message.includes('Проверете пощата'), 'повторна регистрация със зает имейл → същият отговор 202 (без разкриване)');
const existsMail = await waitMail(A.email, since1);
check('AUTH-01f', !!existsMail && !tokenIn(existsMail) && existsMail.includes('вече имате профил'), 'при повторна регистрация собственикът на адреса получава писмо „вече имате профил“');
await page.goto(BASE + `/bg/potvarzhdenie/#token=${token}`); await settle(page, 1200);
check('AUTH-01e', (await page.locator('[data-status]').innerText()).includes('потвърден'), 'връзката от писмото потвърждава имейла');

// вход: грешна парола, несъществуващ профил, правилни данни, redirect
await page.goto(BASE + `/bg/vhod/?next=${encodeURIComponent(RECIPE)}`);
await page.fill('#a-email', A.email); await page.fill('#a-pw', 'грешна-парола-12345');
await page.locator('[data-form] [type=submit]').click(); await settle(page, 900);
const errWrong = await page.locator('[data-error]').innerText();
await page.fill('#a-email', `nyama-${stamp}@example.invalid`);
await page.locator('[data-form] [type=submit]').click(); await settle(page, 900);
const errUnknown = await page.locator('[data-error]').innerText();
check('AUTH-03', errWrong.includes('Грешен имейл или парола') && errWrong === errUnknown, 'грешна парола и несъществуващ профил → едно и също съобщение');
await shot(page, 'AUTH-03-wrong-password');
await page.fill('#a-email', A.email); await page.fill('#a-pw', A.password);
await Promise.all([page.waitForURL((u) => u.pathname === RECIPE, { timeout: 10000 }), page.locator('[data-form] [type=submit]').click()]);
await settle(page, 1200);
check('AUTH-02', await page.locator('.account-btn').isVisible(), 'вход → бутон на профила в заглавката, връщане към рецептата (?next=)');
await page.reload(); await settle(page, 1200);
check('AUTH-05', await page.locator('.account-btn').isVisible(), 'след презареждане сесията остава');
const ck = (await ctx.cookies()).find((c) => /msid$/.test(c.name));
check('SEC-cookie', ck?.httpOnly && ck.sameSite === 'Lax' && !(await page.evaluate(() => document.cookie)).includes('msid'), 'сесийната бисквитка е HttpOnly (недостъпна за JavaScript), SameSite=Lax');

// ================= FAV =================
const fav = page.locator('[data-fav-toggle]').first();
check('FAV-00', (await fav.getAttribute('aria-pressed')) === 'false', 'рецептата не е любима в началото');
await fav.click(); await settle(page, 900);
check('FAV-01', (await fav.getAttribute('aria-pressed')) === 'true' && (await fav.innerText()).includes('В любими'), 'добавяне от страницата на рецептата → „♥ В любими“');
await page.reload(); await settle(page, 1200);
check('FAV-03', (await page.locator('[data-fav-toggle]').first().getAttribute('aria-pressed')) === 'true', 'след презареждане остава любима');
await shot(page, 'FAV-01-recipe');
// бързи последователни кликове: крайното състояние съвпада със сървъра
const f2 = page.locator('[data-fav-toggle]').first();
await f2.click(); await f2.click(); await f2.click(); await settle(page, 1500);
const uiState = (await f2.getAttribute('aria-pressed')) === 'true';
const srvFav = (await (await ctx.request.get(BASE + '/api/account/favorites')).json()).favorites.map((f) => f.slug);
check('FAV-06', uiState === srvFav.includes(SLUG), `три бързи клика → интерфейсът и сървърът съвпадат (${uiState ? 'любима' : 'не е любима'})`);
if (!srvFav.includes(SLUG)) { await f2.click(); await settle(page, 900); }
const csrfA = await csrfOf(ctx);
for (let i = 0; i < 3; i++) await ctx.request.put(BASE + `/api/account/favorites/${SLUG}`, { headers: { 'x-csrf-token': csrfA } });
const favList = (await (await ctx.request.get(BASE + '/api/account/favorites')).json()).favorites;
check('FAV-05', favList.filter((f) => f.slug === SLUG).length === 1, 'повторно добавяне (3 заявки) → един запис');
await page.goto(BASE + '/bg/profil/#lyubimi'); await settle(page, 1200);
check('FAV-07', (await page.locator('#lyubimi .plist li').filter({ hasText: 'Картофена яхния' }).count()) === 1, 'профил → „Любими“ показва рецептата');
await shot(page, 'FAV-07-profile');
await page.goto(BASE + '/bg/lyubimi/'); await settle(page, 1200);
check('FAV-08', (await page.locator('[data-fav-item]:visible').count()) === 1 && (await page.locator('[data-fav-lead]').innerText()).includes('профила'), 'страницата „Любими“ показва любимите от профила');

// ================= COOK (и независимост от любими) =================
await page.goto(BASE + RECIPE); await settle(page, 1200);
await page.locator('[data-cooked-toggle]').first().click(); await settle(page, 1000);
check('COOK-01', (await page.locator('[data-actions-status]').innerText()).includes('Записахме'), '„Сготвих тази рецепта“ → потвърждение');
await page.reload(); await settle(page, 1200);
check('COOK-01b', (await page.locator('[data-cooked-count]').innerText()).includes('Сготвихте я 1 път') && (await page.locator('[data-cooked-toggle]').first().innerText()).includes('отново'), 'след презареждане: „Сготвихте я 1 път“, бутонът става „Сготвих я отново“');
check('COOK-04', (await page.locator('[data-fav-toggle]').first().getAttribute('aria-pressed')) === 'true', 'рецептата е едновременно любима и сготвена');
await page.locator('[data-fav-toggle]').first().click(); await settle(page, 900);
await page.reload(); await settle(page, 1200);
check('COOK-04b', (await page.locator('[data-fav-toggle]').first().getAttribute('aria-pressed')) === 'false' && (await page.locator('[data-cooked-count]').innerText()).includes('1 път'), 'премахване от любими не засяга „Сготвих“');
await shot(page, 'COOK-04-independent');
await page.goto(BASE + '/bg/profil/#sgotveni'); await settle(page, 1200);
const cookItem = page.locator('#sgotveni .cook-item').first();
check('COOK-02', (await cookItem.innerText()).includes('Картофена яхния') && (await cookItem.locator('time').count()) === 1, 'профил → „Сготвени“: рецептата с дата');
await cookItem.locator('textarea').fill('Повече червен пипер');
await cookItem.getByRole('button', { name: 'Запази бележката' }).click(); await settle(page, 800);
await page.reload(); await settle(page, 1200);
check('COOK-05', (await page.locator('#sgotveni .cook-item textarea').first().inputValue()) === 'Повече червен пипер', 'бележка към сготвяне се запазва');
await shot(page, 'COOK-02-profile');

// ================= изход / повторен вход =================
await page.locator('.account-btn').click(); await settle(page, 200);
await Promise.all([page.waitForURL(/\/bg\/$/, { timeout: 10000 }), page.locator('#account-menu').getByRole('button', { name: 'Изход' }).click()]);
await settle(page, 800);
check('AUTH-04', await page.locator('[data-account-link]').isVisible() && !(await ctx.cookies()).some((c) => /msid$/.test(c.name)), 'изход → „Вход“, бисквитката е изтрита');
check('AUTH-04b', (await ctx.request.get(BASE + '/api/account/favorites')).status() === 401, 'след изход защитените данни връщат 401');
await page.goto(BASE + '/bg/profil/'); await settle(page, 1000);
check('AUTH-07', await page.locator('[data-signed-out]').isVisible(), 'профилът без вход → „Не сте влезли“ + бутони за вход/регистрация');
await page.goto(BASE + '/bg/vhod/');
await page.fill('#a-email', A.email); await page.fill('#a-pw', A.password);
await Promise.all([page.waitForURL(/profil/, { timeout: 10000 }), page.locator('[data-form] [type=submit]').click()]);
await page.goto(BASE + '/bg/profil/#sgotveni'); await settle(page, 1200);
check('COOK-03', (await page.locator('#sgotveni .cook-item').count()) === 1, 'повторен вход → историята „Сготвени“ е запазена');

// ================= изолация между потребители =================
const B = { email: `audit-b-${stamp}@example.invalid`, name: `Одит Б ${stamp}`, password: pw() };
const mb = await newMember(browser, B); created.push(B);
const bFav = (await (await mb.ctx.request.get(BASE + '/api/account/favorites')).json()).favorites;
const bCook = (await (await mb.ctx.request.get(BASE + '/api/account/cooked')).json()).total;
check('FAV-04', mb.ok && bFav.length === 0 && bCook === 0, 'втори потребител: собствени (празни) любими и история');
const aEvents = (await (await ctx.request.get(BASE + '/api/account/cooked')).json()).events;
const csrfB = await csrfOf(mb.ctx);
const idor1 = await mb.ctx.request.patch(BASE + `/api/account/cooked/${aEvents[0].id}`, { data: { note: 'чуждо' }, headers: { 'x-csrf-token': csrfB } });
const idor2 = await mb.ctx.request.delete(BASE + `/api/account/cooked/${aEvents[0].id}`, { headers: { 'x-csrf-token': csrfB } });
check('SEC-02', idor1.status() === 404 && idor2.status() === 404, `потребител Б не може да промени/изтрие запис на А (${idor1.status()}/${idor2.status()})`);

// ================= COM =================
await page.goto(BASE + RECIPE); await settle(page, 1200);
await page.locator('[data-comment-form] [type=submit]').click(); await settle(page, 800);
check('COM-03', (await page.locator('[data-form-status]').innerText()).includes('твърде кратък'), 'празен коментар → „Коментарът е твърде кратък.“');
const body = `Одитен коментар ${stamp}: стана много вкусно.`;
await page.locator('[data-comment-form] textarea').fill(body);
await page.locator('[data-comment-form] [type=submit]').click(); await settle(page, 1200);
check('COM-01', (await page.locator('[data-form-status]').innerText()).includes('очаква одобрение'), 'коментарът е записан и чака одобрение');
await page.reload(); await settle(page, 1200);
const mine = page.locator('#komentari .comment').filter({ hasText: body });
check('COM-02', (await mine.count()) === 1 && (await mine.innerText()).includes(A.name) && (await mine.locator('time').count()) === 1, 'след презареждане: коментарът е там, с автора и датата (вижда го само авторът)');
await shot(page, 'COM-02-pending');
const xss = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
await page.locator('[data-comment-form] textarea').fill(xss + ' одит');
await page.locator('[data-comment-form] [type=submit]').click(); await settle(page, 1200);
const xssNode = page.locator('#komentari .comment').filter({ hasText: 'onerror' });
check('COM-05', (await xssNode.count()) === 1 && (await xssNode.locator('img, script').count()) === 0 && !(await page.evaluate(() => window.__xss)), 'XSS: HTML се показва като текст, не се изпълнява');
const cid = (await (await ctx.request.get(BASE + '/api/account/comments')).json()).comments.find((c) => c.body === body).id;
const ed = await mb.ctx.request.patch(BASE + `/api/account/comments/${cid}`, { data: { body: 'подмяна от Б' }, headers: { 'x-csrf-token': csrfB } });
const dl = await mb.ctx.request.delete(BASE + `/api/account/comments/${cid}`, { headers: { 'x-csrf-token': csrfB } });
check('COM-04', ed.status() === 404 && dl.status() === 404, `потребител Б не може да редактира/изтрие коментара на А (${ed.status()}/${dl.status()})`);
const guestCtx = await browser.newContext();
await guestCtx.addInitScript(() => { try { localStorage.setItem('cookie-notice-v1', 'ok'); } catch { /* */ } });
const g = await guestCtx.newPage();
await g.goto(BASE + RECIPE); await settle(g, 1200);
check('COM-07', !(await g.locator('#komentari').innerText()).includes(body) && await g.locator('[data-comment-gate]').isVisible(), 'гост: не вижда чакащия коментар; вижда покана „Влезте или създайте профил“');
const gw = await guestCtx.request.post(BASE + `/api/public/recipes/${SLUG}/comments`, { data: { name: 'Гост', body: 'опит' } });
const gw2 = await guestCtx.request.post(BASE + `/api/account/recipes/${SLUG}/comments`, { data: { body: 'опит' } });
check('SEC-01', gw.status() === 401 && gw2.status() === 401 && (await guestCtx.request.get(BASE + '/api/mod/comments')).status() === 401, 'директни заявки без вход → 401');
await shot(g, 'COM-07-guest');
// редакция от автора (през профила) и изтриване от автора (през рецептата)
page.on('dialog', (d) => d.accept());
const mineNow = page.locator('#komentari .comment').filter({ hasText: body });
await mineNow.getByRole('button', { name: 'Редактирай' }).click();
await mineNow.locator('form textarea').fill(body + ' (редакция)');
await mineNow.locator('form').getByRole('button', { name: 'Запази' }).click(); await settle(page, 1200);
check('COM-08', (await page.locator('#komentari .comment').filter({ hasText: '(редакция)' }).innerText()).includes('редактиран'), 'авторът редактира своя коментар (отбелязан като „редактиран“)');
const toDelete = page.locator('#komentari .comment').filter({ hasText: 'onerror' });
await toDelete.getByRole('button', { name: 'Изтрий' }).click(); await settle(page, 1200);
check('COM-06', (await page.locator('#komentari .comment').filter({ hasText: 'onerror' }).count()) === 0, 'авторът изтрива свой коментар');

// ================= UX: размери и клавиатура =================
for (const [w, h] of [[375, 812], [390, 844], [768, 1024], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const p of [RECIPE, '/bg/profil/', '/bg/vhod/', '/bg/moderatsia/']) {
    await page.goto(BASE + p); await settle(page, 700);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('UX-01', ov <= 1, `${w}px ${p}: без хоризонтално преливане (${ov})`);
  }
  if (w === 375) {
    await page.goto(BASE + RECIPE); await settle(page, 900);
    await shot(page, 'UX-01-375-recipe');
    const btn = page.locator('.account-btn');
    const box = await btn.boundingBox();
    check('UX-03', box && box.width >= 44 && box.height >= 44, `375px: бутонът на профила е поне 44×44 (${box ? Math.round(box.width) + '×' + Math.round(box.height) : '—'})`);
  }
}
await page.setViewportSize({ width: 1440, height: 900 });

// ================= заглавка: един ред на компютър (BUG-01) =================
// Гост и влязъл (с име от 40 знака), BG и EN: инструментите (профил, език, тема) са на реда на менюто;
// от 1280 px нагоре и името на сайта е на един ред (както в продукцията преди профилите).
async function headerRow(p, label) {
  return p.evaluate(() => {
    const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top);
    const bt = document.querySelector('.brand-text');
    const lh = parseFloat(getComputedStyle(bt).lineHeight) || 20;
    return { tools: top('.header-tools'), nav: top('.main-nav'), brandLines: Math.round(bt.getBoundingClientRect().height / lh), ov: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
}
async function headerChecks(p, who) {
  for (const w of [1024, 1280, 1440]) {
    await p.setViewportSize({ width: w, height: 900 });
    for (const path of [RECIPE, '/en/recipes/kartofena-yahniya/']) {
      await p.goto(BASE + path); await settle(p, 700);
      const h = await headerRow(p);
      const okRow = Math.abs(h.tools - h.nav) <= 6;
      const okBrand = w < 1280 || h.brandLines === 1;
      check('UX-04', okRow && okBrand && h.ov <= 1, `${who} ${w}px ${path.slice(0, 3)}: заглавката на един ред (инструменти ${h.tools}/меню ${h.nav}; име на сайта – ${h.brandLines} ред(а))`);
      if (w === 1440 && path === RECIPE) await shot(p, `UX-04-header-${who}-1440`);
    }
  }
  await p.setViewportSize({ width: 1440, height: 900 });
}
{
  const g2 = await newPage(browser);
  await headerChecks(g2.page, 'гост');
  await g2.page.goto(BASE + RECIPE); await settle(g2.page, 500);
  const gl = g2.page.locator('[data-account-link]');
  check('UX-05', (await gl.getAttribute('title')) === 'Вход' && (await gl.innerText()).includes('Вход'), 'бутонът „Вход“ има достъпно име и подсказка');
  await g2.ctx.close();
}
await page.goto(BASE + '/bg/profil/#nastroyki'); await settle(page, 1200);
const longName = ('Дълго Име ' + stamp + ' Тестова Проверка Заглавка').slice(0, 40);
await page.fill('#s-name', longName); await page.locator('[data-profile-form] [type=submit]').click(); await settle(page, 900);
await headerChecks(page, 'влязъл');
await page.goto(BASE + RECIPE); await settle(page, 900);
await page.locator('.account-btn').click(); await settle(page, 200);
check('UX-06', (await page.locator('#account-menu .account-menu-name').innerText()) === longName && (await page.locator('.account-btn').getAttribute('title')) === longName, 'името на влезлия е в подсказката и най-горе в менюто');
await shot(page, 'UX-06-menu-open');
await page.keyboard.press('Escape');

// ================= профил: смяна на името =================
const newName = `Одит Ново ${stamp}`;
await page.goto(BASE + '/bg/profil/#nastroyki'); await settle(page, 1200);
await page.fill('#s-name', newName);
await page.locator('[data-profile-form] [type=submit]').click(); await settle(page, 1000);
check('PROF-01', (await page.locator('[data-profile-form] [data-out]').innerText()).includes('Запазено') && (await page.locator('.account-btn').innerText()).includes(newName), 'ново име в настройките → „Запазено.“ и в заглавката');
await page.reload(); await settle(page, 1200);
check('PROF-02', (await page.locator('[data-hello]').innerText()).includes(newName), 'след презареждане профилът показва новото име');
await page.fill('#s-name', 'x'); await page.locator('[data-profile-form] [type=submit]').click(); await settle(page, 800);
check('PROF-03', (await page.locator('[data-profile-form] [data-out]').innerText()).includes('между 2 и 40'), 'твърде кратко име → грешка');
await shot(page, 'PROF-01-settings');

// ================= печат и „Сподели“ =================
await page.goto(BASE + RECIPE); await settle(page, 1000);
await page.emulateMedia({ media: 'print' });
const printVis = await page.evaluate(() => ({ community: getComputedStyle(document.querySelector('.community')).display, account: getComputedStyle(document.querySelector('.account')).display, ingredients: !!document.querySelector('[data-ing]')?.offsetParent }));
check('PRINT-01', printVis.community === 'none' && printVis.account === 'none' && printVis.ingredients, `печат: без оценки/коментари и меню на профила, съставките остават (${JSON.stringify(printVis)})`);
await page.emulateMedia({ media: 'screen' });
const shareCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
await shareCtx.addInitScript(() => { try { localStorage.setItem('cookie-notice-v1', 'ok'); } catch { /* */ } });
const sp = await shareCtx.newPage();
await sp.goto(BASE + RECIPE); await settle(sp, 800);
await sp.evaluate(() => { delete Navigator.prototype.share; }); // браузър без Web Share API → резервното копиране на връзката
await sp.locator('[data-share]').click(); await settle(sp, 500);
const clip = await sp.evaluate(() => navigator.clipboard.readText());
check('SHARE-01', (await sp.locator('[data-actions-status]').innerText()).includes('Връзката е копирана') && clip.endsWith(RECIPE), `„Сподели“ без Web Share API → копира адреса (${clip})`);
await shareCtx.close();

// ================= нова парола (през интерфейса) =================
const since2 = Date.now() - 1000;
const anon = await newPage(browser);
await anon.page.goto(BASE + '/bg/zabravena-parola/');
await anon.page.fill('#a-email', A.email);
await anon.page.locator('[data-form] [type=submit]').click(); await settle(anon.page, 1200);
check('AUTH-06a', (await anon.page.locator('[data-status]').innerText()).includes('Ако има профил'), 'забравена парола → неутрално съобщение');
const rtoken = tokenIn(await waitMail(A.email, since2));
const newPw = pw();
await anon.page.goto(BASE + `/bg/nova-parola/#token=${rtoken}`);
await anon.page.fill('#a-pw', newPw);
await anon.page.locator('[data-form] [type=submit]').click(); await settle(anon.page, 1500);
check('AUTH-06', (await anon.page.locator('[data-status]').innerText()).includes('Паролата е сменена'), 'нова парола от връзката в писмото');
check('AUTH-06b', (await ctx.request.get(BASE + '/api/account/favorites')).status() === 401, 'старата сесия е прекратена след новата парола');
const relog = await (await browser.newContext()).request.post(BASE + '/api/account/login', { data: { email: A.email, password: newPw } });
check('AUTH-06c', relog.ok(), 'вход с новата парола');
A.password = newPw;
await anon.ctx.close();

// ================= известие за бисквитките (GDPR) =================
for (const [lang, ok, title] of [['bg', 'Разбрах', 'Бисквитки и лични данни'], ['en', 'Got it', 'Cookies and personal data']]) {
  const cn = await newPage(browser, { cookieNotice: true, viewport: { width: 360, height: 780 } });
  await cn.page.goto(`${BASE}/${lang}/`); await settle(cn.page, 700);
  const box = cn.page.locator('[data-cookie-notice]');
  check('GDPR-01', await box.isVisible() && (await box.locator('h2').innerText()) === title, `${lang}: известието се показва при първо посещение („${title}“)`);
  const link = box.locator('a');
  check('GDPR-02', (await link.getAttribute('href')).endsWith('#biskvitki'), `${lang}: връзка към раздела за бисквитките`);
  const ov = await cn.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('GDPR-03', ov <= 1, `${lang} 360px: без хоризонтално преливане с известието (${ov})`);
  await shot(cn.page, `GDPR-notice-${lang}-360`);
  await box.getByRole('button', { name: ok }).click(); await settle(cn.page, 300);
  await cn.page.reload(); await settle(cn.page, 700);
  check('GDPR-04', !(await box.isVisible()), `${lang}: след „${ok}“ и презареждане известието не се показва`);
  const cookies = await cn.ctx.cookies();
  check('GDPR-05', cookies.length === 0, `${lang}: гост без вход – нито една бисквитка (${cookies.map((c) => c.name).join(', ') || 'няма'})`);
  await cn.page.goto(`${BASE}${lang === 'bg' ? '/bg/poveritelnost/' : '/en/privacy/'}#biskvitki`); await settle(cn.page, 500);
  const sec = await cn.page.evaluate(() => ({ cookies: !!document.getElementById('biskvitki'), gdpr: !!document.getElementById('gdpr'), rows: document.querySelectorAll('.data-table tbody tr').length, ov: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check('GDPR-06', sec.cookies && sec.gdpr && sec.rows === 3 && sec.ov <= 1, `${lang}: „Поверителност“ – раздели за бисквитките и GDPR, таблица с 3 бисквитки (${JSON.stringify(sec)})`);
  await cn.ctx.close();
}

// ================= почистване =================
for (const u of created) {
  const c = await browser.newContext();
  await c.request.post(BASE + '/api/account/login', { data: { email: u.email, password: u.password } });
  const del = await c.request.post(BASE + '/api/account/delete', { data: { password: u.password }, headers: { 'x-csrf-token': await csrfOf(c) } });
  check('CLEANUP', del.ok(), `тестовият профил ${u.email.split('@')[0]} е изтрит`);
  await c.close();
}
check('CONSOLE', page.problems.length === 0, `без грешки в конзолата (${page.problems.slice(0, 3).join(' | ')})`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rec, null, 2));
await browser.close();
process.exit(summary('Функционален одит (локално)') ? 1 : 0);
