import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getRecipes } from '../lib/recipes';
import { site } from '../site.config';

export async function GET(context: APIContext) {
  // Чернови (review: true) не влизат в RSS.
  const recipes = (await getRecipes()).filter((r) => !r.data.review);
  return rss({
    title: site.name,
    description: site.description,
    site: context.site!,
    customData: `<language>${site.lang}</language>`,
    items: recipes.map((r) => ({
      title: r.data.title,
      description: r.data.description,
      pubDate: r.data.date,
      link: `/recepti/${r.id}/`,
      categories: [r.data.category, ...r.data.tags],
    })),
  });
}
