// Единно място за настройките на сайта. Сменете стойностите със свои.
export const site = {
  // ПРИМЕРНО ИМЕ — собственикът ще го смени.
  name: 'Модерна българска кухня и Мишлен щрих',
  tagline: 'Традиционни вкусове. Съвременна техника.',
  description:
    'Модерна българска кухня и Мишлен щрих: традиционни рецепти и съвременни интерпретации с подробни обяснения на техниката и снимки на всяка стъпка.',
  lang: 'bg',
  locale: 'bg_BG',
  // Английска версия на марката – сайтът се пише двуезично (български е основният език).
  en: {
    name: 'Modern Bulgarian Cuisine with a Michelin Touch',
    tagline: 'Traditional flavours. Modern technique.',
    description:
      'Modern Bulgarian cuisine with a Michelin touch: traditional recipes and contemporary interpretations, with detailed technique explanations and a photo of every step.',
    lang: 'en',
    locale: 'en_US',
  },
  // Автор за структурираните данни (schema.org). Сменете с реално име.
  author: 'Модерна българска кухня и Мишлен щрих',
  copyrightHolder: 'Модерна българска кухня и Мишлен щрих',
  // По подразбиране локалната версия е НЕиндексируема. За индексиране при бъдещо публикуване: INDEXABLE=1.
  noindex: process.env.INDEXABLE !== '1' && process.env.INDEXABLE !== 'true',
};

export const illustrativeNote = {
  badge: 'Илюстративни снимки',
  text: 'Снимките към тази рецепта са илюстративни – генерирани с изкуствен интелект. Те показват идеята за всяка стъпка, но не са снимки на реално приготвено ястие.',
};

export const statusLabels: Record<string, { label: string; text: string }> = {
  verified: { label: 'Проверена по източник', text: 'Съдържанието е проверено по източник.' },
  reconstruction: {
    label: 'Шеф-реконструкция – чака проверка',
    text: 'Рецептата е разработена по снимките и няма оригинален източник. Количествата, температурите и времената са ориентировъчни и чакат проверка от автора.',
  },
  review: { label: 'Чака редакторска проверка', text: 'Текстът чака редакторска проверка.' },
  incomplete: { label: 'Непълна рецепта', text: 'В рецептата липсва необходима информация.' },
};

export const collectionLabels: Record<string, { name: string; description: string }> = {
  traditional: { name: 'Традиционна българска кухня', description: 'Рецепти от българската трапеза – подробно и с уважение към техниката.' },
  'fine-dining': { name: 'Съвременни интерпретации и фино ядене', description: 'Ресторантска техника, прецизно поднасяне и международни влияния.' },
};
