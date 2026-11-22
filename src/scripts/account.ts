// Общи помощници за профила в браузъра: текуща сесия, заявки с CSRF токен, сливане на любимите от браузъра.
// Сесията е в HttpOnly бисквитка (недостъпна за скриптовете). Бисквитката-подсказка „mstate“ казва само, че има вход –
// без нея страниците не питат сървъра (гостите не правят никакви заявки за профил).
import { locale } from '../i18n/client';

export type Role = 'user' | 'moderator' | 'admin';
export interface Me { id: number; email: string; displayName: string; role: Role; locale: 'bg' | 'en'; emailVerified: boolean; createdAt: number }
interface MeResponse { user: Me | null; csrf?: string; mail?: boolean; sessions?: number }

let csrf = '';
let mePromise: Promise<MeResponse> | null = null;

export const hasSessionHint = () => { try { return /(?:^|;\s*)mstate=1/.test(document.cookie); } catch { return false; } };

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/** Заявка към API: езикът на съобщенията, JSON, CSRF токен за промени. */
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-site-language': locale };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  let data: any = null;
  try { data = await res.json(); } catch { /* не е JSON */ }
  if (data?.csrf) csrf = data.csrf;
  if (!res.ok) {
    if (res.status === 401) { mePromise = Promise.resolve({ user: null }); document.dispatchEvent(new CustomEvent('account:change', { detail: null })); }
    throw new ApiError(data?.error || 'Error', res.status, data?.code);
  }
  return data as T;
}

/** Текущият потребител (кешира се за страницата). force – питай сървъра и без бисквитката-подсказка. */
export function getMe(force = false): Promise<MeResponse> {
  if (!force && !hasSessionHint()) return Promise.resolve({ user: null });
  mePromise ??= api<MeResponse>('/api/account/me').catch(() => ({ user: null }));
  return mePromise;
}

export function setSession(r: MeResponse) {
  if (r.csrf) csrf = r.csrf;
  mePromise = Promise.resolve(r);
  document.dispatchEvent(new CustomEvent('account:change', { detail: r.user }));
}

export async function signOut() {
  await getMe();
  try { await api('/api/account/logout', 'POST', {}); } catch { /* бисквитките се изчистват и при грешка */ }
  mePromise = Promise.resolve({ user: null });
  document.dispatchEvent(new CustomEvent('account:change', { detail: null }));
}

// ---------- Любими: в браузъра за гости, в профила за влезли ----------
const FAV = 'favorites';
const SYNCED = 'favorites-synced';
const readList = (k: string): string[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
export const localFavorites = () => readList(FAV);
export const setLocalFavorites = (a: string[]) => { try { localStorage.setItem(FAV, JSON.stringify(a)); } catch { /* без съхранение */ } };

/**
 * Сливане след вход: изпраща само любимите от браузъра, които още не са изпращани (за да не „възкръсват“ премахнатите в профила).
 * Сървърът само добавя – празен или стар списък от браузъра никога не изтрива любими от профила.
 */
export async function mergeLocalFavorites(userId: number): Promise<number> {
  const key = `${SYNCED}:${userId}`;
  const sent = new Set(readList(key));
  const pending = localFavorites().filter((s) => !sent.has(s));
  if (!pending.length) return 0;
  const r = await api<{ added: number }>('/api/account/favorites/merge', 'POST', { slugs: pending });
  try { localStorage.setItem(key, JSON.stringify([...sent, ...pending])); } catch { /* */ }
  return r.added;
}

/** Безопасна цел след вход: само относителен адрес на този сайт (/bg/… или /en/…), никога външен (без „отворено пренасочване“). */
export function safeNext(raw: string | null, fallback: string): string {
  if (!raw || !/^\/(bg|en)\/[^\s\\]*$/.test(raw) || raw.startsWith('//')) return fallback;
  try { const u = new URL(raw, location.origin); return u.origin === location.origin ? u.pathname + u.search + u.hash : fallback; } catch { return fallback; }
}
