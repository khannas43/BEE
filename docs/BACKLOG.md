# BEE local portal — backlog of deferred items

**Purpose.** Everything deliberately not done yet, so nothing is lost between sessions. This is the record the owner asked to keep. It does not change work-package definitions, acceptance status or scope in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

**Rules**
1. **Nothing is dropped silently.** A finding, limit or idea that is not fixed in the activity that found it gets a row here before that activity is closed.
2. **Review policy.** Low-severity review findings go here instead of starting another fix-and-re-review round (see [SCREEN_COMPLETION_PLAN.md](SCREEN_COMPLETION_PLAN.md) section 4).
3. **Revisit at the start of each wave** and at the end of each activity: scan the rows whose "Revisit at" matches, and close or re-date them.
4. **Statuses:** `open`, `scheduled` (owned by a named package), `accepted limit` (a known limit the owner accepted; keep the row), `done` (kept for history, with the commit).

Last updated: 3 October 2026 (command panel and feature template added).

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
| BL-022 | Command panel component (button, busy state, conflict banner) around `runtimeCommand` | Finance confirmation and every scrutiny and approval action need the same behaviour | built: `useCommand` and `CommandPanel` in `components/app/kit/CommandPanel.tsx`, used by the test-report upload; the submit and draft-save flows still have their own buttons | done |
| BL-023 | Generic document card (`DraftTestReports` is the model) | Needed when a second document kind exists | WP06.2, WP05.1d follow-up | open |
| BL-024 | Backend feature template or generator (PARTLY DONE: `scripts/local/new-feature.cjs` scaffolds a POST command on `/api/model-applications/{id}/<segment>` and registers it, `wiring-check.cjs` verifies every documented route, both described in `docs/kit/FEATURE_TEMPLATE.md`; what remains is BL-078 to BL-082): Spring command and read, BFF route and validator, client helper, contract entry, test skeletons | A new feature touches about 40 files (WP06.1a: 42); WP05.1d, with no new route, still touched 24 files and needed the contract artifact, two validators, a hard-coded stand-in table and three live scripts updated by hand; the plan's biggest speed-up | Wave 1 | open |
| BL-025 | Split `bee-local-api.openapi.json`, `contract-pin.json` and the coverage inputs per module, merged by a script | These files change on every feature and block parallel work | with BL-024 | open |
| BL-026 | Migrate `runtimeModelDocuments.ts`, `runtimeModelSubmit.ts` and the write half of `runtimeModelDrafts.ts` onto `runtimeRead` and `runtimeCommand` | They kept their own copies of the failure mapping and fetch code | done: all three now run on the kit transport (one unused-variable lint warning went with the rewrite); unit tests cover each client through a fake fetch | done |
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
| BL-077 | The code-review agent checks out the end commit of its range in the shared worktree, which leaves HEAD detached; a commit made afterwards lands on no branch (it happened once, after the WP05.1d review, and was recovered by fast-forwarding the branch) | Work committed on a detached HEAD can be lost on the next checkout | After every review run `git branch --show-current` before committing; prefer running reviews in an isolated worktree | open |

## D. Decisions and policy still needed from BEE or the owner

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-040 | (Put to BEE as A1 and A2 in [BEE_DECISIONS.md](BEE_DECISIONS.md).) The fee amount and its source (local ₹24,000 is provisional, not BEE-approved) and the approved rating formula | Shown as provisional everywhere; cannot be marked verified | BEE; before WP07.1 and WP05.2 | open |
| BL-041 | (BEE_DECISIONS.md C1.) M6: who may close or supersede a master version; master administration policy | No UI grant exists; blocks the admin master screens | BEE; before Wave 2 admin screens | open |
| BL-042 | (BEE_DECISIONS.md B1 to B8.) WP05.1d answers still undecided by BEE: all of 1–6 are provisional local defaults; 6 (other required documents) and 8 (who verifies a report, and the outcomes) are not built | Shown as provisional; none is a BEE rule | BEE; WP05.2 and WP06.2 | open |
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

