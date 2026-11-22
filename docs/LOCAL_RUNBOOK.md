# Локално пускане и поддръжка

Сайт и администрация: **http://localhost:8080** (достъпен само от този компютър – порт `127.0.0.1:8080`). Нищо не е публикувано в интернет.

## Първо пускане

```bash
docker compose up -d --build cms web
```

Първият администратор се създава **само с командата** (няма паролa по подразбиране; паролата се въвежда скрито и не се показва):

```bash
docker compose exec -it cms node --disable-warning=ExperimentalWarning cms/cli.mjs create-owner --email=вие@пример.bg --name="Вашето име"
```

Вход: http://localhost:8080/admin/login. Нова рецепта: http://localhost:8080/admin/recipes/new.

### Начална версия на сайта (ако том „releases“ е празен)

Ако `/admin/publish` не показва версия, сглобете първата: **Публикуване → Публикувай сайта** или

```bash
docker compose exec cms node --disable-warning=ExperimentalWarning cms/cli.mjs build
```

Със **студен кеш за снимките** това е ≈ 35 мин. За бърз старт кешът може да се изнесе от образа за сглобяване и да се зареди в тома:

```bash
docker build --target astro-cache --output type=local,dest=.cache/astro-seed .
docker run --rm -v recipes_astro-cache:/c -v "$PWD/.cache/astro-seed:/s:ro" alpine sh -c "cp -a /s/. /c/ && chown -R 1000:1000 /c"
```

Започване от вече сглобен сайт (напр. от образа `recipes-web`):

```bash
docker run --rm -v recipes_releases:/r recipes-web sh -c 'mkdir -p /r/r-seed && cp -a /srv/. /r/r-seed/ && ln -sfn r-seed /r/current && chown -R 1000:1000 /r'
```

## Всекидневно

| Задача | Команда |
|---|---|
| Пускане / спиране | `docker compose up -d cms web` · `docker compose stop` |
| Журнали | `docker compose logs -f cms` |
| Състояние | `docker compose exec cms node --disable-warning=ExperimentalWarning cms/cli.mjs status` |
| Забравена парола | `… cli.mjs reset-password --email=вие@пример.bg` (прекратява всички сесии) |
| Загубено устройство за TOTP | `… cli.mjs disable-mfa --email=вие@пример.bg` |
| Заключен вход (твърде много опити) | изчакайте или `… cli.mjs unlock` |
| Сглобяване без интерфейса | `… cli.mjs build` |
| Старият начин (само статичен сайт, без администрация) | `docker compose --profile static up web-static` → http://localhost:8081 |

`COMPOSE`-променливи (по желание, във файл `.env`; никога не се качва в Git): `SITE_URL`, `INDEXABLE=1` (разрешава на търсачките), `CMS_COOKIE_SECURE`, `TURNSTILE_SECRET`/`TURNSTILE_SITE_KEY`.

## Резервно копие

```bash
docker compose exec cms node --disable-warning=ExperimentalWarning cms/cli.mjs backup --with-originals
docker compose cp cms:/data/backups ./backups       # изнасяне на копията извън тома
```

Възстановяване (спрете услугата първо):

```bash
docker compose stop cms
docker compose run --rm --no-deps cms node --disable-warning=ExperimentalWarning cms/cli.mjs restore /data/backups/<папка> --force
docker compose start cms
```

Рецептите са в Git (`src/content/recipes`); не се пазят в тома. Томовете (`cms-data`, `releases`, `astro-cache`) **не се трият** от `docker compose down`; `docker compose down -v` ги изтрива – не го ползвайте.

## Тестове

```bash
# сървърна логика (вкл. профилите на посетителите)
docker compose exec cms sh -c "node --disable-warning=ExperimentalWarning --test cms/test/*.test.mjs"
# профили на посетителите: регистрация → потвърждаване → вход → любими → „Сготвих“ → оценка → коментар → модерация (без администратор)
bash tools/qa/run-accounts-e2e.sh
# браузърни проверки от край до край (публикува и сваля тестова рецепта; ≈ 10–20 мин.)
export E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=…
bash tools/qa/run-e2e.sh
```

## Профили на посетителите

Локално писмата не се изпращат. Те са JSON файлове в `/data/outbox` (`MAIL_TRANSPORT=outbox`). Връзката за потвърждаване се взема оттам:

```bash
docker compose exec cms sh -c 'ls -t /data/outbox | head -1 | xargs -I{} cat /data/outbox/{}'
```

Роля на профил (`user` | `moderator` | `admin`):

```bash
docker compose exec cms node --disable-warning=ExperimentalWarning cms/cli.mjs set-role --email=… --role=moderator
```

Подробности: [ACCOUNTS_COMMUNITY.md](ACCOUNTS_COMMUNITY.md).

## Преди публично пускане (не е направено)

Нищо от долното не е включено – сайтът е само локален.

1. **HTTPS** пред услугата (`deploy/Caddyfile.snippet`); `CMS_COOKIE_SECURE=auto` ще постави `Secure` и префикс `__Host-` на бисквитката. Проверете `X-Forwarded-Proto`.
2. **Скрийте `/admin`** зад мрежова защита (VPN/IP списък/Cloudflare Access) – освен паролата да има и втори слой. Включете **TOTP** в „Настройки“.
3. **Проверена самоличност за оценките** и Turnstile за коментарите (виж `RATINGS_COMMENTS_DESIGN.md`).
4. Задайте `SITE_URL` и `INDEXABLE=1` при сглобяване.
5. Политика за поверителност: сайтът ползва една функционална бисквитка (`rguest`) само след първо действие (оценка/коментар/отметка).
6. Резервни копия по график и извън сървъра; тестово възстановяване.
7. Ограничете `CMS_ALLOWED_ORIGINS` до реалния адрес.
8. Включете автоматични проверки (CI) и защита на клона `main` в GitHub.
