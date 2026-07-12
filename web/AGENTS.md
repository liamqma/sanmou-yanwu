# Web App Development Guide (Agents)

This file applies to any change made under `./web` (the React frontend).

## Required verification before declaring a task complete

Whenever you make any change inside `./web`, you **must** run all four of the
following commands from the `web/` directory and confirm they succeed before
finishing the task:

```bash
cd web

# 1. Type-check (Go-native typescript@7)
npm run typecheck

# 2. Unit / integration tests (Vitest)
npm test

# 3. End-to-end tests (Playwright)
npm run test:e2e

# 4. Production build (Vite)
npm run build
```

All four must pass:

- `npm run typecheck` — runs `tsc --noEmit` with the Go-native `typescript@7`.
  Vite/esbuild strips types at build time but does **not** type-check, so this
  is the type gate.
- `npm test` — runs the Vitest suite once (`vitest run`, non-interactive; no
  `CI=` needed). To scope down while iterating, pass a path/pattern, e.g.
  `npx vitest run statKeys`, but a final full run is required before completing
  the task. Note: Vitest is scoped to `src/**` (see `vite.config.js` `test.include`)
  — the Playwright specs in `tests/` are run only by step 3.
- `npm run test:e2e` — runs the Playwright end-to-end tests under
  `web/tests/`. If a dev server is not already running, Playwright (per
  `playwright.config.js`) starts the Vite dev server on port 3000 as needed.
- `npm run build` — verifies the production build still compiles into `build/`
  (the Cloudflare Pages output dir).

If any of these commands fails, fix the root cause (do not just suppress the
test or warning) and re-run all four until they pass cleanly.

## Notes

- Do **not** skip these checks because "the change is small" — even small
  changes can break the production build (e.g. unused imports, missing
  dependencies in hooks) or e2e flows.
- If you intentionally need to skip e2e (e.g. you only changed a markdown or
  config file with no runtime impact), explicitly call that out in your final
  summary and explain why.
- Prefer fixing failing tests over deleting them. If a test is genuinely
  obsolete, remove it and explain the reasoning in the summary.
