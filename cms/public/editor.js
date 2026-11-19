// Редактор на рецепти: основни данни, съставки и стъпки с подреждане, снимки (качване, подреждане, изрязване), публикуване, ревизии.
import { api, ApiError, toast, confirmDialog, promptDialog, el } from '/admin/assets/admin.js';

const P = JSON.parse(document.getElementById('page-data').textContent);
const root = document.getElementById('editor-root');
const S = {
  slug: P.slug, isNew: P.isNew, d: structuredClone(P.model.data), body: P.model.body || '', files: [...P.files], mtime: P.model.mtime || 0,
  crops: P.crops || {}, revisions: P.revisions || [], siteState: P.siteState, dirty: false, v: Date.now(),
};
const ENUM = P.enums;

// ---- Привеждане на данните към очаквания от редактора вид ----
const arr = (k) => { if (!Array.isArray(S.d[k])) S.d[k] = []; return S.d[k]; };
['method', 'tags', 'mise', 'tips', 'mistakes', 'substitutions', 'allergens'].forEach(arr);
S.d.photos ||= {};
S.d.ingredients = (S.d.ingredients?.length ? S.d.ingredients : [{ title: '', items: [] }]).map((g) => ({
  title: g.title || '',
  items: (g.items || []).map((i) => (typeof i === 'string' ? { name: i, amount: '', unit: '', note: '', scale: false } : { name: i.name || '', amount: i.amount ?? '', unit: i.unit || '', note: i.note || '', scale: i.scale !== false && !!i.amount })),
}));
S.d.steps = (S.d.steps?.length ? S.d.steps : [{ title: '', text: '' }]).map((s) => ({ title: s.title || '', text: s.text || '', why: s.why || '', cue: s.cue || '', avoid: s.avoid || '', time: s.time || '', photo: s.photo || '' }));
S.d.date = String(S.d.date || '').slice(0, 10);

const markDirty = () => { S.dirty = true; };
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
const move = (a, from, to) => { if (to < 0 || to >= a.length || from === to) return; a.splice(to, 0, a.splice(from, 1)[0]); };

// ---- Малки градивни елементи ----
let uid = 0;
const id = (p) => `${p}-${++uid}`;
function field(label, input, hint) {
  const i = input.id || (input.id = id('f'));
  return el('div', { class: 'field' }, el('label', { for: i }, label), input, hint ? el('div', { class: 'hint' }, hint) : null);
}
function text(key, { type = 'text', list, maxlength, required, obj = S.d, placeholder } = {}) {
  const i = el('input', { type, value: obj[key] ?? '', list, maxlength, required, placeholder, ...(type === 'number' ? { min: '0' } : {}) });
  i.addEventListener('input', () => { obj[key] = i.value; markDirty(); });
  return i;
}
function area(key, { rows = 3, maxlength, obj = S.d } = {}) {
  const a = el('textarea', { rows, maxlength }); a.value = obj[key] ?? '';
  a.addEventListener('input', () => { obj[key] = a.value; markDirty(); });
  return a;
}
function select(key, options, { obj = S.d, empty } = {}) {
  const s = el('select', {}, empty != null ? el('option', { value: '' }, empty) : null, Object.entries(options).map(([v, l]) => el('option', { value: v }, l)));
  s.value = obj[key] ?? ''; s.addEventListener('change', () => { obj[key] = s.value; markDirty(); });
  return s;
}
function check(label, key, obj = S.d) {
  const c = el('input', { type: 'checkbox' }); c.checked = !!obj[key];
  c.addEventListener('change', () => { obj[key] = c.checked; markDirty(); });
  return el('label', { class: 'check' }, c, label);
}
function lines(label, key, hint) {
  const a = el('textarea', { rows: 4 }); a.value = S.d[key].join('\n');
  a.addEventListener('input', () => { S.d[key] = a.value.split('\n').map((x) => x.trim()).filter(Boolean); markDirty(); });
  return field(label, a, hint || 'По един ред за елемент.');
}
function chips(label, key, vocabList, hint) {
  const box = el('div', { class: 'field' });
  const dl = el('datalist', { id: id('dl') }, (vocabList || []).map((v) => el('option', { value: v.name })));
  const input = el('input', { type: 'text', list: dl.id, id: id('chip'), autocomplete: 'off' });
  const list = el('div', { class: 'chips' });
  const draw = () => {
    list.replaceChildren(...S.d[key].map((v, i) => el('span', { class: 'chip' }, v, el('button', { type: 'button', 'aria-label': `Премахни „${v}“`, onclick: () => { S.d[key].splice(i, 1); markDirty(); draw(); } }, '×'))));
  };
  const add = () => { const v = input.value.replace(/,/g, '').trim(); if (v && !S.d[key].includes(v)) { S.d[key].push(v); markDirty(); draw(); } input.value = ''; };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
  input.addEventListener('change', add);
  box.append(el('label', { for: input.id }, label), input, dl, list, hint ? el('div', { class: 'hint' }, hint) : null);
  draw(); return box;
}
function section(sid, title, ...kids) { return el('section', { class: 'card', id: sid, 'aria-labelledby': sid + '-h' }, el('h2', { id: sid + '-h' }, title), ...kids); }
const iconBtn = (label, symbol, fn, extra = {}) => el('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, onclick: fn, ...extra }, symbol);

/** Подреждане с влачене (мишка) и бутони ▲▼ (клавиатура/докосване). */
function sortable(container, scope, a, rerender) {
  [...container.children].forEach((item, idx) => {
    const handle = item.querySelector(':scope .handle');
    handle?.addEventListener('mousedown', () => { item.draggable = true; });
    // Вложени списъци (съставки в група): събитията се обработват само от най-вътрешния елемент, за да не се презапише „товарът“ на влаченето
    item.addEventListener('dragstart', (e) => { if (e.target !== item) return; e.stopPropagation(); e.dataTransfer.setData('application/x-sort', JSON.stringify({ scope, idx })); e.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); });
    item.addEventListener('dragend', (e) => { if (e.target !== item) return; item.draggable = false; item.classList.remove('dragging'); container.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
    item.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-sort')) { e.preventDefault(); e.stopPropagation(); item.classList.add('over'); } });
    item.addEventListener('dragleave', (e) => { if (e.target === item) item.classList.remove('over'); });
    item.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); item.classList.remove('over');
      let info; try { info = JSON.parse(e.dataTransfer.getData('application/x-sort')); } catch { return; }
      if (info.scope !== scope || info.idx === idx) return;
      move(a, info.idx, idx); markDirty(); rerender();
    });
  });
}

