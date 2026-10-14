'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ScrollText, Shield, Wallet } from 'lucide-react'
import { LogoutButton } from './logout-button'

/**
 * Platform owner nav.
 *
 * Header bar — not a sidebar. Three top-level destinations (Overview
 * via brand, Audit, Destinations) do not justify a w-60 sidebar; the
 * header carries icons and active-state highlighting instead. When
 * more platform surfaces ship (per-org nav entry, revenue reports,
 * settings), this graduates to the same sidebar/bottom-bar pattern
 * the admin surface uses.
 *
 * Client Component — usePathname drives the active state. The
 * surrounding layout (auth gate + main wrapper) remains a Server
 * Component.
 */

const LINKS = [
  { href: '/platform/audit', label: 'Audit', icon: ScrollText },
  { href: '/platform/payment-destinations', label: 'Destinations', icon: Wallet },
] as const

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

export function PlatformNav() {
  const pathname = usePathname()

  return (
    <header className="bg-background sticky top-0 z-40 border-b">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link
          href="/platform"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <Shield className="h-4 w-4" strokeWidth={2} />
          <span>Access Control</span>
          <span className="text-muted-foreground text-xs font-normal uppercase tracking-wide">
            Platform
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href)
            const Icon = link.icon
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ' +
                  (active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted')
                }
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                {link.label}
              </Link>
            )
          })}
          <LogoutButton />
        </nav>
      </div>
    </header>
  )
}
