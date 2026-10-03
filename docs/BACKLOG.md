# BEE local portal — backlog of deferred items

**Purpose.** Everything deliberately not done yet, so nothing is lost between sessions. This is the record the owner asked to keep. It does not change work-package definitions, acceptance status or scope in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

**Rules**
1. **Nothing is dropped silently.** A finding, limit or idea that is not fixed in the activity that found it gets a row here before that activity is closed.
2. **Review policy.** Low-severity review findings go here instead of starting another fix-and-re-review round (see [SCREEN_COMPLETION_PLAN.md](SCREEN_COMPLETION_PLAN.md) section 4).
3. **Revisit at the start of each wave** and at the end of each activity: scan the rows whose "Revisit at" matches, and close or re-date them.
4. **Statuses:** `open`, `scheduled` (owned by a named package), `accepted limit` (a known limit the owner accepted; keep the row), `done` (kept for history, with the commit).

Last updated: 3 October 2026 (after commit `2eda95a`).

## A. Deferred from the WP06.1a reviews (four rounds, no high-severity findings)

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-001 | Blob integrity: `LocalSha256FileStore.commit` accepts an existing blob on size alone, so a corrupted blob is never repaired by re-upload; `read` then fails the hash check and returns 503 | A damaged file stays unreadable and silently blocks the same content from being stored again | WP06.2 | scheduled |
| BL-002 | Sweep orphaned `.tmp` staging files left by a crash | Disk growth; no data risk | WP06.2 | scheduled |
| BL-003 | Orphan blobs from uploads refused after the blob was stored (brand lapsed, application submitted or gone, any recorder rollback) | A repeated refusal grows the content store without bound; the same sweep as BL-001/BL-002 | WP06.2 | scheduled |
| BL-004 | Tomcat parses and spools the multipart body (up to the 6 MiB request limit) before any controller runs, so a malformed or oversized body is answered 422 ahead of 403/404 | An unauthorised caller can still cost one body read; closing it needs authorisation in a filter ahead of multipart resolution | WP06.2 or security hardening | accepted limit |
| BL-005 | The 6 MiB request limit (`BEE_DOCUMENTS_MAX_REQUEST_BYTES`), the BFF's 6 MiB cap and `BEE_DOCUMENTS_MAX_BYTES` are three separate settings | Raising the file limit alone breaks uploads near the limit | WP06.2 (retention and limits) | accepted limit |
| BL-006 | The bounded BFF read keeps the chunk list and then a concatenated copy, so peak memory is about twice the body (up to 12 MiB per upload) | Small; matters if concurrent uploads rise or the web memory budget stays tight | WP06.2 | open |
| BL-007 | The brand queries run twice per upload, the second time inside the application row lock | Concurrent submit or draft updates on that application wait a few extra round trips | WP06.2 | accepted limit |
| BL-008 | Filename sanitiser edges for Indic scripts: stripping a trailing zero-width joiner can change a final half-form; truncation at 176 UTF-16 units can end a stem on a bare virama or a base letter whose marks were cut | Cosmetic display only; the stored bytes and hash are unaffected | WP06.2 | accepted limit |
| BL-009 | `Propagation.MANDATORY` on the document repository is proven with hand-built transaction proxies, not by a Spring-context test | A wiring regression would fail uploads with 503; the live `local:check` upload journey already catches it, a context test would catch it sooner | next time the document module is touched | open |
| BL-010 | `AtomicReference` carries the rendered view out of the recorder callback | Style only | next time the document module is touched | open |
| BL-011 | `MissingServletRequestPartException` is unreachable on the upload route (its parts are optional); other routes with a required `@RequestParam` still fall to the catch-all 500, as they did before this work | A future endpoint with a required parameter would return 500 instead of a validation error | next new endpoint with a required parameter | open |
| BL-012 | Pending uploads in the `returned` state: today documents are draft-only | The first-slice return and resubmit path needs the applicant to add or replace the report after a return | WP05.2 (return transition) | scheduled |

## B. Screen kit gaps (from [kit/SCREEN_KIT.md](kit/SCREEN_KIT.md))

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-020 | Paged, filtered, sortable server-scoped table | The dashboard shows the whole scoped list; larger lists need paging, and paging is a contract change | first screen with a long list; WP05 broader | open |
| BL-021 | Tabs for a record's contextual panels (documents, history, approvals) | 55 of the matrix rows are contextual tabs | Wave 1 (inbox and approval views), Wave 2 | open |
| BL-022 | Command panel component (button, busy state, conflict banner) around `runtimeCommand` | Finance confirmation and every scrutiny and approval action need the same behaviour | Wave 1, first command screen | open |
| BL-023 | Generic document card (`DraftTestReports` is the model) | Needed when a second document kind exists | WP06.2, WP05.1d follow-up | open |
| BL-024 | Backend feature template or generator: Spring command and read, BFF route and validator, client helper, contract entry, test skeletons | A new feature touches about 40 files today; the plan's biggest speed-up | Wave 1 | open |
| BL-025 | Split `bee-local-api.openapi.json`, `contract-pin.json` and the coverage inputs per module, merged by a script | These files change on every feature and block parallel work | with BL-024 | open |
| BL-026 | Migrate `runtimeModelDocuments.ts`, `runtimeModelSubmit.ts` and the write half of `runtimeModelDrafts.ts` onto `runtimeRead` and `runtimeCommand` | They keep their own copies of the failure mapping and fetch code | next time each is changed | open |
| BL-027 | Unit tests for the hooks (`useRuntimeRead`, `useRevalidation`); the repo has no React test runner | Today the hooks are proven only by `local:read-ui` (26/26 live) | when a React test runner is added | open |

