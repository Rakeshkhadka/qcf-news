import { NextRequest, NextResponse } from 'next/server';

import { callNewsletterApi, SIGNUP_ACCEPTED_MESSAGE } from '../../../../lib/newsletter';

/**
 * Newsletter signup, from the browser.
 *
 *   POST /api/newsletter/subscribe
 *   { "email": "…", "source": "footer", "company": "" }
 *
 * The form posts here rather than straight at the API for the same reason the
 * admin UI does: browser-facing code talks to Next, and only Next talks to the
 * backend. It also lets the honeypot be answered here, without spending a
 * database round trip or an SMTP connection on a bot.
 *
 * Note for anyone moving this route: the production nginx sends `/api/` to the
 * backend and only carves out the prefixes it is told to. `/api/newsletter/`
 * is one of those carve-outs, and that config now lives on the host at
 * /home/conf/qcfnews.conf (reference: `nginx/qcfnews.conf.example`), outside
 * this repo. A rename here needs a matching rename there, or the request lands
 * on FastAPI and 404s — and nothing in development will tell you, because
 * `make dev` reaches Next directly with no proxy in between.
 */

/** Longest address the backend will store; reject the absurd ones here. */
const MAX_EMAIL_LENGTH = 320;

/** Signup forms on the site, by the `source` they record. */
const KNOWN_SOURCES = new Set(['footer', 'article-aside']);

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || typeof body.email !== 'string') {
    return NextResponse.json(
      { success: false, message: 'Enter an email address.' },
      { status: 400 }
    );
  }

  // Honeypot: a field hidden from people and irresistible to form-filling
  // bots. Anything in it means a script, and the friendliest thing to do with
  // a script is agree with it — a 200 that did nothing costs the bot no
  // retries and costs us no email.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return NextResponse.json({ success: true, message: SIGNUP_ACCEPTED_MESSAGE });
  }

  const email = body.email.trim();
  if (!email || email.length > MAX_EMAIL_LENGTH || !email.includes('@')) {
    return NextResponse.json(
      { success: false, message: 'Enter a valid email address.' },
      { status: 400 }
    );
  }

  const source =
    typeof body.source === 'string' && KNOWN_SOURCES.has(body.source)
      ? body.source
      : undefined;

  const result = await callNewsletterApi('/subscribe', {
    method: 'POST',
    body: JSON.stringify({ email, source }),
    headers: forwardedClientHeaders(request),
  });

  return NextResponse.json(
    { success: result.ok, message: result.message },
    { status: result.status }
  );
}

/**
 * Pass the caller's address and user agent through to the backend, which
 * records them as evidence of consent.
 *
 * Without this the backend would log the Next container as the origin of every
 * signup on the site. The header is passed through verbatim, so the left-most
 * entry is still whatever the edge put there — and the edge nginx sets it to
 * `$remote_addr`, overwriting anything the caller sent, precisely so that
 * entry cannot be chosen by the caller. The backend believes it only when
 * `RATE_LIMIT_TRUST_PROXY` is on — see `src/utils/client_ip.py` and
 * `nginx/qcfnews.conf.example`.
 */
function forwardedClientHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) headers['x-forwarded-for'] = forwarded;

  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers['user-agent'] = userAgent;

  return headers;
}
