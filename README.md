# 三国谋定天下 (演武) — Battle Analytics

A personal analytics tool for the mobile game **三国谋定天下 (演武)**. The core
recommendation pipeline is: **game screenshots → OCR extraction → per-battle
JSON → a deterministic offline model builder → a single generated artifact → a
client-side React app** that recommends heroes/skills and builds LLM prompts.
Recommendation remains fully client-side. Isolated, write-only Cloudflare Pages
Functions collect anonymous draft-choice telemetry and optional community
battle reports without participating in scoring or static page reads. Scheduled
GitHub workflows export only the relevant D1 table into runner-temporary
storage, publish deterministic static artifacts and aggregate checkpoints, and
purge only rows covered by a successfully published checkpoint. Raw telemetry,
submission IDs, and telemetry timestamps are never committed. Accepted
community battle files intentionally retain the exact contributor name, a
normalized upload timestamp, and the selected season so suspicious submission
patterns can be reviewed later; transport submission IDs remain D1-only.

**Game rules:** see [GAME_RULE.md](GAME_RULE.md).

## Quickstart

- `web/public/game-data/database.json` holds the catalog plus the imported
  三谋吕布 hero rankings, complete strong/championship builds, matchup matrix,
  and analysis guide.
- Copy game screenshots into `data/images/`.
- `make extract` — OCR the images into `data/battles/*.json`, then rebuild `web/src/recommendation_data.json`.
- `make build-recommendation` — (re)build the recommendation artifact from
  `data/battles/` plus accepted reports in `data/web-upload/`.
- `make evaluate-recommendation` — run the deterministic grouped rolling-season
  evaluation and write the ignored
  `results_recommendation_evaluation.json`; this never changes production
  weights or `web/src/recommendation_data.json`.
- `make import-web-battles EXPORT=/path/to/web_battle_submissions.sql` —
  revalidate and import one bounded D1 export, update the static leaderboard,
  and rebuild the recommendation artifact in one full batch.
- `make build-telemetry EXPORT=/path/to/round_telemetry.sql` — validate the
  current D1 table export, fold rows newer than the committed cursor, and
  rebuild the public aggregate artifact plus `data/telemetry_state.json`.
- `make import-yanwu` — validate the local five-sheet
  `三谋吕布-演武.xlsx` without writing; `make import-yanwu APPLY=1` atomically
  updates the derived guide data in `database.json`.
