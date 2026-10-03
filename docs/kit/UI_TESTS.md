# UI tests for the screen kit

**Status:** How to run and write the React tests for the kit hooks and panels. Not an acceptance record.

The node:test suite (`npm run web:test`) does not render React. Hook and panel tests run separately:

```
npm run web:test:ui
```

That is Vitest, in jsdom, with Testing Library. It only collects `components/app/kit/__tests__/**/*.test.tsx` (`vitest.config.ts`). Do not add those files to `web:test`; `local:check` depends on that script staying the node:test list.

## Writing a test

- Render the real hook or panel (`useRuntimeRead`, `useRevalidation`, `useCommand`, `ReadPanel`, `CommandPanel`). Stub `globalThis.fetch` and let the component call it. `components/app/kit/__tests__/deferredFetch.ts` holds the response until the test settles it, which is how a late response and a one-at-a-time command are expressed.
- `load`, `run` and `signature` must be stable references. An inline arrow is a new dependency on every render and the hook will re-read or rebuild `execute`.
- `useRevalidation`'s interval needs fake timers (`vi.useFakeTimers` with `setInterval` and `clearInterval` only, so promises still flush). Assert the timer is cleared by unmounting and advancing time again.
- `ReadPanel`'s `action` and `resultAction` share one header slot. The header action is shown while loading and on failure. Once the read has loaded, including an empty result, `resultAction` takes that slot when it is passed.
- A failing test that shows a real kit defect stays as `it.fails` (or skipped, with a comment naming the defect). Do not change the component to make that test pass; report it so it can be decided separately.
- Keep `data-testid` values and user-visible copy stable. These tests find elements by them, and so do the live checks.
