#!/usr/bin/env bash
# Профили на посетителите: проверка от край до край на локалния сайт (docker compose, MAIL_TRANSPORT=outbox).
# Не изисква администратор: създава два тестови профила (паролите са случайни, само във временния файл на проверката) и накрая ги изтрива.
#   bash tools/qa/run-accounts-e2e.sh
set -u
cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1
CLI="docker compose exec -T cms node --disable-warning=ExperimentalWarning cms/cli.mjs"
QA="docker compose --profile qa run --rm -T qa-local node"
FAIL=0
wait_healthy() { for i in $(seq 1 40); do [ "$(docker inspect -f '{{.State.Health.Status}}' recipes-cms-1 2>/dev/null)" = "healthy" ] && return 0; sleep 2; done; return 1; }

docker compose --profile qa build qa-local >/dev/null 2>&1
docker compose up -d cms web >/dev/null 2>&1 && wait_healthy && $CLI unlock >/dev/null
$QA e2e-accounts.mjs a || FAIL=$((FAIL + 1))
MOD=$(grep -o '"mod":{"email":"[^"]*"' qa-output/e2e-accounts/state.json 2>/dev/null | cut -d'"' -f6)
if [ -n "$MOD" ]; then $CLI set-role --email="$MOD" --role=moderator; $QA e2e-accounts.mjs b || FAIL=$((FAIL + 1)); else echo "  ✘ няма състояние от стъпка a"; FAIL=$((FAIL + 1)); fi
$CLI unlock >/dev/null
echo; echo "════ ОБОБЩЕНИЕ (профили): ${FAIL} неуспешни стъпки ════"
exit $FAIL
