// Генерира отчетите за импорта на български: node make-reports.mjs <inventory.json> <recipes-dir> <site-assets-dir> <изход> [копие-на-отчетите]
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const [invPath, recipesDir, siteDir, outDir, copyDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
const byName = new Map(inv.map((r) => [r.name, r]));
const MB = (b) => (b / 1048576).toFixed(1);

// ---- рецепти ----
const recipes = [];
for (const slug of fs.readdirSync(recipesDir)) {
  const md = path.join(recipesDir, slug, 'index.md');
  if (!fs.existsSync(md)) continue;
  const d = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(md, 'utf8').replace(/\r\n/g, '\n'))[1]);
  const man = fs.existsSync(path.join(recipesDir, slug, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(recipesDir, slug, 'manifest.json'), 'utf8')) : { photos: {} };
  const files = fs.readdirSync(path.join(recipesDir, slug, 'photos'));
  const stepPhotos = d.steps.filter((s) => s.photo).length;
  const sessions = new Set(Object.values(d.photos ?? {}).map((p) => p.session ?? 'основна'));
  recipes.push({ slug, d, man, files, stepPhotos, sessions: sessions.size, sources: Object.values(man.photos ?? {}) });
}
recipes.sort((a, b) => a.d.collection.localeCompare(b.d.collection) || a.d.title.localeCompare(b.d.title, 'bg'));

// ---- употреба на изходните файлове ----
const usage = new Map(); // име -> [{slug, role}]
for (const r of recipes) for (const p of r.sources) (usage.get(p.sourceName) ?? usage.set(p.sourceName, []).get(p.sourceName)).push(`${r.slug} (${p.role})`);
const siteMan = fs.existsSync(path.join(siteDir, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(siteDir, 'manifest.json'), 'utf8')) : {};
for (const [f, p] of Object.entries(siteMan)) (usage.get(p.sourceName) ?? usage.set(p.sourceName, []).get(p.sourceName)).push(`сайт: ${f}`);

// колажи, установени визуално
const collages = { 43: 'коментар: колаж от 4 панела (грис с вишни)', 159: 'колаж от 4 панела (кюфтета)', 230: 'колаж от 2 панела (скариди)', 311: 'колаж/сториборд (кебапчета)', 312: 'колаж/сториборд (кебапчета и лютеница)', 313: 'колаж/сториборд (кебапчета)', 386: 'колаж от 3 панела (агнешко)', 399: 'колаж от 4 панела (гювеч)', 415: 'колаж/сториборд (винен кебап)', 416: 'колаж/сториборд (винено свинско)', 417: 'колаж/сториборд (винено свинско)', 419: 'колаж/сториборд (винено свинско)', 481: 'колаж/сториборд (зелник)' };
const byIdx = new Map(inv.map((r) => [r.idx, r]));
const MEDIUM = {
  'orehova-torta-s-karamel': 'името на тортата е предположение по визия (бишкоти, карамел, орехи)',
  'gris-s-vishni-i-karamel': 'името е предположение по визия (грис/крем, вишни, карамел); в серията има колаж',
  'selski-gyuvech-v-zidana-pesht': 'общо ястие в глинен съд; възможно съвпадение с „Бански чомлек“ – не е потвърдено',
  'rodopski-patatnik': 'идентифициран по състав (картофи, сирене, яйце, мента); файловете са именувани „Rosti“',
  'svinska-kavarma': 'име по каталога; визуално – свинско, гъби, чушки, вино в гювеч (може да е и „Свинско с гъби и чушки“)',
  'vinen-kebap': 'име по каталога и по имената на файловете („Wine Kebab“); ястието е свинско във вино с ориз',
  'mish-mash': 'липсва финален кадър със счупени яйца; сиренето е последният кадър',
  'zelnik': 'липсва кадър на изпечен зелник (има само в колаж)',
  'patitsa-s-portokalov-gastrik': 'втората серия (#271–#277) може да е вариантът „мандарина, джинджифил, мащерка“ – не е потвърдено',
  'sirene-po-shopski': 'редът на кадри 527–530 е определен приблизително (яйцето се вижда само в част от кадрите)',
};
const catalog = [
  ['Шопска салата 2.0', null, 'няма отделна серия; салата се вижда само като гарнитура в други кадри'],
  ['Баница със сирене', 'banitsa-sas-sirene'], ['Свинска кавърма', 'svinska-kavarma'], ['Родопски пататник', 'rodopski-patatnik'],
  ['Пълнени чушки с кайма и ориз', 'pylneni-chushki-s-kayma-i-oriz'], ['Сарми с лозови листа', 'sarmi-s-lozovi-listsa'], ['Мусака', 'musaka'],
  ['Боб чорба', 'bob-chorba'], ['Манастирска боб чорба', null, 'няма отделна серия; най-близка е „Боб чорба“'], ['Смилянски боб', null, 'няма серия (боб с наденица е различно ястие)'],
  ['Кебапчета', 'kebapcheta'], ['Таратор', 'tarator'], ['Агнешко печено с дроб сарма', 'agneshko-s-drob-sarma'], ['Тиквеник', 'tikvenik'], ['Капама', 'kapama'],
  ['Бански чомлек', null, 'не е потвърден; кандидат с ниска сигурност: „Селски гювеч в зидана пещ“'], ['Зелеви сарми', 'zelevi-sarmi'], ['Чушки бюрек', 'chushki-byurek'],
  ['Сирене по шопски', 'sirene-po-shopski'], ['Телешки гювеч', 'teleshki-gyuvech-s-kartofi-i-morkovi'], ['Винен кебап', 'vinen-kebap'], ['Яйца по панагюрски', 'yaytsa-po-panagyurski'],
  ['Супа топчета', 'supa-topcheta'], ['Миш-маш', 'mish-mash'], ['Мекици', 'mekitsi'], ['Торта Гараш', 'torta-garash'], ['Зелник', 'zelnik'], ['Тутманик', null, 'няма снимки'],
  ['Патица с портокалов гастрик', 'patitsa-s-portokalov-gastrik'], ['Патица с мандарина, джинджифил и мащерка', null, 'отделен вариант не е потвърден (вж. втората серия в „Патица с портокалов гастрик“)'],
  ['Сьомга (гравлакс)', 'gravlaks-ot-syomga'], ['Стриди Rockefeller', 'stridi-rockefeller'], ['Октопод на грил', 'oktopod-na-grill'], ['Телешко филе с гъбен сос', 'teleshko-file-s-gabeni-sos'],
  ['Телешко със цитрусов акцент', 'telesho-s-tsitrusova-sol'], ['Равиоли с рикота и грах', 'ravioli-s-rikota-i-grah'], ['Beef Wellington', 'beef-wellington'],
];
const have = new Set(recipes.map((r) => r.slug));

