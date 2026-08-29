import type { Metadata } from 'next';
import { PageShell } from '../../components/page-shell';
import { getCategories } from '../../lib/api';
import { SITE, SITE_URL } from '../../lib/seo';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${SITE.name} collects, uses, and protects your personal information.`,
  alternates: { canonical: '/privacy-policy' },
  robots: { index: true, follow: true },
};

export default async function PrivacyPolicyPage() {
  const categories = await getCategories();

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space legal-page" id="main" tabIndex={-1}>
        <p className="eyebrow blue">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: August 26, 2026</p>

        <div className="legal-body">
          <section>
            <h2>1. Introduction</h2>
            <p>
              Welcome to {SITE.name} (“<strong>we</strong>,” “<strong>us</strong>,” or “<strong>our</strong>”).
              We are committed to protecting the privacy of our visitors and subscribers.
              This Privacy Policy explains how we collect, use, disclose, and safeguard your
              information when you visit our website at{' '}
              <a href={SITE_URL}>{SITE_URL}</a>, including any other media
              form, media channel, mobile website, or mobile application related or connected thereto.
            </p>
          </section>

          <section>
            <h2>2. Information We Collect</h2>
            <h3>Personal Data</h3>
            <p>
              We may collect personally identifiable information that you voluntarily provide
              when you subscribe to our newsletter, submit a contact form, or interact with
              our services. This may include:
            </p>
            <ul>
              <li>Email address (when subscribing to the newsletter)</li>
              <li>Name and contact details (when using the contact form)</li>
              <li>Any other information you voluntarily provide</li>
            </ul>

            <h3>Automatically Collected Data</h3>
            <p>
              When you visit our site, certain information is automatically collected,
              including:
            </p>
            <ul>
              <li>IP address and browser type</li>
              <li>Device type and operating system</li>
              <li>Pages visited, time spent, and referral source</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>
          </section>

          <section>
            <h2>3. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul>
              <li>Deliver, operate, and maintain our website</li>
              <li>Send newsletters and editorial updates you have opted into</li>
              <li>Improve, personalise, and expand our content</li>
              <li>Understand and analyse usage patterns and trends</li>
              <li>Respond to inquiries and provide customer support</li>
              <li>Detect and prevent fraud or technical issues</li>
            </ul>
          </section>

          <section>
            <h2>4. Cookies and Tracking Technologies</h2>
            <p>
              We use cookies and similar technologies to enhance your experience, analyse
              traffic, and for security purposes. You can instruct your browser to refuse
              all cookies or to indicate when a cookie is being sent. However, if you do not
              accept cookies, you may not be able to use some portions of our service. For
              more details, please see our <a href="/cookie-policy">Cookie Policy</a>.
            </p>
          </section>

          <section>
            <h2>5. Third-Party Services</h2>
            <p>
              We may employ third-party companies and individuals to facilitate our service,
              provide analytics, or assist us in analysing how our service is used. These
              third parties have access to your personal data only to perform these tasks on
              our behalf and are obligated not to disclose or use it for any other purpose.
            </p>
          </section>

          <section>
            <h2>6. Data Security</h2>
            <p>
              The security of your data is important to us. We strive to use commercially
              acceptable means to protect your personal information but cannot guarantee its
              absolute security. We use SSL encryption, secure cookie handling, and regularly
              review our data collection, storage, and processing practices.
            </p>
          </section>

          <section>
            <h2>7. Your Rights</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul>
              <li>Access, correct, or delete your personal data</li>
              <li>Object to or restrict processing of your personal data</li>
              <li>Data portability — receive your data in a structured, machine-readable format</li>
              <li>Withdraw consent at any time where processing is based on consent</li>
              <li>Opt out of marketing communications via the unsubscribe link in any email</li>
            </ul>
          </section>

          <section>
            <h2>8. Children’s Privacy</h2>
            <p>
              Our service is not directed to anyone under the age of 13. We do not knowingly
              collect personally identifiable information from children under 13. If you
              become aware that a child has provided us with personal data, please contact us
              so that we can take the necessary steps.
            </p>
          </section>

          <section>
            <h2>9. Changes to This Policy</h2>
            <p>
              We may update our Privacy Policy from time to time. We will notify you of any
              changes by posting the new Privacy Policy on this page and updating the “Last
              updated” date. You are advised to review this Privacy Policy periodically for
              any changes.
            </p>
          </section>

          <section>
            <h2>10. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please{' '}
              <a href="/contact">contact us</a>.
            </p>
          </section>
        </div>
      </main>
    </PageShell>
  );
}
