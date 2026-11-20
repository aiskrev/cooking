// HTTP тест на администрацията за превода на английски (без браузър), срещу работеща услуга:
//   E2E_BASE=http://localhost:18090 E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… node tools/qa/e2e-i18n.mjs
// Създава нова рецепта, проверява редактора на превода, статусите, „остарял превод“, прегледа, достъпа без вход и публичния API.
// ВНИМАНИЕ: пише в съдържанието на услугата – пускайте само срещу тестова инсталация.
const BASE = (process.env.E2E_BASE || 'http://localhost:8080').replace(/\/+$/, '');
const EMAIL = process.env.E2E_ADMIN_EMAIL, PASSWORD = process.env.E2E_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Задайте E2E_ADMIN_EMAIL и E2E_ADMIN_PASSWORD.'); process.exit(2); }

let failed = 0, total = 0;
const ok = (cond, msg, extra = '') => { total++; if (!cond) { failed++; console.error(`НЕУСПЕХ  ${msg} ${extra}`); } else console.log(`ok       ${msg}`); };

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function store(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/max-age=0|expires=thu, 01 jan 1970/i.test(c)) jar.delete(k); else jar.set(k, v); } }
async function req(path, { method = 'GET', json, form, headers = {}, auth = true, redirect = 'manual' } = {}) {
  const h = { ...headers };
  if (auth && jar.size) h.cookie = cookieHeader();
  let body;
  if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  if (csrf && method !== 'GET' && !h['x-csrf-token'] && path.startsWith('/admin/api')) h['x-csrf-token'] = csrf;
  const res = await fetch(BASE + path, { method, headers: h, body, redirect });
  store(res);
  let data = null; const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (ct.includes('json')) { try { data = JSON.parse(text); } catch { /* */ } }
  return { status: res.status, data, text, headers: res.headers };
}
let csrf = '';

// ---- 1) без входа: преводът е недостъпен ----
for (const p of ['/admin/recipes/x/translation', '/admin/api/recipes/x/translation']) {
  const r = await req(p, { auth: false });
  ok([301, 302, 303, 307, 401].includes(r.status), `${p} без вход е отказан (${r.status})`);
}
{
  const r = await req('/admin/api/taxonomy/translate', { method: 'POST', json: { group: 'tag', value: 'x', label: 'y' }, auth: false });
  ok([301, 302, 303, 307, 401, 403].includes(r.status), `запис на речника без вход е отказан (${r.status})`);
}

// ---- 2) вход ----
{
  const page = await req('/admin/login', { auth: false });
  const token = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
  ok(!!token, 'формата за вход има CSRF токен');
  const r = await req('/admin/login', { method: 'POST', form: { _csrf: token, next: '/admin', email: EMAIL, password: PASSWORD }, auth: false, headers: { cookie: cookieHeader() } });
  ok(r.status === 302 || r.status === 303, `входът успява (${r.status})`);
  const dash = await req('/admin');
  ok(dash.status === 200, 'таблото се отваря със сесия');
  csrf = /name="csrf-token" content="([^"]+)"/.exec(dash.text)?.[1] ?? '';
  ok(csrf.length > 10, 'има CSRF токен за API');
}

// ---- 3) нова рецепта (само български) ----
const slug = 'e2e-prevod-' + Date.now().toString(36);
const bg = {
  title: 'Тестова супа за превод', description: 'Проста тестова супа, с достатъчно дълго описание, за проверка на превода.', collection: 'traditional', category: 'Супи', method: ['Варене'], tags: ['супа'], difficulty: 'лесна',
  prepTime: 5, cookTime: 15, restTime: 0, servings: 2, ingredients: [{ title: '', items: [{ name: 'вода', amount: 500, unit: 'мл', scale: true }, { name: 'сол', note: 'на вкус', scale: false }] }],
  steps: [{ title: 'Сварете', text: 'Сварете водата със солта.', time: 10 }, { title: 'Поднесете', text: 'Разсипете супата.' }], photos: {}, mise: ['Измерете водата.'], tips: ['Опитайте за сол.'], mistakes: [], substitutions: [], allergens: [],
};
{
  const r = await req('/admin/api/recipes', { method: 'POST', json: { slug, data: bg } });
  ok(r.status === 201, `създаване на рецепта „${slug}“ (${r.status})`, JSON.stringify(r.data)?.slice(0, 200));
}

