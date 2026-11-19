// Общ контекст на услугата: настройки, база данни, ключ на инсталацията, журнал на действията.
import fs from 'node:fs';
import { config, paths } from './config.mjs';
import { openDb, migrate } from './db.mjs';
import { loadSecret, hmac } from './crypto.mjs';

export function createContext() {
  for (const d of [config.dataDir, paths.originals, paths.thumbs, paths.trash, paths.logs, paths.backups]) fs.mkdirSync(d, { recursive: true });
  const secret = loadSecret(paths.secret);
  const db = openDb(paths.db);
  const applied = migrate(db);
  const ctx = {
    config, paths, db, secret, applied,
    /** Хеш на IP адреса (с ключа на инсталацията): суровият адрес не се пази. */
    ipHash: (ip) => hmac(secret, 'ip:' + (ip || 'unknown')).slice(0, 24),
    audit(actor, action, target = null, detail = null, ip = null) {
      db.run('INSERT INTO audit_events (at, actor, action, target, detail, ip_hash) VALUES (?, ?, ?, ?, ?, ?)',
        Date.now(), actor, action, target, detail ? JSON.stringify(detail) : null, ip ? ctx.ipHash(ip) : null);
    },
  };
  return ctx;
}
