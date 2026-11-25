// Редизайн: адаптивност (320–1440 px), намалено движение, видимо съдържание след превъртане, достъпност (axe),
// основни функции на публичните страници (каталог с филтри, порции, списък за пазаруване, любими, лайтбокс, режим „готвене“,
// пътешествие със снимки) и SEO (заглавие, canonical, hreflang, Recipe JSON-LD). Не изисква администраторски вход.
//   docker compose --profile qa run --rm -T qa-local node e2e-redesign.mjs
import axe from 'axe-core';
import { BASE, launch, newPage, expect, summary } from './lib.mjs';

const browser = await launch();
const R = '/bg/recepti/beef-wellington/';
const pages = ['/bg/', '/en/', '/bg/recepti/', '/en/recipes/', R, '/en/recipes/beef-wellington/', '/bg/kategorii/', '/en/categories/', '/bg/tursene/', '/bg/spisak/', '/bg/lyubimi/', '/bg/poveritelnost/'];
const WIDTHS = [320, 375, 430, 768, 1024, 1280, 1440];

// ---- 1. Без хоризонтално преливане и без грешки в конзолата ----
{
  const { ctx, page } = await newPage(browser);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const p of pages) {
      page.problems.length = 0;
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 30)); } window.scrollTo({ top: 0, behavior: 'instant' }); });
      const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(d <= 1, `${w}px ${p}: без хоризонтално преливане (${d})`);
      const errs = page.problems.filter((x) => !/\/api\//.test(x));
      expect(errs.length === 0, `${w}px ${p}: без грешки в конзолата ${errs.slice(0, 2).join(' | ')}`);
    }
  }
  await ctx.close();
}

// ---- 2. Съдържанието е видимо след превъртане (поява при превъртане не скрива нищо трайно) ----
{
  const { ctx, page } = await newPage(browser);
  for (const p of ['/bg/', R]) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 300) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 60)); } });
    await page.waitForTimeout(1500);
    const hiddenEls = await page.evaluate(() => [...document.querySelectorAll('[data-reveal], [data-reveal-group] > *')].filter((e) => e.classList.contains('rv') || Number(getComputedStyle(e).opacity) < 0.99).map((e) => (e.parentElement?.className ?? '') + ' > ' + e.className + ' ' + getComputedStyle(e).opacity)); const hidden = hiddenEls.length + (hiddenEls.length ? ' ' + hiddenEls.join('; ') : '');
    expect(hidden === 0 || hidden === "0", `${p}: след превъртане до края всички секции са видими (скрити: ${hidden})`);
  }
  // Без JavaScript нищо не е скрито
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const pg = await noJs.newPage();
  await pg.goto(BASE + '/bg/', { waitUntil: 'load' });
  const nh = await pg.evaluate(() => [...document.querySelectorAll('[data-reveal], [data-reveal-group] > *')].filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length);
  expect(nh === 0, `без JavaScript: нищо не е скрито (${nh})`);
  await noJs.close();
  await ctx.close();
}

