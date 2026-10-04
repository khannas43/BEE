# UI tests for the screen kit

**Status:** How to run and write the React tests for the kit hooks and panels. Not an acceptance record.

The node:test suite (`npm run web:test`) does not render React. Hook and panel tests run separately:

```
npm run web:test:ui
```

That is Vitest, in jsdom, with Testing Library. It collects `components/app/kit/__tests__/**/*.test.tsx` and `components/app/lifecycle/__tests__/**/*.test.tsx` (`vitest.config.ts`). Do not add those files to `web:test`; `local:check` depends on that script staying the node:test list.

## Approval screen ids

The shared Director and Secretary screen (`DirectorApproval.tsx`, `StageWorkScreen` with `testIdPrefix="approval"`) uses neutral ids for both roles. Role-specific command ids are unchanged.

| Old id | New id |
| --- | --- |
| `director-scrutiny` | `approval-scrutiny` |
| `director-identity` | `approval-identity` |
| `director-queue-loading` | `approval-queue-loading` |
| `director-queue-error` | `approval-queue-error` |
| `director-queue-empty` | `approval-queue-empty` |
| `director-queue-table` | `approval-queue-table` |
| `director-queue-filter` | `approval-queue-filter` |
| `director-ref-{reference}` | `approval-ref-{reference}` |
| `director-open-{reference}` | `approval-open-{reference}` |
| `director-detail` | `approval-detail` |
| `director-detail-close` | `approval-detail-close` |
| `director-detail-error` | `approval-detail-error` |
| `director-detail-fields` | `approval-detail-fields` |
| `director-history` (and `-list`, `-step-*`, etc.) | `approval-history` (same suffixes) |
| `director-rating` | `approval-rating` |
| `director-rating-stars` | `approval-rating-stars` |
| `director-return` / `secretary-return` (panel) | `approval-return` |
| `director-return-run` / `secretary-return-run` | `approval-return-run` |
| `director-return-reason` / `secretary-return-reason` | `approval-return-reason` |
| `director-return-error` / `secretary-return-error` | `approval-return-error` |
| `director-return-reload` / `secretary-return-reload` | `approval-return-reload` |
| `director-return-input-error` / `secretary-return-input-error` | `approval-return-input-error` |
| `director-return-success` (both roles) | `approval-return-success` |
| `director-return-back` | `approval-return-back` |
| `director-reject` / `secretary-reject` (panel) | `approval-reject` |
| `director-reject-run` / `secretary-reject-run` | `approval-reject-run` |
| `director-reject-reason` / `secretary-reject-reason` | `approval-reject-reason` |
| `director-reject-confirm` / `secretary-reject-confirm` | `approval-reject-confirm` |
| `director-reject-error` / `secretary-reject-error` | `approval-reject-error` |
| `director-reject-reload` / `secretary-reject-reload` | `approval-reject-reload` |
| `director-reject-input-error` / `secretary-reject-input-error` | `approval-reject-input-error` |
| `director-reject-success` (both roles) | `approval-reject-success` |
| `director-reject-back` | `approval-reject-back` |

Unchanged: `director-recommend-*`, `secretary-approve-*`.

## Writing a test

- Render the real hook or panel (`useRuntimeRead`, `useRevalidation`, `useCommand`, `ReadPanel`, `CommandPanel`). Stub `globalThis.fetch` and let the component call it. `components/app/kit/__tests__/deferredFetch.ts` holds the response until the test settles it, which is how a late response and a one-at-a-time command are expressed.
- `load`, `run` and `signature` must be stable references. An inline arrow is a new dependency on every render and the hook will re-read or rebuild `execute`.
- `useRevalidation`'s interval needs fake timers (`vi.useFakeTimers` with `setInterval` and `clearInterval` only, so promises still flush). Assert the timer is cleared by unmounting and advancing time again.
- `ReadPanel`'s `action` and `resultAction` share one header slot. The header action is shown while loading and on failure. Once the read has loaded, including an empty result, `resultAction` takes that slot when it is passed.
- A failing test that shows a real kit defect stays as `it.fails` (or skipped, with a comment naming the defect). Do not change the component to make that test pass; report it so it can be decided separately.
- Keep `data-testid` values and user-visible copy stable. These tests find elements by them, and so do the live checks.