// ---------- Основни данни ----------
function basics() {
  const catDl = id('cats');
  const desc = text('description', { maxlength: 400 });
  const counter = el('span', { class: 'hint' }, '');
  const upd = () => { counter.textContent = `${desc.value.length} от 240 знака`; counter.style.color = desc.value.length > 240 ? 'var(--bad)' : ''; };
  desc.addEventListener('input', upd); upd();
  const slugInput = el('input', { type: 'text', id: id('slug'), placeholder: 'образува се от заглавието', pattern: '[a-z0-9]+(-[a-z0-9]+)*' });
  slugInput.addEventListener('input', () => { S.slugInput = slugInput.value; });
  return section('basics', 'Основни данни',
    field('Заглавие (на български)', text('title', { required: true, maxlength: 120 })),
    S.isNew ? field('Адрес (slug)', slugInput, 'Само малки латински букви, цифри и тирета. След създаването адресът не се променя (за да не се счупят връзките и оценките).') : el('p', { class: 'muted small' }, 'Адрес: ', el('code', {}, S.slug)),
    field('Кратко описание (до 240 знака)', desc, null), counter,
    field('Въведение', area('intro', { rows: 3 }), 'Две-три изречения за характера на ястието.'),
    el('div', { class: 'row' },
      field('Раздел', select('collection', ENUM.collections)),
      field('Категория (вид ястие)', Object.assign(text('category', { list: catDl }), {}), null),
      field('Трудност', select('difficulty', Object.fromEntries(ENUM.difficulties.map((x) => [x, x])), { empty: '— не е посочена —' })),
      field('Кухня', text('cuisine'))),
    el('datalist', { id: catDl }, (P.vocab.categories || []).map((v) => el('option', { value: v.name }))),
    chips('Начин на готвене (техника)', 'method', P.vocab.methods, 'Например: Печене, Задушаване. Натиснете Enter за добавяне.'),
    chips('Етикети', 'tags', P.vocab.tags),
    el('div', { class: 'row' }, field('Подготовка (мин)', text('prepTime', { type: 'number' })), field('Готвене (мин)', text('cookTime', { type: 'number' })), field('Почивка (мин)', text('restTime', { type: 'number' })), field('Порции', text('servings', { type: 'number' }))),
    el('div', { class: 'row' },
      field('Редакторски статус', select('status', ENUM.statuses)),
      el('div', {}, check('Покажи бележка „чернова/чака проверка“ на страницата', 'review'), check('Снимките са илюстративни (напр. генерирани с изкуствен интелект)', 'illustrative'), check('Препоръчана (показва се на началната страница)', 'featured'))),
    field('Контекст (регионален/културен, само ако е сигурен)', area('context', { rows: 2 })),
    chips('Алергени (редакционна индикация – не е проверена)', 'allergens'));
}

