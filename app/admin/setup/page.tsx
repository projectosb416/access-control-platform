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

  return <SetupWizard />
}
