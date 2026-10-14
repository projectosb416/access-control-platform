import type { Metadata } from 'next'
import { DraftBanner } from '../_components/draft-banner'
import { PrivacyContent } from '../_content/privacy'

export const metadata: Metadata = {
  title: 'Privacy Policy — e-shomer',
  description:
    'How e-shomer collects, uses, and protects personal data across its access control platform.',
}

export default function PrivacyPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-24">
      <DraftBanner />
      <PrivacyContent />
    </section>
  )
}
