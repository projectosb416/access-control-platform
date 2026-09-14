# Supabase Clients

Browser and server Supabase client factories.

- `client.ts` — browser client, anon key, RLS-enforced.
- `server.ts` — server client, cookie-bound auth, anon key, RLS-enforced.

Rules that apply here:
- The service-role key is NEVER used in any client that can reach the browser.
- Browser client uses only NEXT_PUBLIC_* keys and is subject to RLS.
- Server client uses the anon key with cookie-bound auth; privileged operations go through
  server-only code paths (see Phase 4 Security & RLS doc, §3).

No service-role client exists in this folder. One will only be added behind an explicit
server-only boundary once Phase 4 (Security & RLS) is approved and Phase 5 schema lands.
