import Link from 'next/link';
import type { Metadata } from 'next';

import { PageShell } from '../../../components/page-shell';
import { getCategories } from '../../../lib/api';
import { UnsubscribeForm } from './unsubscribe-form';

/**
 * Where the unsubscribe link in an email lands.
 *
 * This page asks before it acts, and that is the whole reason it exists.
 * Mail clients, link scanners and corporate security gateways fetch every URL
 * in a message before a person ever sees it, so a page that unsubscribed on
 * render would empty the list on its own. Rendering it is inert; the button
 * posts to `/api/newsletter/unsubscribe`.
 *
 * Readers who want no page at all are already served: the `List-Unsubscribe`
 * header on every message lets their mail client do it in one click, which is
 * a POST straight to the API and never comes through here.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ token?: string }> };

export default async function UnsubscribePage({ searchParams }: Props) {
  const [{ token }, categories] = await Promise.all([searchParams, getCategories()]);

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space" id="main" tabIndex={-1}>
        <section className="page-empty">
          <p className="eyebrow blue">Newsletter</p>
          <h1>Unsubscribe</h1>
          {token ? (
            <UnsubscribeForm token={token} />
          ) : (
            <p>
              That link is missing its unsubscribe code. Use the link at the bottom of any
              issue we’ve sent you, and it will bring you back here ready to go.
            </p>
          )}
          <p className="empty-actions">
            <Link href="/">Back to the front page</Link>
            <Link href="/feed">Latest feed</Link>
          </p>
        </section>
      </main>
    </PageShell>
  );
}
