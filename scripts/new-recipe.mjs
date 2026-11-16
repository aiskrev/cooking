// Помощник за нова рецепта.
//   node scripts/new-recipe.mjs "Заглавие на рецептата"     -> създава папка с шаблон и photos/
//   node scripts/new-recipe.mjs --photos <име-на-папката>   -> печата "photos:" блок за снимките в папката
import fs from 'node:fs';
import path from 'node:path';

const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya' };
const slugify = (s) => [...s.toLowerCase()].map((c) => map[c] ?? c).join('').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const root = path.resolve('src/content/recipes');
const args = process.argv.slice(2);

if (args[0] === '--photos') {
  const dir = path.join(root, args[1] ?? '', 'photos');
  if (!fs.existsSync(dir)) { console.error('Няма такава папка: ' + dir); process.exit(1); }
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  console.log('photos:');
  for (const f of files) console.log(`  ${f}:\n    alt: ОПИШЕТЕ какво се вижда на снимката\n    caption: Подпис (по желание)`);
  process.exit(0);
}

const title = args.join(' ').trim();
if (!title) { console.error('Употреба: npm run new-recipe -- "Заглавие на рецептата"'); process.exit(1); }
const slug = slugify(title);
const dir = path.join(root, slug);
if (fs.existsSync(dir)) { console.error('Папката вече съществува: ' + dir); process.exit(1); }
fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(dir, 'index.md'), `---
title: ${title}
description: Едно-две изречения за рецептата (до 200 знака) – показват се в Google и в споделяне.
date: ${today}
review: true          # сменете на false, когато проверите текста
illustrative: false   # true само ако снимките са генерирани/илюстративни
category: Основни ястия
tags: []
prepTime: 20          # минути
cookTime: 40          # минути
servings: 4
# cover: 01-ime-na-snimka.jpg   # главна снимка; ако липсва – първата по азбучен ред

# Описания на снимките: ключът е името на файла в папката photos/.
# Снимки без запис тук пак се показват (в "Още снимки"), но с общ alt текст – по-добре ги опишете.
photos: {}

ingredients:
  - title: Съставки
    items:
      - 1 съставка
steps:
  - title: Първа стъпка
    text: Опишете какво се прави.
    # photo: 01-ime-na-snimka.jpg
---

## Бележки

Съвети и вариации (по желание).
`);
console.log(`Създадено: src/content/recipes/${slug}/\n  1) Копирайте снимките в src/content/recipes/${slug}/photos/\n  2) Редактирайте index.md\n  3) npm run new-recipe -- --photos ${slug}   (печата блок "photos:" за всички снимки)`);
