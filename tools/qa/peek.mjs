// Екранна снимка на видимата част: node peek.mjs <път> <ширина> <scrollY|#id> <изход.png> [light|dark] [височина]
import { chromium } from 'playwright-core';
const [, , path = '/', width = '390', at = '0', out = 'peek.png', scheme = 'light', height = '844'] = process.argv;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: +width, height: +height }, colorScheme: scheme === 'dark' ? 'dark' : 'light', deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto((process.env.BASE || 'http://web:8080') + path, { waitUntil: 'load' });
if (scheme === 'print') await page.emulateMedia({ media: 'print' });
if (at === 'full') { await page.waitForTimeout(1500); await page.screenshot({ path: '/out/' + out, fullPage: true }); await browser.close(); process.exit(0); }
if (at.startsWith('#')) await page.locator(at).scrollIntoViewIfNeeded();
else await page.evaluate((y) => window.scrollTo(0, y), +at);
await page.waitForTimeout(1200);
await page.screenshot({ path: '/out/' + out });
await browser.close();
