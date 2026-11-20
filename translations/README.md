# Работна папка за превод

Преводът живее до рецептите (`src/content/recipes/<рецепта>/index.en.md`). Тази папка е само за пакетна работа със скриптовете:

- `export/` – `npm run translations:export` записва тук преводимия български текст (не се качва в Git).
- `inbox/` – тук се слагат готови файлове с превод (`<рецепта>.json`) за `npm run translations:generate` (не се качва в Git).

Процес, опции и правила за качество: `docs/TRANSLATION_WORKFLOW.md`.
