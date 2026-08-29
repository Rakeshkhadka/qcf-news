'use client';

import { useState } from 'react';

type Status = 'idle' | 'submitting' | 'done' | 'error';

/**
 * The confirm-and-leave button.
 *
 * One deliberate act, one POST. See the page for why this is not done on
 * render.
 */
export function UnsubscribeForm({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function unsubscribe() {
    if (status === 'submitting') return;
    setStatus('submitting');

    try {
      const response = await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;

      setStatus(response.ok ? 'done' : 'error');
      setMessage(
        payload?.message ??
          (response.ok
            ? 'You’ve been unsubscribed.'
            : 'That link is invalid or has expired.')
      );
    } catch {
      setStatus('error');
      setMessage('We couldn’t reach the newsletter service. Please try again in a few minutes.');
    }
  }

  if (status === 'done' || status === 'error') {
    return (
      <>
        {/* Announced to assistive technology when it replaces the button. */}
        <p role="status" className={status === 'error' ? 'form-error' : undefined}>
          {message}
        </p>
        {status === 'done' && (
          <p>
            We won’t email you again. If you change your mind, the signup form on any page
            will bring you back.
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <p>
        Confirm below and we’ll stop emailing this address. You can subscribe again at any
        time.
      </p>
      <p className="empty-actions">
        <button
          type="button"
          className="unsubscribe-button"
          onClick={unsubscribe}
          disabled={status === 'submitting'}
        >
          {status === 'submitting' ? 'Unsubscribing…' : 'Unsubscribe me'}
        </button>
      </p>
    </>
  );
}
