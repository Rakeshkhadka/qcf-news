'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

type NavCategory = { id: number; name: string; slug: string };
type PageShellProps = { children: ReactNode; brand?: string; navCategories?: NavCategory[] };
type Panel = 'menu' | 'search' | null;

const baseNavigation = [
  { label: 'Home', href: '/' },
  { label: 'Latest Feed', href: '/feed' },
];

export function PageShell({ children, brand = 'Celeb Scoop', navCategories = [] }: PageShellProps) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState('');
  const menuButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);

  // Sections come from the API's categories; the two fixed entries stay put.
  const navigation = useMemo(
    () => [
      ...baseNavigation,
      ...navCategories.map((category) => ({
        label: category.name,
        href: `/category/${category.slug}`,
      })),
    ],
    [navCategories]
  );

  // The panel only ever matched section names; stories are searched on /search,
  // so these stay as the shortcut list beside the real search.
  const searchResults = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery
      ? navigation.filter(({ label }) => label.toLowerCase().includes(normalizedQuery))
      : navigation;
  }, [navigation, query]);

  const closePanel = useCallback(() => setPanel(null), []);
  const togglePanel = (nextPanel: Exclude<Panel, null>) =>
    setPanel(panel === nextPanel ? null : nextPanel);

  // Escape closes the panel and hands focus back to the control that opened
  // it — without this a keyboard user is dropped at the top of the document.
  useEffect(() => {
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const opener = panel === 'menu' ? menuButton.current : searchButton.current;
      closePanel();
      opener?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panel, closePanel]);

  // An overlay that scrolls the page behind it reads as broken on touch.
  useEffect(() => {
    if (!panel) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [panel]);

  const trimmedQuery = query.trim();

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedQuery) return;
    router.push(`/search?q=${encodeURIComponent(trimmedQuery)}`);
    setQuery('');
    closePanel();
  };

  const year = new Date().getFullYear();

  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <button
            ref={menuButton}
            className="icon-button"
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={panel === 'menu'}
            aria-controls="menu-panel"
            aria-haspopup="true"
            onClick={() => togglePanel('menu')}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <Link href="/" className="wordmark" onClick={closePanel}>
            {brand}
          </Link>
          <button
            ref={searchButton}
            className="icon-button"
            type="button"
            aria-label="Search stories"
            aria-expanded={panel === 'search'}
            aria-controls="search-panel"
            onClick={() => togglePanel('search')}
          >
            <span aria-hidden="true">⌕</span>
          </button>
        </div>
      </header>

      {panel && (
        <button
          className="panel-backdrop"
          type="button"
          aria-label="Close panel"
          tabIndex={-1}
          onClick={closePanel}
        />
      )}

      {panel === 'menu' && (
        <nav className="header-panel menu-panel" id="menu-panel" aria-label="Site navigation">
          <p className="eyebrow blue">Explore</p>
          <ul role="list">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={closePanel}>
                  {item.label}
                  <span aria-hidden="true">↗</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {panel === 'search' && (
        <section className="header-panel search-panel" id="search-panel" aria-label="Search stories">
          <form onSubmit={submitSearch} role="search">
            <label className="sr-only" htmlFor="site-search">
              Search stories
            </label>
            <input
              id="site-search"
              type="search"
              name="q"
              autoFocus
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search stories"
            />
            <button type="button" onClick={closePanel} aria-label="Close search">
              <span aria-hidden="true">×</span>
            </button>
          </form>
          <div className="search-results">
            {trimmedQuery && (
              <button className="search-submit" type="submit" onClick={submitSearch}>
                Search all stories for “{trimmedQuery}” <span aria-hidden="true">↵</span>
              </button>
            )}
            <p className="eyebrow blue">{query ? 'Matching sections' : 'Quick links'}</p>
            {searchResults.length ? (
              <ul role="list">
                {searchResults.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} onClick={closePanel}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-search">No matching sections yet.</p>
            )}
          </div>
        </section>
      )}

      {children}

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <Link href="/" className="footer-logo">
              {brand}
            </Link>
            <p>
              © {year} {brand}. All rights reserved.
            </p>
          </div>

          {/* These used to be `href="#"` placeholders. Dead links leak crawl
              budget and tell a crawler the footer nav is meaningless; every
              entry now points at a page that exists. */}
          <nav aria-label="Sections">
            <p className="footer-heading">Sections</p>
            <ul role="list">
              {navCategories.slice(0, 6).map((category) => (
                <li key={category.id}>
                  <Link href={`/category/${category.slug}`}>{category.name}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Company">
            <p className="footer-heading">Company</p>
            <ul role="list">
              <li>
                <Link href="/about">About Us</Link>
              </li>
              <li>
                <Link href="/contact">Contact Us</Link>
              </li>
              <li>
                <Link href="/feed">Latest feed</Link>
              </li>
              <li>
                <Link href="/search">Search</Link>
              </li>
              <li>
                <a href="/sitemap.xml">Sitemap</a>
              </li>
              <li>
                <a href="/feed.xml">RSS feed</a>
              </li>
            </ul>
          </nav>

          <nav aria-label="Legal">
            <p className="footer-heading">Legal</p>
            <ul role="list">
              <li>
                <Link href="/privacy-policy">Privacy Policy</Link>
              </li>
              <li>
                <Link href="/terms">Terms &amp; Conditions</Link>
              </li>
              <li>
                <Link href="/cookie-policy">Cookie Policy</Link>
              </li>
              <li>
                <Link href="/disclaimer">Disclaimer</Link>
              </li>
              <li>
                <Link href="/dmca">DMCA / Copyright</Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </>
  );
}
