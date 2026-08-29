'use client';

import { useCallback, useState, type FormEvent } from 'react';
import type { Metadata } from 'next';
import { SITE } from '../../lib/seo';

/**
 * Contact form — client component so it can manage its own submission state.
 *
 * There is no backend endpoint for contact forms yet, so submission currently
 * renders a confirmation message. Replace the `handleSubmit` body with a
 * `fetch('/api/contact', …)` call when the endpoint is ready.
 */
export default function ContactPage() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });

  const canSubmit = form.name.trim() && form.email.trim() && form.message.trim() && status !== 'sending';

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const { name, value } = event.target;
      setForm((prev) => ({ ...prev, [name]: value }));
    },
    []
  );

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;
      setStatus('sending');

      // TODO: wire to a real backend endpoint
      // try {
      //   const res = await fetch('/api/contact', {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/json' },
      //     body: JSON.stringify(form),
      //   });
      //   if (!res.ok) throw new Error();
      //   setStatus('sent');
      // } catch {
      //   setStatus('error');
      // }

      // Simulated for now:
      await new Promise((r) => setTimeout(r, 800));
      setStatus('sent');
    },
    [canSubmit, form]
  );

  return (
    <main className="container page-space legal-page" id="main" tabIndex={-1}>
      <p className="eyebrow blue">Get in Touch</p>
      <h1>Contact Us</h1>

      <div className="legal-body">
        <p>
          Have a news tip, a correction, a business inquiry, or just want to say hello?
          We’d love to hear from you. Fill out the form below and our team will get back
          to you as soon as possible.
        </p>

        {status === 'sent' ? (
          <div className="contact-success">
            <h2>Message Sent ✓</h2>
            <p>
              Thank you for reaching out! We’ll review your message and get back to you
              shortly.
            </p>
          </div>
        ) : (
          <form className="contact-form" onSubmit={handleSubmit} noValidate>
            <div className="contact-row">
              <div className="contact-field">
                <label htmlFor="contact-name">Name <span className="required">*</span></label>
                <input
                  id="contact-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Your full name"
                />
              </div>
              <div className="contact-field">
                <label htmlFor="contact-email">Email <span className="required">*</span></label>
                <input
                  id="contact-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="contact-field">
              <label htmlFor="contact-subject">Subject</label>
              <select
                id="contact-subject"
                name="subject"
                value={form.subject}
                onChange={handleChange}
              >
                <option value="">Select a topic…</option>
                <option value="tip">News Tip</option>
                <option value="correction">Correction Request</option>
                <option value="business">Business Inquiry</option>
                <option value="feedback">Feedback</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="contact-field">
              <label htmlFor="contact-message">Message <span className="required">*</span></label>
              <textarea
                id="contact-message"
                name="message"
                rows={6}
                required
                value={form.message}
                onChange={handleChange}
                placeholder="Tell us what's on your mind…"
              />
            </div>

            {status === 'error' && (
              <p className="form-error">
                Something went wrong. Please try again or email us directly.
              </p>
            )}

            <button
              type="submit"
              className="contact-submit"
              disabled={!canSubmit}
            >
              {status === 'sending' ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        )}

        <section className="contact-alt">
          <h2>Other Ways to Reach Us</h2>
          <ul>
            <li>
              <strong>Email:</strong>{' '}
              <a href={`mailto:hello@celebscoop.com`}>hello@celebscoop.com</a>
            </li>
            <li>
              <strong>Tips:</strong>{' '}
              <a href={`mailto:tips@celebscoop.com`}>tips@celebscoop.com</a>
            </li>
            <li>
              <strong>Social:</strong>{' '}
              Follow us <a href={`https://twitter.com/${SITE.twitter?.replace('@', '')}`} target="_blank" rel="noopener noreferrer">on X (Twitter)</a>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
