import type { Metadata } from 'next';
import { PageShell } from '../../components/page-shell';
import { getCategories } from '../../lib/api';
import { SITE } from '../../lib/seo';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description: `How ${SITE.name} uses cookies and similar tracking technologies.`,
  alternates: { canonical: '/cookie-policy' },
  robots: { index: true, follow: true },
};

export default async function CookiePolicyPage() {
  const categories = await getCategories();

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space legal-page" id="main" tabIndex={-1}>
        <p className="eyebrow blue">Legal</p>
        <h1>Cookie Policy</h1>
        <p className="legal-updated">Last updated: August 26, 2026</p>

        <div className="legal-body">
          <section>
            <h2>1. What Are Cookies</h2>
            <p>
              Cookies are small text files that are stored on your device (computer, tablet,
              or mobile) when you visit a website. They are widely used to make websites
              work, work more efficiently, and to provide information to the site owners.
            </p>
          </section>

          <section>
            <h2>2. How We Use Cookies</h2>
            <p>{SITE.name} uses cookies for the following purposes:</p>

            <h3>Essential Cookies</h3>
            <p>
              These cookies are necessary for the website to function and cannot be switched
              off. They are usually set in response to actions you take, such as setting your
              privacy preferences or filling in forms.
            </p>

            <h3>Analytics Cookies</h3>
            <p>
              These cookies allow us to count visits and traffic sources so we can measure
              and improve site performance. They help us know which pages are the most and
              least popular and see how visitors navigate the site. All information these
              cookies collect is aggregated and therefore anonymous.
            </p>

            <h3>Functional Cookies</h3>
            <p>
              These cookies enable the website to provide enhanced functionality and
              personalisation. They may be set by us or by third-party providers whose
              services we have added to our pages.
            </p>
          </section>

          <section>
            <h2>3. Third-Party Cookies</h2>
            <p>
              Some cookies may be set by third-party services that appear on our pages. We
              do not control the dissemination of these cookies. You should check the
              relevant third party’s website for more information.
            </p>
          </section>

          <section>
            <h2>4. Managing Cookies</h2>
            <p>
              Most web browsers allow you to control cookies through their settings. You can
              set your browser to:
            </p>
            <ul>
              <li>Block all cookies</li>
              <li>Accept only first-party cookies</li>
              <li>Delete cookies when you close the browser</li>
              <li>Notify you when a cookie is being set</li>
            </ul>
            <p>
              Please note that blocking or deleting cookies may impact your experience on
              our site and limit certain functionality.
            </p>
          </section>

          <section>
            <h2>5. Cookie List</h2>
            <p>Below is a summary of the cookies we use:</p>

            <table>
              <thead>
                <tr>
                  <th>Cookie</th>
                  <th>Purpose</th>
                  <th>Duration</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>session_id</code></td>
                  <td>Maintains user session state</td>
                  <td>Session</td>
                  <td>Essential</td>
                </tr>
                <tr>
                  <td><code>csrf_token</code></td>
                  <td>Security — prevents cross-site request forgery</td>
                  <td>Session</td>
                  <td>Essential</td>
                </tr>
                <tr>
                  <td><code>_ga</code></td>
                  <td>Google Analytics — distinguishes unique users</td>
                  <td>2 years</td>
                  <td>Analytics</td>
                </tr>
                <tr>
                  <td><code>_gid</code></td>
                  <td>Google Analytics — distinguishes unique users</td>
                  <td>24 hours</td>
                  <td>Analytics</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2>6. Updates to This Policy</h2>
            <p>
              We may update this Cookie Policy from time to time. Any changes will be
              reflected on this page with an updated revision date.
            </p>
          </section>

          <section>
            <h2>7. Contact</h2>
            <p>
              If you have questions about our use of cookies, please{' '}
              <a href="/contact">contact us</a>.
            </p>
          </section>
        </div>
      </main>
    </PageShell>
  );
}
