// Настройки на администрацията (от променливите на средата; без тайни в кода).
import path from 'node:path';

const env = process.env;
const appDir = env.APP_DIR || process.cwd();

export const config = {
  port: Number(env.PORT || 3000),
  appDir,
  dataDir: env.DATA_DIR || '/data',
  contentDir: env.CONTENT_DIR || path.join(appDir, 'src/content/recipes'),
  releasesDir: env.RELEASES_DIR || '/releases',
  siteUrl: (env.SITE_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  indexable: env.INDEXABLE === '1' || env.INDEXABLE === 'true',
  // 'auto' – Secure бисквитка само при HTTPS (според X-Forwarded-Proto); '1' – винаги; '0' – никога
  cookieSecure: env.CMS_COOKIE_SECURE || 'auto',
  allowedOrigins: (env.CMS_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  turnstileSecret: env.TURNSTILE_SECRET || '',
  turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
  session: { idleMs: 2 * 3600e3, absoluteMs: 12 * 3600e3 },
  login: { maxFailures: 5, windowMs: 15 * 60e3, baseLockMs: 15 * 60e3, maxLockMs: 3600e3 },
  upload: {
    maxFileBytes: 25 * 1024 * 1024, // 25 MB на файл
    maxFiles: 30, // файла наведнъж
    maxBatchBytes: 150 * 1024 * 1024, // 150 MB наведнъж
    maxPixels: 50_000_000, // защита от „decompression bomb“ (50 мегапиксела)
    maxPhotosPerRecipe: 150,
    quotaBytes: 4 * 1024 ** 3, // общо 4 GB оригинали
    publishWidth: 1600,
    publishQuality: 86,
  },
  comments: { maxBody: 2000, minBody: 3, maxName: 40, maxDepth: 3, memberMaxDepth: 1 },
  releasesKept: 3,
  // Профили на посетителите (отделни от администратора в /admin)
  members: {
    idleMs: 14 * 86400e3, // сесия без активност – 14 дни
    absoluteMs: 30 * 86400e3, // най-много 30 дни след входа
    verifyTtlMs: 48 * 3600e3, // връзка за потвърждаване на имейл – 48 ч
    resetTtlMs: 3600e3, // връзка за нова парола – 1 ч
    tokenRetentionMs: 7 * 86400e3, // използвани/изтекли кодове се изтриват след 7 дни
  },
  // Писма (потвърждаване на имейл, нова парола). 'smtp' – реално изпращане; 'outbox' – файлове в DATA_DIR/outbox (само за локална работа);
  // 'disabled' – без писма (регистрацията и новата парола връщат „временно не е налично“).
  mail: {
    transport: env.MAIL_TRANSPORT || 'disabled',
    from: env.MAIL_FROM || '',
    smtp: {
      host: env.MAIL_SMTP_HOST || '',
      port: Number(env.MAIL_SMTP_PORT || 587),
      secure: env.MAIL_SMTP_SECURE === '1', // 465 – TLS от началото; 587 – STARTTLS (задължителен)
      user: env.MAIL_SMTP_USER || '',
      pass: env.MAIL_SMTP_PASS || '',
    },
  },
};

export const paths = {
  db: path.join(config.dataDir, 'cms.sqlite'),
  secret: path.join(config.dataDir, 'secret.key'),
  originals: path.join(config.dataDir, 'originals'),
  thumbs: path.join(config.dataDir, 'thumbs'),
  trash: path.join(config.dataDir, 'trash'),
  logs: path.join(config.dataDir, 'logs'),
  backups: path.join(config.dataDir, 'backups'),
  outbox: path.join(config.dataDir, 'outbox'),
};
