// Редактор на превода на английски: българският оригинал е отляво (само за четене), английският текст – отдясно.
// Числата, мерните единици, снимките и таксономията се вземат автоматично от оригинала; тук се редактира само текстът.
import { api, ApiError, toast, confirmDialog, el } from '/admin/assets/admin.js';

const P = JSON.parse(document.getElementById('page-data').textContent);
const root = document.getElementById('translation-root');
let M = null;      // отговор на API-то
let pay = null;    // редактируемият текст на превода (същият формат като translations/inbox/*.json)
let dirty = false;
let uid = 0;
const id = (p) => `${p}-${++uid}`;

const STATUS_OPTIONS = [
  ['draft', 'Чернова (не се публикува)'],
  ['needs-review', 'За преглед (не се публикува)'],
  ['ready', 'Готов за публикуване (още не е на сайта)'],
  ['published', 'Публикуван (английската страница се показва при следващото публикуване на сайта)'],
];

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
const mark = () => { dirty = true; };

// ---- Подготовка на текста за редактиране (всички полета от оригинала да имат място) ----
function initPayload() {
  const src = M.source;
  const cur = M.translation?.payload ?? {};
  const p = {};
  for (const k of ['title', 'description', 'intro', 'context', 'technique', 'temperature', 'balance', 'plating', 'serving', 'storage']) {
    if (k === 'title' || k === 'description' || src[k] !== undefined) p[k] = cur[k] ?? '';
  }
  for (const k of ['mise', 'tips', 'mistakes', 'substitutions']) if (src[k]?.length) p[k] = src[k].map((_, i) => cur[k]?.[i] ?? '');
  p.ingredients = (src.ingredients ?? []).map((g, gi) => {
    const cg = cur.ingredients?.[gi] ?? {};
    const out = { items: g.items.map((it, ii) => { const ci = cg.items?.[ii] ?? {}; const o = { name: ci.name ?? '' }; if (it.note !== undefined) o.note = ci.note ?? ''; return o; }) };
    if (g.title !== undefined) out.title = cg.title ?? '';
    return out;
  });
  p.steps = (src.steps ?? []).map((s, i) => {
    const cs = cur.steps?.[i] ?? {}; const o = {};
    for (const k of ['title', 'text', 'why', 'cue', 'avoid']) if (k === 'text' || s[k] !== undefined) o[k] = cs[k] ?? '';
    return o;
  });
  p.photos = {};
  for (const [f, m] of Object.entries(src.photos ?? {})) { const cp = cur.photos?.[f] ?? {}; p.photos[f] = { alt: cp.alt ?? '' }; if (m.caption !== undefined) p.photos[f].caption = cp.caption ?? ''; }
  pay = p;
}

// ---- Градивни елементи ----
function row(label, srcText, input, hint) {
  const i = input.id || (input.id = id('t'));
  return el('div', { class: 'tr-row' },
    el('div', { class: 'tr-src', lang: 'bg' }, el('span', { class: 'tr-lbl' }, label), srcText ? el('p', {}, srcText) : el('p', { class: 'muted' }, '—')),
    el('div', { class: 'field tr-dst', lang: 'en' }, el('label', { for: i }, `${label} (English)`), input, hint ? el('div', { class: 'hint' }, hint) : null));
}
function bind(obj, key, { rows = 0, maxlength } = {}) {
  const n = rows ? el('textarea', { rows, maxlength }) : el('input', { type: 'text', maxlength });
  n.value = obj[key] ?? '';
  n.addEventListener('input', () => { obj[key] = n.value; mark(); });
  return n;
}
const rowsFor = (s) => Math.min(8, Math.max(2, Math.ceil(String(s ?? '').length / 70)));
const section = (title, ...kids) => el('section', { class: 'card tr-section' }, el('h2', {}, title), ...kids);

// ---- Зареждане и показване ----
async function load() {
  try {
    M = await api(`/admin/api/recipes/${P.slug}/translation`, { method: 'GET' });
  } catch (e) { root.replaceChildren(el('div', { class: 'notice bad', role: 'alert' }, e.message)); return; }
  render();
}

function applyModel(m) { M = m; render(); }

