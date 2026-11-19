import { getCollection, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import sharp from 'sharp';
import path from 'node:path';
import { slugify } from './text';

export type Recipe = CollectionEntry<'recipes'>;

export async function getRecipes(): Promise<Recipe[]> {
  // Чернови и архивирани рецепти не стигат до каталога, категориите, етикетите, търсенето, RSS и sitemap.
  const all = await getCollection('recipes', ({ data }) => data.publication === 'published');
  return all.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

// ---------- Снимки ----------
// Всички снимки от src/content/recipes/<рецепта>/photos/ се откриват автоматично.
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
  const orderOf = (k: string) => recipe.data.photos[k.slice(prefix.length)]?.order ?? Number.MAX_SAFE_INTEGER;
  keys.sort((a, b) => orderOf(a) - orderOf(b));
  for (const k of keys) {
    const file = k.slice(prefix.length);
    const mod = await modules[k]();
    const meta = recipe.data.photos[file];
    const n = result.size + 1;
    if (!meta) {
      console.warn(`[снимки] ${recipe.id}/${file}: няма alt/описание в "photos:" — ползва се общ текст. Добавете го в index.md.`);
    }
    result.set(file, {
      file,
      key: `${recipe.id}/${file}`,
      image: mod.default,
      lqip: await makeLqip(k),
      alt: meta?.alt ?? `${recipe.data.title} — снимка ${n}`,
      caption: meta?.caption,
    });
  }
  // Проверка: всяка снимка, посочена в index.md, трябва да съществува.
  const referenced = [
    ...(recipe.data.cover ? [recipe.data.cover] : []),
    ...recipe.data.steps.flatMap((s) => (s.photo ? [s.photo] : [])),
    ...Object.keys(recipe.data.photos),
  ];
  for (const f of referenced) {
    if (!result.has(f)) {
      throw new Error(`Рецепта "${recipe.id}": снимката "${f}" е посочена в index.md, но липсва в папката photos/.`);
    }
  }
  return result;
}

export async function getCoverPhoto(recipe: Recipe): Promise<Photo | undefined> {
  const photos = await getPhotos(recipe);
  return recipe.data.cover ? photos.get(recipe.data.cover) : [...photos.values()][0];
}

// ---------- Категории и етикети ----------
export interface Term { name: string; slug: string; recipes: Recipe[] }

function collect(recipes: Recipe[], pick: (r: Recipe) => string[]): Term[] {
  const map = new Map<string, Term>();
  for (const r of recipes) {
    for (const name of pick(r)) {
      const slug = slugify(name);
      const t = map.get(slug) ?? { name, slug, recipes: [] };
      t.recipes.push(r);
      map.set(slug, t);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'bg'));
}

export const getCategories = (recipes: Recipe[]) => collect(recipes, (r) => [r.data.category]);
export const getTags = (recipes: Recipe[]) => collect(recipes, (r) => r.data.tags);

// ---------- Сродни рецепти ----------
// Обикновени съставки не показват, че две ястия си приличат
const STAPLES = new Set(['сол', 'вода', 'олио', 'черен пипер', 'захар', 'масло', 'брашно', 'яйце', 'яйца', 'лук', 'чесън', 'червен пипер', 'зехтин', 'лимон']);
const mainIngredients = (r: Recipe) =>
  new Set(r.data.ingredients.flatMap((g) => g.items.map((i) => (typeof i === 'string' ? i : i.name).toLocaleLowerCase('bg').trim())).filter((n) => n && !STAPLES.has(n)));

export function getRelated(recipe: Recipe, all: Recipe[], limit = 3): Recipe[] {
  const mine = mainIngredients(recipe);
  const score = (r: Recipe) => {
    if (r.id === recipe.id) return -1;
    let s = 0;
    if (r.data.category === recipe.data.category) s += 3;
    if (r.data.collection === recipe.data.collection) s += 1;
    s += r.data.tags.filter((t) => recipe.data.tags.includes(t)).length * 2;
    s += r.data.method.filter((m) => recipe.data.method.includes(m)).length;
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
