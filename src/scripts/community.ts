// Оценки, коментари, „Сготвих“ и любими на страницата на рецепта.
// Всичко от посетителя се показва като текст (textContent) – никакъв HTML от потребители.
type Rating = { count: number; average: number | null; distribution: Record<string, number>; mine: number | null };
type Cm = { id: number; author: string; body: string; createdAt: number; isAdmin: boolean; pending: boolean; mine: boolean; replies: Cm[] };
type Community = { rating: Rating; comments: Cm[]; cooked: { count: number; mine: boolean }; limits: { maxDepth: number } };

const root = document.querySelector<HTMLElement>('[data-community]');
const slug = root?.dataset.slug ?? document.querySelector<HTMLElement>('[data-rating-line]')?.dataset.slug ?? '';
const $ = <T extends HTMLElement>(sel: string) => (root ?? document).querySelector<T>(sel);
const fmt = new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
const num = (n: number) => String(n).replace('.', ',');
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const stars = (avg: number) => '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));

async function call(path: string, method: 'GET' | 'POST', body?: unknown) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data: any = null;
  try { data = await res.json(); } catch { /* не е JSON */ }
  if (!res.ok) throw new Error(data?.error || 'Възникна грешка. Опитайте отново.');
  return data;
}

let state: Community | null = null;

function renderRating(r: Rating, commentCount: number) {
  const line = document.querySelector<HTMLElement>('[data-rating-line]');
  if (line) {
    const parts: string[] = [];
    if (r.count && r.average != null) parts.push(`★ ${num(r.average)} (${plural(r.count, 'оценка', 'оценки')})`);
    if (commentCount) parts.push(plural(commentCount, 'коментар', 'коментара'));
    line.replaceChildren();
    if (parts.length) { const a = document.createElement('a'); a.href = r.count ? '#ocenki' : '#komentari'; a.textContent = parts.join(' · '); line.append(a); line.hidden = false; } else line.hidden = true;
  }
  if (!root) return;
  const summary = $('[data-rating-summary]')!, empty = $('[data-rating-empty]')!;
  summary.hidden = !r.count; empty.hidden = !!r.count;
  if (r.count && r.average != null) {
    $('[data-avg]')!.textContent = num(r.average);
    $('[data-avg-stars]')!.textContent = stars(r.average);
    $('[data-count-text]')!.textContent = `${plural(r.count, 'оценка', 'оценки')} от посетители`;
    const dist = $('[data-dist]')!; dist.replaceChildren();
    for (const s of [5, 4, 3, 2, 1]) {
      const n = r.distribution[String(s)] ?? 0;
      const li = document.createElement('li');
      li.innerHTML = '<span class="d-label"></span><span class="d-bar"><i></i></span><span class="d-n"></span>';
      li.querySelector('.d-label')!.textContent = `${s} ★`;
      (li.querySelector('.d-bar i') as HTMLElement).style.width = `${Math.round((n / r.count) * 100)}%`;
      li.querySelector('.d-n')!.textContent = String(n);
      dist.append(li);
    }
  }
  root.querySelectorAll<HTMLButtonElement>('[data-score]').forEach((b) => {
    const n = Number(b.dataset.score);
    b.setAttribute('aria-pressed', String(r.mine === n));
    b.classList.toggle('on', r.mine != null && n <= r.mine);
  });
  $('[data-my-rating]')!.textContent = r.mine ? `– ${r.mine} от 5` : '';
}

