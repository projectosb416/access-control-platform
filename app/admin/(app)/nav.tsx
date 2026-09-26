'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, DoorOpen, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Admin navigation.
 *
 * Two chrome variants from one component:
 *   Desktop (lg+): persistent left sidebar, 240px
 *   Mobile:        fixed bottom bar, safe-area aware
 *
 * Current items: Dashboard, Gates, Guards. Room for five in the bottom
 * bar — promote to a "More" menu when we exceed that.
 */

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

const ITEMS: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/gates', label: 'Gates', icon: DoorOpen },
  { href: '/admin/guards', label: 'Guards', icon: ShieldCheck },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(href + '/')
}

export function Nav() {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="bg-muted/30 hidden shrink-0 border-r lg:flex lg:w-60 lg:flex-col">
        <div className="border-b px-5 py-4">
          <span className="text-sm font-semibold tracking-tight">
            Access Control
          </span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Mobile bottom bar */}
      <nav
        className="bg-background fixed inset-x-0 bottom-0 z-50 flex border-t lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
                active ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
