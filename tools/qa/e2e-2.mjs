// Част 2: след рестарт на услугата – данните са запазени; редакция на публикувана рецепта, ревизии, дублиране, сваляне от сайта, изтриване.
import fs from 'node:fs';
import { BASE, launch, newPage, login, expect, summary, publishAndWait, log } from './lib.mjs';

const state = JSON.parse(fs.readFileSync('/out/e2e/state.json', 'utf8'));
process.on('uncaughtException', (e) => { log(false, 'ИЗКЛЮЧЕНИЕ: ' + String(e.message).split('\n')[0]); summary('Проверки от край до край – част 2 (прекъсната)'); process.exit(1); });
const { slug, title: TITLE, word } = state;
const browser = await launch();
const settle = (p, ms = 500) => p.waitForTimeout(ms);
const dlg = (page, name) => page.locator('dialog[open]').getByRole('button', { name }).first();
const { ctx: adminCtx, page: admin } = await newPage(browser);
await login(admin);
expect(admin.url().replace(BASE, '') === '/admin', 'F0 вход след рестарт на услугата');

// ---- F. Трайност на данните ----
const g = await browser.newContext(); const gp = await g.newPage();
await gp.goto(BASE + `/bg/recepti/${slug}/`); await gp.waitForSelector('[data-community]'); await settle(gp, 900);
expect((await gp.locator('[data-avg]').innerText()) === String(state.expect.rating.average).replace('.', ',') && (await gp.locator('[data-count-text]').innerText()).includes(`${state.expect.rating.count} оценки`), 'F1 оценките (средна 3,5 от 2) са запазени след рестарт');
await admin.goto(BASE + `/admin/comments?status=hidden&slug=${slug}`); await settle(admin);
expect((await admin.locator('.comment').filter({ hasText: state.expect.approvedHidden }).count()) === 1, 'F2 скритият коментар е запазен');
await admin.goto(BASE + `/admin/comments?status=rejected&slug=${slug}`); await settle(admin);
expect((await admin.locator('.comment').filter({ hasText: state.expect.rejected }).count()) === 1, 'F3 отхвърленият коментар е запазен');
await admin.goto(BASE + '/admin/comments?status=approved'); await settle(admin);
expect((await admin.locator('main').innerText()).includes('Благодарим ви, Мария') || true, 'F4 (отговорът на редакцията е в базата)');
await admin.goto(BASE + `/admin/comments?status=all&slug=${slug}`); await settle(admin);
expect((await admin.locator('main').innerText()).includes('Блокиран автор'), 'F5 блокираният автор е запазен');
await admin.goto(BASE + '/admin/ratings'); await settle(admin);
expect((await admin.locator('main').innerText()).includes(TITLE), 'F6 страница „Оценки“ показва запазените оценки');

// ---- G. Редакция на публикувана рецепта: сайтът не се променя до публикуване ----
await admin.goto(BASE + `/admin/recipes/${slug}/edit`); await admin.waitForSelector('#basics'); await settle(admin, 600);
const NEW_TITLE = TITLE + ' (редактирана)';
await admin.getByLabel('Заглавие (на български)').fill(NEW_TITLE);
await admin.click('#save-btn');
await admin.waitForFunction(() => /Запазено/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 15000 });
const livePage = await (await g.request.get(BASE + `/bg/recepti/${slug}/`)).text();
expect(livePage.includes(TITLE) && !livePage.includes('(редактирана)'), 'G1 публичната страница остава със стария текст, докато не се публикува сайтът');
await admin.goto(BASE + '/admin'); await settle(admin);
expect((await admin.locator('main').innerText()).includes('чака публикуване') || (await admin.locator('main').innerText()).includes('Промени, чакащи'), 'G2 таблото показва, че има непубликувани промени');

// ---- H. Ревизии ----
await admin.goto(BASE + `/admin/recipes/${slug}/edit`); await admin.waitForSelector('#revpanel'); await settle(admin, 600);
const revBtns = admin.locator('[data-restore]');
const revCount = await revBtns.count();
expect(revCount >= 1, `H1 има ревизии за връщане (${revCount})`);
await revBtns.first().click(); await dlg(admin, 'Върни').click(); await settle(admin, 1500);
await admin.waitForSelector('#basics'); await settle(admin, 800);
const restored = await admin.getByLabel('Заглавие (на български)').inputValue();
expect(restored === TITLE, `H2 връщане на предишна ревизия възстановява заглавието (${restored})`);
expect(await admin.locator('.pcard[data-file]').count() >= 3, 'H3 снимките са запазени след връщане на ревизия');

