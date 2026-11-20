// Помощници за скриптовете в браузъра: езикът се взема от <html data-locale>, текстовете – от същите речници като на сървъра.
import { t, tn, isLocale, defaultLocale, localeInfo, href, type Locale, type UiKey, type RouteKey } from './index';

const fromDom = document.documentElement.dataset.locale;
export const locale: Locale = isLocale(fromDom) ? fromDom : defaultLocale;
export const intl = localeInfo[locale].intl;

export const tc = (key: UiKey, params?: Record<string, string | number>) => t(locale, key, params);
export const tnc = (key: string, n: number, params?: Record<string, string | number>) => tn(locale, key, n, params);
export const hrefc = (route?: RouteKey, slug?: string) => href(locale, route, slug);
/** Десетичен разделител по езика: 4.5 -> „4,5“ (bg) / „4.5“ (en) */
export const num = (n: number) => (locale === 'bg' ? String(n).replace('.', ',') : String(n));
