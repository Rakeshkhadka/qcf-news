/**
 * Streamed instantly while a server-rendered page waits on the API.
 *
 * Blocking on the backend with a blank document is what makes a slow first
 * byte *feel* like a broken site; this puts structure on screen immediately
 * and, because the skeleton matches the real layout's proportions, the swap
 * doesn't shift anything.
 */
export default function Loading() {
  return (
    <div className="container page-space" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading stories…</span>
      <div className="skeleton-hero" aria-hidden="true">
        <div>
          <div className="skeleton skeleton-chip" />
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-title short" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
        <div className="skeleton skeleton-figure" />
      </div>
      <div className="skeleton-rail" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div className="skeleton skeleton-card" key={index} />
        ))}
      </div>
    </div>
  );
}
