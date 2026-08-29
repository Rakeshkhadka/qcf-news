'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Client-side error boundary for the public site.
 *
 * Without one, a throw anywhere in the tree replaces the page with Next's bare
 * fallback. This keeps the reader on a branded page with a way forward and a
 * retry that re-runs the failed render rather than reloading the document.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which Next
    // deliberately withholds from the browser.
    console.error('Unhandled render error', error.digest ?? error);
  }, [error]);

  return (
    <main className="container page-space" id="main">
      <section className="page-empty">
        <p className="eyebrow blue">Something went wrong</p>
        <h1>This page didn’t load</h1>
        <p>
          The newsroom is still publishing — this was a problem on our side. Try again, or head
          back to the front page.
        </p>
        <p className="empty-actions">
          <button type="button" className="text-button" onClick={reset}>
            Try again
          </button>
          <Link href="/">Back to the front page</Link>
        </p>
      </section>
    </main>
  );
}
