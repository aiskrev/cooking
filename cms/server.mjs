// Входна точка: администрация (/admin) и API (/api) на блога „Модерна кухня с Мишлен щрих“.
// Публичният сайт остава статичен и се сервира от Caddy; тази услуга е достъпна само през него.
// Маршрутите се сглобяват в app.mjs (същото приложение се ползва и от тестовете).
import { serve } from '@hono/node-server';
import { createContext } from './lib/ctx.mjs';
import { purgeExpired } from './lib/auth.mjs';
import { purgeMembers } from './lib/members.mjs';
import { mailEnabled } from './lib/mailer.mjs';
import { registerExistingReleases } from './lib/publish.mjs';
import { createApp } from './app.mjs';

const ctx = createContext();
registerExistingReleases(ctx);
const purge = () => { purgeExpired(ctx); purgeMembers(ctx); };
purge();
setInterval(purge, 10 * 60e3).unref();
console.log(`[cms] база: ${ctx.paths.db}; приложени миграции: ${ctx.applied.join(', ') || 'няма нови'}; писма: ${ctx.config.mail.transport}${mailEnabled(ctx) ? '' : ' (изключени – регистрацията не е налична)'}`);

const app = createApp(ctx);
const server = serve({ fetch: app.fetch, port: ctx.config.port, hostname: '0.0.0.0' }, (i) => console.log(`[cms] слуша на порт ${i.port}`));
const stop = () => { server.close(); ctx.db.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
