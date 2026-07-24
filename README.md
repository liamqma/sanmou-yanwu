# 三国谋定天下 (演武) — Battle Analytics

A personal analytics tool for the mobile game **三国谋定天下 (演武)**. The core
recommendation pipeline is: **game screenshots → OCR extraction → per-battle
JSON → a deterministic offline model builder → a single generated artifact → a
client-side React app** that recommends heroes/skills and builds LLM prompts.
Recommendation remains fully client-side. A small Cloudflare Pages Function can
collect anonymous draft-choice telemetry without participating in scoring. A
weekly GitHub workflow exports only that D1 table into runner-temporary storage
and publishes a deterministic, aggregate-only static artifact together with an
internal aggregate-only checkpoint; raw telemetry is never committed or
uploaded as a workflow artifact.

**Game rules:** see [GAME_RULE.md](GAME_RULE.md). The phased telemetry design is
specified in [TELEMETRY_IMPLEMENTATION_PLAN.md](TELEMETRY_IMPLEMENTATION_PLAN.md).

## Quickstart

- `web/public/game-data/database.json` holds the source data (heroes, skills, hero↔skill mappings).
- Copy game screenshots into `data/images/`.
- `make extract` — OCR the images into `data/battles/*.json`, then rebuild `web/src/recommendation_data.json`.
- `make build-recommendation` — (re)build the recommendation artifact from `data/battles/`.
- `make build-telemetry EXPORT=/path/to/round_telemetry.sql` — validate a D1
  table export and rebuild the public aggregate artifact plus
  `data/telemetry_state.json`.
