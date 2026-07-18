# 三国谋定天下 (演武) — Battle Analytics

A personal analytics tool for the mobile game **三国谋定天下 (演武)**. The pipeline
is: **game screenshots → OCR extraction → per-battle JSON → a deterministic
offline model builder → a single generated artifact → a client-side React app**
that recommends heroes/skills and builds LLM prompts. There is **no backend
server** — the web app is fully client-side.

**Game rules:** see [GAME_RULE.md](GAME_RULE.md). A future (unimplemented,
opt-in) telemetry design is sketched in [FUTURE_MODEL_LOGGING.md](FUTURE_MODEL_LOGGING.md).

## Quickstart

- `web/src/database.json` holds the source data (heroes, skills, hero↔skill mappings).
- Copy game screenshots into `data/images/`.
- `make extract` — OCR the images into `data/battles/*.json`, then rebuild `web/src/recommendation_data.json`.
- `make build-recommendation` — (re)build the recommendation artifact from `data/battles/`.
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
  filtered by a support floor and shrunk by L2. Because the model only sees
  teams players actually chose, exported single-item (`H|`/`S|`) weights then
  get a **season-aware neglect penalty** subtracted — proportional to how
  under-appearing a hero/skill is versus its eligible exposure (battles from its
  release season on), forgiven for genuinely new units — so a long-available-
  but-rarely-picked unit ranks below a strong newcomer (combos are left
  untouched; `neglect_lambda=0` disables it). It emits
  **`web/src/recommendation_data.json`** (schema/catalog metadata, clean battle
  counts, penalty-adjusted model weights + per-feature support/evidence,
  smoothed hero/skill analytics with a season-aware adjusted strength, and a
  leak-free chronological held-out backtest). The build is
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
- `web/` — React (Vite) + MUI, client-side only; TypeScript-enabled (type-check with
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
- `web/src/database.json` — source data for heroes, skills, and hero↔skill mappings.
- `web/src/recommendation_data.json` — **generated** by `build_recommendation_data.py`; don't hand-edit.
- `autojs/` — AutoJS (Android) scripts that capture the screenshots. Device-specific.
- `learn/` — a video downloader backing the `learn-from-video` skill (not part of the
  game pipeline).
- `video/` — a reusable, data-driven **Remotion** template for 9:16 social videos
  (not part of the game pipeline). Everything visible renders from
  `content/video.json`; the visual style mirrors `web/src/theme/theme.ts`. Manual
  narration is the default; TTS is opt-in. See `video/README.md` and
  `video/AGENTS.md`.

## Commands

- `make extract` — OCR all images in `data/images/`, then rebuild the recommendation artifact.
- `make build-recommendation` — regenerate `web/src/recommendation_data.json` from `data/battles/`.
- `make test` — image-extraction Python tests (`pytest image_extraction/`, parallel). ~40s (loads PaddleOCR).
- `make test-data` — recommendation-builder Python tests (`pytest data/`, fast, no PaddleOCR).
- `make web` — start the Vite dev server (port 3000).
- Web unit tests: `cd web && npm test` (Vitest). Type-check: `cd web && npm run typecheck`
  (Go-native `tsc`). E2e: `cd web && npm run test:e2e` (Playwright). Build: `cd web && npm run build`.
- Python runs under **uv** (Python 3.12): `uv run python <script>`. `make sync` installs deps.

## Data conventions (recommendation_data.json)

`web/src/recommendation_data.json` is generated; never hand-edit it. It contains:

- `schema` / `catalog` — model + database metadata (incl. hero→default-skill map,
  per-hero/skill release-season maps that feed the neglect penalty, and a
  `catalog_version` content hash that covers them).
- `battle_counts` — clean total / team1 / team2 wins, invalid count, and a
  deterministic `corpus_version` content hash (no build timestamp — the artifact
  is byte-reproducible).
- `model` — the paired logistic weights keyed by **feature id** (single-item
  `H|`/`S|` weights are penalty-adjusted; see the neglect penalty above, with
  its `neglect_lambda`/`neglect_tau`/`current_season` params recorded here),
  plus per-feature
  `support` (evidence). Feature ids are pipe-joined, with pairs sorted for
  order-independence: `H|hero`, `S|skill`, `HP|a|b`, `HS|hero|skill`, `SP|hero|s1|s2`.
  **Build the same ids in TS via `web/src/services/recommendationModel.ts`; never
  re-derive them inline.** JS `[a,b].sort()` equals Python `sorted()` for these CJK
  (BMP) names — the invariant the keying relies on.
- `analytics` — smoothed per-hero/skill win rates + usage, each row carrying its
  season-aware `adjusted_strength`; hero/skill tables arrive ranked by it.
- `backtest` — leak-free chronological held-out metrics (accuracy, log loss, Brier, n).

## Conventions

- The web app is client-side only; `src/services/api.ts` is an in-memory shim, not HTTP.
- When changing recommendation/prompt logic, protect it with the behavior-focused
  unit tests in `web/src/services/__tests__/` (paired feature extraction, model
  scoring, global optimisation, deterministic output, no runtime opponent).
- Regenerable/scratch dirs are gitignored: `extracted_results/`, `tmp_crops/`,
  `test-results/`, `.lavish/`, plus `study-battle-report/battles/*/` OCR artifacts.

---

_This README is the canonical project doc for humans **and** coding agents. Claude Code
loads it via `CLAUDE.md`; Codex and Rovo Dev via `AGENTS.md`. Directory-scoped agent
notes live in `web/AGENTS.md`, `image_extraction/.agent.md`, and `video/AGENTS.md`._
