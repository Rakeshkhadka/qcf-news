import type { Metadata } from 'next';
import { PageShell } from '../../components/page-shell';
import { getCategories } from '../../lib/api';
import { SITE } from '../../lib/seo';
import ContactForm from './contact-form';

export const metadata: Metadata = {
  title: 'Contact Us',
  description: `Get in touch with the ${SITE.name} newsroom — send a tip, request a correction, or say hello.`,
  alternates: { canonical: '/contact' },
};

export default async function ContactPage() {
  const categories = await getCategories();

  return (
    <PageShell navCategories={categories}>
      <ContactForm />
    </PageShell>
  );
}
