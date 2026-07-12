# Development Lifecycle

How a change moves from an idea to a merged PR in this repo, and — because this
is a multi-workspace monorepo — **which tests an agent should actually run**. See
[README.md](README.md) for project orientation and [GAME_RULE.md](GAME_RULE.md)
for the game rules.

## The lifecycle

Every non-trivial change follows the same five steps. Steps 1–3 happen in the
working tree; steps 4–5 go through the `no-mistakes` gate.

1. **Requirement.** Start from what the user wants to accomplish — the goal, not a
   diff. Capture it in the user's own words; it becomes the `--intent` later.

2. **Discuss & plan (`lavish`).** Turn the proposed approach into a reviewable
   artifact with the **`lavish`** skill (installed at `~/.claude/skills/lavish`)
   and share it: the plan, trade-offs, affected files, and the tests you intend to
   run. Iterate on the artifact until the user **explicitly approves**.
   **Do not start implementing before approval.**

3. **Implement.** Create a feature branch (never work on `master`), make the
   change, and run the **scoped tests** for the area you touched (see
   [Scope tests to the changed workspace](#scope-tests-to-the-changed-workspace)).
   Commit on the feature branch.

4. **Validate with `no-mistakes`.** Drive the gate — `/no-mistakes` in Claude
   Code, or `no-mistakes axi run --intent "<the requirement from step 1>"`. The
   pipeline runs *review → test → document → lint → push → PR → CI* and opens a PR
   only after every step passes. See [no-mistakes and the test
   step](#no-mistakes-and-the-test-step) for how scoping applies here.

5. **Merge.** The gate stops at `checks-passed` (PR ready, CI green) and leaves the
   merge to the user. Review the PR and merge it.

## Scope tests to the changed workspace

This repo is a **uv workspace + a React app**, and the workspaces are independent.
**Run only the tests for the area you changed.** A web-only change must not drag in
the heavy PaddleOCR Python suite, and a Python change does not need the React
tests. Match the changed paths to the smallest test set that covers them:

| Changed paths | Tests to run |
|---|---|
| `web/**` (source under `web/src/`) | **Web unit tests** (Vitest): `cd web && npx vitest run` — and **type-check**: `cd web && npm run typecheck` (Go-native `tsc`) |
| `web/**` that changes UI flow / rendered behavior | The unit tests above **and** the **e2e tests** (Playwright): `cd web && npx playwright test` (first time: `npx playwright install`) |
| `image_extraction/**` | **Python tests**: `make test` (runs `uv run pytest image_extraction/`; needs `make sync` first if deps aren't installed — loads PaddleOCR, ~40s) |
| `data/**` (`export_battle_stats.py`, `remove_duplicate_battles.py`) | No unit tests. Validate by running the script — e.g. `make export-stats` — and confirming `web/src/battle_stats.json` regenerates and the web app still loads. |
| `study-battle-report/**` | No automated tests. Validate with a manual OCR run: `uv run python study-battle-report/ocr_battle_log.py [<id>] --use-cache`. |
| `learn/**`, `autojs/**`, `research/**` | No tests — nothing to run. |
| Docs only (`*.md`, `README`, this file) | No tests — nothing to run. |

Notes:
- When a change spans more than one workspace, run each affected workspace's tests.
- Fresh checkouts have no installed deps: web tests need `npm ci` (or `npm install`)
  in `web/`; Python tests need `make sync`.
- The canonical commands live in the [README `Commands`](README.md#commands)
  section and the `Makefile` — prefer them over ad-hoc invocations.

## no-mistakes and the test step

The `no-mistakes` gate has its own **test** step, and the same scoping rule
applies there — it should exercise only the changed workspace:

- **Skip the test step entirely** when the change touches only areas with no tests
  (docs, `autojs/`, `learn/`, etc.):
  `no-mistakes axi run --intent "..." --skip=test`.
- **Otherwise let the test step run**, and rely on this document (surfaced to the
  gate's test agent via `CLAUDE.md`) plus a clear `--intent` so it picks the
  workspace-appropriate tests rather than the full suite. For example, for a
  `web/`-only change the test step should run the web Jest tests, not `make test`.
- A precise `--intent` (the requirement from step 1, enriched with the decisions
  you made) is what lets the review and test steps tell a deliberate choice apart
  from a mistake — keep it complete, not a one-line diff summary.
