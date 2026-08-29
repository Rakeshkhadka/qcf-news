'use client';

import { useId, useState, type FormEvent } from 'react';

type NewsletterProps = { compact?: boolean };

type Status = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Whether to render the subscribe block at all.
 *
 * Inlined into the client bundle at build time, so changing it needs a rebuild
 * rather than a restart. It mirrors the backend's `NEWSLETTER_ENABLED`, and the
 * two are meant to move together: with the backend switched off this component
 * would render a form whose every submission returns 503, which is the dead
 * form this feature replaced.
 */
const ENABLED = process.env.NEXT_PUBLIC_NEWSLETTER_ENABLED === 'true';

/**
 * The subscribe block.
 *
 * Posts to `/api/newsletter/subscribe`, which forwards to the API, which
 * records a *pending* signup and emails a confirmation link. Nothing is
 * subscribed until that link is clicked — so the message this form shows on
 * success says "check your inbox", never "you're subscribed", because at that
 * moment nobody is.
 *
 * When the newsletter is not configured the component renders nothing at all.
 * A signup box that cannot sign anyone up is worse than no box: it takes an
 * address, says something reassuring, and drops it.
 */
export function Newsletter({ compact = false }: NewsletterProps) {
  const reactId = useId();
  const id = `${compact ? 'aside' : 'footer'}-email-${reactId}`;
  const headingId = `${id}-heading`;
  const statusId = `${id}-status`;

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  if (!ENABLED) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'submitting') return;

    const form = event.currentTarget;
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          source: compact ? 'article-aside' : 'footer',
          // The honeypot's value, read straight off the form rather than from
          // state — nothing types into it but a bot.
          company: (form.elements.namedItem('company') as HTMLInputElement)?.value ?? '',
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;

      if (response.ok) {
        setStatus('success');
        setMessage(payload?.message ?? 'Check your inbox to confirm.');
        setEmail('');
      } else {
        setStatus('error');
        setMessage(payload?.message ?? 'That didn’t work. Please try again.');
      }
    } catch {
      setStatus('error');
      setMessage('We couldn’t reach the newsletter service. Please try again in a few minutes.');
    }
  }

  return (
    <section
      className={`newsletter${compact ? ' newsletter-compact' : ''}`}
      aria-labelledby={headingId}
    >
      <div className="newsletter-copy">
        <h2 id={headingId}>{compact ? 'The Daily Scoop' : 'Get the Scoop.'}</h2>
        <p>
          {compact
            ? 'The latest celebrity news, delivered straight to your inbox.'
            : 'Premium entertainment news, exclusive interviews and red carpet galleries, delivered straight to your inbox.'}
        </p>
      </div>

      <div className="newsletter-signup">
        {/*
          No `noValidate`: the browser's own check on `type="email"` and
          `required` is instant, localised, and saves a round trip for the
          commonest mistake. The server still validates — that is the gate;
          this is just the fast path to catching a typo.
        */}
        <form className="newsletter-form" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor={id}>
            Email address
          </label>
          <input
            id={id}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={status === 'submitting'}
            aria-describedby={message ? statusId : undefined}
            aria-invalid={status === 'error' || undefined}
            placeholder={compact ? 'Your email address' : 'Email address'}
          />

          {/*
            Honeypot. Hidden from people by CSS and from screen readers by
            aria-hidden, left in the tab order's blind spot with tabIndex={-1},
            and — the part that actually matters — named `company`, which is
            what a form-filling bot is looking for. autoComplete="off" keeps a
            password manager from filling it on a real person's behalf.
          */}
          <input
            type="text"
            name="company"
            className="newsletter-hp"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />

          <button type="submit" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Sending…' : 'Subscribe'}
          </button>
        </form>

        {/*
          `role="status"` is an aria-live="polite" region: the result is
          announced when it arrives, without stealing focus mid-typing.
          Rendered unconditionally so assistive technology has the region
          already in the accessibility tree when the text appears in it.
        */}
        <p
          id={statusId}
          role="status"
          className={`newsletter-status${status === 'error' ? ' is-error' : ''}`}
        >
          {message}
        </p>

        <p className="newsletter-consent">
          We’ll email you a link to confirm. No subscription starts until you click it,
          and every issue carries a one-click unsubscribe.
        </p>
      </div>
    </section>
  );
}
