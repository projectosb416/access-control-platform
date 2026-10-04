import Link from 'next/link'
import { LogoutButton } from './logout-button'

/**
 * Platform owner nav.
 *
 * Deliberately minimal for v1 — a header bar, not a sidebar. Two
 * destinations now (Dashboard, Audit) plus sign out. When more
 * platform surfaces ship (per-org drill-down, revenue reports, etc.),
 * this evolves into the same sidebar/bottom-bar pattern the admin
 * surface uses, and gains active-state highlighting.
 */

export function PlatformNav() {
  return (
    <header className="bg-background sticky top-0 z-40 border-b">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link
          href="/platform"
          className="flex items-baseline gap-2 text-sm font-semibold tracking-tight"
        >
          <span>Access Control</span>
          <span className="text-muted-foreground text-xs font-normal uppercase tracking-wide">
            Platform
          </span>
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href="/platform/audit"
            className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
          >
            Audit
          </Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  )
}
