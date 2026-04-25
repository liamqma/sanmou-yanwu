# Web App Development Guide (Agents)

This file applies to any change made under `./web` (the React frontend).

## Required verification before declaring a task complete

Whenever you make any change inside `./web`, you **must** run all three of the
following commands from the `web/` directory and confirm they succeed before
finishing the task:

```bash
cd web

# 1. Unit / integration tests (Jest via react-scripts)
CI=true npm test

# 2. End-to-end tests (Playwright)
npm run test:e2e

# 3. Production build
npm run build
```

All three must pass:

- `CI=true npm test` — runs the Jest test suite once (non-interactive). Use
  `CI=true` so it does not enter watch mode. To scope down while iterating,
  you can append `-- --testPathPattern=<pattern>`, but a final full run with
  no pattern is required before completing the task.
- `npm run test:e2e` — runs the Playwright end-to-end tests under
  `web/tests/`. If a dev server is not already running, Playwright (per
  `playwright.config.js`) will start one as needed.
- `npm run build` — verifies the production build still compiles and surfaces
  any lint or type warnings that would break CI.

If any of these commands fails, fix the root cause (do not just suppress the
test or warning) and re-run all three until they pass cleanly.

## Notes

- Do **not** skip these checks because "the change is small" — even small
  changes can break the production build (e.g. unused imports, missing
  dependencies in hooks) or e2e flows.
- If you intentionally need to skip e2e (e.g. you only changed a markdown or
  config file with no runtime impact), explicitly call that out in your final
  summary and explain why.
- Prefer fixing failing tests over deleting them. If a test is genuinely
  obsolete, remove it and explain the reasoning in the summary.
