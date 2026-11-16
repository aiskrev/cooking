// Екранни снимки на 5 ширини, проверка за хоризонтално преливане, конзолни/CSP грешки,
// лайтбокс, търсене, тема, печатен изглед и axe (достъпност).
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

const BASE = process.env.BASE || 'http://web:8080';
const OUT = '/out';
fs.mkdirSync(OUT, { recursive: true });
const widths = [360, 390, 768, 1024, 1440];
const pages = {
  home: '/',
  recipe: '/recepti/pylneni-chushki-s-kayma-i-oriz/',
  list: '/recepti/',
  categories: '/kategorii/',
  category: '/kategorii/osnovni-yastiya/',
  tag: '/etiketi/chushki/',
  search: '/tursene/',
  notfound: '/nqma-takava/',
};
const results = [];
const log = (ok, msg) => {
  results.push({ ok, msg });
  console.log((ok ? 'OK   ' : 'FAIL ') + msg);
};

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });

// ---- 1. Ширини, преливане, конзола ----
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light', locale: 'bg-BG' });
  for (const [name, p] of Object.entries(pages)) {
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => {
      if (['error', 'warning'].includes(m.type()) && !(name === 'notfound' && /404/.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
    page.setDefaultTimeout(20000);
    const resp = await page.goto(BASE + p, { waitUntil: 'load' });
    const expected = name === 'notfound' ? 404 : 200;
    if (resp.status() !== expected) problems.push(`HTTP ${resp.status()}`);
    // скролваме до дъното, за да се заредят ленивите снимки
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      window.scrollTo(0, 0);
      await Promise.race([
        Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
      const pending = [...document.images].filter((i) => !i.complete).map((i) => i.currentSrc || i.src);
      if (pending.length) console.log('  [не са заредени]', pending.join(', '));
    });
    const over = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad = [];
      if (document.documentElement.scrollWidth > vw) bad.push('scrollWidth ' + document.documentElement.scrollWidth + ' > ' + vw);
      for (const el of document.querySelectorAll('body *:not(.lqip)')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
          bad.push(el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
          if (bad.length > 4) break;
        }
      }
      return bad;
    });
    if (over.length) problems.push('преливане: ' + over.join('; '));
    if (name === 'recipe' || name === 'home') await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true });
    log(problems.length === 0, `${w}px ${name} ${p} ${problems.join(' | ')}`);
    await page.close();
  }
  await ctx.close();
}

// ---- 2. Лайтбокс (мобилен) ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + pages.recipe, { waitUntil: 'load' });
  const total = await page.locator('a[data-lightbox]').count();
  const uniq = await page.evaluate(() => new Set([...document.querySelectorAll('a[data-lightbox]')].map((a) => a.dataset.key)).size);
  const first = page.locator('a[data-lightbox]').first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  const dlg = page.locator('dialog.lightbox');
  log(await dlg.evaluate((d) => d.open), 'лайтбокс се отваря при клик/докосване');
  const c1 = await page.locator('.lb-count').textContent();
  log(c1.includes(`от ${uniq}`), `брояч: "${c1}" (уникални снимки: ${uniq}, връзки: ${total})`);
  await page.screenshot({ path: `${OUT}/lightbox-390.png` });
  await page.keyboard.press('ArrowRight');
  const c2 = await page.locator('.lb-count').textContent();
  log(c1 !== c2, `стрелка надясно сменя снимката: "${c2}"`);
  const cap = await page.locator('.lb-caption').textContent();
  log(cap.length > 3, `подпис: "${cap}"`);
  const imgSrc = await page.locator('.lb-picture img').evaluate((i) => i.currentSrc);
  log(/_astro\/.*\.(avif|webp|jpeg)/.test(imgSrc), `лайтбокс ползва оптимизиран файл: ${imgSrc.split('/').pop()}`);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  log(!(await dlg.evaluate((d) => d.open)), 'Esc затваря лайтбокса');
  const focusOk = await page.evaluate(() => document.activeElement?.matches('a[data-lightbox]'));
  log(focusOk, 'фокусът се връща върху снимката');
  await first.click();
  await page.locator('.lb-next').click();
  log((await page.locator('.lb-count').textContent()).includes('2'), 'бутон „следваща“ работи');
  await page.locator('.lb-close').click();
  await ctx.close();
}

// ---- 3. Търсене ----
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  await page.goto(BASE + '/tursene/', { waitUntil: 'load' });
  await page.fill('#q', 'чушки');
  await page.waitForSelector('.result', { timeout: 8000 }).catch(() => {});
  const n = await page.locator('.result').count();
  log(n >= 1 && errs.length === 0, `търсене „чушки“: ${n} резултат(а) ${errs.join('|')}`);
  await page.screenshot({ path: `${OUT}/search-1024.png` });
  await page.fill('#q', 'нищонямаготово');
  await page.waitForTimeout(800);
  log((await page.locator('#search-status').textContent()).includes('Няма резултати'), 'търсене без резултат показва съобщение');
  await ctx.close();
}

// ---- 4. Тема + печат ----
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(BASE + pages.recipe, { waitUntil: 'load' });
  await page.click('[data-theme-toggle]');
  log((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'превключвател на тема → тъмна');
  await page.screenshot({ path: `${OUT}/recipe-dark-1024.png`, fullPage: true });
  await page.reload({ waitUntil: 'load' });
  log((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'темата се помни след презареждане');
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${OUT}/recipe-print.pdf`, format: 'A4', printBackground: false });
  const hidden = await page.evaluate(() =>
    ['.site-header', '.site-footer', '.step-photo', '.actions'].map((s) => [s, [...document.querySelectorAll(s)].every((e) => getComputedStyle(e).display === 'none')]),
  );
  log(hidden.every(([, h]) => h), 'печат: скрити ' + hidden.map(([s]) => s).join(', '));
  await ctx.close();
}

// ---- 5. axe (с bypassCSP, за да се инжектира скриптът) ----
{
  const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, bypassCSP: true });
    for (const [name, p] of Object.entries(pages)) {
      const page = await ctx.newPage();
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.evaluate(axeSrc);
      const r = await page.evaluate(() =>
        axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }),
      );
      log(r.violations.length === 0, `axe ${scheme} ${name}: ${r.violations.length} нарушения ${r.violations.map((v) => v.id + '(' + v.nodes.length + ')').join(', ')}`);
      for (const v of r.violations) console.log('   ', v.id, v.help, v.nodes.slice(0, 2).map((n) => n.html.slice(0, 140)).join(' || '));
      await page.close();
    }
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nОБОБЩЕНИЕ: ${results.length - failed.length}/${results.length} проверки са успешни`);
process.exit(failed.length ? 1 : 0);
