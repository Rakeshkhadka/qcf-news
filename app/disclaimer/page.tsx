import type { Metadata } from 'next';
import { PageShell } from '../../components/page-shell';
import { getCategories } from '../../lib/api';
import { SITE } from '../../lib/seo';

export const metadata: Metadata = {
  title: 'Disclaimer',
  description: `Disclaimer regarding the content, opinions, and external links on ${SITE.name}.`,
  alternates: { canonical: '/disclaimer' },
  robots: { index: true, follow: true },
};

export default async function DisclaimerPage() {
  const categories = await getCategories();

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space legal-page" id="main" tabIndex={-1}>
        <p className="eyebrow blue">Legal</p>
        <h1>Disclaimer</h1>
        <p className="legal-updated">Last updated: August 26, 2026</p>

        <div className="legal-body">
          <section>
            <h2>1. General Information</h2>
            <p>
              The information provided on {SITE.name} is for general entertainment and
              informational purposes only. All content is published in good faith and for
              general informational purposes. We do not make any warranties about the
              completeness, reliability, or accuracy of this information.
            </p>
          </section>

          <section>
            <h2>2. Not Professional Advice</h2>
            <p>
              Nothing on this website should be taken as professional, legal, medical,
              financial, or any other form of advice. Always seek the guidance of a qualified
              professional with any questions you may have regarding such matters.
            </p>
          </section>

          <section>
            <h2>3. External Links</h2>
            <p>
              {SITE.name} may contain links to external websites that are not provided or
              maintained by us. We do not guarantee the accuracy, relevance, timeliness, or
              completeness of any information on these external websites. The inclusion of
              any link does not imply endorsement by {SITE.name}.
            </p>
          </section>

          <section>
            <h2>4. Opinions &amp; Editorial Content</h2>
            <p>
              Opinions expressed in articles, reviews, and commentary pieces are those of the
              individual authors and do not necessarily reflect the official position of{' '}
              {SITE.name} or its editorial team. Celebrity quotes and statements are
              attributed to the best of our ability and sourced from public appearances,
              interviews, and official communications.
            </p>
          </section>

          <section>
            <h2>5. Images &amp; Media</h2>
            <p>
              Images used on this website are either owned by {SITE.name}, used under
              license, obtained from public domain sources, or used under fair use for
              editorial and commentary purposes. If you believe any content infringes your
              copyright, please see our{' '}
              <a href="/dmca">DMCA / Copyright Policy</a> or{' '}
              <a href="/contact">contact us</a> immediately.
            </p>
          </section>

          <section>
            <h2>6. Errors &amp; Corrections</h2>
            <p>
              While we strive for accuracy, errors can occur in the fast-paced world of
              entertainment news. If you spot an error in any of our articles, please{' '}
              <a href="/contact">let us know</a>. We are committed to correcting factual
              errors promptly and transparently.
            </p>
          </section>

          <section>
            <h2>7. Limitation of Liability</h2>
            <p>
              Under no circumstances shall {SITE.name} be liable for any direct, indirect,
              incidental, consequential, special, or exemplary damages arising from your use
              of this website or reliance on any information provided herein.
            </p>
          </section>

          <section>
            <h2>8. Contact</h2>
            <p>
              If you have concerns about any content on this site, please{' '}
              <a href="/contact">contact us</a>.
            </p>
          </section>
        </div>
      </main>
    </PageShell>
  );
}
