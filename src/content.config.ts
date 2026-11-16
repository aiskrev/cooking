import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const photoMeta = z.object({
  alt: z.string().min(5, 'alt текстът е задължителен и трябва да описва снимката'),
  caption: z.string().optional(),
});

const recipes = defineCollection({
  // Всяка рецепта е папка: index.md + photos/ със снимките.
  loader: glob({
    pattern: '*/index.md',
    base: './src/content/recipes',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(200),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    // true = чернова, чака проверка от автора (показва се бележка на страницата).
    review: z.boolean().default(false),
    // true = снимките са илюстративни/генерирани (показва се ясна бележка).
    illustrative: z.boolean().default(false),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    prepTime: z.number().int().nonnegative(), // минути
    cookTime: z.number().int().nonnegative(), // минути
    servings: z.number().int().positive(),
    difficulty: z.enum(['лесна', 'средна', 'сложна']).optional(),
    // Име на файла от photos/ за главна снимка; по подразбиране – първата по азбучен ред.
    cover: z.string().optional(),
    // Описания на снимките по име на файл. Снимки без запис се показват в „Още снимки“.
    photos: z.record(z.string(), photoMeta).default({}),
    ingredients: z
      .array(z.object({ title: z.string().optional(), items: z.array(z.string()).min(1) }))
      .min(1),
    steps: z
      .array(
        z.object({
          title: z.string().optional(),
          text: z.string(),
          photo: z.string().optional(), // име на файл от photos/
        }),
      )
      .min(1),
  }),
});

export const collections = { recipes };
