# WP09 — From "approved" to a certificate anyone can verify (plan, 5 October 2026)

**Provisional local rules, not BEE rules.** The owner agreed these defaults on 5 October 2026; none is a BEE decision. Everything produced is marked a local demonstration.

## Decisions to add to docs/BEE_DECISIONS.md (owner's assumptions)

## Work packages (each reviewed and gated on its own)

| Package | What | Notes |
| --- | --- | --- |
| WP09.1a | Issue the certificate at Secretary approval: allocator, immutable `certificate` record, shown to the applicant and to officers | Database, API contract, applicant dashboard; same transaction as `secretary_approve`; history shows the issue |
| WP09.1b | Printable certificate and label with a QR code | QR as an SVG generated on the server; page for the applicant and officers |
| WP09.1c | Real public verification page and endpoint | The first unauthenticated route: minimal fields, identical answer for unknown registrations, no enumeration of anything else |

**Out of scope:** batches of QR codes per production run, label fees and reconciliation, ledger and blockchain, revocation and amendment, renewal, notifying the applicant (WP10), BEE's official artwork.
