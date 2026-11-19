// Бърз преглед: влизане и обхождане на всички страници на администрацията (грешки в конзолата, преливане, снимки на екрана).
import fs from 'node:fs';
import { BASE, launch, newPage, login, expect, summary } from './lib.mjs';

const pages = ['/admin', '/admin/recipes', '/admin/recipes/new', '/admin/recipes/kartofena-yahniya/edit', '/admin/recipes/kartofena-yahniya/preview', '/admin/media', '/admin/categories', '/admin/comments', '/admin/ratings', '/admin/publish', '/admin/settings'];
fs.mkdirSync('/out/admin', { recursive: true });
const browser = await launch();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const { page, ctx } = await newPage(browser, { viewport: { width: w, height: h } });
  await login(page);
  expect(page.url().endsWith('/admin'), `вход (${w}px): пренасочване към таблото`);
  for (const p of pages) {
    page.problems.length = 0;
    const resp = await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(p.includes('edit') ? 1200 : 400);
    const name = p.replace(/\//g, '_').replace(/^_/, '') || 'root';
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(resp.status() === 200, `${p} (${w}px): HTTP ${resp.status()}`);
    expect(overflow <= 1, `${p} (${w}px): без хоризонтално преливане (${overflow})`);
    expect(page.problems.length === 0, `${p} (${w}px): без грешки в конзолата ${page.problems.slice(0, 3).join(' | ')}`);
    await page.screenshot({ path: `/out/admin/${name}-${w}.png` });
  }
  await ctx.close();
}
await browser.close();
process.exit(summary('Преглед на администрацията') ? 1 : 0);