## G. WP05.1d (submit-time evidence gates)

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-063 | The laboratory choice list rides on the `eligible-brands` response, a misnomer; it avoided a new route and about 14 touch points | The endpoint is really "draft form options"; rename it with the OpenAPI split | with BL-024 and BL-025 | open |
| BL-064 | The declared-efficiency bound (positive, at most 99.99, two decimals) is a placeholder | BEE has not stated the range or precision (decision 5) | BEE | open |
| BL-065 | No maximum age for the test date; only a future date is refused | BEE may require the test to be recent (decision 3); it should be a master rule, not code | BEE | open |
| BL-066 | `standard_not_available` cannot be unmet with the seed (standard and accreditation both start 2026-01-01), so it has no live check | Covered only by the contract test and the BFF stand-in; add a seeded gap or test master if a live check is wanted | next seed change | accepted limit |
| BL-067 | The standard purpose `performance_test` and category `RAC` are fixed in code | Which standard applies is BEE decision M2; more categories need a mapping | BEE; when a second category exists | open |
| BL-068 | Uniqueness folds case and trims spaces only, and uses the database's `upper()` | Whether `NC-1` and `NC1` are one model, and Unicode folding, are BEE questions; families are not modelled (decision 4) | BEE; WP05 broader | open |
| BL-069 | A draft that duplicates a live model can be created and saved; the clash shows only in the submit preview | Earlier warning would save the applicant effort | WP05 broader | open |
| BL-070 | The master versions the submit check resolved are stored but not exposed by any read | WP05.2 and the audit history (WP04.3) should show which accreditation and standard applied | WP05.2, WP04.3 | scheduled |
| BL-071 | The laboratory list is not filtered by date and is limited to RAC | A lab with a record but no cover on the test date is offered and refused at submit | next category or if observed | accepted limit |
| BL-072 | The gate labels are English only and the form does not link an unmet check to the field that fixes it | Hindi copy and accessibility are RFP expectations for these screens (see BL-052) | WP05 broader | open |
| BL-073 | A test report version carries its own free-text laboratory name and test date (API upload only; the form does not collect them), while the gates read the application's laboratory, date and efficiency; nothing reconciles the two | An applicant using the API could declare lab A on the application and upload a report saying lab B; the stored master versions would then rest on the application's facts only | BEE decision, then WP06.2 or WP05.2 (cross-check, or drop the free-text fields from the upload) | open |
| BL-074 | V24's unique index fails the migration on any database that already holds two live (non-draft, non-rejected) applications with the same brand and model number | It fails loudly with a unique violation and no data change; V24 is already applied here, so any change is a new migration (V25), not an edit | next environment that holds legacy data | accepted limit |
| BL-075 | The advisory-lock wait is bounded (10 s `lock_timeout`, a retryable 503) but there is no test that waits that long | The bound is untested; a test would need a configurable timeout | next time the lock is touched | open |
| BL-076 | `useRuntimeRead`'s reset when a target goes away (open, close, reopen) has no unit test because the repo has no React test runner | Proven only by reading the code; see BL-027 | when a React test runner is added | open |

## H. Command panel and feature template

| ID | Item | Why it matters | Owner / revisit at | Status |
| --- | --- | --- | --- | --- |
| BL-078 | The scaffolder covers only a POST command on `/api/model-applications/{id}/<segment>`; read routes, collection routes, other resources and PATCH are not generated | Wave 2 and later need reads and other resources; extend it when the first one appears | first non-command feature | open |
| BL-079 | `contract-coverage.cjs` `springEvidence()` hard-codes which MockMvc test covers which route | Every new route needs a hand edit there; an annotation or a convention in the test name would make it data-driven | with BL-025 | open |
| BL-080 | The stand-in tables in `contract-check.cjs` (`SUBMIT_UPSTREAM` and the like) are hard-coded per route and must equal the artifact's `x-error-codes` | They drifted once already (WP05.1d); generating them from the artifact would remove the duplicate | with BL-025 | open |
| BL-081 | No skeletons for the database test or the `SpringContractTest` section (the `@MockitoBean`, the documented-pairs test) | Both are the longest hand-written parts of a feature; the output names them but does not generate them | when the first generated command is implemented | open |
| BL-082 | `CommandPanel` is used by the test-report upload only; the draft save and the submit confirm still use their own buttons and state | Two places show command failures differently until they move onto `useCommand` | next change to the draft form | open |

