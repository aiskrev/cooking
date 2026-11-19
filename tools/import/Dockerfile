# Инструменти за импорт и анализ на снимки (само локално; не е част от сайта).
FROM node:22-bookworm-slim
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation fonts-noto-core ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /t
RUN npm init -y >/dev/null && npm pkg set type=module >/dev/null && npm i --no-audit --no-fund sharp@0.35.5 >/dev/null 2>&1
