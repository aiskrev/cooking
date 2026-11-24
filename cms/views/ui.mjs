// Общо оформление на страниците на администрацията (сървърно изобразяване, без вграден JavaScript – CSP позволява само 'self').
import { esc, jsonForHtml } from '../lib/util.mjs';

const NAV = [
  ['/admin', 'Табло', 'dashboard'],
  ['/admin/recipes', 'Рецепти', 'recipes'],
  ['/admin/recipes/new', 'Нова рецепта', 'new'],
  ['/admin/media', 'Медия', 'media'],
  ['/admin/categories', 'Категории', 'categories'],
  ['/admin/comments', 'Коментари', 'comments'],
  ['/admin/ratings', 'Оценки', 'ratings'],
  ['/admin/publish', 'Публикуване', 'publish'],
  ['/admin/settings', 'Настройки', 'settings'],
];

export function layout({ title, body, user, csrf, active, scripts = [], badges = {}, data = null, wide = false }) {
  const nav = NAV.map(([href, label, key]) => {
    const n = badges[key];
    return `<li><a href="${href}"${active === key ? ' aria-current="page"' : ''}><span>${esc(label)}</span>${n ? `<span class="count" aria-label="${n} чакащи">${n}</span>` : ''}</a></li>`;
  }).join('');
  return `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="csrf-token" content="${esc(csrf)}">
<title>${esc(title)} · Администрация</title>
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body class="admin">
<a class="skip" href="#main">Към съдържанието</a>
<div class="shell">
  <aside class="side">
    <a class="brand" href="/admin">Модерна кухня с Мишлен щрих<small>Администрация</small></a>
    <nav aria-label="Администрация"><ul class="nav">${nav}</ul></nav>
    <div class="side-foot">
      <a class="btn ghost small" href="/" target="_blank" rel="noopener">Към сайта ↗</a>
      <p class="muted small" style="margin:0">${esc(user.display_name)}<br>${esc(user.email)}</p>
      <form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn secondary small" type="submit">Изход</button></form>
    </div>
  </aside>
  <main id="main" class="content" tabindex="-1">
${body}
  </main>
</div>
${data ? `<script type="application/json" id="page-data">${jsonForHtml(data)}</script>` : ''}
${scripts.map((s) => `<script type="module" src="${esc(s)}"></script>`).join('\n')}
</body>
</html>`;
}

export function loginLayout({ title, body, csrf = '' }) {
  return `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Администрация</title>
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body class="admin login">
<main class="card login-card" id="main">
${body}
</main>
</body>
</html>`;
}

export const badge = (text, kind = '') => `<span class="badge${kind ? ' ' + kind : ''}">${esc(text)}</span>`;

export function pubBadge(p) {
  return p === 'published' ? badge('Публикувана', 'ok') : p === 'archived' ? badge('Архив') : badge('Чернова', 'warn');
}

export function notice(kind, html) { return `<div class="notice ${kind}" role="${kind === 'bad' ? 'alert' : 'status'}">${html}</div>`; }

export function stars(avg) {
  const full = Math.round(avg);
  return `<span class="stars" aria-hidden="true">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
}

/** Таблица от редове; празно състояние, когато няма данни. */
export function table(headers, rows, empty = 'Няма данни.') {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="tablewrap"><table><thead><tr>${headers.map((h) => (h.startsWith('~') ? `<th scope="col"><span class="sr-only">${esc(h.slice(1))}</span></th>` : `<th scope="col">${esc(h)}</th>`)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
