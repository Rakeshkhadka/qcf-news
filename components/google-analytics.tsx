'use client';

import Script from 'next/script';

/**
 * Google Analytics (GA4) Integration.
 *
 * Activated when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set (e.g. `G-XXXXXXXXXX`).
 * Uses `next/script` with `afterInteractive` strategy so page loading is not blocked.
 */
export function GoogleAnalytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  if (!gaId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}', {
            page_path: window.location.pathname,
          });
        `}
      </Script>
    </>
  );
}