// ---- 4) превод: няма -> чернова -> непълен -> пълен ----
let m = await req(`/admin/api/recipes/${slug}/translation`);
ok(m.status === 200 && m.data.translation === null && m.data.info.state === 'missing', 'преди превод: състояние „missing“');
ok(m.data.source.title === bg.title && m.data.source.steps.length === 2, 'в редактора е показан българският оригинал');
m = await req(`/admin/api/recipes/${slug}/translation`, { method: 'POST', json: {} });
ok(m.status === 201 && m.data.info.state === 'draft', 'създава се чернова на превода');
ok(m.data.translation.taxonomy.category === 'Soups' && m.data.translation.units[0][0] === 'ml', 'категорията и мерните единици са преведени автоматично');
m = await req(`/admin/api/recipes/${slug}/translation`, { method: 'POST', json: {} });
ok(m.status === 409, 'второ създаване се отказва');

let r = await req(`/admin/api/recipes/${slug}/translation`, { method: 'PUT', json: { payload: { title: 'Test soup' }, status: 'draft' } });
ok(r.status === 200 && r.data.info.errors.length > 0, 'непълна чернова се записва (с предупреждения)');
r = await req(`/admin/api/recipes/${slug}/translation`, { method: 'PUT', json: { payload: { title: 'Test soup' }, status: 'published' } });
ok(r.status === 422, 'непълен превод не може да е „публикуван“ (422)');
const full = {
  title: 'Test soup', description: 'A simple test soup with a description long enough for the translation check.',
  mise: ['Measure the water.'], tips: ['Taste for salt.'],
  ingredients: [{ items: [{ name: 'water' }, { name: 'salt', note: 'to taste' }] }],
  steps: [{ title: 'Boil', text: 'Boil the water with the salt.' }, { title: 'Serve', text: 'Ladle out the soup.' }],
};
r = await req(`/admin/api/recipes/${slug}/translation`, { method: 'PUT', json: { payload: full, status: 'published', reviewed: false } });
ok(r.status === 200 && r.data.info.state === 'published' && r.data.info.errors.length === 0, 'пълен превод се записва като „published“', JSON.stringify(r.data?.error ?? r.data?.errors));
ok(r.data.translation.payload.title === 'Test soup' && r.data.translation.payload.steps[0].text.startsWith('Boil'), 'преводът се връща след запис (запазва се и се презарежда)');

// ---- 5) защита: количества и таксономия не идват от клиента ----
r = await req(`/admin/api/recipes/${slug}/translation`, { method: 'PUT', json: { payload: { ...full, ingredients: [{ items: [{ name: 'water', amount: 9999, unit: 'kg' }, { name: 'salt', note: 'to taste' }] }], category: 'Hacked', tags: ['x'] }, status: 'published' } });
r = await req(`/admin/api/recipes/${slug}/translation`);
ok(r.data.translation.taxonomy.category === 'Soups', 'категорията не може да се подмени от клиента');
const prev = await req(`/admin/recipes/${slug}/preview?lang=en`);
ok(prev.status === 200 && prev.text.includes('<html lang="en">') && prev.text.includes('Boil the water with the salt.') && prev.text.includes('500 ml water'), 'прегледът на английската версия показва английски текст и количествата от оригинала');
ok(!/Сварете/.test(prev.text.replace(/<a href[^>]*>[^<]*<\/a>/g, '')), 'английският преглед не съдържа български текст на рецептата');
ok(prev.headers.get('cache-control')?.includes('no-store') && /noindex/.test(prev.text), 'прегледът е частен (no-store, noindex)');

// ---- 6) оригиналът се променя -> преводът е „остарял“; общите полета се пренасят ----
const cur = await req(`/admin/api/recipes/${slug}`);
const edited = { ...cur.data.data, servings: 6, steps: [{ title: 'Сварете', text: 'Сварете водата със солта и я оставете да къкри.', time: 10 }, { title: 'Поднесете', text: 'Разсипете супата.' }] };
r = await req(`/admin/api/recipes/${slug}`, { method: 'PUT', json: { data: edited, body: cur.data.body, expectedMtime: cur.data.mtime } });
ok(r.status === 200 && r.data.translation.translation === 'outdated', 'промяна в оригинала: преводът става „остарял“', JSON.stringify(r.data?.translation));
m = await req(`/admin/api/recipes/${slug}/translation`);
ok(m.data.info.state === 'outdated', 'редакторът на превода показва „остарял превод“');
const stat = await req(`/admin/api/recipes/${slug}/translation/status`, { method: 'POST', json: { status: 'published' } });
ok(stat.status === 409, 'остарял превод не може да се публикува, докато не бъде потвърден');
const appr = await req(`/admin/api/recipes/${slug}/translation/approve`, { method: 'POST', json: {} });
ok(appr.status === 200 && appr.data.info.state === 'published', 'потвърждението „преводът е актуален“ връща състоянието „published“');

