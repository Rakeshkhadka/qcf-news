import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublishedArticles } from '../../lib/api';

/** Short ISR so it stays close to the newest story without per-request cost. */
export const revalidate = 30;

/**
 * `/article` is a shortcut, not a page — it has no content of its own, so it
 * must never appear in the index competing with the story it forwards to.
 */
export const metadata: Metadata = {
  title: 'Latest story',
  robots: { index: false, follow: true },
};

/** Bare `/article` has no story of its own — send readers to the newest one. */
export default async function LatestArticlePage() {
  const [newest] = await getPublishedArticles({ limit: 1 });
  redirect(newest ? `/article/${newest.slug}` : '/feed');
}
