import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'

/**
 * /admin — placeholder dashboard.
 *
 * Server Component. Reads the Supabase auth session from the request
 * cookies. If unauthenticated, redirects to /admin/login.
 *
 * This is deliberately a placeholder. The real Command Center is a later
 * Admin-lite item. Right now this page exists to:
 *   1. Prove the login → redirect → authenticated page flow works.
 *   2. Give a target for the signup and login redirects.
 *   3. Provide the logout affordance.
 */

export default async function AdminHomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Admin dashboard
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Signed in as {user.email}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="bg-muted/40 rounded-lg border p-6">
        <p className="text-muted-foreground text-sm">
          Estate setup is not yet built. The next step is the setup wizard —
          create your property, add gates, add guards, and schedule your
          first shift.
        </p>
      </section>
    </main>
  )
}
