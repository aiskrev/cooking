#!/bin/sh
# Запуск на скрипт от scripts/ в контейнера с sharp: sh run.sh import-recipes.mjs [аргументи]
set -e
script="$1"; shift
cp "/work/scripts/$script" "/t/$script"
cd /work
exec node "/t/$script" "$@"
