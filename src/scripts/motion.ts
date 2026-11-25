// Малка система за движение (без външни библиотеки): поява при превъртане, паралакс на заглавната снимка,
// хоризонтално „пътешествие“, водено от превъртането, плъзгачи с карти, активен раздел в рецептата и сянка на заглавката.
// Принципи:
//  • Съдържанието никога не зависи от анимацията: скриват се само елементи под видимата част, и то едва когато скриптът работи.
//  • prefers-reduced-motion: без поява, паралакс и закачени секции – всичко е статично (CSS спира и анимациите).
//  • Анимират се само transform и opacity; слушателите на превъртане са пасивни и минават през requestAnimationFrame.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;

// ---------- Сянка на заглавката след началото на страницата ----------
const header = document.querySelector<HTMLElement>('.site-header');
const syncHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
syncHeader();
window.addEventListener('scroll', syncHeader, { passive: true });
// Реалната височина на заглавката (на телефон е на два реда) – за залепените елементи под нея
const setHeaderH = () => { if (header) root.style.setProperty('--header-h', `${header.offsetHeight}px`); };
setHeaderH();
window.addEventListener('resize', setHeaderH, { passive: true });

// ---------- Поява при превъртане ----------
function setupReveal() {
  if (reduced.matches || !('IntersectionObserver' in window)) return;
  const targets: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => targets.push(el));
  document.querySelectorAll<HTMLElement>('[data-reveal-group]').forEach((g) => {
    [...g.children].forEach((el, i) => {
      (el as HTMLElement).style.setProperty('--rv-i', String(i % 4));
      targets.push(el as HTMLElement);
    });
  });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.remove('rv');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
  const limit = window.innerHeight * 0.94;
  for (const el of targets) {
    // Само елементите под видимата част; видимото при зареждане не мига
    if (el.getBoundingClientRect().top > limit) { el.classList.add('rv'); io.observe(el); }
  }
  // Преди печат и при смяна на предпочитанието – всичко видимо
  const showAll = () => { document.querySelectorAll('.rv').forEach((el) => el.classList.remove('rv')); io.disconnect(); };
  window.addEventListener('beforeprint', showAll);
  reduced.addEventListener?.('change', showAll);
}

// ---------- Паралакс на заглавната снимка (само на широк екран) ----------
function setupHero() {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero) return;
  const wide = window.matchMedia('(min-width: 900px)');
  let ticking = false;
  const update = () => {
    ticking = false;
    if (reduced.matches || !wide.matches) { hero.style.removeProperty('--hp'); return; }
    const h = hero.offsetHeight || 1;
    const p = Math.min(1, Math.max(0, window.scrollY / h));
    hero.style.setProperty('--hp', p.toFixed(4));
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  wide.addEventListener?.('change', update);
  reduced.addEventListener?.('change', update);
  update();
}

// ---------- Фотографско пътешествие ----------
// На компютър всички кадри стоят на един ред като банер (само CSS). Когато лентата се плъзга хоризонтално (телефон, таблет),
// линията под нея показва докъде е стигнал посетителят. Вертикалното превъртане никога не се задържа.
function setupJourney() {
  document.querySelectorAll<HTMLElement>('[data-journey]').forEach((sec) => {
    const viewport = sec.querySelector<HTMLElement>('[data-journey-viewport]')!;
    let ticking = false;
    const progress = () => {
      ticking = false;
      const max = viewport.scrollWidth - viewport.clientWidth;
      sec.classList.toggle('is-scrollable', max > 4);
      sec.style.setProperty('--jp', max > 4 ? (viewport.scrollLeft / max).toFixed(4) : '1');
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(progress); } };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    progress();
  });
}

// ---------- Плъзгачи с карти (бутони „назад/напред“) ----------
function setupRails() {
  document.querySelectorAll<HTMLElement>('[data-rail]').forEach((rail) => {
    const track = rail.querySelector<HTMLElement>('[data-rail-track]')!;
    const prev = rail.querySelector<HTMLButtonElement>('[data-rail-prev]');
    const next = rail.querySelector<HTMLButtonElement>('[data-rail-next]');
    const step = () => Math.max(track.clientWidth * 0.8, 240);
    const behavior = (): ScrollBehavior => (reduced.matches ? 'auto' : 'smooth');
    const sync = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max;
    };
    prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: behavior() }));
    next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: behavior() }));
    track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    sync();
  });
}

// ---------- Активен раздел в навигацията на рецептата ----------
function setupPageNav() {
  const nav = document.querySelector<HTMLElement>('.page-nav');
  if (!nav) return;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter((s): s is HTMLElement => !!s);
  if (!sections.length) return;
  // Точката за измерване на раздел: залепените съставки се мерят по мрежата, в която са (иначе „стоят“ винаги горе),
  // а „Приготвяне“ – по първата стъпка (съставките и стъпките започват на един ред на компютър).
  const anchor = (s: HTMLElement) => (getComputedStyle(s).position === 'sticky' ? s.parentElement ?? s : s.querySelector<HTMLElement>('.step') ?? s);
  let ticking = false;
  const update = () => {
    ticking = false;
    const line = window.innerHeight * 0.35;
    // Текущ е разделът с най-долно начало, което вече е над линията на 35% от екрана
    let current: HTMLElement | undefined;
    let best = -Infinity;
    for (const s of sections) {
      const top = anchor(s).getBoundingClientRect().top;
      if (top <= line && top >= best) { best = top; current = s; }
    }
    links.forEach((a) => {
      const on = !!current && a.hash === `#${current.id}`;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

setupReveal();
setupHero();
setupJourney();
setupRails();
setupPageNav();
