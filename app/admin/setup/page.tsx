import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SetupWizard } from './wizard'

/**
 * /admin/setup — Server Component wrapper.
 *
 * Checks the Supabase auth session before rendering the wizard. If not
 * signed in, redirects to login. The wizard itself is a Client Component
 * because it holds multi-step state in memory.
 */

export default async function SetupPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  // Guard against creating a second organization. An admin who already
  // has an active membership should not be able to reach the wizard —
  // setup_organization would create a second org under the same account,
  // splitting their data across two tenants. Mirror of the reverse
  // check in /admin/page.tsx (which redirects to /admin/setup when
  // there is no membership). Closes known-issue #11.
  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (membership) {
    redirect('/admin')
  }

  return <SetupWizard />
}
