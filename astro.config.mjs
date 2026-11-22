// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Публичният адрес на сайта се задава при сборка: SITE_URL=https://recepti.вашдомейн.bg
const site = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/+$/, '');
// Лични и служебни страници (същият списък като privateRoutes в src/i18n/index.ts)
const PRIVATE = /^\/(bg|en)\/(lyubimi|favorites|vhod|sign-in|registratsia|register|zabravena-parola|forgot-password|nova-parola|reset-password|potvarzhdenie|verify-email|profil|account|moderatsia|moderation)\/$/;

export default defineConfig({
  site,
  output: 'static',
  // Администрацията сглобява нова версия в отделна папка и после я включва (ASTRO_OUT_DIR); иначе – ./dist
  outDir: process.env.ASTRO_OUT_DIR || './dist',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
  // В карта на сайта: всички публикувани страници и на двата езика (/bg/…, /en/…). Не влизат: корен „/“ (само пренасочване),
  // „Любими“ (/bg/lyubimi/, /en/favorites/ – лични, noindex), страниците на профила (вход, регистрация, нова парола, потвърждаване,
  // профил, модерация – noindex) и 404. Връзките между езиците са в <head> (hreflang), само за реални двойки.
  integrations: [
    sitemap({
      filter: (page) => {
        const p = new URL(page).pathname;
        return p !== '/' && !PRIVATE.test(p) && !p.startsWith('/404');
      },
    }),
  ],
  security: {
    csp: {
      // 'wasm-unsafe-eval' – нужно на търсачката Pagefind (WebAssembly)
      scriptDirective: { resources: ["'self'", "'wasm-unsafe-eval'"] },
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
