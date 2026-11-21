// Тайни, хешове, шифроване на TOTP тайните и TOTP (RFC 6238). Само вградения модул node:crypto.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Ключ на инсталацията: създава се при първо пускане в /data (права 0600), никога не е в Git. */
export function loadSecret(file) {
  if (fs.existsSync(file)) return fs.readFileSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Сравнение с постоянно време (и при различна дължина). */
export function safeEq(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const subkey = (secret, label) => Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), label, 32));

export function encrypt(secret, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', subkey(secret, 'totp-secret'), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function decrypt(secret, blob) {
  const buf = Buffer.from(blob, 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', subkey(secret, 'totp-secret'), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

// ---------- TOTP ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error('невалиден base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32encode(crypto.randomBytes(20));
export function hotp(secretB32, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
/** Връща номера на приетата стъпка или null. Приема ±1 стъпка (30 сек.) заради разлики в часовниците. */
export function verifyTotp(secretB32, code, now = Date.now()) {
  const clean = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = Math.floor(now / 30000);
  for (const s of [step, step - 1, step + 1]) if (safeEq(hotp(secretB32, s), clean)) return s;
  return null;
}
export const otpauthUri = (email, secretB32, issuer = 'Модерна кухня с Мишлен щрих') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