const totalPhotos = recipes.reduce((s, r) => s + r.files.length, 0);
const dups = inv.filter((r) => r.exactDuplicateOf);
const unique = inv.filter((r) => !r.exactDuplicateOf);
const unused = unique.filter((r) => !usage.has(r.name));
const out = (name, text) => { fs.writeFileSync(path.join(outDir, name), text); if (copyDir) { fs.mkdirSync(copyDir, { recursive: true }); fs.writeFileSync(path.join(copyDir, name), text); } };

// ===== ASSET_INVENTORY =====
const batches = new Map(); for (const r of inv) (batches.get(r.batch) ?? batches.set(r.batch, []).get(r.batch)).push(r);
out('ASSET_INVENTORY.md', `# Инвентар на изходните материали

Източник: \`D:\\Cooking\` (само четене; нищо не е изтривано, преместено или презаписвано).

| Показател | Стойност |
|---|---:|
| Файлове общо | ${inv.length} |
| Общ размер | ${MB(inv.reduce((s, r) => s + r.bytes, 0))} MB |
| PNG / WebP | ${inv.filter((r) => r.format === 'png').length} / ${inv.filter((r) => r.format === 'webp').length} |
| Уникални по SHA-256 | ${unique.length} |
| Точни дубликати | ${dups.length} |
| Визуално сходни (dHash ≤ 6, различни файлове) | ${inv.filter((r) => r.similar?.length).length} |
| Файлове с EXIF/XMP | ${inv.filter((r) => r.exif || r.xmp).length} |
| Текстови документи, таблици, архиви (txt/md/docx/pdf/zip) | 0 – в папката има само изображения |
| Колажи (няколко кадъра в един), изключени от последователностите | ${Object.keys(collages).length} |
| Използвани в рецепти или на сайта | ${unique.length - unused.length} |
| Неизползвани уникални файлове | ${unused.length} |

## Формати и размери
${Object.entries(inv.reduce((m, r) => ((m[`${r.width}×${r.height}`] = (m[`${r.width}×${r.height}`] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Точни дубликати (SHA-256) – пазят се в източника, в сайта влиза само първият
| № | Дубликат | Копие на |
|---:|---|---|
${dups.map((r) => `| ${r.idx} | ${r.name} | ${r.exactDuplicateOf} |`).join('\n')}

## Колажи (изключени като кадри от последователности)
| № | Файл | Забележка |
|---:|---|---|
${Object.entries(collages).map(([i, n]) => `| ${i} | ${byIdx.get(+i)?.name ?? '?'} | ${n} |`).join('\n')}

## Неизползвани уникални файлове
${unused.length ? unused.map((r) => `- #${r.idx} ${r.name}${collages[r.idx] ? ' – ' + collages[r.idx] : ''}`).join('\n') : 'Няма.'}

## Партиди по време на създаване (${batches.size})
Партида = файлове, създадени в рамките на 6 секунди един от друг (обикновено една серия от генерирани кадри). Пълният списък е в \`reports/_work/inventory.json\` (SHA-256, размер, хеш, партида, време).

## Произход и права
Всички ${inv.length} файла са именувани като експорти от ChatGPT („ChatGPT Image …“ или заглавия на генерирани изображения) и са третирани като **AI-генерирани илюстрации**. В сайта са маркирани с „Илюстративни снимки“. Правата за ползване и публикуване не са проверявани – решение на собственика.
`);

