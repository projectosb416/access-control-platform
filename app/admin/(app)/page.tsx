import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'
import { CommandCenter } from './command-center'
import { CommandCenterLive } from './command-center-live'
import { STALE_SESSION_HOURS } from '@/lib/admin/sessions'

/**
 * /admin — state-aware landing page.
 *
 * Active orgs:       Command Center — static operational panels.
 * Provisioning:      route to plan selection.
 * Suspended/other:   contact-support state.
 *
 * The split matters. An active org's admin needs operational awareness
 * ("what needs attention right now?"). A suspended org's admin needs
 * direction, not a Command Center full of zeros that implies things are
 * running when they aren't.
 */

export default async function AdminHomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id, role')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!membership) {
    redirect('/admin/setup')
  }

  const organizationId = membership.organization_id as string

  const { data: org } = await supabase
    .from('organizations')
    .select('id, display_name, organization_type, status')
    .eq('id', organizationId)
    .single()

  const orgName = org?.display_name ?? 'Your organization'
  const orgStatus = org?.status ?? 'unknown'

  // ---------------------------------------------------------------------
  // Active — Command Center owns its own data, including the attention
  // banner (which queries stale sessions internally).
  // ---------------------------------------------------------------------
  if (orgStatus === 'active') {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
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

        <CommandCenterLive organizationId={organizationId}>
          <CommandCenter organizationId={organizationId} />
        </CommandCenterLive>
      </div>
    )
  }

  // ---------------------------------------------------------------------
  // Non-operational — state-routing experience.
  // ---------------------------------------------------------------------

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const staleThresholdIso = new Date(
    nowMs - STALE_SESSION_HOURS * 60 * 60 * 1000,
  ).toISOString()

  const { count: staleCount } = await supabase
    .from('access_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('status', 'open')
    .lt('entered_at', staleThresholdIso)

  const showAttention = (staleCount ?? 0) > 0

  let nextStepTitle: string
  let nextStepBody: string
  if (orgStatus === 'provisioning') {
    nextStepTitle = 'Choose a plan to continue'
    nextStepBody =
      'Your organization is created. Select a subscription plan to unlock gate operations.'
  } else if (orgStatus === 'suspended') {
    nextStepTitle = 'Organization suspended'
    nextStepBody = 'Your organization is suspended. Please contact support.'
  } else {
    nextStepTitle = 'Status: ' + orgStatus
    nextStepBody = 'Please contact support if this is unexpected.'
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
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

      {showAttention ? (
        <section className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-5">
          <h2 className="text-base font-medium text-amber-900 dark:text-amber-200">
            {staleCount} session{staleCount === 1 ? ' needs' : 's need'} attention
          </h2>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
            Visitors entered more than {STALE_SESSION_HOURS} hours ago and no
            exit was recorded.
          </p>
          <Link
            href="/admin/activity?filter=attention"
            className="mt-3 inline-block text-sm font-medium text-amber-900 underline underline-offset-4 dark:text-amber-200"
          >
            Review →
          </Link>
        </section>
      ) : null}

      <section className="bg-muted/40 rounded-lg border p-6">
        <h2 className="mb-2 text-base font-medium">{nextStepTitle}</h2>
        <p className="text-muted-foreground text-sm">{nextStepBody}</p>
      </section>
    </div>
  )
}
