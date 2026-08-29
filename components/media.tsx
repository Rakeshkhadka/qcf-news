import type { CSSProperties } from 'react';
import Image from 'next/image';

type MediaProps = {
  src: string;
  alt: string;
  /** Width / height of the reserved box, e.g. `16 / 9`. Overridable in CSS. */
  ratio?: string;
  className?: string;
  /**
   * The one image that is likely the largest-contentful paint. Loads eagerly
   * at high priority; everything else defers.
   */
  priority?: boolean;
  style?: CSSProperties;
  /**
   * Responsive `sizes` hint for `next/image`, so the browser picks the smallest
   * file that covers the viewport slot.  Falls back to a sensible card default
   * when the caller doesn't pass one.
   */
  sizes?: string;
};

/**
 * A responsive image inside a box whose height is known before the bytes
 * arrive.
 *
 * Layout shift is the cheapest Core Web Vital to lose and the most annoying to
 * a reader — a headline that jumps as the art loads. The aspect ratio is
 * declared by the caller and the image is cropped into it; the browser then
 * reserves the right space from the first paint.
 *
 * Uses `next/image` in `fill` mode so the image optimizer can serve AVIF/WebP
 * at the correct resolution for the device, and the browser negotiates
 * `srcset` automatically.
 */
export function Media({
  src,
  alt,
  ratio = '16 / 9',
  className,
  priority = false,
  style,
  sizes = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw',
}: MediaProps) {
  return (
    <span
      className={className ? `media ${className}` : 'media'}
      // Handed to CSS as a custom property rather than `aspect-ratio` directly,
      // so a breakpoint can reshape the crop in one place — the mobile hero
      // does exactly that. (An inline declaration still outranks the
      // stylesheet, so such an override has to be `!important`.)
      style={{ ['--ratio' as string]: ratio, ...style }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        quality={80}
        style={{ objectFit: 'cover' }}
      />
    </span>
  );
}