- `make web` — start the React dev server (http://localhost:3000).

## Recommendation pipeline

The recommender is an **opponent-aware paired model** trained offline and scored
in the browser:

- **Offline builder** (`data/build_recommendation_data.py`): validates manual
  `data/battles/*.json` and accepted `data/web-upload/*.json` reports (failing
  clearly on unknown/invalid winners rather than counting both teams as losses),
  then trains a single **regularized logistic /
  Bradley-Terry** model. Each complete battle is one paired observation —
  `features(team1) − features(team2)` with the winner as the label. Features are
  hero presence, non-default skill presence, supported hero pairs, assigned
  hero-skill, and supported within-hero skill pairs; sparse interactions are
  filtered by a support floor and shrunk by L2. After fitting, the builder
  applies a deterministic, bounded, always-subtractive popularity penalty to
  atomic `H` / `S` items whose support rate is low relative to season-aware
  exposure. Catalog heroes and standalone skills below the fitting floor use a
  zero fitted baseline, so extremely rare or unused old items receive explicit
  negative weights without fitting unstable one- or two-battle coefficients.
  Newly introduced items receive grace while few battles have occurred since
  introduction. Hero signatures and explicit shadow skills are not synthesized
  at zero support, although observed non-default transfers remain eligible.
  `HP` / `HS` / `SP` interactions remain governed by their support floors and
  L2, and raw `model.support` remains literal evidence. The adjustment adds no
  artifact maps or client-side scoring logic. Catalog introduction seasons are
  required positive integers; a known-season battle that predates one of its
  items fails validation. The builder emits
  **`web/src/recommendation_data.json`** (schema/catalog metadata, clean battle
  counts, model weights + per-feature support/evidence, smoothed hero/skill
  analytics, and a lightweight grouped reserved-season backtest). On the real
  season-tagged corpus, that check trains with the production configuration on
  pre-S15 observations, keeps every group containing an S15 observation out of
  training, and excludes later seasons; legacy or synthetic corpora without S15
  use a whole-group chronological fallback. The build is
  **fail-closed** — if *any* battle file is invalid or unreadable it aborts
  before writing, so a corrupt capture can never partially overwrite the
  artifact — and **byte-reproducible**: no wall-clock or prior-output fields, so
  re-running on the same corpus yields a byte-identical file. A deterministic
  `corpus_version` content hash identifies the runtime training inputs,
  including `Battle.season` because season affects the emitted weights.
- **No runtime opponent.** The user never enters an opponent. A team's score is
  its **relative roster strength** (`w · features(team)`) against the learned
  metagame — *not* an opponent-specific win probability. The opponent term is a
  shared constant across a user's options and is dropped.
- **Client engine** (`web/src/services/recommendationEngine.ts`, backed by
  `recommendationModel.ts`): offered-set picks rank options by **marginal**
  roster-strength improvement over the current pool + evidence. The two-support-
  skill pick is chosen as a **joint pair** (each skill's presence + the best
  feasible hero routing + the within-hero skill-pair bonus when both land on one
  hero), not two independent top-1 picks. The Team Builder uses a conservative,
  confidence-first policy. A hero must independently clear the atomic hero
  (`H`) gate, and every relationship inside a pair/trio must independently clear
  the hero-pair (`HP`) gate. Each gate requires twice the fitted model's support
  floor and at least +0.1 display points, so one excellent hero cannot rescue a
  weak partner. If a qualified group matches two or three members of a known
  team in `web/public/game-data/database.json`, its formation and canonical hero
  slots are preserved; guide data never bypasses the model gates. A skill must
  independently clear both its atomic skill (`S`) and hero-skill (`HS`) gates.
  Positive within-hero skill-pair (`SP`) evidence may rank qualified choices,
  while confident negative `SP` evidence blocks the pairing. Owned guide skills
  keep their canonical slots only after passing the same gates. Unsupported
  heroes and skills stay in the warehouse for manual placement instead of being
  forced into a complete 9-hero/18-skill result.
  The deterministic search runs in a client Web Worker, with a yielding
  main-thread fallback and an in-memory result cache, so it adds no Cloudflare
  Function usage and keeps the loading UI responsive. Players can then drag,
  tap, or use the keyboard to rearrange its three teams. The UI shows each
  team's live **评分** and compact positive evidence (武将配合 / 武将与战法 /
  战法搭配, each with 加分 and reference battle counts); displayed evidence uses
  the same conservative threshold and there is no aggregate 总评分.

### Recommendation evaluation

`make evaluate-recommendation` runs the full evaluation-only harness in
`data/evaluate_recommendation_model.py`. The input path defines exactly two
reported source categories:

- `data/battles/` → `uploaded_by_me`
- `data/web-upload/` → `uploaded_by_others`

Leakage grouping uses capture/upload **sessions**, never calendar days.
Consecutive observations for one session owner remain together while the gap is
at most 30 minutes and the known season is unchanged; the season cap prevents a
later report from changing membership in an earlier locked fold. Web-upload
sessions are partitioned internally by exact contributor identity. Exact and
one-skill-different matchups are tracked separately across sessions. If a
held-out matchup has such a match in an earlier session, that entire earlier
session is removed from training; the large sessions themselves are not merged
into one misleading bootstrap cluster.

The version-1 protocol attempts rolling development evaluation on seasons
10–14: each eligible fold trains only on earlier seasons and validates on the
next whole season. A fold needs at least 20 rows and five capture/upload sessions
on both sides. In the current corpus, S10, S11, S13, and S14 enter configuration
selection; S12 has 393 rows but only four sessions, so it is reported separately
as descriptive and underpowered. Eligible folds tune logistic regularization
`C` and the single/pair feature support floors (`C`: 0.05, 0.1, 0.2, 0.5;
single support: 3, 5, 8; pair support: 5, 8, 12), then compare the `SP`
within-hero skill-pair feature both enabled and ablated across three deliberately
bounded temporal variants:

