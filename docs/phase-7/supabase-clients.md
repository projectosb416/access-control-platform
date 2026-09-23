# Supabase Client Boundary

**Rule:** every Worker code path uses one of two Supabase clients. Choosing
the wrong one is a security bug, not a style preference.

## The two clients

| Client | Key used | RLS | Who it represents |
|---|---|---|---|
| **User** | anon key + user's JWT | Enforced | The logged-in account |
| **Service** | service-role key | Bypassed | The system |

## Locations


## Which to use for what

### Use the User client (server.ts) when:

- The action is performed **by** a logged-in user
- RLS should filter the result to what that user can see
- The action calls a Postgres function that uses `auth.uid()` or `current_account_id()`
- Examples: `setup_organization`, listing own authorizations, viewing own notifications

### Use the Service client (service.ts) when:

- The action is performed **by the system**, on behalf of the platform
- RLS would block the query (e.g., reading `access_credentials`, which has no policies)
- The action calls a SECURITY DEFINER function that itself enforces all checks
- Examples: PIN lookup, PIN verification, rate limiting, writing `access_events`, calling `evaluate_entry`

### Ambiguous cases

Some functions are SECURITY DEFINER and self-enforce permissions. They work
with either client — RLS is bypassed inside them regardless. The rule of thumb:

- If the entry point is a **user click** -> User client
- If the entry point is a **system event** (device retry, background job, webhook) -> Service client

When in doubt, use the User client. If a query fails under RLS that should
have succeeded, that is a signal to add an explicit policy, not to switch to
service role.

## Hard rule — never mix

- **Never** use the service client in a route that renders to a browser.
- **Never** return service-client results to a client component without
  stripping secrets first.
- **Never** pass the service-role key into a `NEXT_PUBLIC_` environment variable.
- **Never** log the service-role key.

## Enforcement at build time

`lib/supabase/service.ts` starts with:


This makes it impossible to accidentally import the service client from a
client component. The Next.js build fails with a clear error if anyone tries.

## Common mistakes to avoid

| Mistake | Result | Fix |
|---|---|---|
| Using the service client to render a user's dashboard | Every user sees every org's data | Use `server.ts` |
| Using the user client to look up an `access_credentials` row | Returns 0 rows (RLS) — you'll think the credential doesn't exist | Use `service.ts` |
| Assuming SECURITY DEFINER means "no checks" | Writing a definer function that skips validation | Always enforce permission inside the function |
| Passing anon key to the service client | Fails silently; RLS denies most writes | Use `SUPABASE_SERVICE_ROLE_KEY` env var |

## Environment variables

| Variable | Used by | Visible to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server clients | Yes (by design) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server clients | Yes (by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | service client | **No — Worker secret only** |

The service-role key lives only as a Cloudflare Worker secret, set by the
`deploy-main-app` CI job. It is not baked into the client bundle.

## Cross-tenant safety — the deepest rule

RLS is what prevents cross-tenant leaks. Any code path that uses the service
client bypasses RLS and therefore MUST enforce tenant scope itself:

- Query on `organization_id = <the caller's org>` explicitly
- Validate that every referenced id belongs to the same org
- Never trust an `id` alone — always check the org

SECURITY DEFINER functions in our schema already follow this — every one of
them takes `p_organization_id` as a parameter and validates membership.
Application code using the service client must do the same.
