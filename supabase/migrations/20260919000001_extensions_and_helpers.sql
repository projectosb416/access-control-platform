-- ============================================================================
-- Migration 0001: Extensions and helper functions
-- ============================================================================
-- Purpose:
--   Establish the foundational building blocks every subsequent migration
--   depends on: extensions, the uuidv7() primary-key generator, and the
--   set_updated_at() trigger function.
--
--   No business tables are created here. Business tables begin in 0002.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensions
-- ----------------------------------------------------------------------------

-- pgcrypto: provides gen_random_bytes() (used by uuidv7)
-- Supabase installs extensions into the `extensions` schema by default.
create extension if not exists "pgcrypto" with schema extensions;

-- ----------------------------------------------------------------------------
-- 2. uuidv7() — time-ordered UUIDs (RFC 9562)
-- ----------------------------------------------------------------------------
-- Why v7 and not v4:
--   v4 UUIDs are random. Every insert scatters across the primary-key B-tree,
--   degrading index locality as tables grow (access_events will grow large).
--   v7 embeds a 48-bit millisecond timestamp at the front, so successive
--   inserts land near each other in the index.
--
--   v7 also avoids the "sequential ID leaks record counts" problem of bigint.
--
-- Layout (128 bits):
--   bytes 0-5   : 48-bit Unix timestamp in milliseconds
--   byte  6     : 4-bit version (0111) + 4 bits of rand_a
--   byte  7     : 8 bits of rand_a
--   byte  8     : 2-bit variant (10) + 6 bits of rand_b
--   bytes 9-15  : 56 bits of rand_b

create or replace function public.uuidv7()
returns uuid
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  ts_ms bigint;
  unix_ts_ms bytea;
  rand_bytes bytea;
  uuid_bytes bytea;
  b6 int;
  b8 int;
begin
  -- Milliseconds since Unix epoch
  ts_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- 48-bit timestamp in 6 bytes (big-endian, lower 6 bytes of int8)
  unix_ts_ms := substring(int8send(ts_ms) from 3);

  -- 80 bits (10 bytes) of randomness
  rand_bytes := gen_random_bytes(10);

  -- Concatenate: 6 + 10 = 16 bytes
  uuid_bytes := unix_ts_ms || rand_bytes;

  -- Set version field (upper 4 bits of byte 6) to 0111, keep lower 4 random
  b6 := (get_byte(uuid_bytes, 6) & 15) | 112;   -- 15 = 0x0F, 112 = 0x70
  uuid_bytes := set_byte(uuid_bytes, 6, b6);

  -- Set variant field (upper 2 bits of byte 8) to 10, keep lower 6 random
  b8 := (get_byte(uuid_bytes, 8) & 63) | 128;   -- 63 = 0x3F, 128 = 0x80
  uuid_bytes := set_byte(uuid_bytes, 8, b8);

  return encode(uuid_bytes, 'hex')::uuid;
end;
$$;

comment on function public.uuidv7() is
  'Time-ordered UUIDv7 (RFC 9562). Use as default for all primary keys.';

-- ----------------------------------------------------------------------------
-- 3. set_updated_at() — trigger function for updated_at columns
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: sets updated_at = now() on every row update.';
