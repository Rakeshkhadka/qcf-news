import {
  categoryName,
  coverOf,
  excerptOf,
  getAllPublishedArticles,
  getCategories,
} from '../../lib/api';
import { SITE, absoluteUrl } from '../../lib/seo';

/**
 * `/feed.xml` — an RSS 2.0 feed of every published story.
 *
 * Worth having beyond readers: aggregators, Google Publisher Center and the
 * `alternate` link in the document head all consume it, and a valid feed is
 * one of the cheapest discovery signals a news site can emit.
 */
export const revalidate = 900;
export const dynamic = 'force-static';

/** RSS is XML, not HTML: five characters have to be escaped, and no others. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RSS dates are RFC 822, which `toUTCString` already produces. */
function rfc822(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

export async function GET() {
  const [articles, categories] = await Promise.all([
    // Readers want the recent archive, not all of it.
    getAllPublishedArticles(200),
    getCategories(),
  ]);

  const items = articles
    .map((article) => {
      const url = absoluteUrl(`/article/${article.slug}`);
      const cover = coverOf(article);
      const description = article.summary ?? excerptOf(article.title, 200);
      return `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${rfc822(article.created_at)}</pubDate>
      <category>${escapeXml(categoryName(categories, article.category_id))}</category>
      <description>${escapeXml(description)}</description>${
        cover
          ? `\n      <enclosure url="${escapeXml(cover)}" type="image/jpeg" />`
          : ''
      }
    </item>`;
    })
    .join('\n');

  const latest = articles[0]?.created_at;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${SITE.name} — ${SITE.tagline}`)}</title>
    <link>${escapeXml(absoluteUrl('/'))}</link>
    <description>${escapeXml(SITE.description)}</description>
    <language>${SITE.lang}</language>
    <lastBuildDate>${latest ? rfc822(latest) : new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(absoluteUrl('/feed.xml'))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