function commentNode(c: Cm, depth: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'comment' + (c.isAdmin ? ' by-admin' : '') + (c.pending ? ' is-pending' : '');
  li.id = `comment-${c.id}`;
  const head = document.createElement('p'); head.className = 'cm-meta';
  const who = document.createElement('strong'); who.textContent = c.author; head.append(who);
  if (c.isAdmin) { const b = document.createElement('span'); b.className = 'tag-soft'; b.textContent = 'Редакция'; head.append(' ', b); }
  if (c.pending) { const b = document.createElement('span'); b.className = 'tag-soft draft'; b.textContent = 'Чака одобрение – вижда се само от вас'; head.append(' ', b); }
  const time = document.createElement('time'); time.dateTime = new Date(c.createdAt).toISOString(); time.textContent = fmt.format(new Date(c.createdAt)); time.className = 'muted small';
  head.append(' · ', time);
  const body = document.createElement('p'); body.className = 'cm-body'; body.textContent = c.body;
  li.append(head, body);
  if (!c.pending) {
    const actions = document.createElement('p'); actions.className = 'cm-actions';
    if (depth < (state?.limits.maxDepth ?? 3)) {
      const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'link-btn'; reply.textContent = 'Отговор'; reply.setAttribute('aria-expanded', 'false');
      reply.addEventListener('click', () => toggleReply(li, c.id, reply));
      actions.append(reply);
    }
    const rep = document.createElement('button'); rep.type = 'button'; rep.className = 'link-btn'; rep.textContent = 'Докладвай';
    rep.addEventListener('click', async () => {
      try { const r = await call(`/api/public/comments/${c.id}/report`, 'POST', { reason: '' }); rep.textContent = r.already ? 'Вече е докладван' : 'Благодарим – ще го прегледаме'; rep.disabled = true; }
      catch (e) { rep.textContent = (e as Error).message; }
    });
    actions.append(rep);
    li.append(actions);
  }
  if (c.replies.length) { const ul = document.createElement('ul'); ul.className = 'comment-list replies'; c.replies.forEach((r) => ul.append(commentNode(r, depth + 1))); li.append(ul); }
  return li;
}

function toggleReply(li: HTMLElement, parentId: number, btn: HTMLButtonElement) {
  const existing = li.querySelector(':scope > form.reply-form');
  if (existing) { existing.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const form = document.createElement('form'); form.className = 'reply-form'; form.noValidate = true;
  const id = `rf-${parentId}`;
  form.innerHTML = `<div class="field"><label for="${id}-n">Име</label><input id="${id}-n" name="name" maxlength="40" required></div>
    <div class="field"><label for="${id}-b">Отговор</label><textarea id="${id}-b" name="body" rows="3" maxlength="2000" required></textarea></div>
    <div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
    <button class="btn small" type="submit">Изпрати отговора</button> <span class="small" role="status" aria-live="polite"></span>`;
  try { (form.querySelector('[name=name]') as HTMLInputElement).value = localStorage.getItem('community-name') ?? ''; } catch { /* без съхранение */ }
  const status = form.querySelector('span[role=status]') as HTMLElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try { const r = await call(`/api/public/recipes/${slug}/comments`, 'POST', { ...fd, parentId }); status.textContent = r.message; try { localStorage.setItem('community-name', fd.name); } catch { /* */ } setTimeout(load, 600); }
    catch (err) { status.textContent = (err as Error).message; }
  });
  li.querySelector(':scope > .cm-actions')?.after(form);
  btn.setAttribute('aria-expanded', 'true');
  (form.querySelector('textarea') as HTMLElement).focus();
}

function renderComments(list: Cm[]) {
  if (!root) return;
  const ul = $('[data-comments]')!; ul.replaceChildren();
  list.forEach((c) => ul.append(commentNode(c, 0)));
  const count = (function walk(a: Cm[]): number { return a.reduce((n, c) => n + (c.pending ? 0 : 1) + walk(c.replies), 0); })(list);
  $('[data-comment-count]')!.textContent = count ? `(${count})` : '';
  $('[data-comments-empty]')!.hidden = list.length > 0;
}