- `pooled` — all eligible prior seasons receive equal weight;
- `recency_weighted` — older observations decay with a two-season half-life;
- `limited_season_trend` — adds a small linear season interaction only for hero
  and single-skill features.

After that structural configuration is selected, the harness tunes the
season-aware popularity penalty on top of it — the penalty scale `gamma`
(0.0, 0.125, 0.25, 0.5) and the exposure grace `tau` (300, 600, 1200) — with
`gamma` 0 pinning the penalty off. These candidates are evaluation-only, like
the rest of the grid.

After configuration selection, season 15 is the locked final test for this
protocol; it is not historically unseen because the older backtest had already
examined it. Season 16 remains descriptive-only and insufficient for model
selection or a replacement final test. The current `uploaded_by_others` sample
is confined to that small post-final season, so source and season effects cannot
yet be separated. Reports include accuracy, log loss, Brier score, source
breakdowns, and deterministic 95% percentile confidence intervals that resample
whole capture/upload sessions. Pooled development intervals preserve each
rolling season's composition, and their evidence label follows the weakest
season stratum: intervals are omitted below five sessions and marked exploratory
below twenty. The selected candidate's rolling-development score is explicitly
post-selection and non-confirmatory because those same folds chose it; the
locked final comparison is the separate test.

The harness atomically rewrites only the ignored
`results_recommendation_evaluation.json`. Candidate settings are recommendations
for review: they are never fed back into the builder, and no production weight
or support-threshold change happens automatically.

## Community battle uploads

The `/contribute` page is intentionally a small no-auth experiment. A player can
copy a catalog-backed DeepSeek OCR prompt and paste its JSON to prefill every
recognized catalog value in the confirmation form; missing or unrecognized
values remain editable, and final submission still requires strict validation.
The player can also skip OCR and enter both teams manually. The prompt asks
DeepSeek to recognize each hero's first/signature skill before reverse-mapping
the hero, and supplies rough normalized portrait and landscape positions rather
than device-specific pixel crops. The player reviews every hero, skill, winner,
and the two teams' scores from the current model before submission.

The optional public contributor name is stored in a one-year cookie, remains
editable even after an anonymous submission, and may be empty; printable
Unicode is preserved exactly. A separate contribution-season cookie defaults to
the highest numeric season in `database.json`. It does not read or modify the
homepage setup season.

`POST /api/battles` repeats validation against
`web/public/game-data/database.json` and writes through the existing
`TELEMETRY_DB` D1 binding to `web_battle_submissions`. The endpoint is
write-only, requires JSON and an explicit uploader string (the empty string is
anonymous), and rejects browser requests from a different origin. It has no
login: direct clients can still call it, but the live D1 queue is atomically
capped at 500 reports. Once full, new uploads receive HTTP 429 until the daily
job drains it; retries of an existing submission ID remain idempotent. The
separate `/contributors` page fetches the generated static
`web/public/game-data/web_upload_data.json`; neither it nor the homepage reads
D1 or a Function.
`web/public/_routes.json` limits Pages Function execution to `/api/*`, so
Function quota exhaustion does not route static pages or assets through a
Worker.

The daily `update-web-battles.yml` workflow:

1. applies the idempotent D1 table migration and exports only
   `web_battle_submissions` into runner-temporary storage;
2. processes at most 500 rows in ascending AUTOINCREMENT order and revalidates
   each report;
3. allows at most two occurrences of one semantic fingerprint, where ordered
   hero/skill positions, winning lineup, and exact uploader are significant but
   swapping the two team sides is not; the selected season is deliberately not
   part of the fingerprint, so changing it cannot bypass duplicate detection;
4. commits accepted reports with `uploader_name`, normalized `uploaded_at`, and
   `season` moderation metadata, together with the aggregate checkpoint, static
   leaderboard, and a full one-shot recommendation rebuild; and