function render() {
  root.replaceChildren();
  const info = M.info;
  if (!M.translation) {
    root.append(el('div', { class: 'card' },
      el('h2', {}, 'Още няма превод на английски'),
      el('p', {}, 'Чернова на превода ще копира структурата на рецептата (съставки, стъпки, снимки, числа и категории). Текстовете остават празни, докато ги въведете. Преводът не се публикува, докато не го маркирате като „Публикуван“ и не публикувате сайта.'),
      el('button', { class: 'btn', type: 'button', onclick: createSkeleton }, 'Създай чернова на превода')));
    return;
  }
  initPayload();
  dirty = false;

  // --- състояние и проверка ---
  const status = el('div', { class: 'card', 'aria-labelledby': 'tr-h-status' }, el('h2', { id: 'tr-h-status' }, 'Състояние на превода'),
    el('p', {}, el('span', { class: 'badge ' + (info.state === 'published' ? 'ok' : 'warn') }, info.label), ' ',
      info.state === 'outdated' ? el('span', { class: 'muted' }, 'Оригиналът е променен след последния превод.') : null));
  if (info.state === 'outdated') {
    status.append(el('div', { class: 'notice warn', role: 'status' },
      el('strong', {}, 'Преводът може да е остарял. '), 'Прегледайте разликите (оригиналът е отляво), поправете английския текст и го запазете – или потвърдете, че преводът остава верен.',
      el('div', { class: 'btn-row', style: 'margin-top:.5rem' }, el('button', { class: 'btn secondary small', type: 'button', onclick: approve }, 'Преводът е актуален'))));
  }
  const all = [...info.errors];
  status.append(all.length
    ? el('details', { class: 'tr-errors', open: true }, el('summary', {}, `Проверка на превода: ${all.length} забележки`), el('ul', {}, all.slice(0, 80).map((m) => el('li', {}, m))))
    : el('p', { class: 'muted' }, 'Проверката на двойката BG/EN не откри грешки.'));
  if (info.warnings.length) status.append(el('ul', { class: 'muted small' }, info.warnings.map((m) => el('li', {}, m))));
  if (info.unmapped.length) {
    status.append(el('div', { class: 'notice warn' }, el('strong', {}, 'Липсват английски етикети в речника: '), 'добавете ги, за да може преводът да се публикува.'));
    for (const u of info.unmapped) {
      const inp = el('input', { type: 'text', maxlength: 120, 'aria-label': `Английски етикет за „${u.value}“` });
      status.append(el('div', { class: 'tr-term' }, el('span', { lang: 'bg' }, `${u.group}: „${u.value}“ →`), inp,
        el('button', { class: 'btn small secondary', type: 'button', onclick: async () => {
          try { await api('/admin/api/taxonomy/translate', { json: { group: u.group, value: u.value, label: inp.value } }); toast('Етикетът е записан.'); await load(); } catch (e) { toast(e.message, true); }
        } }, 'Запази етикета')));
    }
  }
  root.append(status);

  const src = M.source, sd = M.sourceData;

  // --- основни текстове ---
  const basic = section('Заглавие и описание');
  for (const [k, label, max] of [['title', 'Заглавие'], ['description', 'Описание', 240], ['intro', 'Въведение'], ['context', 'Бележка / контекст']]) {
    if (k !== 'title' && k !== 'description' && src[k] === undefined) continue;
    basic.append(row(label, src[k], bind(pay, k, { rows: k === 'title' ? 0 : rowsFor(src[k]), maxlength: max }), max ? `Най-много ${max} знака.` : null));
  }
  root.append(basic);

  // --- числа и таксономия (само за четене) ---
  const t = M.translation.taxonomy;
  root.append(section('Автоматично от оригинала (не се редактира тук)',
    el('p', { class: 'muted' }, 'Порции, времена, количества, снимки, категория, етикети и алергени са общи за двата езика и се вземат от оригинала. Английските имена на категориите и етикетите са в речника на таксономията.'),
    el('dl', { class: 'tr-auto' },
      el('div', {}, el('dt', {}, 'Категория'), el('dd', {}, `${sd.category} → ${t.category ?? '—'}`)),
      el('div', {}, el('dt', {}, 'Начин на готвене'), el('dd', {}, sd.method.map((m, i) => `${m} → ${t.method[i] ?? '—'}`).join('; ') || '—')),
      el('div', {}, el('dt', {}, 'Кухня'), el('dd', {}, sd.cuisine ? `${sd.cuisine} → ${t.cuisine || '—'}` : '—')),
      el('div', {}, el('dt', {}, 'Трудност'), el('dd', {}, sd.difficulty ? `${sd.difficulty} → ${t.difficulty || '—'}` : '—')),
      el('div', {}, el('dt', {}, 'Етикети'), el('dd', {}, sd.tags.map((m, i) => `${m} → ${t.tags[i] ?? '—'}`).join('; ') || '—')),
      el('div', {}, el('dt', {}, 'Алергени'), el('dd', {}, sd.allergens.map((m, i) => `${m} → ${t.allergens[i] ?? '—'}`).join('; ') || '—')),
      el('div', {}, el('dt', {}, 'Порции / време'), el('dd', {}, `${sd.servings} · ${sd.prepTime}+${sd.cookTime}+${sd.restTime} мин`)))));

  // --- техника ---
  const chefKeys = [['technique', 'Основна техника'], ['temperature', 'Контрол на температурата'], ['balance', 'Консистенция, текстура и баланс на вкуса']].filter(([k]) => src[k] !== undefined);
  if (chefKeys.length) root.append(section('Техника и контрол', ...chefKeys.map(([k, l]) => row(l, src[k], bind(pay, k, { rows: rowsFor(src[k]) })))));

  // --- mise en place ---
  if (src.mise?.length) root.append(section('Mise en place', ...src.mise.map((s, i) => row(`Ред ${i + 1}`, s, bind(pay.mise, i, { rows: rowsFor(s) })))));

  // --- съставки ---
  const ing = section('Съставки', el('p', { class: 'muted' }, 'Количествата и мерните единици (напр. г → g, с. л. → tbsp) се пренасят автоматично.'));
  (src.ingredients ?? []).forEach((g, gi) => {
    if (g.title !== undefined) ing.append(el('h3', {}, 'Група'), row('Заглавие на групата', g.title, bind(pay.ingredients[gi], 'title')));
    g.items.forEach((it, ii) => {
      const sdIt = sd.ingredients[gi]?.items?.[ii];
      const amt = typeof sdIt === 'object' ? [sdIt.amount, sdIt.unit].filter((x) => x !== undefined && x !== '').join(' ') : '';
      const en = M.translation.units[gi]?.[ii];
      const hint = amt ? `Автоматично: ${amt}${en ? ` → ${en}` : ''}` : null;
      ing.append(row(`Съставка${amt ? ` (${amt})` : ''}`, it.name, bind(pay.ingredients[gi].items[ii], 'name', {}), hint));
      if (it.note !== undefined) ing.append(row('Уточнение', it.note, bind(pay.ingredients[gi].items[ii], 'note', {})));
    });
  });
  root.append(ing);

  // --- стъпки ---
  const steps = section('Приготвяне');
  (src.steps ?? []).forEach((s, i) => {
    steps.append(el('h3', {}, `Стъпка ${i + 1}`));
    for (const [k, l, big] of [['title', 'Заглавие'], ['text', 'Текст', true], ['why', 'Защо'], ['cue', 'Как разбираш, че е готово'], ['avoid', 'Избягвай']]) {
      if (k !== 'text' && s[k] === undefined) continue;
      steps.append(row(l, s[k], bind(pay.steps[i], k, { rows: big ? rowsFor(s[k]) : k === 'title' ? 0 : rowsFor(s[k]) })));
    }
  });
  root.append(steps);

  // --- съвети, грешки, заместители ---
  for (const [k, l] of [['tips', 'Съвети'], ['mistakes', 'Чести грешки'], ['substitutions', 'Заместители']]) {
    if (src[k]?.length) root.append(section(l, ...src[k].map((s, i) => row(`${l} ${i + 1}`, s, bind(pay[k], i, { rows: rowsFor(s) })))));
  }
  const serveKeys = [['plating', 'Поднасяне в чиния'], ['serving', 'Сервиране'], ['storage', 'Съхранение и претопляне']].filter(([k]) => src[k] !== undefined);
  if (serveKeys.length) root.append(section('Поднасяне', ...serveKeys.map(([k, l]) => row(l, src[k], bind(pay, k, { rows: rowsFor(src[k]) })))));

  // --- снимки ---
  const photos = Object.entries(src.photos ?? {});
  if (photos.length) {
    const sec = section(`Снимки (${photos.length})`, el('p', { class: 'muted' }, 'Описанията (alt) се четат от екранни четци; подписите се виждат под снимките. Самите снимки са общи за двата езика.'));
    for (const [f, m] of photos) {
      sec.append(el('div', { class: 'tr-photo' }, el('img', { src: `/admin/media/thumb/${encodeURIComponent(P.slug)}/${encodeURIComponent(f)}`, alt: '', loading: 'lazy', width: 120 }),
        el('div', {}, el('code', {}, f),
          row('Описание (alt)', m.alt, bind(pay.photos[f], 'alt', { rows: 2 })),
          m.caption !== undefined ? row('Подпис', m.caption, bind(pay.photos[f], 'caption', {})) : null)));
    }
    root.append(sec);
  }

  // --- запис ---
  const meta = M.translation.meta;
  const sel = el('select', { id: 'tr-status' }, STATUS_OPTIONS.map(([v, l]) => el('option', { value: v }, l)));
  sel.value = meta.status ?? 'draft';
  const rev = el('input', { type: 'checkbox', id: 'tr-reviewed' }); rev.checked = !!meta.reviewed;
  const saveBtn = el('button', { class: 'btn', type: 'button', onclick: () => save(sel.value, rev.checked) }, 'Запази превода');
  if (P.building) { saveBtn.disabled = true; }
  root.append(el('div', { class: 'card tr-save' },
    el('div', { class: 'field' }, el('label', { for: 'tr-status' }, 'Статус на превода'), sel,
      el('div', { class: 'hint' }, 'Английската страница се показва само при статус „Публикуван“ и след публикуване на сайта. Българският оригинал се публикува независимо.')),
    el('label', { class: 'check' }, rev, 'Преводът е прегледан от автора (скрива бележката „преведено с помощта на ИИ“ на английската страница)'),
    el('div', { class: 'btn-row' }, saveBtn, el('a', { class: 'btn ghost', href: `/admin/recipes/${encodeURIComponent(P.slug)}/preview?lang=en`, target: '_blank', rel: 'noopener' }, 'Преглед на английската версия')),
    P.building ? el('p', { class: 'notice warn' }, 'Тече публикуване на сайта – записът е временно заключен.') : null));
}

