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
const RECIPE = process.env.RECIPE || '/bg/recepti/banitsa-sas-sirene/';
const pages = {
  home: '/',
  recipe: RECIPE,
  recipe2: '/bg/recepti/beef-wellington/',
  recipe3: '/bg/recepti/pylneni-chushki-s-kayma-i-oriz/',
  list: '/bg/recepti/',
  shopping: '/bg/spisak/',
  categories: '/bg/kategorii/',
  category: '/bg/kategorii/osnovni-yastiya/',
  tag: '/bg/etiketi/chushki/',
  search: '/bg/tursene/',
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
      for (let y = 0; y < document.body.scrollHeight; y += 350) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 110));
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
        if (el.closest('.story-track, .journey-strip')) continue; // нарочно хоризонтално превъртане
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
          bad.push(el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
          if (bad.length > 4) break;
        }
      }
      return bad;
    });
    if (over.length) problems.push('преливане: ' + over.join('; '));
    if (['recipe', 'home', 'list', 'recipe2'].includes(name)) await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true });
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
  await page.goto(BASE + '/bg/tursene/', { waitUntil: 'load' });
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

// ---- 4б. Порции, списък за пазаруване, режим „готвене“, фото-история, филтри ----
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + pages.recipe, { waitUntil: 'load' });
  const first = page.locator('[data-ing][data-scale="y"] .ing-text').first();
  const before = (await first.textContent()).trim();
  await page.click('[data-plus]');
  await page.click('[data-plus]');
  const after = (await first.textContent()).trim();
  const serv = await page.locator('[data-servings]').textContent();
  log(before !== after, `порции ${serv}: „${before}“ → „${after}“`);
  const salt = page.locator('[data-ing][data-scale="n"] .ing-text').first();
  if (await salt.count()) { const s1 = await salt.textContent(); await page.click('[data-plus]'); log(s1 === (await salt.textContent()), `непреоразмеряем ред остава: „${s1.trim()}“`); }
  await page.click('[data-reset]');
  log((await first.textContent()).trim() === before, 'връщане към началните порции');
  await page.click('[data-add-list]');
  const st = await page.locator('[data-tools-status]').textContent();
  log(/Добавени са \d+/.test(st), `списък: ${st}`);
  await page.goto(BASE + '/bg/spisak/', { waitUntil: 'load' });
  const n = await page.locator('.shop-list .ing-list li').count();
  log(n > 0, `страница „Списък“: ${n} съставки`);
  await page.screenshot({ path: `${OUT}/shopping-1024.png` });
  // режим „готвене“
  await page.goto(BASE + pages.recipe, { waitUntil: 'load' });
  await page.click('[data-cook-open]');
  const cook = page.locator('dialog.cook');
  log(await cook.evaluate((d) => d.open), 'режим „готвене“ се отваря');
  const p1 = await page.locator('.ck-progress').textContent();
  await page.keyboard.press('ArrowRight');
  const p2 = await page.locator('.ck-progress').textContent();
  log(p1 !== p2, `стъпки: „${p1}“ → „${p2}“`);
  await page.click('.ck-ing-toggle');
  log((await page.locator('.ck-ings li').count()) > 0, 'съставки в режим „готвене“');
  // таймер: намери стъпка с време
  let timerSeen = false;
  for (let i = 0; i < 12 && !timerSeen; i++) { if (await page.locator('.ck-timer').isVisible()) timerSeen = true; else await page.keyboard.press('ArrowRight'); }
  if (timerSeen) { const c1 = await page.locator('.ck-clock').textContent(); await page.click('.ck-start'); await page.waitForTimeout(2200); const c2 = await page.locator('.ck-clock').textContent(); log(/^\d\d:\d\d$/.test(c1) && /^\d\d:\d\d$/.test(c2) && c1 !== c2, `таймер: ${c1} → ${c2}`); } else log(false, "няма стъпка с таймер");
  await page.screenshot({ path: `${OUT}/cooking-mode-1024.png` });
  await page.keyboard.press('Escape');
  log(!(await cook.evaluate((d) => d.open)), 'режим „готвене“ се затваря с Esc');
  // фото-история
  const slides = await page.locator('.story-slide').count();
  log(slides >= 5 && slides <= 10, `фото-история: ${slides} кадъра`);
  await page.locator('.story').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/story-1024.png` });
  // лайтбокс от фото-историята
  await page.locator('.story-slide a[data-lightbox]').nth(2).click();
  await page.waitForTimeout(400);
  // отвореният кадър трябва да е същият като кликнатия: сравняваме подписа (номерът в галерията включва и корицата)
  const slideCap = (await page.locator('.story-slide figcaption').nth(2).textContent()).replace(/^\s*\d+\s*/, '').trim();
  const lbCap = (await page.locator('.lb-caption').textContent()).trim();
  log(lbCap === slideCap, `лайтбокс от фото-историята отваря кликнатия кадър: „${lbCap}“ (${await page.locator('.lb-count').textContent()})`);
  await page.screenshot({ path: `${OUT}/lightbox-1024.png` });
  await page.keyboard.press('Escape');
  // филтри
  await page.goto(BASE + '/bg/recepti/', { waitUntil: 'load' });
  const all = await page.locator('[data-count]').textContent();
  await page.selectOption('#f-collection', 'fine-dining');
  const fine = await page.locator('[data-count]').textContent();
  await page.fill('#f-q', 'патица');
  await page.waitForTimeout(400);
  const duck = await page.locator('[data-count]').textContent();
  log(+fine < +all && +duck >= 1, `филтри: всички ${all} → фино ядене ${fine} → „патица“ ${duck}`);
  await page.screenshot({ path: `${OUT}/catalogue-filtered-1024.png` });
  log(errs.length === 0, `без грешки в конзолата при взаимодействие ${errs.join(' | ')}`);
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
