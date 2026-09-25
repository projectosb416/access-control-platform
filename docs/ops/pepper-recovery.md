# Pepper Recovery Procedure

**Audience:** whoever needs to recover the PIN pepper in an emergency.
Written for a non-technical reader. Keep a printed copy with the paper
backup.

**This document is intentionally not secret.** It describes how to find
and use the pepper. It never contains the pepper itself.

---

## What the pepper is

The pepper is a 64-character hexadecimal string (only digits 0-9 and
letters a-f). It protects every PIN ever issued on the Access Control
Platform. Without it, no PIN can be verified.

Example of the shape (not the real value):

    4a7f2c9e8b1d6f3a5c8e2b9d4f7a1c6e3b8d5f2a9c4e7b1d6f3a8c5e2b9d4f7a

It looks random because it is.

---

## Where the pepper is stored

Four locations, in order of accessibility:

1. **Primary user's Bitwarden vault** — entry name: `ACCESS CONTROL — PIN_PEPPER`
2. **Primary user's phone notes app** — search for `PIN_PEPPER`
3. **Paper copy** — sealed envelope, held by the primary user or at a
   designated physical location
4. **Cloudflare Worker secret** — inaccessible without Cloudflare
   dashboard access; this is where the running platform reads it from

**GitHub Secrets** also holds the value under the name `PIN_PEPPER`. CI
injects it into the Cloudflare Worker on every deploy.

---

## When to use this procedure

Open the paper envelope and read this document if ANY of these is true:

- The primary user is unreachable for more than 7 days AND the platform
  is failing to process PINs
- The platform is scheduled to be transferred to a new operator
- The pepper needs to be rotated for security reasons
- Cloudflare and GitHub accounts are both inaccessible and the pepper
  must be restored from an independent source

**Do not open the envelope** if the primary user is simply away for a
few days, or if the platform is working normally. The pepper never
needs to be read for routine operations.

---

## How to recover the pepper

1. **Open the paper envelope.** The pepper is written on the card inside.
2. **Cross-check with Bitwarden** if the primary user's device is
   available: unlock Bitwarden, open the entry `ACCESS CONTROL —
   PIN_PEPPER`, compare the two values. They must match exactly.
3. **If they match** — the pepper is confirmed. Use it as instructed
   below.
4. **If they don't match** — STOP. Do not proceed. The recovery envelope
   may be out of date, or the Bitwarden entry may have been altered.
   Contact the backup contact (below) before using either value.

---

## What to do with the pepper once recovered

The pepper is used to verify PINs. It is set in two places:

- **GitHub Secrets** (name: `PIN_PEPPER`) — used by CI to inject into
  the Worker
- **Cloudflare Worker secret** (name: `PIN_PEPPER`) — read by the running
  platform

To set it: paste the value into each location. Never paste it into chat,
email, SMS, or any messaging app.

The Cloudflare Worker secret is updated automatically on the next deploy
after the GitHub secret is changed.

---

## Rotating the pepper (for advanced recovery)

Rotating the pepper means generating a new one and re-hashing all
existing credentials. **This is a separate procedure that must not be
attempted without the primary user.** Rotating the pepper breaks every
PIN issued under the previous pepper. Every credential must be reissued.

Do not rotate as a routine recovery step. Only rotate if the pepper is
known to be compromised.

---

## Backup contact

Name: ___________________ (fill in by hand)

Phone: __________________ (fill in by hand)

If you cannot reach the primary user and have recovered the pepper,
contact this person before taking any action with it.

---

## After recovery

Once the pepper has been used or restored:

1. Re-seal the paper copy in a new envelope
2. Update the Bitwarden entry if it was found to be incorrect
3. Record the event: date, reason, who performed the recovery
4. Notify the primary user if they were simply unreachable

---

## A note on trust

The pepper alone does not give access to the platform. An attacker with
the pepper still needs database access to make use of it. But the
combination of the pepper and a database dump allows offline PIN
brute-forcing — so the pepper is treated as a high-value secret.

If the paper copy is ever lost, compromised, or suspected of exposure,
the pepper must be rotated. See "Rotating the pepper" above.

---

**End of procedure.**
