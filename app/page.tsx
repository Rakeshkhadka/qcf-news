import Link from 'next/link';
import type { Metadata } from 'next';
import { Media } from '../components/media';
import { Newsletter } from '../components/newsletter';
import { PageShell } from '../components/page-shell';
import { TimeStamp } from '../components/time-stamp';
import {
  categoryName,
  categorySlug,
  coverOf,
  getCategories,
  getPublishedArticles,
} from '../lib/api';
import { SITE, graph, itemListSchema, jsonLd } from '../lib/seo';

/**
 * Served from the cache and refreshed in the background once a minute.
 *
 * The page used to be `force-dynamic`, which meant every crawler hit and every
 * reader waited on two API round trips before a single byte of HTML moved.
 * Time-to-first-byte is both a ranking input and the ceiling on largest-
 * contentful paint, and a newsroom front page does not change per reader —
 * so it is cached, and a minute of staleness on a relative timestamp is a
 * trade worth making.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: `${SITE.name} | ${SITE.tagline}`,
  description: SITE.description,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    title: `${SITE.name} | ${SITE.tagline}`,
    description: SITE.description,
  },
};

export default async function HomePage() {
  const [articles, categories] = await Promise.all([
    getPublishedArticles({ limit: 20 }),
    getCategories(),
  ]);

  // The newsroom lead: an editor-flagged feature, else the newest story.
  const hero = articles.find((article) => article.is_featured) ?? articles[0];
  const rest = articles.filter((article) => article.id !== hero?.id);
  const hotStories = rest.slice(0, 5);
  const latest = rest.slice(5, 8);
  const heroCover = hero ? coverOf(hero) : null;

  return (
    <PageShell navCategories={categories}>
      {articles.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={jsonLd(
            graph(itemListSchema(articles, { path: '/', name: `${SITE.name} — top stories` }))
          )}
        />
      )}

      <main className="container page-space" id="main" tabIndex={-1}>
        {!hero ? (
          <section className="page-empty">
            <h1>No stories published yet</h1>
            <p>
              Publish an article from the <Link href="/admin/articles">admin dashboard</Link> and
              it will appear here.
            </p>
          </section>
        ) : (
          <section className="hero" aria-labelledby="hero-headline">
            <div className="hero-copy">
              <span className="eyebrow chip">
                {hero.is_featured ? 'Exclusive' : categoryName(categories, hero.category_id)}
              </span>
              {/* The one h1 on the page, and the headline the ItemList and the
                  social card both point at. */}
              <h1 id="hero-headline">
                <Link href={`/article/${hero.slug}`}>{hero.title}</Link>
              </h1>
              {hero.summary && <p className="standfirst">{hero.summary}</p>}
              <p className="byline">
                {categoryName(categories, hero.category_id)} Desk <i />{' '}
                <TimeStamp iso={hero.created_at} />
              </p>
            </div>
            <Link
              href={`/article/${hero.slug}`}
              className="hero-image image-link"
              aria-label={`Read: ${hero.title}`}
              tabIndex={-1}
            >
              {heroCover && (
                <Media
                  src={heroCover}
                  alt={hero.summary ? `${hero.title} — ${hero.summary}` : hero.title}
                  ratio="4 / 5"
                  sizes="(max-width: 768px) 100vw, 33vw"
                  priority
                />
              )}
            </Link>
          </section>
        )}

        {hotStories.length > 0 && (
          <section className="section ruled-section" aria-labelledby="hot-heading">
            <h2 className="section-title flame" id="hot-heading">
              Hot Right Now
            </h2>
            <ul className="hot-rail" role="list">
              {hotStories.map((story) => (
                <li key={story.id}>
                  <Link href={`/article/${story.slug}`} className="hot-card">
                    <span className="eyebrow blue">
                      {categoryName(categories, story.category_id)}
                    </span>
                    <h3>{story.title}</h3>
                    <TimeStamp iso={story.created_at} className="card-time" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {latest.length > 0 && (
          <section className="section" aria-labelledby="latest-heading">
            <h2 className="latest-title" id="latest-heading">
              Latest Scoop
            </h2>
            <div className="category-grid">
              {latest.map((story) => {
                const cover = coverOf(story);
                const name = categoryName(categories, story.category_id);
                const slug = categorySlug(categories, story.category_id);
                const isGallery = story.images.length > 1;
                return (
                  <article className={`category-block ${cover ? '' : 'text-card'}`} key={story.id}>
                    <h3>
                      {/* The section label is a real link: an internal link
                          from every card is how a section page accrues weight. */}
                      {slug ? <Link href={`/category/${slug}`}>{name}</Link> : name}
                    </h3>
                    <Link href={`/article/${story.slug}`} className="category-story">
                      {cover && (
                        <Media
                          src={cover}
                          alt={story.title}
                          ratio="16 / 10"
                          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        />
                      )}
                      <h4>{story.title}</h4>
                      {isGallery ? (
                        <p className="gallery-label">◉ {story.images.length} photos inside</p>
                      ) : (
                        <TimeStamp iso={story.created_at} className="card-time" />
                      )}
                    </Link>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <Newsletter />
      </main>
    </PageShell>
  );
}