5. deletes D1 rows only through the high-water mark read back from that
   successful commit.

Malformed and third-or-later duplicate reports advance the checkpoint as
aggregate rejections and receive no leaderboard credit. A transport retry with
the same UUID is idempotent and is separate from semantic duplicate handling.
Both data-publishing workflows share one concurrency group so their generated
data commits cannot race each other.

Before accepting traffic, apply
`web/migrations/0003_web_battle_submissions.sql` to the same D1 database bound
as `TELEMETRY_DB`. The scheduled workflow also applies it idempotently, but the
deployed Function needs the table immediately.

```bash
cd web
pnpm dlx wrangler@4.112.0 d1 execute "$CLOUDFLARE_D1_DATABASE_NAME" \
  --remote \
  --file=migrations/0003_web_battle_submissions.sql \
  --yes
```

## Layout (a uv workspace + React app + local TypeScript agent)

- `image_extraction/` — OCR skill extraction (PaddleOCR). `skill_extraction_system.py`
  is the engine; `batch_extract_battles.py` runs it over `data/images/` and writes
  `data/battles/*.json`. `test_image_extraction.py` validates against golden image
  fixtures in `image_extraction/fixtures/` (~69 MB, intentionally committed).
- `study-battle-report/ocr_battle_log.py` — a **separate** OCR script for battle-log
  screenshots. It deliberately duplicates some OCR/db/fuzzy-match logic from
  `image_extraction` because the two live in different workspaces; do not merge them
  unless they start changing in lockstep.
- `data/build_recommendation_data.py` — the deterministic **offline model
  builder**: validates both battle directories and emits `web/src/recommendation_data.json`
  (the single artifact the web app reads). `data/test_build_recommendation_data.py`
  covers validation/feature-extraction/training and the lightweight grouped
  reserved-season backtest. Manual and web observations share a fail-closed
  maximum-two semantic duplicate policy.
- `data/evaluate_recommendation_model.py` and
  `data/recommendation_evaluation.py` — the deterministic full rolling-season
  experiment harness and its shared session-grouping, near-duplicate, metric,
  and cluster-bootstrap helpers. Its ignored JSON report is evaluation-only.
- `data/import_web_battles.py` — validates a bounded
  `web_battle_submissions` D1 export, advances the aggregate checkpoint over
  accepted and rejected rows, writes accepted reports plus contributor/time/
  season moderation metadata to `data/web-upload/`, renders the static
  leaderboard, and drives a complete recommendation rebuild.
- `data/web_upload_state.json` — generated aggregate checkpoint containing the
  D1 cursor, cumulative accepted/rejected totals, public contributor totals,
  and versioned duplicate-fingerprint counts. It contains no raw battle
  payloads, submission UUIDs, or per-row timestamps.
- `data/build_telemetry_data.py` — the deterministic telemetry builder. It
  fails closed when the D1 export or schema cannot be verified; individual
  malformed, catalog-mismatched, or impossible events are quarantined and
  exposed only as an aggregate `invalid_event_count`. Recommendation scores,
  recommendation positions, and model-version labels are client-reported,
  indicative telemetry: they are checked for bounded shape and internal
  consistency but are not replayed against historical recommendation models.
  Valid rows are reduced atomically to
  `web/public/game-data/telemetry_data.json`. The cumulative schema-v5 artifact
  covers all ten rounds and adds offer/pick, round, position, score-margin, and
  model-disagreement aggregates plus a deterministic online conditional-choice
  model. The model remains
  unavailable until explicit event/estimated-session/disagreement/evaluation
  evidence gates and a quality gate pass. The raw export remains outside the
  repository. During each incremental build, it validates and advances
  `data/telemetry_state.json`, which contains only cumulative counters, a
  fixed-size anonymous session estimate, resumable model state, and the last
  processed D1 row ID. Schema v5 is rendered solely from that checkpoint, so
  old raw rows can be deleted without reducing public totals. Optimizer
  features, optimizer deltas, and model-quality statistics are persisted only
  in groups supported by at least ten new events, so a small batch's
  pool/offer/choice correlations or probability vector are not committed.
  Cumulative recommendation-model labels are capped at 32 entries by folding
  low-support historical labels into an `other` bucket without changing the
  event total.
