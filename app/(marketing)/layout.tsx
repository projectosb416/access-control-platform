import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

/**
 * Marketing layout — wraps the public landing surface at `/`.
 *
 * Route group `(marketing)` does not appear in the URL. The page
 * inside renders at `/`, replacing the previous placeholder
 * app/page.tsx (deleted in Task W).
 *
 * Contains the marketing nav (logo + primary CTA + sign in) and the
 * footer (legal placeholder links). Product surfaces (/admin,
 * /resident, /platform, /guard) have their own layouts and are not
 * affected.
 *
 * Interactivity (mobile menu, dropdown) lands in a later step if
 * needed. For now: plain links, sticky header, backdrop blur.
 */

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link
            href="/"
            className="text-base font-semibold tracking-tight"
          >
            e-shomer
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/admin/login"
              className="text-muted-foreground hover:text-foreground hidden text-sm transition-colors sm:inline"
            >
              Sign in
            </Link>
            <Link
              href="/admin/signup"
              className={buttonVariants({ size: 'sm' })}
            >
              Create estate
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 e-shomer. All rights reserved.</p>
          <nav className="flex gap-4">
            <Link
              href="/legal/privacy"
              className="hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/legal/terms"
              className="hover:text-foreground transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/legal/cookies"
              className="hover:text-foreground transition-colors"
            >
              Cookies
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
