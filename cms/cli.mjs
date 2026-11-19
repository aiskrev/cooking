// Команден ред за администрацията. Пуска се в контейнера:
//   docker compose exec -it cms node --disable-warning=ExperimentalWarning cms/cli.mjs <команда>
// Команди: create-owner, reset-password, disable-mfa, backup, restore, build, status
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createContext } from './lib/ctx.mjs';
import { createOwner, hashPassword, validatePassword } from './lib/auth.mjs';
import { startBuild, registerExistingReleases, runningJob, currentReleaseId } from './lib/publish.mjs';

const [, , cmd, ...rest] = process.argv;
const opts = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const pos = rest.filter((a) => !a.startsWith('--'));

/** Парола: от променливата CMS_ADMIN_PASSWORD (за автоматизация) или скрито въвеждане. Никога не се отпечатва. */
async function askPassword(label) {
  if (process.env.CMS_ADMIN_PASSWORD) return process.env.CMS_ADMIN_PASSWORD;
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) { rl.close(); return line; }
    return '';
  }
  return new Promise((resolve) => {
    process.stdout.write(label);
    const stdin = process.stdin; let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    stdin.on('data', function onData(ch) {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(buf); }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    });
  });
}

const ctx = createContext();
const out = (s) => process.stdout.write(s + '\n');

