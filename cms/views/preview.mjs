// Преглед на чернова (на български или на английски): същата структура и класове като публичната страница на рецептата
// (src/views/RecipePage.astro) и същите стилове, но с обикновени <img> към временни умалени копия. Не е „пикселно“ идентичен
// (без srcset, лайтбокс и режим „готвене“); окончателният вид се проверява след публикуване.
import { esc } from '../lib/util.mjs';
import { COLLECTIONS, STATUSES, PUBLICATIONS, listPhotoFiles } from '../lib/recipes.mjs';

const L = {
  bg: {
    lang: 'bg', min: 'мин', h: 'ч', dec: ',', bar: 'ПРЕГЛЕД', barText: 'Това не е публичната страница. Видът след публикуване може леко да се различава (без лайтбокс, режим „готвене“ и фото-история).', back: '← Обратно към редактора',
    home: 'Начало', recipes: 'Рецепти', crumb: 'Път до страницата', draftNote: 'Рецептата е чернова и чака проверка.', prep: 'Подготовка', cook: 'Готвене', rest: 'Почивка', total: 'Общо', servings: 'Порции', difficulty: 'Трудност',
    illustrative: 'Илюстративни снимки', illustrativeText: 'Снимките са илюстративни (например генерирани с изкуствен интелект) и не са от реално приготвяне.', ingredients: 'Съставки', method: 'Приготвяне',
    why: 'Защо:', cue: 'Как разбираш, че е готово:', avoid: 'Избягвай:', chef: 'Техника и контрол', technique: 'Основна техника', temperature: 'Контрол на температурата', balance: 'Консистенция, текстура и баланс на вкуса',
    advice: 'Съвети от шефа', tips: 'Съвети', mistakes: 'Чести грешки', substitutions: 'Заместители', serve: 'Поднасяне', plating: 'Поднасяне в чиния', serving: 'Сервиране', storage: 'Съхранение и претопляне', note: 'Бележка:',
    allergens: 'Възможни алергени (редакционна индикация по съставките – не е проверена):', more: 'Още снимки', tags: 'Етикети', collections: COLLECTIONS, statuses: STATUSES,
  },
  en: {
    lang: 'en', min: 'min', h: 'h', dec: '.', bar: 'PREVIEW (ENGLISH)', barText: 'This is not the public page. The published page may differ slightly (no lightbox, cooking mode or photo story). A translation is published only when its status is “Published”.', back: '← Back to the translation editor',
    home: 'Home', recipes: 'Recipes', crumb: 'Breadcrumb', draftNote: 'This recipe is a draft awaiting review.', prep: 'Prep', cook: 'Cook', rest: 'Rest', total: 'Total', servings: 'Servings', difficulty: 'Difficulty',
    illustrative: 'Illustrative photos', illustrativeText: 'The photos for this recipe are illustrative – generated with artificial intelligence. They show the idea of each step, but they are not photos of a dish that was actually cooked.', ingredients: 'Ingredients', method: 'Method',
    why: 'Why:', cue: 'How to tell it is ready:', avoid: 'Avoid:', chef: 'Technique and control', technique: 'Core technique', temperature: 'Temperature control', balance: 'Consistency, texture and balance of flavour',
    advice: 'Chef’s advice', tips: 'Tips', mistakes: 'Common mistakes', substitutions: 'Substitutions', serve: 'Serving', plating: 'Plating', serving: 'Serving suggestions', storage: 'Storage and reheating', note: 'Note:',
    allergens: 'Possible allergens (an editorial indication based on the ingredients – not verified):', more: 'More photos', tags: 'Tags',
    collections: { traditional: 'Traditional Bulgarian Cuisine', 'fine-dining': 'Contemporary Interpretations and Fine Dining' },
    statuses: { verified: 'Verified against a source', reconstruction: 'Chef’s reconstruction – awaiting verification', review: 'Awaiting editorial review', incomplete: 'Incomplete recipe' },
  },
};

const UNIT_PLURAL = { clove: 'cloves', bunch: 'bunches', head: 'heads', sprig: 'sprigs', pinch: 'pinches', slice: 'slices', leaf: 'leaves' };