// ---------- Съставки ----------
const UNITS = ['г', 'кг', 'мл', 'л', 'бр.', 'с. л.', 'ч. л.', 'скилидки', 'глава', 'глави', 'връзка', 'щипка', 'шепа', 'стръка', 'листа', 'филии', 'парче'];
function ingredients() {
  const wrap = el('div');
  const draw = () => {
    wrap.replaceChildren();
    const unitDl = el('datalist', { id: 'units' }, UNITS.map((u) => el('option', { value: u })));
    const groups = S.d.ingredients;
    const gList = el('ul', { class: 'rep-list', 'aria-label': 'Групи съставки' });
    groups.forEach((g, gi) => {
      const iList = el('ul', { class: 'rep-list', 'aria-label': `Съставки${g.title ? ' – ' + g.title : ''}` });
      g.items.forEach((it, ii) => {
        const amount = el('input', { type: 'text', inputmode: 'decimal', value: it.amount, 'aria-label': 'Количество', placeholder: 'кол.' });
        amount.addEventListener('input', () => { it.amount = amount.value; markDirty(); });
        const unit = el('input', { type: 'text', list: 'units', value: it.unit, 'aria-label': 'Мерна единица', placeholder: 'мярка' });
        unit.addEventListener('input', () => { it.unit = unit.value; markDirty(); });
        const name = el('input', { type: 'text', value: it.name, 'aria-label': 'Име на съставката', placeholder: 'съставка' });
        name.addEventListener('input', () => { it.name = name.value; markDirty(); });
        const note = el('input', { type: 'text', value: it.note, 'aria-label': 'Забележка', placeholder: 'забележка (по желание)' });
        note.addEventListener('input', () => { it.note = note.value; markDirty(); });
        const sc = el('input', { type: 'checkbox' }); sc.checked = !!it.scale; sc.addEventListener('change', () => { it.scale = sc.checked; markDirty(); });
        iList.append(el('li', { class: 'rep-item' }, el('span', { class: 'handle', 'aria-hidden': 'true', title: 'Влачете за подреждане' }, '⋮⋮'),
          el('div', { class: 'ing-row' }, amount, unit, name, note, el('label', { class: 'check', title: 'Количеството се преоразмерява при смяна на порциите' }, sc, 'Преоразм.')),
          el('div', { class: 'btn-row' },
            iconBtn('Премести нагоре', '▲', () => { move(g.items, ii, ii - 1); markDirty(); draw(); }),
            iconBtn('Премести надолу', '▼', () => { move(g.items, ii, ii + 1); markDirty(); draw(); }),
            iconBtn('Изтрий съставката', '✕', async () => { if (await confirmDialog(`Да се изтрие ли „${it.name || 'съставката'}“?`, { ok: 'Изтрий', danger: true })) { g.items.splice(ii, 1); markDirty(); draw(); } }))));
      });
      sortable(iList, `ing-${gi}`, g.items, draw);
      const title = el('input', { type: 'text', value: g.title, id: id('gt'), placeholder: 'напр. За плънката (по желание)' });
      title.addEventListener('input', () => { g.title = title.value; markDirty(); });
      gList.append(el('li', { class: 'rep-item' }, el('span', { class: 'handle', 'aria-hidden': 'true' }, '⋮⋮'),
        el('div', {}, el('div', { class: 'group-head' }, el('div', {}, el('label', { for: title.id }, `Група ${gi + 1}`), title)), iList,
          el('button', { type: 'button', class: 'btn small secondary', onclick: () => { g.items.push({ name: '', amount: '', unit: '', note: '', scale: true }); markDirty(); draw(); } }, '+ Съставка')),
        el('div', { class: 'btn-row' },
          iconBtn('Премести групата нагоре', '▲', () => { move(groups, gi, gi - 1); markDirty(); draw(); }),
          iconBtn('Премести групата надолу', '▼', () => { move(groups, gi, gi + 1); markDirty(); draw(); }),
          groups.length > 1 ? iconBtn('Изтрий групата', '✕', async () => { if (await confirmDialog(`Да се изтрие ли цялата група${g.title ? ` „${g.title}“` : ''} със ${g.items.length} съставки?`, { ok: 'Изтрий', danger: true })) { groups.splice(gi, 1); markDirty(); draw(); } }) : null)));
    });
    sortable(gList, 'ing-groups', groups, draw);
    wrap.append(unitDl, gList, el('button', { type: 'button', class: 'btn secondary', onclick: () => { groups.push({ title: '', items: [{ name: '', amount: '', unit: '', note: '', scale: true }] }); markDirty(); draw(); } }, '+ Нова група съставки'));
  };
  draw();
  return section('ingredients', 'Съставки', el('p', { class: 'muted small' }, 'Отметката „Преоразм.“ означава, че количеството се променя при смяна на порциите. Не я слагайте при „на вкус“, мазнина за пържене и други неточни количества.'), wrap, lines('Mise en place (подготовка преди готвене)', 'mise'));
}

