import type { Metadata } from 'next';
import { PageShell } from '../../components/page-shell';
import { getCategories } from '../../lib/api';
import { SITE } from '../../lib/seo';

export const metadata: Metadata = {
  title: 'DMCA / Copyright Policy',
  description: `${SITE.name} copyright policy and DMCA takedown procedure for reporting intellectual property infringement.`,
  alternates: { canonical: '/dmca' },
  robots: { index: true, follow: true },
};

export default async function DMCAPage() {
  const categories = await getCategories();

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space legal-page" id="main" tabIndex={-1}>
        <p className="eyebrow blue">Legal</p>
        <h1>DMCA / Copyright Policy</h1>
        <p className="legal-updated">Last updated: August 26, 2026</p>

        <div className="legal-body">
          <section>
            <h2>1. Commitment to Copyright</h2>
            <p>
              {SITE.name} respects the intellectual property rights of others and expects
              our users to do the same. We comply with the Digital Millennium Copyright Act
              (DMCA) and will respond to clear notices of alleged copyright infringement.
            </p>
          </section>

          <section>
            <h2>2. Reporting Copyright Infringement</h2>
            <p>
              If you believe that any content on our website infringes upon your copyright,
              please submit a written DMCA takedown notice containing the following:
            </p>
            <ol>
              <li>
                A physical or electronic signature of the person authorized to act on behalf
                of the copyright owner.
              </li>
              <li>
                A description of the copyrighted work that you claim has been infringed.
              </li>
              <li>
                A description of where the material that you claim is infringing is located
                on our site, including the URL(s).
              </li>
              <li>
                Your address, telephone number, and email address.
              </li>
              <li>
                A statement by you that you have a good faith belief that the disputed use
                is not authorized by the copyright owner, its agent, or the law.
              </li>
              <li>
                A statement by you, made under penalty of perjury, that the above information
                in your notice is accurate and that you are the copyright owner or authorized
                to act on the copyright owner’s behalf.
              </li>
            </ol>
          </section>

          <section>
            <h2>3. How to Submit a Notice</h2>
            <p>
              Please send your DMCA takedown notice to us via our{' '}
              <a href="/contact">contact page</a> or by email at{' '}
              <a href="mailto:dmca@celebscoop.com">dmca@celebscoop.com</a>.
            </p>
            <p>
              Please use <strong>“DMCA Takedown Request”</strong> as the subject line to
              ensure your notice is processed promptly.
            </p>
          </section>

          <section>
            <h2>4. Counter-Notification</h2>
            <p>
              If you believe that your content was removed or disabled by mistake or
              misidentification, you may submit a counter-notification. The counter-notification
              must include:
            </p>
            <ol>
              <li>Your physical or electronic signature.</li>
              <li>
                Identification of the material that has been removed and the location where
                it appeared before it was removed.
              </li>
              <li>
                A statement under penalty of perjury that you have a good faith belief that
                the material was removed or disabled as a result of mistake or
                misidentification.
              </li>
              <li>
                Your name, address, and telephone number, and a statement that you consent
                to the jurisdiction of the federal district court in your district.
              </li>
            </ol>
          </section>

          <section>
            <h2>5. Repeat Infringers</h2>
            <p>
              In accordance with the DMCA and other applicable law, we have adopted a policy
              of terminating, in appropriate circumstances, the accounts of users who are
              deemed to be repeat infringers.
            </p>
          </section>

          <section>
            <h2>6. Fair Use</h2>
            <p>
              {SITE.name} may use copyrighted material in its editorial content for purposes
              of commentary, criticism, news reporting, and other activities that constitute
              fair use under Section 107 of the Copyright Act. We make every effort to
              attribute such content to its original source.
            </p>
          </section>

          <section>
            <h2>7. Contact</h2>
            <p>
              For any copyright-related inquiries, please{' '}
              <a href="/contact">contact us</a> or email{' '}
              <a href="mailto:dmca@celebscoop.com">dmca@celebscoop.com</a>.
            </p>
          </section>
        </div>
      </main>
    </PageShell>
  );
}