function fmtAmount(n, dec) {
  const frac = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [0.333, '⅓'], [0.667, '⅔']];
  const whole = Math.floor(n + 1e-9), rest = n - whole;
  if (rest < 0.04) return String(whole);
  for (const [v, ch] of frac) if (Math.abs(rest - v) < 0.04) return (whole ? String(whole) : '') + ch;
  if (rest > 0.96) return String(whole + 1);
  return String(Math.round(n * 10) / 10).replace('.', dec);
}

export function renderPreview(ctx, { slug, data: d, body }, { lang = 'bg', publication = null } = {}) {
  const T = L[lang] ?? L.bg;
  const fmtMin = (m) => { const h = Math.floor(m / 60), r = m % 60; return [h ? `${h} ${T.h}` : '', r || !h ? `${r} ${T.min}` : ''].filter(Boolean).join(' '); };
  const files = listPhotoFiles(ctx, slug);
  const meta = (f) => d.photos?.[f] ?? { alt: '' };
  const src = (f) => `/admin/media/photo/${encodeURIComponent(slug)}/${encodeURIComponent(f)}`;
  const img = (f, cls = '') => `<img class="${cls}" src="${src(f)}" alt="${esc(meta(f).alt)}" loading="lazy" style="width:100%;height:auto">`;
  const total = (d.prepTime ?? 0) + (d.cookTime ?? 0) + (d.restTime ?? 0);
  const cover = d.cover && files.includes(d.cover) ? d.cover : files[0];
  const stepFiles = new Set((d.steps ?? []).map((s) => s.photo).filter(Boolean));
  const extras = files.filter((f) => f !== cover && !stepFiles.has(f));
  const unit = (u, a) => (lang === 'en' && a !== undefined && Math.abs(a - 1) > 1e-9 && UNIT_PLURAL[u] ? UNIT_PLURAL[u] : u);
  const ing = (d.ingredients ?? []).map((g) => `${g.title ? `<h3>${esc(g.title)}</h3>` : ''}<ul class="ing-list">${g.items.map((i) => {
    const text = typeof i === 'string' ? i : [i.amount ? fmtAmount(i.amount, T.dec) : '', unit(i.unit, i.amount), i.name].filter(Boolean).join(' ') + (i.note ? ` (${i.note})` : '');
    return `<li><label><span class="ing-text">${esc(text)}</span></label></li>`;
  }).join('')}</ul>`).join('');
  const steps = (d.steps ?? []).map((s, i) => `<li class="step" id="stapka-${i + 1}"><div class="step-body">
    ${s.title ? `<h3>${esc(s.title)}${s.time ? `<span class="step-time"> · ${fmtMin(s.time)}</span>` : ''}</h3>` : ''}
    <p class="step-text">${esc(s.text)}</p>
    ${s.why ? `<p class="step-note"><strong>${T.why}</strong> ${esc(s.why)}</p>` : ''}
    ${s.cue ? `<p class="step-note"><strong>${T.cue}</strong> ${esc(s.cue)}</p>` : ''}
    ${s.avoid ? `<p class="step-note avoid"><strong>${T.avoid}</strong> ${esc(s.avoid)}</p>` : ''}
  </div>${s.photo && files.includes(s.photo) ? `<figure class="step-photo">${img(s.photo)}${meta(s.photo).caption ? `<figcaption>${esc(meta(s.photo).caption)}</figcaption>` : ''}</figure>` : ''}</li>`).join('');
  const chef = [[T.technique, d.technique], [T.temperature, d.temperature], [T.balance, d.balance]].filter((x) => x[1]);
  const lists = [[T.tips, d.tips], [T.mistakes, d.mistakes], [T.substitutions, d.substitutions]].filter((x) => x[1]?.length);
  const serve = [[T.plating, d.plating], [T.serving, d.serving], [T.storage, d.storage]].filter((x) => x[1]);
  const pub = publication ?? d.publication ?? 'published';
  const editUrl = lang === 'en' ? `/admin/recipes/${esc(slug)}/translation` : `/admin/recipes/${esc(slug)}/edit`;

  return `<!doctype html>
<html lang="${T.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${esc(T.bar)}: ${esc(d.title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/admin/assets/site.css">
<link rel="stylesheet" href="/admin/assets/preview.css">
</head><body>
<div class="preview-bar" role="note"><strong>${esc(T.bar)} – ${esc(PUBLICATIONS[pub] ?? pub)}.</strong> ${esc(T.barText)}
 <a href="${editUrl}">${esc(T.back)}</a></div>
<main id="main"><article class="wrap recipe">
  <nav class="breadcrumb" aria-label="${esc(T.crumb)}"><ol><li>${T.home}</li><li>${T.recipes}</li><li aria-current="page">${esc(d.title)}</li></ol></nav>
  ${d.review ? `<div class="notice" role="note"><strong>${esc(T.statuses[d.status] ?? '')}</strong><p>${esc(T.draftNote)}</p></div>` : ''}
  <header class="recipe-head"><div>
    <p class="eyebrow">${esc(T.collections[d.collection] ?? '')}</p><h1>${esc(d.title)}</h1><p class="lead">${esc(d.description)}</p>${d.intro ? `<p class="intro">${esc(d.intro)}</p>` : ''}
    <dl class="facts"><div><dt>${T.prep}</dt><dd>${fmtMin(d.prepTime ?? 0)}</dd></div><div><dt>${T.cook}</dt><dd>${fmtMin(d.cookTime ?? 0)}</dd></div>
    ${d.restTime ? `<div><dt>${T.rest}</dt><dd>${fmtMin(d.restTime)}</dd></div>` : ''}<div><dt>${T.total}</dt><dd>${fmtMin(total)}</dd></div><div><dt>${T.servings}</dt><dd>${d.servings}</dd></div>${d.difficulty ? `<div><dt>${T.difficulty}</dt><dd>${esc(d.difficulty)}</dd></div>` : ''}</dl>
    <p class="muted meta-line">${esc(d.category)}${d.method?.length ? ' · ' + esc(d.method.join(', ')) : ''}${d.cuisine ? ' · ' + esc(d.cuisine) : ''}</p>
  </div>${cover ? `<figure class="hero-fig">${img(cover, 'hero-photo')}${d.illustrative ? `<p class="photo-note"><span class="badge">${T.illustrative}</span></p>` : ''}</figure>` : ''}</header>
  ${d.illustrative ? `<div class="notice illustrative" role="note"><strong>${T.illustrative}</strong><p>${esc(T.illustrativeText)}</p></div>` : ''}
  <div class="recipe-grid">
    <section class="ingredients" aria-labelledby="h-s"><h2 id="h-s">${T.ingredients}</h2>${ing}${d.mise?.length ? `<div class="mise"><h3>Mise en place</h3><ul>${d.mise.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}</section>
    <section class="method" aria-labelledby="h-p"><h2 id="h-p">${T.method}</h2><ol class="steps">${steps}</ol></section>
  </div>
  ${chef.length ? `<section class="chef"><h2>${T.chef}</h2><div class="chef-grid">${chef.map(([h, t]) => `<div class="chef-card"><h3>${esc(h)}</h3><p>${esc(t)}</p></div>`).join('')}</div></section>` : ''}
  ${lists.length ? `<section class="advice"><h2>${T.advice}</h2><div class="chef-grid">${lists.map(([h, l]) => `<div class="chef-card"><h3>${esc(h)}</h3><ul>${l.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div></section>` : ''}
  ${serve.length ? `<section class="serve"><h2>${T.serve}</h2><dl class="serve-list">${serve.map(([h, t]) => `<div><dt>${esc(h)}</dt><dd>${esc(t)}</dd></div>`).join('')}</dl></section>` : ''}
  ${d.context ? `<p class="notice small-notice" role="note"><strong>${T.note}</strong> ${esc(d.context)}</p>` : ''}
  ${body ? `<section class="notes-md"><pre class="preview-notes">${esc(body)}</pre></section>` : ''}
  ${d.allergens?.length ? `<p class="allergens"><strong>${T.allergens}</strong> ${esc(d.allergens.join(', '))}.</p>` : ''}
  ${extras.length ? `<section class="more-photos"><h2>${T.more} (${extras.length})</h2><ul class="thumbs">${extras.map((f) => `<li>${img(f)}</li>`).join('')}</ul></section>` : ''}
  ${d.tags?.length ? `<section class="tags"><h2>${T.tags}</h2><ul class="chips">${d.tags.map((t) => `<li><span>${esc(t)}</span></li>`).join('')}</ul></section>` : ''}
</article></main></body></html>`;
}
