# 三国谋定天下 (演武) battle analytics

A personal analytics tool for the mobile game 三国谋定天下 (演武). Game
screenshots go through OCR into per-battle JSON. An offline builder trains a
model on those battles and writes one generated artifact, and a React app uses
that artifact in the browser to recommend heroes and skills and to build LLM
prompts.

Recommendation runs entirely in the browser. Two write-only Cloudflare Pages
Functions collect anonymous draft-choice telemetry and optional community
battle reports; neither takes part in scoring or in serving pages. Scheduled
GitHub workflows export the relevant D1 table, publish static files and
aggregate checkpoints, and then delete only the rows those checkpoints cover.

Related docs:

- [GAME_RULE.md](GAME_RULE.md): the draft rules the app models.
- [DEVELOPMENT.md](DEVELOPMENT.md): the plan, implement, and validate
  lifecycle, and which tests each change needs.
- [web/README.md](web/README.md): the React app, Pages Functions, and
  deployment.
- [data/evaluation/](data/evaluation/): recorded model decisions.

## Commands

Python runs under uv (Python 3.12). Run `make sync` once to install
dependencies.

| Command | What it does |
|---|---|
| `make extract` | OCR the screenshots in `data/images/` into `data/battles/*.json`, then rebuild the recommendation artifact. |
| `make sync-yanwu-corpus` | Download, verify, and normalize the pinned Yanwu release into `.cache/yanwu/`. A valid cache makes no network request. |
| `make build-recommendation` | Sync the Yanwu cache if needed, then rebuild `web/src/recommendation_data.json` from all three battle sources. |
| `make evaluate-recommendation` | Run the full grouped evaluation and write the ignored `results_recommendation_evaluation.json`. It never changes production weights. |
| `make import-web-battles EXPORT=<sql>` | Import one D1 export of community reports, update the leaderboard, and rebuild the artifact. |
| `make build-telemetry EXPORT=<sql>` | Fold new rows from a D1 telemetry export into `data/telemetry_state.json` and rebuild the public telemetry file. |
| `make import-yanwu [APPLY=1]` | Check the local seven-sheet guide workbook. With `APPLY=1`, update the guide data in `database.json`. See the [import workflow](.agents/manual-skills/update-game-database-from-csv/SKILL.md#import-workflow). |
| `make web` | Start the Vite dev server on http://localhost:3000. |
| `make test` | Image-extraction and battle-report OCR tests (about 40 s, because it loads PaddleOCR). |
| `make test-data` | Offline data-builder tests, including the incremental checkpoint tests. |
| `make test-web-battles` | Web-battle importer and recommendation-builder tests. |
| `make test-telemetry` | Telemetry builder and checkpoint tests. |

The web commands (`pnpm test`, `pnpm typecheck`, `pnpm test:e2e`, and
`pnpm build`) run from `web/`; see
[web/README.md](web/README.md#getting-started).
[DEVELOPMENT.md](DEVELOPMENT.md) says which checks a change needs.

## Recommendation pipeline

`data/build_recommendation_data.py` trains one L2-regularized logistic
(Bradley-Terry) model from three sources: the owner's captures in
`data/battles/`, accepted community reports in `data/web-upload/`, and the
pinned Yanwu corpus. Each complete battle is one paired example,
`features(team1) - features(team2)`, labelled with the winner.

The build fails closed. Any invalid or unreadable battle file, including one
with an unknown winner, stops it before it writes anything, and a battle whose
season predates one of its heroes or skills is invalid. The build is also
byte-reproducible: it records no timestamps, and `battle_counts.corpus_version`
hashes the training inputs.

### Feature families

A feature is a yes/no fact about one team. Each feature has one weight and a
support count, which is the number of battles it appears in. The builder fits a
feature only when its support reaches the family's floor.

| Family | Feature id | Fact | Support floor | After fitting |
|---|---|---|---|---|
| `H` | `H\|hero` | hero present | 5 | plus the appearance prior |
| `S` | `S\|skill` | non-default skill present | 5 | plus the appearance prior |
| `HP` | `HP\|a\|b` | two heroes on the team | 8 | plus a positive-only appearance lift |
| `HS` | `HS\|hero\|skill` | hero carries the skill | 8 | plus a positive-only appearance lift |
| `SP` | `SP\|hero\|s1\|s2` | two skills on the same hero | 8 | |
| `THS` | `THS\|hero\|skill` | hero and skill anywhere in the same team | 20 | multiplied by 0.5 |
| `TSP` | `TSP\|s1\|s2` | two skills anywhere in the same team | 20 | multiplied by 0.5 |
| `HT` | `HT\|h1\|h2\|h3` | exact hero trio | 50 | multiplied by 0.35 |
| `HC` | `HC\|2`, `HC\|3` | two or three heroes from one camp | 12 | |
| `B` | `B\|bond` | an activated bond | 12 | |
| `TS3` | `TS3\|s1\|s2\|s3` | three skills in the same team | 50 | evaluation only, disabled in production |

`THS`, `TSP`, `HT`, `TS3`, `HC`, and `B` apply only to one complete three-hero
team, never to an unpartitioned pool. Hero, skill, and teammate triples and
sets of four or more skills are left out on purpose to limit sparsity and
ambiguous attribution.

The owner's screenshots come from 州内淘汰赛, a late tournament stage that only
stronger teams reach, so the builder treats how often a hero or skill appears
as evidence of strength. After fitting, `H` and `S` weights get a bounded,
symmetric adjustment from observed versus expected appearances in each season,
and `HP` and `HS` get a bounded lift that is never negative. A catalog hero or
draftable skill below the fitting floor can therefore still have a prior-only
weight, but a relationship never gets a weight below its floor. The strengths,
formulas, and decision are in
[APPEARANCE_PRIOR_EVALUATION.md](data/evaluation/APPEARANCE_PRIOR_EVALUATION.md).

### Scoring in the browser

The app never asks for an opponent. A team's score is `w · features(team)`:
its strength relative to the learned metagame, not a win probability against a
particular team. When the app compares options, the opponent's score is the
same for every option, so it drops out.

`web/src/services/recommendationEngine.ts`, built on `recommendationModel.ts`,
scores the draft:

- An offered set ranks by its marginal gain: the summed weights of the features
  it newly activates on top of the current pool. The evidence shown covers only
  those new features. Hero rounds count `H` and `HP`. Skill rounds count each
  skill's `S` weight plus its best `HS` route onto a hero the player owns.
- The optional support pick after round 6 chooses two tactics as a joint pair
  when both slots are open. The pair score adds each skill's weight, the best
  feasible hero routing, and the `SP` bonus when both skills land on one hero.
  With one slot open, it uses the same per-skill ranking.
- Neither path uses the exact-team families, because a pool is not a team.

Automatic team building is paused because its recommendations were not
reliable enough. `/team-builder` shows supported relationships between the
heroes and skills the player already owns and does not generate a formation;
its display rules are in [web/README.md](web/README.md#game-phase). The
formation optimizer and editor stay in the source for future research. The
optimizer uses only features that clear their family floor, so one
well-supported hero cannot carry an unobserved partner, and it scores each of
the three teams separately, so no relationship crosses team boundaries.

### Evaluation

`make evaluate-recommendation` runs `data/evaluate_recommendation_model.py`
and rewrites only the ignored `results_recommendation_evaluation.json`. Its
candidate settings are suggestions for review; it never changes production
weights or floors. Splits use whole leakage groups (capture sessions, Yanwu
reports, and near-duplicate matchups) and never read season or outcome. The
locked test identities live in `data/evaluation/locked-pre-yanwu-test.json`.
The module docstring describes the full protocol.

Production enables `THS`, `TSP`, `HC`, `B`, and support-50 `HT`, and keeps
`TS3` disabled because it worsened the development Brier score
([TEAM_CONTEXT_EVALUATION.md](data/evaluation/TEAM_CONTEXT_EVALUATION.md)).
The artifact's own `backtest` is a lighter grouped holdout of the production
configuration.

## Data sources

### Community battle uploads

`/contribute` is a small experiment with no login where players submit battle
reports; [web/README.md](web/README.md) describes the page.
`POST /api/battles` validates the report again against `database.json` and
writes it to the D1 table `web_battle_submissions` through the `TELEMETRY_DB`
binding. It accepts only JSON with an explicit uploader string (an empty string
means anonymous) and rejects browser requests from other origins. Because it
has no login, direct clients can still call it, so the live queue is capped
at 500 reports; when it is full, uploads get HTTP 429 until the daily job
drains it. Retries with the same submission ID are idempotent. Apply
`web/migrations/0003_web_battle_submissions.sql` before accepting uploads (see
[web/README.md](web/README.md#cloudflare-pages-functions-and-d1-setup)).

The daily `update-web-battles.yml` workflow exports the table, runs
`data/import_web_battles.py` on at most 500 rows, and commits the accepted
reports, the aggregate checkpoint `data/web_upload_state.json`, the static
leaderboard, and a full recommendation rebuild. It then deletes D1 rows only
up to the high-water mark in that commit. At most two copies of one semantic
fingerprint are accepted; malformed reports and extra duplicates count as
rejections and earn no leaderboard credit. Accepted files keep the exact
contributor name, upload time, and season so suspicious patterns can be
reviewed later; submission IDs stay in D1. The web-battle and telemetry
workflows share one concurrency group, so their data commits cannot race.

### Pinned Yanwu corpus

`data/external/yanwu-release.json` pins the ten immutable S7-S16 assets of the
second
[CharlesWang505/yanwu-battle-reports](https://github.com/CharlesWang505/yanwu-battle-reports)
release, published under the
[CC BY 4.0 licence](https://github.com/CharlesWang505/yanwu-battle-reports/blob/main/LICENSE).
The assets are cumulative, so normalization keeps each report at its first
appearance (39,898 rows become 8,154 unique reports) and fails closed on any
conflict. `make sync-yanwu-corpus` writes the verified files to the Git-ignored
`.cache/yanwu/`, and `make build-recommendation` depends on it, so the build
never silently falls back to a local-only model. The daily web-battle workflow
caches that folder. Details are in the `data/yanwu_corpus.py` docstring.

### Telemetry

The browser logs each confirmed draft round anonymously to
`POST /api/telemetry/rounds`, which writes to the D1 table `round_telemetry`.
The weekly `update-telemetry-data.yml` workflow runs
`data/build_telemetry_data.py` on the export and commits two generated files
together:

- `data/telemetry_state.json`: the aggregate checkpoint. It holds cumulative
  counters, a fixed-size anonymous session estimate, resumable model state, and
  the last processed D1 row ID, but no raw events, identifiers, or timestamps.
- `web/public/game-data/telemetry_data.json`: public offer, pick, round,
  position, and disagreement counts, plus an online conditional-choice model
  that stays hidden until its evidence and quality checks pass.

Only after that commit does the workflow delete rows that the committed cursor
covers and that are older than 14 days. Model features and quality statistics
are saved only when at least ten new events support them. Setup and workflow
details are in [web/README.md](web/README.md#telemetry-workflow).

## Battle-report OCR batches

Store one phone capture batch under
`study-battle-report/battles/<batch-id>/images/`, keeping the original
`battle_detail_<timestamp>.png` filenames so the script can order the frames.
A batch may contain several battle reports.

```bash
# List available batches.
uv run python study-battle-report/ocr_battle_log.py --list

# OCR and split one batch into battle_logs/*.txt.
uv run python study-battle-report/ocr_battle_log.py <batch-id>

# Re-run text processing from compatible cached OCR observations.
uv run python study-battle-report/ocr_battle_log.py <batch-id> --use-cache
```

The script writes to the batch's `battle_logs/` folder, one file per battle,
named `<YYYY-MM-DD> - <our heroes> vs <enemy heroes> - <outcome>.txt`. Both
sides list three canonical heroes, and the outcome is `我方胜`, `敌方胜`, or
`平局`. Each file starts with both teams and each hero's observed non-signature
skills, then the full battle record. The script stops without publishing if it
cannot recover a complete roster or outcome, and it clears the previous logs
first so a failed run cannot leave stale ones behind.

`battle_logs/.manifest.json` records the source frames and completeness. The
regenerable `.ocr_cache.json` stores raw OCR keyed by image content and OCR
configuration, so a renamed but unchanged image reuses its result. Ambiguous
glyphs stay as `OCR不确定：…` lines and are counted in the manifest instead of
being silently repaired.

## Layout

- `image_extraction/`: PaddleOCR skill extraction. `batch_extract_battles.py`
  runs `skill_extraction_system.py` over `data/images/`, and the tests compare
  it against golden images in `fixtures/` (about 107 MB, committed on purpose).
- `study-battle-report/`: the battle-log OCR script. It duplicates some logic
  from `image_extraction/` because the two live in different workspaces; merge
  them only if they start changing together.
- `data/`: training data and offline builders for the recommendation artifact,
  its evaluation, community imports, telemetry, the Yanwu corpus, and the guide
  workbook (`import_yanwu_workbook.py`, a dry run unless you pass `--apply`).
- `web/`: the React app (Vite, MUI, TypeScript) and the Pages Functions. See
  [web/README.md](web/README.md).
- `web/public/game-data/database.json`: the game catalog and guide data. The
  rankings, known builds, championship references, matchups, and analysis are
  attributed to 但丁与你 under the public source label `三谋演武-但丁与你.xlsx`.
  The guide page links to the author's approved Bilibili and Douyin profiles,
  and workbook contact details are never published.
  [S17_SOURCES.md](web/public/game-data/S17_SOURCES.md) documents the S17
  additions.
- `web/public/game-data/telemetry_data.json` and `web_upload_data.json`:
  generated static files, updated weekly and daily.
- `web/src/recommendation_data.json`: the generated model artifact.
- `autojs/`: device-specific AutoJS scripts that capture screenshots on
  Android.
- `.agents/manual-skills/`: agent workflows that run only when you ask for them
  by name.

## Data conventions (recommendation_data.json)

`web/src/recommendation_data.json` is generated; never edit it by hand. Its
top-level keys are:

- `schema`: the schema version and a description of each feature family.
- `catalog`: the hero-to-default-skill map, `catalog_version`, which tracks
  availability and validates telemetry events, and `relationship_version`,
  which hashes the camp map and bond contracts so camp or bond changes
  invalidate scoring caches. `mechanics` and `mechanics_version` hold an empty
  placeholder; no mechanics family is enabled.
- `battle_counts`: battle and win totals, the invalid count, and
  `corpus_version`.
- `model`: weights keyed by feature id, and `support` per feature (battles in
  which it appears on either side). A missing entry means 0.
  `atomic_components` and `relationship_components` split the `H`/`S` and
  `HP`/`HS` weights into outcome and appearance parts. `scoring_version`
  hashes everything that affects browser scoring.
- `analytics`: smoothed win rates and usage for each hero and skill.
- `backtest`: the lightweight grouped holdout, with its own
  `evaluation_version`.

Feature ids join their parts with `|` and sort unordered parts. In TypeScript,
build them only through `web/src/services/recommendationModel.ts`; never
re-derive them inline. The keys rely on JavaScript's `[a, b].sort()` matching
Python's `sorted()` for these CJK (BMP) names.

## Conventions

- Recommendation and leaderboard reads are static and client-side.
  `web/src/services/api.ts` is an in-memory scoring shim, not an HTTP client,
  and `web/public/_routes.json` limits Pages Functions to `/api/*`.
- Protect recommendation and prompt changes with the behavior tests in
  `web/src/services/__tests__/`.
- `recommendationEngine.test.ts` keeps a realistic 15-hero, 28-skill formation
  search under 10,000 ms. The scheduled web-battle workflow runs it on shared
  CI hardware, so keep plenty of headroom and do not raise or remove the limit
  to hide slow code.
- Git ignores the regenerable folders `extracted_results/`, `tmp_crops/`,
  `test-results/`, and the OCR output under `study-battle-report/battles/*/`.

---

Agent instructions start in [AGENTS.md](AGENTS.md). `CLAUDE.md` imports this
README, GAME_RULE.md, and DEVELOPMENT.md for Claude Code, and `web/AGENTS.md`
and `image_extraction/.agent.md` add notes for their folders. Keep this README
to what exists and where to find it; put implementation detail in code
comments, tests, or `data/evaluation/`.
