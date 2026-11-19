#!/usr/bin/env bash
# Пълни проверки от край до край на локалния сайт с администрация (оценки, коментари, снимки, публикуване, рестарт, резервно копие).
# Изисква работещи услуги (docker compose up -d) и ВЕЧЕ създаден собственик. Данните за вход се подават през средата и не се отпечатват:
#   export E2E_ADMIN_EMAIL=вие@пример.bg E2E_ADMIN_PASSWORD='…'   # по желание отделен тестов администратор
#   bash tools/qa/run-e2e.sh
# ВНИМАНИЕ: тестът публикува и сваля тестова рецепта (две сглобявания на сайта) и за кратко заключва входа от този адрес.
set -u
cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1
: "${E2E_ADMIN_EMAIL:?задайте E2E_ADMIN_EMAIL}" "${E2E_ADMIN_PASSWORD:?задайте E2E_ADMIN_PASSWORD}"
export E2E_ADMIN_EMAIL E2E_ADMIN_PASSWORD
CLI="docker compose exec -T cms node --disable-warning=ExperimentalWarning cms/cli.mjs"
QA="docker compose --profile qa run --rm -T qa-local node"
FAIL=0
step() { echo; echo "════ $* ════"; }
check() { if "$@"; then echo "  ✔ $*"; else echo "  ✘ НЕУСПЕХ: $*"; FAIL=$((FAIL + 1)); fi; }
wait_healthy() { for i in $(seq 1 40); do [ "$(docker inspect -f '{{.State.Health.Status}}' recipes-cms-1 2>/dev/null)" = "healthy" ] && return 0; sleep 2; done; return 1; }
status() { $CLI status 2>/dev/null | head -1; }

step "0. Подготовка"
docker compose --profile qa build qa-local >/dev/null 2>&1
docker compose up -d --build cms web >/dev/null 2>&1 && wait_healthy && $CLI unlock >/dev/null
check docker compose exec -T cms node scripts/validate-recipes.mjs /app/src/content/recipes
CURRENT_BEFORE=$($CLI status | sed -n 2p)

step "1. Част 1: достъп, вход, рецепта със снимки, публикуване, оценки, коментари"
$QA e2e-1.mjs || FAIL=$((FAIL + 1))
SLUG=$(grep -o '"slug":"[^"]*"' qa-output/e2e/state.json | head -1 | cut -d'"' -f4)
echo "тестова рецепта: ${SLUG:-?}"
BEFORE_RESTART=$(status)

step "2. Рестарт на услугата – данните трябва да останат"
docker compose restart cms >/dev/null 2>&1 && wait_healthy
check test "$(status)" = "$BEFORE_RESTART"
echo "  преди: $BEFORE_RESTART"; echo "  след:  $(status)"

step "3. Резервно копие на базата"
BACKUP_OUT=$($CLI backup 2>&1); echo "  $BACKUP_OUT"
BACKUP_DIR=$(echo "$BACKUP_OUT" | grep -o '/data/backups/[0-9]*' | head -1)
COUNTS_WITH_DATA=$(status)

step "4. Част 2: трайност, редакция, ревизии, дублиране, сваляне от сайта, изтриване, заключване"
$QA e2e-2.mjs || FAIL=$((FAIL + 1))
$CLI unlock >/dev/null
[ -n "${SLUG:-}" ] && $CLI purge-community --slug="$SLUG" --force

step "5. Адаптивност, достъпност (axe), клавиатура"
$QA e2e-a11y.mjs || FAIL=$((FAIL + 1))

step "6. Безопасно връщане: невалидна рецепта не трябва да разваля сайта"
CUR_A=$(docker compose exec -T cms readlink /releases/current | tr -d '\r')
mkdir -p src/content/recipes/zz-broken && printf -- '---\ntitle: [счупен\n  yaml: : :\n---\n' > src/content/recipes/zz-broken/index.md
if $CLI build >/tmp/e2e-broken.log 2>&1; then echo "  ✘ НЕУСПЕХ: сглобяване с невалидна рецепта не бива да успява"; FAIL=$((FAIL + 1)); else echo "  ✔ сглобяването с невалидна рецепта е отказано: $(tail -1 /tmp/e2e-broken.log | cut -c1-120)"; fi
rm -rf src/content/recipes/zz-broken
CUR_B=$(docker compose exec -T cms readlink /releases/current | tr -d '\r')
check test "$CUR_A" = "$CUR_B"
check test "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/)" = "200"
echo "  текуща версия преди/след: $CUR_A / $CUR_B"

step "7. Преизграждане на услугата (docker compose up --build) – данните остават"
BEFORE_REBUILD=$(status)
docker compose up -d --build cms >/dev/null 2>&1 && wait_healthy
check test "$(status)" = "$BEFORE_REBUILD"

step "8. Възстановяване от резервно копие"
if [ -n "${BACKUP_DIR:-}" ]; then
  docker compose stop cms >/dev/null 2>&1
  docker compose run --rm -T --no-deps cms node --disable-warning=ExperimentalWarning cms/cli.mjs restore "$BACKUP_DIR" --force 2>&1 | tail -1
  docker compose start cms >/dev/null 2>&1 && wait_healthy
  echo "  след възстановяване: $(status)"
  check test "$(status)" = "$COUNTS_WITH_DATA"
  [ -n "${SLUG:-}" ] && $CLI purge-community --slug="$SLUG" --force >/dev/null
fi

echo; echo "════ ОБОБЩЕНИЕ: ${FAIL} неуспешни групи проверки ════"
exit $FAIL
