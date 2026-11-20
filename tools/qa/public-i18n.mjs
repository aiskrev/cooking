// Браузърна проверка на двуезичния ПУБЛИЧЕН сайт (без вход): адаптивност, достъпност (axe), клавиатура, превключвател на езика,
// любими и списък за пазаруване между езиците, преоразмеряване, режим „готвене“, лайтбокс, търсене, филтри и конзола.
//   BASE=http://localhost:8080 node public-i18n.mjs
import axe from 'axe-core';
import { BASE, launch, newPage, expect, summary } from './lib.mjs';

const WIDTHS = [360, 390, 768, 1024, 1440];
const PAGES = [
  ['bg', '/bg/'], ['en', '/en/'],
  ['bg', '/bg/recepti/'], ['en', '/en/recipes/'],
  ['bg', '/bg/recepti/tarator/'], ['en', '/en/recipes/tarator/'],
  ['bg', '/bg/recepti/beef-wellington/'], ['en', '/en/recipes/beef-wellington/'],
  ['bg', '/bg/kategorii/'], ['en', '/en/categories/'],
  ['bg', '/bg/tursene/'], ['en', '/en/search/'],
  ['bg', '/bg/lyubimi/'], ['en', '/en/favorites/'],
  ['bg', '/bg/spisak/'], ['en', '/en/shopping-list/'],
];
const browser = await launch();

// ---- 1) адаптивност, конзола, достъпност (светла и тъмна тема) ----
{
  const { ctx, page } = await newPage(browser);
  const axeSrc = axe.source;
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const [loc, p] of PAGES) {
      page.problems.length = 0;
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.waitForTimeout(p.includes('recepti/') && p.length > 14 || p.includes('recipes/') && p.length > 14 ? 900 : 400);
      const m = await page.evaluate(() => {
        const d = document.documentElement;
        const header = document.querySelector('.site-header').getBoundingClientRect().height;
        // широки елементи, които не са част от нарочно превъртащ се контейнер
        const wide = [...document.querySelectorAll('header *, main *, footer *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > d.clientWidth + 1 && !e.closest('.story-track, .journey-strip, [data-lightbox], .tablewrap') && getComputedStyle(e).position !== 'absolute' && !e.matches('img.lqip, .lqip'); });
        return { over: d.scrollWidth - d.clientWidth, header: Math.round(header), wide: wide[0] ? `${wide[0].tagName}.${wide[0].className}` : '' };
      });
      expect(m.over <= 1, `${w}px ${p}: без хоризонтално преливане (${m.over}${m.wide ? ' ← ' + m.wide : ''})`);
      expect(m.header <= 200, `${w}px ${p}: хедърът не е прекалено висок (${m.header}px)`);
      expect(page.problems.length === 0, `${w}px ${p}: без грешки в конзолата ${page.problems.slice(0, 2).join(' | ')}`);
    }
  }
  // axe: WCAG 2.0–2.2 A/AA + добри практики, светла и тъмна тема
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const [loc, p] of PAGES) {
        await page.goto(BASE + p, { waitUntil: 'load' }); await page.waitForTimeout(500);
        await page.evaluate(axeSrc);
        const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
        const v = res.violations.map((x) => `${x.id}(${x.nodes.length})`);
        expect(v.length === 0, `axe ${scheme} ${w}px ${p}: ${v.length ? v.join(', ') : 'без нарушения'}`);
      }
    }
  }
  await ctx.close();
}

