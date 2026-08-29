import type { MetadataRoute } from 'next';
import { SITE_URL, absoluteUrl } from '../lib/seo';

/**
 * `/robots.txt`.
 *
 * Everything public is crawlable; the two disallowed trees are the ones that
 * would only ever waste crawl budget — the admin app (which is behind a login
 * and renders nothing useful to a bot) and search result pages (per-reader,
 * effectively infinite, and already `noindex` in their metadata — this just
 * stops the crawl before it happens).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/admin/', '/search', '/search?', '/api/'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  };
}
