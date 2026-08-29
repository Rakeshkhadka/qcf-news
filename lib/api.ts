/**
 * QCF News public API client.
 *
 * Read-only counterpart to `lib/admin-api.ts`: no tokens, no writes, and every
 * call is safe to run inside a React Server Component. Network failures are
 * swallowed and turned into empty results so a page renders its empty state
 * instead of a 500 when the backend is down.
 */

import { cache } from 'react';

import { MEDIA_BASE_URL, mediaUrl } from './media';
import { contentToHtml, stripHtml } from './sanitize';
import { API_INTERNAL_BASE } from './server-config';

export { mediaUrl };

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApiCategory = {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  is_active: boolean;
};

export type ApiArticleImage = {
  id: number;
  image_url: string;
  caption?: string | null;
  alt_text?: string | null;
  sort_order: number;
};

export type ApiArticleListItem = {
  id: number;
  title: string;
  slug: string;
  summary?: string | null;
  cover_image_url?: string | null;
  images: ApiArticleImage[];
  is_published: boolean;
  is_featured: boolean;
  category_id: number;
  author_id: number;
  created_at: string;
  updated_at: string;
};

export type ApiArticle = ApiArticleListItem & { content: string };

type Envelope<T> = { success: boolean; message: string; data: T; total_count?: number };

/** A page of list results together with the total the API reports. */
export type Page<T> = { items: T[]; total: number };

// ── Fetching ──────────────────────────────────────────────────────────────────

type FetchOptions = {
  /** Seconds to cache the response for. `0` disables caching entirely. */
  revalidate?: number;
  /** Next.js cache tags — invalidated on demand via `revalidateTag`. */
  tags?: string[];
};