// ---------- Стъпки ----------
function steps() {
  const wrap = el('div');
  const photoOptions = () => [el('option', { value: '' }, '— без снимка —'), ...sortedFiles().map((f) => el('option', { value: f }, (S.d.photos[f]?.alt || f).slice(0, 60)))];
  const draw = () => {
    wrap.replaceChildren();
    const list = el('ol', { class: 'rep-list', 'aria-label': 'Стъпки' });
    S.d.steps.forEach((s, i) => {
      const f = (k, label, tag = 'input', attrs = {}) => {
        const n = el(tag, attrs); if (tag === 'textarea') n.value = s[k] ?? ''; else n.value = s[k] ?? '';
        n.addEventListener('input', () => { s[k] = n.value; markDirty(); });
        return field(label, n);
      };
      const sel = el('select', { 'aria-label': `Снимка към стъпка ${i + 1}` }, ...photoOptions()); sel.value = s.photo || '';
      sel.addEventListener('change', () => {
        if (sel.value) S.d.steps.forEach((o) => { if (o !== s && o.photo === sel.value) o.photo = ''; });
        s.photo = sel.value; markDirty(); draw();
      });
      const prev = s.photo && S.files.includes(s.photo) ? el('img', { class: 'thumb', src: thumbUrl(s.photo), alt: '' }) : null;
      list.append(el('li', { class: 'rep-item', 'data-step': String(i + 1) }, el('span', { class: 'handle', 'aria-hidden': 'true', title: 'Влачете за подреждане' }, '⋮⋮'),
        el('div', { class: 'step-fields' }, el('strong', {}, `Стъпка ${i + 1}`),
          f('title', 'Заглавие на стъпката', 'input'), f('text', 'Какво се прави', 'textarea', { rows: 3 }),
          el('div', { class: 'row' }, f('why', 'Защо (по желание)', 'input'), f('cue', 'Как разбираш, че е готово', 'input'), f('avoid', 'Какво да се избягва', 'input'), f('time', 'Време (мин, за таймера)', 'input', { type: 'number', min: '0' })),
          field('Снимка към стъпката', el('div', { class: 'step-photo' }, prev, sel), 'Снимката остава при стъпката, когато я преместите.')),
        el('div', { class: 'btn-row' },
          iconBtn('Премести нагоре', '▲', () => { move(S.d.steps, i, i - 1); markDirty(); draw(); }),
          iconBtn('Премести надолу', '▼', () => { move(S.d.steps, i, i + 1); markDirty(); draw(); }),
          iconBtn('Изтрий стъпката', '✕', async () => { if (await confirmDialog(`Да се изтрие ли стъпка ${i + 1}?`, { ok: 'Изтрий', danger: true })) { S.d.steps.splice(i, 1); markDirty(); draw(); } }))));
    });
    sortable(list, 'steps', S.d.steps, draw);
    wrap.append(list, el('button', { type: 'button', class: 'btn secondary', 'data-add-step': '', onclick: () => { S.d.steps.push({ title: '', text: '', why: '', cue: '', avoid: '', time: '', photo: '' }); markDirty(); draw(); wrap.querySelector('.rep-item:last-child textarea')?.focus(); } }, '+ Нова стъпка'));
  };
  S.redrawSteps = draw;
  draw();
  return section('steps', 'Приготвяне', wrap);
}

// ---------- Съвети и поднасяне ----------
function advice() {
  return section('advice', 'Техника, съвети и поднасяне',
    field('Основна техника', area('technique', { rows: 3 })), field('Контрол на температурата', area('temperature', { rows: 3 })), field('Консистенция, текстура и баланс на вкуса', area('balance', { rows: 3 })),
    lines('Съвети от шефа', 'tips'), lines('Чести грешки', 'mistakes'), lines('Заместители', 'substitutions'),
    field('Поднасяне в чиния', area('plating', { rows: 2 })), field('Сервиране', area('serving', { rows: 2 })), field('Съхранение и претопляне', area('storage', { rows: 2 })),
    (() => { const a = el('textarea', { rows: 4 }); a.value = S.body; a.addEventListener('input', () => { S.body = a.value; markDirty(); }); return field('Допълнителни бележки (Markdown, по желание)', a); })());
}

// ---------- Снимки ----------
const thumbUrl = (f) => `/admin/media/thumb/${encodeURIComponent(S.slug)}/${encodeURIComponent(f)}?v=${S.v}`;
const sortedFiles = () => [...S.files].sort((a, b) => (S.d.photos[a]?.order ?? 1e9) - (S.d.photos[b]?.order ?? 1e9) || a.localeCompare(b, 'en', { numeric: true }));
const renumber = (list) => list.forEach((f, i) => { (S.d.photos[f] ||= { alt: '' }).order = i + 1; });

