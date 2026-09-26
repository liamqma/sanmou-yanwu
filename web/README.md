# Web app

The React app for the 三国谋定天下 (演武) draft advisor. All recommendation and
Analytics logic runs in the browser: `src/services/api.ts` is an in-memory
scoring shim, not an HTTP client, and reads the bundled `database.json` and
`recommendation_data.json`. Cloudflare Pages Functions write anonymous round
telemetry and community battle reports to D1; they never serve recommendations
or static pages. The root [README.md](../README.md) explains how the model data
is built and how community reports are imported.

## Routes

| Route | What it serves |
|---|---|
| `/` | The draft advisor: setup, ten rounds, and option recommendations |
| `/analytics` | Model-weight and relationship rankings, plus anonymous option statistics |
| `/team-builder` | Supported relationships within the current roster (reference only) |
| `/contribute` | Battle-report submission |
| `/contributors` | Static contributor leaderboard |
| `/guides/yanwu` | The 演武攻略 guide |
| `POST /api/telemetry/rounds` | Write-only round telemetry (Pages Function) |
| `POST /api/battles` | Write-only battle reports (Pages Function) |
| `GET /api/health` | Health check (Pages Function) |

All routes work on desktop, tablet, and mobile. Desktop uses a left command
rail; mobile and tablet use a compact header menu.

## Getting started

You need Node.js 22 (pinned in `.node-version`) and pnpm 11. CI and Corepack
use the exact `packageManager` version in `package.json`; locally, install
pnpm with Homebrew, Corepack, mise, or a similar tool. `.tool-versions` pins
Node only for the Cloudflare Pages build image.

```bash
pnpm install --frozen-lockfile

pnpm start          # Vite dev server on http://localhost:3000
pnpm typecheck      # Go-native typescript@7 type check (no emit)
pnpm test           # Vitest: src/** and the Pages Functions
pnpm test:e2e       # Playwright dev-server specs, then pnpm test:prerender
pnpm test:prerender # Build, then run the prerender, no-JavaScript, and hydration specs
pnpm build          # Client bundle and build-time React prerender into build/
pnpm preview        # Serve build/ locally
```

Vite strips types without checking them, so `pnpm typecheck` is the type
check. `pnpm start` does not prerender routes; use `pnpm build && pnpm preview`
to check the production HTML, hydration, or JavaScript-disabled behavior.
Before the first e2e run, install browsers with `pnpm exec playwright install`.
[DEVELOPMENT.md](../DEVELOPMENT.md) says which checks a change needs.

## Project structure

```
web/
├── functions/api/       # Pages Functions: telemetry/rounds, battles, health
├── migrations/          # D1 schema migrations
├── public/
│   ├── game-data/       # database.json plus generated telemetry and upload files, fetched at runtime
│   └── game-assets/     # Local card art; see game-assets/README.md
├── scripts/
│   ├── build.mjs        # Client build, server build, and per-route prerender
│   └── capture-visual-audit.mjs # Playwright route and state screenshot audit
├── src/
│   ├── components/      # analytics, common, contribute, game, layout, leaderboard, setup,
│   │                    # and teamBuilder (the dormant formation editor)
│   ├── context/         # GameContext: global game state with useReducer
│   ├── hooks/           # usePinyin
│   ├── pages/           # Route pages
│   ├── seo/             # Route SEO config, <head> manager, and HTML document assembly
│   ├── services/        # api shim, recommendation engine and model, telemetry, uploads
│   ├── theme/           # 演武策牒 MUI theme
│   ├── types/           # Hand-written domain, recommendation, and game-state types
│   ├── utils/           # Storage, rankings, clipboard, and cookie helpers
│   ├── workers/         # Formation-search worker for the dormant optimizer
│   ├── data.ts          # Typed boundary that imports the bundled JSON once
│   ├── guideData.ts     # Guide-only slice of database.json, loaded by /guides/yanwu
│   ├── gameAssets.ts    # Card-art manifest lookup
│   ├── routeComponents.ts # Lazy route components
│   ├── recommendation_data.json # Generated model artifact (never edit by hand)
│   ├── entry-server.tsx # Build-time React renderer
│   └── index.tsx        # Browser entry (createRoot or hydrateRoot)
├── tests/               # Dev-server Playwright specs
└── tests-production/    # Prerender, no-JavaScript, and hydration specs
```

## Draft advisor

