# Enhancements — Deferred Ideas

**Purpose:** feature ideas, polish suggestions, and third-party tools that
came up during development and were deliberately deferred. Each entry has
a target phase and a reason for the deferral, so nothing is lost and
nothing gets built ahead of its time.

Different from `known-issues.md`: those are bugs or gaps. These are
improvements — the product works without them, but it would be better
with them.

---

## E1 — Animated logo loading spinner

**Idea:** Use the platform logo mid-spin as the loading state during
route transitions and async operations.

**Suggested:** 2026-09-25
**Target phase:** Phase 9 (design polish) or Phase 10
**Reason deferred:** Needs the final logo first. Loading states exist
(skeleton, disabled buttons) but a branded spinner should wait for the
visual identity to be locked.

---

## E2 — Animated UI libraries (Particles Casberry, Aceternity UI)

**Idea:** Consider premium animated components and backgrounds for admin
dashboard polish and landing page. From a "Vibe Coding" list.

**Suggested:** 2026-09-25
**Target phase:** Phase 9 evaluation, Phase 11 landing page
**Reason deferred:** Bundle cost. We deploy to Cloudflare Workers with a
10MB limit. OpenNext + Sentry already consume some. Must be measured
against real bundle size before adopting. Particles specifically are
wrong for the guard UI — the guard interface needs clean, fast, distraction-free.
May suit the marketing landing page only.

---

## E3 — Brevo SMTP for email

**Idea:** Configure Brevo (or equivalent) as SMTP provider for Supabase
Auth. Enables email verification, password reset, and system notifications.
Free tier: 300 emails/day.

**Suggested:** 2026-09-26
**Target phase:** Phase 11 (before launch)
**Reason deferred:** Supabase's built-in email is rate-limited to ~2/hour
on free tier and documented as test-only. Admin signup currently uses
auto-confirm (verification OFF) as a workaround. Real SMTP belongs with
launch infrastructure.

---

## E4 — Guard login screen styling polish

**Idea:** The guard login form is functional but plain. Pass for visual
polish once the design system is defined.

**Suggested:** 2026-09-26
**Target phase:** Phase 9 (design polish pass)
**Reason deferred:** Design system (colors beyond tier, typography scale,
component density) is not yet locked. Polish should follow the system,
not lead it.

---

## E5 — Horizontal scrolling nav for admin (evaluated, not adopted)

**Idea:** Replace fixed bottom bar on mobile with horizontally scrollable
nav items, so unlimited items fit.

**Suggested:** 2026-09-26
**Target phase:** N/A — evaluated and rejected
**Reason:** Poor discoverability. Users don't know items exist off-screen.
Standard mobile patterns (fixed bar + "More" menu at 5+ items) are more
discoverable. Revisit only if usage data shows admins repeatedly missing
nav items.

---

## E6 — Bulk unit creation from setup wizard

**Idea:** Estate with 200 houses needs a way to import units in bulk, not
create them one at a time.

**Suggested:** during device-classes dialogue, implied
**Target phase:** Later Admin-lite item, when property/unit management is built
**Reason deferred:** Setup wizard currently creates one unit. Bulk creation
is a distinct feature with its own UX (CSV upload? range generator? preview?).
Handoff §9 already specifies "bulk creation, with preview before creation" —
it's in scope, just not for the first setup flow.

---

## How to add an enhancement

1. ID it (E1, E2, ...).
2. One-line idea.
3. When it was suggested and by whom (if relevant).
4. Target phase.
5. Reason deferred — should be specific ("needs final logo" not "later").

If a phase has no room for it, it goes to the next phase. Nothing is ever
removed — if an idea is definitively rejected, mark it as such with the
reason (see E5).
