// Профили на посетителите – критичният път от край до край (Playwright + Chromium) и достъпност (axe) на новите страници.
//   гост на рецепта → любима в браузъра → регистрация → потвърждаване от писмото → вход → любимата е слята в профила
//   → „Сготвих“ → оценка → коментар (чака одобрение) → модератор одобрява → коментарът се вижда публично.
// Пуска се на две стъпки (между тях скриптът run-accounts-e2e.sh дава роля „модератор“ през cms/cli.mjs set-role):
//   node e2e-accounts.mjs a   – гост, регистрация, вход, сливане, „Сготвих“, оценка, коментар, проверки без права
//   node e2e-accounts.mjs b   – модераторът одобрява; публичен изглед; профил; достъпност; почистване (изтриване на тестовите профили)
// Изисква локалния режим на писмата (MAIL_TRANSPORT=outbox) и тома cms-data, монтиран в /cmsdata (виж docker-compose.yml, qa-local).
import fs from 'node:fs';
import crypto from 'node:crypto';
import axe from 'axe-core';
import { BASE, launch, newPage, expect, summary, log, waitMail, tokenIn, newMember } from './lib.mjs';

const phase = process.argv[2] || 'a';
const STATE = '/out/e2e-accounts/state.json';
fs.mkdirSync('/out/e2e-accounts', { recursive: true });
const SLUG = 'banitsa-sas-sirene';
const RECIPE = `/bg/recepti/${SLUG}/`;
const settle = (p, ms = 500) => p.waitForTimeout(ms);
process.on('uncaughtException', (e) => { log(false, 'ИЗКЛЮЧЕНИЕ: ' + String(e.message).split('\n')[0]); summary(`Профили – стъпка ${phase} (прекъсната)`); process.exit(1); });

async function axeCheck(page, label) {
  await page.addScriptTag({ content: axe.source });
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })).violations.map((v) => `${v.id}(${v.nodes.length})`));
  expect(r.length === 0, `${label}: axe без нарушения ${r.join(', ')}`);
}

const browser = await launch();

