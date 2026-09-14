# PIN / Credential Hashing — NOT IMPLEMENTED

Phase 6 deliberately does not implement PIN hashing.

Open decision (see Phase 4 Security & RLS doc, §4 and §8): a Workers/OpenNext-compatible hashing
approach must be selected and verified with a real round-trip test on a deployed Cloudflare
Function before any credential code is written here.

Rules that apply when this folder is implemented:
- Never store raw PINs.
- Never log raw PINs, even at debug level.
- Rate limiting is mandatory (6 digits = 1,000,000 combinations).
- Revocation is immediate for future access, but past access events are never rewritten.

Until then, this folder stays empty except for this README and a .gitkeep.