- `data/telemetry_retention.py` — validates the D1 AUTOINCREMENT migration,
  sequence/cursor safety, and aggregate Wrangler results, then prepares one
  bounded 14-day purge. It also appends an aggregate-only publication report
  (newly validated and cumulative validated event counts, derived from
  committed checkpoints) to the job summary. It never reads or prints row-level
  telemetry.
- `data/telemetry_state.json` — generated, aggregate-only telemetry checkpoint
  committed atomically with the public telemetry artifact. It contains no raw
  event records, event/session identifiers, or timestamps. Its public-style
  offer/pick counters can include small totals, while correlated model features
  and evaluation deltas are support-gated.
- `web/` — React (Vite) + MUI; recommendation and leaderboard reads are
  client-side/static, with isolated write-only Pages Functions for anonymous
  telemetry and battle submissions. TypeScript-enabled (type-check with
  `pnpm typecheck`, backed by the Go-native `typescript@7`). Notable modules:
  - `src/services/recommendationEngine.ts` — offered-set/support/formation
    recommendations + analytics, scored against the artifact.
  - `src/services/recommendationModel.ts` — pure paired-model primitives (feature
    extraction + scoring), kept in lockstep with the Python builder.
  - `src/services/promptGenerator.ts` — builds the LLM prompts (uses model weights + analytics).
  - `src/context/GameContext.tsx` — global game state (`useReducer`); get `dispatch` via `useGame()`.
  - `src/utils/{clipboard,rankings,storage,usePinyin*}` — shared utilities.
  - `src/types/` — hand-written domain types (`domain.ts`, `recommendation.ts`, `game.ts`) for
    `database.json`/`recommendation_data.json` and the game state/reducer.
  - `src/data.ts` — the central typed boundary that imports and casts the bundled JSON once.
- `agent/` — local TypeScript HTTP/CLI runtime for model-backed experiments.
  It uses an OpenAI-compatible provider boundary, is never required by the
  public static site, and hosts one parent LangGraph recommendation workflow.
  Its internal hero, formation/row, and skill subgraphs fill only null values,
  preserve every already-filled value, and then run a read-only team review.
  Already-complete inputs route directly to that review. Its loopback HTTP
  server exposes a typed team-recommendation endpoint to explicitly allowed
  browser origins while keeping generic chat outside browser CORS. See
  [agent/README.md](agent/README.md) for the graph nodes and the
  `pnpm recommend` fixture run.
- `data/import_yanwu_workbook.py` — strict, deterministic five-sheet workbook
  importer. It defaults to a no-write dry run and requires `--apply` to update
  `web/public/game-data/database.json`; the source workbook itself stays
  untracked.
- `web/public/game-data/database.json` — catalog and guide data. Hero rankings,
  known builds, championship references, matchup relationships, and analysis
  are attributed in the guide metadata to 三谋吕布; contact details from the
  workbook are never published.
- `web/public/game-data/telemetry_data.json` — generated, aggregate-only
  player-choice analytics and gated preference-model artifact; updated weekly
  by GitHub Actions.
- `web/public/game-data/web_upload_data.json` — generated static upload totals
  and contributor leaderboard; updated daily with accepted battle imports.
- `web/src/recommendation_data.json` — **generated** by `build_recommendation_data.py`; don't hand-edit.
- `autojs/` — AutoJS (Android) scripts that capture the screenshots. Device-specific.

## Commands

- `make extract` — OCR all images in `data/images/`, then rebuild the recommendation artifact.
- `make build-recommendation` — regenerate `web/src/recommendation_data.json`
  from the manual and accepted web-upload battle directories.
- `make evaluate-recommendation` — run the grouped rolling-season model
  evaluation and write ignored `results_recommendation_evaluation.json`; it
  does not update the production recommendation artifact.
