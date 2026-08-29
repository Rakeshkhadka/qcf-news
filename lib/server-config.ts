/**
 * Server-only configuration.
 *
 * This module must never be imported from a client component: the origin
 * below is how the Next server reaches the API, which behind Docker or a
 * private network is a name the browser cannot resolve. Browser-facing media
 * URLs come from `lib/media.ts` instead.
 */

/**
 * Origin the server uses for API calls — the RSC data fetches in `lib/api.ts`
 * and the BFF routes under `app/api/admin/`.
 *
 * `NEXT_PUBLIC_API_ORIGIN` is honoured as a fallback so existing single-host
 * setups (`next dev` against a local backend) keep working without a new
 * variable, but new deployments should set `API_INTERNAL_ORIGIN`.
 */
export const API_INTERNAL_ORIGIN = (
  process.env.API_INTERNAL_ORIGIN ??
  process.env.NEXT_PUBLIC_API_ORIGIN ??
  'http://localhost:8000'
).replace(/\/+$/, '');

/** Versioned API root — every backend route this app calls hangs off it. */
export const API_INTERNAL_BASE = `${API_INTERNAL_ORIGIN}/api/v1`;