async function get<T>(path: string, options: FetchOptions = {}): Promise<T | null> {
  const { revalidate = 60, tags } = options;
  try {
    const next: { revalidate?: number; tags?: string[] } = {};
    if (revalidate > 0) next.revalidate = revalidate;
    if (tags?.length) next.tags = tags;
    const res = await fetch(`${API_INTERNAL_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      ...(revalidate === 0 && !tags?.length
        ? { cache: 'no-store' as const }
        : { next }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Envelope<T> | T;
    if (json !== null && typeof json === 'object' && 'success' in json && 'data' in json) {
      return (json as Envelope<T>).data;
    }
    return json as T;
  } catch {
    // Backend unreachable — callers fall back to an empty result.
    return null;
  }
}

/**
 * Like `get`, but keeps the envelope's `total_count` — needed wherever the page
 * has to know how many results exist beyond the ones it fetched.
 */
async function getPage<T>(path: string, options: FetchOptions = {}): Promise<Page<T>> {
  const { revalidate = 60, tags } = options;
  try {
    const next: { revalidate?: number; tags?: string[] } = {};
    if (revalidate > 0) next.revalidate = revalidate;
    if (tags?.length) next.tags = tags;
    const res = await fetch(`${API_INTERNAL_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      ...(revalidate === 0 && !tags?.length
        ? { cache: 'no-store' as const }
        : { next }),
    });
    if (!res.ok) return { items: [], total: 0 };
    const json = (await res.json()) as Envelope<T[]>;
    return { items: json.data ?? [], total: json.total_count ?? json.data?.length ?? 0 };
  } catch {
    return { items: [], total: 0 };
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Active categories. Every page needs these for the nav, and several read them
 * twice (metadata plus render), so they are deduplicated per request on top of
 * the two-minute data cache.
 */
export const getCategories = cache(async (): Promise<ApiCategory[]> => {
  const data = await get<ApiCategory[]>('/categories/', {
    revalidate: 120,
    tags: ['categories'],
  });
  return (data ?? []).filter((category) => category.is_active);
});

export async function getPublishedArticles(params: {
  categoryId?: number;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ApiArticleListItem[]> {
  const { categoryId, search, limit = 20, offset = 0 } = params;
  const query = new URLSearchParams({
    is_published: 'true',
    limit: String(limit),
    offset: String(offset),
  });
  if (categoryId !== undefined) query.set('category_id', String(categoryId));
  if (search) query.set('search', search);

  const tags = ['articles'];
  if (categoryId !== undefined) tags.push(`category-${categoryId}`);
  const data = await get<ApiArticleListItem[]>(`/articles/?${query.toString()}`, { tags });
  return data ?? [];
}

/**
 * The largest page the articles endpoint will serve (`limit` is `le=20`).
 * Asking for more is a 422, so every caller that wants a longer list has to
 * walk the offsets instead.
 */
export const MAX_PAGE_SIZE = 20;

/** Page size for the public search results page. Capped at the API's own limit. */
export const SEARCH_PAGE_SIZE = MAX_PAGE_SIZE;

/**
 * Published stories matching a free-text query, one page at a time.
 *
 * The backend matches the term against title, summary and body, so this finds
 * stories whose headline never mentions what the reader typed. A blank query
 * returns nothing rather than the whole archive — the results page treats an
 * empty box as "nothing asked yet".
 */
export async function searchPublishedArticles(
  query: string,
  page = 1
): Promise<Page<ApiArticleListItem>> {
  const term = query.trim();
  if (!term) return { items: [], total: 0 };

  const params = new URLSearchParams({
    is_published: 'true',
    search: term,
    limit: String(SEARCH_PAGE_SIZE),
    offset: String((Math.max(1, page) - 1) * SEARCH_PAGE_SIZE),
  });
  return getPage<ApiArticleListItem>(`/articles/?${params.toString()}`, {
    tags: ['articles'],
  });
}

/**
 * Fetch one article by slug. The API exposes published stories to anonymous
 * callers and lets authorised editorial readers retrieve drafts. This public
 * client has no token, so drafts remain indistinguishable from misses here.
 *
 * Cached with ISR and tagged by slug so the page can be rebuilt on demand
 * when the story is edited or unpublished. `cache` still deduplicates the
 * two reads per render (metadata + component) into a single fetch.
 */
export const getArticleBySlug = cache(
  async (slug: string): Promise<ApiArticle | null> => {
    const article = await get<ApiArticle>(`/articles/by-slug/${encodeURIComponent(slug)}`, {
      revalidate: 60,
      tags: ['articles', `article-${slug}`],
    });
    if (!article || !article.is_published) return null;
    return article;
  }
);

/**
 * Every published story, walked one API page at a time.
 *
 * Only the sitemap and the RSS feed need this. The endpoint caps `limit` at
 * 20, so a site with a real archive means a lot of round trips — hence the
 * hard `max` ceiling (a sitemap is capped at 50k URLs anyway) and the long
 * revalidate window. Stops early on a short page or a failed request rather
 * than looping against a backend that has gone away.
 */
export async function getAllPublishedArticles(
  max = 2000
): Promise<ApiArticleListItem[]> {
  const all: ApiArticleListItem[] = [];
  for (let offset = 0; offset < max; offset += MAX_PAGE_SIZE) {
    const params = new URLSearchParams({
      is_published: 'true',
      limit: String(MAX_PAGE_SIZE),
      offset: String(offset),
    });
    const { items, total } = await getPage<ApiArticleListItem>(
      `/articles/?${params.toString()}`,
      { revalidate: 3600, tags: ['articles'] }
    );
    all.push(...items);
    if (items.length < MAX_PAGE_SIZE || all.length >= total) break;
  }
  return all;
}

// ── View helpers ──────────────────────────────────────────────────────────────

export type Slide = { url: string; caption?: string; alt?: string };

/**
 * Build the carousel slides for an article: the gallery when it has one,
 * otherwise the lone cover image.
 */
export function articleSlides(article: {
  images?: ApiArticleImage[];
  cover_image_url?: string | null;
  title: string;
}): Slide[] {
  const gallery = (article.images ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => ({
      url: mediaUrl(image.image_url),
      caption: image.caption ?? undefined,
      alt: image.alt_text ?? article.title,
    }));
  if (gallery.length > 0) return gallery;
  if (article.cover_image_url) {
    return [{ url: mediaUrl(article.cover_image_url), alt: article.title }];
  }
  return [];
}

/** The image to use as a single still (list cards, hero links). */
export function coverOf(article: {
  images?: ApiArticleImage[];
  cover_image_url?: string | null;
}): string | null {
  if (article.cover_image_url) return mediaUrl(article.cover_image_url);
  const first = (article.images ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)[0];
  return first ? mediaUrl(first.image_url) : null;
}

/** Look up a category name by id, for the eyebrow labels on cards. */
export function categoryName(categories: ApiCategory[], id: number): string {
  return categories.find((category) => category.id === id)?.name ?? 'News';
}

export function categorySlug(categories: ApiCategory[], id: number): string | null {
  return categories.find((category) => category.id === id)?.slug ?? null;
}

/** "3 hrs ago" / "2 days ago", for the timestamps sprinkled through the design. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units: [number, string][] = [
    [60, 'sec'],
    [3600, 'min'],
    [86400, 'hr'],
    [2592000, 'day'],
    [31536000, 'month'],
  ];
  if (seconds < 60) return 'just now';
  for (let i = 1; i < units.length; i += 1) {
    const [limit, label] = units[i];
    if (seconds < limit) {
      const value = Math.floor(seconds / units[i - 1][0]);
      return `${value} ${label}${value === 1 ? '' : 's'} ago`;
    }
  }
  const years = Math.floor(seconds / 31536000);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Rough reading time from the article body, ignoring its markup. */
export function readingTime(content: string): string {
  const words = stripHtml(content).split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 220))} min read`;
}

/**
 * Point stored `/media/...` sources at the public media host.
 *
 * Inline images are saved with whatever URL the upload endpoint returned. In
 * the default same-origin setup `MEDIA_BASE_URL` is empty and these paths are
 * already correct, so the rewrite is a no-op; it only does work when media is
 * served from a separate CDN origin.
 */
function absolutiseMedia(html: string): string {
  if (!MEDIA_BASE_URL) return html;
  return html.replace(
    /(<img\b[^>]*\bsrc=")(\/(?!\/)[^"]*)"/gi,
    (_match, prefix: string, path: string) => `${prefix}${MEDIA_BASE_URL}${path}"`
  );
}

