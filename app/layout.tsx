import './globals.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '@fontsource-variable/source-serif-4/wght.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AdSenseScript } from '../components/adsense';
import { GoogleAnalytics } from '../components/google-analytics';
import { MEDIA_BASE_URL } from '../lib/media';
import {
  SITE,
  SITE_URL,
  graph,
  jsonLd,
  organizationSchema,
  websiteSchema,
} from '../lib/seo';

/**
 * Site-wide metadata.
 *
 * `metadataBase` is the important one: without it every relative image and
 * canonical Next generates stays relative, and a relative `og:image` is
 * silently ignored by every social scraper. Everything below inherits from
 * here — pages override only what actually differs.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE.name} | ${SITE.tagline}`,
    // Story pages pass a bare headline; the brand is appended here so it is
    // never hand-written (and never doubled) in a page.
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  generator: null,
  keywords: [
    'celebrity news',
    'entertainment news',
    'red carpet',
    'celebrity interviews',
    'pop culture',
    'movies',
    'music',
  ],
  authors: [{ name: `${SITE.name} Newsroom`, url: SITE_URL }],
  publisher: SITE.name,
  category: 'entertainment',
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  },
  alternates: {
    canonical: '/',
    types: {
      'application/rss+xml': [{ url: '/feed.xml', title: `${SITE.name} — latest stories` }],
    },
  },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: `${SITE.name} | ${SITE.tagline}`,
    description: SITE.description,
    url: '/',
    locale: SITE.locale,
    images: [{ url: SITE.ogImage, width: 1200, height: 630, alt: `${SITE.name} — ${SITE.tagline}` }],
  },
  twitter: {
    card: 'summary_large_image',
    site: SITE.twitter,
    creator: SITE.twitter,
    title: `${SITE.name} | ${SITE.tagline}`,
    description: SITE.description,
    images: [SITE.ogImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Let Google use full-size previews and untruncated snippets; the
      // defaults are conservative and cost click-through on news results.
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  formatDetection: { telephone: false, address: false, email: false },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfcfc' },
    { media: '(prefers-color-scheme: dark)', color: '#14181a' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={SITE.lang}
      suppressHydrationWarning
    >
      <head>
        {/*
          Article art is same-origin by default (the reverse proxy routes
          /media at the backend), so there is no extra socket to warm. Only a
          CDN origin is worth preconnecting to.
        */}
        {MEDIA_BASE_URL && (
          <>
            <link rel="preconnect" href={MEDIA_BASE_URL} crossOrigin="" />
            <link rel="dns-prefetch" href={MEDIA_BASE_URL} />
          </>
        )}
        <link rel="alternate" type="application/rss+xml" title={SITE.name} href="/feed.xml" />
        {/*
          Publisher and site identity, emitted once for the whole app so every
          page-level graph can just reference these by @id instead of repeating
          them.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={jsonLd(graph(organizationSchema(), websiteSchema()))}
        />
      </head>
      <body>
        <GoogleAnalytics />
        <AdSenseScript />
        {/* Keyboard and screen-reader users skip the sticky header and the
            nav panel triggers; visible only once focused. */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
