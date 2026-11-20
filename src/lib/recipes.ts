import { getCollection, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import sharp from 'sharp';
import path from 'node:path';
import { slugify } from './text';
import { t, localeInfo, termLabel, type Locale } from '../i18n';

export type BgEntry = CollectionEntry<'recipes'>;
export type EnEntry = CollectionEntry<'recipesEn'>;
export type RecipeData = Omit<BgEntry['data'], 'difficulty'> & { difficulty?: string };

/** Рецепта на конкретен език. `id` е общ за двата езика (стабилен идентификатор); `bg` е винаги българският оригинал. */
export interface Recipe {
  id: string;
  locale: Locale;
  entry: BgEntry | EnEntry;
  data: RecipeData;
  bg: BgEntry['data'];
  translation?: EnEntry['data']['translation'];
}

const byDate = (a: Recipe, b: Recipe) => b.data.date.valueOf() - a.data.date.valueOf();

/** Български оригинали на публикуваните рецепти */
async function publishedBg(): Promise<BgEntry[]> {
  // Чернови и архивирани рецепти не стигат до каталога, категориите, етикетите, търсенето, RSS и sitemap.
  return getCollection('recipes', ({ data }) => data.publication === 'published');
}

/** Публикувани английски преводи по идентификатор (само ако оригиналът е публикуван и преводът е със статус „published“) */
async function publishedEn(): Promise<Map<string, EnEntry>> {
  const bgIds = new Set((await publishedBg()).map((e) => e.id));
  const all = await getCollection('recipesEn', ({ data }) => data.translation.status === 'published');
  return new Map(all.filter((e) => bgIds.has(e.id)).map((e) => [e.id, e]));
}

export async function getRecipes(locale: Locale): Promise<Recipe[]> {
  const bgs = await publishedBg();
  if (locale === 'bg') {
    return bgs.map((e): Recipe => ({ id: e.id, locale, entry: e, data: e.data, bg: e.data })).sort(byDate);
  }
  const ens = await publishedEn();
  return bgs
    .filter((e) => ens.has(e.id))
    .map((e): Recipe => {
      const en = ens.get(e.id)!;
      return { id: e.id, locale, entry: en, data: en.data, bg: e.data, translation: en.data.translation };
    })
    .sort(byDate);
}

/** Идентификатори на рецептите, които имат публикуван превод (за превключвателя на езика и hreflang) */
export async function translatedIds(): Promise<Set<string>> {
  return new Set((await publishedEn()).keys());
}

// ---------- Снимки ----------
// Всички снимки от src/content/recipes/<рецепта>/photos/ се откриват автоматично. Снимките са общи за двата езика.
const modules = import.meta.glob<{ default: ImageMetadata }>(
  '/src/content/recipes/*/photos/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG,WEBP,AVIF}',
);

export interface Photo {
  file: string; // име на файла
  key: string; // уникален ключ: <рецепта>/<файл>
  image: ImageMetadata;
  lqip: string; // миниатюра като data: URI (цветен заместител до зареждане)
  alt: string;
  caption?: string;
}

const lqipCache = new Map<string, string>();
async function makeLqip(globKey: string): Promise<string> {
  const cached = lqipCache.get(globKey);
  if (cached) return cached;
  const file = path.join(process.cwd(), globKey);
  const buf = await sharp(file)
    .rotate()
    .resize({ width: 20 })
    .webp({ quality: 40 })
    .toBuffer();
  const uri = `data:image/webp;base64,${buf.toString('base64')}`;
  lqipCache.set(globKey, uri);
  return uri;
}

export async function getPhotos(recipe: Recipe): Promise<Map<string, Photo>> {
  const prefix = `/src/content/recipes/${recipe.id}/photos/`;
  const result = new Map<string, Photo>();
  const keys = Object.keys(modules)
    .filter((k) => k.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  // Ръчно зададен ред (поле order в photos:) има предимство; останалите остават по име на файла.
  // Редът и описанията идват от езика на страницата; редът се взема от оригинала, за да е еднакъв.
  const orderOf = (k: string) => recipe.bg.photos[k.slice(prefix.length)]?.order ?? Number.MAX_SAFE_INTEGER;
  keys.sort((a, b) => orderOf(a) - orderOf(b));
  for (const k of keys) {
    const file = k.slice(prefix.length);
    const mod = await modules[k]();
    const meta = recipe.data.photos[file];
    const n = result.size + 1;
    if (!meta) {
      console.warn(`[снимки] ${recipe.id}/${file} (${recipe.locale}): няма alt/описание в "photos:" — ползва се общ текст. Добавете го в рецептата.`);
    }
    result.set(file, {
      file,
      key: `${recipe.id}/${file}`,
      image: mod.default,
      lqip: await makeLqip(k),
      alt: meta?.alt ?? t(recipe.locale, 'photo.alt', { title: recipe.data.title, n }),
      caption: meta?.caption,
    });
  }
  // Проверка: всяка снимка, посочена в рецептата, трябва да съществува.
  const referenced = [
    ...(recipe.data.cover ? [recipe.data.cover] : []),
    ...recipe.data.steps.flatMap((s) => (s.photo ? [s.photo] : [])),
    ...Object.keys(recipe.data.photos),
  ];
  for (const f of referenced) {
    if (!result.has(f)) {
      throw new Error(`Рецепта "${recipe.id}" (${recipe.locale}): снимката "${f}" е посочена в рецептата, но липсва в папката photos/.`);
    }
  }
  return result;
}

export async function getCoverPhoto(recipe: Recipe): Promise<Photo | undefined> {
  const photos = await getPhotos(recipe);
  return recipe.data.cover ? photos.get(recipe.data.cover) : [...photos.values()][0];
}

// ---------- Категории и етикети ----------
// Групирането е по СТАБИЛЕН КЛЮЧ (българската стойност от оригинала), а не по показваното име:
// двата езика дават едни и същи групи и броят рецепти съвпада. Адресът (slug) е на езика на страницата.
export interface Term { key: string; name: string; slug: string; recipes: Recipe[] }

function collect(recipes: Recipe[], locale: Locale, group: 'category' | 'tag', pick: (r: Recipe) => string[]): Term[] {
  const map = new Map<string, Term>();
  for (const r of recipes) {
    for (const key of pick(r)) {
      const name = termLabel(locale, group, key) ?? key;
      const term = map.get(key) ?? { key, name, slug: slugify(name), recipes: [] };
      term.recipes.push(r);
      map.set(key, term);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, localeInfo[locale].intl));
}

export const getCategories = (recipes: Recipe[], locale: Locale) => collect(recipes, locale, 'category', (r) => [r.bg.category]);
export const getTags = (recipes: Recipe[], locale: Locale) => collect(recipes, locale, 'tag', (r) => r.bg.tags);

/** Етикет на термин (категория/етикет) на езика на страницата */
export const categoryName = (locale: Locale, r: Recipe) => termLabel(locale, 'category', r.bg.category) ?? r.data.category;

// ---------- Сродни рецепти ----------
// Обикновени съставки не показват, че две ястия си приличат (сравнението е по българския оригинал – общо за двата езика)
const STAPLES = new Set(['сол', 'вода', 'олио', 'черен пипер', 'захар', 'масло', 'брашно', 'яйце', 'яйца', 'лук', 'чесън', 'червен пипер', 'зехтин', 'лимон']);
const mainIngredients = (r: Recipe) =>
  new Set(r.bg.ingredients.flatMap((g) => g.items.map((i) => (typeof i === 'string' ? i : i.name).toLocaleLowerCase('bg').trim())).filter((n) => n && !STAPLES.has(n)));

export function getRelated(recipe: Recipe, all: Recipe[], limit = 3): Recipe[] {
  const mine = mainIngredients(recipe);
  const score = (r: Recipe) => {
    if (r.id === recipe.id) return -1;
    let s = 0;
    if (r.bg.category === recipe.bg.category) s += 3;
    if (r.bg.collection === recipe.bg.collection) s += 1;
    s += r.bg.tags.filter((tg) => recipe.bg.tags.includes(tg)).length * 2;
    s += r.bg.method.filter((m) => recipe.bg.method.includes(m)).length;
    // припокриване по основни съставки (до 4 общи, по 0,75 точки)
    s += Math.min(4, [...mainIngredients(r)].filter((n) => mine.has(n)).length) * 0.75;
    return s;
  };
  return all.map((r) => [r, score(r)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([r]) => r);
}

// ---------- Снимки за сайта (заглавни кадри) ----------
const siteModules = import.meta.glob<{ default: ImageMetadata }>('/src/assets/site/*.{webp,jpg,jpeg,png}');
export async function getSiteImage(file: string): Promise<{ image: ImageMetadata; alt: string } | undefined> {
  const key = `/src/assets/site/${file}`;
  if (!siteModules[key]) return undefined;
  const mod = await siteModules[key]();
  return { image: mod.default, alt: siteMeta[file]?.alt ?? '' };
}
// alt текстовете са в src/assets/site/manifest.json (създава се от импортера; файлът е по избор)
const siteManifests = import.meta.glob<Record<string, { alt: string; caption: string }>>('../assets/site/manifest.json', { eager: true, import: 'default' });
const siteMeta: Record<string, { alt: string; caption: string }> = Object.values(siteManifests)[0] ?? {};
