# Development lifecycle

## Lifecycle

1. Requirement: capture what the user wants, in their own words.
2. Plan: share the approach, the affected files, and the tests you will run.
   Do not implement until the user explicitly approves.
3. Implement on a feature branch (never `master`) and run the tests below.
4. Merge when the required checks are green.

## Tests per changed area

Run only the tests for the areas you changed.

| Changed paths | Tests |
|---|---|
| `web/**` | From `web/`: `pnpm typecheck`, `pnpm test`, and `pnpm build`. Add `pnpm test:e2e` when the change affects UI flow or rendered behavior (first run: `pnpm exec playwright install`). |
| `image_extraction/**` | `make test` (loads PaddleOCR, about 40 s). |
| `study-battle-report/**` | `make test`, then check output with `uv run python study-battle-report/ocr_battle_log.py [<batch-id>] --use-cache`. |
| `data/**` | `make test-data`. For recommendation changes, also run `make build-recommendation`, plus `make evaluate-recommendation` when evaluation logic or model configuration changes. For telemetry changes, run `make build-telemetry EXPORT=<D1 SQL export>`; the empty migration is a safe local input. |
| `autojs/**` or Markdown only | Nothing to run. |

- Fresh checkouts need `pnpm install --frozen-lockfile` in `web/` and
  `make sync`.
- Fix a failing check at its root cause. Do not skip, suppress, or delete a
  test to make it pass.
- For visual UI work, start the dev server and run
  `cd web && node scripts/capture-visual-audit.mjs <output-directory>`. Its
  `report.json` fails on page errors, horizontal overflow, or unexpected large
  dark surfaces.

## Pull-request checks

`.github/workflows/pull-request-checks.yml` runs the checks for the changed
areas. Branch protection should require its `Required PR checks` job.