## C. Tooling and process

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-030 | `scripts/local/check.sh` does not start the servers; with them down it prints about 30 failures that look like code defects | The interrupted handover's "failing checks" were exactly this; add a fail-fast "runtime is not up, run `npm run local:up`" message | next tooling change | open |
| BL-031 | A crashed run leaves `.local/run/run.lock` behind, and the next run fails until it is removed by hand | Cost time twice this session | next tooling change | open |
| BL-032 | `local:check` memory budgets are noisy: `memory.web` measured 398 to 1541 MB against a 1500 MB budget across runs | One run failed only on this budget; a flaky gate trains people to ignore it | decide: raise the budget or measure after a settle period | open |
| BL-033 | The full gate takes about 3 to 5 minutes plus a runtime restart, and was re-run after every review round | The main source of slow turnaround | adopt tiered gates (plan section 4, item 3) | open |
| BL-034 | One `api:test` run stalled for 10 minutes in a file read while the repository was under `~/Documents` | Probably cloud-sync materialisation; the work moved to `~/Code` | keep working only under `~/Code/BEE/worktrees` | accepted limit |
| BL-035 | Whole-repository lint baseline: 53 problems (32 errors) at the last measurement, including two `react-hooks/set-state-in-effect` errors in `NewModelApplication.tsx` from WP05.1c and a warning in `runtimeModelDrafts.ts` | Hides any new finding in a noisy baseline | a dedicated lint clean-up activity | open |
| BL-036 | `DEVELOPMENT_PLAN.md` and the early slice documents keep historical status sentences that conflict with the dated review entries | A reader can take an old sentence as current status | next plan update | open |

## D. Decisions and policy still needed from BEE or the owner

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-040 | The fee amount and its source (local ₹24,000 is provisional, not BEE-approved) and the approved rating formula | Shown as provisional everywhere; cannot be marked verified | BEE; before WP07.1 and WP05.2 | open |
| BL-041 | M6: who may close or supersede a master version; master administration policy | No UI grant exists; blocks the admin master screens | BEE; before Wave 2 admin screens | open |
| BL-042 | WP05.1d answers 6 (other required documents) and 8 (who verifies a report, and the outcomes) | Applied as local defaults, not decided | BEE; WP05.2 and WP06.2 | open |
| BL-043 | The six decisions in [SCREEN_COMPLETION_PLAN.md](SCREEN_COMPLETION_PLAN.md) section 7 (tiers, review policy, parallel agents, the WP05.1d answers, M6, the re-estimate point) | The plan runs on stated defaults until answered | owner; Wave 1 start and end | scheduled |
| BL-044 | Re-estimate the plan's person-days after the first vertical slice | The carried-over figures are not re-estimated | end of Wave 1 | scheduled |

## E. Known gaps in accepted activities

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-050 | WP05.1a: revocation and expiry clear the screen on the next focus or 30 s revalidation, not instantly; displayed rows may remain until an in-flight revalidation responds | Short stale window; Spring still denies each new read | WP05 broader | accepted limit |
| BL-051 | WP05.1a: MFA-required and inactive-account states were not observed live | Unproven edge states | WP02.3 follow-up / WP05 | open |
| BL-052 | Pagination, accessibility review and Hindi copy for the dashboard and draft-form text | RFP expectations not yet met on these screens | WP05 broader | open |
| BL-053 | WP02: delegation and complete denial evidence; the WP02–WP05 package-level reviews | The packages stay open until these close | WP02.3 remainder, package reviews | scheduled |
| BL-054 | WP04: brand and agency workflows, master administration policy, audit coverage | WP04 stays open | WP04.2 and WP04.3 (Wave 2) | scheduled |

## F. Repository housekeeping

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-060 | The stale clone at `~/Documents/Documents/BEE/worktrees/wp05.1-read-ui` (at `aa7432a`, with uncommitted files identical to a commit) was left as is by owner decision | Committing or running checks there would diverge from the real branch; the handover says not to use it | owner; revisit if folder clean-up is wanted | accepted limit |
| BL-061 | `wp06.1a-document-intake` is pushed (54 commits ahead of `main`) but there is no pull request, and the earlier local branches (`wp04.1-masters`, `wp04.2-brand-auth`) are not on the remote | Merge strategy and history layout are undecided | owner | open |
| BL-062 | `AGENTS.md` and `CLAUDE.md` are rewritten by `next dev`; the check compares them to the committed copy | A diff there is a tool artefact, not a change | keep the committed copy unchanged | accepted limit |
