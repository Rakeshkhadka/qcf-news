/**
 * Shared pieces of the newsletter BFF.
 *
 * The three newsletter endpoints under `app/api/newsletter/` all do the same
 * two things — call one backend route, and turn whatever comes back into a
 * response the client can render — so the shape of that lives here once.
 *
 * Server-only: it imports the internal API origin, which is a hostname the
 * browser cannot resolve.
 */

import { API_INTERNAL_BASE } from './server-config';

/**
 * The one answer a signup attempt ever gets, whatever actually happened.
 *
 * Must stay word-for-word identical to `SIGNUP_ACCEPTED` in
 * `Backend/src/apps/v1/newsletter/services/subscription_service.py`. The
 * backend returns it for a new signup, a throttled resend and an address
 * already on the list alike, so that the form cannot be used to test whether
 * someone is subscribed. The copy here is for the honeypot path, which
 * answers without calling the backend at all — a different wording there
 * would hand a bot the very signal the shared one exists to withhold.
 */
export const SIGNUP_ACCEPTED_MESSAGE =
  "Check your inbox — if that address isn't subscribed yet, a confirmation link is on its way.";

/** Shown when the backend is unreachable, so the reader never sees a raw failure. */
export const UNREACHABLE_MESSAGE =
  "We couldn't reach the newsletter service just now. Please try again in a few minutes.";

export type NewsletterResult = {
  ok: boolean;
  status: number;
  message: string;
  email?: string;
};

type BackendEnvelope = {
  success?: boolean;
  message?: string;
  data?: { email?: string } | null;
};

/**
 * Call one newsletter endpoint on the backend and normalise the answer.
 *
 * The backend's message is passed through verbatim on both paths. That is
 * deliberate: the wording of a signup response is load-bearing — it is
 * written so that no branch reveals whether an address is already on the
 * list — and a second copy of it here would be a second thing to keep in
 * agreement with the first.
 */
export async function callNewsletterApi(
  path: string,
  init: { method: string; body?: string; headers?: Record<string, string> }
): Promise<NewsletterResult> {
  try {
    const upstream = await fetch(`${API_INTERNAL_BASE}/newsletter${path}`, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      body: init.body,
      cache: 'no-store',
    });

    const payload = (await upstream.json().catch(() => null)) as BackendEnvelope | null;

    return {
      ok: upstream.ok,
      status: upstream.status,
      message: payload?.message ?? UNREACHABLE_MESSAGE,
      email: payload?.data?.email,
    };
  } catch {
    // A network failure is not the reader's problem to interpret. 503 rather
    // than 500: nothing is wrong with what they sent, and retrying is the
    // right advice.
    return { ok: false, status: 503, message: UNREACHABLE_MESSAGE };
  }
}
