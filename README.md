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
  飞将吕布 hero/skill rankings, complete strong/championship builds, matchup matrix,
  and analysis guide.
- Copy game screenshots into `data/images/`.
- `make extract` — OCR the images into `data/battles/*.json`, then rebuild `web/src/recommendation_data.json`.
- `make sync-yanwu-corpus` — download, checksum-verify, and normalize the
  pinned external Yanwu release when the Git-ignored cache is absent or stale.
- `make build-recommendation` — synchronize the pinned external corpus if
  needed, then rebuild from `data/battles/`, accepted reports in
  `data/web-upload/`, and the external normalized corpus.
- `make evaluate-recommendation` — run the deterministic grouped stable-hash
  evaluation and write the ignored
  `results_recommendation_evaluation.json`; this never changes production
  weights or `web/src/recommendation_data.json`.
- `make import-web-battles EXPORT=/path/to/web_battle_submissions.sql` —
  revalidate and import one bounded D1 export, update the static leaderboard,
  and rebuild the recommendation artifact in one full batch.
- `make build-telemetry EXPORT=/path/to/round_telemetry.sql` — validate the
  current D1 table export, fold rows newer than the committed cursor, and
  rebuild the public aggregate artifact plus `data/telemetry_state.json`.
- `make import-yanwu` — validate the local seven-sheet
  `三谋演武-飞将吕布.xlsx` without writing; `make import-yanwu APPLY=1` atomically
  updates the derived guide data in `database.json`.
