// Писма до посетителите: потвърждаване на имейл и нова парола (български/английски според езика на профила).
// Изпращането е през SMTP (nodemailer). Връзките съдържат еднократен код САМО в писмото – кодът не се записва в журналите.
// Транспорти: smtp | outbox (локално: JSON файлове в DATA_DIR/outbox) | memory (тестове) | disabled.
import fs from 'node:fs';
import path from 'node:path';
import { randomToken } from './crypto.mjs';

/** Писмата, „изпратени“ в режим memory (само за тестовете). */
export const memoryOutbox = [];

export function mailEnabled(ctx) {
  const m = ctx.config.mail;
  if (m.transport === 'smtp') return !!(m.smtp.host && m.from);
  return m.transport === 'outbox' || m.transport === 'memory';
}

let transporter;
async function smtp(ctx) {
  if (transporter) return transporter;
  const { createTransport } = await import('nodemailer');
  const s = ctx.config.mail.smtp;
  transporter = createTransport({
    host: s.host, port: s.port, secure: s.secure, requireTLS: !s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    tls: { minVersion: 'TLSv1.2' },
  });
  return transporter;
}

export async function sendMail(ctx, { to, subject, text }) {
  const m = ctx.config.mail;
  if (m.transport === 'memory') { memoryOutbox.push({ to, subject, text, at: Date.now() }); return true; }
  if (m.transport === 'outbox') {
    fs.mkdirSync(ctx.paths.outbox, { recursive: true });
    const f = path.join(ctx.paths.outbox, `${Date.now()}-${randomToken(4)}.json`);
    fs.writeFileSync(f, JSON.stringify({ to, subject, text }, null, 2), { mode: 0o600 });
    return true;
  }
  if (m.transport !== 'smtp' || !mailEnabled(ctx)) return false;
  await (await smtp(ctx)).sendMail({ from: m.from, to, subject, text });
  return true;
}

/** Изпращане без чакане: грешката се записва без съдържанието на писмото (в него има еднократен код). */
export function sendMailLater(ctx, msg, kind) {
  sendMail(ctx, msg).catch((e) => console.error(`[cms] писмото (${kind}) не беше изпратено: ${e?.code || e?.message || 'грешка'}`));
}

const SITE = { bg: 'Модерна кухня с Мишлен щрих', en: 'Modern Cuisine with a Michelin Touch' };
const PATHS = {
  verify: { bg: '/bg/potvarzhdenie/', en: '/en/verify-email/' },
  reset: { bg: '/bg/nova-parola/', en: '/en/reset-password/' },
  login: { bg: '/bg/vhod/', en: '/en/sign-in/' },
  forgot: { bg: '/bg/zabravena-parola/', en: '/en/forgot-password/' },
};
// Кодът е след „#“: не стига до сървъра в заявката за страницата, не попада в журналите на Caddy и не изтича в Referer.
const link = (ctx, kind, locale, token) => `${ctx.config.siteUrl}${PATHS[kind][locale]}${token ? `#token=${token}` : ''}`;

export const templates = {
  verify: (ctx, { locale, name, token }) => (locale === 'en'
    ? { subject: `Confirm your email – ${SITE.en}`, text: `Hello ${name},\n\nPlease confirm your email address by opening this link (valid for 48 hours):\n${link(ctx, 'verify', 'en', token)}\n\nIf you did not create an account, ignore this message – nothing will happen.\n\n${SITE.en}` }
    : { subject: `Потвърдете имейла си – ${SITE.bg}`, text: `Здравейте, ${name}!\n\nПотвърдете имейл адреса си, като отворите тази връзка (валидна 48 часа):\n${link(ctx, 'verify', 'bg', token)}\n\nАко не сте създавали профил, не правете нищо – писмото може да бъде пренебрегнато.\n\n${SITE.bg}` }),
  reset: (ctx, { locale, name, token }) => (locale === 'en'
    ? { subject: `Set a new password – ${SITE.en}`, text: `Hello ${name},\n\nTo set a new password, open this link (valid for 1 hour, single use):\n${link(ctx, 'reset', 'en', token)}\n\nIf you did not ask for a new password, ignore this message – your password stays the same.\n\n${SITE.en}` }
    : { subject: `Нова парола – ${SITE.bg}`, text: `Здравейте, ${name}!\n\nЗа да зададете нова парола, отворете тази връзка (валидна 1 час, еднократна):\n${link(ctx, 'reset', 'bg', token)}\n\nАко не сте искали нова парола, не правете нищо – паролата ви остава същата.\n\n${SITE.bg}` }),
  // При опит за регистрация с вече използван имейл: отговорът на сайта е същият (без разкриване), а собственикът на адреса получава това писмо.
  exists: (ctx, { locale, name }) => (locale === 'en'
    ? { subject: `Sign-in help – ${SITE.en}`, text: `Hello ${name},\n\nSomeone tried to create an account with this email address, but you already have one.\nSign in: ${link(ctx, 'login', 'en')}\nForgot your password? ${link(ctx, 'forgot', 'en')}\n\nIf it was not you, ignore this message.\n\n${SITE.en}` }
    : { subject: `Вход в профила – ${SITE.bg}`, text: `Здравейте, ${name}!\n\nНякой опита да създаде профил с този имейл адрес, но вие вече имате профил.\nВход: ${link(ctx, 'login', 'bg')}\nЗабравена парола: ${link(ctx, 'forgot', 'bg')}\n\nАко не сте били вие, не правете нищо.\n\n${SITE.bg}` }),
};
