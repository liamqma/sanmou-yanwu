# Web App Development Guide (Agents)

This file applies to any change made under `./web` (the React frontend).

## Required verification before declaring a task complete

Whenever you make any change inside `./web`, you **must** run all four of the
following commands from the `web/` directory and confirm they succeed before
finishing the task:

```bash
cd web

# 1. Type-check (Go-native typescript@7)
pnpm typecheck

# 2. Unit / integration tests (Vitest)
pnpm test

# 3. End-to-end tests (Playwright: dev-server + production-prerender suites)
pnpm test:e2e

# 4. Production build (client bundle + build-time prerender)
pnpm build
```

All four must pass:

- `pnpm typecheck` — runs `tsc --noEmit` with the Go-native `typescript@7`.
  Vite/esbuild strips types at build time but does **not** type-check, so this
  is the type gate.
- `pnpm test` — runs the Vitest suite once (`vitest run`, non-interactive; no
  `CI=` needed). To scope down while iterating, pass a path/pattern, e.g.
  `pnpm exec vitest run recommendationModel`, but a final full run is required before completing
  the task. Note: Vitest is scoped to `src/**` (see `vite.config.js` `test.include`)
  — the Playwright specs in `tests/` are run only by step 3.
- `pnpm test:e2e` — runs both Playwright suites in sequence: the dev-server
  specs under `web/tests/` (Playwright starts the Vite dev server on port 3000
  per `playwright.config.js` if one is not already running), then
  `pnpm test:prerender`, which runs `pnpm build` and exercises the
  `web/tests-production/` prerender/no-JavaScript/hydration specs against
  `pnpm preview` on port 4173 (`playwright.prerender.config.js`).
- `pnpm build` — verifies the production build still succeeds. It runs
  `scripts/build.mjs` (client bundle + build-time React prerender) and emits
  `build/` (the Cloudflare Pages output dir); see [README.md](README.md) for
  the pipeline.

If any of these commands fails, fix the root cause (do not just suppress the
test or warning) and re-run all four until they pass cleanly.

## Feature map and runtime proof

Before changing user-visible behavior, read the project-local
[`verify-sanmou`](../.agents/skills/verify-sanmou/SKILL.md) skill and the relevant
entry in its
[web feature map](../.agents/skills/verify-sanmou/references/features/README.md).
Use the mapped Playwright journey while iterating and retain a trace, screenshot,
download, request assertion, or reload result that demonstrates the changed
behavior through the real user path. This focused proof supplements rather than
replaces the four final commands above.

Update the relevant feature-map file in the same change when a user-facing
entry point, behavior, selector, prerequisite, side effect, persistence rule, or
gotcha changes. Pure implementation refactors that preserve the mapped contract
do not need a map edit.

The verification workflow deliberately does not call `sanmouDebug()`. That
export is for a player to copy and provide to an agent when investigating why a
weight or recommendation differs from human expectations; it is investigation
input, not general runtime proof.

## Notes

- Do **not** skip these checks because "the change is small" — even small
  changes can break the production build (e.g. unused imports, missing
  dependencies in hooks) or e2e flows.
- If you intentionally need to skip e2e (e.g. you only changed a markdown or
  config file with no runtime impact), explicitly call that out in your final
  summary and explain why.
- Prefer fixing failing tests over deleting them. If a test is genuinely
  obsolete, remove it and explain the reasoning in the summary.
