// Преглед на чернова: същата структура и класове като страницата на рецептата (src/pages/recepti/[slug].astro) и същите стилове,
// но с обикновени <img> към временни умалени копия. Не е „пикселно“ идентичен (без srcset, лайтбокс и режим „готвене“); окончателният вид се проверява след публикуване.
import { esc } from '../lib/util.mjs';
import { COLLECTIONS, STATUSES, PUBLICATIONS, listPhotoFiles } from '../lib/recipes.mjs';

const fmtMin = (m) => { const h = Math.floor(m / 60), r = m % 60; return [h ? `${h} ч` : '', r || !h ? `${r} мин` : ''].filter(Boolean).join(' '); };
function fmtAmount(n) {
  const frac = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [0.333, '⅓'], [0.667, '⅔']];
  const whole = Math.floor(n + 1e-9), rest = n - whole;
  if (rest < 0.04) return String(whole);
  for (const [v, ch] of frac) if (Math.abs(rest - v) < 0.04) return (whole ? String(whole) : '') + ch;
  if (rest > 0.96) return String(whole + 1);
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

export function renderPreview(ctx, { slug, data: d, body }) {
  const files = listPhotoFiles(ctx, slug);
  const meta = (f) => d.photos?.[f] ?? { alt: '' };
  const src = (f) => `/admin/media/photo/${encodeURIComponent(slug)}/${encodeURIComponent(f)}`;
  const img = (f, cls = '') => `<img class="${cls}" src="${src(f)}" alt="${esc(meta(f).alt)}" loading="lazy" style="width:100%;height:auto">`;
  const total = (d.prepTime ?? 0) + (d.cookTime ?? 0) + (d.restTime ?? 0);
  const cover = d.cover && files.includes(d.cover) ? d.cover : files[0];
  const stepFiles = new Set((d.steps ?? []).map((s) => s.photo).filter(Boolean));
  const extras = files.filter((f) => f !== cover && !stepFiles.has(f));
  const ing = (d.ingredients ?? []).map((g) => `${g.title ? `<h3>${esc(g.title)}</h3>` : ''}<ul class="ing-list">${g.items.map((i) => {
    const text = typeof i === 'string' ? i : [i.amount ? fmtAmount(i.amount) : '', i.unit, i.name].filter(Boolean).join(' ') + (i.note ? ` (${i.note})` : '');
    return `<li><label><span class="ing-text">${esc(text)}</span></label></li>`;
  }).join('')}</ul>`).join('');
  const steps = (d.steps ?? []).map((s, i) => `<li class="step" id="stapka-${i + 1}"><div class="step-body">
    ${s.title ? `<h3>${esc(s.title)}${s.time ? `<span class="step-time"> · ${fmtMin(s.time)}</span>` : ''}</h3>` : ''}
    <p class="step-text">${esc(s.text)}</p>
    ${s.why ? `<p class="step-note"><strong>Защо:</strong> ${esc(s.why)}</p>` : ''}
    ${s.cue ? `<p class="step-note"><strong>Как разбираш, че е готово:</strong> ${esc(s.cue)}</p>` : ''}
    ${s.avoid ? `<p class="step-note avoid"><strong>Избягвай:</strong> ${esc(s.avoid)}</p>` : ''}
  </div>${s.photo && files.includes(s.photo) ? `<figure class="step-photo">${img(s.photo)}${meta(s.photo).caption ? `<figcaption>${esc(meta(s.photo).caption)}</figcaption>` : ''}</figure>` : ''}</li>`).join('');
  const chef = [['Основна техника', d.technique], ['Контрол на температурата', d.temperature], ['Консистенция, текстура и баланс на вкуса', d.balance]].filter((x) => x[1]);
  const lists = [['Съвети', d.tips], ['Чести грешки', d.mistakes], ['Заместители', d.substitutions]].filter((x) => x[1]?.length);
  const serve = [['Поднасяне в чиния', d.plating], ['Сервиране', d.serving], ['Съхранение и претопляне', d.storage]].filter((x) => x[1]);
  const pub = d.publication ?? 'published';

  return `<!doctype html>
<html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Преглед: ${esc(d.title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/admin/assets/site.css">
<link rel="stylesheet" href="/admin/assets/preview.css">
</head><body>
<div class="preview-bar" role="note"><strong>ПРЕГЛЕД – ${esc(PUBLICATIONS[pub])}.</strong> Това не е публичната страница. Видът след публикуване може леко да се различава (без лайтбокс, режим „готвене“ и фото-история).
 <a href="/admin/recipes/${esc(slug)}/edit">← Обратно към редактора</a></div>
<main id="main"><article class="wrap recipe">
  <nav class="breadcrumb" aria-label="Път до страницата"><ol><li>Начало</li><li>Рецепти</li><li aria-current="page">${esc(d.title)}</li></ol></nav>
  ${d.review ? `<div class="notice" role="note"><strong>${esc(STATUSES[d.status] ?? '')}</strong><p>Рецептата е чернова и чака проверка.</p></div>` : ''}
  <header class="recipe-head"><div>
    <p class="eyebrow">${esc(COLLECTIONS[d.collection] ?? '')}</p><h1>${esc(d.title)}</h1><p class="lead">${esc(d.description)}</p>${d.intro ? `<p class="intro">${esc(d.intro)}</p>` : ''}
    <dl class="facts"><div><dt>Подготовка</dt><dd>${fmtMin(d.prepTime ?? 0)}</dd></div><div><dt>Готвене</dt><dd>${fmtMin(d.cookTime ?? 0)}</dd></div>
    ${d.restTime ? `<div><dt>Почивка</dt><dd>${fmtMin(d.restTime)}</dd></div>` : ''}<div><dt>Общо</dt><dd>${fmtMin(total)}</dd></div><div><dt>Порции</dt><dd>${d.servings}</dd></div>${d.difficulty ? `<div><dt>Трудност</dt><dd>${esc(d.difficulty)}</dd></div>` : ''}</dl>
    <p class="muted meta-line">${esc(d.category)}${d.method?.length ? ' · ' + esc(d.method.join(', ')) : ''}${d.cuisine ? ' · ' + esc(d.cuisine) : ''}</p>
  </div>${cover ? `<figure class="hero-fig">${img(cover, 'hero-photo')}${d.illustrative ? '<p class="photo-note"><span class="badge">Илюстративни снимки</span></p>' : ''}</figure>` : ''}</header>
  ${d.illustrative ? '<div class="notice illustrative" role="note"><strong>Илюстративни снимки</strong><p>Снимките са илюстративни (например генерирани с изкуствен интелект) и не са от реално приготвяне.</p></div>' : ''}
  <div class="recipe-grid">
    <section class="ingredients" aria-labelledby="h-s"><h2 id="h-s">Съставки</h2>${ing}${d.mise?.length ? `<div class="mise"><h3>Mise en place</h3><ul>${d.mise.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}</section>
    <section class="method" aria-labelledby="h-p"><h2 id="h-p">Приготвяне</h2><ol class="steps">${steps}</ol></section>
  </div>
  ${chef.length ? `<section class="chef"><h2>Техника и контрол</h2><div class="chef-grid">${chef.map(([h, t]) => `<div class="chef-card"><h3>${esc(h)}</h3><p>${esc(t)}</p></div>`).join('')}</div></section>` : ''}
  ${lists.length ? `<section class="advice"><h2>Съвети от шефа</h2><div class="chef-grid">${lists.map(([h, l]) => `<div class="chef-card"><h3>${esc(h)}</h3><ul>${l.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div></section>` : ''}
  ${serve.length ? `<section class="serve"><h2>Поднасяне</h2><dl class="serve-list">${serve.map(([h, t]) => `<div><dt>${esc(h)}</dt><dd>${esc(t)}</dd></div>`).join('')}</dl></section>` : ''}
  ${d.context ? `<p class="notice small-notice" role="note"><strong>Бележка:</strong> ${esc(d.context)}</p>` : ''}
  ${body ? `<section class="notes-md"><pre class="preview-notes">${esc(body)}</pre></section>` : ''}
  ${d.allergens?.length ? `<p class="allergens"><strong>Възможни алергени (редакционна индикация по съставките – не е проверена):</strong> ${esc(d.allergens.join(', '))}.</p>` : ''}
  ${extras.length ? `<section class="more-photos"><h2>Още снимки (${extras.length})</h2><ul class="thumbs">${extras.map((f) => `<li>${img(f)}</li>`).join('')}</ul></section>` : ''}
  ${d.tags?.length ? `<section class="tags"><h2>Етикети</h2><ul class="chips">${d.tags.map((t) => `<li><span>${esc(t)}</span></li>`).join('')}</ul></section>` : ''}
</article></main></body></html>`;
}
