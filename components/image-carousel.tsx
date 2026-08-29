'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';

export type CarouselImage = {
  url: string;
  caption?: string;
  alt?: string;
};

type ImageCarouselProps = {
  images: CarouselImage[];
  /** Fallback alt text for slides that don't carry their own. */
  alt?: string;
  /** Advance automatically every N ms. Omit (or 0) to keep it manual. */
  autoPlayMs?: number;
};

const SWIPE_THRESHOLD = 45;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Created lazily so this module stays importable during SSR, where
 * `window.matchMedia` does not exist, and kept at module scope so every
 * carousel on the page shares a single MediaQueryList.
 */
let reducedMotionQuery: MediaQueryList | null = null;
function getReducedMotionQuery(): MediaQueryList {
  if (!reducedMotionQuery) reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  return reducedMotionQuery;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const mediaQuery = getReducedMotionQuery();
  // Safari below 14 only implements the deprecated listener pair.
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }
  mediaQuery.addListener(onChange);
  return () => mediaQuery.removeListener(onChange);
}

const getReducedMotionSnapshot = () => getReducedMotionQuery().matches;
/** The server has no preference to report, so the HTML is built as if motion is fine. */
const getReducedMotionServerSnapshot = () => false;

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

const getVisibilitySnapshot = () => document.visibilityState === 'visible';
/** Prerendered HTML is always "visible"; the client re-decides on hydration. */
const getVisibilityServerSnapshot = () => true;

export function ImageCarousel({ images, alt = '', autoPlayMs = 0 }: ImageCarouselProps) {
  const [rawIndex, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const count = images.length;

  // Both of these track a browser preference that lives outside React. Reading
  // them with useSyncExternalStore rather than useState + useEffect means the
  // first client render already holds the true value; the effect form rendered
  // once with a placeholder and then again with the real one, a wasted render
  // pass on every article page carrying a gallery.
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const isVisible = useSyncExternalStore(
    subscribeVisibility,
    getVisibilitySnapshot,
    getVisibilityServerSnapshot,
  );

  // Clamp by deriving rather than by correcting in an effect: when the gallery
  // shrinks under us (a new article loads with fewer images) a stored index
  // would point past the end for one render before the effect caught it.
  const index = count === 0 ? 0 : Math.min(rawIndex, count - 1);

  const goTo = useCallback((next: number) => {
    setIndex((current) => (count === 0 ? current : ((next % count) + count) % count));
  }, [count]);

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const previous = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    if (!autoPlayMs || count < 2 || paused || prefersReducedMotion || !isVisible) return;
    const timer = window.setInterval(() => goTo(index + 1), autoPlayMs);
    return () => window.clearInterval(timer);
  }, [autoPlayMs, count, goTo, index, paused, prefersReducedMotion, isVisible]);

  if (count === 0) return null;

  const active = images[index];

  // A lone image needs no controls — render it as the plain figure it is.
  if (count === 1) {
    return (
      <figure className="article-figure">
        <Image
          src={active.url}
          alt={active.alt ?? alt}
          width={1200}
          height={675}
          sizes="(max-width: 740px) 100vw, 740px"
          quality={80}
          style={{ width: '100%', height: 'auto', maxHeight: 610, objectFit: 'cover' }}
        />
        {active.caption && <figcaption>{active.caption}</figcaption>}
      </figure>
    );
  }

  return (
    <figure
      className="carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label={alt || 'Article image gallery'}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start === null) return;
        const delta = event.changedTouches[0].clientX - start;
        if (Math.abs(delta) < SWIPE_THRESHOLD) return;
        if (delta < 0) next(); else previous();
      }}
    >
      <div className="carousel-viewport">
        <div className="carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {images.map((image, slide) => (
            <div
              className="carousel-slide"
              key={`${image.url}-${slide}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${slide + 1} of ${count}`}
              aria-hidden={slide !== index}
            >
              <Image
                src={image.url}
                alt={image.alt ?? (slide === index ? alt : '')}
                width={1200}
                height={675}
                sizes="(max-width: 740px) 100vw, 740px"
                quality={80}
                // Only the first slide is worth blocking render for.
                priority={slide === 0}
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ))}
        </div>

        <button type="button" className="carousel-arrow prev" onClick={previous} aria-label="Previous image">
          ‹
        </button>
        <button type="button" className="carousel-arrow next" onClick={next} aria-label="Next image">
          ›
        </button>
        <p className="carousel-counter" aria-hidden="true">{index + 1} / {count}</p>
      </div>

      <div className="carousel-dots" role="tablist" aria-label="Choose image">
        {images.map((image, slide) => (
          <button
            type="button"
            key={`dot-${image.url}-${slide}`}
            role="tab"
            className={slide === index ? 'active' : ''}
            aria-selected={slide === index}
            aria-label={`Image ${slide + 1}`}
            onClick={() => goTo(slide)}
          />
        ))}
      </div>

      <figcaption aria-live="polite">
        {active.caption ?? ''}
      </figcaption>
    </figure>
  );
}
