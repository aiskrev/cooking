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
# INDEXABLE=1 позволява индексиране (по подразбиране сайтът е НЕиндексируем)
ARG INDEXABLE=
ENV SITE_URL=$SITE_URL INDEXABLE=$INDEXABLE
RUN --mount=type=cache,target=/app/node_modules/.astro npm run build

FROM build AS check
RUN npm run check

FROM scratch AS export
COPY --from=build /app/dist/ /

FROM caddy:2-alpine AS serve
COPY deploy/Caddyfile.container /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080

# ---- Администрация, оценки и коментари (локална услуга; публичният сайт остава статичен) ----
#   cms           – Node услуга: /admin, /api; сглобява и включва нови версии на сайта (стъпка „Публикувай“)
#   astro-cache   – кеш на оптимизираните снимки от сглобяването; изнася се, за да не е първата публикация „студена“
FROM deps AS cms
COPY astro.config.mjs ./
COPY public ./public
COPY scripts ./scripts
COPY cms ./cms
COPY src/components ./src/components
COPY src/layouts ./src/layouts
COPY src/views ./src/views
COPY src/i18n ./src/i18n
COPY src/lib ./src/lib
COPY src/scripts ./src/scripts
COPY src/pages ./src/pages
COPY src/styles ./src/styles
COPY src/content.config.ts src/site.config.ts ./src/
# Рецептите (src/content/recipes) и заглавните снимки (src/assets/site) се монтират при пускане;
# данните (/data), версиите на сайта (/releases) и кешът на снимките са в отделни томове.
RUN mkdir -p src/content/recipes src/assets/site node_modules/.astro .astro /data /releases \
 && chown node:node /app /app/node_modules /app/node_modules/.astro /app/.astro /data /releases
USER node
ENV NODE_ENV=production DATA_DIR=/data RELEASES_DIR=/releases PORT=3000
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "cms/server.mjs"]

FROM build AS astro-cache-src
RUN --mount=type=cache,target=/app/node_modules/.astro mkdir -p /out && cp -a /app/node_modules/.astro/. /out/

FROM scratch AS astro-cache
COPY --from=astro-cache-src /out/ /
