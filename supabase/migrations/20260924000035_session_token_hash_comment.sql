-- ============================================================================
-- Migration 0035: document the session token hash choice
-- ============================================================================
-- Purpose:
--   session_token_hash uses SHA-256, not PBKDF2. That is correct, and it
--   was a deliberate decision — but it was implicit. Someone reviewing the
--   schema later could reasonably think SHA-256 was chosen by oversight and
--   "fix" it to PBKDF2, adding ~100ms of latency to every guard request
--   for no security gain.
--
--   This migration replaces the terse comments from migration 0029 with
--   ones that state the reasoning. No schema change — comments only.
--
-- Why SHA-256 is correct here:
--   The raw token is 32 bytes from crypto.getRandomValues — 256 bits of
--   entropy. Unlike a 6-digit PIN (1,000,000 combinations, brute-forceable
--   offline), there is nothing to brute-force here. The only property we
--   need is irreversibility, which SHA-256 provides. A fast hash is right.
--
--   PBKDF2 exists to slow down brute force of low-entropy inputs. With no
--   low-entropy input, it adds cost without defense.
-- ============================================================================

comment on column public.shift_sessions.session_token_hash is
  'SHA-256 hex of the raw guard session token. Raw token never stored. SHA-256 (not PBKDF2) is correct: the token is 32 random bytes, not a 6-digit PIN — nothing to brute-force. See docs/phase-7/guard-auth-model.md.';

comment on column public.shift_sessions.session_token_issued_at is
  'When the current token was issued. Updated on idempotent re-auth (same shift, new device, or device wipe).';
