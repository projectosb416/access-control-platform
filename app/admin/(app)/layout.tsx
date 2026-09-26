import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Nav } from './nav'

/**
 * Admin application shell.
 *
 * Wraps every page inside /admin that requires authentication and an
 * existing organization. Pages outside this group — /admin/login,
 * /admin/signup, /admin/setup — are not wrapped, so the shell does not
 * appear on them.
 *
 * Auth gate:
 *   - No session              → /admin/login
 *   - Session, no membership  → /admin/setup
 *   - Session + membership    → render nav + page
 *
 * Per docs/phase-8/device-classes.md, admin works on Handheld and Desk:
 *   Desktop  → persistent left sidebar (240px)
 *   Mobile   → fixed bottom bar
 * Same component, different chrome at the lg: breakpoint.
 */

export default async function AdminAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!membership) {
    redirect('/admin/setup')
  }

  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      <Nav />
      <main className="flex flex-1 flex-col pb-20 lg:pb-0">{children}</main>
    </div>
  )
}
