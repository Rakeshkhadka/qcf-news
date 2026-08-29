import type { Metadata } from 'next';
import { PageShell } from '../../components/page-shell';
import { getCategories } from '../../lib/api';
import { SITE } from '../../lib/seo';

export const metadata: Metadata = {
  title: 'About Us',
  description: `Learn about the ${SITE.name} newsroom — who we are, our editorial mission, and what drives us.`,
  alternates: { canonical: '/about' },
};

export default async function AboutPage() {
  const categories = await getCategories();

  return (
    <PageShell navCategories={categories}>
      <main className="container page-space legal-page" id="main" tabIndex={-1}>
        <p className="eyebrow blue">Who We Are</p>
        <h1>About {SITE.name}</h1>

        <div className="legal-body">
          <section>
            <h2>Our Mission</h2>
            <p>
              {SITE.name} is your go-to source for breaking entertainment news, red carpet
              galleries, exclusive interviews, and celebrity culture — reported daily by our
              dedicated newsroom. We believe entertainment journalism should be fast, fair,
              and fun — and we hold ourselves to that standard every single day.
            </p>
          </section>

          <section>
            <h2>What We Cover</h2>
            <p>
              From Hollywood premieres to music chart-toppers, reality TV drama to fashion
              week highlights — if it’s making waves in pop culture, we’re on it. Our
              editorial team covers:
            </p>
            <ul>
              <li><strong>Celebrity News</strong> — daily scoops, relationship updates, and career moves</li>
              <li><strong>Entertainment</strong> — movie reviews, TV recaps, and streaming picks</li>
              <li><strong>Music</strong> — album drops, tour announcements, and artist profiles</li>
              <li><strong>Red Carpet & Fashion</strong> — best-dressed lists and style breakdowns</li>
              <li><strong>Pop Culture</strong> — trending topics, viral moments, and cultural commentary</li>
            </ul>
          </section>

          <section>
            <h2>Our Values</h2>
            <p>
              We take accuracy seriously. Every story is fact-checked and attributed. We
              respect the privacy of public figures even while covering their public lives, and
              we always distinguish between confirmed reporting and speculation. Our readers
              trust us because we earn that trust with every publish.
            </p>
          </section>

          <section>
            <h2>The Newsroom</h2>
            <p>
              {SITE.name} is run by a small but passionate team of entertainment writers,
              editors, and digital media specialists who live and breathe pop culture. We
              work around the clock to make sure you never miss a beat.
            </p>
          </section>

          <section>
            <h2>Get in Touch</h2>
            <p>
              Have a tip, a correction, or just want to say hello? We’d love to hear from
              you. Visit our <a href="/contact">Contact page</a> or subscribe to our
              newsletter for daily scoops delivered to your inbox.
            </p>
          </section>
        </div>
      </main>
    </PageShell>
  );
}
