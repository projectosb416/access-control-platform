import type { Metadata, Viewport } from 'next'

/**
 * Admin shell — Handheld + Desk device classes.
 *
 * Per docs/phase-8/device-classes.md the Admin works across two contexts:
 *   Handheld — support-desk mode, phone in hand
 *   Desk     — operations mode, laptop with mouse/keyboard
 *
 * This layout is intentionally minimal at this stage: it sets the viewport,
 * theme, and a full-height container. Navigation, sidebar, and page chrome
 * are added when there's more than one page to navigate between.
 *
 * Not a Wall surface — that's an ambient status display, separate route.
 */

export const metadata: Metadata = {
  title: 'Admin — Access Control',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-background text-foreground flex min-h-[100dvh] flex-col">
      {children}
    </div>
  )
}