// ---- 3. Намалено движение: без поява, паралакс, закачена секция и бягаща лента ----
{
  const { ctx, page } = await newPage(browser, { reducedMotion: 'reduce' });
  await page.goto(BASE + '/bg/', { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => ({
    rv: document.querySelectorAll('.rv').length,
    hp: document.querySelector('[data-hero]')?.style.getPropertyValue('--hp') ?? '',
    pinned: document.querySelector('[data-journey]')?.classList.contains('is-pinned'),
    marquee: getComputedStyle(document.querySelector('.marquee-track')).animationName,
    title: getComputedStyle(document.querySelector('.hero-title .w')).animationName,
  }));
  expect(s.rv === 0, 'намалено движение: няма скрити елементи за поява');
  expect(s.hp === '', 'намалено движение: без паралакс на заглавния кадър');
  expect(s.pinned === false, 'намалено движение: пътешествието не е закачено');
  expect(s.marquee === 'none' && s.title === 'none', `намалено движение: без анимации (${s.marquee}, ${s.title})`);
  await ctx.close();
}

// ---- 4. Начало: заглавие с интервали, пътешествие, плъзгач, клавиатура ----
{
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + '/bg/', { waitUntil: 'load' });
  const h1 = await page.locator('h1').innerText();
  expect(/\s/.test(h1) && h1.replace(/\s+/g, ' ').trim() === 'Модерна кухня с Мишлен щрих', `заглавието се чете с интервали („${h1.replace(/\s+/g, ' ')}“)`);
  const j = await page.evaluate(() => { const s = document.querySelector('[data-journey]'); return { pinned: s.classList.contains('is-pinned'), n: s.querySelectorAll('.journey-item').length }; });
  expect(j.pinned && j.n >= 6, `на компютър пътешествието е закачено и има ${j.n} кадъра`);
  // Превъртането движи кадрите наляво
  await page.evaluate(() => { const s = document.querySelector('[data-journey]'); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY + 600, behavior: 'instant' }); });
  await page.waitForTimeout(400);
  const jx = await page.evaluate(() => Number(document.querySelector('[data-journey]').style.getPropertyValue('--jx')));
  expect(jx > 100, `вертикалното превъртане движи пътешествието (${Math.round(jx)} px)`);
  // Клавиатура: последният кадър става видим при фокус
  const last = page.locator('.journey-item a').last();
  await last.focus();
  await page.waitForTimeout(300);
  const inView = await last.evaluate((a) => { const r = a.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
  expect(inView, 'фокусираният последен кадър от пътешествието е изцяло видим');
  // Плъзгач с рецепти за фино ядене
  await page.locator('#h-fine').scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => document.querySelector('[data-rail-track]').scrollLeft);
  await page.click('[data-rail-next]');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => document.querySelector('[data-rail-track]').scrollLeft);
  expect(after > before, `бутонът „Следващи рецепти“ превърта плъзгача (${before} → ${after})`);
  // Телефон: пътешествието е обикновена хоризонтална лента
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'load' });
  const mob = await page.evaluate(() => { const s = document.querySelector('[data-journey]'); return { pinned: s.classList.contains('is-pinned'), ov: getComputedStyle(s.querySelector('[data-journey-viewport]')).overflowX }; });
  expect(!mob.pinned && mob.ov === 'auto', 'на телефон пътешествието е хоризонтална лента без закачане');
  await ctx.close();
}

// ---- 5. Каталог: филтри, чипове, подредба, телефонно сгъване ----
{
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + '/bg/recepti/?collection=fine-dining', { waitUntil: 'load' });
  const total = await page.locator('[data-count]').innerText();
  expect(Number(total) > 0 && Number(total) < (await page.evaluate(() => document.querySelectorAll('[data-card]').length)), `филтърът от адреса работи (${total})`);
  expect(await page.locator('[data-active-filters] button').count() === 1, 'активният филтър е показан като чип');
  await page.click('[data-active-filters] button');
  const all = await page.evaluate(() => document.querySelectorAll('[data-card]').length);
  expect(await page.locator('[data-count]').innerText() === String(all) && !page.url().includes('collection'), 'премахването на чипа изчиства филтъра и адреса');
  await page.selectOption('#f-sort', 'time');
  const times = await page.$$eval('[data-grid] > li:not([hidden]) [data-card]', (cs) => cs.slice(0, 10).map((c) => Number(c.dataset.time)));
  expect(times.every((t, i) => i === 0 || t >= times[i - 1]), 'подредбата „най-бързи“ работи');
  await page.fill('#f-q', 'баница');
  await page.waitForTimeout(400);
  expect(Number(await page.locator('[data-count]').innerText()) >= 1, 'търсенето в каталога намира „баница“');
  await page.click('[data-reset]');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'load' });
  expect(!(await page.locator('#f-category').isVisible()), 'телефон: допълнителните филтри са сгънати');
  await page.click('[data-filters-toggle]');
  expect(await page.locator('#f-category').isVisible() && (await page.getAttribute('[data-filters-toggle]', 'aria-expanded')) === 'true', 'телефон: „Още филтри“ ги показва (aria-expanded=true)');
  await ctx.close();
}

