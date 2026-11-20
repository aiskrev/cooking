// Проверка на пренасочванията от старите адреси към /bg/…: статус, цел, запазена заявка (?…), без вериги и без цикли.
//   node tools/qa/redirects.mjs http://localhost:8080
// Сървърът (Caddy, виж deploy/Caddyfile.*) връща 301; страницата не използва JavaScript за пренасочване.
const base = (process.argv[2] || 'http://localhost:8080').replace(/\/+$/, '');
let failed = 0, total = 0;
const ok = (cond, msg) => { total++; if (!cond) { failed++; console.error('НЕУСПЕХ  ' + msg); } else console.log('ok       ' + msg); };

async function hop(p) { const r = await fetch(base + p, { redirect: 'manual' }); return { status: r.status, loc: r.headers.get('location') }; }
async function chain(p) {
  const hops = []; let url = p;
  for (let i = 0; i < 6; i++) {
    const r = await hop(url);
    if (r.status >= 300 && r.status < 400) { hops.push([r.status, url, r.loc]); url = new URL(r.loc, base).pathname + new URL(r.loc, base).search; } else return { hops, final: { status: r.status, url } };
  }
  return { hops, final: { status: -1, url } };
}

const cases = [
  ['/', '/bg/'],
  ['/recepti/', '/bg/recepti/'],
  ['/recepti/tarator/', '/bg/recepti/tarator/'],
  ['/recepti/tarator/?x=1', '/bg/recepti/tarator/?x=1'],
  ['/kategorii/', '/bg/kategorii/'],
  ['/kategorii/osnovni-yastiya/', '/bg/kategorii/osnovni-yastiya/'],
  ['/etiketi/kebapcheta/', '/bg/etiketi/kebapcheta/'],
  ['/tursene/?q=%D0%BF%D0%B0%D1%82%D0%B8%D1%86%D0%B0', '/bg/tursene/?q=%D0%BF%D0%B0%D1%82%D0%B8%D1%86%D0%B0'],
  ['/lyubimi/', '/bg/lyubimi/'],
  ['/spisak/', '/bg/spisak/'],
  ['/rss.xml', '/bg/rss.xml'],
];
for (const [from, to] of cases) {
  const c = await chain(from);
  ok(c.hops.length === 1 && c.hops[0][0] === 301 && c.hops[0][2] === to, `${from} -> 301 ${to} (една стъпка)`);
  ok(c.final.status === 200, `${to} отговаря 200`);
}
// нови адреси не се пренасочват
for (const p of ['/bg/', '/en/', '/bg/recepti/tarator/', '/en/recipes/tarator/', '/en/search/', '/en/shopping-list/', '/en/favorites/', '/robots.txt', '/sitemap-index.xml', '/bg/rss.xml', '/en/rss.xml']) {
  const r = await hop(p); ok(r.status === 200, `${p} е 200 без пренасочване`);
}
// несъществуващи адреси и непознат език – 404, не пренасочване и не страница по подразбиране
for (const p of ['/fr/', '/de/recipes/', '/en/recipes/nqma-takava/', '/bg/recepti/nqma-takava/', '/recepti/nqma-takava/', '/en/recepti/tarator/', '/bg/recipes/tarator/']) {
  const c = await chain(p); ok(c.final.status === 404, `${p} -> ${c.final.status === 404 ? '404' : c.final.status + ' (' + c.hops.map((h) => h[2]).join(' → ') + ')'}`);
}
// без пътеки към администрацията през статичната част
for (const p of ['/admin', '/admin/', '/api/health']) { const r = await hop(p); ok(r.status !== 301 && r.status !== 302, `${p} не се пренасочва към езиковите адреси (${r.status})`); }
console.log(`\n${total - failed} от ${total} проверки са успешни.`);
process.exit(failed ? 1 : 0);
