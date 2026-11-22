import { tc, tnc, intl, num, hrefc } from '../i18n/client';
import { api, getMe, localFavorites, setLocalFavorites, ApiError } from './account';
// Оценки, коментари, „Сготвих“, любими и „Сподели“ на страницата на рецепта.
// Четенето е за всички. Оценки, коментари, сигнали и история „Сготвих“ – само за влезли (коментари и оценки – с потвърден имейл).
// Любими: за гости – в браузъра (както досега); за влезли – в профила (оптимистично, с връщане при грешка).
// Всичко от посетителите се показва като текст (textContent) – никакъв HTML от потребители.
type Rating = { count: number; average: number | null; distribution: Record<string, number>; mine: number | null };
type Cm = { id: number; author: string; body: string; createdAt: number; editedAt: number | null; isAdmin: boolean; pending: boolean; mine: boolean; replies: Cm[] };
type MeLite = { signedIn: boolean; verified?: boolean; displayName?: string; role?: string; favorite?: boolean };
type Cooked = { count: number; mine: number; lastCookedAt: number | null };
type Community = { rating: Rating; comments: Cm[]; cooked: Cooked; me: MeLite; limits: { maxDepth: number } };

const root = document.querySelector<HTMLElement>('[data-community]');
const slug = root?.dataset.slug ?? document.querySelector<HTMLElement>('[data-rating-line]')?.dataset.slug ?? '';
const $ = <T extends HTMLElement>(sel: string) => (root ?? document).querySelector<T>(sel);
const fmt = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'long', year: 'numeric' });
const stars = (avg: number) => '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));
const msg = (e: unknown) => (e instanceof ApiError ? e.message : tc('community.error'));
const loginHref = (hash: string) => `${hrefc('login')}?next=${encodeURIComponent(location.pathname + hash)}`;
const DELETED = 'Изтрит профил'; // етикетът от сървъра за анонимизиран автор – показва се на езика на страницата

let state: Community | null = null;
const me = (): MeLite => state?.me ?? { signedIn: false };

const countVisible = (a: Cm[]): number => a.reduce((n, c) => n + (c.pending ? 0 : 1) + countVisible(c.replies), 0);

// ---------- Оценки ----------
function renderRating(r: Rating, commentCount: number) {
  const line = document.querySelector<HTMLElement>('[data-rating-line]');
  if (line) {
    const parts: string[] = [];
    if (r.count && r.average != null) parts.push(`★ ${num(r.average)} (${tnc('community.rating', r.count)})`);
    if (commentCount) parts.push(tnc('community.comment', commentCount));
    line.replaceChildren();
    if (parts.length) { const a = document.createElement('a'); a.href = r.count ? '#ocenki' : '#komentari'; a.textContent = parts.join(' · '); line.append(a); line.hidden = false; } else line.hidden = true;
  }
  if (!root) return;
  const summary = $('[data-rating-summary]')!, empty = $('[data-rating-empty]')!;
  summary.hidden = !r.count; empty.hidden = !!r.count;
  if (r.count && r.average != null) {
    $('[data-avg]')!.textContent = num(r.average);
    $('[data-avg-stars]')!.textContent = stars(r.average);
    $('[data-count-text]')!.textContent = tc('community.ratingsFromVisitors', { count: tnc('community.rating', r.count) });
    const dist = $('[data-dist]')!; dist.replaceChildren();
    for (const s of [5, 4, 3, 2, 1]) {
      const n = r.distribution[String(s)] ?? 0;
      const li = document.createElement('li');
      const label = document.createElement('span'); label.className = 'd-label'; label.textContent = `${s} ★`;
      const bar = document.createElement('span'); bar.className = 'd-bar'; const fill = document.createElement('i'); fill.style.width = `${Math.round((n / r.count) * 100)}%`; bar.append(fill);
      const cnt = document.createElement('span'); cnt.className = 'd-n'; cnt.textContent = String(n);
      li.append(label, bar, cnt); dist.append(li);
    }
  }
  // кой може да оценява: влязъл с потвърден имейл; иначе – покана за вход/потвърждаване
  const m = me();
  const canRate = m.signedIn && m.verified;
  $('[data-star-input]')!.hidden = !canRate;
  const gate = $('[data-rate-gate]')!;
  gate.hidden = !!canRate;
  gate.querySelector<HTMLElement>('[data-gate-text]')!.textContent = m.signedIn ? tc('community.verifyFirst') : tc('community.signInToRate');
  gate.querySelector<HTMLElement>('[data-signin-link]')!.hidden = m.signedIn;
  root.querySelectorAll<HTMLButtonElement>('[data-score]').forEach((b) => {
    const n = Number(b.dataset.score);
    b.setAttribute('aria-pressed', String(r.mine === n));
    b.classList.toggle('on', r.mine != null && n <= r.mine);
  });
  $('[data-my-rating]')!.textContent = r.mine ? tc('community.myRating', { n: r.mine }) : '';
  $('[data-rating-remove]')!.hidden = !r.mine;
}

