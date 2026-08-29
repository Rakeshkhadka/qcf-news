/**
 * Where the browser fetches uploaded media from.
 *
 * The backend stores media as a path under its `MEDIA_URL` prefix
 * (`/media/2026/08/foo.jpg`). Two consumers have to resolve that path and
 * neither can use the Docker-internal API host:
 *
 *  - the browser, which only ever resolves names on the public network; and
 *  - `next/image`'s optimiser, which refuses an upstream hostname that
 *    resolves to a private IP (SSRF protection), so `http://backend:8000`
 *    fails there even though the Next server itself can reach it.
 *
 * Keeping media same-origin satisfies both. The reverse proxy routes
 * `/media/` straight at the backend, and `next.config.js` rewrites the same
 * prefix so anything the Next server resolves itself (the image optimiser
 * included) lands on the backend too.
 *
 * `NEXT_PUBLIC_MEDIA_BASE_URL` overrides that with an absolute origin — set
 * it only when media is served from a public CDN, and add the host to
 * `images.remotePatterns` (`next.config.js` does that automatically).
 */
export const MEDIA_BASE_URL = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '').replace(
  /\/+$/,
  ''
);

/**
 * Resolve a stored media path for the browser.
 *
 * Stored paths are relative, so they get the public media base prepended —
 * which is the empty string in the default same-origin setup, leaving the
 * path untouched. Absolute URLs (an editor pasting a link to somebody else's
 * image) are passed through unchanged.
 */
export function mediaUrl(url: string): string {
  if (!url) return url;
  return url.startsWith('/') ? `${MEDIA_BASE_URL}${url}` : url;
}
