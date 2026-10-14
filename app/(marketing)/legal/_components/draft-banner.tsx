import { LEGAL_DRAFT } from '@/lib/legal/version'

/**
 * Non-production-facing banner shown at the top of every /legal page
 * while LEGAL_DRAFT is true in lib/legal/version.ts.
 *
 * Server Component. No client interactivity. Rendering is conditional
 * on the constant, so once the flag flips the banner stops appearing
 * on staging AND production together — the intended behaviour.
 */

export function DraftBanner() {
  if (!LEGAL_DRAFT) return null
  return (
    <div className="border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 mx-auto mb-8 w-full max-w-4xl rounded-md border px-4 py-3 text-sm">
      <strong className="font-medium">Draft — pending legal review.</strong>{' '}
      This document has not been reviewed by a qualified lawyer and is
      subject to change before it takes effect.
    </div>
  )
}
