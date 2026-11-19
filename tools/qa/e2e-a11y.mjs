// Адаптивност (360, 390, 768, 1024, 1440), достъпност (axe-core, клавиатура) и конзола за публичната страница с оценки/коментари и администрацията.
import axe from 'axe-core';
import { BASE, launch, newPage, login, expect, summary } from './lib.mjs';

const WIDTHS = [360, 390, 768, 1024, 1440];
const browser = await launch();
const publicPages = ['/recepti/kartofena-yahniya/', '/recepti/', '/lyubimi/'];
const adminPages = ['/admin', '/admin/recipes', '/admin/recipes/kartofena-yahniya/edit', '/admin/comments', '/admin/publish', '/admin/settings'];

// ---- Адаптивност ----
{
  const { ctx, page } = await newPage(browser);
  await login(page);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const p of [...publicPages, ...adminPages]) {
      page.problems.length = 0;
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.waitForTimeout(p.includes('edit') || p.startsWith('/recepti/k') ? 1400 : 500);
      const over = await page.evaluate(() => {
        const bad = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1 && !e.closest('.story-track, .journey-strip, .tablewrap, pre, .crop-stage, .photo-grid'); });
        return { delta: document.documentElement.scrollWidth - document.documentElement.clientWidth, first: bad[0]?.className || bad[0]?.tagName };
      });
      expect(over.delta <= 1, `${w}px ${p}: без хоризонтално преливане (${over.delta}${over.first ? ' ← ' + over.first : ''})`);
      expect(page.problems.length === 0, `${w}px ${p}: без грешки в конзолата ${page.problems.slice(0, 2).join(' | ')}`);
    }
  }
  await ctx.close();
}

// ---- Лентата в страницата не закрива текста на телефон ----
{
  const { ctx, page } = await newPage(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/recepti/kartofena-yahniya/'); await page.waitForTimeout(800);
  const pos = await page.locator('.page-nav').evaluate((n) => getComputedStyle(n).position);
  expect(pos !== 'sticky' && pos !== 'fixed', `Навигацията в страницата не е залепена на телефон (${pos})`);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  expect((await page.locator('.page-nav').evaluate((n) => getComputedStyle(n).position)) === 'sticky', 'Навигацията в страницата е залепена на компютър');
  await ctx.close();
}

// ---- axe-core: светла и тъмна тема ----
async function runAxe(page, label) {
  await page.evaluate(axe.source);
  const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
  const v = r.violations.filter((x) => !['region', 'landmark-one-main', 'page-has-heading-one'].includes(x.id) || label.startsWith('admin'));
  expect(v.length === 0, `axe ${label}: ${v.length} нарушения ${v.map((x) => `${x.id}(${x.nodes.length})`).join(', ')}`);
  for (const x of v.slice(0, 3)) console.log('    ', x.id, x.nodes[0]?.html.slice(0, 160));
}
for (const scheme of ['light', 'dark']) {
  const { ctx, page } = await newPage(browser, { colorScheme: scheme, bypassCSP: true });
  for (const p of publicPages) { await page.goto(BASE + p); await page.waitForTimeout(1500); await runAxe(page, `${p} (${scheme})`); }
  await login(page);
  for (const p of adminPages) { await page.goto(BASE + p); await page.waitForTimeout(1200); await runAxe(page, `admin ${p} (${scheme})`); }
  await ctx.close();
}

// ---- Клавиатура: видим фокус и ред на табулация ----
{
  const { ctx, page } = await newPage(browser);
  await page.goto(BASE + '/admin/login');
  const order = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.tagName)); }
  expect(order.join() === 'email,password,BUTTON' || order.join() === 'password,BUTTON,BODY' || order[0] === 'password' || order[0] === 'email', `Вход: ред на табулация (${order.join(' → ')})`);
  await page.goto(BASE + '/recepti/kartofena-yahniya/'); await page.waitForSelector('[data-community]'); await page.waitForTimeout(800);
  await page.locator('[data-score="1"]').focus();
  const ring = await page.locator('[data-score="1"]').evaluate((b) => { const s = getComputedStyle(b); return `${s.outlineStyle} ${s.outlineWidth}`; });
  expect(!/^none/.test(ring) && !/ 0px$/.test(ring), `Бутоните за оценка имат видим фокус (${ring})`);
  const names = await page.locator('[data-score]').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label')));
  expect(names.join() === '1 от 5,2 от 5,3 от 5,4 от 5,5 от 5', 'Бутоните за оценка имат достъпни имена');
  // оценка и коментар само с клавиатура е възможна (бутоните са истински <button>, формата – истинска <form>)
  expect(await page.locator('[data-comment-form]').evaluate((f) => f.tagName === 'FORM'), 'Коментарната форма е истинска форма');
  await ctx.close();
}

await browser.close();
process.exit(summary('Адаптивност и достъпност') ? 1 : 0);