// ---- 6. Рецепта: порции, отметки, списък за пазаруване, любими, лайтбокс, готвене, навигация, SEO ----
{
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + R, { waitUntil: 'load' });
  const first = () => page.locator('[data-ing] .ing-text').first().innerText();
  const a = await first();
  await page.click('[data-plus]');
  await page.click('[data-plus]');
  const b = await first();
  expect(a !== b && (await page.locator('[data-servings]').innerText()) === '6', `порциите преизчисляват количествата („${a}“ → „${b}“)`);
  await page.click('[data-add-list]');
  await page.locator('[data-ing] input').first().check();
  expect(await page.locator('[data-ing] input').first().isChecked(), 'отметката на съставка работи');
  await page.click('[data-fav-toggle]');
  expect((await page.getAttribute('[data-fav-toggle]', 'aria-pressed')) === 'true', 'бутонът „Любими“ се включва');
  await page.locator('.hero-fig a[data-lightbox]').click();
  expect(await page.locator('dialog.lightbox[open]').count() === 1, 'лайтбоксът се отваря');
  await page.keyboard.press('Escape');
  await page.click('[data-cook-open]');
  expect(await page.locator('dialog.cook[open]').count() === 1, 'режимът „готвене“ се отваря');
  await page.keyboard.press('Escape');
  const pos = await page.locator('.page-nav').evaluate((n) => getComputedStyle(n).position);
  expect(pos === 'sticky', 'навигацията в рецептата е залепена на компютър');
  await page.locator('#prigotvyane').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy({ top: 200, behavior: 'instant' }));
  await page.waitForTimeout(400);
  expect(await page.locator('.page-nav a.is-active[href="#prigotvyane"]').count() === 1, 'текущият раздел („Приготвяне“) е отбелязан в навигацията');
  const seo = await page.evaluate(() => {
    const lds = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
    const r = lds.flat().find((x) => x['@type'] === 'Recipe');
    return { title: document.title, canon: document.querySelector('link[rel=canonical]')?.href ?? '', hl: document.querySelectorAll('link[hreflang]').length, ing: r?.recipeIngredient?.length ?? 0, steps: r?.recipeInstructions?.length ?? 0, rating: 'aggregateRating' in (r ?? {}), steptext: document.querySelectorAll('.step .step-text').length };
  });
  expect(seo.title.includes('Уелингтън') && seo.canon.endsWith(R) && seo.hl === 3, `SEO: заглавие, canonical и 3 hreflang (${seo.hl})`);
  expect(seo.ing > 5 && seo.steps === seo.steptext && !seo.rating, `Recipe JSON-LD: ${seo.ing} съставки, ${seo.steps} стъпки (= ${seo.steptext} в текста), без измислена оценка`);
  // Списъкът за пазаруване съдържа рецептата
  await page.goto(BASE + '/bg/spisak/', { waitUntil: 'load' });
  expect(await page.locator('.shop-list section').count() === 1 && (await page.locator('[data-list] .ing-text').count()) > 5, 'списъкът за пазаруване съдържа добавената рецепта');
  // Любими (гост, в браузъра)
  await page.goto(BASE + '/bg/lyubimi/', { waitUntil: 'load' });
  expect(await page.locator('[data-fav-item]:visible').count() === 1, 'любимата рецепта е в „Любими“');
  await page.click('.fav-remove');
  await page.waitForTimeout(500);
  expect(await page.locator('[data-fav-item]:visible').count() === 0, '„Премахни от любими“ работи (с кратка анимация)');
  await ctx.close();
}

// ---- 7. Тъмна тема: превключване и запазване ----
{
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + '/bg/', { waitUntil: 'load' });
  await page.click('[data-theme-toggle]');
  await page.reload({ waitUntil: 'load' });
  const bg = await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  expect(bg[0] === 'dark' && bg[1] === 'rgb(18, 16, 14)', `тъмната тема се запазва след презареждане (${bg.join(', ')})`);
  await ctx.close();
}

// ---- 8. Достъпност (axe-core, WCAG 2.1 AA) в светла и тъмна тема ----
for (const scheme of ['light', 'dark']) {
  const { ctx, page } = await newPage(browser, { colorScheme: scheme });
  for (const p of ['/bg/', '/en/', '/bg/recepti/', R, '/bg/kategorii/', '/bg/tursene/?q=баница', '/bg/spisak/']) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.waitForTimeout(1200);
    await page.evaluate(axe.source);
    const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations.map((v) => `${v.id}(${v.nodes.length}) ${v.nodes[0]?.target}`));
    expect(res.length === 0, `axe ${scheme} ${p}: ${res.length ? res.join(' | ') : 'без нарушения'}`);
  }
  await ctx.close();
}

await browser.close();
process.exit(summary('Редизайн') ? 1 : 0);
