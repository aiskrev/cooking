// Заглавка при 12 ширини, BG/EN, светла/тъмна тема: височина локално спрямо продукцията, преливане, знак на логото; снимки в /out/logo.
//   docker compose --profile qa run --rm -T qa-local node header-sweep.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const bases = { local: 'http://localhost:8080', prod: 'https://recipes.ai-commercestudio.com' };
const widths = [360, 375, 390, 430, 480, 560, 600, 768, 900, 1024, 1280, 1440];
fs.mkdirSync('/out/logo', { recursive: true });
const rows = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  for (const w of scheme === 'light' ? widths : [390, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const lang of ['bg', 'en']) {
      const r = { scheme, w, lang };
      for (const [k, b] of Object.entries(bases)) {
        if (k === 'prod' && scheme === 'dark') continue;
        await page.goto(`${b}/${lang}/`, { waitUntil: 'load' }); await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const mk = q('.brand-mark');
          return { h: Math.round(q('.site-header').getBoundingClientRect().height), ov: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            mark: mk ? `${Math.round(mk.getBoundingClientRect().width)}px/${mk.naturalWidth}` : '-' };
        });
        r[k] = m.h; if (k === 'local') { r.ov = m.ov; r.mark = m.mark; }
        if (k === 'local' && [360, 390, 768, 1440].includes(w)) await page.screenshot({ path: `/out/logo/header-${scheme}-${lang}-${w}.png`, clip: { x: 0, y: 0, width: w, height: Math.min(m.h + 8, 200) } });
      }
      rows.push(r);
    }
  }
  if (errors.length) console.log(scheme, 'конзола:', errors.slice(0, 3));
  await ctx.close();
}
console.table(rows);
await browser.close();
