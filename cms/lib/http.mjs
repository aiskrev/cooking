// Общи помощни функции за HTTP: клиентски IP, бисквитки, проверка на произхода, сигурностни заглавия.
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { safeEq } from './crypto.mjs';

export function clientIp(c) {
  // Услугата не е публикувана на хоста: заявките идват само през Caddy, който задава X-Forwarded-For.
  const xff = c.req.header('x-forwarded-for');
  return (xff ? xff.split(',')[0].trim() : c.env?.incoming?.socket?.remoteAddress) || 'unknown';
}

export function isHttps(ctx, c) {
  const m = ctx.config.cookieSecure;
  if (m === '1') return true;
  if (m === '0') return false;
  return c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
}

export const SESSION_COOKIE = (secure) => (secure ? '__Host-rsid' : 'rsid');

export function readSessionToken(c) {
  return getCookie(c, '__Host-rsid') || getCookie(c, 'rsid') || null;
}

export function setSessionCookie(ctx, c, token) {
  const secure = isHttps(ctx, c);
  setCookie(c, SESSION_COOKIE(secure), token, {
    httpOnly: true, sameSite: 'Strict', secure, path: '/', maxAge: Math.floor(ctx.config.session.absoluteMs / 1000),
  });
}
export function clearSessionCookie(ctx, c) {
  const secure = isHttps(ctx, c);
  deleteCookie(c, SESSION_COOKIE(secure), { path: '/', secure });
  deleteCookie(c, 'rsid', { path: '/' });
}

// ---- Сесия на посетител с профил (отделна от администраторската) ----
// msid – HttpOnly сесия (SameSite=Lax: работи и при отваряне от връзка в писмо; заявките, променящи състояние, изискват CSRF токен);
// mstate=1 – само подсказка за статичните страници, че има вход (без тайна стойност), за да не питат сървъра при всяко отваряне.
export const MEMBER_COOKIE = (secure) => (secure ? '__Host-msid' : 'msid');
export const readMemberToken = (c) => getCookie(c, '__Host-msid') || getCookie(c, 'msid') || null;
export function setMemberCookie(ctx, c, token) {
  const secure = isHttps(ctx, c);
  const maxAge = Math.floor(ctx.config.members.absoluteMs / 1000);
  setCookie(c, MEMBER_COOKIE(secure), token, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge });
  setCookie(c, 'mstate', '1', { httpOnly: false, sameSite: 'Lax', secure, path: '/', maxAge });
}
export function clearMemberCookie(ctx, c) {
  const secure = isHttps(ctx, c);
  deleteCookie(c, MEMBER_COOKIE(secure), { path: '/', secure });
  deleteCookie(c, 'msid', { path: '/' });
  deleteCookie(c, 'mstate', { path: '/', secure });
}

/** Заявка, променяща състояние, трябва да идва от същия произход (Origin/Sec-Fetch-Site). */
export function originOk(ctx, c) {
  const site = c.req.header('sec-fetch-site');
  if (site === 'cross-site') return false;
  const origin = c.req.header('origin');
  if (!origin) return true; // не-браузърни клиенти; остава задължителният CSRF токен
  if (origin === 'null') return false;
  try {
    const o = new URL(origin);
    const host = c.req.header('x-forwarded-host') || c.req.header('host');
    return o.host === host || ctx.config.allowedOrigins.includes(o.origin);
  } catch { return false; }
}

export const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function securityHeaders(c, { admin }) {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (admin) {
    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  }
}

export { getCookie, setCookie, deleteCookie, safeEq };