function photos() {
  const wrap = el('div');
  const grid = el('ul', { class: 'photo-grid', 'aria-label': 'Снимки' });
  const upl = el('div', { class: 'upl', 'aria-live': 'polite' });
  const draw = () => {
    grid.replaceChildren();
    const list = sortedFiles();
    list.forEach((f, i) => {
      const m = (S.d.photos[f] ||= { alt: '' });
      const alt = el('textarea', { rows: 2, 'aria-label': 'Описание на снимката (alt)', maxlength: '220' }); alt.value = m.alt || '';
      alt.addEventListener('input', () => { m.alt = alt.value; markDirty(); badge.hidden = !(m.alt.length < 5 || m.alt.includes(ENUM.placeholder)); });
      const badge = el('span', { class: 'badge warn' }, 'Нужно е описание'); badge.hidden = !(m.alt.length < 5 || m.alt.includes(ENUM.placeholder));
      const cap = el('input', { type: 'text', 'aria-label': 'Подпис на снимката', placeholder: 'Подпис (по желание)', value: m.caption || '' }); cap.addEventListener('input', () => { m.caption = cap.value; markDirty(); });
      const prov = el('input', { type: 'text', 'aria-label': 'Произход на снимката', placeholder: 'Произход (напр. собствена снимка)', value: m.provenance || '' }); prov.addEventListener('input', () => { m.provenance = prov.value; markDirty(); });
      const cover = el('input', { type: 'radio', name: 'cover', checked: S.d.cover === f }); cover.addEventListener('change', () => { S.d.cover = f; markDirty(); });
      const inCar = (S.d.carousel || []).includes(f);
      const car = el('input', { type: 'checkbox', checked: inCar });
      car.addEventListener('change', () => {
        S.d.carousel ||= [];
        if (car.checked) { if (S.d.carousel.length >= 10) { car.checked = false; toast('Фото-историята е до 10 кадъра.', true); return; } S.d.carousel.push(f); }
        else S.d.carousel = S.d.carousel.filter((x) => x !== f);
        if (!S.d.carousel.length) delete S.d.carousel;
        markDirty();
      });
      const stepIdx = S.d.steps.findIndex((s) => s.photo === f);
      const stepSel = el('select', { 'aria-label': 'Към стъпка' }, el('option', { value: '' }, '— без стъпка —'), ...S.d.steps.map((s, k) => el('option', { value: String(k) }, `Стъпка ${k + 1}${s.title ? ': ' + s.title.slice(0, 28) : ''}`)));
      stepSel.value = stepIdx >= 0 ? String(stepIdx) : '';
      stepSel.addEventListener('change', () => {
        S.d.steps.forEach((s) => { if (s.photo === f) s.photo = ''; });
        if (stepSel.value !== '') S.d.steps[Number(stepSel.value)].photo = f;
        markDirty(); S.redrawSteps?.();
      });
      grid.append(el('li', { class: 'pcard', 'data-file': f },
        el('img', { src: thumbUrl(f), alt: m.alt || '', loading: 'lazy' }),
        el('div', { class: 'pbody' },
          el('div', { class: 'pbtns' }, el('span', { class: 'handle', 'aria-hidden': 'true', title: 'Влачете за подреждане' }, '⋮⋮'), el('span', { class: 'muted small' }, `№ ${i + 1}`), badge,
            iconBtn('Премести назад', '◀', () => { const l = sortedFiles(); move(l, i, i - 1); renumber(l); markDirty(); draw(); }),
            iconBtn('Премести напред', '▶', () => { const l = sortedFiles(); move(l, i, i + 1); renumber(l); markDirty(); draw(); })),
          alt, cap, prov,
          el('label', { class: 'check' }, cover, 'Заглавна снимка'), el('label', { class: 'check' }, car, 'Във фото-историята'), stepSel,
          el('div', { class: 'pbtns' }, el('button', { type: 'button', class: 'btn small ghost', onclick: () => cropDialog(f) }, S.crops[f] ? 'Изрязване ✓' : 'Изрежи'),
            el('button', { type: 'button', class: 'btn small danger', onclick: () => removePhoto(f) }, 'Изтрий')))));
    });
    if (!list.length) grid.append(el('li', { class: 'empty' }, S.isNew ? 'Първо запазете рецептата като чернова – после можете да качвате снимки.' : 'Още няма снимки. Плъзнете файлове тук или ги изберете.'));
    sortable(grid, 'photos', list, () => { renumber(list); draw(); });
  };
  S.redrawPhotos = draw;

  const dz = el('div', { class: 'dz', tabindex: '0', role: 'group', 'aria-label': 'Качване на снимки' });
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/avif', multiple: true, id: 'file-input', 'aria-label': 'Избор на снимки' });
  const dup = el('input', { type: 'checkbox', id: 'allow-dup' });
  dz.append(el('p', {}, S.isNew ? 'Запазете рецептата, за да качвате снимки.' : `Плъзнете снимки тук или изберете файлове (JPEG, PNG, WebP, AVIF; до ${P.limits.maxFiles} наведнъж, до ${P.limits.maxFileMB} MB всяка).`),
    input, el('label', { class: 'check', for: 'allow-dup', style: 'justify-content:center;margin-top:.5rem' }, dup, 'Позволи и вече качени (дублирани) снимки'));
  if (S.isNew) input.disabled = true;
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dz.classList.add('over'); } }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length && !S.isNew) { e.preventDefault(); upload([...e.dataTransfer.files]); } });
  input.addEventListener('change', () => { upload([...input.files]); input.value = ''; });

  function upload(files) {
    if (!files.length) return;
    upl.replaceChildren();
    const rows = files.map((f) => {
      const status = el('span', {}, 'чака…');
      const row = el('div', { class: 'upl-item' }, el('img', { src: URL.createObjectURL(f), alt: '' }), el('div', {}, el('strong', {}, f.name), ' ', status));
      upl.append(row); return { f, status, row };
    });
    const bar = el('div', { class: 'progress' }, el('i')); upl.prepend(bar);
    const fd = new FormData(); files.forEach((f) => fd.append('files', f)); fd.append('allowDuplicate', dup.checked ? '1' : '0');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/admin/api/recipes/${encodeURIComponent(S.slug)}/media`);
    xhr.setRequestHeader('x-csrf-token', document.querySelector('meta[name="csrf-token"]').content);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const p = Math.round((e.loaded / e.total) * 100); bar.firstChild.style.width = p + '%'; rows.forEach((r) => (r.status.textContent = `качва се… ${p}%`)); } };
    xhr.onerror = () => toast('Качването не успя – няма връзка.', true);
    xhr.onload = () => {
      let r = null; try { r = JSON.parse(xhr.responseText); } catch { /* не е JSON */ }
      if (xhr.status !== 200 || !r) { toast(r?.error || `Качването не успя (${xhr.status}).`, true); rows.forEach((x) => (x.status.textContent = 'неуспешно')); return; }
      let ok = 0;
      r.results.forEach((res, i) => {
        const row = rows[i]; if (!row) return;
        if (res.ok) { ok++; row.status.textContent = 'готово' + (res.warnings?.length ? ' – ' + res.warnings.join(' ') : ''); row.status.className = ''; }
        else { row.status.textContent = 'отхвърлена: ' + res.error; row.status.className = 'badge bad'; }
      });
      for (const res of r.results) if (res.ok && r.data.photos[res.file]) S.d.photos[res.file] = r.data.photos[res.file];
      if (!S.d.cover && r.data.cover) S.d.cover = r.data.cover;
      S.files = r.files; S.mtime = r.mtime; S.v = Date.now();
      draw(); S.redrawSteps?.();
      toast(ok ? `Качени снимки: ${ok}.` : 'Нито една снимка не е приета.', !ok);
    };
    xhr.send(fd);
  }

  async function removePhoto(f) {
    if (!(await confirmDialog('Да се изтрие ли снимката от рецептата? Публикуваният файл отива в кошче, а оригиналът се пази.', { ok: 'Изтрий', danger: true }))) return;
    try {
      const r = await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}/media/${encodeURIComponent(f)}`, { method: 'DELETE', json: {} });
      S.files = r.files; S.mtime = r.mtime; delete S.d.photos[f]; delete S.crops[f];
      if (S.d.cover === f) S.d.cover = ''; if (S.d.carousel) S.d.carousel = S.d.carousel.filter((x) => x !== f);
      S.d.steps.forEach((s) => { if (s.photo === f) s.photo = ''; });
      draw(); S.redrawSteps?.(); toast('Снимката е изтрита.');
    } catch (err) { toast(err.message, true); }
  }

  async function cropDialog(f) {
    const d = document.createElement('dialog'); d.setAttribute('aria-label', 'Изрязване на снимка');
    const aspects = { free: 'Свободно', '0.8': '4:5', '1': '1:1', '1.3333': '4:3', '1.7778': '16:9', '1.5': '3:2' };
    const sel = el('select', { 'aria-label': 'Съотношение' }, Object.entries(aspects).map(([v, l]) => el('option', { value: v }, l)));
    const img = el('img', { src: `/admin/media/original/${encodeURIComponent(S.slug)}/${encodeURIComponent(f)}?v=${Date.now()}`, alt: 'Оригиналният кадър' });
    const box = el('div', { class: 'crop-box' }, el('i', { 'aria-hidden': 'true' }));
    const stage = el('div', { class: 'crop-stage' }, img, box);
    let c = S.crops[f] ? { ...S.crops[f] } : { x: 0, y: 0, w: 1, h: 1 };
    const paint = () => { box.style.left = c.x * 100 + '%'; box.style.top = c.y * 100 + '%'; box.style.width = c.w * 100 + '%'; box.style.height = c.h * 100 + '%'; };
    const ratio = () => (sel.value === 'free' ? null : Number(sel.value));
    const fit = () => { const r = ratio(); if (!r) return; const W = img.clientWidth || 1, H = img.clientHeight || 1; let w = c.w, h = (c.w * W) / (r * H); if (h > 1 - c.y) { h = 1 - c.y; w = (h * r * H) / W; } c.w = w; c.h = h; };
    sel.addEventListener('change', () => { fit(); paint(); });
    img.addEventListener('load', paint);
    let drag = null;
    box.addEventListener('pointerdown', (e) => { drag = { mode: e.target.tagName === 'I' ? 'resize' : 'move', x: e.clientX, y: e.clientY, c: { ...c } }; box.setPointerCapture(e.pointerId); e.preventDefault(); });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const W = img.clientWidth, H = img.clientHeight, dx = (e.clientX - drag.x) / W, dy = (e.clientY - drag.y) / H;
      if (drag.mode === 'move') { c.x = Math.min(1 - c.w, Math.max(0, drag.c.x + dx)); c.y = Math.min(1 - c.h, Math.max(0, drag.c.y + dy)); }
      else { c.w = Math.min(1 - c.x, Math.max(0.05, drag.c.w + dx)); c.h = Math.min(1 - c.y, Math.max(0.05, drag.c.h + dy)); const r = ratio(); if (r) { c.h = (c.w * W) / (r * H); if (c.y + c.h > 1) { c.h = 1 - c.y; c.w = (c.h * r * H) / W; } } }
      paint();
    });
    box.addEventListener('pointerup', () => { drag = null; });
    const close = () => { d.close(); d.remove(); };
    const save = async (crop) => {
      try { await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}/media/${encodeURIComponent(f)}/crop`, { json: { crop } }); if (crop) S.crops[f] = crop; else delete S.crops[f]; S.v = Date.now(); draw(); toast(crop ? 'Изрязването е приложено.' : 'Върнат е целият кадър.'); close(); }
      catch (err) { toast(err.message, true); }
    };
    d.append(el('h3', {}, 'Изрязване'), el('p', { class: 'muted small' }, 'Оригиналът не се променя – публикуваният кадър се прави наново от него.'), el('div', { class: 'field' }, el('label', {}, 'Съотношение'), sel), stage,
      el('div', { class: 'btn-row', style: 'margin-top:1rem' }, el('button', { class: 'btn', type: 'button', onclick: () => save({ x: +c.x.toFixed(4), y: +c.y.toFixed(4), w: +c.w.toFixed(4), h: +c.h.toFixed(4) }) }, 'Приложи'),
        el('button', { class: 'btn ghost', type: 'button', onclick: () => save(null) }, 'Върни целия кадър'), el('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Отказ')));
    d.addEventListener('cancel', () => d.remove());
    document.body.append(d); d.showModal();
  }

  draw();
  wrap.append(dz, upl, grid);
  return section('photos', 'Снимки', el('p', { class: 'muted small' }, 'Подредбата тук определя реда в „Още снимки“. Описанието (alt) е задължително и се чете от екранни четци. Снимките със снимка към стъпка се показват при самата стъпка.'), wrap);
}

// ---------- Публикуване, ревизии, проверка ----------
const side = el('div', { id: 'ed-side' });
const errBox = el('div', { id: 'err-box', 'aria-live': 'assertive' });

function showErrors(list, title = 'Рецептата не може да се запази:') {
  errBox.replaceChildren();
  if (!list?.length) return;
  errBox.append(el('div', { class: 'notice bad', role: 'alert' }, el('strong', {}, title), el('ul', { class: 'errlist' }, list.map((e) => el('li', {}, e.msg || e)))));
  errBox.scrollIntoView({ block: 'center' });
}

function sidePanel() {
  side.replaceChildren();
  const pub = S.d.publication || 'draft';
  const stateText = { live: 'Публикувана на сайта', pending: 'Има промени, чакащи публикуване на сайта', removing: 'Ще бъде свалена от сайта при следващо публикуване', none: '' }[S.siteState] || '';
  side.append(el('div', { class: 'card', id: 'pubpanel' }, el('h2', {}, 'Публикуване'),
    el('p', {}, el('span', { class: 'badge ' + (pub === 'published' ? 'ok' : pub === 'draft' ? 'warn' : '') }, ENUM.publications[pub])), stateText ? el('p', { class: 'muted small' }, stateText) : null,
    S.isNew ? el('p', { class: 'muted small' }, 'Новата рецепта се създава като чернова.') : el('div', { class: 'btn-row' },
      pub !== 'published' ? el('button', { type: 'button', class: 'btn', 'data-state': 'published', onclick: () => setState('published') }, 'Публикувай рецептата') : el('button', { type: 'button', class: 'btn secondary', onclick: () => setState('draft') }, 'Върни в чернова'),
      pub !== 'archived' ? el('button', { type: 'button', class: 'btn ghost', onclick: () => setState('archived') }, 'Архивирай') : null),
    S.blockers?.length ? el('div', { class: 'notice warn' }, el('strong', {}, 'Преди публикуване:'), el('ul', { class: 'errlist' }, S.blockers.map((b) => el('li', {}, b)))) : null,
    el('p', { class: 'muted small' }, 'Публикуването на рецептата я включва за сайта, а самият сайт се обновява от страница „Публикуване“.'),
    !S.isNew ? el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'btn small ghost', onclick: duplicate }, 'Дублирай'),
      pub !== 'published' ? el('button', { type: 'button', class: 'btn small danger', onclick: remove }, 'Изтрий') : null) : null));
  if (!S.isNew) {
    side.append(el('div', { class: 'card', id: 'revpanel' }, el('h2', {}, 'Ревизии'),
      S.revisions.length ? el('ul', { class: 'rep-list' }, S.revisions.slice(0, 12).map((r, i) => el('li', { class: 'rep-item', style: 'grid-template-columns:1fr auto' },
        el('div', {}, el('strong', {}, `№ ${r.rev}`), ' ', el('span', { class: 'muted small' }, `${new Date(r.created_at).toLocaleString('bg-BG')} · ${r.action}${r.author ? ' · ' + r.author : ''}`)),
        i === 0 ? el('span', { class: 'badge' }, 'текуща') : el('button', { type: 'button', class: 'btn small ghost', 'data-restore': String(r.rev), onclick: () => restore(r.rev) }, 'Върни')))) : el('p', { class: 'muted small' }, 'Няма ревизии.')));
  }
}

async function save({ quiet = false } = {}) {
  showErrors(null);
  try {
    if (S.isNew) {
      const r = await api('/admin/api/recipes', { json: { data: S.d, body: S.body, slug: S.slugInput } });
      S.dirty = false; toast('Чернова е създадена. Можете да качвате снимки.'); location.href = r.url + '#photos'; return true;
    }
    const r = await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}`, { method: 'PUT', json: { data: S.d, body: S.body, expectedMtime: S.mtime } });
    S.mtime = r.mtime; S.dirty = false; S.blockers = r.publishBlockers; if (S.d.publication === 'published' || S.siteState === 'live') S.siteState = 'pending';
    S.revisions = (await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}/revisions`, { method: 'GET' })).revisions; sidePanel();
    if (!quiet) toast(r.warnings?.length ? 'Запазено. ' + r.warnings.map((w) => w.msg).join(' ') : 'Запазено.');
    return true;
  } catch (err) {
    if (err.status === 422 || err.data?.errors) showErrors(err.data?.errors || [{ msg: err.message }]);
    else if (err.data?.conflict) { toast(err.message, true); showErrors([{ msg: err.message }], 'Конфликт:'); }
    else toast(err.message, true);
    return false;
  }
}

async function setState(to) {
  if (S.dirty && !(await save({ quiet: true }))) return;
  try {
    const r = await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}/state`, { json: { publication: to } });
    S.d.publication = r.publication; S.blockers = null; S.siteState = 'pending'; sidePanel();
    const m = await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}`, { method: 'GET' }); S.mtime = m.mtime;
    S.revisions = (await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}/revisions`, { method: 'GET' })).revisions; sidePanel();
    toast(to === 'published' ? 'Рецептата е маркирана като публикувана. Публикувайте сайта, за да се покаже.' : 'Състоянието е променено. Публикувайте сайта, за да влезе в сила.');
    if (await confirmDialog('Да отида ли към публикуването на сайта сега?', { ok: 'Към публикуването' })) location.href = '/admin/publish';
  } catch (err) {
    if (err.data?.blockers) { S.blockers = err.data.blockers; sidePanel(); showErrors(err.data.blockers, err.message); } else if (err.data?.errors) showErrors(err.data.errors); else toast(err.message, true);
  }
}

