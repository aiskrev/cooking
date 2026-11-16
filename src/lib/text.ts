// Транслитерация (Streamlined System) за адреси: „Основни ястия“ -> „osnovni-yastiya“
const map: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h',
  ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

export function slugify(input: string): string {
  const out = [...input.toLowerCase()].map((c) => map[c] ?? c).join('');
  return out
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** ISO 8601 продължителност за schema.org: 105 -> PT1H45M */
export function isoDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return 'PT' + (h ? `${h}H` : '') + (m || !h ? `${m}M` : '');
}

/** 105 -> „1 ч 45 мин“ */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} ч` : '', m || !h ? `${m} мин` : ''].filter(Boolean).join(' ');
}

export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export function pluralPortions(n: number): string {
  return n === 1 ? '1 порция' : `${n} порции`;
}
