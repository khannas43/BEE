# Cursor task: sample data for the registration use case

Goal: the registration screens (Registration requests, Registration reviews, Register, the trail on a request) look like a real programme in motion, and every record tells one consistent story the presenter can open and talk through. Data is **synthetic only**. Output is ONE new file: `local/seed/demo/s8_registrations.sql`. Nothing else.

## Set-up (your own clone, not the shared checkout)
```
cd ~/Developer/BEE-demo
git fetch /Users/sameerkhanna/Developer/BEE bl229-promote-demo-routes
git checkout -B cursor/registration-data FETCH_HEAD
```
Do NOT take the baton, do NOT push, do NOT run the app, the database or any test (ports and the database belong to the other checkout). Do NOT edit anything except `local/seed/demo/s8_registrations.sql` (new). Claude applies and checks your file against the real database afterwards and will send back any error text for you to fix.

Read first: `local/seed/demo/s5_mis.sql` (the registration records it already writes: search for `registration_application`, `registration_submission_event`, `registration_fee_snapshot`, `registration_transition_event`, `registration_fee_confirmation`), `local/seed/demo/s7_register.sql` (brands, agency authorisations and register proposals; do not change them), `backend/src/main/resources/db/migration/V1*.sql` to `V6*.sql` for the registration tables (`grep -l registration_`), and `docs/demo/SAMPLE_DATA.md`.

## What exists today (do not duplicate, do not change)
- 11 brand registration requests: `REG-2026-9001` to `9009` (synthetic organisations) and `REG-2026-9101`, `9102` (Nova). Their only recorded step is `confirm_fee` by Finance, so the ones sitting with Programme or the Director have no recommendation, the approved ones have no recommend/approve steps, and the returned one has no return note. **Add the missing steps; never UPDATE or DELETE an existing event** (the tables are append-only: triggers reject it).
- No agency request exists.
- Brands and agency authorisations: see `s7_register.sql` (brand ids `00000000-0000-4000-c000-0000000013NN`, authorisation ids `00000000-0000-4000-e000-0000000001NN`, agency organisation PixelCert `00000000-0000-4000-b000-000000000002`).

## Hard rules
1. **Idempotent.** Running the file twice changes nothing the second time: fixed UUIDs in the same style (use a new range, `00000000-0000-4000-c000-0000000015NN` for events and `...0000000016NN` for new requests), `ON CONFLICT (id) DO NOTHING`, and guard every insert that could repeat (events have no natural key: derive the id with `md5('s8-<something>')::uuid` like `s5_mis.sql` does).
2. **Do not add `SET bee.demo_seeding`:** the runner adds it, so the message triggers (V66, V68) stay quiet for seeded events.
3. **People.** Use the existing accounts: `bee.finance` `00000000-0000-4000-a000-000000000003`, `bee.programme` `...a000-000000000006`, `bee.director` `...a000-000000000007`, applicant `nova.applicant` `...a000-000000000001`, `pixel.applicant` `...a000-000000000002`.
4. **The database enforces four-eyes; your data must obey it** (an INSERT that breaks these fails the whole file):
   - the person who filed a request (`registration_submission_event.actor_account_id`) cannot recommend, approve, return or reject it;
   - a member of the applicant organisation cannot review it;
   - the person who recommended a request cannot approve it. Use `bee.programme` to recommend or return and `bee.director` to approve, reject or return at director stage.
5. **State and trail agree.** The request's `state` and `version` must equal what its events lead to. Event order and `from_state`/`to_state`: `fee_due` -(confirm_fee, Finance)-> `programme_review` -(recommend, Programme)-> `director_approval` -(approve, Director)-> `approved`. `return` (Programme at programme review, or Director at director approval) -> `returned`; `reject` -> `rejected`; `resubmit` (applicant) -> back to `programme_review`. Each event's `version_after` goes up by one from the filing (see how `s5_mis.sql` numbers them). `occurred_at` rises in step and stays in the past; the sum of days from filing to approval should vary (4 to 25 days) so the Director dashboard's "days to approval" is not a single number.
6. **Approved means on the register.** An approved brand request has `registered_brand_id` set to a real `brand` row (the existing 5 already do: do not touch them). An approved agency request has `registered_authorisation_id` set to a real `agency_authorisation` row and the `register_entry` check in the table must hold.
7. **No documents.** Do not seed `registration_document*` rows (they need a stored PDF that a seed cannot create).

## What to add
A. **Complete the story of the 11 existing requests** (events only): `9001..9005` approved: add `recommend` (Programme) then `approve` (Director) with spread dates; `9006` and `9101` at programme review: nothing more; `9007` and `9102` at director approval: add `recommend`; `9008` returned: add a `return` by Programme with a believable note (for example "Trade licence has expired. Upload a current licence and send it again."); `9009` stays at fee due.
B. **Add 8 new brand requests** (`REG-2026-9010` to `9017`, `9010..9013` for synthetic organisations 501..508, the rest Nova), covering what is missing: two `rejected` (notes like "A brand with this name is already registered to another owner."), one `returned` then resubmitted and now at programme review (two Programme and applicant steps), one at fee due for Nova, one at programme review for another organisation, two approved with their register brand rows (new `brand` rows, names unique, owner = the requesting organisation).
C. **Add 4 agency requests** from PixelCert (`REG-2026-9020` to `9023`): approved (with the authorisation row it created, valid from a recent date, an end date a year later), at director approval, at programme review, and at fee due. They need `brand_id`, `principal_organisation_id` (the brand's owner) and `valid_from` (and optionally `valid_to`) in the request; use brands from `s7_register.sql` that are `active` and do not already have an authorisation to PixelCert (avoid overlapping periods: the table rejects them).
D. Every new request needs its filing event, fee snapshot (amount 5000.00 plus the same tax pattern the existing ones use) and, once past fee due, its `registration_fee_confirmation`, following the pattern in `s5_mis.sql`.

## Done when
- The file is one `.sql` file, idempotent, with a short header comment saying what it adds.
- Every request's state, version and trail agree, and the people rules in rule 4 hold.
- You list at the end: the requests added, which trails you completed, and anything you were unsure of.
