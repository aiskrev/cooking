// SQLite през вградения модул node:sqlite (без външни изисквания за компилация).
// WAL режим, включени външни ключове, изчакване при заключена база, миграции от cms/migrations/*.sql.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const cache = new Map();
  const prep = (sql) => cache.get(sql) ?? (cache.set(sql, raw.prepare(sql)), cache.get(sql));
  let depth = 0;
  const db = {
    raw,
    get: (sql, ...p) => prep(sql).get(...norm(p)) ?? null,
    all: (sql, ...p) => prep(sql).all(...norm(p)),
    run: (sql, ...p) => {
      const r = prep(sql).run(...norm(p));
      return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
    },
    exec: (sql) => raw.exec(sql),
    /** Транзакция с незабавно заключване на запис; вложените извиквания се изпълняват в същата транзакция. */
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* вече е отменена */ }
        throw e;
      } finally {
        depth--;
      }
    },
    /** Консистентно копие на базата (работи и при отворени връзки). */
    snapshot(target) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    },
    close: () => raw.close(),
  };
  return db;
}

export function migrate(db, dir = path.join(here, '..', 'migrations')) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set(db.all('SELECT version FROM schema_migrations').map((r) => r.version));
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    const version = parseInt(f, 10);
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.tx(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', version, f, Date.now());
    });
    applied.push(f);
  }
  return applied;
}
