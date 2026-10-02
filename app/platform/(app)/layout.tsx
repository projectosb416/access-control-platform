import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PlatformNav } from './nav'

/**
 * Platform owner application shell.
 *
 * Wraps every page inside /platform that requires platform-admin
 * access. Pages outside this group — /platform/login — are not
 * wrapped, so the shell does not appear on them.
 *
 * Auth gate:
 *   - No session          → /platform/login
 *   - Session, no grant   → /platform/login (silent kick)
 *   - Session + grant     → render nav + page
 *
 * The "no grant" case is not distinguished from "no session" in the
 * redirect target — an org-only admin who signs in at /platform/login
 * would succeed at auth, land here, fail the platform-admin check, and
 * be redirected back. That's intentional: the surface should feel
 * closed to anyone who isn't a platform admin, without leaking
 * whether their credentials were valid.
 *
 * is_platform_admin() is SECURITY DEFINER and stable (migration 0004),
 * fails closed when the caller has no row in platform_admins.
 */

export default async function PlatformAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/platform/login')
  }

  const { data: isAdmin, error } = await supabase.rpc('is_platform_admin')

  if (error || !isAdmin) {
    redirect('/platform/login')
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <PlatformNav />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}
