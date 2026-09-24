#!/usr/bin/env bash
#
# Smoke test the deployed Worker.
#
# Four requests, all read-only or fail-only. No fixture, no credential, no
# database writes. Fast (~3 seconds). Confirms the deployed Worker is
# routing correctly and reaching Supabase.
#
# Usage:
#   bash scripts/smoke-test-deployed.sh https://access-control-platform.projectosb416.workers.dev
#
# Exit 0 if all checks pass. Exit 1 with the failing check on error.
#
# Runs in CI after deploy-main-app. Also runnable locally after a deploy
# to confirm without waiting for the CI pipeline.

set -uo pipefail

WORKER_URL="${1:-}"
if [ -z "$WORKER_URL" ]; then
  echo "Usage: $0 <worker_url>" >&2
  echo "Example: $0 https://access-control-platform.projectosb416.workers.dev" >&2
  exit 1
fi

# Trim trailing slash if present.
WORKER_URL="${WORKER_URL%/}"

echo "Smoke testing: $WORKER_URL"
echo

pass=0
fail=0

# ---------------------------------------------------------------------------
# check: run a curl against the Worker, compare HTTP status to expected.
# ---------------------------------------------------------------------------
check() {
  local description="$1"
  local expected="$2"
  local method="$3"
  local path="$4"
  local body="${5:-}"
  local cookie="${6:-}"

  local curl_args=(-sS --max-time 10 -o /dev/null -w "%{http_code}" -X "$method")

  if [ -n "$body" ]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi

  if [ -n "$cookie" ]; then
    curl_args+=(-H "Cookie: $cookie")
  fi

  local actual
  actual=$(curl "${curl_args[@]}" "$WORKER_URL$path" 2>/dev/null || echo "000")

  if [ "$actual" = "$expected" ]; then
    echo "PASS: $description (expected $expected, got $actual)"
    pass=$((pass + 1))
  else
    echo "FAIL: $description (expected $expected, got $actual)"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# The checks.
# ---------------------------------------------------------------------------

check "guard-session/start rejects empty body" \
  400 POST "/api/guard-session/start" "{}"

check "guard/entry rejects missing cookie" \
  401 POST "/api/guard/entry" '{"pin":"123456"}'

check "guard/entry rejects invalid cookie" \
  401 POST "/api/guard/entry" '{"pin":"123456"}' "shift_session=not-a-real-token"

check "removed diagnostic endpoint stays removed" \
  404 GET "/api/diag/pepper"

# ---------------------------------------------------------------------------
# Summary.
# ---------------------------------------------------------------------------

echo
echo "Passed: $pass, Failed: $fail"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
