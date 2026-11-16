import { getCollection, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import sharp from 'sharp';
import path from 'node:path';
import { slugify } from './text';

export type Recipe = CollectionEntry<'recipes'>;

export async function getRecipes(): Promise<Recipe[]> {
  const all = await getCollection('recipes');
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
