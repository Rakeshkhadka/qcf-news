import { ImageResponse } from 'next/og';
import { SITE } from '../../lib/seo';

/**
 * Generated social card, at a stable URL.
 *
 * Stories with cover art use the photograph; this is what everything else
 * falls back to — the home page, sections, and any story published without an
 * image. A card that renders *something* branded beats Twitter and Slack
 * showing a bare link, and a 1200×630 `summary_large_image` is the difference
 * between a link that gets clicked and one that doesn't.
 *
 * `?title=` and `?eyebrow=` let a page put its own headline on the card.
 */

export const revalidate = 86400;

const SIZE = { width: 1200, height: 630 };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Hard cap the text: anything longer is an attempt to blow up the renderer,
  // and it would overflow the card regardless.
  const title = (searchParams.get('title') ?? SITE.tagline).slice(0, 120);
  const eyebrow = (searchParams.get('eyebrow') ?? SITE.name).slice(0, 40);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: '#14181a',
          color: '#fbfcfc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: 14,
              height: 44,
              background: '#3b8ef0',
            }}
          />
          <div
            style={{
              fontSize: 26,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#8fbdf5',
            }}
          >
            {eyebrow}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: title.length > 70 ? 62 : 78,
            lineHeight: 1.06,
            letterSpacing: '-0.03em',
            fontWeight: 700,
            maxWidth: '95%',
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            borderTop: '1px solid #3a4145',
            paddingTop: '28px',
          }}
        >
          <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-0.05em' }}>
            {SITE.name.toUpperCase()}
          </div>
          <div style={{ fontSize: 24, color: '#9aa1a5' }}>{SITE.tagline}</div>
        </div>
      </div>
    ),
    SIZE
  );
}
