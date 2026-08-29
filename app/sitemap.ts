import type { MetadataRoute } from 'next';
import { getAllPublishedArticles, getCategories } from '../lib/api';
import { absoluteUrl, lastModified } from '../lib/seo';

/**
 * `/sitemap.xml`.
 *
 * Rebuilt hourly rather than per request: it walks every published story
 * twenty at a time, which is far too much work to repeat for each bot hit.
 * Only canonical, indexable URLs go in — no /search, no /admin, no redirects.
 *
 * Every `lastModified` below is derived from article timestamps alone. None
 * may fall back to the current time: `lastmod` is trust-scored, and a value
 * that moves on each hourly rebuild while the page itself is unchanged is
 * what makes a crawler stop believing the whole file.
 */
export const revalidate = 3600;

/** The most recent edit across a set of stories, or null if there are none. */
function newestOf(articles: { created_at: string; updated_at?: string | null }[]): Date | null {
  return articles.reduce<Date | null>((latest, article) => {
    const stamp = lastModified(article);
    return !latest || stamp > latest ? stamp : latest;
  }, null);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, categories] = await Promise.all([
    getAllPublishedArticles(),
    getCategories(),
  ]);

  const newest = newestOf(articles);

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl('/'),
      lastModified: newest ?? new Date(),
      changeFrequency: 'hourly',
      priority: 1,
    },
    {
      url: absoluteUrl('/feed'),
      lastModified: newest ?? new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: absoluteUrl('/about'),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: absoluteUrl('/contact'),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: absoluteUrl('/privacy-policy'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: absoluteUrl('/terms'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: absoluteUrl('/cookie-policy'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: absoluteUrl('/disclaimer'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: absoluteUrl('/dmca'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((category) => ({
    url: absoluteUrl(`/category/${category.slug}`),
    // The newest edit *in that category* — not the first match in the list,
    // which is ordered by publication and so misses an older story edited
    // today. An empty category borrows the site-wide stamp so its entry stays
    // put between rebuilds.
    lastModified:
      newestOf(articles.filter((article) => article.category_id === category.id)) ??
      newest ??
      new Date(),
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  const articleRoutes: MetadataRoute.Sitemap = articles.map((article) => ({
    url: absoluteUrl(`/article/${article.slug}`),
    lastModified: lastModified(article),
    // News goes stale fast; tell crawlers not to keep re-fetching old stories.
    changeFrequency: 'weekly',
    priority: article.is_featured ? 0.9 : 0.7,
  }));

  return [...staticRoutes, ...categoryRoutes, ...articleRoutes];
}
