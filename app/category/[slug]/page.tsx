import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Media } from '../../../components/media';
import { PageShell } from '../../../components/page-shell';
import { TimeStamp } from '../../../components/time-stamp';
import { coverOf, getCategories, getPublishedArticles } from '../../../lib/api';
import {
  breadcrumbSchema,
  categoryDescription,
  collectionPageSchema,
  graph,
  itemListSchema,
  jsonLd,
  metaDescription,
  type Crumb,
} from '../../../lib/seo';

/** Cached and refreshed in the background — see the note on the home page. */
export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

/**
 * Prerender every section at build time.
 *
 * Without this the route is rendered per request even with `revalidate` set,
 * because Next has no list of slugs to build against — so section pages, which
 * are the main way a crawler walks into the archive, pay two API round trips
 * on every hit. `dynamicParams` stays at its default, so a category added
 * after the build still renders on demand the first time it is asked for.
 */
export async function generateStaticParams() {
  const categories = await getCategories();
  return categories.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const categories = await getCategories();
  const category = categories.find((entry) => entry.slug === slug);

  if (!category) {
    return { title: 'Section not found', robots: { index: false, follow: true } };
  }

  const description = metaDescription(categoryDescription(category));
  const url = `/category/${category.slug}`;
  return {
    title: `${category.name} News`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      title: `${category.name} News`,
      description,
    },
    twitter: { card: 'summary_large_image', title: `${category.name} News`, description },
  };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const categories = await getCategories();
  const category = categories.find((entry) => entry.slug === slug);
  if (!category) notFound();

  const articles = await getPublishedArticles({ categoryId: category.id, limit: 20 });
  const [lead, ...stories] = articles;
  // Without a popularity signal the rail ranks on the editorial one.
  const picks = [...articles]
    .sort((a, b) => Number(b.is_featured) - Number(a.is_featured))
    .slice(0, 3);
  const leadCover = lead ? coverOf(lead) : null;

  const crumbs: Crumb[] = [
    { name: 'Home', path: '/' },
    { name: category.name, path: `/category/${category.slug}` },
  ];

  return (
    <PageShell navCategories={categories}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          graph(
            collectionPageSchema(category),
            breadcrumbSchema(crumbs),
            ...(articles.length > 0
              ? [
                  itemListSchema(articles, {
                    path: `/category/${category.slug}`,
                    name: `${category.name} — latest stories`,
                  }),
                ]
              : [])
          )
        )}
      />

      <main className="container page-space category-page" id="main" tabIndex={-1}>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <ol role="list">
            <li>
              <Link href="/">Home</Link>
            </li>
            <li>
              <span aria-hidden="true">›</span>
              <span aria-current="page">{category.name}</span>
            </li>
          </ol>
        </nav>

        <h1>{category.name}</h1>
        {/* Section copy is the only unique prose on an index page — without it
            every category reads as near-duplicate thin content. */}
        <p className="section-standfirst">{categoryDescription(category)}</p>
        <div className="fine-rule" />

        {!lead ? (
          <section className="page-empty">
            <h2>Nothing here yet</h2>
            <p>No published stories in {category.name} so far.</p>
          </section>
        ) : (
          <>
            <Link href={`/article/${lead.slug}`} className="category-lead">
              {leadCover && (
                <Media
                  src={leadCover}
                  alt={lead.title}
                  ratio="16 / 9"
                  sizes="(max-width: 768px) 100vw, 66vw"
                  priority
                />
              )}
              <div>
                <span className="eyebrow blue">{category.name}</span>
                <h2>{lead.title}</h2>
                {lead.summary && <span className="lead-summary">{lead.summary}</span>}
                <TimeStamp iso={lead.created_at} className="card-time" />
              </div>
            </Link>

            <div className="category-content">
              <div className="story-cards">
                {stories.map((story) => {
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
                        <span className="eyebrow blue">{category.name}</span>
                        <h3>{story.title}</h3>
                        {story.summary && <span className="card-summary">{story.summary}</span>}
                        <TimeStamp iso={story.created_at} className="card-time" />
                      </Link>
                    </article>
                  );
                })}
              </div>

              <aside className="celebs-box" aria-labelledby="editors-picks">
                <h2 id="editors-picks">Editors&rsquo; Picks</h2>
                <ol className="rank-list" role="list">
                  {picks.map((story) => (
                    <li key={story.id}>
                      <Link href={`/article/${story.slug}`} className="rank-story">
                        <h3>{story.title}</h3>
                      </Link>
                    </li>
                  ))}
                </ol>
              </aside>
            </div>
          </>
        )}
      </main>
    </PageShell>
  );
}
