# Supabase Clients

Browser and server Supabase client factories live here.

Status as of Phase 6.2a: folder reserved. Client stubs arrive in Phase 6.2d.

Rules that apply when this folder is implemented:
- The service-role key is NEVER used in any client that can reach the browser.
- Browser client uses only NEXT_PUBLIC_* keys and is subject to RLS.
- Server client uses the anon key with cookie-bound auth; privileged operations go through
  server-only code paths (see Phase 4 Security & RLS doc, §3).