async function duplicate() {
  if (S.dirty && !(await save({ quiet: true }))) return;
  try { const r = await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}/duplicate`, { json: {} }); S.dirty = false; location.href = r.url; } catch (err) { toast(err.message, true); }
}
async function remove() {
  const t = await promptDialog(`Това изтрива рецептата (премества я в кошче). За потвърждение въведете адреса „${S.slug}“:`, '', { ok: 'Изтрий', label: 'Адрес на рецептата' });
  if (t == null) return;
  try { await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}`, { method: 'DELETE', json: { confirm: t } }); S.dirty = false; location.href = '/admin/recipes'; } catch (err) { toast(err.message, true); }
}
async function restore(rev) {
  if (!(await confirmDialog(`Да се върне ли ревизия № ${rev}? Текущото състояние остава в историята.`, { ok: 'Върни' }))) return;
  try { await api(`/admin/api/recipes/${encodeURIComponent(S.slug)}/revisions/${rev}/restore`, { json: {} }); S.dirty = false; toast('Ревизията е върната.'); setTimeout(() => location.reload(), 600); }
  catch (err) { showErrors(err.data?.errors || [{ msg: err.message }], 'Ревизията не може да се върне:'); }
}

// ---------- Сглобяване на страницата ----------
const main = el('div', { id: 'ed-main' }, errBox);
if (P.building) main.append(el('div', { class: 'notice warn', role: 'status' }, 'В момента тече публикуване на сайта – записът е временно заключен.'));
main.append(basics(), ingredients(), steps(), photos(), advice());
const bar = el('div', { class: 'sticky-bar' },
  el('button', { type: 'button', class: 'btn', id: 'save-btn', onclick: () => save() }, S.isNew ? 'Създай чернова' : 'Запази'),
  S.isNew ? null : el('a', { class: 'btn ghost', href: `/admin/recipes/${S.slug}/preview`, target: '_blank', rel: 'noopener' }, 'Преглед'),
  el('span', { class: 'muted small' }, 'Преглед показва последно запазената версия.'));
root.replaceChildren(el('div', { class: 'editor-grid' }, el('div', {}, main, bar), side));
sidePanel();
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
