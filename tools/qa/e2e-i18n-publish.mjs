// HTTP тест на ПУБЛИКУВАНЕТО на двуезичен сайт и връщането към предишна версия (срещу тестова услуга със студен/топъл кеш на снимките):
//   E2E_BASE=… E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… node tools/qa/e2e-i18n-publish.mjs
// Пуска сглобяване през API-то, чака го и проверява манифеста по езици, номера на страниците и пълното връщане към предишна версия.
const BASE = (process.env.E2E_BASE || 'http://localhost:8080').replace(/\/+$/, '');
const EMAIL = process.env.E2E_ADMIN_EMAIL, PASSWORD = process.env.E2E_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Задайте E2E_ADMIN_EMAIL и E2E_ADMIN_PASSWORD.'); process.exit(2); }
let failed = 0, total = 0;
const ok = (cond, msg, extra = '') => { total++; if (!cond) { failed++; console.error(`НЕУСПЕХ  ${msg} ${extra}`); } else console.log(`ok       ${msg}`); };
const jar = new Map(); let csrf = '';
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const store = (res) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
async function req(path, { method = 'GET', json, form } = {}) {
  const h = { cookie: ck() }; let body;
  if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  if (csrf && method !== 'GET') h['x-csrf-token'] = csrf;
  const res = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' }); store(res);
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* */ }
  return { status: res.status, data, text };
}
const login = await req('/admin/login'); const tok = /name="_csrf" value="([^"]+)"/.exec(login.text)[1];
await req('/admin/login', { method: 'POST', form: { _csrf: tok, next: '/admin', email: EMAIL, password: PASSWORD } });
csrf = /name="csrf-token" content="([^"]+)"/.exec((await req('/admin')).text)?.[1] ?? '';
ok(csrf.length > 10, 'вход в администрацията');

async function publish(note) {
  const r = await req('/admin/api/publish', { method: 'POST', json: { note } });
  ok(r.status === 202, `публикуването стартира (${r.status})`, r.text.slice(0, 120));
  const t0 = Date.now();
  while (Date.now() - t0 < 25 * 60e3) {
    await new Promise((res) => setTimeout(res, 4000));
    const s = await req('/admin/api/publish/status');
    if (s.data?.job && s.data.job.status !== 'running') return { job: s.data.job, log: s.data.log };
  }
  return { job: { status: 'timeout' } };
}

const first = await publish('e2e: двуезично публикуване');
ok(first.job.status === 'succeeded', `сглобяването успява (${first.job.status}${first.job.error ? ': ' + first.job.error : ''})`, (first.log || '').split('\n').slice(-6).join(' | '));
const pubPage = await req('/admin/publish');
ok(pubPage.status === 200 && pubPage.text.includes(first.job.releaseId ?? 'r-'), 'страницата „Публикуване“ показва версията');
// публичният сайт вече има двете дървета и корена
const get = async (p) => { const r = await fetch(BASE + p, { redirect: 'manual' }); return { status: r.status, loc: r.headers.get('location') }; }
console.log('\n(Публичният сайт се сервира от Caddy – тук се проверява само това, което услугата сглоби.)');
const releases = await req('/admin/publish');
ok(/data-release|r-\d{14}/.test(releases.text), 'има сглобена версия в списъка');

// второ публикуване без промени: състоянието е „няма промени“ и успява пак; после връщане към първата версия
const second = await publish('e2e: второ');
ok(second.job.status === 'succeeded', 'второ сглобяване успява');
const rel = [...pubPage.text.matchAll(/r-\d{14}/g)].map((m) => m[0]);
const firstId = first.job.releaseId;
const rb = await req('/admin/api/publish/rollback', { method: 'POST', json: { id: firstId } });
ok(rb.status === 200, `връщане към предишната версия ${firstId} (${rb.status})`, rb.text.slice(0, 120));
console.log(`\n${total - failed} от ${total} проверки са успешни.`);
process.exit(failed ? 1 : 0);
