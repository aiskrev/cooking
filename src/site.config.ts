// Единно място за настройките на сайта. Сменете стойностите със свои.
// Видимите за посетителя текстове са по езици (bg е основният; en е превод). Останалите етикети са в src/i18n/ui/*.
import type { Locale } from './i18n';

export const siteText: Record<Locale, { name: string; tagline: string; description: string }> = {
  bg: {
    name: 'Модерна българска кухня и Мишлен щрих',
    tagline: 'Традиционни вкусове. Съвременна техника.',
    description:
      'Модерна българска кухня и Мишлен щрих: традиционни рецепти и съвременни интерпретации с подробни обяснения на техниката и снимки на всяка стъпка.',
  },
  en: {
    name: 'Modern Bulgarian Cuisine with a Michelin Touch',
    tagline: 'Traditional flavours. Modern technique.',
    description:
      'Modern Bulgarian cuisine with a Michelin touch: traditional recipes and contemporary interpretations, with detailed technique explanations and a photo of every step.',
  },
};

export const site = {
  // Автор за структурираните данни (schema.org) – еднакъв във всички езици. Сменете с реално име.
  author: 'Модерна българска кухня и Мишлен щрих',
  copyrightHolder: 'Модерна българска кухня и Мишлен щрих',
  // По подразбиране локалната версия е НЕиндексируема. За индексиране при бъдещо публикуване: INDEXABLE=1.
  noindex: process.env.INDEXABLE !== '1' && process.env.INDEXABLE !== 'true',
};

export const copyrightHolder: Record<Locale, string> = {
  bg: 'Модерна българска кухня и Мишлен щрих',
  en: 'Modern Bulgarian Cuisine with a Michelin Touch',
};
