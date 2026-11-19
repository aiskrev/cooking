// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Публичният адрес на сайта се задава при сборка: SITE_URL=https://recepti.вашдомейн.bg
const site = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/+$/, '');

export default defineConfig({
  site,
  output: 'static',
  // Администрацията сглобява нова версия в отделна папка и после я включва (ASTRO_OUT_DIR); иначе – ./dist
  outDir: process.env.ASTRO_OUT_DIR || './dist',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
  integrations: [sitemap({ filter: (page) => !page.includes('/lyubimi/') })],
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
