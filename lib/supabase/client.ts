import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side Supabase client.
 *
 * Uses only NEXT_PUBLIC_* env vars. Every call is subject to RLS.
 * The service-role key must NEVER be reachable from this file or its callers.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
