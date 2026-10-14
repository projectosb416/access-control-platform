import type { Metadata } from 'next'
import { DraftBanner } from '../_components/draft-banner'
import { RefundsContent } from '../_content/refunds'

export const metadata: Metadata = {
  title: 'Refund Policy — e-shomer',
  description:
    'When subscription refunds are issued, how to request one, and how refunds are paid.',
}

export default function RefundsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-24">
      <DraftBanner />
      <RefundsContent />
    </section>
  )
}