// ---- Действия ----
async function createSkeleton() {
  try { const m = await api(`/admin/api/recipes/${P.slug}/translation`, { json: {} }); toast('Създадена е чернова на превода.'); applyModel(m); }
  catch (e) { toast(e.message, true); }
}

async function approve() {
  if (!(await confirmDialog('Преводът остава верен, въпреки промените в оригинала?', { ok: 'Да, актуален е' }))) return;
  try { applyModel(await api(`/admin/api/recipes/${P.slug}/translation/approve`, { json: {} })); toast('Преводът е отбелязан като актуален.'); }
  catch (e) { toast(e.message, true); }
}

async function save(status, reviewed) {
  try {
    const m = await api(`/admin/api/recipes/${P.slug}/translation`, { method: 'PUT', json: { payload: pay, status, reviewed, expectedMtime: M.translation?.mtime } });
    dirty = false; toast(status === 'published' ? 'Преводът е запазен като публикуван. Публикувайте сайта, за да се покаже.' : 'Преводът е запазен.');
    applyModel(m);
  } catch (e) {
    if (e instanceof ApiError && e.data?.conflict) {
      if (await confirmDialog('Преводът е променен от друго място. Да презапиша ли с вашата версия?', { ok: 'Презапиши', danger: true })) {
        try { applyModel(await api(`/admin/api/recipes/${P.slug}/translation`, { method: 'PUT', json: { payload: pay, status, reviewed, force: true } })); dirty = false; toast('Преводът е запазен.'); } catch (e2) { toast(e2.message, true); }
      }
      return;
    }
    const list = e.data?.errors?.length ? ` (${e.data.errors.slice(0, 3).join('; ')}${e.data.errors.length > 3 ? ' …' : ''})` : '';
    toast(e.message + list, true);
  }
}

load();
