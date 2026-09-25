# Production Migrations — Environment Strategy

**Status:** policy document. Written before the first production migration
touches the production Supabase project.

## The principle

Production data is not staging data. A migration that runs cleanly on empty
staging tables may behave differently against production rows. Staging gets
migrations automatically; production does not.

## The three environments

| Environment | Supabase project | Migration trigger | Data |
|---|---|---|---|
| Local | none | n/a | none |
| Staging | access-control-platform-staging | CI on push to main | test data, disposable |
| Production | access-control-platform-production (to be created) | Manual approval + CI | real customer data, permanent |

## Production migration workflow

1. Developer pushes to main. CI runs all checks including staging migration.
2. If staging is green, a separate apply-migrations-production job queues.
3. The job is gated by a GitHub Environment named production with a required reviewer.
4. Reviewer inspects the migration files and the staging result.
5. On approval, the job runs:
   - Backup production (logical dump)
   - Apply migrations via supabase db push
   - Verify with a smoke query
6. On failure at any step, the job stops. No partial application.

## Backup before every production migration

Before any production migration runs, take a logical backup:

    supabase db dump --db-url "$PRODUCTION_DB_URL" -f backup-$(date +%Y%m%d-%H%M%S).sql

Store the backup somewhere durable, not on the CI runner:

- GitHub Actions artifact (90-day retention by default) — for the first iteration
- Cloudflare R2 bucket — later, with lifecycle policies

## Rollback path

Migrations are forward-only. If a production migration fails to apply cleanly,
the options are:

Option A — Compensating migration. A new migration that reverses the previous
one. Preferred for additive changes (DROP TABLE, DROP FUNCTION).

Option B — Restore from backup. Destructive. All data written after the
backup is lost. Use only when Option A is not feasible.

Default policy: Option A. Option B is a last resort.

## Initial seed data

Before the production project is live, seed:

1. Plans — the actual price catalog
2. Plan entitlements — what each plan unlocks
3. No customers, no organizations, no test data

Staging has test data. Production starts empty except for the catalog.

## First production migration

The first time we push to production, we apply all migrations from the
repository in order. supabase db push handles this — it applies any migration
not yet recorded in supabase_migrations.schema_migrations.

Before that first push:

1. The production project exists and is linked
2. The backup process is verified on staging first
3. The GitHub Environment production is configured with a required reviewer
4. The CI job apply-migrations-production is written and reviewed

## What this doc does NOT cover

- Data residency — Phase 11
- Multi-region — Phase 11
- Encryption at rest — Supabase default
- Access control on the production project — user-managed via Supabase dashboard

## Decisions before first production migration

1. Backup retention: default 90 days via GitHub Actions artifacts.
2. Who approves production migrations: single reviewer for now.
3. Can production migrations be triggered outside CI: no. All production migrations go through CI.