- `make web` — start the React dev server (http://localhost:3000).

## Recommendation pipeline

The recommender is an **opponent-aware paired model** trained offline and scored
in the browser:

- **Offline builder** (`data/build_recommendation_data.py`): validates manual
  `data/battles/*.json`, accepted `data/web-upload/*.json`, and the verified
  normalized external Yanwu release (failing clearly on unknown/invalid winners
  rather than counting both teams as losses),
  then trains a single **regularized logistic /
  Bradley-Terry** model. Each complete battle is one paired observation —
  `features(team1) − features(team2)` with the winner as the label. Features are
  hero presence (`H`), non-default tactic presence (`S`), hero pairs (`HP`),
  assigned hero-tactic routes (`HS`), and same-carrier tactic pairs (`SP`). It
  also fits identity-only concrete-team context: team hero-tactic (`THS`),
  team-wide tactic pair (`TSP`), exact hero trio (`HT`), exclusive same-camp
  composition (`HC|2`/`HC|3`), and validated activated bond (`B`). `THS` differs
  from `HS`: it connects every hero in a concrete team to every equipped
  non-default tactic regardless of carrier. `TSP` likewise differs from `SP`:
  it connects tactics anywhere in one team rather than only tactics on one
  hero. Sparse families use separate support floors and regularization. The
  implemented tactic-triple family (`TS3`) remains evaluation-only. After fitting, the
  builder adds a deterministic, bounded, symmetric player-selection count prior
  to atomic `H` / `S` items. Known-season team appearances are compared with a
  uniform expectation across items available in that season: above-expected
  selection adds strength and below-expected selection subtracts it. Counts use
  all six
  hero and twelve non-signature tactic slots, so mirror matches represent two
  player choices. Catalog heroes and ordinary draftable skills below the fitting
  floor use a zero outcome baseline; an observed non-default signature/shadow
  transfer also becomes eligible, while unused signatures are never synthesized
  as standalone tactic weights. Interactions remain governed by family-specific
  support floors and L2; correlated `THS`/`TSP` coefficients receive a reviewed
  `0.5` multiplier and high-order coefficients receive a conservative `0.35`
  multiplier. Raw `model.support` remains literal battle
  evidence. Unknown-season battles still train the logistic model but cannot
  affect the availability-dependent selection prior. The artifact serializes
  each atomic outcome coefficient, count adjustment, appearance count, expected
  count, and final weight for transparent debugging. Catalog introduction
  seasons are required positive integers; a trusted known-season battle that
  predates one of its items fails validation. The builder emits
  **`web/src/recommendation_data.json`** (schema/catalog metadata, clean battle
  counts, model weights + per-feature support/evidence, smoothed hero/skill
  analytics, and a lightweight grouped stable-hash backtest). That check keeps
  capture/upload sessions intact, starts external reports from stable report
  identities, merges exact and one-skill-different matchup clusters, and assigns
  whole groups with the fixed seed `sanmou-grouped-holdout-v2`. Season,
  chronology, winner, and outcome do not determine split membership. The build is
  **fail-closed** — if *any* battle file is invalid or unreadable it aborts
  before writing, so a corrupt capture can never partially overwrite the
  artifact — and **byte-reproducible**: no wall-clock or prior-output fields, so
  re-running on the same corpus yields a byte-identical file. A deterministic
  `corpus_version` content hash identifies the runtime training inputs. Trusted
  `Battle.season` remains model metadata for catalog consistency and
  known-season selection-count expectation. Yanwu season is inferred deterministically
  from first appearance in the pinned cumulative S7–S16 assets.
- **No runtime opponent.** The user never enters an opponent. A team's score is
  its **relative roster strength** (`w · features(team)`) against the learned
  metagame — *not* an opponent-specific win probability. The opponent term is a
  shared constant across a user's options and is dropped.
- **Client engine** (`web/src/services/recommendationEngine.ts`, backed by
  `recommendationModel.ts`): offered-set picks rank options by **marginal**
  roster-strength improvement over the current pool + evidence. That evidence
  covers only newly activated marginal features, never features already active
  in the existing pool. The two-support-skill pick is chosen as a **joint pair**
  (each skill's presence + the best
  feasible hero routing + the within-hero skill-pair bonus when both land on one
  hero), not two independent top-1 picks. The Team Builder uses an
  evidence-only policy. A hero must independently clear the atomic hero
  (`H`) gate, and every relationship inside a pair/trio must independently clear
  the hero-pair (`HP`) gate. Each gate uses the fitted model's family support
  floor: 5 battles for atomic `H`/`S`, 8 for `HP`/`HS`/`SP`, 20 for
  `THS`/`TSP`, 12 for `HC`/`B`, and 50 for high-order `HT`/`TS3`.
  Positive, zero, and negative final weights remain eligible and affect
  ranking; missing or under-supported features still fail, so one well-supported
  hero cannot rescue an unobserved partner. If a qualified group matches two or three
  members of a known team in `web/public/game-data/database.json`, its formation
  and canonical hero slots are preserved; guide data never bypasses the model
  gates. A skill must independently clear both its atomic skill (`S`) and
  hero-skill (`HS`) gates.
  Supported within-hero skill-pair (`SP`) evidence, including negative weights,
  ranks qualified model-only choices without vetoing the pairing. For a
  qualified 2/3 or 3/3 known-team core, owned non-signature guide skills assigned
  to the present guide heroes are globally reserved in their canonical slots
  before model-only fallback, but only after each route passes the same `S` and
  `HS` gates; an absent guide hero is never inserted and makes no skill claim.
  Global conflict resolution keeps each skill unique. It first maximizes
  attainable guide-slot cardinality across all selected teams, then preserves
  the existing guide-slot priority (including exact 3/3 claims over partial 2/3
  claims), guide provenance, and canonical slots. Two bounded deterministic
  beams rank otherwise priority-equivalent guide variants and globally unique
  assignments by the canonical enabled score summed independently over each
  concrete team, then support and a stable key. Thus THS/TSP (and any future
  enabled TS3) influence guide alternatives without flattening multiple teams
  or displacing a higher-priority claim. New
  team-context families are deliberately
  deferred during offered-set ranking and support picks: those paths retain the
  existing bounded `HS`/`SP` routing and never treat an unpartitioned pool as a
  team. `THS`/`TSP`/`HT`/`TS3`/`HC`/`B` activate only for one exact concrete
  three-hero team. Final formation scoring evaluates each of the three teams
  independently, so no bond or tactic relationship crosses team boundaries and
  one tactic cannot receive credit in multiple hypothetical teams. The
  hero-group search considers supported pairs
  and trios together. It first prioritizes evidence-qualified exact 3/3 guide
  cores that can use at least one owned, qualified canonical guide skill, then
  ranks a bounded deterministic candidate set by fully assigned total model
  gain before hero coverage or complete-trio count. The beam reserves the best
  extension for every exact-guide core so a low raw-weight curated core is
  not pruned. Unsupported heroes and skills stay in the warehouse for manual
  placement instead of being forced into a complete 9-hero/18-skill result.
  The deterministic search runs in a client Web Worker, with a yielding
  main-thread fallback and an in-memory result cache, so it adds no Cloudflare
  Function usage and keeps the loading UI responsive. Players can then drag,
  tap, or use the keyboard to rearrange its three teams. The UI shows each
  team's live **评分** and compact positive evidence (武将配合: HP/HT/HC/B;
  武将与战法: HS/THS; 战法搭配: SP/TSP/TS3, each with 加分 and reference battle
  counts); displayed evidence keeps
  a +0.1 visibility floor so tiny accepted gains are not rendered as “+0.0”, and
  there is no aggregate 总评分.