// ---- 2) превключвател на езика: клавиатура, достъпност, самоличност на рецептата ----
{
  const { ctx, page } = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/bg/recepti/tarator/', { waitUntil: 'load' });
  const sw = page.locator('[data-lang-switch] a');
  expect((await sw.count()) === 2, 'превключвателят има два езика');
  expect((await page.locator('[data-lang-switch] a[aria-current="true"]').getAttribute('data-lang')) === 'bg', 'текущият език е отбелязан с aria-current');
  expect((await page.locator('[data-lang-switch]').getAttribute('aria-label')).includes('Език'), 'навигацията на езика има име');
  // клавиатура: Tab до връзката „EN“ и Enter
  await page.locator('.brand').focus();
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement?.getAttribute('data-lang') === 'en'); }
  expect(reached, 'до „EN“ се стига с Tab');
  const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1; });
  expect(outline, 'фокусът е видим на превключвателя');
  await Promise.all([page.waitForURL('**/en/recipes/tarator/'), page.keyboard.press('Enter')]);
  expect(page.url().endsWith('/en/recipes/tarator/'), 'Enter превключва към същата рецепта на английски');
  expect(((await page.locator('h1').textContent()) || '').includes('Tarator'), 'английската страница има английско заглавие');
  expect((await page.evaluate(() => document.documentElement.lang)) === 'en', 'html lang=en');
  expect(await page.evaluate(() => localStorage.getItem('lang')) === 'en', 'изборът на език се помни (без автоматично пренасочване)');
  await Promise.all([page.waitForURL('**/bg/recepti/tarator/'), page.click('[data-lang-switch] a[data-lang="bg"]')]);
  expect(page.url().endsWith('/bg/recepti/tarator/'), 'обратно към българската рецепта');
  // страница с филтри: заявката се запазва при смяна на езика
  await page.goto(BASE + '/bg/recepti/?category=' + encodeURIComponent('Супи'), { waitUntil: 'load' }); await page.waitForTimeout(500);
  await Promise.all([page.waitForURL('**/en/recipes/**'), page.click('[data-lang-switch] a[data-lang="en"]')]);
  await page.waitForTimeout(600);
  expect(decodeURIComponent(page.url()).includes('category=Супи'), 'филтърът по категория се запазва при смяна на езика');
  const visible = await page.evaluate(() => [...document.querySelectorAll('[data-grid] > li')].filter((l) => !l.hidden).length);
  expect(visible === 5, `на английски същият филтър показва 5 супи (${visible})`);
  const opt = await page.evaluate(() => document.getElementById('f-category').selectedOptions[0].textContent);
  expect(opt.startsWith('Soups'), `етикетът на категорията е на английски („${opt}“)`);
  // 404 за непознат език
  const miss = await page.goto(BASE + '/fr/', { waitUntil: 'load' });
  expect(miss.status() === 404, 'непознат език -> 404');
  await ctx.close();
}

// ---- 3) любими и списък за пазаруване – общи за двата езика ----
{
  const { ctx, page } = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/bg/recepti/tarator/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.click('[data-fav-toggle]');
  expect((await page.locator('[data-fav-toggle]').textContent()).includes('В любими'), 'любими: бутонът на български');
  await page.click('[data-add-list]');
  await page.waitForTimeout(300);
  await page.goto(BASE + '/en/recipes/tarator/', { waitUntil: 'load' });
  expect((await page.locator('[data-fav-toggle]').getAttribute('aria-pressed')) === 'true', 'любими: рецептата е в любими и на английската страница');
  expect((await page.locator('[data-fav-toggle]').textContent()).includes('In favourites'), 'любими: бутонът е на английски');
  await page.goto(BASE + '/en/favorites/', { waitUntil: 'load' }); await page.waitForTimeout(400);
  expect((await page.locator('[data-fav-item]:not([hidden])').count()) === 1, 'любими: на английската страница се вижда същата рецепта');
  await page.goto(BASE + '/en/shopping-list/', { waitUntil: 'load' }); await page.waitForTimeout(400);
  const lines = await page.locator('[data-list] .ing-text').allTextContents();
  expect(lines.length === 9 && lines[0] === '500 g yogurt', `списък: съставките са на английски („${lines[0]}“)`);
  await page.click('[data-list] .ing-check >> nth=0');
  await page.goto(BASE + '/bg/spisak/', { waitUntil: 'load' }); await page.waitForTimeout(400);
  const bgLines = await page.locator('[data-list] .ing-text').allTextContents();
  expect(bgLines[0] === '500 г кисело мляко', `списък: същите редове на български („${bgLines[0]}“)`);
  expect((await page.locator('[data-list] .ing-check').first().isChecked()), 'списък: отметката се пази при смяна на езика');
  // стар формат (само български) още се чете, без дубликати
  await page.evaluate(() => localStorage.setItem('shopping-list', JSON.stringify([{ slug: 'tarator', title: 'Таратор', servings: 4, items: ['1 щипка сол'] }])));
  await page.goto(BASE + '/en/shopping-list/', { waitUntil: 'load' }); await page.waitForTimeout(400);
  expect((await page.locator('[data-list] section').count()) === 1, 'старият формат на списъка се чете (една рецепта)');
  expect((await page.locator('[data-list] h2 a').getAttribute('href')) === '/en/recipes/tarator/', 'стар запис: рецептата има превод, връзката е към английската страница');
  await ctx.close();
}