The setup form picks the starting heroes and skills, with Chinese and pinyin
search, and the season, which defaults to the latest one. Setup and round
inputs are not restricted by season; support-pick eligibility follows
[GAME_RULE.md](../GAME_RULE.md#game-flow).

### Game phase

The draft has ten rounds. A one-click win confirmation unlocks round 7 after
round 6 and round 9 after round 8. The optional support pick after round 6
carries through later rounds, so a supported draft can hold up to 15 heroes and
28 skills.

- `GameBoard` runs the rounds. On wide desktops the options and the roster
  share one two-column view; on mobile the roster sits below the options. Once
  all three candidate groups are filled, `复制给微信好友` renders a shareable PNG
  of the round in the browser.
- `RoundInfo` shows the ten-round progress rail.
- `CurrentTeam` shows 当前阵容, its 评分, the edit control, and the season on
  one line. One support hero slot and two support tactic slots come first.
  Active A/B/C offers and the roster never share items. A roster change keeps
  the current offers and rescores them, and only a response for the newest
  roster revision can replace the scores.
- `AnalysisGrid` edits and scores the three options. Each option shows its
  marginal 评分, a point breakdown, and evidence for only the features it newly
  activates. Hero candidates show their S to D guide rank, and skill candidates
  show their guide tier (`X档`) when they have one. When the preference model
  is ready, each card also shows 玩家选择概率, the highest is marked
  玩家选择最高 separately from AI 推荐, and a short A/B/C note appears when the
  two picks differ by a meaningful margin.
- `RecommendationPanel` highlights the top-ranked option.
- `KnownStrongTeams` filters the imported strong and championship builds
  against the pool and the current offers, marking items as 已获得, 本轮可获得,
  or 尚未获得. Championship references sort ahead of ordinary S builds. Hero
  rounds collapse builds with the same roster into one direction; skill rounds
  show each build's formation and both skill slots per hero.

`/team-builder` does not recommend or apply formations. It shows one card per
owned hero or tactic, including support items. Each card lists supported,
positive direct relationships, labelled 武将同队 (`HP`) and 武将携带战法
(`HS`), grouped into heroes and tactics and ordered by weight, with a 3, 5, or
all control per group. A relationship qualifies when it clears its family's
support floor and its raw weight is above 0. There is no separate display
floor, so a small weight can show as `+0.0` while ordering and bars use the
raw value. Every bar uses one page-wide scale, and there is no aggregate score.
Contextual families are left out because the roster has no concrete
three-team assignment. The page explains that automatic recommendations are
paused for quality reasons and may return, and that these results are
reference information.

## 演武攻略

`YanwuGuide` is the lazy-loaded `/guides/yanwu` page. It shows the hero and
categorized skill tiers, the strong-team library (collapsed at first), five
championship groups, the 13×13 matchup explorer, and the workbook analysis.
It is the only place that renders `攻略数据由但丁与你提供` and the author's
approved Bilibili and Douyin links, which open in new tabs. The matchup matrix
reads as column build versus row build, and neither it nor the hero ranking
changes model scores.

## Analytics

The 历史战报分析 section ranks heroes and skills by 模型权重 and explains the
three measures shown: 模型权重, 组合分, and 参考场次. Its relationship panel shows
one mode per enabled family, which today means 两人同队 (`HP`), 三人同队
(`HT`), 自己携带 (`HS`), 队内战法 (`THS`), and 缘分 (`B`). Each mode lists every
fitted relationship, including negative ones, 40 rows at a time, and filters
keep each row's full-list rank. A skill gets the `影 · <name>` label only with
explicit shadow provenance. Model diagnostics (accuracy, log loss, Brier score,
and backtest counts) sit in a collapsed accordion.

The 匿名选项统计 section reads schema v5 item analytics from
`public/game-data/telemetry_data.json`. A 武将/战法 toggle switches between
游戏最常提供 (offer count and rate) and 玩家最常选择 (pick count and the
picked-when-offered rate). Offer counts include only the three offered sets,
never pool or support items. Readers for schema v2 to v4 remain for stale
deployed files; schema v2 has no item analytics, so the section is hidden.

## Contribute

`/contribute` lets a player copy a catalog-backed DeepSeek OCR prompt and
paste its JSON reply to prefill every recognized value, or enter both teams by
hand. The prompt asks DeepSeek to read each hero's first (signature) skill
before naming the hero, and gives rough normalized positions for portrait and
landscape screenshots. Unrecognized values stay editable, and the player
reviews every hero, skill, the winner, and both teams' current-model scores
before submitting. Final submission is validated strictly, in the browser and
again by `POST /api/battles`.

The optional public contributor name may be empty, stays editable after an
anonymous submission, and keeps printable Unicode exactly. The contribution
season defaults to the highest numeric season in `database.json` and is
separate from the homepage season. `/contributors` reads the static
`public/game-data/web_upload_data.json`.

## Browser storage

| Key | Storage | Owner | Holds |
|---|---|---|---|
| `gameProgress` | localStorage | `utils/storage.ts` | Versioned game progress with no expiry. Malformed or unsupported versions are ignored, and the old `gameProgress` cookie is not migrated. |
| `selectedSeason` | cookie, 365 days | `utils/storage.ts` | The homepage season. It survives a game reset and falls back to the latest season if missing or invalid. |
| `teamBuilder` | localStorage and cookie | `utils/storage.ts` | State for the dormant formation editor, kept for compatibility and cleared on reset. |
| `sanmouTelemetryQueueV1` | localStorage | `utils/telemetryStorage.ts` | The telemetry retry queue: up to 50 events, each kept for 7 days. |
| `sanmouTelemetrySessionV1` | sessionStorage | `utils/telemetryStorage.ts` | The anonymous per-tab telemetry session ID. |
| `battleUploaderName` | cookie, 365 days | `utils/uploaderName.ts` | The optional contributor name. |
| `battleUploadSeason` | cookie, 365 days | `utils/contributionSeason.ts` | The contribution season. |
| `battleUploadSubmission` | sessionStorage | `services/battleUploadApi.ts` | The submission ID, reused so a retried upload stays idempotent. |

## Data and logic

- `src/data.ts` imports and casts the bundled JSON once, typed by `src/types/`.
- `src/services/api.ts` exposes `getDatabaseItems`, `getRecommendation`, and
  `getAnalytics`, backed by `recommendationEngine.ts`.
- `src/services/recommendationModel.ts` builds the model feature ids described
  in the root
  [data conventions](../README.md#data-conventions-recommendation_datajson).
  Always use it instead of building ids inline, because the ids must match the
  Python builder.
- `public/game-data/database.json` is the catalog plus imported guide data.
  Heroes and ranked skills have an optional `ranking` from S to D, and skills
  also have a `category`. Known teams store a formation and two
  alternative-aware skill slots for each of three heroes, with `strong` and/or
  `championship` provenance. `yanwuGuide` holds the attribution, the source
  label `三谋演武-但丁与你.xlsx`, the 13×13 matchup matrix, five championship
  groups, and the analysis. Copied LLM prompts link to this file with a weekly
  `?v=<week-start-date>` cache-buster.
  [S17_SOURCES.md](public/game-data/S17_SOURCES.md) documents the unranked S17
  additions.
- `../data/import_yanwu_workbook.py` renders the guide part of the database
  under the
  [reviewed seven-sheet import contract](../.agents/manual-skills/update-game-database-from-csv/SKILL.md#import-workflow).
  A workbook that omits the new catalog heroes fails its
  [coverage check](../.agents/manual-skills/update-game-database-from-csv/SKILL.md#audited-contract-decisions),
  so importing one needs a reviewed source or contract change, not made-up
  rankings.

## Cloudflare Pages Functions and D1 setup

The Git-connected Cloudflare Pages project is the deployment source of truth,
and it needs no Wrangler configuration file.

1. Create a D1 database in the Cloudflare dashboard.
2. In the Pages project, add a production D1 binding named exactly
   `TELEMETRY_DB` that points at that database. Add a separate preview binding
   if preview deployments should accept writes.
3. Initialize a new database from `web/` (replace the database name or ID):

   ```bash
   pnpm dlx wrangler@4.112.0 d1 execute <database-name-or-id> --remote \
     --file=migrations/0001_round_telemetry.sql --yes
   pnpm dlx wrangler@4.112.0 d1 execute <database-name-or-id> --remote \
     --file=migrations/0003_web_battle_submissions.sql --yes
   ```

4. Redeploy after adding the binding. Pages Functions then serve
   `/api/health`, `/api/telemetry/rounds`, and `/api/battles`. Static pages,
   including `/contributors`, never query D1.

To test Pages and D1 locally, build first and pass the local binding
explicitly:

```bash
pnpm build
pnpm dlx wrangler@4.112.0 pages dev build --d1 TELEMETRY_DB=<database-id>
```

## Telemetry workflow

The `Update telemetry data` workflow
(`.github/workflows/update-telemetry-data.yml`) runs weekly and can also be
started by hand. It needs these repository settings:

1. The `CLOUDFLARE_API_TOKEN` Actions secret: an account-scoped token limited
   to D1 Read and D1 Edit for the account that owns the database.
2. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_NAME` as non-secret
   Actions variables.
3. Permission for GitHub Actions to read and write repository contents, so the
   workflow can push the generated files.

Each run validates the D1 schema, applies the AUTOINCREMENT upgrade if the
table still needs it, and exports `round_telemetry` to `$RUNNER_TEMP`. The
export is owner-only and is deleted as soon as the builder has read it. The
builder folds only rows newer than the committed cursor into
`../data/telemetry_state.json` and renders `public/game-data/telemetry_data.json`
from that checkpoint alone. The workflow then runs the web type check, unit
tests, and production build, and commits both files together when either
changes.

The push happens only if `origin/master` is still at the SHA the run started
from; otherwise the run fails and a later run rebuilds from the new source.
Only after the files are on `master` does the workflow delete one batch of at
most 10,000 rows that the cursor covers and that are older than 14 days. If
more eligible rows remain, it records the count and fails so the operator can
rerun it. A failed build or push deletes nothing, and a failed purge is retried
the next week. Logs and the job summary show only aggregate counts, never a
raw row or ID. Deleted rows may still be restorable through Cloudflare D1
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) for
the plan's recovery window; the workflow keeps no other raw backup.

The builder fails closed on an export or schema it cannot verify, and counts
individual malformed, catalog-mismatched, or impossible events only in
`invalid_event_count`. Recommendation scores, positions, and model labels come
from the browser, so the builder checks their shape but does not replay them.
`telemetry_data.json` contains no event IDs, session IDs, timestamps, pools,
offers, or choices. The recovery migration
`migrations/0004_round_telemetry_rounds_10_reset.sql` and the builder's
`--reset-and-fold-export` flag can discard history, so they exist only for
deliberate incident recovery and the workflow never calls them.

Run the same path locally with:

```bash
pnpm dlx wrangler@4.112.0 d1 export <database-name> --remote \
  --table=round_telemetry --output=/tmp/round_telemetry.sql
# From the repository root:
make build-telemetry EXPORT=/tmp/round_telemetry.sql
```

## Deployment

Cloudflare Pages serves the app. `pnpm build` writes `build/` with a
route-specific HTML file for each public page, plus `sitemap.xml` and
`404.html`. Each HTML file contains the React-rendered route, inlined critical
MUI styles, and links to the route's CSS, so pages are readable without
JavaScript. The browser hydrates that markup, and no Node server runs on
Cloudflare Pages.

## Recommendation debug context

After a draft recommendation is calculated, run this in the browser console:

```js
copy(sanmouDebug())
```

`sanmouDebug()` logs the structured context and returns it as formatted JSON,
and Chrome DevTools' `copy(...)` puts it on the clipboard. Paste it into an
agent with the result you expected, for example: "I expected option A instead
of B; explain why B won."

The export contains the current pool and offers, all three ranked scores,
every activated feature with its support count, and the outcome, appearance,
and final weight components for `H`/`S` and `HP`/`HS`. It also contains the
skill-to-hero route order, including the pool-order tie-break for equal `HS`
weights, and the separately labelled player-choice prediction. The dormant
formation optimizer has its own debug builders, but no route exposes them.

The export is built locally from data the page already loaded. It uploads
nothing and leaves out telemetry and session identifiers, cookies, unrelated
local storage, and the full battle corpus and model maps. Before a
recommendation is ready, it returns a `not-ready` explanation instead.

## Theme and card art

`src/theme/theme.ts` defines the light 演武策牒 theme: flat rice-paper
surfaces, ink-colored text, muted jade, seal red, bronze gold, and purple
scales, high-contrast focus indicators, and Songti serif headings. Hero and
regular-tactic cards use local, manifest-backed art with a text fallback and
make no remote image requests; see
[public/game-assets/README.md](public/game-assets/README.md).
