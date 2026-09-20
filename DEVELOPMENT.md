# Development Lifecycle

How a change moves from an idea to a merged PR in this repo, and — because this
is a multi-workspace monorepo — **which tests an agent should actually run**. See
[README.md](README.md) for project orientation and [GAME_RULE.md](GAME_RULE.md)
for the game rules.

## The lifecycle

Every non-trivial change follows the same four steps in the working tree.

1. **Requirement.** Start from what the user wants to accomplish — the goal, not a
   diff. Capture it in the user's own words; it becomes the `--intent` later.

2. **Discuss & plan.** Turn the proposed approach into a reviewable plan and
   share it: the trade-offs, affected files, and the tests you intend to run.
   Iterate on the plan until the user **explicitly approves**. **Do not start
   implementing before approval.**

3. **Implement.** Create a feature branch (never work on `master`), make the
   change, and run the **scoped tests** for the area you touched (see
   [Scope tests to the changed workspace](#scope-tests-to-the-changed-workspace)).
   Commit on the feature branch.

4. **Merge.** Review the PR and merge it when the required checks are green.

## Scope tests to the changed workspace

This repo is a **uv workspace + React app + local TypeScript agent**, and the
workspaces are independent.
**Run only the tests for the area you changed.** A web-only change must not drag in
the heavy PaddleOCR Python suite, and a Python change does not need the React
tests. Match the changed paths to the smallest test set that covers them:

| Changed paths | Tests to run |
|---|---|
| `web/**` (source under `web/src/`) | **Web unit tests** (Vitest): `cd web && pnpm test` — and **type-check**: `cd web && pnpm typecheck` (Go-native `tsc`) |
| `web/**` that changes UI flow / rendered behavior | The unit tests above **and** the **e2e tests** (Playwright): `cd web && pnpm test:e2e` (first time: `pnpm exec playwright install`) |
| `agent/**` | **Agent checks**: `cd agent && pnpm typecheck && pnpm test && pnpm build`. Tests use fake providers and consume no model tokens. Run `pnpm smoke` or the combined `pnpm recommend fixtures/partial-teams.json` workflow only for an explicit live integration check when the local provider is available. |
| `image_extraction/**` | **Python tests**: `make test` (runs the image-extraction and battle-report OCR suites; needs `make sync` first if deps aren't installed — loads PaddleOCR, ~40s) |
| `data/**` (offline builders) | **Python tests**: `make test-data` (runs the recommendation and telemetry builder suites; fast, no PaddleOCR). For recommendation changes, also run `make build-recommendation`; when evaluation logic or model configuration changes, run `make evaluate-recommendation` as well. Its ignored JSON report is evaluation-only and must not update production weights automatically. For telemetry changes, run `make build-telemetry EXPORT=<D1 SQL export>` (the empty migration is a safe local smoke input). Confirm the relevant generated artifact updates and the web app still loads. |
| `study-battle-report/**` | **OCR tests**: `make test` (runs the image-extraction and battle-report OCR suites). Also validate representative output with `uv run python study-battle-report/ocr_battle_log.py [<batch-id>] --use-cache`. |
| `autojs/**` | No tests — nothing to run. |
| Docs only (`*.md`, `README`, this file) | No tests — nothing to run. |

Notes:
- When a change spans more than one workspace, run each affected workspace's tests.
- For visual UI work, start the web dev server and run
  `cd web && node scripts/capture-visual-audit.mjs <output-directory>` after
  the automated checks. The script owns the exact desktop, tablet, mobile, and
  representative component-state matrix; `report.json` fails closed on page
  errors, horizontal overflow, or unexpected large dark-colored surfaces.
  Explicitly allowlisted immersive surfaces are exempt from the dark-surface
  diagnostic.
- Fresh checkouts have no installed deps: web and agent checks each need
  `pnpm install --frozen-lockfile` in their own directory; Python tests need
  `make sync`.
- Canonical routine build and test commands live in the
  [README `Commands`](README.md#commands) section and the `Makefile`; the visual
  audit invocation above is maintained here.

## Pull-request checks

[`.github/workflows/pull-request-checks.yml`](.github/workflows/pull-request-checks.yml)
runs on every pull request and classifies the changed paths from the merge base
of the PR's base and head revisions. It applies the same workspace boundaries as
the table above: web changes run type-check, Vitest, Playwright, and the
production build; agent changes run its token-free checks; data changes run
`make test-data`; and image extraction changes run `make test`. Changes to
`database.json` run all four workspace checks, while changes to
`recommendation_data.json` run the web, agent, and data checks. SQL migrations
and reviewed game-data files under `web/` also run data checks. The carried-signature OCR
fixture shared by battle-upload validation runs image-extraction, web, and data
checks. Other shared runtime and dependency files fan out to the affected
workspaces, while workflow changes run every workspace check so a CI edit proves
the complete orchestration. Markdown and README documentation anywhere in the
tree, along with manual-only areas, do not pull in unrelated test suites.

The final **Required PR checks** job always appears and fails if path detection
or any applicable workspace job fails or is cancelled. Configure branch
protection to require that stable check name rather than conditional workspace
job names. PR CI is an independent, visible check of the pushed branch merged
with its target.
