# Device Classes — Composition Rules

**Purpose:** replace "breakpoints" as the design primitive with "device
classes." A breakpoint is a pixel value. A class is a context of use —
who is looking at this screen, what they're doing, and how they interact
with it. Two apps can share a breakpoint and need entirely different
layouts because their classes differ.

This document defines the classes, the composition rules for each, and
the data contract each class expects. Phase 9's components are built
against these rules, not against pixel widths.

---

## The five classes

| Class | Devices | Context | Interaction |
|---|---|---|---|
| **Handheld** | Phones | Moving, one hand, outdoor or couch | Thumb, tap, gesture |
| **Tablet** | Tablets, large phones in landscape | Fixed position or two-handed | Tap, occasional gestures |
| **Desk** | Laptops, desktop monitors | Seated, focused, multi-tasking | Mouse, keyboard, hover |
| **Wall** | Large mounted displays | Ambient, glanceable, no user | None |
| **Embedded** | Reserved — v2 only | Non-human | Programmatic only |

**Four are built now. Embedded is reserved by name only.**

Why reserve Embedded: if we don't name it, every component built in
Phase 9 will assume Handheld / Tablet / Desk / Wall is the complete set.
When v2 adds non-human event sources (CCTV, sensors, integrations),
we'd have to retrofit every component to acknowledge a fifth class.
Reserving the name costs one line here.

---

## Journey × Class coverage

Not every role uses every class. This is deliberate.

| Role | Handheld | Tablet | Desk | Wall |
|---|---|---|---|---|
| Guard | primary | gatehouse | — | mounted display |
| Resident | primary | — | — | — |
| Admin | support-desk | — | primary work | ambient display |

**Two asymmetries worth noting:**

**Guard on Tablet vs Guard on Wall.** Tablet is the guard's working
device — they hold it, tap it, process entries on it. Wall is the
gatehouse-mounted screen — it shows status, nobody touches it. Same
person, different classes, different compositions.

**Admin on Handheld vs Admin on Desk.** Handheld is support-desk mode:
find a credential, fix it, close the app. Desk is operations mode:
review, configure, bulk edit. Same data, different densities.

---

## Composition rules — Handheld

**Context:** one hand, phone screen, often outdoors.

- **Bottom-anchored primary actions.** The "Confirm" / "Fix" / "Submit" button sits at thumb-reach, not at the top of a form.
- **Full-screen flows.** Multi-step operations replace the current view rather than opening a modal. Modals on phones are cramped.
- **Stacked information.** Cards stack vertically. No side-by-side comparisons.
- **Bottom navigation** (not top). Thumb-reach is the design constraint.
- **Large touch targets.** Minimum 44×44px. Guards tap with gloved or wet hands.
- **High contrast.** Outdoor sunlight washes out subtle grays.
- **No hover states.** Touch only.

---

## Composition rules — Tablet

**Context:** usually fixed position, two hands available.

- **Two-column layouts when content benefits.** Guard: PIN entry on one side, recent activity on the other. Resident: household list + activity feed side by side.
- **Modals over pages.** More screen real estate means modals don't feel cramped.
- **Top or side navigation.** Bottom nav is a phone convention; tablets work better with persistent navigation visible.
- **Landscape assumed for guard tablet.** Fixed at the gate, oriented wide.
- **Portrait assumed for resident tablet.** Couch use, held in hands.

---

## Composition rules — Desk

**Context:** seated, mouse and keyboard, multi-tasking.

- **Persistent sidebar navigation.** No hiding behind a hamburger.
- **Multi-column layouts.** Three-pane Admin: nav + list + detail.
- **Hover states everywhere.** Users expect them; missing hover states feel broken.
- **Keyboard shortcuts.** Command palette, search focus, Enter submits.
- **Dense tables.** More rows visible. Column sorting, filtering, bulk actions.
- **Modals preferred over navigation** for contextual actions — the page you were on stays visible behind.

---

## Composition rules — Wall

**Context:** mounted display, no direct interaction, viewed from a distance.

- **No navigation.** Nobody navigates a Wall. It cycles or shows one view.
- **Glanceable aggregates.** "3 inside · 2 gates active · 1 alert" — not "3,247 events today." Numbers sized for readability at 3+ meters.
- **Auto-refresh.** Data updates on a timer (30s–60s). No manual refresh control.
- **Read-only by definition.** Wall is a display surface, not a workflow.
- **High contrast, large type.** Same sunlight / distance reasoning as Handheld, amplified.
- **Idle-safe.** If the underlying data hasn't changed, nothing blinks or flashes. Walls sit in lobbies; they shouldn't be visual noise.

---

## Composition rules — Embedded (reserved)

**Not built in v1.** Listed here so no future contributor assumes it's missing.

When v2 defines non-human event sources:
- The interaction model is JSON over HTTP, not visual
- Events flow into the same `access_events` stream, distinguished by a
  `source` column (to be added when v2 is designed)
- No UI primitives. No components. No device classes beyond this entry.

**Do not design components for Embedded now.** The v2 dialogue will
define what it actually needs.

---

## Data contracts per class

Each class subscribes to a different shape. This is a Phase 9 concern
but the contract is locked here so API endpoints are shaped correctly.

| Class | Typical payload |
|---|---|
| Handheld | Single-action responses: one entry result, one credential detail, one notification |
| Tablet | Same as Handheld, plus small related lists (recent activity for a gate) |
| Desk | Paginated lists, filter parameters, bulk operations |
| Wall | Aggregates only — counts, latest highlight, currently-active items |

**Anti-pattern to avoid:** "one endpoint returns everything, each class
trims." Wall would download a full activity feed to display "3 inside."
Endpoint shapes must respect the class contract.

---

## Pixel breakpoints — implementation mapping

The class is the design intent. These pixel ranges are the implementation
details that fall out of it.

| Class | Pixel range | Framework note |
|---|---|---|
| Handheld | < 768px | Tailwind default; primary use case |
| Tablet | 768–1023px | Tailwind `md` |
| Desk | 1024–1439px | Tailwind `lg` |
| Desk (large) | 1440px+ | Tailwind `xl` / `2xl` |

**Wall has no pixel range.** Wall is defined by intent (mounted, ambient,
no user), not by screen size. A 27" monitor in the office could be either
Desk or Wall — the difference is whether someone sits at it or walks past
it. The application decides Wall vs Desk based on URL or role, not on
window width.

---

## What this document fixes for Phase 9

1. **No separate mobile and desktop designs.** Same components, three or
   four composition rules per class, four classes total. Fewer components
   to build and maintain.
2. **No "capability parity" debates.** Every action is available on every
   class it's designed for. If an action is only on Desk, we justify why.
3. **No tablet-phone ambiguity.** Tablet is its own class. Guard tablet
   layouts are deliberate, not stretched phone layouts.
4. **Wall is display-only.** No interactive Wall components will be built.
5. **Embedded is reserved.** No component in Phase 9 assumes it's the
   complete set of classes.

---

## What this document does NOT cover

- **Specific component designs.** Phase 9 builds those against these rules.
- **Visual language (colors, type, spacing).** Design system work — separate
  document, Phase 9.
- **Pixel-perfect implementation.** Tailwind breakpoints are enough. No
  custom media queries.

---

## Rule

When a Phase 9 build decision involves layout, the question is not
"what looks right at 1024px?" — it's "what class is this screen being
viewed in, and what does that class's composition rules say?"

The class drives the layout. The breakpoint falls out of it.
