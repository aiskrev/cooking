// Проверка на вътрешните връзки и ресурси в dist/: всяко href/src/srcset/data-* към собствения сайт трябва да сочи към съществуващ файл.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] || 'dist');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'pagefind') walk(p); }
    else if (e.name.endsWith('.html')) files.push(p);
  }
})(dist);

function exists(urlPath) {
  const clean = decodeURIComponent(urlPath.split('#')[0].split('?')[0]);
  const target = path.join(dist, clean);
  if (!target.startsWith(dist)) return false;
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return true;
  if (fs.existsSync(path.join(target, 'index.html'))) return true;
  return false;
}

let checked = 0;
const broken = [];
const ids = new Map();
const pageIds = (file) => {
  if (!ids.has(file)) ids.set(file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(file);
};
const fileFor = (urlPath) => {
  const clean = decodeURIComponent(urlPath.split('#')[0].split('?')[0]);
  const t = path.join(dist, clean);
  return fs.existsSync(t) && fs.statSync(t).isFile() ? t : path.join(t, 'index.html');
};

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const rel = '/' + path.relative(dist, f).replace(/\\/g, '/').replace(/index\.html$/, '');
  const refs = [];
  for (const m of html.matchAll(/\s(?:href|src|data-href)="([^"]*)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/\s(?:srcset|data-avif|data-webp|data-jpeg)="([^"]*)"/g)) {
    for (const part of m[1].split(',')) refs.push(part.trim().split(/\s+/)[0]);
  }
  for (let r of refs) {
    if (!r || r.startsWith('data:') || r.startsWith('mailto:') || r.startsWith('tel:') || r.startsWith('javascript:')) continue;
    if (/^https?:\/\//.test(r)) {
      try { const u = new URL(r); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !process.env.SITE_URL?.includes(u.hostname)) continue; r = u.pathname + u.hash; } catch { continue; }
    }
    checked++;
    if (r.startsWith('#')) {
      if (r.length > 1 && !pageIds(f).has(decodeURIComponent(r.slice(1)))) broken.push(`${rel}: котва ${r} липсва`);
      continue;
    }
    const abs = r.startsWith('/') ? r : new URL(r, 'http://x' + rel).pathname;
    if (!exists(abs)) { broken.push(`${rel}: ${r} -> липсва`); continue; }
    const hash = r.split('#')[1];
    if (hash && abs.endsWith('/') ) {
      const target = fileFor(abs);
      if (fs.existsSync(target) && !pageIds(target).has(decodeURIComponent(hash))) broken.push(`${rel}: ${r} – котвата #${hash} липсва`);
    }
  }
}
console.log(`Проверени ${files.length} HTML страници, ${checked} вътрешни връзки/ресурса.`);
if (broken.length) {
  console.error('СЧУПЕНИ ВРЪЗКИ:\n' + [...new Set(broken)].join('\n'));
  process.exit(1);
}
console.log('Няма счупени вътрешни връзки.');
