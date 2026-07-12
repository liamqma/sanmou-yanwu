# 三国谋定天下 (演武) — Battle Analytics

A personal analytics tool for the mobile game **三国谋定天下 (演武)**. The pipeline
is: **game screenshots → OCR extraction → per-battle JSON → aggregated stats JSON
→ a client-side React app** that recommends heroes/skills and builds LLM prompts.
There is **no backend server** — the web app is fully client-side.

**Game rules:** see [GAME_RULE.md](GAME_RULE.md).

## Quickstart

- `web/src/database.json` holds the source data (heroes, skills, hero↔skill mappings).
- Copy game screenshots into `data/images/`.
- `make extract` — OCR the images into `data/battles/*.json`, then regenerate `web/src/battle_stats.json`.
- `make web` — start the React dev server (http://localhost:3000).

## Layout (a uv workspace + a React app)

- `image_extraction/` — OCR skill extraction (PaddleOCR). `skill_extraction_system.py`
  is the engine; `batch_extract_battles.py` runs it over `data/images/` and writes
  `data/battles/*.json`. `test_image_extraction.py` validates against golden image
  fixtures in `image_extraction/fixtures/` (~69 MB, intentionally committed).
- `study-battle-report/ocr_battle_log.py` — a **separate** OCR script for battle-log
  screenshots. It deliberately duplicates some OCR/db/fuzzy-match logic from
  `image_extraction` because the two live in different workspaces; do not merge them
  unless they start changing in lockstep.
- `data/export_battle_stats.py` — aggregates `data/battles/*.json` into
  `web/src/battle_stats.json` (the file the web app reads). `remove_duplicate_battles.py`
  dedupes battle files.
- `web/` — React (Vite) + MUI, client-side only; TypeScript-enabled (type-check with
  `npm run typecheck`, backed by the Go-native `typescript@7`). Notable modules:
  - `src/services/recommendationEngine.ts` — hero/skill scoring (ported from the Python).
  - `src/services/promptGenerator.ts` — builds the LLM prompts.
  - `src/services/statKeys.ts` — **canonical builders for battle_stats keys; always use these.**
  - `src/services/teamPairStats.ts` — pure pair-ranking helpers (unit-tested).
  - `src/context/GameContext.tsx` — global game state (`useReducer`); get `dispatch` via `useGame()`.
  - `src/utils/{clipboard,tiers,storage,usePinyin*}` — shared utilities.
  - `src/types/` — hand-written domain types (`domain.ts`, `battleStats.ts`, `game.ts`) for
    `database.json`/`battle_stats.json` and the game state/reducer.
  - `src/data.ts` — the central typed boundary that imports and casts the bundled JSON once.
- `web/src/database.json` — source data for heroes, skills, and hero↔skill mappings.
- `web/src/battle_stats.json` — **generated** by `export_battle_stats.py`; don't hand-edit.
- `autojs/` — AutoJS (Android) scripts that capture the screenshots. Device-specific.
- `learn/` — a video downloader backing the `learn-from-video` skill (not part of the
  game pipeline).

## Commands

- `make extract` — OCR all images in `data/images/`, then re-export stats.
- `make export-stats` — regenerate `web/src/battle_stats.json` from `data/battles/`.
- `make test` — Python tests (`pytest image_extraction/`, parallel). ~40s (loads PaddleOCR).
- `make web` — start the Vite dev server (port 3000).
- Web unit tests: `cd web && npx vitest run` (Vitest). Type-check: `cd web && npm run typecheck`
  (Go-native `tsc`). E2e: `cd web && npx playwright test`.
- Python runs under **uv** (Python 3.12): `uv run python <script>`. `make sync` installs deps.

## Data key conventions (battle_stats.json)

Composite keys are strings built to match `export_battle_stats.py`'s serialization.
**Use `web/src/services/statKeys.ts`; never re-derive keys inline.**

- `hero_pair_stats`, `skill_pair_stats`, `hero_combinations` → **sorted**, comma-joined
  (`heroPairKey` / `skillPairKey` / `heroComboKey`).
- `skill_hero_pair_stats` → **fixed order `hero,skill`** (`skillHeroPairKey`), NOT sorted.
- JS `[a,b].sort()` equals Python `sorted()` for these CJK (BMP) names — the invariant the
  keying relies on. Wilson lower-bound scores are precomputed at export time (`.wilson`).

## Conventions

- The web app is client-side only; `src/services/api.ts` is an in-memory shim, not HTTP.
- When changing recommendation/prompt logic, protect it with the golden snapshot tests in
  `web/src/services/__tests__/*.characterization.test.ts` (they assert output is unchanged).
- Regenerable/scratch dirs are gitignored: `extracted_results/`, `tmp_crops/`,
  `test-results/`, `.lavish/`, plus `study-battle-report/battles/*/` OCR artifacts.

---

_This README is the canonical project doc for humans **and** coding agents. Claude Code
loads it via `CLAUDE.md`; Codex and Rovo Dev via `AGENTS.md`. Directory-scoped agent
notes live in `web/AGENTS.md` and `image_extraction/.agent.md`._
