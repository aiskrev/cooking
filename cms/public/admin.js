// Общи функции на администрацията: заявки с CSRF токен, потвърждения, известия, бутони data-api, формуляри, публикуване.
const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

export class ApiError extends Error {
  constructor(message, data, status) { super(message); this.data = data; this.status = status; }
}

/** JSON заявка към API-то. Хвърля ApiError със съобщение на български. */
export async function api(url, { method = 'POST', json, form, signal } = {}) {
  const headers = { 'x-csrf-token': csrf() };
  let body;
  if (form) body = form; else if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  let res;
  try { res = await fetch(url, { method, headers, body, signal, credentials: 'same-origin' }); }
  catch (e) { throw new ApiError('Няма връзка със сървъра.', null, 0); }
  let data = null;
  try { data = await res.json(); } catch { /* не е JSON */ }
  if (res.status === 401) { location.href = '/admin/login?next=' + encodeURIComponent(location.pathname); throw new ApiError('Сесията е изтекла.', data, 401); }
  if (!res.ok) throw new ApiError(data?.error || `Грешка ${res.status}`, data, res.status);
  return data;
}

let toastTimer;
export function toast(msg, bad = false) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.append(t); }
  t.textContent = msg; t.classList.toggle('bad', bad); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 8000 : 3500);
}

function dialog(build) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    build(d, (v) => { d.close(); d.remove(); resolve(v); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); d.close(); d.remove(); resolve(null); });
    document.body.append(d); d.showModal();
  });
}
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
export { el };

/** Потвърждение с диалог (Да/Не). */
export const confirmDialog = (message, { ok = 'Да', danger = false } = {}) => dialog((d, done) => {
  d.setAttribute('aria-label', 'Потвърждение');
  const yes = el('button', { class: 'btn ' + (danger ? 'danger' : ''), type: 'button', onclick: () => done(true) }, ok);
  d.append(el('p', {}, message), el('div', { class: 'btn-row' }, yes, el('button', { class: 'btn ghost', type: 'button', onclick: () => done(false) }, 'Отказ')));
  yes.autofocus = true;
}).then((v) => !!v);

/** Диалог с въвеждане на текст; връща низ или null. */
export const promptDialog = (message, value = '', { ok = 'Запази', label = '' } = {}) => dialog((d, done) => {
  const input = el('input', { type: 'text', id: 'pd-in', value });
  const form = el('form', { onsubmit: (e) => { e.preventDefault(); done(input.value.trim()); } },
    el('p', {}, message), el('div', { class: 'field' }, el('label', { for: 'pd-in' }, label || 'Стойност'), input),
    el('div', { class: 'btn-row' }, el('button', { class: 'btn', type: 'submit' }, ok), el('button', { class: 'btn ghost', type: 'button', onclick: () => done(null) }, 'Отказ')));
  d.append(form); setTimeout(() => input.select(), 0);
});

// ---- Бутони: <button data-api="/admin/api/..." data-body='{"..."}' data-confirm="..."> ----
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-api]');
  if (!b || b.tagName === 'FORM') return;
  e.preventDefault();
  if (b.dataset.confirm && !(await confirmDialog(b.dataset.confirm, { danger: b.classList.contains('danger') }))) return;
  b.disabled = true;
  try {
    const data = await api(b.dataset.api, { json: b.dataset.body ? JSON.parse(b.dataset.body) : {} });
    toast(data?.name ? `Копието е създадено: ${data.name}` : 'Готово.');
    if (!b.hasAttribute('data-no-reload')) setTimeout(() => location.reload(), 500);
  } catch (err) { toast(err.message, true); }
  finally { b.disabled = false; }
});

// ---- Формуляри: <form data-json-form action="/admin/api/..." data-success="..."> ----
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-json-form]');
  if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try {
    await api(f.getAttribute('action'), { json: Object.fromEntries(new FormData(f)) });
    toast(f.dataset.success || 'Запазено.'); f.reset();
    if (f.hasAttribute('data-reload')) setTimeout(() => location.reload(), 600);
  } catch (err) { toast(err.message, true); }
  finally { if (btn) btn.disabled = false; }
});

// ---- Отговори на коментари ----
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-reply-toggle]');
  if (!t) return;
  const f = document.querySelector(`[data-reply-form="${t.dataset.replyToggle}"]`);
  if (f) { f.hidden = !f.hidden; if (!f.hidden) f.querySelector('textarea')?.focus(); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-reply-form]');
  if (!f) return;
  e.preventDefault();
  try { await api(`/admin/api/comments/${f.dataset.replyForm}/reply`, { json: { body: f.querySelector('textarea').value } }); toast('Отговорът е публикуван.'); setTimeout(() => location.reload(), 500); }
  catch (err) { toast(err.message, true); }
});

// ---- Преименуване на категории/етикети ----
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-rename]');
  if (!b) return;
  const to = await promptDialog(`Ново име за „${b.dataset.from}“ (ако вече съществува, двете се обединяват):`, b.dataset.from, { label: 'Ново име' });
  if (!to || to === b.dataset.from) return;
  try { const r = await api('/admin/api/taxonomy/rename', { json: { kind: b.dataset.rename, from: b.dataset.from, to } }); toast(`Променени рецепти: ${r.changed}.`); setTimeout(() => location.reload(), 600); }
  catch (err) { toast(err.message, true); }
});

// ---- Публикуване на сайта ----
const box = document.querySelector('[data-publish-box]');
if (box) {
  const stage = box.querySelector('[data-publish-stage]'), log = box.querySelector('[data-publish-log]'), bar = box.querySelector('.progress i');
  const startBtn = document.querySelector('[data-publish-start]');
  const stages = ['проверка на рецептите', 'сглобяване на сайта', 'индекс за търсене', 'проверка на връзките', 'проверка на структурираните данни', 'проверка на снимките', 'включване'];
  let timer;
  const poll = async () => {
    try {
      const r = await api('/admin/api/publish/status', { method: 'GET' });
      if (!r.job) return;
      box.hidden = false;
      log.textContent = r.log || '';
      log.scrollTop = log.scrollHeight;
      const idx = Math.max(0, stages.indexOf(r.job.stage));
      if (r.job.status === 'running') {
        stage.textContent = `В ход: ${r.job.stage}…`; bar.style.width = Math.round(((idx + 0.5) / stages.length) * 100) + '%';
        if (startBtn) startBtn.disabled = true;
        timer = setTimeout(poll, 3000);
      } else if (r.job.status === 'succeeded') {
        stage.textContent = 'Готово – новата версия е включена.'; bar.style.width = '100%';
        if (startBtn) startBtn.disabled = false;
        if (sessionStorage.getItem('publishWatching')) { sessionStorage.removeItem('publishWatching'); toast('Сайтът е публикуван.'); setTimeout(() => location.reload(), 1200); }
      } else {
        stage.textContent = 'Неуспешно: ' + (r.job.error || 'неизвестна грешка') + ' Публичният сайт не е променен.'; bar.style.width = '0%';
        if (startBtn) startBtn.disabled = false;
        sessionStorage.removeItem('publishWatching');
      }
    } catch (err) { stage.textContent = err.message; }
  };
  startBtn?.addEventListener('click', async () => {
    if (!(await confirmDialog('Да се сглоби и публикува ли новата версия на сайта?', { ok: 'Публикувай' }))) return;
    try { await api('/admin/api/publish', { json: {} }); sessionStorage.setItem('publishWatching', '1'); box.hidden = false; poll(); }
    catch (err) { toast(err.message, true); }
  });
  poll();
}
