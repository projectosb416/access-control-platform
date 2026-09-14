# Domain Services

Business rules live here — not in UI components, API routes, or database triggers.

Per the handoff (§30), each service owns one slice of domain logic:

- authorization/ — create, revoke, validate authorization lifecycle; credential issuance
- access/        — authoritative ENTRY/EXIT decision engine; sessions, events, concurrency, idempotency
- shift/         — shift start/end, gate capacity, guard assignment and monitoring
- subscription/  — plans, subscriptions, payment state, entitlements
- notification/  — communication layer over domain events; delivery/read state separate from domain truth
- audit/         — append-oriented governance history for sensitive actions

Status as of Phase 6.2: folders only. No logic is implemented until Phase 4 (Security & RLS) is approved and Phase 5 (schema) is done.
