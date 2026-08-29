import { timingSafeEqual } from 'node:crypto';

import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { API_INTERNAL_BASE } from '../../../lib/server-config';

/**
 * On-demand ISR endpoint.
 *
 * Called after every article or category mutation so the public pages reflect
 * the change within seconds rather than waiting out the time-based
 * revalidation window.
 *
 *   POST /api/revalidate
 *   { "tags": ["articles", "article-my-slug"] }
 *
 * Two callers are allowed, and the endpoint **fails closed** for everybody
 * else — an unset `REVALIDATION_SECRET` closes the machine-to-machine door
 * rather than opening the endpoint to the world:
 *
 * 1. **The admin UI**, authenticated by the HttpOnly `admin_access_token`
 *    cookie the BFF login route sets.  The token is validated against the
 *    backend, so a forged or expired cookie cannot flush the cache.  No
 *    secret is involved: client-side JavaScript must never hold one, which
 *    is what made the previous `window.__REVALIDATION_SECRET__` scheme both
 *    unsafe in principle and broken in practice (nothing ever defined it, so
 *    every production call 401'd and cache invalidation silently stopped).
 * 2. **The backend**, presenting `REVALIDATION_SECRET` in the
 *    `x-revalidation-secret` header — for mutations that do not originate in
 *    the admin UI (imports, scheduled publishing, direct API writes).
 */

/** Next caps tags at 128 per call and 256 characters each; stay inside that. */
const MAX_TAGS = 64;
const MAX_TAG_LENGTH = 256;

/** Constant-time compare that tolerates a length mismatch without leaking it. */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Machine-to-machine callers present the shared secret.  When the secret is
 * not configured this path is simply unavailable — it never degrades into an
 * open endpoint.
 */
function hasValidSecret(request: NextRequest): boolean {
  const expected = process.env.REVALIDATION_SECRET;
  if (!expected) return false;
  const presented = request.headers.get('x-revalidation-secret');
  if (!presented) return false;
  return secretMatches(presented, expected);
}

/**
 * The admin UI is authenticated by its session cookie.  Presence alone proves
 * nothing, so the token is checked against the backend before we act on it.
 */
async function hasValidAdminSession(request: NextRequest): Promise<boolean> {
  const accessToken = request.cookies.get('admin_access_token')?.value;
  if (!accessToken) return false;

  try {
    const upstream = await fetch(`${API_INTERNAL_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    return upstream.ok;
  } catch {
    // Backend unreachable — treat as unauthenticated rather than trusting the
    // cookie on its own.
    return false;
  }
}

/** Keep obviously malformed tags out of the cache API. */
function validTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > MAX_TAGS) return null;
  const tags = value.filter(
    (tag): tag is string =>
      typeof tag === 'string' && tag.length > 0 && tag.length <= MAX_TAG_LENGTH
  );
  return tags.length === value.length ? tags : null;
}

export async function POST(request: NextRequest) {
  try {
    const authorised =
      hasValidSecret(request) || (await hasValidAdminSession(request));

    if (!authorised) {
      return NextResponse.json(
        { success: false, message: 'Not authorised' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const tags = validTags((body as { tags?: unknown } | null)?.tags);

    if (!tags) {
      return NextResponse.json(
        {
          success: false,
          message: `Provide between 1 and ${MAX_TAGS} non-empty tags`,
        },
        { status: 400 }
      );
    }

    for (const tag of tags) {
      revalidateTag(tag, 'max');
    }

    return NextResponse.json({
      success: true,
      revalidated: tags,
      now: Date.now(),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
