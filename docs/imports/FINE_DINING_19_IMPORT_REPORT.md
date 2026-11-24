# Колекция Fine Dining (19 ястия) – отчет за импорта

**Дата:** 24.11.2026

**Изходна папка:** `D:\Cooking\new pics` (само четене)

**Подредени копия:** `D:\Cooking\sorted-recipes\collection-19`

**Код:**

- PR [aiskrev/cooking#21](https://github.com/aiskrev/cooking/pull/21), слят като `58b09e2`;
- клон `feat/fine-dining-19-recipes-import`, комит `3498a39`.

## 1. Числа

| | Брой |
|---|---|
| Намерени файлове (снимки) | 223 (214 WebP, 9 PNG), плюс един архив `new pics.zip`, който не е снимка и е пропуснат |
| Валидни (декодират се) | 223 |
| Повредени | 0 |
| Точни дубликати (SHA-256) | 0 |
| Почти еднакви варианти (dHash ≤ 6 и визуален преглед) | 102 – варианти на вече покрит етап, не са публикувани |
| Извън обхвата | 37 – 7 колажа-раскадровки, 10 гребенки, 10 патица, 10 лаврак |
| Погрешно генерирани | 1 – #176, сепия в шафранов бульон с руй (елементи от ястие 11) |
| Неидентифицирани | 0 |
| Разпознати като част от колекцията | 185 |
| Обработени и публикувани (WebP 1600 px, без метаданни) | 83 – 36 в нови рецепти, 47 в съществуващи |
| Нови рецепти | 6: 4 публикувани, 2 чернови |
| Съществуващи рецепти, свързани с колекцията | 13, от тях 9 с нови кадри |
| Езикови версии | всяка нова рецепта има BG и EN (6 + 6) |

Метод:

- Всичките 223 кадъра са прегледани визуално на 12 контролни листа с номера; спорните (#68, #176, #199) и увеличени.
- Имената и датите на файловете не са ползвани като доказателство.
- Оценката 0–100 в манифеста е ориентировъчна, не е калибрирана вероятност.

Подробно по снимка: `docs/imports/FINE_DINING_19_IMAGE_MANIFEST.json`.

## 2. Ястията

| № | BG | EN | Намерени | Уникални (публ.) | Липсващи етапи | BG адрес | EN адрес | QA | Публикуване |
|---|---|---|---|---|---|---|---|---|---|
| 01 | Телешко филе и хрупкави тимусни жлези със смръчкули | Veal Fillet and Crisp Sweetbreads with Morels | 10 | 10 (+10 стари) | – | [bg](https://recipes.ai-commercestudio.com/bg/recepti/teleshko-file-i-timusni-zhlezi-sas-smrachkuli-i-grah/) | [en](https://recipes.ai-commercestudio.com/en/recipes/teleshko-file-i-timusni-zhlezi-sas-smrachkuli-i-grah/) | PASS | съществуваща + 10 кадъра |
| 02 | Заешко филе и бутче със сушени сливи и арманяк | Rabbit Loin and Braised Leg with Prunes and Armagnac | 53 | 10 | – | [bg](https://recipes.ai-commercestudio.com/bg/recepti/zaeshko-file-s-sushheni-slivi-i-armanyak/) | [en](https://recipes.ai-commercestudio.com/en/recipes/zaeshko-file-s-sushheni-slivi-i-armanyak/) | PASS | съществуваща + 10 (43 варианта не са публикувани) |
| 03 | Токачка с кестени, круши и савойско зеле | Guinea Fowl with Chestnuts, Pears and Savoy Cabbage | 7 | 7 | 08, 09, 10 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/tokachka-s-kesteni-krushi-i-savoysko-zele/) | [en](https://recipes.ai-commercestudio.com/en/recipes/tokachka-s-kesteni-krushi-i-savoysko-zele/) | PASS | съществуваща + 7 |
| 04 | Пилешки гърди с трюфелов мус и черен корен | Truffled Chicken Supreme, Salsify | 0 | 0 | всички | [bg](https://recipes.ai-commercestudio.com/bg/recepti/pile-s-tryufelov-mus-cheren-koren-i-tryufelov-sos/) | [en](https://recipes.ai-commercestudio.com/en/recipes/pile-s-tryufelov-mus-cheren-koren-i-tryufelov-sos/) | – | съществуваща, без нови кадри |
| 05 | Хрупкава свинска гърда с карамелизиран ананас | Crisp Pork Belly with Caramelised Pineapple | 28 | 2 | 01–08, 10 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/svinska-gurda-s-karameliziran-ananas/) | [en](https://recipes.ai-commercestudio.com/en/recipes/svinska-gurda-s-karameliziran-ananas/) | PASS | съществуваща + 2 |
| 06 | Задушени ребра с кафе глазура и пюре от пащърнак | Braised Short Ribs with Coffee Glaze and Parsnip | 6 | 1 | 02–10 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/govezhdi-rebra-s-kafe-glazura-i-pyure-ot-pashtarnak/) | [en](https://recipes.ai-commercestudio.com/en/recipes/govezhdi-rebra-s-kafe-glazura-i-pyure-ot-pashtarnak/) | PASS | съществуваща + 1 |
| 07 | Бавно готвено козе месо с фурми и розова хариса | Slow-Cooked Goat with Date and Rose Harissa | 0 | 0 | всички | – (чернова) | – (чернова) | PASS (сглобяване) | **чернова** – няма снимки |
| 08 | Свинско печено с хрупкава кожа, дюли и резене | Suckling Pig / Roast Pork with Quince and Fennel | 0 | 0 | всички | [bg](https://recipes.ai-commercestudio.com/bg/recepti/svinsko-pecheno-s-hrupkava-kozha-dyuli-i-rezene/) | [en](https://recipes.ai-commercestudio.com/en/recipes/svinsko-pecheno-s-hrupkava-kozha-dyuli-i-rezene/) | – | съществуваща, без нови кадри |
| 09 | Октопод на жар с ромеско и шафранови картофи | Charred Octopus with Romesco and Saffron Potatoes | 6 | 2 | 02–08, 10 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/oktopod-s-romesko-i-shafranovi-kartofi/) | [en](https://recipes.ai-commercestudio.com/en/recipes/oktopod-s-romesko-i-shafranovi-kartofi/) | PASS | съществуваща + 2 |
| 10 | Морски дявол с чоризо и пюре от бял боб | Monkfish with Chorizo and White Bean | 6 | 3 | 02, 05–10 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/morski-dyavol-s-chorizo-i-pyure-ot-byal-bob/) | [en](https://recipes.ai-commercestudio.com/en/recipes/morski-dyavol-s-chorizo-i-pyure-ot-byal-bob/) | PASS | съществуваща + 3 |
| 11 | Барбун с буябес, шафранов руй и хрупкави картофи | Red Mullet, Bouillabaisse, Saffron Rouille | 12 | 2 | 01–08, 10 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/barbunya-s-buyabes-sos-ruy-i-hrupkavi-kartofi/) | [en](https://recipes.ai-commercestudio.com/en/recipes/barbunya-s-buyabes-sos-ruy-i-hrupkavi-kartofi/) | PASS | съществуваща + 2 |
| 12 | Леко осолена сьомга с киселец, цвекло, сметана и хайвер | Lightly Cured Salmon with Sorrel, Beetroot, Cultured Cream and Salmon Roe | 10 | 10 | 04, 07 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/leko-osolena-syomga-s-kiselets-tsvekle-i-hayver/) | [en](https://recipes.ai-commercestudio.com/en/recipes/leko-osolena-syomga-s-kiselets-tsvekle-i-hayver/) | PASS | **нова** |
| 13 | Осолена и опалена скумрия с цариградско грозде | Cured and Torched Mackerel with Gooseberry | 0 | 0 | всички | [bg](https://recipes.ai-commercestudio.com/bg/recepti/skumriya-s-tsarigradsko-grozde-krastavitsa-i-hryan/) | [en](https://recipes.ai-commercestudio.com/en/recipes/skumriya-s-tsarigradsko-grozde-krastavitsa-i-hryan/) | – | съществуваща, без нови кадри |
| 14 | Морски език с кафяво масло, скариди и каперси | Dover Sole with Brown Shrimp and Capers | 0 | 0 | всички | [bg](https://recipes.ai-commercestudio.com/bg/recepti/morski-ezik-s-kafyavi-skaridi-i-kapersi/) | [en](https://recipes.ai-commercestudio.com/en/recipes/morski-ezik-s-kafyavi-skaridi-i-kapersi/) | – | съществуваща; лавракът (#153–162) не е морски език и е изключен |
| 15 | Морски ножчета с лимоново масло и водорасли | Razor Clams with Lemon Butter and Seaweed | 10 | 10 | 05, 07 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/morski-nozhcheta-s-limonovo-maslo-i-vodorasli/) | [en](https://recipes.ai-commercestudio.com/en/recipes/morski-nozhcheta-s-limonovo-maslo-i-vodorasli/) | PASS | съществуваща + 10 |
| 16 | Карабинеро с домати, бренди, шафранов ориз и емулсия | Carabinero Prawn with Saffron Rice and Head-Juice Emulsion | 10 | 10 | 07 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/skarida-karabinero-s-shafranov-oriz-i-emulsiya/) | [en](https://recipes.ai-commercestudio.com/en/recipes/skarida-karabinero-s-shafranov-oriz-i-emulsiya/) | PASS | **нова** |
| 17 | Сепия с черен мастилен сос, грах, печен чесън и лимон | Cuttlefish with Black Ink, Green Peas, Roasted Garlic and Lemon | 15 | 8 | 02, 07, 08, 10 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/sepiya-s-cheren-mastilen-sos-grah-i-pechen-chesan/) | [en](https://recipes.ai-commercestudio.com/en/recipes/sepiya-s-cheren-mastilen-sos-grah-i-pechen-chesan/) | PASS | **нова** (#176 изключен) |
| 18 | Печена тиква с Комте, градински чай и пралине | Roasted Pumpkin, Aged Comté, Sage, Pumpkin-Seed Praline | 7 | 4 | 02–04, 07–10 | – (чернова) | – (чернова) | PASS (сглобяване) | **чернова** – няма готово ястие |
| 19 | Цвекло в солена кора с козе сирене, вишни и ким | Salt-Baked Beetroot, Goat Curd, Sour Cherry, Caraway | 8 | 4 | 01–08, 10 | [bg](https://recipes.ai-commercestudio.com/bg/recepti/tsvekle-v-solena-kora-s-koze-sirene-i-vishni/) | [en](https://recipes.ai-commercestudio.com/en/recipes/tsvekle-v-solena-kora-s-koze-sirene-i-vishni/) | PASS | **нова** |

Етапите са номерирани така:

| № | Етап |
|---|---|
| 01 | суровини |
| 02 | мизанплас |
| 03 | подготовка |
| 04 | основно готвене |
| 05 | допълнителни компоненти |
| 06 | сос |
| 07 | макро на готвенето |
| 08 | аранжиране |
| 09 | готово ястие |
| 10 | макро на ястието |

Етапите не са попълвани изкуствено: няколко варианта на готовото ястие са записани като варианти на етап 09, не като отделни етапи.

## 3. Решения

- **13 от 19-те ястия вече бяха на сайта** от предишните партиди. Не са създадени дубликати. Новите кадри са добавени като „Фотосесия 5“, без да се пипат старите снимки и текстове. Затова `import-recipes.mjs` не е пускан върху тях: той би изтрил старите снимки.
- **Чернови:**
  - 18 (тиква) няма надежден кадър на готовото ястие;
  - 07 (козе месо) няма нито една снимка в новата папка.

  И двете са с `publication: draft` и BG и EN текст. Не се виждат на сайта (проверено: 404).
- **Без нови кадри:** за 04, 08, 13 и 14 в новата папка няма снимки. Рецептите им остават, както са.
- **Хранителни стойности** не са добавени: в схемата няма такова поле, а изчисляването изисква надеждна база данни. Безалкохолните съчетания са в „Поднасяне“.
- **Без измислени твърдения:** няма твърдения за звезди MICHELIN, няма измислени оценки и автори. JSON-LD е само от реалните данни на рецептата.
- **Вегетариански ястия:** 19 и 18 са отбелязани като вегетариански с уговорката за маята на сиренето.

## 4. Публикуване

| | Стойност |
|---|---|
| Сливане | `58b09e2` в `main` (squash на PR #21) |
| Резервно копие преди публикуването | `/data/backups/20261124132028` |
| Образ на услугата | `recipes-cms:prod` с новата таксономия |
| Миграции на базата | няма – само съдържание и таксономия |
| CI | хранилището няма CI; проверките са локални (вж. QA отчета) |
| Версия на сайта | вж. QA отчета, раздел „Продукция“ |

Връщане назад:

1. На сървъра в `/opt/recipes`:
   ```
   sudo git checkout 3e01815 -- src/content/recipes src/i18n/taxonomy.json
   ```
   или `git revert 58b09e2`.
2. Пуснете отново предишния образ и `cli.mjs build`. Предишната версия на сайта е и в `/releases`. Администрацията може да я върне с „Връщане“.
3. Базата не е променяна.

## 5. Нужно от собственика

1. Снимки за 07 (козе месо) и за готовото ястие на 18 (тиква). След това двете чернови могат да се публикуват.
2. Снимки за 04, 08, 13 и 14, ако искате нови галерии и за тях.
3. Преглед на рецептите – те са редакционно разработени (`review: true`).
