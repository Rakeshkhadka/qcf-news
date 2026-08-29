import Link from 'next/link';
import type { Metadata } from 'next';

import { PageShell } from '../../../components/page-shell';
import { getCategories } from '../../../lib/api';
import { callNewsletterApi } from '../../../lib/newsletter';

/**
 * Where the confirmation link in the opt-in email lands.
 *
 * The token arrives in the query string and is exchanged for a confirmation
 * server-side, on render. Confirming on a page view is the one place in this
 * feature where acting on a GET is acceptable: the reader clicking the link
 * *is* the consent, and the worst a link scanner can do by prefetching it is
 * complete a subscription the mailbox's owner already asked for. Unsubscribing
 * gets the opposite treatment — see the sibling page.
 *
 * Never cached and never indexed: the response is specific to one token.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm your subscription',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ConfirmPage({ searchParams }: Props) {
  const [{ token }, categories] = await Promise.all([searchParams, getCategories()]);

  const result = token
    ? await callNewsletterApi(`/confirm?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      })
    : { ok: false, message: 'That link is missing its confirmation code.' };

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space" id="main" tabIndex={-1}>
        <section className="page-empty">
          <p className="eyebrow blue">Newsletter</p>
          <h1>{result.ok ? 'You’re on the list' : 'We couldn’t confirm that'}</h1>
          <p>{result.message}</p>
          {result.ok ? (
            <p>
              Every issue carries a one-click unsubscribe link, so leaving is as easy as
              joining was.
            </p>
          ) : (
            <p>
              Confirmation links expire after a couple of days. Subscribing again sends a
              fresh one.
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
