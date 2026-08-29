import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ImageCarousel } from '../../../components/image-carousel';
import { Newsletter } from '../../../components/newsletter';
import { PageShell } from '../../../components/page-shell';
import { TimeStamp } from '../../../components/time-stamp';
import {
  ApiArticleListItem,
  ApiCategory,
  articleSlides,
  categoryName,
  categorySlug,
  contentHtml,
  excerptOf,
  getAllPublishedArticles,
  getArticleBySlug,
  getCategories,
  getPublishedArticles,
} from '../../../lib/api';
import {
  SITE,
  breadcrumbSchema,
  graph,
  jsonLd,
  lastModified,
  metaDescription,
  newsArticleSchema,
  socialImage,
  wordCount,
  type Crumb,
} from '../../../lib/seo';

/**
 * Cached with ISR and rebuilt on demand via `revalidateTag` when the story is
 * published, edited or deleted. The view counter that once justified
 * `force-dynamic` was removed in the backend migration.
 */
export const revalidate = 60;

/**
 * Prerender published articles at build time so the first hit is instant.
 * `dynamicParams` defaults to `true`, so newly published slugs still render
 * on demand and then get cached.
 */
export async function generateStaticParams() {
  const articles = await getAllPublishedArticles();
  return articles.map((a) => ({ slug: a.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article) {
    return {
      title: 'Story not found',
      // A miss must never be indexed — otherwise a deleted story keeps a slot
      // in the index and serves an empty page to whoever clicks it.
      robots: { index: false, follow: true },
    };
  }

  const categories = await getCategories();
  const category = categoryName(categories, article.category_id);
  const description = metaDescription(article.summary ?? excerptOf(article.content, 400));
  const url = `/article/${article.slug}`;
  const image = socialImage(article);
  const published = new Date(article.created_at);

  return {
    title: article.title,
    description,
    // One canonical per story, so query strings and the /article redirect
    // never split its ranking signals.
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title: article.title,
      description,
      siteName: SITE.name,
      locale: SITE.locale,
      publishedTime: published.toISOString(),
      modifiedTime: lastModified(article).toISOString(),
      section: category,
      authors: [`${category} Desk`],
      images: [{ url: image, width: 1200, height: 630, alt: article.title }],
    },
    twitter: {
      card: 'summary_large_image',
      site: SITE.twitter,
      title: article.title,
      description,
      images: [image],
    },
    other: {
      // Read by news aggregators and some social scrapers that ignore OG.
      'article:published_time': published.toISOString(),
      'article:section': category,
    },
  };
}

function StoryList({
  title,
  stories,
  categories,
}: {
  title: string;
  stories: ApiArticleListItem[];
  categories: ApiCategory[];
}) {
  if (stories.length === 0) return null;
  const id = `rail-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section className="article-story-list" aria-labelledby={id}>
      <h2 id={id}>
        <span aria-hidden="true">↗ </span>
        {title}
      </h2>
      <ul role="list">
        {stories.map((story) => (
          <li key={story.id}>
            <Link href={`/article/${story.slug}`}>
              <span className="rail-eyebrow">
                {categoryName(categories, story.category_id)}
              </span>
              <h3>{story.title}</h3>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const [article, categories] = await Promise.all([
    getArticleBySlug(slug),
    getCategories(),
  ]);

  if (!article) notFound();

  // Sidebar rails: same-category reads first, then the newest across the site.
  const [sameCategory, everything] = await Promise.all([
    getPublishedArticles({ categoryId: article.category_id, limit: 8 }),
    getPublishedArticles({ limit: 12 }),
  ]);
  const notThisOne = (story: ApiArticleListItem) => story.id !== article.id;
  const related = sameCategory.filter(notThisOne);
  const others = everything.filter(notThisOne);
  // Without a popularity signal the rail ranks on the editorial one.
  const picks = [...others].sort((a, b) => Number(b.is_featured) - Number(a.is_featured));

  const slides = articleSlides(article);
  const category = categoryName(categories, article.category_id);
  const sectionSlug = categorySlug(categories, article.category_id);
  const body = contentHtml(article.content);
  const words = wordCount(article.content);
  const minutes = Math.max(1, Math.round(words / 220));

  const crumbs: Crumb[] = [
    { name: 'Home', path: '/' },
    ...(sectionSlug ? [{ name: category, path: `/category/${sectionSlug}` }] : []),
    { name: article.title, path: `/article/${article.slug}` },
  ];

  return (
    <PageShell brand={SITE.name} navCategories={categories}>
      {/* The whole page in one graph: the story, and the trail that has to
          match the breadcrumb rendered right below it. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          graph(
            newsArticleSchema(article, {
              categoryName: category,
              categorySlug: sectionSlug,
              wordCount: words,
            }),
            breadcrumbSchema(crumbs)
          )
        )}
      />

      <main className="container article-layout" id="main" tabIndex={-1}>
        <article className="article">
          {/* Visible breadcrumb, same trail as the structured data. */}
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <ol role="list">
              <li>
                <Link href="/">Home</Link>
              </li>
              {sectionSlug && (
                <li>
                  <span aria-hidden="true">›</span>
                  <Link href={`/category/${sectionSlug}`}>{category}</Link>
                </li>
              )}
            </ol>
          </nav>

          <h1>{article.title}</h1>
          {/* The standfirst is deck copy, not a section heading — as an <h2>
              it broke the outline and competed with the real subheads inside
              the body for the snippet Google pulls. */}
          {article.summary && <p className="standfirst">{article.summary}</p>}

          <div className="article-meta">
            <span className="avatar" aria-hidden="true">
              {category.slice(0, 2).toUpperCase()}
            </span>
            <p>
              <b>{category} Desk</b>
              <br />
              <span className="muted">{SITE.name} Newsroom</span>
            </p>
            <span className="article-meta-time">
              <TimeStamp iso={article.created_at} absolute />
              <br />
              {minutes} min read
            </span>
          </div>

          <ImageCarousel images={slides} alt={article.title} autoPlayMs={7000} />

          {/* Sanitised twice over — on save by the API, and again by
              `contentHtml` on the way out. */}
          <div className="article-body" dangerouslySetInnerHTML={{ __html: body }} />

          {sectionSlug && (
            <p className="article-tail">
              More from{' '}
              <Link href={`/category/${sectionSlug}`}>
                <b>{category}</b>
              </Link>{' '}
              · <Link href="/feed">Latest feed</Link>
            </p>
          )}
        </article>

        <aside className="article-aside" aria-label="More stories">
          <StoryList
            title="More in this category"
            stories={related.slice(0, 3)}
            categories={categories}
          />
          <StoryList title="Editors’ Picks" stories={picks.slice(0, 3)} categories={categories} />
          <StoryList title="Latest" stories={others.slice(0, 3)} categories={categories} />
          <Newsletter compact />
        </aside>
      </main>
    </PageShell>
  );
}
