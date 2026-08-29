import { NextRequest, NextResponse } from 'next/server';

import { callNewsletterApi } from '../../../../lib/newsletter';

/**
 * Unsubscribe, from the button on `/newsletter/unsubscribe`.
 *
 *   POST /api/newsletter/unsubscribe
 *   { "token": "…" }
 *
 * POST, never GET. Mail clients, link scanners and corporate security
 * gateways fetch every URL in a message before the reader sees it, so an
 * unsubscribe that acted on GET would quietly empty the list. The link in the
 * email opens a page; the page's button posts here.
 */

/** Matches the backend's own bound, so nonsense is rejected before a round trip. */
const MAX_TOKEN_LENGTH = 128;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json(
      { success: false, message: 'That link is invalid or has expired.' },
      { status: 400 }
    );
  }

  const result = await callNewsletterApi(
    `/unsubscribe?token=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );

  return NextResponse.json(
    { success: result.ok, message: result.message },
    { status: result.status }
  );
}
