import type { Metadata } from 'next'
import { DraftBanner } from '../_components/draft-banner'
import { TermsContent } from '../_content/terms'

export const metadata: Metadata = {
  title: 'Terms of Service — e-shomer',
  description:
    'The terms governing use of the e-shomer access control platform.',
}

export default function TermsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-24">
      <DraftBanner />
      <TermsContent />
    </section>
  )
}