try {
  switch (cmd) {
    case 'create-owner': {
      const email = opts.email;
      if (!email || email === true) throw new Error('Използване: create-owner --email=вие@пример.bg [--name="Име"]');
      const pw = await askPassword('Парола (поне 12 знака, не се показва): ');
      if (!process.env.CMS_ADMIN_PASSWORD && process.stdin.isTTY) {
        const again = await askPassword('Повторете паролата: ');
        if (again !== pw) throw new Error('Паролите не съвпадат.');
      }
      await createOwner(ctx, { email, name: opts.name === true ? '' : opts.name, password: pw });
      out(`Създаден е администратор ${String(email).toLowerCase()}. Вход: /admin/login`);
      break;
    }
    case 'reset-password': {
      const email = String(opts.email || '').toLowerCase();
      const u = ctx.db.get('SELECT * FROM admin_users WHERE email = ?', email);
      if (!u) throw new Error('Няма такъв администратор.');
      const pw = await askPassword('Нова парола: ');
      const bad = validatePassword(pw, email); if (bad) throw new Error(bad);
      ctx.db.run('UPDATE admin_users SET password_hash = ? WHERE id = ?', await hashPassword(pw), u.id);
      ctx.db.run('DELETE FROM admin_sessions WHERE user_id = ?', u.id);
      ctx.db.run('DELETE FROM login_attempts');
      ctx.audit('system', 'password.reset-cli', email);
      out('Паролата е сменена, всички сесии са прекратени, заключванията са изчистени.');
      break;
    }
    case 'disable-mfa': {
      const email = String(opts.email || '').toLowerCase();
      const u = ctx.db.get('SELECT * FROM admin_users WHERE email = ?', email);
      if (!u) throw new Error('Няма такъв администратор.');
      ctx.db.run('UPDATE admin_users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', u.id);
      ctx.db.run('DELETE FROM recovery_codes WHERE user_id = ?', u.id);
      ctx.db.run('DELETE FROM admin_sessions WHERE user_id = ?', u.id);
      ctx.audit('system', 'mfa.disabled-cli', email);
      out('Двустепенната защита е изключена (възстановяване при загубено устройство).');
      break;
    }
    case 'backup': {
      const dir = path.join(ctx.paths.backups, new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14));
      fs.mkdirSync(dir, { recursive: true });
      ctx.db.snapshot(path.join(dir, 'cms.sqlite'));
      fs.copyFileSync(ctx.paths.secret, path.join(dir, 'secret.key'));
      fs.chmodSync(path.join(dir, 'secret.key'), 0o600);
      if (opts['with-originals'] && fs.existsSync(ctx.paths.originals)) fs.cpSync(ctx.paths.originals, path.join(dir, 'originals'), { recursive: true });
      ctx.audit('system', 'backup.cli', dir);
      out(`Резервно копие: ${dir}${opts['with-originals'] ? ' (с оригиналите на снимките)' : ''}. Съдържа тайния ключ – пазете го като парола.`);
      break;
    }
    case 'restore': {
      const dir = pos[0];
      if (!dir || !fs.existsSync(path.join(dir, 'cms.sqlite'))) throw new Error('Използване: restore <папка-с-копие> (трябва да съдържа cms.sqlite).');
      if (!opts.force) throw new Error('Възстановяването заменя текущите оценки, коментари и потребители. Спрете услугата (docker compose stop cms) и добавете --force.');
      ctx.db.close();
      for (const ext of ['', '-wal', '-shm']) fs.rmSync(ctx.paths.db + ext, { force: true });
      fs.copyFileSync(path.join(dir, 'cms.sqlite'), ctx.paths.db);
      if (fs.existsSync(path.join(dir, 'secret.key'))) { fs.copyFileSync(path.join(dir, 'secret.key'), ctx.paths.secret); fs.chmodSync(ctx.paths.secret, 0o600); }
      if (fs.existsSync(path.join(dir, 'originals'))) fs.cpSync(path.join(dir, 'originals'), ctx.paths.originals, { recursive: true });
      out('Възстановено. Стартирайте услугата: docker compose start cms');
      process.exit(0);
    }
    case 'build': {
      registerExistingReleases(ctx);
      const r = startBuild(ctx, null, { note: 'от командния ред' });
      if (r.error) throw new Error(r.error);
      out(`Сглобяване ${r.releaseId}… (журнал: ${ctx.paths.logs})`);
      while (runningJob(ctx)) await new Promise((res) => setTimeout(res, 3000));
      const job = ctx.db.get('SELECT * FROM build_jobs WHERE id = ?', r.jobId);
      out(job.status === 'succeeded' ? `Готово. Текуща версия: ${currentReleaseId(ctx)}` : `НЕУСПЕШНО: ${job.error}`);
      process.exit(job.status === 'succeeded' ? 0 : 1);
    }
    case 'unlock': {
      ctx.db.run('DELETE FROM login_attempts'); ctx.db.run('DELETE FROM rate_events');
      out('Заключванията при вход и ограниченията на честотата са изчистени.');
      break;
    }
    case 'purge-community': {
      // Изтрива оценки, коментари и отметки за една рецепта (напр. след тестове). Необратимо – само с --force.
      const slug = String(opts.slug || '');
      if (!slug || !opts.force) throw new Error('Използване: purge-community --slug=<адрес> --force (необратимо)');
      const n = { ratings: 0, comments: 0 };
      ctx.db.tx(() => {
        n.comments = ctx.db.run('DELETE FROM comments WHERE recipe_slug = ?', slug).changes;
        n.ratings = ctx.db.run('DELETE FROM ratings WHERE recipe_slug = ?', slug).changes;
        ctx.db.run('DELETE FROM cooked_marks WHERE recipe_slug = ?', slug);
        ctx.db.run("DELETE FROM blocked_actors WHERE reason = 'блокиран от модератор'");
      });
      ctx.audit('system', 'purge-community', slug, n);
      out(`Изтрити: ${n.ratings} оценки, ${n.comments} коментара за „${slug}“.`);
      break;
    }
    case 'status': {
      out(`Администратори: ${ctx.db.get('SELECT COUNT(*) n FROM admin_users').n}; оценки: ${ctx.db.get('SELECT COUNT(*) n FROM ratings').n}; коментари: ${ctx.db.get('SELECT COUNT(*) n FROM comments').n}`);
      out(`Текуща версия на сайта: ${currentReleaseId(ctx) ?? 'няма'}`);
      break;
    }
    default:
      out('Команди: create-owner --email=… [--name=…] | reset-password --email=… | disable-mfa --email=… | backup [--with-originals] | restore <папка> --force | build | status');
      process.exit(cmd ? 1 : 0);
  }
  ctx.db.close();
} catch (e) {
  console.error('ГРЕШКА: ' + e.message);
  process.exit(1);
}