// ---------- Коментари ----------
function commentNode(c: Cm, depth: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'comment' + (c.isAdmin ? ' by-admin' : '') + (c.pending ? ' is-pending' : '');
  li.id = `comment-${c.id}`;
  const head = document.createElement('p'); head.className = 'cm-meta';
  const who = document.createElement('strong'); who.textContent = c.author === DELETED ? tc('community.deletedAccount') : c.author; head.append(who);
  if (c.isAdmin) { const b = document.createElement('span'); b.className = 'tag-soft'; b.textContent = tc('community.editorial'); head.append(' ', b); }
  if (c.pending) { const b = document.createElement('span'); b.className = 'tag-soft draft'; b.textContent = tc('community.pending'); head.append(' ', b); }
  const time = document.createElement('time'); time.dateTime = new Date(c.createdAt).toISOString(); time.textContent = fmt.format(new Date(c.createdAt)); time.className = 'muted small';
  head.append(' · ', time);
  if (c.editedAt) head.append(` · ${tc('community.edited')}`);
  // Коментарите се показват на езика, на който са написани – не се превеждат и не се променят автоматично
  const body = document.createElement('p'); body.className = 'cm-body'; body.textContent = c.body;
  li.append(head, body);
  const m = me();
  const actions = document.createElement('p'); actions.className = 'cm-actions';
  if (c.mine) {
    const ed = linkBtn(tc('community.edit'));
    ed.addEventListener('click', () => editForm(li, c, ed));
    const del = linkBtn(tc('community.delete'));
    del.addEventListener('click', async () => {
      if (!confirm(tc('community.deleteConfirm'))) return;
      try { await api(`/api/account/comments/${c.id}`, 'DELETE'); await load(); } catch (e) { del.textContent = msg(e); }
    });
    actions.append(ed, del);
  } else if (!c.pending) {
    if (m.signedIn && m.verified && depth < (state?.limits.maxDepth ?? 1)) {
      const reply = linkBtn(tc('community.reply')); reply.setAttribute('aria-expanded', 'false');
      reply.addEventListener('click', () => toggleReply(li, c.id, reply));
      actions.append(reply);
    }
    if (m.signedIn) {
      const rep = linkBtn(tc('community.report')); rep.setAttribute('aria-expanded', 'false');
      rep.addEventListener('click', () => toggleReport(li, c.id, rep));
      actions.append(rep);
    }
  }
  if (actions.childElementCount) li.append(actions);
  if (c.replies.length) { const ul = document.createElement('ul'); ul.className = 'comment-list replies'; c.replies.forEach((r) => ul.append(commentNode(r, depth + 1))); li.append(ul); }
  return li;
}

const linkBtn = (text: string) => Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn', textContent: text });

function inlineForm(id: string, label: string, submit: string, value = '') {
  const form = document.createElement('form'); form.className = 'reply-form'; form.noValidate = true;
  const lab = Object.assign(document.createElement('label'), { htmlFor: id, textContent: label });
  const ta = Object.assign(document.createElement('textarea'), { id, name: 'body', rows: 3, maxLength: 2000, required: true, value });
  const btn = Object.assign(document.createElement('button'), { type: 'submit', className: 'btn small', textContent: submit });
  const status = Object.assign(document.createElement('span'), { className: 'small' }); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const field = document.createElement('div'); field.className = 'field'; field.append(lab, ta);
  form.append(field, btn, ' ', status);
  return { form, ta, status };
}

function toggleReply(li: HTMLElement, parentId: number, btn: HTMLButtonElement) {
  const existing = li.querySelector(':scope > form.reply-form');
  if (existing) { existing.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); return; }
  const { form, ta, status } = inlineForm(`rf-${parentId}`, tc('community.replyLabel'), tc('community.replySubmit'));
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { form.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api(`/api/account/recipes/${slug}/comments`, 'POST', { body: ta.value, parentId }); status.textContent = r.message; setTimeout(load, 600); }
    catch (err) { status.textContent = msg(err); }
  });
  li.querySelector(':scope > .cm-actions')?.after(form);
  btn.setAttribute('aria-expanded', 'true');
  ta.focus();
}

