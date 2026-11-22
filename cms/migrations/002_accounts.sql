-- Профили на посетителите: регистрация, сесии, потвърждаване на имейл, нова парола, любими, история „Сготвих“,
-- оценки и коментари, вързани към профил, модерация от модератори/администратори на сайта.
-- Миграцията само ДОБАВЯ таблици, колони и индекси; не изтрива и не променя съществуващи данни.
-- Връщане назад: виж docs/ACCOUNTS_COMMUNITY.md (раздел „Миграции“) – преди прилагане се прави резервно копие (cms/cli.mjs backup).

CREATE TABLE users (
  id                  INTEGER PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified_at   INTEGER,                          -- NULL = имейлът не е потвърден
  display_name        TEXT NOT NULL,
  password_hash       TEXT NOT NULL,                    -- Argon2id (PHC низ)
  role                TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  locale              TEXT NOT NULL DEFAULT 'bg' CHECK (locale IN ('bg', 'en')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  last_login_at       INTEGER,
  password_changed_at INTEGER
);
CREATE INDEX idx_users_role ON users(role) WHERE role != 'user';

-- Сесии на посетителите (отделни от администраторските). Пази се само SHA-256 на бисквитката.
CREATE TABLE user_sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip_hash      TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

-- Еднократни кодове от писмата (потвърждаване на имейл, нова парола). Пази се само SHA-256 на кода.
CREATE TABLE user_tokens (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX idx_user_tokens_user ON user_tokens(user_id, purpose);
CREATE INDEX idx_user_tokens_expires ON user_tokens(expires_at);

CREATE TABLE favorites (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, recipe_slug)                    -- UNIQUE(userId, recipeId)
);
CREATE INDEX idx_favorites_recipe ON favorites(recipe_slug);

-- „Сготвих“: всяко сготвяне е отделно събитие (една рецепта може да се сготви много пъти)
CREATE TABLE cook_events (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_slug TEXT NOT NULL,
  cooked_at   INTEGER NOT NULL,
  servings    INTEGER CHECK (servings IS NULL OR servings BETWEEN 1 AND 48),
  note        TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_cook_events_user ON cook_events(user_id, cooked_at DESC);
CREATE INDEX idx_cook_events_recipe ON cook_events(recipe_slug, user_id);

-- Оценки от профил: една текуща оценка на профил за рецепта (UNIQUE(userId, recipeId)).
-- Старите оценки от гост-бисквитки остават (user_id NULL) и се броят в средната; нови гост-оценки не се приемат.
ALTER TABLE ratings ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX ux_ratings_user_recipe ON ratings(user_id, recipe_slug) WHERE user_id IS NOT NULL;

-- Коментари от профил. Старите коментари от гости остават (user_id NULL).
ALTER TABLE comments ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN edited_at INTEGER;
CREATE INDEX idx_comments_user ON comments(user_id, created_at DESC);

ALTER TABLE comment_reports ADD COLUMN category TEXT CHECK (category IS NULL OR category IN ('spam', 'harassment', 'personal_data', 'inappropriate', 'other'));
ALTER TABLE comment_reports ADD COLUMN reporter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_reports_open ON comment_reports(resolved_at, comment_id);

-- Модерация от модератор/администратор на сайта (не от собственика в /admin)
ALTER TABLE moderation_events ADD COLUMN moderator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_moderation_at ON moderation_events(created_at DESC);