if (phase === 'a') {
  const stamp = Date.now().toString(36);
  const state = {
    author: { email: `autor-${stamp}@example.invalid`, name: `Готвачка ${stamp}`, password: crypto.randomBytes(18).toString('base64url') },
    mod: { email: `mod-${stamp}@example.invalid`, name: `Модератор ${stamp}`, password: crypto.randomBytes(18).toString('base64url') },
    comment: `Сготвих баницата в неделя – стана хрупкава. Проверка ${stamp}`,
  };

  // ---- 1. Гост: любима в браузъра; оценки и коментари изискват вход ----
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + RECIPE); await page.waitForSelector('[data-community]'); await settle(page, 900);
  expect(await page.locator('[data-account-link]').isVisible(), 'A1 гост: в заглавката има „Вход“');
  expect(!(await page.locator('[data-star-input]').isVisible()) && await page.locator('[data-rate-gate]').isVisible(), 'A2 гост: вместо звезди – покана за вход');
  expect(!(await page.locator('[data-comment-form]').isVisible()) && await page.locator('[data-comment-gate]').isVisible(), 'A3 гост: вместо форма – покана за вход/регистрация');
  const guestRequests = [];
  page.on('request', (r) => { if (r.url().includes('/api/account/')) guestRequests.push(r.url()); });
  await page.locator('[data-fav-toggle]').first().click();
  expect((await page.locator('[data-fav-toggle]').first().getAttribute('aria-pressed')) === 'true', 'A4 гост: „Запази в любими“ работи (aria-pressed)');
  expect((await page.evaluate(() => localStorage.getItem('favorites'))).includes(SLUG), 'A5 гост: любимата е в localStorage');
  await page.locator('[data-cooked-toggle]').first().click(); await settle(page, 300);
  expect((await page.locator('[data-actions-status]').innerText()).includes('Влезте'), 'A6 гост: „Сготвих“ кани за вход');
  const guestApi = await ctx.request.post(BASE + `/api/public/recipes/${SLUG}/rating`, { data: { score: 5 } });
  expect(guestApi.status() === 401, `A7 гост: запис на оценка през API → 401 (${guestApi.status()})`);
  expect(guestRequests.length === 0, `A8 гост: никакви заявки към /api/account/ (${guestRequests.length})`);
  await page.goto(BASE + '/bg/lyubimi/'); await settle(page, 400);
  expect((await page.locator('[data-fav-item]:visible').count()) === 1, 'A9 гост: страницата „Любими“ показва любимата от браузъра');

  // ---- 2. Регистрация през формата ----
  await page.goto(BASE + '/bg/registratsia/'); await settle(page, 300);
  await axeCheck(page, 'A10 /bg/registratsia/');
  const since = Date.now() - 1000;
  await page.fill('#a-name', state.author.name);
  await page.fill('#a-email', state.author.email);
  await page.fill('#a-pw', state.author.password);
  await page.locator('input[name=acceptTerms]').check();
  await page.locator('[data-form] [type=submit]').click(); await settle(page, 1200);
  expect((await page.locator('[data-status]').innerText()).includes('Проверете пощата'), 'A11 регистрация: съобщение „Проверете пощата си“ (без разкриване дали имейлът е зает)');

  // ---- 3. Потвърждаване от писмото ----
  const mail = await waitMail(state.author.email, since);
  const token = tokenIn(mail);
  expect(!!token && mail.includes('/bg/potvarzhdenie/#token='), 'A12 писмото съдържа еднократна връзка (кодът е след „#“)');
  await page.goto(BASE + `/bg/potvarzhdenie/#token=${token}`); await settle(page, 1200);
  expect((await page.locator('[data-status]').innerText()).includes('потвърден'), 'A13 имейлът е потвърден');
  expect(!page.url().includes('token='), 'A14 кодът е изчистен от адресната лента');

  // ---- 4. Вход с връщане към рецептата; любимата от браузъра е слята ----
  await page.goto(BASE + `/bg/vhod/?next=${encodeURIComponent(RECIPE)}`); await settle(page, 300);
  await axeCheck(page, 'A15 /bg/vhod/');
  await page.fill('#a-email', state.author.email);
  await page.fill('#a-pw', 'грешна-парола-за-проверка');
  await page.locator('[data-form] [type=submit]').click(); await settle(page, 900);
  expect((await page.locator('[data-error]').innerText()).includes('Грешен имейл или парола'), 'A16 грешна парола: общо съобщение');
  await page.fill('#a-pw', state.author.password);
  await Promise.all([page.waitForURL((u) => u.pathname === RECIPE, { timeout: 10000 }), page.locator('[data-form] [type=submit]').click()]);
  await page.waitForSelector('[data-community]'); await settle(page, 1200);
  expect(page.url().endsWith(RECIPE), 'A17 след вход – обратно на рецептата (?next=)');
  expect((await page.locator('[data-fav-toggle]').first().getAttribute('aria-pressed')) === 'true', 'A18 любимата от браузъра е в профила (сливане)');
  const favs = await ctx.request.get(BASE + '/api/account/favorites');
  expect((await favs.json()).favorites.some((f) => f.slug === SLUG), 'A19 сървърът пази любимата (UNIQUE userId+recipe)');
  const cookies = await ctx.cookies();
  const sid = cookies.find((c) => c.name === 'msid' || c.name === '__Host-msid');
  expect(sid?.httpOnly && sid?.sameSite === 'Lax', 'A20 сесията е HttpOnly, SameSite=Lax');

  // ---- 5. Меню на профила: клавиатура ----
  const accBtn = page.locator('.account-btn');
  await accBtn.focus(); await page.keyboard.press('Enter'); await settle(page, 200);
  expect((await accBtn.getAttribute('aria-expanded')) === 'true' && await page.locator('#account-menu').isVisible(), 'A21 менюто на профила се отваря с клавиатура (aria-expanded)');
  await page.keyboard.press('Escape'); await settle(page, 150);
  expect((await accBtn.getAttribute('aria-expanded')) === 'false' && (await page.evaluate(() => document.activeElement?.classList.contains('account-btn'))), 'A22 Escape затваря менюто и връща фокуса');

  // ---- 6. „Сготвих“ ----
  await page.locator('[data-cooked-toggle]').first().click(); await settle(page, 900);
  expect((await page.locator('[data-actions-status]').innerText()).includes('Записахме'), 'A23 „Сготвих“: кратко потвърждение');
  expect((await page.locator('[data-cooked-count]').innerText()).includes('Сготвихте я 1 път'), 'A24 „Сготвих“: брой на собствените сготвяния');
  await page.locator('[data-cooked-toggle]').first().click(); await settle(page, 900);
  expect((await page.locator('[data-cooked-count]').innerText()).includes('2 пъти'), 'A25 повторно сготвяне – нов запис в историята');

  // ---- 7. Оценка ----
  expect(await page.locator('[data-star-input]').isVisible(), 'A26 потвърден профил вижда звездите');
  await page.locator('[data-score="5"]').click(); await settle(page, 900);
  expect((await page.locator('[data-score="5"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-my-rating]').innerText()).includes('5'), 'A27 оценка 5 (aria-pressed)');
  await page.locator('[data-score="4"]').click(); await settle(page, 900);
  expect((await page.locator('[data-score="4"]').getAttribute('aria-pressed')) === 'true', 'A28 оценката се променя (една на профил)');

  // ---- 8. Коментар ----
  await page.locator('[data-comment-form] textarea').fill(state.comment);
  await page.locator('[data-comment-form] [type=submit]').click(); await settle(page, 1200);
  expect((await page.locator('[data-form-status]').innerText()).includes('очаква одобрение'), 'A29 „Коментарът ви очаква одобрение.“');
  expect((await page.locator('#komentari .comment.is-pending').filter({ hasText: state.comment }).count()) === 1, 'A30 авторът вижда своя чакащ коментар');
  await axeCheck(page, 'A31 рецепта (влязъл)');
  const viewer = await newPage(browser);
  await viewer.page.goto(BASE + RECIPE); await viewer.page.waitForSelector('[data-community]'); await settle(viewer.page, 900);
  expect(!(await viewer.page.locator('#komentari').innerText()).includes(state.comment), 'A32 чакащият коментар не е публичен');
  await viewer.ctx.close();

  // ---- 9. Без права: модерацията е недостъпна за обикновен потребител ----
  const modApi = await ctx.request.get(BASE + '/api/mod/comments');
  expect(modApi.status() === 403, `A33 потребител → /api/mod/comments 403 (${modApi.status()})`);
  await page.goto(BASE + '/bg/moderatsia/'); await settle(page, 900);
  expect(await page.locator('[data-forbidden]').isVisible(), 'A34 страницата „Модерация“ казва „нямате права“');

  // ---- 10. Профил ----
  await page.goto(BASE + '/bg/profil/#sgotveni'); await settle(page, 1200);
  expect((await page.locator('#sgotveni .cook-item').count()) === 2, 'A35 профил → „Сготвени“: две събития');
  await axeCheck(page, 'A36 /bg/profil/');
  await page.goto(BASE + '/bg/profil/#lyubimi'); await settle(page, 900);
  expect((await page.locator('#lyubimi .plist li').count()) === 1, 'A37 профил → „Любими“');
  expect(page.problems.length === 0, `A38 без грешки в конзолата ${page.problems.slice(0, 2).join(' | ')}`);

  // ---- бъдещият модератор (ролята се дава през cms/cli.mjs set-role между стъпките) ----
  const m = await newMember(browser, state.mod);
  expect(m.ok, 'A39 вторият профил е създаден и потвърден');
  await m.ctx.close();
  await ctx.close();
  fs.writeFileSync(STATE, JSON.stringify(state));
}

