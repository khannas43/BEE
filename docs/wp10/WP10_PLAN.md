# WP10 — Telling the applicant what happened (plan, 6 October 2026)

**Provisional local rules, not BEE rules.** The owner agreed these on 6 October 2026 (decision D10 in [BEE_DECISIONS.md](../BEE_DECISIONS.md)). In-portal only; the whole applicant organisation; four events.

| Event | Message (to everyone in the application's organisation) |
| --- | --- |
| Returned | "<ref> (<brand> <model>) was returned to you: <reason> Edit it and send it again." |
| Rejected | "<ref> (<brand> <model>) was rejected: <reason>" |
| Fee due | "<ref> (<brand> <model>) has its fee due: INR <total> (fee … plus tax …). Finance confirms it when it is received." |
| Approved | "<ref> (<brand> <model>) was approved. Certificate <registration ID> is valid from … to … (local demonstration, not issued by BEE)." |

## Work packages

| Package | What | Who |
| --- | --- | --- |
| WP10.1a | Database table written by triggers on the four events; Spring `GET /api/notifications`, `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`; the portal's matching routes; contract 0.24.0 | Claude |
| WP10.1b | The bell with the unread count in the top bar, and a Notifications page that links each entry to the screen where the applicant acts | Cursor (brief after 1a is merged) |

**Out of scope (see the backlog):** email, SMS and WhatsApp; preferences, digests, hiding old entries; notifying officers or managers (SLA breaches); certificate-expiry reminders (renewal); a push channel (the bell reads on page load and on revalidation).
