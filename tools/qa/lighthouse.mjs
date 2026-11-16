// Lighthouse (мобилен профил по подразбиране) за няколко страници; печата точните резултати.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://web:8080';
const pages = {
  home: '/',
  recipe: '/recepti/pylneni-chushki-s-kayma-i-oriz/',
  list: '/recepti/',
  search: '/tursene/',
};
const runs = Number(process.env.RUNS || 3);
fs.mkdirSync('/out/lighthouse', { recursive: true });
const rows = [];
for (const [name, p] of Object.entries(pages)) {
  for (let i = 1; i <= runs; i++) {
    const file = `/out/lighthouse/${name}-${i}.json`;
    execFileSync(
      'npx',
      ['lighthouse', BASE + p, '--quiet', '--output=json', `--output-path=${file}`, '--chrome-flags=--headless=new --no-sandbox --disable-gpu', '--only-categories=performance,accessibility,best-practices,seo'],
      { stdio: ['ignore', 'ignore', 'inherit'], env: process.env },
    );
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sc = (k) => Math.round(j.categories[k].score * 100);
    const a = j.audits;
    rows.push({
      page: name,
      run: i,
      perf: sc('performance'),
      a11y: sc('accessibility'),
      bp: sc('best-practices'),
      seo: sc('seo'),
      lcp: Math.round(a['largest-contentful-paint'].numericValue),
      cls: +a['cumulative-layout-shift'].numericValue.toFixed(3),
      tbt: Math.round(a['total-blocking-time'].numericValue),
      kb: Math.round(a['total-byte-weight'].numericValue / 1024),
      form: j.configSettings.formFactor,
      ua: j.environment.hostUserAgent.slice(0, 70),
    });
    const bad = Object.values(j.audits).filter(
      (x) => x.score !== null && ((x.scoreDisplayMode === 'binary' && x.score < 1) || (x.scoreDisplayMode === 'numeric' && x.score < 0.9)),
    );
    console.log(JSON.stringify(rows[rows.length - 1]));
    if (bad.length) console.log('   непълни одити:', bad.map((x) => `${x.id}=${x.score}`).join(', '));
  }
}
console.table(rows.map(({ ua, ...r }) => r));
console.log('Профил:', rows[0].form, '|', rows[0].ua);