- `make web` — start the React dev server (http://localhost:3000).

## Recommendation pipeline

The recommender is an **opponent-aware paired model** trained offline and scored
in the browser:

- **Offline builder** (`data/build_recommendation_data.py`): validates
  `data/battles/*.json` (failing clearly on unknown/invalid winners rather than
  counting both teams as losses), then trains a single **regularized logistic /
  Bradley-Terry** model. Each complete battle is one paired observation —
  `features(team1) − features(team2)` with the winner as the label. Features are
  hero presence, non-default skill presence, supported hero pairs, assigned
  hero-skill, and supported within-hero skill pairs; sparse interactions are
  filtered by a support floor and shrunk by L2. It emits
  **`web/src/recommendation_data.json`** (schema/catalog metadata, clean battle
  counts, model weights + per-feature support/evidence, smoothed hero/skill
  analytics, and a leak-free chronological held-out backtest). The build is
  **fail-closed** — if *any* battle file is invalid or unreadable it aborts
  before writing, so a corrupt capture can never partially overwrite the
  artifact — and **byte-reproducible**: no wall-clock or prior-output fields, so
  re-running on the same corpus yields a byte-identical file. A deterministic
  `corpus_version` content hash identifies the training data.
- **No runtime opponent.** The user never enters an opponent. A team's score is
  its **relative roster strength** (`w · features(team)`) against the learned
  metagame — *not* an opponent-specific win probability. The opponent term is a
  shared constant across a user's options and is dropped.
- **Client engine** (`web/src/services/recommendationEngine.ts`, backed by
  `recommendationModel.ts`): offered-set picks rank options by **marginal**
  roster-strength improvement over the current pool + evidence. The two-support-
  skill pick is chosen as a **joint pair** (each skill's presence + the best
  feasible hero routing + the within-hero skill-pair bonus when both land on one
  hero), not two independent top-1 picks. The final formation enumerates a
  deterministic bounded beam of disjoint 3×3 hero partitions (each level unions a
  strength-ranked and a structure-ranked slice so structurally good partitions
  survive the prune), caps full evaluation at 1,920 partitions, then for **each** candidate performs the global unique
  18-skill assignment (2/hero, never a hero's signature skill) and scores every
  team with the full model. The winner is chosen in two global stages: (1) find
  the single maximum **top-two-team** summed strength and retain every formation
  within a fixed display-point band of it — so the two strongest main teams are
  prioritised over the third; (2) rank the retained set by hidden soft
  preferences sourced from `database.json` (exactly one 输出核心 per team, then
  exactly one 体系核心, then same-camp teams), then the stronger third team, total
  strength, and a deterministic key. The soft role/camp preferences never
  override skill/signature feasibility and never widen the band. From that same
  already-scored retained set, the engine returns up to three deterministic,
  distinct formation options: the winner first, then alternatives chosen to
  minimise team overlap without sacrificing the strength band. The UI shows
  each team's **评分** and compact positive evidence (武将配合 / 武将与战法 /
  战法搭配, each with 加分 and reference battle counts); there is no aggregate
  总评分.

## Layout (a uv workspace + a React app)

- `image_extraction/` — OCR skill extraction (PaddleOCR). `skill_extraction_system.py`
  is the engine; `batch_extract_battles.py` runs it over `data/images/` and writes
  `data/battles/*.json`. `test_image_extraction.py` validates against golden image
  fixtures in `image_extraction/fixtures/` (~69 MB, intentionally committed).
- `study-battle-report/ocr_battle_log.py` — a **separate** OCR script for battle-log
  screenshots. It deliberately duplicates some OCR/db/fuzzy-match logic from
  `image_extraction` because the two live in different workspaces; do not merge them
  unless they start changing in lockstep.
- `data/build_recommendation_data.py` — the deterministic **offline model
  builder**: validates `data/battles/*.json` and emits `web/src/recommendation_data.json`
  (the single artifact the web app reads). `data/test_build_recommendation_data.py`
  covers validation/feature-extraction/training/backtest. There is intentionally
  **no** `remove_duplicate_battles.py`: legitimate repeated battles are kept as
  separate observations, and duplicates are pruned by hand only.
- `data/build_telemetry_data.py` — the deterministic telemetry builder. It
  fails closed when the D1 schema, catalog, or retained model contract cannot
  be verified; individual malformed or impossible events are quarantined and
  exposed only as an aggregate `invalid_event_count`. Valid rows are reduced
  atomically to `web/public/game-data/telemetry_data.json` after UI eligibility
  and recorded-score verification. Schema v3 adds offer/pick, round, position,
  score-margin, and model-disagreement aggregates plus a deterministic,
  regularized conditional-choice model. The model remains unavailable until
  explicit event/session/disagreement/held-out evidence gates and a held-out
  quality gate pass. The raw export remains outside the repository. Before
  publishing a new recommendation model, archive the previous artifact in
  `data/recommendation_models/` so historical scores remain verifiable. During
  the incremental-retention observation rollout, the builder also validates
  and advances `data/telemetry_state.json`, which contains only cumulative
  counters, a fixed-size anonymous session estimate, resumable model state, and
  the last processed D1 row ID. The public schema-v3 artifact is still rebuilt
  from the complete export; no raw D1 deletion is enabled yet. Optimizer
  features, optimizer deltas, and shadow-model quality statistics are persisted
  only in groups supported by at least ten new events, so a small batch's
  pool/offer/choice correlations or probability vector are not committed.
- `data/telemetry_state.json` — generated, aggregate-only telemetry checkpoint
  committed atomically with the public telemetry artifact. It contains no raw
  event records, event/session identifiers, or timestamps. Its public-style
  offer/pick counters can include small totals, while correlated model features
  and evaluation deltas are support-gated.
- `web/` — React (Vite) + MUI; recommendation is client-side, with an isolated
  Pages Function for anonymous telemetry. TypeScript-enabled (type-check with
  `npm run typecheck`, backed by the Go-native `typescript@7`). Notable modules:
  - `src/services/recommendationEngine.ts` — offered-set/support/formation
    recommendations + analytics, scored against the artifact.
  - `src/services/recommendationModel.ts` — pure paired-model primitives (feature
    extraction + scoring), kept in lockstep with the Python builder.
  - `src/services/promptGenerator.ts` — builds the LLM prompts (uses model weights + analytics).
  - `src/context/GameContext.tsx` — global game state (`useReducer`); get `dispatch` via `useGame()`.
  - `src/utils/{clipboard,tiers,storage,usePinyin*}` — shared utilities.
  - `src/types/` — hand-written domain types (`domain.ts`, `recommendation.ts`, `game.ts`) for
    `database.json`/`recommendation_data.json` and the game state/reducer.
  - `src/data.ts` — the central typed boundary that imports and casts the bundled JSON once.
- `web/public/game-data/database.json` — source data for heroes, skills, and hero↔skill mappings.
- `web/public/game-data/telemetry_data.json` — generated, aggregate-only
  player-choice analytics and gated preference-model artifact; updated weekly
  by GitHub Actions.
- `web/src/recommendation_data.json` — **generated** by `build_recommendation_data.py`; don't hand-edit.
- `autojs/` — AutoJS (Android) scripts that capture the screenshots. Device-specific.

## Commands

- `make extract` — OCR all images in `data/images/`, then rebuild the recommendation artifact.
- `make build-recommendation` — regenerate `web/src/recommendation_data.json` from `data/battles/`.
- `make test` — image-extraction Python tests (`pytest image_extraction/`, parallel). ~40s (loads PaddleOCR).
- `make test-data` — both named offline data-builder Python suites (fast, no PaddleOCR).
- `make test-telemetry` — telemetry-builder and incremental-checkpoint Python
  tests (fast, stdlib-compatible).
- `make web` — start the Vite dev server (port 3000).
- Web unit tests: `cd web && npm test` (Vitest). Type-check: `cd web && npm run typecheck`
  (Go-native `tsc`). E2e: `cd web && npm run test:e2e` (Playwright). Build: `cd web && npm run build`.
- Python runs under **uv** (Python 3.12): `uv run python <script>`. `make sync` installs deps.

## Data conventions (recommendation_data.json)

`web/src/recommendation_data.json` is generated; never hand-edit it. It contains:

- `schema` / `catalog` — model + database metadata (incl. hero→default-skill map and a
  `catalog_version` content hash).
- `battle_counts` — clean total / team1 / team2 wins, invalid count, and a
  deterministic `corpus_version` content hash (no build timestamp — the artifact
  is byte-reproducible).
- `model` — the paired logistic weights keyed by **feature id**, plus per-feature
  `support` (evidence). Feature ids are pipe-joined, with pairs sorted for
  order-independence: `H|hero`, `S|skill`, `HP|a|b`, `HS|hero|skill`, `SP|hero|s1|s2`.
  **Build the same ids in TS via `web/src/services/recommendationModel.ts`; never
  re-derive them inline.** JS `[a,b].sort()` equals Python `sorted()` for these CJK
  (BMP) names — the invariant the keying relies on.
- `analytics` — smoothed per-hero/skill win rates + usage.
- `backtest` — leak-free chronological held-out metrics (accuracy, log loss, Brier, n).

## Conventions

- Recommendation is client-side only; `src/services/api.ts` is an in-memory
  scoring shim, not HTTP. `web/functions/api/telemetry/rounds.js` is an isolated
  write-only Cloudflare Pages telemetry endpoint.
- When changing recommendation/prompt logic, protect it with the behavior-focused
  unit tests in `web/src/services/__tests__/` (paired feature extraction, model
  scoring, global optimisation, deterministic output, no runtime opponent).
- Regenerable/scratch dirs are gitignored: `extracted_results/`, `tmp_crops/`,
  `test-results/`, plus `study-battle-report/battles/*/` OCR artifacts.

---

_This README is the canonical project doc for humans **and** coding agents. Claude Code
loads it via `CLAUDE.md`; Codex and Rovo Dev via `AGENTS.md`. Directory-scoped agent
notes live in `web/AGENTS.md` and `image_extraction/.agent.md`._