// ===== RECIPE_INVENTORY =====
const rows = recipes.map((r) => {
  const srcCount = r.sources.length;
  const missing = [];
  if (!r.d.cover) missing.push('корица');
  if (r.stepPhotos < r.d.steps.length) missing.push(`${r.d.steps.length - r.stepPhotos} стъпки без снимка`);
  if (MEDIUM[r.slug]?.includes('липсва')) missing.push(MEDIUM[r.slug]);
  return `| ${r.d.title} | ${r.d.collection === 'fine-dining' ? 'фино ядене' : 'традиционна'} | ${srcCount} | ${r.files.length} | ${r.sessions} | ${r.d.status} / ${r.d.review ? 'чернова' : 'публикувана'} | ${missing.join('; ') || '—'} |`;
});
out('RECIPE_INVENTORY.md', `# Инвентар на рецептите

Всички рецепти са **шеф-реконструкции** (status: reconstruction, review: true): в \`D:\\Cooking\` няма нито един текст, количество или бележка – текстът е разработен по снимките и е маркиран като чернова за проверка. Нищо не е „проверено по източник“.

Общо рецепти: **${recipes.length}** (традиционни: ${recipes.filter((r) => r.d.collection === 'traditional').length}, фино ядене: ${recipes.filter((r) => r.d.collection === 'fine-dining').length}); снимки в рецептите: **${totalPhotos}**; на сайта (заглавни кадри): ${Object.keys(siteMan).length}.

| Ястие | Колекция | Изходни снимки | Внесени снимки | Фотосесии | Статус | Липсващи материали |
|---|---|---:|---:|---:|---|---|
${rows.join('\n')}

## Сверка с известния каталог
| Ястие от каталога | Резултат |
|---|---|
${catalog.map(([n, slug, note]) => `| ${n} | ${slug && have.has(slug) ? `✔ ${slug}` : `✘ ${note ?? 'няма'}`} |`).join('\n')}

## Допълнително разпознати ястия (извън каталога)
${recipes.filter((r) => !catalog.some(([, s]) => s === r.slug)).map((r) => `- ${r.d.title}`).join('\n')}
`);

// ===== MISSING_ASSETS =====
const noHero = recipes.filter((r) => /липсва (финален|кадър)/.test(MEDIUM[r.slug] ?? ''));
out('MISSING_ASSETS.md', `# Липсващи материали

## Каталожни ястия без рецепта/снимки
${catalog.filter(([, s]) => !s || !have.has(s)).map(([n, , note]) => `- **${n}** – ${note ?? 'няма'}`).join('\n')}

## Липсващи текстове и източници
- В \`D:\\Cooking\` няма нито един текстов документ, таблица, бележка или архив. Рецептурният текст (количества, температури, времена) е изцяло разработен от нас и **изисква кулинарна проверка**.
- Снимките от по-ранни разговори с ChatGPT, които не са експортирани на диска, **не са достъпни** и не са внесени. Ако има още, експортирайте ги в \`D:\\Cooking\` и пуснете импорта отново.

## Липсващи кадри в сериите
${noHero.map((r) => `- **${r.d.title}** – ${MEDIUM[r.slug]}`).join('\n') || 'Няма.'}
- Рецепти с по-малко от 10 уникални кадъра в основната последователност: ${recipes.filter((r) => new Set(r.d.steps.filter((s) => s.photo).map((s) => s.photo)).size < 10).length} от ${recipes.length}. Липсващите етапи не са дублирани или „допълнени“.
- Рецепти без завършен кадър, различен от кадър на стъпка: проверка по корицата – корицата е най-добрият наличен кадър на готовото ястие; там, където е кадър от стъпка, е отбелязано.

## Формат на снимките
- Целта е портрет 4:5; наличните са предимно 1122×1402 (4:5), но има и квадрати 1254×1254 и пейзажни кадри (части от заглавните/единичните кадри).

## Права и произход
- Всички снимки са AI-генерирани; права, лицензи и допустимост за публична употреба не са проверявани.
`);

