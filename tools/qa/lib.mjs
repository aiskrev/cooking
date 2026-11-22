// Общи помощници за браузърните тестове: резултати, влизане в администрацията, генериране на тестови снимки (без външни файлове).
import { chromium } from 'playwright-core';
import zlib from 'node:zlib';

export const BASE = process.env.BASE || 'http://localhost:8080';
export const EMAIL = process.env.E2E_ADMIN_EMAIL || '';
export const PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';

export const results = [];
export function log(ok, msg) {
  results.push({ ok, msg });
  console.log((ok ? '  ✔ ' : '  ✘ ') + msg);
}
export function summary(title) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${title}: ${results.length - failed.length}/${results.length} проверки са успешни`);
  for (const f of failed) console.log('  НЕУСПЕХ: ' + f.msg);
  return failed.length;
}
export const expect = (cond, msg) => log(!!cond, msg);

export async function launch() {
  return chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
}

/** Нов контекст със събиране на грешки от конзолата и неуспешни заявки. */
export async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'bg-BG', ...opts });
  const page = await ctx.newPage();
  page.problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) page.problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => page.problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || '')) page.problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/') && r.status() !== 401 && r.status() !== 403 && r.status() !== 429) page.problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return { ctx, page };
}

export async function login(page, { email = EMAIL, password = PASSWORD } = {}) {
  await page.goto(BASE + '/admin/login', { waitUntil: 'load' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForLoadState('load'), page.click('button[type=submit]')]);
}

// ---- PNG без външни библиотеки (за тестове за качване) ----
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
}
/** Цветен градиент с „шум“, различен за всеки seed (за да не се счита за дубликат). */
export function makePng(width, height, seed = 1) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255 / width + seed * 37) & 255;
      raw[o + 1] = (y * 255 / height + seed * 91) & 255;
      raw[o + 2] = ((x ^ y) * (seed + 1) + seed * 53) & 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Натиска „Публикувай сайта“ и чака НОВА задача да приключи (не предишната). Връща {status, error?}. */
export async function publishAndWait(page, timeoutMs = 25 * 60 * 1000) {
  const getJob = async () => { try { return await page.evaluate(async () => (await (await fetch('/admin/api/publish/status', { credentials: 'same-origin' })).json()).job); } catch { return undefined; } };
  const before = (await getJob())?.id ?? 0;
  await page.locator('[data-publish-start]').click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Публикувай' }).click();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.waitForTimeout(3000);
    const j = await getJob();
    if (j && j.id > before && j.status !== 'running') return j;
    if (Date.now() > deadline) return { status: 'timeout' };
  }
}

// ---- Профили на посетителите (локален режим: писмата са файлове в /cmsdata/outbox – томът cms-data, само за четене) ----
import fs from 'node:fs';
export const OUTBOX = '/cmsdata/outbox';
export const tokenIn = (text) => /#token=([A-Za-z0-9_-]+)/.exec(text || '')?.[1];
/** Последното писмо до адреса след момента since (чака до ~10 секунди). */
export async function waitMail(email, since) {
  for (let i = 0; i < 40; i++) {
    const files = fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.json')).sort().reverse() : [];
    for (const f of files) {
      if (Number(f.split('-')[0]) < since) break;
      const m = JSON.parse(fs.readFileSync(`${OUTBOX}/${f}`, 'utf8'));
      if (m.to === email) return m.text;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
/** Нов потвърден профил през API (без интерфейса) и вход в браузъра. */
export async function newMember(browser, { email, name, password, opts = {} }) {
  const { ctx, page } = await newPage(browser, opts);
  const since = Date.now() - 1000;
  await ctx.request.post(BASE + '/api/account/register', { data: { email, password, displayName: name, locale: 'bg', acceptTerms: true } });
  const token = tokenIn(await waitMail(email, since));
  await ctx.request.post(BASE + '/api/account/verify', { data: { token } });
  const r = await ctx.request.post(BASE + '/api/account/login', { data: { email, password } });
  return { ctx, page, ok: r.ok() && !!token };
}
