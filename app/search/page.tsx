import Link from 'next/link';
import type { Metadata } from 'next';
import { Media } from '../../components/media';
import { PageShell } from '../../components/page-shell';
import { TimeStamp } from '../../components/time-stamp';
import {
  SEARCH_PAGE_SIZE,
  categoryName,
  coverOf,
  getCategories,
  searchPublishedArticles,
} from '../../lib/api';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ q?: string; page?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  return {
    title: query ? `Search: ${query}` : 'Search stories',
    description: query
      ? `Stories matching “${query}” across the Celeb Scoop archive.`
      : 'Search every published headline, summary and story on Celeb Scoop.',
    // Result pages are per-reader and effectively endless: indexing them
    // spends crawl budget on thin, near-duplicate pages and risks a
    // soft-404 for every query with no hits. `follow` still lets the crawler
    // walk through to the stories themselves.
    robots: { index: false, follow: true, nocache: true },
    alternates: { canonical: '/search' },
  };
}

/** Build a link back to this page with the same query on another page number. */
function pageHref(query: string, page: number): string {
  const params = new URLSearchParams({ q: query });
  if (page > 1) params.set('page', String(page));
  return `/search?${params.toString()}`;
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ items, total }, categories] = await Promise.all([
    searchPublishedArticles(query, page),
    getCategories(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
  const from = (page - 1) * SEARCH_PAGE_SIZE + 1;
  const to = from + items.length - 1;

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space search-page" id="main" tabIndex={-1}>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <ol role="list">
            <li><Link href="/">Home</Link></li>
            <li><span aria-hidden="true">›</span> <span aria-current="page">Search</span></li>
          </ol>
        </nav>
        <h1>{query ? `“${query}”` : 'Search stories'}</h1>

        <form className="search-page-form" action="/search" method="get" role="search">
          <label className="sr-only" htmlFor="search-page-input">Search stories</label>
          <input
            id="search-page-input"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search headlines, summaries and story text"
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </form>

        <div className="fine-rule" />

        {!query ? (
          <section className="page-empty">
            <h2>What are you looking for?</h2>
            <p>
              Type a name, a show or a topic above. We look through every published
              headline, summary and story.
            </p>
          </section>
        ) : total === 0 ? (
          <section className="page-empty">
            <h2>No stories match “{query}”</h2>
            <p>
              Try a shorter term or a different spelling, or browse the{' '}
              <Link href="/feed">latest feed</Link>.
            </p>
          </section>
        ) : (
          <>
            <p className="search-count">
              {total} {total === 1 ? 'story' : 'stories'}
              {totalPages > 1 && <> · showing {from}–{to}</>}
            </p>

            <div className="story-cards">
              {items.map((story) => {
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

            {totalPages > 1 && (
              <nav className="search-pager" aria-label="Search result pages">
                {page > 1 ? (
                  <Link href={pageHref(query, page - 1)} rel="prev">← Newer</Link>
                ) : (
                  <span aria-hidden="true" />
                )}
                <span>Page {page} of {totalPages}</span>
                {page < totalPages ? (
                  <Link href={pageHref(query, page + 1)} rel="next">Older →</Link>
                ) : (
                  <span aria-hidden="true" />
                )}
              </nav>
            )}
          </>
        )}
      </main>
    </PageShell>
  );
}