if (phase === 'b') {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  // ---- 11. Модератор одобрява ----
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + '/bg/vhod/?next=%2Fbg%2Fmoderatsia%2F');
  await page.fill('#a-email', state.mod.email); await page.fill('#a-pw', state.mod.password);
  await Promise.all([page.waitForURL(/moderatsia/, { timeout: 10000 }), page.locator('[data-form] [type=submit]').click()]);
  await settle(page, 1200);
  const item = page.locator('.mod-item').filter({ hasText: state.comment });
  expect((await item.count()) === 1, 'B1 модераторът вижда чакащия коментар');
  await axeCheck(page, 'B2 /bg/moderatsia/');
  await item.getByRole('button', { name: 'Отхвърли' }).click(); await settle(page, 600);
  expect((await page.locator('[data-out]').innerText()).includes('причина'), 'B3 отхвърляне без причина – отказ');
  await item.getByRole('button', { name: 'Одобри' }).click(); await settle(page, 1200);
  expect((await page.locator('[data-out]').innerText()).includes('Готово'), 'B4 одобрен');
  const users = await ctx.request.get(BASE + '/api/mod/users');
  expect(users.status() === 403, `B5 модератор → профили (само администратор) 403 (${users.status()})`);

  // ---- 12. Публично ----
  const g = await newPage(browser);
  await g.page.goto(BASE + RECIPE); await g.page.waitForSelector('[data-community]'); await settle(g.page, 1200);
  expect((await g.page.locator('#komentari').innerText()).includes(state.comment), 'B6 одобреният коментар се вижда публично');
  expect((await g.page.locator('#komentari').innerText()).includes(state.author.name), 'B7 с името от профила');

  // ---- 13. Тъмна тема и английски ----
  const dark = await newPage(browser, { colorScheme: 'dark' });
  for (const p of ['/bg/vhod/', '/en/sign-in/', '/en/register/', '/bg/poveritelnost/']) {
    await dark.page.goto(BASE + p); await settle(dark.page, 400);
    await axeCheck(dark.page, `B8 тъмна тема ${p}`);
  }
  await dark.page.goto(BASE + '/en/sign-in/');
  expect((await dark.page.locator('html').getAttribute('lang')) === 'en' && (await dark.page.locator('label[for=a-email]').innerText()) === 'Email', 'B9 /en/sign-in/ е на английски');
  for (const w of [360, 390]) {
    await dark.page.setViewportSize({ width: w, height: 800 });
    for (const p of ['/bg/vhod/', RECIPE]) {
      await dark.page.goto(BASE + p); await settle(dark.page, 500);
      const delta = await dark.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(delta <= 1, `B10 ${w}px ${p}: без хоризонтално преливане (${delta})`);
    }
  }
  await dark.ctx.close();

  // ---- 14. Почистване: модераторът скрива тестовия коментар; двата профила се изтриват ----
  await page.goto(BASE + '/bg/moderatsia/?view=all'); await settle(page, 1200);
  const it = page.locator('.mod-item').filter({ hasText: state.comment });
  await it.locator('input[type=text]').fill('Тестов коментар (e2e)');
  await it.getByRole('button', { name: 'Скрий' }).click(); await settle(page, 1000);
  await g.page.reload(); await settle(g.page, 1000);
  expect(!(await g.page.locator('#komentari').innerText()).includes(state.comment), 'B11 скритият коментар изчезва публично');
  await g.ctx.close();
  for (const u of [state.mod, state.author]) {
    const c = await browser.newContext();
    await c.request.post(BASE + '/api/account/login', { data: { email: u.email, password: u.password } });
    const me = await (await c.request.get(BASE + '/api/account/me')).json();
    const del = await c.request.post(BASE + '/api/account/delete', { data: { password: u.password }, headers: { 'x-csrf-token': me.csrf } });
    expect(del.ok(), `B12 тестовият профил ${u.email.split('@')[0]} е изтрит`);
    await c.close();
  }
  await ctx.close();
  fs.rmSync(STATE, { force: true }); // паролите на тестовите профили не остават на диска
}

await browser.close();
process.exit(summary(`Профили – стъпка ${phase}`) ? 1 : 0);