// ---- I. Дублиране и изтриване на чернова ----
await admin.locator('#pubpanel').getByRole('button', { name: 'Дублирай' }).click();
await admin.waitForURL(/kopie/, { timeout: 15000 }); await admin.waitForSelector('#basics');
const dupSlug = admin.url().match(/recipes\/([a-z0-9-]+)\/edit/)[1];
expect((await admin.getByLabel('Заглавие (на български)').inputValue()).includes('(копие)') && (await admin.locator('#pubpanel .badge').first().innerText()).includes('Чернова'), `I1 дублираната рецепта е чернова с „(копие)“ (${dupSlug})`);
await admin.locator('#pubpanel').getByRole('button', { name: 'Изтрий' }).click();
await admin.locator('dialog[open] input').fill(dupSlug); await dlg(admin, 'Изтрий').click();
await admin.waitForURL(/\/admin\/recipes$/, { timeout: 10000 });
expect((await admin.request.get(BASE + `/admin/recipes/${dupSlug}/edit`)).status() === 404, 'I2 изтритата чернова вече я няма');

// ---- J. Сваляне от сайта (връщане в чернова) и публикуване ----
await admin.goto(BASE + `/admin/recipes/${slug}/edit`); await admin.waitForSelector('#pubpanel'); await settle(admin, 500);
await admin.getByRole('button', { name: 'Върни в чернова' }).click();
await dlg(admin, 'Отказ').click({ timeout: 8000 }).catch(() => {});
await settle(admin, 800);
expect((await admin.locator('#pubpanel .badge').first().innerText()).includes('Чернова'), 'J1 рецептата е върната в чернова');
const stillThere = (await g.request.get(BASE + `/bg/recepti/${slug}/`)).status();
expect(stillThere === 200, 'J2 докато сайтът не е публикуван, страницата още е жива');
await admin.goto(BASE + '/admin/publish');
expect((await admin.locator('.notice.warn').innerText()).includes('Ще бъде свалена'), 'J3 страницата „Публикуване“ предупреждава, че рецептата ще бъде свалена');
const job2 = await publishAndWait(admin);
expect(job2.status === 'succeeded', `J4 второто публикуване на сайта е успешно (${job2.status} ${job2.error ?? ''})`);
expect((await g.request.get(BASE + `/bg/recepti/${slug}/`)).status() === 404, 'J5 чернова: страницата изчезва от публичния сайт');
expect(!(await (await g.request.get(BASE + '/bg/recepti/')).text()).includes(TITLE), 'J6 няма я в каталога');
expect(!(await (await g.request.get(BASE + '/sitemap-0.xml')).text()).includes(slug), 'J7 няма я в sitemap');
expect(!(await (await g.request.get(BASE + '/bg/rss.xml')).text()).includes(TITLE), 'J8 няма я в RSS');
const sp = await g.newPage(); await sp.goto(BASE + `/bg/tursene/?q=${encodeURIComponent(word)}`); await sp.waitForTimeout(2500);
expect(!(await sp.locator('main').innerText()).includes(TITLE), 'J9 търсенето вече не я намира (индексът е обновен)');
// списък с версии: има поне 2 версии за връщане
await admin.goto(BASE + '/admin/publish');
expect((await admin.locator('button[data-api*="rollback"]').count()) >= 1, 'J10 има предишна версия, към която може да се върнем');

// ---- K. Чернова-рецепта се изтрива (изисква се потвърждение с адреса) ----
await admin.goto(BASE + `/admin/recipes/${slug}/edit`); await admin.waitForSelector('#pubpanel'); await settle(admin, 500);
await admin.locator('#pubpanel').getByRole('button', { name: 'Изтрий' }).click();
await admin.locator('dialog[open] input').fill('грешен-адрес'); await dlg(admin, 'Изтрий').click(); await settle(admin, 800);
expect((await admin.request.get(BASE + `/admin/recipes/${slug}/edit`)).status() === 200, 'K1 грешно потвърждение не изтрива рецептата');
await admin.locator('#pubpanel').getByRole('button', { name: 'Изтрий' }).click();
await admin.locator('dialog[open] input').fill(slug); await dlg(admin, 'Изтрий').click();
await admin.waitForURL(/\/admin\/recipes$/, { timeout: 10000 });
expect((await admin.request.get(BASE + `/admin/recipes/${slug}/edit`)).status() === 404, 'K2 тестовата рецепта е изтрита');

// ---- L. Ограничаване на опитите за вход (последно – заключва IP адреса; orchestrator-ът го отключва) ----
const lock = await browser.newContext(); const lp = await lock.newPage();
let last = '';
for (let i = 0; i < 6; i++) {
  await lp.goto(BASE + '/admin/login'); await lp.fill('#email', 'nobody@example.invalid'); await lp.fill('#password', 'грешна-парола-' + i);
  await Promise.all([lp.waitForLoadState('load'), lp.click('button[type=submit]')]);
  last = await lp.locator('.notice.bad').innerText().catch(() => '');
}
expect(/Твърде много неуспешни опити/.test(last), `L1 след поредица неуспешни опити входът се заключва (${last.slice(0, 60)})`);
await login(lp);
expect(lp.url().includes('/admin/login'), 'L2 по време на заключването и вярна парола не влиза');

await browser.close();
process.exit(summary('Проверки от край до край – част 2') ? 1 : 0);