function renderCooked(c: { count: number; mine: boolean }) {
  document.querySelectorAll<HTMLButtonElement>('[data-cooked-toggle]').forEach((b) => {
    b.setAttribute('aria-pressed', String(c.mine));
    b.textContent = c.mine ? '✓ Сготвих тази рецепта' : 'Сготвих тази рецепта';
  });
  document.querySelectorAll<HTMLElement>('[data-cooked-count]').forEach((n) => {
    n.hidden = !c.count;
    n.textContent = c.count ? `Отбелязана като сготвена от ${plural(c.count, 'посетител', 'посетители')} (отметките не са проверени).` : '';
  });
}

async function load() {
  try {
    state = (await call(`/api/public/recipes/${slug}/community`, 'GET')) as Community;
    const total = (function walk(a: Cm[]): number { return a.reduce((n, c) => n + (c.pending ? 0 : 1) + walk(c.replies), 0); })(state.comments);
    renderRating(state.rating, total); renderComments(state.comments); renderCooked(state.cooked);
    if (root) $('[data-community-error]')!.hidden = true;
  } catch {
    if (root) { $('[data-community-error]')!.hidden = false; root.querySelectorAll('button, input, textarea').forEach((e) => ((e as HTMLButtonElement).disabled = true)); }
  }
}

root?.querySelectorAll<HTMLButtonElement>('[data-score]').forEach((b) => b.addEventListener('click', async () => {
  const status = $('[data-rating-status]')!;
  try {
    const r = await call(`/api/public/recipes/${slug}/rating`, 'POST', { score: Number(b.dataset.score) });
    status.textContent = r.changed ? 'Оценката ви е променена. Благодарим!' : 'Благодарим за оценката!';
    state = state ?? ({ comments: [], cooked: { count: 0, mine: false }, limits: { maxDepth: 3 } } as unknown as Community);
    state.rating = r.rating; renderRating(r.rating, document.querySelectorAll('#komentari .comment:not(.is-pending)').length);
  } catch (e) { status.textContent = (e as Error).message; }
}));

const form = root?.querySelector<HTMLFormElement>('[data-comment-form]');
if (form) {
  try { (form.elements.namedItem('name') as HTMLInputElement).value = localStorage.getItem('community-name') ?? ''; } catch { /* без съхранение */ }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('[data-form-status]')!;
    const fd = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const btn = form.querySelector<HTMLButtonElement>('[type=submit]')!; btn.disabled = true;
    try {
      const r = await call(`/api/public/recipes/${slug}/comments`, 'POST', fd);
      status.textContent = r.message;
      try { localStorage.setItem('community-name', fd.name); } catch { /* */ }
      (form.elements.namedItem('body') as HTMLTextAreaElement).value = '';
      await load();
    } catch (err) { status.textContent = (err as Error).message; }
    finally { btn.disabled = false; }
  });
}

// ---- Сготвих тази рецепта (отметка за този браузър; броят не е проверена статистика) ----
document.querySelectorAll<HTMLButtonElement>('[data-cooked-toggle]').forEach((b) => b.addEventListener('click', async () => {
  const on = b.getAttribute('aria-pressed') !== 'true';
  try { const r = await call(`/api/public/recipes/${slug}/cooked`, 'POST', { on }); renderCooked(r.cooked); } catch { b.textContent = 'Не може да се запише в момента'; }
}));

// ---- Любими (само в този браузър; без регистрация) ----
const FAV = 'favorites';
const favs = (): string[] => { try { return JSON.parse(localStorage.getItem(FAV) ?? '[]'); } catch { return []; } };
const setFavs = (a: string[]) => { try { localStorage.setItem(FAV, JSON.stringify(a)); } catch { /* без съхранение */ } };
document.querySelectorAll<HTMLButtonElement>('[data-fav-toggle]').forEach((b) => {
  const paint = () => { const on = favs().includes(slug); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '♥ В любими' : '♡ Запази в любими'; };
  b.addEventListener('click', () => { const f = favs(); setFavs(f.includes(slug) ? f.filter((x) => x !== slug) : [...f, slug]); paint(); });
  paint();
});

if (slug) load();
