import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-side Supabase client, bound to the request's auth cookies.
 *
 * Runs with the anon key + user session, so RLS still applies.
 * This is NOT a service-role client — privileged operations live behind
 * a separate, server-only code path (see Phase 4 Security & RLS doc, §3).
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components cannot always set cookies. Ignoring is
            // correct here — session refresh happens in middleware.
          }
        },
      },
    },
  )
}