function editForm(li: HTMLElement, c: Cm, btn: HTMLButtonElement) {
  if (li.querySelector(':scope > form.reply-form')) return;
  const { form, ta, status } = inlineForm(`ef-${c.id}`, tc('community.comment'), tc('community.save'), c.body);
  const cancel = linkBtn(tc('community.cancel'));
  cancel.addEventListener('click', () => { form.remove(); btn.focus(); });
  form.insertBefore(cancel, status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/account/comments/${c.id}`, 'PATCH', { body: ta.value }); await load(); $('[data-form-status]')!.textContent = tc('community.awaiting'); }
    catch (err) { status.textContent = msg(err); }
  });
  li.querySelector(':scope > .cm-body')?.after(form);
  ta.focus();
}

const CATEGORIES = ['spam', 'harassment', 'personal_data', 'inappropriate', 'other'] as const;
function toggleReport(li: HTMLElement, id: number, btn: HTMLButtonElement) {
  const existing = li.querySelector(':scope > form.report-form');
  if (existing) { existing.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); return; }
  const form = document.createElement('form'); form.className = 'report-form reply-form'; form.noValidate = true;
  const fs = document.createElement('fieldset');
  const lg = document.createElement('legend'); lg.textContent = tc('report.title'); fs.append(lg);
  CATEGORIES.forEach((cat, i) => {
    const lab = document.createElement('label'); lab.className = 'check';
    const r = Object.assign(document.createElement('input'), { type: 'radio', name: 'category', value: cat, checked: i === 0 });
    lab.append(r, ' ', tc(`report.${cat}`)); fs.append(lab);
  });
  const did = `rd-${id}`;
  const dl = Object.assign(document.createElement('label'), { htmlFor: did, textContent: tc('report.details') });
  const det = Object.assign(document.createElement('input'), { id: did, type: 'text', maxLength: 300 });
  const send = Object.assign(document.createElement('button'), { type: 'submit', className: 'btn small secondary', textContent: tc('report.send') });
  const status = Object.assign(document.createElement('span'), { className: 'small' }); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  form.append(fs, dl, det, ' ', send, ' ', status);
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { form.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const category = (form.querySelector('input[name=category]:checked') as HTMLInputElement)?.value;
    try { const r = await api(`/api/account/comments/${id}/report`, 'POST', { category, reason: det.value }); status.textContent = r.message; send.disabled = true; btn.textContent = r.already ? tc('community.reported') : tc('community.reportThanks'); }
    catch (err) { status.textContent = msg(err); }
  });
  li.querySelector(':scope > .cm-actions')?.after(form);
  btn.setAttribute('aria-expanded', 'true');
  (fs.querySelector('input') as HTMLInputElement).focus();
}

function renderComments(list: Cm[]) {
  if (!root) return;
  const ul = $('[data-comments]')!; ul.replaceChildren();
  list.forEach((c) => ul.append(commentNode(c, 0)));
  const count = countVisible(list);
  $('[data-comment-count]')!.textContent = count ? `(${count})` : '';
  $('[data-comments-empty]')!.hidden = list.length > 0;
  // форма или покана за вход/потвърждаване
  const m = me();
  const form = $<HTMLFormElement>('[data-comment-form]')!;
  const gate = $('[data-comment-gate]')!;
  form.hidden = !(m.signedIn && m.verified);
  gate.hidden = !form.hidden;
  gate.querySelectorAll<HTMLElement>('[data-gate-guest]').forEach((p) => { p.hidden = m.signedIn; });
  gate.querySelector<HTMLElement>('[data-gate-verify]')!.hidden = !m.signedIn;
  if (m.displayName) $('[data-comment-as]')!.textContent = tc('community.commentAs', { name: m.displayName });
}

// ---------- Сготвих ----------
function renderCooked(c: Cooked) {
  const m = me();
  document.querySelectorAll<HTMLButtonElement>('[data-cooked-toggle]').forEach((b) => {
    b.setAttribute('aria-pressed', String(c.mine > 0));
    b.textContent = c.mine > 0 ? tc('recipe.cookedAgain') : tc('recipe.cooked');
  });
  document.querySelectorAll<HTMLElement>('[data-cooked-count]').forEach((n) => {
    const parts: string[] = [];
    if (c.count) parts.push(tnc('recipe.cookedCount', c.count));
    if (m.signedIn && c.mine) parts.push(tnc('recipe.cookedMine', c.mine));
    n.hidden = !parts.length;
    n.textContent = parts.join(' ');
  });
}

const actionsStatus = () => document.querySelector<HTMLElement>('[data-actions-status]');
function say(text: string, link?: { href: string; label: string }) {
  const s = actionsStatus(); if (!s) return;
  s.replaceChildren(text);
  if (link) { const a = document.createElement('a'); a.href = link.href; a.textContent = link.label; s.append(' ', a); }
}

async function load() {
  try {
    state = (await api(`/api/public/recipes/${slug}/community`)) as Community;
    renderRating(state.rating, countVisible(state.comments)); renderComments(state.comments); renderCooked(state.cooked); paintFav();
    if (root) $('[data-community-error]')!.hidden = true;
  } catch {
    if (root) { $('[data-community-error]')!.hidden = false; root.querySelectorAll('button, input, textarea').forEach((e) => ((e as HTMLButtonElement).disabled = true)); }
  }
}

// ---------- събития ----------
root?.querySelectorAll<HTMLButtonElement>('[data-score]').forEach((b) => b.addEventListener('click', async () => {
  const status = $('[data-rating-status]')!;
  const prev = state?.rating;
  // оптимистично показване; при грешка – връщане на предишното
  if (state) { state.rating = { ...state.rating, mine: Number(b.dataset.score) }; renderRating(state.rating, countVisible(state.comments)); }
  try {
    await getMe();
    const r = await api(`/api/account/recipes/${slug}/rating`, 'PUT', { score: Number(b.dataset.score) });
    status.textContent = r.changed ? tc('community.thanksChanged') : tc('community.thanks');
    if (state) { state.rating = r.rating; renderRating(r.rating, countVisible(state.comments)); }
  } catch (e) {
    status.textContent = msg(e);
    if (state && prev) { state.rating = prev; renderRating(prev, countVisible(state.comments)); }
  }
}));

$<HTMLButtonElement>('[data-rating-remove]')?.addEventListener('click', async () => {
  const status = $('[data-rating-status]')!;
  try { await getMe(); const r = await api(`/api/account/recipes/${slug}/rating`, 'DELETE'); if (state) { state.rating = r.rating; renderRating(r.rating, countVisible(state.comments)); } status.textContent = ''; }
  catch (e) { status.textContent = msg(e); }
});

const form = root?.querySelector<HTMLFormElement>('[data-comment-form]');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('[data-form-status]')!;
  const fd = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const btn = form.querySelector<HTMLButtonElement>('[type=submit]')!; btn.disabled = true;
  try {
    await getMe();
    const r = await api(`/api/account/recipes/${slug}/comments`, 'POST', { body: fd.body, website: fd.website });
    status.textContent = r.message;
    (form.elements.namedItem('body') as HTMLTextAreaElement).value = '';
    await load();
  } catch (err) { status.textContent = msg(err); }
  finally { btn.disabled = false; }
});

document.querySelectorAll<HTMLButtonElement>('[data-cooked-toggle]').forEach((b) => b.addEventListener('click', async () => {
  if (!me().signedIn) { say(tc('recipe.cookedSignIn'), { href: loginHref(''), label: tc('community.signIn') }); return; }
  b.disabled = true;
  try {
    await getMe();
    const r = await api(`/api/account/recipes/${slug}/cooked`, 'POST', {});
    if (state) state.cooked = r.cooked;
    renderCooked(r.cooked);
    // кратко потвърждение + предложение за оценка
    say(tc('recipe.cookedSaved'), me().verified && !state?.rating.mine ? { href: '#ocenki', label: tc('recipe.cookedRate') } : { href: `${hrefc('account')}#sgotveni`, label: tc('recipe.cookedAddNote') });
  } catch (e) { say(msg(e)); }
  finally { b.disabled = false; }
}));