// ===== IMAGE_RECOGNITION_REVIEW =====
out('IMAGE_RECOGNITION_REVIEW.md', `# Преглед на разпознаването на ястията

Метод: всеки уникален файл е прегледан визуално върху контактни листове (по 20 снимки, подредени по време на създаване); ястието, етапът и редът са определени по видимото съдържание (съставки, действие на ръцете, съд, състояние на храната), а не само по имената. Серии, създадени в една и съща минута, са третирани като една кандидат-последователност. Нивата на сигурност са по рецепта.

## Ниво на сигурност по рецепта
| Рецепта | Сигурност | Забележка |
|---|---|---|
${recipes.map((r) => `| ${r.d.title} | ${MEDIUM[r.slug] ? 'MEDIUM' : 'HIGH'} | ${MEDIUM[r.slug] ?? 'ястието и етапите са ясно видими'} |`).join('\n')}

## Неяснота / за преглед от човек
${Object.entries(MEDIUM).map(([s, t]) => `- **${recipes.find((r) => r.slug === s)?.d.title ?? s}** – ${t}`).join('\n')}

## Поправени подредби (по съдържание, не по име на файл)
- **Мусака (втора серия, #360–#369):** в имената кадърът на изпечената мусака (#365) е преди разбиването и заливането на заливката (#366–#367). По съдържание заливката предхожда печенето → редът е …364, 366, 367, 365, 368, 369.
- **Пълнени чушки с кайма и ориз:** оригиналният файлов ред е обратен на хронологията; стъпките следват действителната работа (съставки → почистване → нарязване → задушаване → плънка → пълнене). Шестте съществуващи снимки са идентифицирани със серията #290–#295 по перцептивен хеш (разстояние 0–2 от 64 бита).
- **Сирене по шопски:** редът на кадри 527–530 е определен приблизително.
- **Бишкоти/орехова торта, грис торта:** редът следва вероятната технология; имената са предположения.

## Колажи и неподходящи кадри
${Object.entries(collages).map(([i, n]) => `- #${i} ${byIdx.get(+i)?.name} – ${n}`).join('\n')}

## Точни дубликати
${dups.length} файла са точни копии (SHA-256) – вж. ASSET_INVENTORY.md. Сходни по визия (различни) снимки няма при праг 6 от 64 бита; дубълите в сериите са отделни кадри на едни и същи стъпки и са запазени като „Допълнителни кадри“.

## Незавършени последователности
${recipes.filter((r) => r.stepPhotos < r.d.steps.length).map((r) => `- ${r.d.title}: ${r.stepPhotos} снимки към ${r.d.steps.length} стъпки`).join('\n')}
`);

// ===== IMPORT_REPORT =====
const li = fs.existsSync(path.join(path.dirname(invPath), 'last-import.json')) ? JSON.parse(fs.readFileSync(path.join(path.dirname(invPath), 'last-import.json'), 'utf8')) : {};
out('IMPORT_REPORT.md', `# Отчет от импорта

Команди (всички през Docker):
\`\`\`powershell
# сканиране и контактни листове (само четене на D:\\Cooking)
docker run --rm -v D:\\Cooking:/src:ro -v D:\\Projects\\recipes\\reports\\_work:/out -v D:\\Projects\\recipes\\tools\\import:/t/scripts:ro recipes-import node /t/scripts/scan.mjs /src /out/inventory.json
# импорт (идемпотентен; --dry-run за проба)
docker run --rm -v D:\\Cooking:/src:ro -v D:\\Projects\\recipes:/work -v D:\\Projects\\recipes\\tools\\import\\run.sh:/run.sh:ro recipes-import sh /run.sh import-recipes.mjs [--dry-run]
\`\`\`

Резултат от последния импорт: ${JSON.stringify({ definitions: li.definitions, created: li.created, updated: li.updated, unchanged: li.unchanged, conflicts: li.conflicts, errors: li.errors, photosConverted: li.photosConverted, distinctSourcesUsed: li.distinctSourcesUsed })}

Правила: изходните файлове никога не се променят; за всяка внесена снимка се пази SHA-256, оригинално име, размер и роля в \`src/content/recipes/<рецепта>/manifest.json\`; ръчно редактиран \`index.md\` не се презаписва (записва се \`index.generated.md\`); копията са WebP до 1600 px без метаданни.

Лично съдържание (рецепти, снимки, манифести, отчети) е в \`.gitignore\` и **не е качвано** в GitHub.
`);
console.log('отчети:', ['ASSET_INVENTORY', 'RECIPE_INVENTORY', 'MISSING_ASSETS', 'IMAGE_RECOGNITION_REVIEW', 'IMPORT_REPORT'].join(', '), '→', outDir, copyDir ?? '');