### Recommendation evaluation

`make evaluate-recommendation` runs the full evaluation-only harness in
`data/evaluate_recommendation_model.py`. Inputs retain three reported source
categories:

- `data/battles/` → `uploaded_by_me`
- `data/web-upload/` → `uploaded_by_others`
- pinned normalized Yanwu release → `external_yanwu`

Protocol version 2 is deliberately **season-independent**. Leakage groups keep
capture/upload sessions together using a 30-minute inactivity window (web
uploads are partitioned first by exact contributor identity). Each external
Yanwu report starts from its immutable report identity rather than making the
release one giant group. Exact and one-skill-different matchup clusters are then
merged with those initial groups. Winner and outcome are excluded from matchup
identity, and season is never read while grouping or splitting.

The locked test was selected once from the pre-Yanwu corpus: 20% of its whole
leakage groups by the fixed seed
`sanmou-grouped-holdout-v2:pre-yanwu-locked-test`. Its source-qualified battle
identities and original group IDs are persisted in
`data/evaluation/locked-pre-yanwu-test.json`, so later manual captures or web
uploads cannot enter, displace, or rename the locked population. Any new or
Yanwu group that touches a locked-test session or exact/near-duplicate matchup
is removed. The remaining whole pre-Yanwu and eligible Yanwu groups are divided
into training and development with the independent fixed seed
`sanmou-grouped-holdout-v2:development` (20% development). The test is not used
for configuration selection.

Training/development groups tune logistic regularization `C`, family-specific
support floors, the `SP` within-hero skill-pair ablation, and the hero/skill
selection-count prior strengths, smoothing, and log-ratio bound. A bounded
staged ablation then compares (1) the pre-context production baseline, (2)
`THS`/`TSP`, (3) `HC`/`B`, (4) `HT`, and (5) `TS3`. Optional high-order stages
must improve both development log loss and Brier score; TS3 also requires every
constituent `TSP` pair to clear the selected team-context floor. Season-recency
weighting and season-trend variants were removed rather than replaced with
another temporal assumption. Selected and current production configurations are
refit on training plus development, then scored once on the locked test. The
production count prior is a reviewed player-selection domain assumption, not a
claim that it optimizes held-out probability calibration; the report therefore
shows its development metrics both with and without the prior. The report also
includes split source/outcome balance, accuracy, log loss, Brier score, feature
coverage, source breakdowns, and deterministic 95% percentile confidence
intervals that resample whole locked-test leakage groups. Intervals are omitted
below five groups and marked exploratory below twenty.

The same report includes the controlled Yanwu comparison. A baseline production
configuration is trained on all non-test pre-Yanwu groups; a candidate with the
identical configuration adds all eligible Yanwu groups; both score the exact
same locked pre-Yanwu rows. It reports sample/group counts, coverage, paired
metric deltas and uncertainty, plus source-level results where group evidence
permits. The report labels the result inconclusive and makes no improvement
claim unless the paired 95% intervals support better accuracy, Brier, and log
loss together.

The harness atomically rewrites only the ignored
`results_recommendation_evaluation.json`. Candidate settings are recommendations
for review: they are never fed back into the builder, and no production weight
or support-threshold change happens automatically. The reviewed PR-1 decision
is documented in [`data/evaluation/TEAM_CONTEXT_EVALUATION.md`](data/evaluation/TEAM_CONTEXT_EVALUATION.md):
production enables `THS`, `TSP`, `HC`, `B`, and support-50 `HT`; `TS3` is
implemented but disabled because its development Brier score regressed.

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

### Pinned external Yanwu corpus

