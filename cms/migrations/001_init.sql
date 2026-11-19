-- Начална схема: администратори, сесии, ревизии, публикуване, медия, оценки, коментари, модерация, журнал.
-- Всички часове са Unix милисекунди (UTC). Външните ключове са включени (PRAGMA foreign_keys=ON).

CREATE TABLE admin_users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,                 -- Argon2id (PHC низ)
  role          TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  totp_secret   TEXT,                          -- шифрован (AES-256-GCM); NULL = без двустепенна защита
  totp_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
  totp_last_step INTEGER NOT NULL DEFAULT 0,   -- последната приета 30-секундна стъпка (защита от повторно използване на кода)
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE recovery_codes (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,                     -- SHA-256 със сол; кодът се показва само веднъж
  used_at   INTEGER
);
CREATE INDEX idx_recovery_user ON recovery_codes(user_id);

CREATE TABLE admin_sessions (
  id           TEXT PRIMARY KEY,               -- SHA-256 на бисквитката (самата стойност не се пази)
  user_id      INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  mfa_verified INTEGER NOT NULL DEFAULT 1 CHECK (mfa_verified IN (0, 1)),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip_hash      TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user ON admin_sessions(user_id);
CREATE INDEX idx_sessions_expires ON admin_sessions(expires_at);

-- Ограничаване на опитите за вход (по IP и по имейл): брой неуспехи и заключване с нарастващо време
CREATE TABLE login_attempts (
  key          TEXT PRIMARY KEY,
  failures     INTEGER NOT NULL DEFAULT 0,
  first_at     INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0,
  lock_count   INTEGER NOT NULL DEFAULT 0
);

-- Ограничаване на заявките от посетители (оценки, коментари, жалби)
CREATE TABLE rate_events (
  id     INTEGER PRIMARY KEY,
  bucket TEXT NOT NULL,                        -- напр. „comment:ip:<хеш>“
  at     INTEGER NOT NULL
);
CREATE INDEX idx_rate_bucket ON rate_events(bucket, at);

CREATE TABLE recipe_revisions (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  action     TEXT NOT NULL,                    -- create | save | state | restore | duplicate | import
  snapshot   TEXT NOT NULL,                    -- JSON: {data, body}
  author_id  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (slug, rev)
);
CREATE INDEX idx_revisions_slug ON recipe_revisions(slug, rev DESC);

CREATE TABLE media_assets (
  id              INTEGER PRIMARY KEY,
  recipe_slug     TEXT NOT NULL,
  file            TEXT NOT NULL,               -- публикуваният файл в photos/
  original_sha256 TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  original_path   TEXT NOT NULL,               -- извън публичната папка и извън Git
  original_bytes  INTEGER NOT NULL,
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  dhash           TEXT NOT NULL,
  crop            TEXT,                        -- JSON {x,y,w,h} (дялове); оригиналът не се променя
  uploaded_by     INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (recipe_slug, file)
);
CREATE INDEX idx_media_sha ON media_assets(original_sha256);

CREATE TABLE build_jobs (
  id           INTEGER PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  stage        TEXT,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  release_id   TEXT,
  error        TEXT,
  log_path     TEXT,
  triggered_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE site_releases (
  id            TEXT PRIMARY KEY,              -- име на папката във /releases
  created_at    INTEGER NOT NULL,
  created_by    INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'build' CHECK (source IN ('build', 'seed')),
  recipe_count  INTEGER,
  manifest      TEXT,                          -- JSON {slug: хеш на съдържанието} към момента на сглобяване
  note          TEXT,
  removed_at    INTEGER                        -- версията е изтрита от диска (старите се почистват)
);

CREATE TABLE ratings (
  id         INTEGER PRIMARY KEY,
  recipe_slug TEXT NOT NULL,
  actor_id   TEXT NOT NULL,                    -- HMAC на гост-идентификатора; не е самоличност на човек
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  status     TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'removed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (recipe_slug, actor_id)               -- една текуща оценка за рецепта от един участник
);
CREATE INDEX idx_ratings_recipe ON ratings(recipe_slug, status);

CREATE TABLE comments (
  id           INTEGER PRIMARY KEY,
  recipe_slug  TEXT NOT NULL,
  parent_id    INTEGER REFERENCES comments(id),
  depth        INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 3),
  author_name  TEXT NOT NULL,
  author_email TEXT,                           -- по желание; не се публикува и не се използва за автоматични писма
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'hidden', 'deleted')),
  is_admin     INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  actor_id     TEXT,
  ip_hash      TEXT,
  body_hash    TEXT NOT NULL,                  -- за откриване на повторени коментари
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  moderated_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  moderated_at INTEGER
);
CREATE INDEX idx_comments_recipe ON comments(recipe_slug, status, created_at);
CREATE INDEX idx_comments_status ON comments(status, created_at);
CREATE INDEX idx_comments_actor ON comments(actor_id, body_hash);

CREATE TABLE comment_reports (
  id         INTEGER PRIMARY KEY,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE (comment_id, actor_id)
);

CREATE TABLE moderation_events (
  id         INTEGER PRIMARY KEY,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  admin_id   INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,                    -- approve | reject | hide | delete | restore | reply | block
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_moderation_comment ON moderation_events(comment_id);

CREATE TABLE blocked_actors (
  actor_id   TEXT PRIMARY KEY,
  reason     TEXT,
  created_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE audit_events (
  id      INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,                       -- имейл на администратор или „system“ / „visitor“
  action  TEXT NOT NULL,
  target  TEXT,
  detail  TEXT,                                -- JSON без тайни
  ip_hash TEXT
);
CREATE INDEX idx_audit_at ON audit_events(at DESC);

CREATE TABLE cooked_marks (
  recipe_slug TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (recipe_slug, actor_id)
);