// ---- 7) структурна промяна: нова стъпка връща публикувания превод „за преглед“ ----
const cur2 = await req(`/admin/api/recipes/${slug}`);
r = await req(`/admin/api/recipes/${slug}`, { method: 'PUT', json: { data: { ...cur2.data.data, steps: [...cur2.data.data.steps, { text: 'Вкусете.' }] }, body: cur2.data.body, expectedMtime: cur2.data.mtime } });
ok(r.status === 200 && r.data.translation.unpublished === true, 'нова стъпка в оригинала сваля превода от „публикуван“');
m = await req(`/admin/api/recipes/${slug}/translation`);
ok(m.data.info.status === 'needs-review', 'статусът е „за преглед“');

// ---- 8) ревизии и конфликт при едновременна редакция ----
const revs = await req(`/admin/api/recipes/${slug}/revisions`);
ok(revs.data.revisions.some((x) => x.action === 'translation') && revs.data.revisions.some((x) => x.action === 'save' || x.action === 'create'), 'историята пази и записите на превода, и на оригинала');
r = await req(`/admin/api/recipes/${slug}/translation`, { method: 'PUT', json: { payload: full, status: 'draft', expectedMtime: 1 } });
ok(r.status === 409 && r.data.conflict, 'остарял mtime при запис на превод -> конфликт (409)');

// ---- 9) списъци и страници на администрацията ----
const list = await req('/admin/recipes?q=' + encodeURIComponent(slug));
ok(list.status === 200 && list.text.includes('Превод (EN)') && list.text.includes(`/admin/recipes/${slug}/translation`), 'списъкът на рецептите има колона „Превод (EN)“');
const edit = await req(`/admin/recipes/${slug}/edit`);
ok(edit.status === 200 && edit.text.includes('class="lang-tabs"') && edit.text.includes('🇬🇧 English'), 'редакторът на оригинала има езикови табове');
const page = await req(`/admin/recipes/${slug}/translation`);
ok(page.status === 200 && page.text.includes('translation.js') && page.text.includes('aria-current="page"'), 'страницата на превода се зарежда и маркира активния таб');
const js = await req('/admin/assets/translation.js');
ok(js.status === 200 && /javascript/.test(js.headers.get('content-type') || ''), 'скриптът на редактора на превода се сервира');
ok((page.headers.get('content-security-policy') || '').includes("script-src 'self'"), 'политиката за съдържание остава строга (само собствени скриптове)');

// ---- 10) публичният API: общи оценки по идентификатор, съобщения на двата езика ----
const noAuthPub = async (p, init = {}) => { const res = await fetch(BASE + p, { redirect: 'manual', ...init }); return { status: res.status, data: await res.json().catch(() => null) }; };
let pub = await noAuthPub(`/api/public/recipes/${slug}/community`, { headers: { 'x-site-language': 'en' } });
ok(pub.status === 404 && pub.data?.error === 'The recipe was not found.', 'чернова не е публична; грешката е на английски при x-site-language: en');
pub = await noAuthPub(`/api/public/recipes/${slug}/community`, { headers: { 'x-site-language': 'bg' } });
ok(pub.status === 404 && pub.data?.error === 'Рецептата не е намерена.', 'същата грешка е на български при bg');
pub = await noAuthPub(`/api/public/recipes/${slug}/community`, { headers: { 'x-site-language': '../../etc/passwd' } });
ok(pub.status === 404 && pub.data?.error === 'Рецептата не е намерена.', 'непознат език се игнорира (основният език)');
pub = await noAuthPub(`/api/public/recipes/${slug}/rating`, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-site-language': 'en' }, body: '{}' });
ok(pub.status === 415 && pub.data?.error === 'JSON is expected.', 'API-то остава защитено (415 без application/json) и отговаря на английски');
pub = await noAuthPub(`/api/public/recipes/${slug}/rating`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' }, body: '{"score":5}' });
ok(pub.status === 403, 'чужд произход се отказва (403)');

// ---- 11) чернова не изтича на публичната страница; резервен ред: публикуваният превод не пуска оригинал в чернова ----
r = await req(`/admin/api/recipes/${slug}/state`, { method: 'POST', json: { publication: 'draft' } });
ok(r.status === 200, 'рецептата остава чернова (не е публикувана на сайта)');

// ---- чистене ----
r = await req(`/admin/api/recipes/${slug}`, { method: 'DELETE', json: { confirm: slug } });
ok(r.status === 200, 'тестовата рецепта е изтрита (отива в кошчето)');
console.log(`\n${total - failed} от ${total} проверки са успешни.`);
process.exit(failed ? 1 : 0);
