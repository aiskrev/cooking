// Публикуване: сглобяване на нова версия на сайта в отделна папка, проверки, атомарно включване и връщане към предишна версия.
// Публичният сайт никога не се променя „на място“: докато сглобяването или проверките не успеят, продължава да се сервира текущата версия.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { slugs, contentHash, readRecipe } from './recipes.mjs';
import { readTranslation } from './translations.mjs';

const CURRENT = 'current';
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

export function currentReleaseId(ctx) {
  try { return path.basename(fs.readlinkSync(path.join(ctx.config.releasesDir, CURRENT))); } catch { return null; }
}

// Публикуваните рецепти във версия на сайта: /bg/recepti/<адрес>/ (и /en/recipes/<адрес>/ за превода);
// по-старите версии (преди двуезичната) са с /recepti/<адрес>/.
const LIVE_DIRS = { bg: ["bg/recepti", "recepti"], en: ["en/recipes"] };
function scanLiveLocale(dir, locale) {
  for (const rel of LIVE_DIRS[locale]) {
    const d = path.join(dir, rel);
    if (!fs.existsSync(d)) continue;
    return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(d, e.name, "index.html"))).map((e) => e.name);
  }
  return [];
}
const scanLiveSlugs = (dir) => scanLiveLocale(dir, 'bg');

/** При пускане: версиите на диска, които не са в базата (напр. началната), се регистрират като „seed“. */
export function registerExistingReleases(ctx) {
  const root = ctx.config.releasesDir;
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith('.') || name === CURRENT) continue;
    const full = path.join(root, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (ctx.db.get('SELECT id FROM site_releases WHERE id = ?', name)) continue;
    const live = scanLiveSlugs(full);
    const en = new Set(scanLiveLocale(full, 'en'));
    ctx.db.run('INSERT INTO site_releases (id, created_at, source, recipe_count, manifest, note) VALUES (?, ?, ?, ?, ?, ?)',
      name, fs.statSync(full).mtimeMs, 'seed', live.length, JSON.stringify(Object.fromEntries(live.map((s) => [s, { hash: null, locales: en.has(s) ? ['bg', 'en'] : ['bg'] }]))), 'Начална версия (преди администрацията)');
  }
  // прекъснати сглобявания (рестарт по време на работа)
  ctx.db.run("UPDATE build_jobs SET status = 'failed', finished_at = ?, error = 'Прекъснато (услугата е рестартирана).' WHERE status = 'running'", Date.now());
  for (const n of fs.readdirSync(root)) if (n.startsWith('.tmp-')) fs.rmSync(path.join(root, n), { recursive: true, force: true });
  fs.rmSync(path.join(ctx.config.appDir, '.build'), { recursive: true, force: true });
}

export function currentRelease(ctx) {
  const id = currentReleaseId(ctx);
  if (!id) return null;
  const r = ctx.db.get('SELECT * FROM site_releases WHERE id = ?', id);
  return r ? { ...r, manifest: r.manifest ? JSON.parse(r.manifest) : {} } : { id, manifest: {}, created_at: null };
}

/** Състояние на рецептата спрямо публикуваната версия: live | pending | removing | none */
export function siteState(release, summary, hash) {
  const m = release?.manifest ?? {};
  const inLive = Object.prototype.hasOwnProperty.call(m, summary.slug);
  if (summary.publication === 'published') {
    if (!inLive) return 'pending';
    return m[summary.slug].hash === null || m[summary.slug].hash === hash ? 'live' : 'pending';
  }
  return inLive ? 'removing' : 'none';
}

export function currentManifest(ctx) {
  const m = {};
  for (const s of slugs(ctx)) {
    const r = readRecipe(ctx, s);
    if (r && !r.error && (r.data.publication ?? 'published') === 'published') {
      // английската страница е публикувана само ако преводът е със статус „published“ (виж src/lib/recipes.ts)
      const tr = readTranslation(ctx, s);
      const en = tr && !tr.error && tr.data.translation?.status === 'published';
      m[s] = { hash: contentHash(ctx, s), locales: en ? ['bg', 'en'] : ['bg'] };
    }
  }
  return m;
}

export const runningJob = (ctx) => ctx.db.get("SELECT * FROM build_jobs WHERE status = 'running' ORDER BY id DESC LIMIT 1");
export const lastJobs = (ctx, n = 10) => ctx.db.all('SELECT j.*, u.display_name AS who FROM build_jobs j LEFT JOIN admin_users u ON u.id = j.triggered_by ORDER BY j.id DESC LIMIT ?', n);
export const listReleases = (ctx) => ctx.db.all('SELECT * FROM site_releases WHERE removed_at IS NULL ORDER BY created_at DESC');

