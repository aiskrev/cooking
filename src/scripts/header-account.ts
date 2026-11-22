// Заглавка: „Вход“ за гости; за влезли – бутон с менюто на профила (разкриващ се списък: aria-expanded, Escape, клик извън менюто).
import { tc, hrefc } from '../i18n/client';
import { getMe, signOut, type Me } from './account';

const link = document.querySelector<HTMLAnchorElement>('[data-account-link]');
const wrap = document.querySelector<HTMLElement>('[data-account]');
const AUTH_PAGES = /\/(vhod|registratsia|zabravena-parola|nova-parola|potvarzhdenie|sign-in|register|forgot-password|reset-password|verify-email)\/$/;

// гост: връщане към същата страница след вход
if (link && !AUTH_PAGES.test(location.pathname)) link.href = `${hrefc('login')}?next=${encodeURIComponent(location.pathname + location.search)}`;

function menuFor(me: Me) {
  if (!wrap || !link) return;
  wrap.querySelector('.account-menu-wrap')?.remove();
  const box = document.createElement('div'); box.className = 'account-menu-wrap';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'account-btn'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'account-menu');
  const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = (me.displayName.trim()[0] ?? '?').toLocaleUpperCase();
  const label = document.createElement('span'); label.className = 'account-label'; label.textContent = me.displayName;
  const sr = document.createElement('span'); sr.className = 'sr-only'; sr.textContent = tc('account.menu');
  btn.append(avatar, label, sr);
  const menu = document.createElement('ul'); menu.id = 'account-menu'; menu.className = 'account-menu'; menu.hidden = true;
  const add = (text: string, href?: string, onClick?: () => void) => {
    const li = document.createElement('li');
    const el = href ? Object.assign(document.createElement('a'), { href }) : Object.assign(document.createElement('button'), { type: 'button' });
    el.textContent = text;
    if (href && location.pathname === new URL(href, location.origin).pathname && !href.includes('#')) el.setAttribute('aria-current', 'page');
    if (onClick) el.addEventListener('click', onClick);
    li.append(el); menu.append(li);
  };
  add(tc('profile.title'), hrefc('account'));
  add(tc('profile.favorites'), hrefc('account') + '#lyubimi');
  add(tc('profile.cooked'), hrefc('account') + '#sgotveni');
  add(tc('profile.settings'), hrefc('account') + '#nastroyki');
  if (me.role === 'moderator' || me.role === 'admin') add(tc('account.moderation'), hrefc('moderation'));
  add(tc('account.signOut'), undefined, async () => { await signOut(); location.href = hrefc(); });
  const close = (focus = false) => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focus) btn.focus(); };
  btn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLElement>('a, button')?.focus();
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); close(true); } });
  document.addEventListener('click', (e) => { if (!box.contains(e.target as Node)) close(); });
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget as Node | null) && e.relatedTarget) close(); });
  box.append(btn, menu);
  link.hidden = true;
  wrap.append(box);
}

function guest() {
  wrap?.querySelector('.account-menu-wrap')?.remove();
  if (link) link.hidden = false;
}

getMe().then((r) => (r.user ? menuFor(r.user) : guest()));
document.addEventListener('account:change', (e) => { const u = (e as CustomEvent<Me | null>).detail; if (u) menuFor(u); else guest(); });
