// Помощници за тестовете: временна папка с данни и рецепти; контекстът се създава след задаване на променливите на средата.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function makeCtx({ recipes = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-test-'));
  process.env.DATA_DIR = path.join(root, 'data');
  process.env.CONTENT_DIR = path.join(root, 'content');
  process.env.RELEASES_DIR = path.join(root, 'releases');
  process.env.APP_DIR = process.cwd();
  fs.mkdirSync(process.env.CONTENT_DIR, { recursive: true });
  fs.mkdirSync(process.env.RELEASES_DIR, { recursive: true });
  const { createContext } = await import('../lib/ctx.mjs');
  const rec = await import('../lib/recipes.mjs');
  const ctx = createContext();
  for (const [slug, data] of Object.entries(recipes)) rec.writeRecipe(ctx, slug, { ...minimal(slug), ...data }, '');
  return { ctx, root, rec, cleanup: () => { try { ctx.db.close(); } catch { /* вече е затворена */ } fs.rmSync(root, { recursive: true, force: true }); } };
}

export const minimal = (slug) => ({
  title: `Рецепта ${slug}`, description: 'Описание на тестова рецепта, достатъчно дълго.', date: '2026-01-01', status: 'reconstruction', review: false, illustrative: false, featured: false,
  publication: 'published', collection: 'traditional', category: 'Основни ястия', method: [], tags: [], prepTime: 10, cookTime: 20, restTime: 0, servings: 4, photos: {},
  mise: [], ingredients: [{ items: [{ name: 'вода', amount: 1, unit: 'л', scale: true }] }], steps: [{ text: 'Сварете водата.' }], tips: [], mistakes: [], substitutions: [], allergens: [],
});
