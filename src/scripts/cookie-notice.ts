// Известие за бисквитките: показва се, докато посетителят не натисне „Разбрах“ (запомня се в localStorage на този браузър).
// Версията в ключа позволява да се покаже отново, ако някога се промени какво пазим.
const KEY = 'cookie-notice-v1';
const box = document.querySelector<HTMLElement>('[data-cookie-notice]');
let seen = false;
try { seen = localStorage.getItem(KEY) === 'ok'; } catch { /* без съхранение – известието се показва при всяко отваряне */ }
if (box && !seen) {
  box.hidden = false;
  document.documentElement.classList.add('has-cookie-notice');
  box.querySelector<HTMLButtonElement>('[data-cookie-ok]')?.addEventListener('click', () => {
    try { localStorage.setItem(KEY, 'ok'); } catch { /* */ }
    box.hidden = true;
    document.documentElement.classList.remove('has-cookie-notice');
  });
}