- `make test` — image-extraction Python tests (`pytest image_extraction/`, parallel). ~40s (loads PaddleOCR).
- `make test-data` — the offline data-builder Python suites, including the incremental-checkpoint tests (fast, no PaddleOCR).
- `make test-web-battles` — the web-battle importer plus recommendation-builder
  suites.
- `make test-telemetry` — telemetry-builder and incremental-checkpoint Python
  tests (fast, stdlib-compatible).
- `make web` — start the Vite dev server (port 3000).
- Web unit tests: `cd web && pnpm test` (Vitest). Type-check: `cd web && pnpm typecheck`
  (Go-native `tsc`). E2e: `cd web && pnpm test:e2e` (Playwright). Build: `cd web && pnpm build`.
- Local agent: `cd agent && pnpm start`. Token-free checks:
  `pnpm typecheck && pnpm test && pnpm build`. Explicit live model check:
  `pnpm smoke`. Explicit combined LangGraph hero + formation + skill check:
  `pnpm recommend fixtures/partial-teams.json`.
- Python runs under **uv** (Python 3.12): `uv run python <script>`. `make sync` installs deps.

## Data conventions (recommendation_data.json)

`web/src/recommendation_data.json` is generated; never hand-edit it. It contains:

- `schema` / `catalog` — model + database metadata (incl. hero→default-skill map and a
  `catalog_version` content hash).
- `battle_counts` — clean total / team1 / team2 wins, invalid count, and a
  deterministic `corpus_version` content hash over runtime training inputs,
  including `Battle.season` (no build timestamp — the artifact is
  byte-reproducible).
- `model` — the paired logistic weights keyed by **feature id**, plus per-feature
  `support` (evidence). Feature ids are pipe-joined, with pairs sorted for
  order-independence: `H|hero`, `S|skill`, `HP|a|b`, `HS|hero|skill`, `SP|hero|s1|s2`.
  Atomic `H` / `S` weights include the bounded, always-subtractive
  low-popularity adjustment. Below-floor catalog heroes and standalone skills
  may therefore have penalty-only weights; they are not added to logistic
  fitting. `HP` / `HS` / `SP` remain support-floor/L2-only. Raw `model.support`
  is literal observed evidence, not penalty-adjusted. Zero-support entries are
  omitted from that map to avoid repeating names—the client already interprets
  missing support as `0`. No separate penalty/exposure maps are serialized or
  needed by client scoring.
  **Build the same ids in TS via `web/src/services/recommendationModel.ts`; never
  re-derive them inline.** JS `[a,b].sort()` equals Python `sorted()` for these CJK
  (BMP) names — the invariant the keying relies on.
- `analytics` — smoothed per-hero/skill win rates + usage.
- `backtest` — the lightweight grouped reserved-S15 check for the current
  production configuration (or a whole-group chronological fallback for
  legacy/synthetic corpora), including accuracy, log loss, Brier, cluster-aware
  uncertainty, source breakdowns, and a separate `evaluation_version` for
  evaluation-only source/session metadata beyond the runtime `corpus_version`.
  Battle season belongs to the runtime inputs and therefore changes
  `corpus_version` when corrected.
  Hyperparameter and temporal-variant comparisons live only in the full
  evaluator's ignored result file.

## Conventions

- Recommendation and leaderboard reads are static/client-side only;
  `src/services/api.ts` is an in-memory scoring shim, not HTTP.
  `web/functions/api/telemetry/rounds.js` and
  `web/functions/api/battles.js` are isolated write-only Cloudflare Pages
  endpoints.
- When changing recommendation/prompt logic, protect it with the behavior-focused
  unit tests in `web/src/services/__tests__/` (paired feature extraction, model
  scoring, global optimisation, deterministic output, no runtime opponent).
- Regenerable/scratch dirs are gitignored: `extracted_results/`, `tmp_crops/`,
  `test-results/`, plus `study-battle-report/battles/*/` OCR artifacts.

---

_This README is the canonical project doc for humans **and** coding agents. Claude Code
loads it via `CLAUDE.md`; Codex and Rovo Dev via `AGENTS.md`. Directory-scoped agent
notes live in `web/AGENTS.md` and `image_extraction/.agent.md`._