/**
 * Give body images the loading hints the editor never writes.
 *
 * Inline art sits below the fold by definition — the hero is a separate
 * element — so deferring it keeps those requests out of the way of the LCP
 * image. `decoding="async"` stops a large decode from blocking the main
 * thread once it does arrive. An explicit `loading` from the editor wins.
 */
function addLoadingHints(html: string): string {
  return html.replace(/<img\b([^>]*)>/gi, (match, attrs: string) => {
    // Drop a self-closing slash before appending, or it lands mid-tag.
    let out = attrs.replace(/\/\s*$/, '');
    if (!/\bloading=/i.test(out)) out += ' loading="lazy"';
    if (!/\bdecoding=/i.test(out)) out += ' decoding="async"';
    return `<img${out}>`;
  });
}

/**
 * The article body as HTML that is safe to hand to `dangerouslySetInnerHTML`.
 *
 * Rich-text articles arrive as markup and are re-filtered here against the
 * allowlist; older plain-text ones are converted to paragraphs.
 */
export function contentHtml(content: string): string {
  return addLoadingHints(absolutiseMedia(contentToHtml(content)));
}

/** First few sentences of the body as plain text, for cards and meta tags. */
export function excerptOf(content: string, limit = 180): string {
  const text = stripHtml(content);
  if (text.length <= limit) return text;
  return `${text.slice(0, text.lastIndexOf(' ', limit))}…`;
}
