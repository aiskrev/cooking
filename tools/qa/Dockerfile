# Инструменти за проверка: Chromium + Playwright + Lighthouse + axe. Не е част от сайта.
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive CHROME_PATH=/usr/bin/chromium NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /qa
RUN npm init -y >/dev/null && npm i --no-audit --no-fund lighthouse@13.6.0 playwright-core axe-core >/dev/null 2>&1 \
    && npm ls --depth=0
COPY *.mjs ./
