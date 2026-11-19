// Малки помощни функции: екраниране на HTML, адреси (slug), време, JSON.
const map = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h',
  ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

/** Същата транслитерация като в сайта (src/lib/text.ts) – адресите съвпадат с вече публикуваните. */
export function slugify(input) {
  return [...String(input).toLowerCase()].map((c) => map[c] ?? c).join('')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Низ, безопасен за вграждане в <script type="application/json"> */
export const jsonForHtml = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export const now = () => Date.now();

export function fmtDate(ms) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' }).format(new Date(ms));
}
export function fmtDay(ms) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Sofia' }).format(new Date(ms));
}

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function plural(n, one, many) { return n === 1 ? `1 ${one}` : `${n} ${many}`; }

import fs from 'node:fs';
/** Преместване на файл или папка и между различни файлови системи (rename → EXDEV → копиране + изтриване). */
export function moveSync(src, dest) {
  try { fs.renameSync(src, dest); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}