// ---------- Любими ----------
function paintFav() {
  const on = me().signedIn ? !!state?.me.favorite : localFavorites().includes(slug);
  document.querySelectorAll<HTMLButtonElement>('[data-fav-toggle]').forEach((b) => { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? tc('favorites.on') : tc('favorites.add'); });
}
document.querySelectorAll<HTMLButtonElement>('[data-fav-toggle]').forEach((b) => b.addEventListener('click', async () => {
  if (!me().signedIn) {
    const f = localFavorites();
    setLocalFavorites(f.includes(slug) ? f.filter((x) => x !== slug) : [...f, slug]);
    paintFav();
    return;
  }
  const next = !state!.me.favorite;
  state!.me.favorite = next; paintFav(); // оптимистично
  b.setAttribute('aria-busy', 'true');
  try { await getMe(); await api(`/api/account/favorites/${slug}`, next ? 'PUT' : 'DELETE', next ? {} : undefined); }
  catch { state!.me.favorite = !next; paintFav(); say(tc('favorites.error')); }
  finally { b.removeAttribute('aria-busy'); }
}));
paintFav();

// ---------- Сподели (Web Share API или копиране на връзката) ----------
document.querySelectorAll<HTMLButtonElement>('[data-share]').forEach((b) => b.addEventListener('click', async () => {
  const url = location.origin + location.pathname;
  const title = b.dataset.shareTitle || document.title;
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if ((e as DOMException).name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); say(tc('recipe.shareCopied')); } catch { say(tc('recipe.shareFail')); }
}));

// връзките „Вход“ връщат към същата рецепта
document.querySelectorAll<HTMLAnchorElement>('[data-signin-link]').forEach((a) => { a.href = loginHref(a.closest('#komentari') ? '#komentari' : '#ocenki'); });

if (slug) load();
