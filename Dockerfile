# syntax=docker/dockerfile:1
# Етапи:
#   dev     – режим за разработка (docker compose up dev)
#   build   – сглобява статичния сайт в /app/dist (+ индекс за търсене)
#   check   – build + проверки (връзки, schema.org, снимки); пада, ако има грешка
#   export  – само готовите файлове (docker build --target export --output dist-out .)
#   serve   – малък Caddy образ със сглобения сайт (за локален преглед или самостоятелно пускане)
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false CI=true

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS dev
COPY . .
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
# Публичен адрес на сайта (канонични връзки, sitemap, RSS). Задайте при сборка за продукция.
ARG SITE_URL=http://localhost:8080
# NOINDEX=1 забранява индексирането (тестов период)
ARG NOINDEX=
ENV SITE_URL=$SITE_URL NOINDEX=$NOINDEX
RUN --mount=type=cache,target=/app/node_modules/.astro npm run build

FROM build AS check
RUN npm run check

FROM scratch AS export
COPY --from=build /app/dist/ /

FROM caddy:2-alpine AS serve
COPY deploy/Caddyfile.container /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