function runStage(ctx, name, cmd, args, env, logFd) {
  return new Promise((resolve) => {
    fs.writeSync(logFd, `\n=== ${name} · ${new Date().toISOString()} ===\n$ ${cmd} ${args.join(' ')}\n`);
    const child = spawn(cmd, args, { cwd: ctx.config.appDir, env: { ...process.env, ...env, FORCE_COLOR: '0' }, stdio: ['ignore', logFd, logFd] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90 * 60e3);
    child.on('exit', (code, sig) => { clearTimeout(timer); resolve(code === 0 ? null : `Етап „${name}“ завърши с код ${code ?? sig}.`); });
    child.on('error', (e) => { clearTimeout(timer); resolve(`Етап „${name}“ не стартира: ${e.message}`); });
  });
}

/** Стартира сглобяване във фонов режим. Връща {jobId} или {error}. */
export function startBuild(ctx, userId, { note = '' } = {}) {
  if (runningJob(ctx)) return { error: 'Вече тече сглобяване. Изчакайте го да приключи.' };
  const id = 'r-' + stamp();
  // Astro премества снимки с rename(), което не работи между различни файлови системи: сглобява се в папка на същата файлова система
  // като кода (/app/.build), а готовата версия се копира в тома „releases“ и чак тогава се включва.
  const tmp = path.join(ctx.config.appDir, '.build', id);
  const stage = path.join(ctx.config.releasesDir, '.tmp-' + id);
  const logPath = path.join(ctx.paths.logs, `build-${id}.log`);
  const jobId = ctx.db.run('INSERT INTO build_jobs (status, stage, started_at, release_id, log_path, triggered_by) VALUES (?, ?, ?, ?, ?, ?)', 'running', 'старт', Date.now(), id, logPath, userId ?? null).id;
  const manifest = currentManifest(ctx); // снимка на съдържанието в момента на стартиране
  ctx.audit('admin', 'publish.start', id, { jobId });
  (async () => {
    fs.mkdirSync(ctx.config.releasesDir, { recursive: true });
    const logFd = fs.openSync(logPath, 'a');
    const env = { ASTRO_OUT_DIR: tmp, SITE_URL: ctx.config.siteUrl, INDEXABLE: ctx.config.indexable ? '1' : '' };
    const bin = (n) => path.join(ctx.config.appDir, 'node_modules/.bin', n);
    const stages = [
      ['проверка на рецептите', 'node', ['scripts/validate-recipes.mjs', ctx.config.contentDir]],
      ['проверка на превода BG/EN', 'node', ['scripts/translations.mjs', 'check', '--content', ctx.config.contentDir]],
      ['сглобяване на сайта', bin('astro'), ['build']],
      ['индекс за търсене', bin('pagefind'), ['--site', tmp, '--output-subdir', 'pagefind']],
      ['проверка на връзките', 'node', ['scripts/check-links.mjs', tmp]],
      ['проверка на структурираните данни', 'node', ['scripts/check-schema.mjs', tmp]],
      ['проверка на снимките', 'node', ['scripts/check-images.mjs', tmp]],
    ];
    let error = null;
    try {
      for (const [name, cmd, args] of stages) {
        ctx.db.run('UPDATE build_jobs SET stage = ? WHERE id = ?', name, jobId);
        error = await runStage(ctx, name, cmd, args, env, logFd);
        if (error) break;
      }
      if (!error && !fs.existsSync(path.join(tmp, 'index.html'))) error = 'Липсва index.html в сглобената версия.';
      if (!error) {
        ctx.db.run('UPDATE build_jobs SET stage = ? WHERE id = ?', 'включване', jobId);
        fs.cpSync(tmp, stage, { recursive: true, verbatimSymlinks: true });
        if (!fs.existsSync(path.join(stage, 'index.html'))) throw new Error('Копирането на версията не успя.');
        activateDir(ctx, stage, id);
        ctx.db.run('INSERT INTO site_releases (id, created_at, created_by, source, recipe_count, manifest, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, Date.now(), userId ?? null, 'build', Object.keys(manifest).length, JSON.stringify(manifest), note || null);
        pruneReleases(ctx);
        ctx.db.run("UPDATE build_jobs SET status = 'succeeded', stage = 'готово', finished_at = ? WHERE id = ?", Date.now(), jobId);
        ctx.audit('admin', 'publish.ok', id, { recipes: Object.keys(manifest).length });
      }
    } catch (e) {
      error = 'Неочаквана грешка: ' + e.message;
    } finally {
      fs.closeSync(logFd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (error) {
      fs.rmSync(stage, { recursive: true, force: true });
      ctx.db.run("UPDATE build_jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?", Date.now(), error, jobId);
      ctx.audit('admin', 'publish.failed', id, { error });
    }
  })();
  return { jobId, releaseId: id };
}

/** Атомарно включване: папката се преименува, после символичната връзка „current“ се подменя с едно преименуване. */
function activateDir(ctx, tmpDir, id) {
  const root = ctx.config.releasesDir;
  fs.renameSync(tmpDir, path.join(root, id));
  pointCurrent(ctx, id);
}
function pointCurrent(ctx, id) {
  const root = ctx.config.releasesDir;
  const tmpLink = path.join(root, '.current.new');
  fs.rmSync(tmpLink, { force: true });
  fs.symlinkSync(id, tmpLink);
  fs.renameSync(tmpLink, path.join(root, CURRENT));
}

export function activateRelease(ctx, id) {
  const r = ctx.db.get('SELECT * FROM site_releases WHERE id = ? AND removed_at IS NULL', id);
  if (!r || !fs.existsSync(path.join(ctx.config.releasesDir, id, 'index.html'))) return { error: 'Тази версия не е налична на диска.' };
  if (runningJob(ctx)) return { error: 'Тече сглобяване. Изчакайте го да приключи.' };
  pointCurrent(ctx, id);
  ctx.audit('admin', 'publish.rollback', id);
  return { ok: true };
}

function pruneReleases(ctx) {
  const keep = ctx.config.releasesKept;
  const cur = currentReleaseId(ctx);
  const rows = ctx.db.all("SELECT id FROM site_releases WHERE removed_at IS NULL ORDER BY created_at DESC");
  rows.slice(keep).forEach((r) => {
    if (r.id === cur) return;
    fs.rmSync(path.join(ctx.config.releasesDir, r.id), { recursive: true, force: true });
    ctx.db.run('UPDATE site_releases SET removed_at = ? WHERE id = ?', Date.now(), r.id);
  });
}

export function readLogTail(logPath, lines = 40) {
  try { return fs.readFileSync(logPath, 'utf8').split('\n').slice(-lines).join('\n'); } catch { return ''; }
}
