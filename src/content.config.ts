import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const photoMeta = z.object({
  alt: z.string().min(5, 'alt текстът е задължителен и трябва да описва снимката'),
  caption: z.string().optional(),
  // от коя фотосесия е кадърът (когато една рецепта има няколко независими серии)
  session: z.string().optional(),
  // ръчно зададен ред на снимките (записва се от администрацията); без него – по име на файла
  order: z.number().int().optional(),
  // произход на снимката (напр. „собствена снимка“, „генерирана с изкуствен интелект“)
  provenance: z.string().optional(),
});

// Съставка: просто текстов ред или структуриран запис (нужен за преоразмеряване на порциите)
const ingredient = z.union([
  z.string(),
  z.object({
    name: z.string(),
    amount: z.number().positive().optional(), // числово количество (за преоразмеряване)
    unit: z.string().optional(), // г, кг, мл, л, бр., с. л., ч. л. …
    note: z.string().optional(), // уточнение в скоби
    scale: z.boolean().default(true), // false = „на вкус“, масло за пържене и т.н.
  }),
]);

const recipes = defineCollection({
  // Всяка рецепта е папка: index.md + photos/ със снимките (+ manifest.json с произход на снимките).
  loader: glob({
    pattern: '*/index.md',
    base: './src/content/recipes',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(240),
    intro: z.string().optional(), // кратко апетитно въведение
    context: z.string().optional(), // регионален/културен контекст (само когато е сигурен)
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    // Състояние на съдържанието:
    //  verified       – проверено по източник
    //  reconstruction – шеф-разработена реконструкция (няма оригинален текст)
    //  review         – чака редакторска проверка
    //  incomplete     – липсва необходима информация
    status: z.enum(['verified', 'reconstruction', 'review', 'incomplete']).default('reconstruction'),
    review: z.boolean().default(false), // true = показва се бележка „чернова“
    // Публикуване (различно от редакторския статус по-горе):
    //  published – показва се на сайта; draft – само в администрацията; archived – скрита, но запазена
    publication: z.enum(['published', 'draft', 'archived']).default('published'),
    illustrative: z.boolean().default(false), // true = снимките са илюстративни/генерирани
    featured: z.boolean().default(false),
    collection: z.enum(['traditional', 'fine-dining']).default('traditional'),
    category: z.string(), // вид ястие: Супи, Основни ястия, Десерти…
    method: z.array(z.string()).default([]), // начин на готвене: Печене, Задушаване…
    cuisine: z.string().optional(),
    tags: z.array(z.string()).default([]),
    prepTime: z.number().int().nonnegative(), // минути
    cookTime: z.number().int().nonnegative(), // минути
    restTime: z.number().int().nonnegative().default(0), // минути (почивка, втасване, маринане)
    servings: z.number().int().positive(),
    difficulty: z.enum(['лесна', 'средна', 'сложна']).optional(),
    cover: z.string().optional(),
    carousel: z.array(z.string()).optional(), // имена на файлове за фото-историята (до 10)
    photos: z.record(z.string(), photoMeta).default({}),
    mise: z.array(z.string()).default([]), // mise en place
    technique: z.string().optional(), // основна техника
    temperature: z.string().optional(), // контрол на температурата
    balance: z.string().optional(), // консистенция, текстура и баланс на вкуса
    ingredients: z
      .array(z.object({ title: z.string().optional(), items: z.array(ingredient).min(1) }))
      .min(1),
    steps: z
      .array(
        z.object({
          title: z.string().optional(),
          text: z.string(),
          why: z.string().optional(), // защо е нужна стъпката
          cue: z.string().optional(), // как разбираш, че е готово
          avoid: z.string().optional(), // какво да избягваш
          time: z.number().int().positive().optional(), // минути (за таймер в режим „готвене“)
          photo: z.string().optional(),
        }),
      )
      .min(1),
    tips: z.array(z.string()).default([]), // съвети от шефа
    mistakes: z.array(z.string()).default([]),
    substitutions: z.array(z.string()).default([]),
    plating: z.string().optional(),
    serving: z.string().optional(),
    storage: z.string().optional(),
    allergens: z.array(z.string()).default([]), // редакционна индикация от съставките – изисква проверка
  }),
});

export const collections = { recipes };
