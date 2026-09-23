import 'server-only'

import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS entirely. Must only be used for operations that have already
 * enforced tenant scope themselves, or that call SECURITY DEFINER functions
 * which enforce it internally.
 *
 * This file is protected by `import 'server-only'` — the Next.js build will
 * fail if any client component tries to import it, so the service-role key
 * can never reach the browser bundle.
 *
 * See docs/phase-7/supabase-clients.md for the full boundary rules.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createClient(url, key, {
    auth: {
      // No session management — this client represents the system,
      // not a logged-in user. Every request is stateless.
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