`data/external/yanwu-release.json` pins all ten immutable S7–S16 assets from the
second [CharlesWang505/yanwu-battle-reports](https://github.com/CharlesWang505/yanwu-battle-reports)
release, including each attachment's season, byte size, SHA-256, report count,
schema, attribution, and
[CC BY 4.0 licence](https://github.com/CharlesWang505/yanwu-battle-reports/blob/main/LICENSE).
Adopting a later release is a reviewed manifest update; scheduled jobs never
follow a mutable “latest” URL.

The upstream attachments are cumulative snapshots: all S7 report IDs recur in
S8, and so on through S16. Normalization processes assets in ascending season
order, keeps each report ID only at its first appearance, and assigns that
attachment's numeric season. Every later occurrence must be otherwise identical
(after removing only the rewritten raw season field), and every later asset must
contain all prior IDs; conflicts or removals fail closed. This turns 39,898
source rows into 8,154 unique report identities before ordinary completeness
filtering, without multiplying repeated reports or assigning conflicting
seasons. Season remains descriptive/model metadata and never affects evaluation
split membership.

`make sync-yanwu-corpus` verifies and normalizes the release into
`.cache/yanwu/`. The raw and normalized files are regenerable and Git-ignored.
A warm cache makes no network request: sync checksum-verifies every pinned raw
asset, deterministically regenerates the expected normalized value, and accepts
the normalized cache only when it matches. A cold cache downloads each asset to
a temporary file, verifies the manifest before publication, and normalizes
atomically. Unknown catalog names or a checksum/schema/count/cumulative-contract
mismatch fails closed.
`make build-recommendation` depends on this sync step, so it never silently
falls back to a local-only model.

The daily web-battle workflow restores `.cache/yanwu/` through GitHub Actions
using a key derived from the manifest, normalizer, and game catalog. If GitHub
evicts the cache, the next job reconstructs it once from the immutable release.
Model fitting consumes only the verified local normalized file and remains
deterministic and offline.

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
  builder**: validates all three battle sources and emits `web/src/recommendation_data.json`
  (the single artifact the web app reads). `data/test_build_recommendation_data.py`
  covers validation/feature-extraction/training and the lightweight grouped
  stable-hash backtest. Manual and web observations share a fail-closed
  maximum-two semantic duplicate policy.
- `data/evaluate_recommendation_model.py`,
  `data/recommendation_evaluation.py`, and
  `data/evaluation/locked-pre-yanwu-test.json` — the deterministic full
  grouped-holdout experiment harness, its checked-in locked-test identities,
  and shared stable-hash split, session grouping, near-duplicate, metric, and
  cluster-bootstrap helpers. Its ignored JSON report is evaluation-only.
- `data/import_web_battles.py` — validates a bounded
  `web_battle_submissions` D1 export, advances the aggregate checkpoint over
  accepted and rejected rows, writes accepted reports plus contributor/time/
  season moderation metadata to `data/web-upload/`, renders the static
  leaderboard, and drives a complete recommendation rebuild.
- `data/yanwu_corpus.py`, `data/sync_yanwu_corpus.py`, and
  `data/external/yanwu-release.json` — pin, verify, normalize, and cache the
  external CC BY 4.0 release without committing its large data artifacts.
- `data/web_upload_state.json` — generated aggregate checkpoint containing the
  D1 cursor, cumulative accepted/rejected totals, public contributor totals,
  and versioned duplicate-fingerprint counts. It contains no raw battle
  payloads, submission UUIDs, or per-row timestamps.
- `data/build_telemetry_data.py` — the deterministic telemetry builder. It
  fails closed when the D1 export or schema cannot be verified; individual
  malformed, catalog-mismatched, or impossible events are quarantined and
  exposed only as an aggregate `invalid_event_count`. Recommendation scores,
  recommendation positions, and model-version labels are client-reported,
  indicative telemetry. Current browser labels use
  `schema:corpus:relationship`; ingestion and static readers also accept the
  historical `schema:corpus` form. Both are checked for bounded shape and
  internal consistency but are not replayed against historical recommendation
  models.
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
  It uses an OpenAI-compatible Responses API provider boundary, is never
  required by the public static site, and hosts one parent LangGraph
  recommendation workflow.
  Its internal hero, formation/row, and skill subgraphs fill only null values,
  preserve every already-filled value, and then run a read-only team review.
  Already-complete inputs route directly to that review. Its loopback HTTP
  server exposes a typed team-recommendation endpoint to explicitly allowed
  browser origins while keeping generic chat outside browser CORS. See
  [agent/README.md](agent/README.md) for the graph nodes and the
  `pnpm recommend` fixture run.
- `data/import_yanwu_workbook.py` — strict, deterministic seven-sheet workbook
  importer. It defaults to a no-write dry run and requires `--apply` to update
  `web/public/game-data/database.json`; the source workbook itself stays
  untracked.
- `web/public/game-data/database.json` — catalog and guide data. Hero/skill rankings,
  known builds, championship references, matchup relationships, and analysis
  are attributed in the guide metadata to 飞将吕布; contact details from the
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
- `make sync-yanwu-corpus` — populate or validate the Git-ignored pinned
  external corpus cache; a valid warm cache makes no network request.
- `make build-recommendation` — synchronize the pinned release if needed and
  regenerate `web/src/recommendation_data.json` from manual, accepted
  web-upload, and external battles.
- `make evaluate-recommendation` — run the grouped stable-hash model
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

- `schema` / `catalog` — model + database metadata, including the
  hero→default-skill map and availability-oriented `catalog_version`. A separate
  `relationship_version` hashes exactly the serialized hero→camp map and
  identity-only bond contracts used for scoring, so camp/bond maintenance
  invalidates scoring caches without changing the availability-only
  `catalog_version` used for telemetry catalog validation.
  Runtime bond contracts contain only name, required count, and sorted members;
  Chinese condition strings and effect content are validated offline and are
  not shipped for runtime parsing. Bond content receives only NFKC/whitespace
  normalization for fail-closed duplicate-contract detection; this is syntactic
  validation, not semantic description parsing or mechanics extraction.
- `battle_counts` — clean total / team1 / team2 wins, invalid count, and a
  deterministic `corpus_version` content hash over runtime training inputs.
  Trusted `Battle.season`, including the first-appearance season inferred for
  Yanwu, remains part of that hash because it can affect catalog checks and
  selection-count adjustment (no build timestamp — the artifact is
  byte-reproducible).
- `model` — the paired logistic weights keyed by **feature id**, plus per-feature
  `support` (evidence). Feature ids are pipe-joined, with unordered operands
  sorted for order-independence: `H|hero`, `S|skill`, `HP|a|b`,
  `HS|hero|skill`, `SP|hero|s1|s2`, `THS|hero|skill`, `TSP|s1|s2`,
  `HT|h1|h2|h3`, `TS3|s1|s2|s3`, `HC|2`/`HC|3`, and `B|bond`.
  Atomic `H` / `S` weights combine the regularized outcome coefficient with a
  bounded, symmetric, season-aware player-selection count adjustment. Its team
  appearances and expected counts exclude unknown-season rows, although those
  rows still train the logistic fit. Below-floor catalog heroes and standalone
  skills may therefore have count-prior-only weights; they are not added to
  logistic fitting. Context families remain support-floor/L2-only, with explicit
  post-fit multipliers recorded in the model metadata. Support is counted per
  battle in which a feature occurs on either side; a mirror occurrence on both
  sides still counts once. Raw `model.support` is literal battle evidence, not
  count-adjusted. Zero-support
  entries are omitted from that map because the client interprets missing as
  `0`. `model.atomic_components` exposes the outcome/count decomposition and
  `model.selection_prior` records its deterministic parameters.
  **Build the same ids in TS via `web/src/services/recommendationModel.ts`; never
  re-derive them inline.** JS `[a,b].sort()` equals Python `sorted()` for these CJK
  (BMP) names — the invariant the keying relies on. HPS/carrier-skill-teammate
  triples and tactic sets of size four or greater (`TS4+`) are intentionally
  excluded to control sparsity and attribution ambiguity. Mechanics (`MECH`) are
  explicitly deferred to PR 2: a separate LLM-powered catalog-maintenance skill
  will infer and present reviewed status relationships during periodic catalog
  maintenance. PR 1 performs no semantic description parsing, description
  tokenization, Chinese NLP, mechanics extraction, embeddings, or runtime effect
  parsing. Its only content handling is the syntactic normalization used for
  offline duplicate-bond validation described above.
- `analytics` — smoothed per-hero/skill win rates + usage.
- `backtest` — the lightweight grouped stable-hash check for the current
  production configuration, including accuracy, log loss, Brier,
  cluster-aware uncertainty, source/outcome split balance, source breakdowns,
  and a separate `evaluation_version` for evaluation-only source/session
  metadata beyond the runtime `corpus_version`. Capture/upload sessions and
  exact/near-duplicate matchups stay together; season and outcome do not affect
  membership. Hyperparameter and controlled-corpus comparisons live only in the
  full evaluator's ignored result file.

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
