import Link from 'next/link';
import type { Metadata } from 'next';
import { Media } from '../../components/media';
import { PageShell } from '../../components/page-shell';
import { TimeStamp } from '../../components/time-stamp';
import { categoryName, coverOf, getCategories, getPublishedArticles } from '../../lib/api';
import {
  SITE,
  breadcrumbSchema,
  graph,
  itemListSchema,
  jsonLd,
  metaDescription,
  type Crumb,
} from '../../lib/seo';

/** Cached and refreshed in the background — see the note on the home page. */
export const revalidate = 60;

const DESCRIPTION =
  'Every story as it publishes — the running feed of entertainment, film, music and red carpet news from the Celeb Scoop newsroom.';

export const metadata: Metadata = {
  title: 'Latest Feed',
  description: metaDescription(DESCRIPTION),
  alternates: {
    canonical: '/feed',
    types: { 'application/rss+xml': [{ url: '/feed.xml', title: `${SITE.name} — latest stories` }] },
  },
  openGraph: {
    type: 'website',
    url: '/feed',
    title: `Latest Feed | ${SITE.name}`,
    description: metaDescription(DESCRIPTION),
  },
};

const crumbs: Crumb[] = [
  { name: 'Home', path: '/' },
  { name: 'Latest Feed', path: '/feed' },
];

export default async function FeedPage() {
  const [articles, categories] = await Promise.all([
    getPublishedArticles({ limit: 20 }),
    getCategories(),
  ]);

  const [lead, ...rest] = articles;
  // Without a popularity signal the rail ranks on the editorial one.
  const picks = [...articles]
    .sort((a, b) => Number(b.is_featured) - Number(a.is_featured))
    .slice(0, 3);
  const leadCover = lead ? coverOf(lead) : null;

  return (
    <PageShell navCategories={categories}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          graph(
            breadcrumbSchema(crumbs),
            ...(articles.length > 0
              ? [itemListSchema(articles, { path: '/feed', name: `${SITE.name} — latest stories` })]
              : [])
          )
        )}
      />

      <div className="container feed-layout">
        <nav className="category-nav" aria-label="Sections">
          <h2>Categories</h2>
          <ul role="list">
            {categories.map((category) => (
              <li key={category.id}>
                <Link href={`/category/${category.slug}`}>{category.name}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="feed-main" id="main" tabIndex={-1}>
          <h1 className="sr-only">Latest stories from {SITE.name}</h1>

          {!lead ? (
            <section className="page-empty">
              <h2>The feed is empty</h2>
              <p>Published articles will show up here as soon as there are any.</p>
            </section>
          ) : (
            <>
              <div className="feed-grid">
                <Link href={`/article/${lead.slug}`} className="feed-lead">
                  {leadCover && (
                    <Media
                      src={leadCover}
                      alt={lead.title}
                      ratio="16 / 9"
                      sizes="(max-width: 768px) 100vw, (max-width: 1024px) 66vw, 50vw"
                      priority
                    />
                  )}
                  <div>
                    <p className="feed-lead-meta">
                      {lead.is_featured && <span className="chip">Exclusive</span>}{' '}
                      <TimeStamp iso={lead.created_at} /> ·{' '}
                      {categoryName(categories, lead.category_id)}
                    </p>
                    <h2>{lead.title}</h2>
                    {lead.summary && <span>{lead.summary}</span>}
                  </div>
                </Link>

                <aside className="trending-list" aria-labelledby="picks-heading">
                  <h2 id="picks-heading">
                    <span aria-hidden="true">★ </span>Editors&rsquo; Picks
                  </h2>
                  <ol className="rank-list" role="list">
                    {picks.map((story) => (
                      <li key={story.id}>
                        <Link href={`/article/${story.slug}`} className="rank-story">
                          <span>
                            <h3>{story.title}</h3>
                            <p>{categoryName(categories, story.category_id)}</p>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </aside>
              </div>

              {rest.length > 0 && (
                <div className="story-cards feed-more">
                  {rest.map((story) => {
                    const cover = coverOf(story);
                    return (
                      <article className="story-card" key={story.id}>
                        <Link href={`/article/${story.slug}`}>
                          {cover && (
                            <Media
                              src={cover}
                              alt={story.title}
                              ratio="16 / 10"
                              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                            />
                          )}
                          <span className="eyebrow blue">
                            {categoryName(categories, story.category_id)}
                          </span>
                          <h3>{story.title}</h3>
                          {story.summary && <span className="card-summary">{story.summary}</span>}
                          <TimeStamp iso={story.created_at} className="card-time" />
                        </Link>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </PageShell>
  );
}
