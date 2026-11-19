// Настройка на двустепенна защита (TOTP): показва ключа, потвърждава с код и показва кодовете за възстановяване еднократно.
import { api, toast, el } from '/admin/assets/admin.js';

const start = document.querySelector('[data-mfa-start]');
start?.addEventListener('click', async () => {
  try {
    const r = await api('/admin/api/mfa/setup', { json: {} });
    const box = document.getElementById('mfa-box');
    const code = el('input', { type: 'text', id: 'mfa-code', inputmode: 'numeric', autocomplete: 'one-time-code', required: true, maxlength: '7' });
    box.replaceChildren(
      el('p', {}, 'В приложение за удостоверяване (напр. Aegis, 2FAS, Google Authenticator) добавете акаунт ръчно с този ключ:'),
      el('p', {}, el('code', { class: 'nowrap' }, r.secret)),
      el('p', { class: 'muted small' }, 'Тип: по време (TOTP), 6 цифри, 30 секунди, SHA-1. Адрес за приложения, които го поддържат: ', el('code', {}, r.uri)),
      el('form', { id: 'mfa-form', style: 'max-width:320px' },
        el('div', { class: 'field' }, el('label', { for: 'mfa-code' }, 'Код от приложението'), code),
        el('button', { class: 'btn', type: 'submit' }, 'Включи защитата')),
    );
    document.getElementById('mfa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const done = await api('/admin/api/mfa/enable', { json: { code: code.value } });
        box.replaceChildren(
          el('div', { class: 'notice ok', role: 'status' }, 'Двустепенната защита е включена.'),
          el('p', {}, el('strong', {}, 'Кодове за възстановяване – запишете ги на сигурно място. Показват се само сега и всеки важи един път:')),
          el('ul', {}, done.codes.map((c) => el('li', {}, el('code', {}, c)))),
          el('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Записах ги'),
        );
      } catch (err) { toast(err.message, true); }
    });
    code.focus();
  } catch (err) { toast(err.message, true); }
});
