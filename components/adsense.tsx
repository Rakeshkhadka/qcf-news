'use client';

import { useEffect, useRef } from 'react';
import Script from 'next/script';

/**
 * Google AdSense Global Script.
 *
 * Activated when `NEXT_PUBLIC_ADSENSE_CLIENT_ID` is set (e.g. `ca-pub-XXXXXXXXXXXXXXX`).
 */
export function AdSenseScript() {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;

  if (!clientId) return null;

  return (
    <Script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  );
}

type AdUnitProps = {
  /** Optional AdSense slot ID from your AdSense dashboard */
  slot?: string;
  /** Format of the ad unit: 'auto', 'fluid', 'rectangle', etc. */
  format?: 'auto' | 'fluid' | 'rectangle' | 'horizontal' | 'vertical';
  /** Whether the ad unit expands responsively to fit container width */
  responsive?: boolean;
  /** Inline styles for the outer container */
  style?: React.CSSProperties;
  /** Additional CSS class names */
  className?: string;
};

/**
 * Reusable Google AdSense Ad Unit Component.
 *
 * Renders an `<ins class="adsbygoogle">` block and pushes the ad request when mounted.
 * When `NEXT_PUBLIC_ADSENSE_CLIENT_ID` is unset, it safely renders nothing.
 */
export function AdUnit({
  slot,
  format = 'auto',
  responsive = true,
  style,
  className,
}: AdUnitProps) {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!clientId || pushedRef.current) return;
    try {
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
      pushedRef.current = true;
    } catch (err) {
      console.error('AdSense error:', err);
    }
  }, [clientId]);

  if (!clientId) return null;

  return (
    <div
      className={`ad-container ${className ?? ''}`}
      style={{ margin: '24px auto', textAlign: 'center', overflow: 'hidden', ...style }}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block', ...style }}
        data-ad-client={clientId}
        {...(slot ? { 'data-ad-slot': slot } : {})}
        data-ad-format={format}
        data-full-width-responsive={responsive ? 'true' : 'false'}
      />
    </div>
  );
}
