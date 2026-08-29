/**
 * @type {import('next').NextConfig}
 *
 * Notes on two deliberate omissions:
 *
 * - `images` carries `remotePatterns` for any *public* media origin so
 *   `next/image` can proxy, resize and re-encode remote media through its
 *   built-in optimiser.  The internal API origin is deliberately absent: the
 *   optimiser rejects upstreams resolving to private IPs, so media is served
 *   same-origin via the /media rewrite below instead.  `sharp` must be present
 *   in production; the package is listed as a dependency.
 * - `i18n` is unset: the App Router handles locales through routing, and the
 *   site is single-locale today.
 */

/**
 * Origin the *server* uses to reach the API.  Typically a private name such as
 * `http://backend:8000` — the browser can't resolve it and `next/image`
 * refuses it as an upstream (it rejects hosts resolving to private IPs), which
 * is exactly why nothing browser-facing is built from it.  Mirrors
 * `lib/server-config.ts`; kept inline because this file is plain CommonJS and
 * is evaluated before the app bundle exists.
 */
const API_INTERNAL_ORIGIN = (
  process.env.API_INTERNAL_ORIGIN ||
  process.env.NEXT_PUBLIC_API_ORIGIN ||
  'http://localhost:8000'
).replace(/\/+$/, '');

/** Public CDN origin for media, when one is configured.  Empty = same-origin. */
const MEDIA_BASE_URL = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL || '').replace(/\/+$/, '');

/**
 * Build the remote patterns array for `next/image`.
 *
 * Only *browser-reachable* media origins belong here.  In the default setup
 * media is same-origin (`/media/...`), which needs no pattern at all — this
 * exists for deployments that serve media from a CDN.  `localhost` stays for
 * `next dev` against a local backend.
 */
function imageRemotePatterns() {
  /** @type {import('next').NextConfig['images']['remotePatterns']} */
  const patterns = [
    { protocol: 'http', hostname: 'localhost' },
    { protocol: 'https', hostname: 'localhost' },
    // Placeholder art for the seeded/demo content (`lib/content.ts` and
    // `Backend/seed_dummy_data.py`) is hot-linked from Unsplash. Real
    // deployments serve their own uploads and never hit this entry, but the
    // demo pages 500 without it.
    { protocol: 'https', hostname: 'images.unsplash.com' },
  ];

  if (MEDIA_BASE_URL) {
    try {
      const url = new URL(MEDIA_BASE_URL);
      const entry = {
        protocol: url.protocol.replace(':', ''),
        hostname: url.hostname,
      };
      if (url.port) entry.port = url.port;
      // Avoid duplicating the localhost entries already present.
      const isDuplicate = patterns.some(
        (p) => p.hostname === entry.hostname && p.protocol === entry.protocol,
      );
      if (!isDuplicate) patterns.push(entry);
    } catch {
      // Malformed origin — fall through to the defaults.
    }
  }

  return patterns;
}

/** Headers that cost nothing and close off the cheap attacks. */
const securityHeaders = [
  // Stop MIME sniffing turning an uploaded file into an executable script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Keep referrer data on same-origin, send only the origin cross-site.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing here needs these; deny them by default.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Let social scrapers and search bots embed our images and pages freely,
  // while keeping the browser's cross-origin isolation defaults.
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig = {
  reactStrictMode: true,
  // Next 16 defaults to a subprocess-based TypeScript CLI. In this runtime it
  // cannot read `tsc --showConfig` from its piped stdout, which makes a clean
  // production build fail before bundling is complete. TypeScript 5 still
  // provides the supported compiler API, so use that path and keep type
  // validation active during `next build` (as well as `npm run typecheck`).
  experimental: {
    useTypeScriptCli: false,
  },
  // Permit browser access to dev assets when the app is reached through the
  // Docker-bound host address instead of localhost.
  allowedDevOrigins: ['0.0.0.0'],
  // Don't advertise the framework and version to every scanner.
  poweredByHeader: false,
  compress: true,
  // Canonical URLs never carry a trailing slash; keep the server agreeing.
  trailingSlash: false,
  // Produce a self-contained build in .next/standalone — ideal for Docker
  // and any deployment that doesn't use Vercel's build pipeline.
  output: 'standalone',

  images: {
    remotePatterns: imageRemotePatterns(),
    // AVIF first (smaller), then WebP; JPEG as the implicit fallback.
    formats: ['image/avif', 'image/webp'],
    // Breakpoints matching the variant widths the backend generates, plus a
    // full-width size for hero images.  `next/image` uses these to generate
    // `srcset` entries and pick the right width on the fly.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [400, 800, 1200],
    // Next 16 only honours qualities listed here and answers 400 for anything
    // else, so every `quality={80}` in the components has to appear.  75 is
    // the default and stays available for any component that omits the prop.
    qualities: [75, 80],
  },

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // The generated feeds are cheap to serve and fine to hold at the edge.
        source: '/:path(feed.xml|sitemap.xml|robots.txt)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },

  async rewrites() {
    // Uploaded media is served same-origin so that both the browser and the
    // `next/image` optimiser can reach it.  In production the host nginx
    // answers /media/ straight from the backend and browser requests never get
    // here; this rewrite covers `make dev`, which has no proxy at all, and —
    // in both environments — the optimiser, which resolves a local
    // `/media/...` source through this very router rather than over the
    // network.  Skipped when media lives on a CDN.
    if (MEDIA_BASE_URL) return [];
    return [
      {
        source: '/media/:path*',
        destination: `${API_INTERNAL_ORIGIN}/media/:path*`,
      },
    ];
  },

  async redirects() {
    return [
      // The section moved under /category. 308 so the link equity transfers
      // and crawlers stop re-requesting the old path.
      { source: '/red-carpet', destination: '/category/red-carpet', permanent: true },
      // Common feed-reader guesses, pointed at the real feed.
      { source: '/rss', destination: '/feed.xml', permanent: true },
      { source: '/rss.xml', destination: '/feed.xml', permanent: true },
    ];
  },
};

module.exports = nextConfig;
