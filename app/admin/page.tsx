import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'

/**
 * /admin — state-aware landing page for the admin.
 *
 * Routes the admin to where they need to be based on onboarding state:
 *   - No auth session          → /admin/login
 *   - No active membership     → /admin/setup
 *   - Membership, provisioning → dashboard + "choose plan" prompt
 *   - Membership, active       → dashboard + "Command Center coming soon"
 *
 * As items 3+ are built, this page gains the plan-selection flow and
 * eventually the real Command Center.
 */

export default async function AdminHomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  // RLS scopes this to the caller's own memberships.
  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id, role')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!membership) {
    // Signed in but no org yet. Send to the setup wizard.
    redirect('/admin/setup')
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('id, display_name, organization_type, status')
    .eq('id', membership.organization_id)
    .single()

  const orgName = org?.display_name ?? 'Your organization'
  const orgStatus = org?.status ?? 'unknown'

  let nextStepTitle: string
  let nextStepBody: string
  if (orgStatus === 'provisioning') {
    nextStepTitle = 'Choose a plan to continue'
    nextStepBody =
      'Your organization is created. Select a subscription plan to unlock gate operations.'
  } else if (orgStatus === 'active') {
    nextStepTitle = 'Command Center coming soon'
    nextStepBody =
      'Your organization is active. The dashboard is under construction.'
  } else if (orgStatus === 'suspended') {
    nextStepTitle = 'Organization suspended'
    nextStepBody =
      'Your organization is suspended. Please contact support.'
  } else {
    nextStepTitle = 'Status: ' + orgStatus
    nextStepBody = 'Please contact support if this is unexpected.'
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {orgName}
          </h1>
          <p className="text-muted-foreground mt-1 truncate text-sm">
            Signed in as {user.email}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="bg-muted/40 rounded-lg border p-6">
        <h2 className="mb-2 text-base font-medium">{nextStepTitle}</h2>
        <p className="text-muted-foreground text-sm">{nextStepBody}</p>
      </section>
    </main>
  )
}
