// Temporary diagnostic — reports which env vars are visible to the Worker.
// Never returns secret values — only booleans and the public URL prefix.
// Deleted once we confirm the access pattern.

export const runtime = 'nodejs'

export async function GET() {
  return Response.json({
    has_supabase_url:         Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    has_supabase_anon_key:    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    has_service_role_key:     Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    has_pepper:               Boolean(process.env.PIN_PEPPER),
    supabase_url_prefix:      process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30) ?? null,
    node_env:                 process.env.NODE_ENV ?? null,
  })
}
