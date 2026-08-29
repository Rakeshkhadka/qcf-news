import type { Metadata } from 'next';
import { PageShell } from '../../components/page-shell';
import { getCategories } from '../../lib/api';
import { SITE, SITE_URL } from '../../lib/seo';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: `Terms and conditions governing the use of ${SITE.name} and its services.`,
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
};

export default async function TermsPage() {
  const categories = await getCategories();

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space legal-page" id="main" tabIndex={-1}>
        <p className="eyebrow blue">Legal</p>
        <h1>Terms &amp; Conditions</h1>
        <p className="legal-updated">Last updated: August 26, 2026</p>

        <div className="legal-body">
          <section>
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing or using {SITE.name} at{' '}
              <a href={SITE_URL}>{SITE_URL}</a>, you agree to be bound by these Terms
              &amp; Conditions. If you disagree with any part of these terms, you may not
              access the website.
            </p>
          </section>

          <section>
            <h2>2. Intellectual Property</h2>
            <p>
              All content published on {SITE.name}, including but not limited to articles,
              photographs, graphics, logos, and design elements, is the property of{' '}
              {SITE.legalName} or its content suppliers and is protected by international
              copyright laws. You may not reproduce, distribute, or create derivative works
              from any content on this site without express written permission.
            </p>
          </section>

          <section>
            <h2>3. User Conduct</h2>
            <p>When using our website, you agree not to:</p>
            <ul>
              <li>Use the site for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to our systems or user accounts</li>
              <li>Interfere with the proper working of the website</li>
              <li>Scrape, mine, or otherwise extract content without permission</li>
              <li>Post or transmit any harmful, threatening, or objectionable material</li>
              <li>Impersonate any person or entity</li>
            </ul>
          </section>

          <section>
            <h2>4. Newsletter &amp; Subscriptions</h2>
            <p>
              By subscribing to our newsletter, you consent to receiving periodic emails
              from {SITE.name}. You may unsubscribe at any time by clicking the unsubscribe
              link included in every email. We will never sell or share your email address
              with third parties for marketing purposes.
            </p>
          </section>

          <section>
            <h2>5. Content Accuracy</h2>
            <p>
              We make every effort to ensure the accuracy of the information published on
              our site. However, {SITE.name} makes no warranties or representations as to
              the accuracy, completeness, or reliability of any content. Entertainment news
              is often fast-moving, and stories may be updated as new information becomes
              available.
            </p>
          </section>

          <section>
            <h2>6. Third-Party Links</h2>
            <p>
              Our website may contain links to third-party websites. These links are
              provided for your convenience only. We have no control over the content of
              those sites and accept no responsibility for them or for any loss or damage
              that may arise from your use of them.
            </p>
          </section>

          <section>
            <h2>7. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by applicable law, {SITE.name} shall not be
              liable for any indirect, incidental, special, consequential, or punitive
              damages, or any loss of profits or revenues, whether incurred directly or
              indirectly, or any loss of data, use, goodwill, or other intangible losses
              resulting from your use of our services.
            </p>
          </section>

          <section>
            <h2>8. Modifications</h2>
            <p>
              We reserve the right to modify these terms at any time. Material changes will
              be noted by updating the “Last updated” date at the top of this page. Your
              continued use of the site after any modification constitutes acceptance of the
              revised terms.
            </p>
          </section>

          <section>
            <h2>9. Governing Law</h2>
            <p>
              These terms shall be governed by and construed in accordance with applicable
              laws, without regard to conflict of law principles.
            </p>
          </section>

          <section>
            <h2>10. Contact</h2>
            <p>
              Questions about these Terms &amp; Conditions? Please{' '}
              <a href="/contact">contact us</a>.
            </p>
          </section>
        </div>
      </main>
    </PageShell>
  );
}
