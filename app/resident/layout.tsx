import type { Metadata, Viewport } from 'next'

/**
 * Resident shell — Handheld device class only (per docs/phase-8/device-classes.md).
 *
 * Mirrors the guard shell: phone-shaped frame, safe areas, no overscroll,
 * theme tokens. No navigation chrome yet — added when the dashboard has
 * multiple sections.
 */

export const metadata: Metadata = {
  title: 'Resident — Access Control',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function ResidentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      className={[
        'mx-auto flex w-full max-w-[480px] flex-col',
        'min-h-[100dvh]',
        'pt-[env(safe-area-inset-top)]',
        'pb-[env(safe-area-inset-bottom)]',
        'pl-[env(safe-area-inset-left)]',
        'pr-[env(safe-area-inset-right)]',
        'overscroll-none',
        'bg-background text-foreground',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
