// Централен модул за двуезичност (български / English): езици, адреси, речници, форматиране и таксономия.
// Български (bg) е оригиналният редакционен език; английският (en) е пълен превод на всяка публикувана рецепта.
import taxonomyData from './taxonomy.json';
import { bg, type UiKey } from './ui/bg';
import { en } from './ui/en';

export const locales = ['bg', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'bg';
export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (locales as readonly string[]).includes(v);

/** Езикови етикети по код (за hreflang, html lang, og:locale) */
export const localeInfo: Record<Locale, { lang: string; og: string; intl: string; name: string }> = {
  bg: { lang: 'bg', og: 'bg_BG', intl: 'bg-BG', name: 'Български' },
  en: { lang: 'en', og: 'en_GB', intl: 'en-GB', name: 'English' },
};

// ---------- Адреси ----------
export const routeSegments = {
  bg: {
    recipes: 'recepti', categories: 'kategorii', tags: 'etiketi', search: 'tursene', favorites: 'lyubimi', shopping: 'spisak',
    login: 'vhod', register: 'registratsia', forgot: 'zabravena-parola', reset: 'nova-parola', verify: 'potvarzhdenie',
    account: 'profil', moderation: 'moderatsia', privacy: 'poveritelnost',
  },
  en: {
    recipes: 'recipes', categories: 'categories', tags: 'tags', search: 'search', favorites: 'favorites', shopping: 'shopping-list',
    login: 'sign-in', register: 'register', forgot: 'forgot-password', reset: 'reset-password', verify: 'verify-email',
    account: 'account', moderation: 'moderation', privacy: 'privacy',
  },
} as const;
/** Лични и служебни страници: noindex и извън картата на сайта (вход, профил, модерация, любими) */
export const privateRoutes: RouteKey[] = ['favorites', 'login', 'register', 'forgot', 'reset', 'verify', 'account', 'moderation'];
export type RouteKey = keyof (typeof routeSegments)['bg'];

/** /bg/ , /en/recipes/ , /en/recipes/<slug>/  – винаги с наклонена черта накрая (trailingSlash: 'always') */
export function href(locale: Locale, route?: RouteKey, slug?: string): string {
  const parts: string[] = [locale];
  if (route) parts.push(routeSegments[locale][route]);
  if (slug) parts.push(slug);
  return `/${parts.join('/')}/`;
}

/** Страницата на другия език за същия ресурс (само маршрутът; адресът на рецепта/категория се определя от страницата). */
export const otherLocale = (l: Locale): Locale => (l === 'bg' ? 'en' : 'bg');

// ---------- Текстове ----------
const dict: Record<Locale, Record<UiKey, string>> = { bg, en };
export type { UiKey };

export function t(locale: Locale, key: UiKey, params?: Record<string, string | number>): string {
  let s = dict[locale][key] ?? dict.bg[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Множествено число по правилата на езика: ключове „<ключ>.one“ и „<ключ>.other“ */
export function tn(locale: Locale, key: string, n: number, params: Record<string, string | number> = {}): string {
  const form = new Intl.PluralRules(localeInfo[locale].intl).select(n) === 'one' ? 'one' : 'other';
  return t(locale, `${key}.${form}` as UiKey, { n, ...params });
}

export const useT = (locale: Locale) => ({
  t: (key: UiKey, params?: Record<string, string | number>) => t(locale, key, params),
  tn: (key: string, n: number, params?: Record<string, string | number>) => tn(locale, key, n, params),
});

// ---------- Форматиране ----------
export function formatMinutes(locale: Locale, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? t(locale, 'recipe.hours', { n: h }) : '', m || !h ? t(locale, 'recipe.minutes', { n: m }) : ''].filter(Boolean).join(' ');
}

export function formatDate(locale: Locale, d: Date): string {
  return new Intl.DateTimeFormat(localeInfo[locale].intl, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export const portionsLabel = (locale: Locale, n: number) => tn(locale, 'recipe.portions', n);

/** Количество с дроби: 1.5 -> „1½“ (bg: 0,4 / en: 0.4 за десетични) */
export function formatAmount(locale: Locale, n: number): string {
  const frac = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [0.333, '⅓'], [0.667, '⅔']] as const;
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  if (rest < 0.04) return String(whole);
  for (const [v, ch] of frac) if (Math.abs(rest - v) < 0.04) return (whole ? String(whole) : '') + ch;
  if (rest > 0.96) return String(whole + 1);
  const s = String(Math.round(n * 10) / 10);
  return locale === 'bg' ? s.replace('.', ',') : s;
}

/** Нормализира текст за търсене/филтър */
export const norm = (locale: Locale, s: string) => s.toLocaleLowerCase(localeInfo[locale].intl).normalize('NFC');

// ---------- Таксономия (стабилни ключове = българските стойности) ----------
export type TaxGroup = 'category' | 'method' | 'cuisine' | 'difficulty' | 'allergen' | 'tag' | 'unit';
const taxonomy = taxonomyData as unknown as Record<TaxGroup, Record<string, string>>;

/** Етикет на термин на дадения език. Българската стойност е ключът; ако няма превод, връща undefined. */
export function termLabel(locale: Locale, group: TaxGroup, bgValue: string): string | undefined {
  return locale === 'bg' ? bgValue : taxonomy[group]?.[bgValue];
}
export const hasTerm = (group: TaxGroup, bgValue: string) => bgValue in (taxonomy[group] ?? {});
export const taxonomyKeys = (group: TaxGroup) => Object.keys(taxonomy[group] ?? {});

const PLURAL_UNITS: Record<string, string> = { clove: 'cloves', bunch: 'bunches', head: 'heads', sprig: 'sprigs', pinch: 'pinches', slice: 'slices', leaf: 'leaves' };
/** Показвана мерна единица: английските формати за „скилидка/връзка…“ се членуват по количество (1 clove, 2 cloves). */
export function unitLabel(locale: Locale, unit: string | undefined, amount?: number): string {
  if (!unit) return '';
  if (locale === 'bg') return unit;
  return amount !== undefined && Math.abs(amount - 1) > 1e-9 && unit in PLURAL_UNITS ? PLURAL_UNITS[unit] : unit;
}
