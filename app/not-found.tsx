import Link from 'next/link';
import type { Metadata } from 'next';
import { PageShell } from '../components/page-shell';
import { getCategories } from '../lib/api';

/**
 * A real 404 page, served with a 404 status by Next.
 *
 * The default is an unstyled framework page: it drops the reader out of the
 * site with nowhere to go, and gives a crawler that hit a dead story no route
 * back into the live archive. This keeps the shell — so the nav, the sections
 * and the search are all still one click away — and stays out of the index.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

export default async function NotFound() {
  const categories = await getCategories();

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space" id="main" tabIndex={-1}>
        <section className="page-empty">
          <p className="eyebrow blue">Error 404</p>
          <h1>We couldn’t find that story</h1>
          <p>
            It may have been unpublished, or the link may have a typo in it. The newsroom is
            still right here.
          </p>
          <p className="empty-actions">
            <Link href="/">Back to the front page</Link>
            <Link href="/feed">Latest feed</Link>
            <Link href="/search">Search stories</Link>
          </p>

          {categories.length > 0 && (
            <>
              <div className="fine-rule" />
              <p className="eyebrow blue">Browse sections</p>
              <p className="empty-actions">
                {categories.map((category) => (
                  <Link href={`/category/${category.slug}`} key={category.id}>
                    {category.name}
                  </Link>
                ))}
              </p>
            </>
          )}
        </section>
      </main>
    </PageShell>
  );
}
