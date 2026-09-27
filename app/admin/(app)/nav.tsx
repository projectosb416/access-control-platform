'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  DoorOpen,
  ShieldCheck,
  Clock,
  Activity,
  Building2,
  MapPin,
  MoreHorizontal,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Admin navigation.
 *
 * Desktop (lg+): persistent left sidebar, all items visible.
 * Mobile:        5 primary items in bottom bar + More overflow sheet.
 *
 * Primary (daily use): Home, Gates, Guards, Shifts, and the current active
 * secondary item if the admin is inside one — otherwise More.
 *
 * More sheet (mobile only): Units, Properties, Activity. Slides up from the
 * bottom. Tapping a row navigates and closes.
 */

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

const PRIMARY: NavItem[] = [
  { href: '/admin', label: 'Home', icon: LayoutDashboard },
  { href: '/admin/gates', label: 'Gates', icon: DoorOpen },
  { href: '/admin/guards', label: 'Guards', icon: ShieldCheck },
  { href: '/admin/shifts', label: 'Shifts', icon: Clock },
]

const SECONDARY: NavItem[] = [
  { href: '/admin/units', label: 'Units', icon: Building2 },
  { href: '/admin/properties', label: 'Properties', icon: MapPin },
  { href: '/admin/activity', label: 'Activity', icon: Activity },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(href + '/')
}

export function Nav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  // If the current route is a secondary page, highlight the More button
  // instead of leaving the bar with no active item.
  const insideSecondary = SECONDARY.some((item) => isActive(pathname, item.href))

  return (
    <>
      {/* Desktop sidebar — all items visible */}
      <aside className="bg-muted/30 hidden shrink-0 border-r lg:flex lg:w-60 lg:flex-col">
        <div className="border-b px-5 py-4">
          <span className="text-sm font-semibold tracking-tight">
            Access Control
          </span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {PRIMARY.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <div className="bg-border my-2 h-px" aria-hidden />
          {SECONDARY.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </nav>
      </aside>

      {/* Mobile bottom bar */}
      <nav
        className="bg-background fixed inset-x-0 bottom-0 z-50 flex border-t lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {PRIMARY.map((item) => (
          <BottomBarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More options"
          className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
            insideSecondary ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      {/* Mobile More sheet */}
      {moreOpen ? (
        <div
          className="fixed inset-0 z-[60] lg:hidden"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            className="bg-background absolute inset-x-0 bottom-0 rounded-t-2xl border-t shadow-lg"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex items-center justify-between border-b px-5 py-3">
              <span className="text-sm font-semibold tracking-tight">
                More
              </span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col py-2">
              {SECONDARY.map((item) => {
                const Icon = item.icon
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-4 px-5 py-3.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  )
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Link
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
}

function BottomBarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
        active ? 'text-foreground' : 'text-muted-foreground'
      }`}
    >
      <Icon className="h-5 w-5" />
      {item.label}
    </Link>
  )
}
