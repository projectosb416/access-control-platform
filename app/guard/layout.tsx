import type { Metadata, Viewport } from 'next'

/**
 * Guard — Handheld device class shell.
 *
 * Wraps every /guard/* route. Composition rules per
 * docs/phase-8/device-classes.md, section "Composition rules — Handheld":
 *   - Constrained width so wide screens don't stretch the phone layout
 *   - Full viewport height (bottom-anchored actions stay anchored)
 *   - Safe area insets for notches and gesture bars
 *   - No overscroll bounce / pull-to-refresh
 *   - No text selection (guards tap; they don't select)
 *   - Background and foreground from theme tokens
 *
 * This layout does NOT set fonts, navigation, or page chrome — those belong
 * to individual pages. The shell exists to guarantee the phone-shaped frame
 * is consistent across every guard route.
 */

export const metadata: Metadata = {
  title: 'Guard — Access Control',
  // Guard routes are not public. Prevent indexing.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Prevents iOS auto-zoom when focusing inputs.
  maximumScale: 1,
  // Match the phone chrome (status bar / nav bar) to the app background.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function GuardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      className={[
        // Phone-shaped frame, centered on wider screens during dev.
        'mx-auto flex w-full max-w-[480px] flex-col',
        // Fill the viewport height so bottom-anchored elements stay at bottom.
        'min-h-[100dvh]',
        // Respect device safe areas (notch, home indicator, gesture bar).
        'pt-[env(safe-area-inset-top)]',
        'pb-[env(safe-area-inset-bottom)]',
        'pl-[env(safe-area-inset-left)]',
        'pr-[env(safe-area-inset-right)]',
        // Prevent pull-to-refresh and rubber-band scroll.
        'overscroll-none',
        // Theme tokens — light/dark follow the phone's setting.
        'bg-background text-foreground',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
