import { NextRequest, NextResponse } from 'next/server';

import { MEDIA_BASE_URL } from './lib/media';

/**
 * Edge proxy — runs before every matched route.  (Next 16 renamed this file
 * convention from `middleware` to `proxy`; the exported function has to be
 * named `proxy` to match.)
 *
 * Responsibilities:
 * 1. **Admin auth guard** — redirects unauthenticated visitors hitting
 *    `/admin/*` (except `/admin/login`) to the login page.  This is a UX
 *    convenience, *not* a security boundary (the real check happens in the
 *    BFF session endpoints and the backend itself).
 * 2. **CSP header** — injects a strict Content-Security-Policy on every
 *    response.  The nonce-based `script-src` is the main XSS mitigation.
 */

/** Paths the proxy should intercept. */
export const config = {
  matcher: [
    /*
     * Match every route except:
     * - _next/static  (static files)
     * - _next/image   (image optimiser)
     * - media         (uploaded images, rewritten to the backend)
     * - favicon.ico   (browser favourite icon)
     * - public files  (e.g. robots.txt, site.webmanifest)
     */
    '/((?!_next/static|_next/image|media/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|webmanifest|xml)$).*)',
  ],
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Admin auth guard ────────────────────────────────────────────────────
  if (
    pathname.startsWith('/admin') &&
    pathname !== '/admin/login' &&
    !pathname.startsWith('/api/')
  ) {
    // The `admin_session` cookie is set by the BFF login route; it is non-
    // HttpOnly so JS can read it, but the proxy can check it too.
    const hasSession = request.cookies.has('admin_session');
    if (!hasSession) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/admin/login';
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── CSP header ──────────────────────────────────────────────────────────
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // Build the policy.  In development we loosen it a bit (eval for HMR,
  // ws: for the dev-server websocket), but production gets a strict policy.
  const isDev = process.env.NODE_ENV !== 'production';

  // Media is same-origin by default ('self' covers it); a CDN origin has to be
  // named explicitly.  The internal API origin never appears here — the
  // browser cannot reach it, so allowing it would only paper over a
  // misconfiguration.
  const mediaOrigin = MEDIA_BASE_URL ? ` ${MEDIA_BASE_URL}` : '';

  const csp = [
    `default-src 'self'`,
    // Scripts: 'self' 'unsafe-inline' 'unsafe-eval' for Next.js prerendered scripts & dynamic chunk loading
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    // Styles: 'unsafe-inline' is needed because Next
    // injects style tags at runtime that cannot carry a nonce today.
    `style-src 'self' 'unsafe-inline'`,
    // Fonts: served locally via next/font ('self')
    `font-src 'self'`,
    // Images: self (covers same-origin /media and the optimiser) + any CDN
    // origin + data:/blob: for inline SVGs and object URLs
    `img-src 'self'${mediaOrigin} data: blob:`,
    // Connections: self (every API call is same-origin, via the BFF) + dev WS
    `connect-src 'self'${isDev ? ' ws://localhost:3000 ws://localhost:3001' : ''}`,
    // Media
    `media-src 'self'${mediaOrigin}`,
    // Frames: deny all
    `frame-src 'none'`,
    // Object/embed: deny
    `object-src 'none'`,
    // Base URI: only self (prevents <base> tag hijacking)
    `base-uri 'self'`,
    // Form actions: same-origin only
    `form-action 'self'`,
    // Ancestors: same-origin (clickjacking protection, complements X-Frame-Options)
    `frame-ancestors 'self'`,
    // Block mixed content upgrades
    `upgrade-insecure-requests`,
  ].join('; ');

  // Report-Only in dev so nothing breaks during development, enforced in
  // production.
  const cspHeader = isDev
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  // Next reads the nonce off the *request* headers — it parses `script-src`
  // looking for `'nonce-…'` and stamps that value onto every script tag it
  // generates.  Setting the policy only on the response leaves the framework
  // bundles unnonced, and under 'strict-dynamic' an unnonced script is a
  // blocked script: the page ships and then does nothing.  So the header goes
  // on a cloned request first, and is mirrored onto the response for the
  // browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(cspHeader, csp);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set(cspHeader, csp);
  response.headers.set('x-nonce', nonce);

  return response;
}
