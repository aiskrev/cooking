// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Публичният адрес на сайта се задава при сборка: SITE_URL=https://recepti.вашдомейн.bg
const site = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/+$/, '');

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
  integrations: [sitemap()],
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
