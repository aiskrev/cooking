import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getRecipes } from './recipes';
import { siteText } from '../site.config';
import { href, localeInfo, type Locale } from '../i18n';

/** Емисия на езика: само публикувани рецепти с превод на този език; чернови (review: true) не влизат. */
export async function rssFeed(context: APIContext, locale: Locale) {
  const recipes = (await getRecipes(locale)).filter((r) => !r.bg.review);
  return rss({
    title: siteText[locale].name,
    description: siteText[locale].description,
    site: context.site!,
    customData: `<language>${localeInfo[locale].lang}</language>`,
    items: recipes.map((r) => ({
      title: r.data.title,
      description: r.data.description,
      pubDate: r.data.date,
      link: href(locale, 'recipes', r.id),
      categories: [r.data.category, ...r.data.tags],
    })),
  });
}