// ---- 4) инструменти на рецептата на английски: порции, режим „готвене“, лайтбокс, печат ----
{
  const { ctx, page } = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/en/recipes/tarator/', { waitUntil: 'load' }); await page.waitForTimeout(500);
  await page.click('[data-plus]'); await page.click('[data-plus]');
  const first = await page.locator('.ing-text').first().textContent();
  expect(first === '750 g yogurt', `порции: 4 -> 6 пренасочва количествата („${first}“)`);
  expect((await page.locator('[data-reset]').textContent()) === 'Reset to 4', 'порции: бутонът „Reset to 4“');
  await page.click('[data-cook-open]'); await page.waitForTimeout(300);
  expect(((await page.locator('dialog.cook .ck-progress').textContent()) || '') === 'Step 1 of 9', 'режим „готвене“ на английски');
  await page.keyboard.press('ArrowRight');
  expect(((await page.locator('dialog.cook .ck-progress').textContent()) || '') === 'Step 2 of 9', 'режим „готвене“: следваща стъпка със стрелка');
  await page.click('dialog.cook .ck-close');
  await page.locator('a[data-lightbox]').first().click(); await page.waitForTimeout(400);
  const lb = await page.locator('dialog.lightbox').first();
  expect(await lb.isVisible(), 'лайтбокс: отваря се');
  expect(((await page.locator('.lb-count').textContent()) || '').startsWith('Photo 1 of'), 'лайтбокс: „Photo 1 of N“');
  expect((await page.locator('.lb-close').getAttribute('aria-label')) === 'Close the gallery', 'лайтбокс: бутонът за затваряне е на английски');
  await page.keyboard.press('Escape');
  // печат: бележка под рецептата
  const printNote = await page.locator('.print-only').textContent();
  expect(printNote.startsWith('Recipe from '), `печат: „${printNote.slice(0, 40)}…“`);
  // бележка за превода на ИИ (reviewed: false)
  expect(((await page.locator('.small-notice').first().textContent()) || '').includes('artificial intelligence'), 'английската страница е честна за превода с ИИ');
  // JSON-LD
  const ld = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)).flat().find((n) => n['@type'] === 'Recipe'));
  expect(ld.inLanguage === 'en' && /yogurt/i.test(JSON.stringify(ld.recipeIngredient)) && ld.recipeYield[1] === '4 servings', 'JSON-LD Recipe е на английски (inLanguage, съставки, порции)');
  expect(!/[Ѐ-ӿ]/.test(JSON.stringify([ld.name, ld.description, ld.recipeIngredient, ld.recipeInstructions, ld.recipeCategory, ld.keywords])), 'JSON-LD няма български текст');
  await ctx.close();
}

// ---- 5) търсене на двата езика ----
{
  const { ctx, page } = await newPage(browser, { viewport: { width: 1280, height: 900 } });
  const search = async (url, q) => { await page.goto(BASE + url + '?q=' + encodeURIComponent(q), { waitUntil: 'load' }); await page.waitForTimeout(1800); return page.locator('#search-results .result h2 a').evaluateAll((a) => a.map((x) => x.getAttribute('href'))); };
  const en = await search('/en/search/', 'duck'); expect(en.includes('/en/recipes/patitsa-s-portokalov-gastrik/') && en.every((h) => h.startsWith('/en/')), `търсене „duck“: само английски резултати (${en.length})`);
  const bg = await search('/bg/tursene/', 'патица'); expect(bg.includes('/bg/recepti/patitsa-s-portokalov-gastrik/') && bg.every((h) => h.startsWith('/bg/')), `търсене „патица“: само български резултати (${bg.length})`);
  const cross = await search('/en/search/', 'патица'); expect(cross.length === 0, 'българска дума в английското търсене не дава български страници');
  const acc = await search('/en/search/', 'purée'); expect(acc.some((h) => h.includes('kartofeno-pyure')), 'търсене с диакритичен знак („purée“) намира рецептата');
  const none = await search('/en/search/', 'zzzzxq'); expect(none.length === 0 && /No results/.test(await page.locator('#search-status').textContent()), 'празен резултат: съобщение на английски');
  await ctx.close();
}
await browser.close();
process.exit(summary('Двуезичен публичен сайт') ? 1 : 0);
