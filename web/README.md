# Game Advisor - React Application

A React application for game team composition analysis and AI-prompt
generation. All recommendation and current Analytics logic runs in the browser;
`src/services/api.ts` is an in-memory scoring shim (not an HTTP client) that
reads the bundled `database.json` and `recommendation_data.json`. An isolated
Cloudflare Pages Functions write anonymous confirmed-round telemetry and
no-auth community battle reports to D1 but do not participate in
recommendation or static reads. See the root [README.md](../README.md) for how
the model data is generated and community reports are imported.

## Features

- **Setup Phase**: Select starting heroes and skills with pinyin search support, and pick the current season (defaults to the latest available; the season only limits support hero/skill availability, not initial setup or round inputs)
- **Game Flow**: Ten-round draft with one-click win qualification after Rounds
  6 and 8; Round 9 repeats the Round 7 hero format and Round 10 repeats the
  Round 8 skill format (see [GAME_RULE.md](../GAME_RULE.md))
- **Known Strong Teams**: During hero rounds, show relevant workbook-backed
  heroes only; during skill rounds, expand those builds with formation, both
  skill slots, alternatives, and the exact 已获得 / 本轮可获得 / 尚未获得 states.
  Championship references sort ahead of ordinary S builds without inventing a
  new tier.
- **演武攻略**: `/guides/yanwu` presents the hero and categorized skill tiers, full strong
  team library, five championship groups, 13×13 matchup explorer, and workbook
  analysis. This full guide is the sole UI location for the 但丁与你 attribution
  and the author's approved Bilibili and Douyin profile links.
- **Manual Editing**: Edit team composition manually at any time
- **Current roster relationships**: `/team-builder` shows direct, supported
  relationships between only the heroes and tactics the player has already
  selected. Shared-scale progress bars and a 3/5/all control replace the former
  automatic formation advice
- **Analytics Dashboard**: Player-friendly, question-led analytics — hero/skill model-weight rankings, one responsive six-mode relationship ranking, usage, and optional (collapsed) model diagnostics
- **Auto-save**: Game progress automatically saved in a versioned,
  non-expiring `localStorage` record, while season data remains in a separate
  cookie
- **Anonymous round telemetry**: Always-on, non-blocking, indicative
  offer/score/choice logging through a Cloudflare Pages Function with an offline
  local retry queue
- **Community battle uploads**: Best-effort DeepSeek JSON prefill with manual
  repair (or direct manual confirmation), strict final validation, current-model
  lineup scores, a separate contribution-season cookie, and a daily static
  contributor leaderboard at `/contributors`
- **Recommendation debugging**: The draft recommendation page exposes a local,
  read-only `sanmouDebug()` browser-console export with the current inputs,
  exact feature weights/evidence, atomic outcome/count/final components, and
  decision policy for agent-assisted diagnosis
- **Local game card art**: Hero and draftable regular-tactic cards use a local,
  manifest-backed art system with a named fallback; no runtime image request is
  made to a remote site
- **Responsive Design**: Works on desktop, tablet, and mobile devices; desktop
  uses a left command rail, while mobile and tablet use a compact header menu

## Tech Stack

- **React** 19 - UI framework
- **Vite** - Dev server and production bundler
- **Vitest** - Unit/integration test runner (`src/**` plus Pages Functions)
- **TypeScript** (Go-native `typescript@7`) - standalone type checker (no emit)
- **Playwright** - End-to-end tests (under `tests/`)
- **Material-UI (MUI)** - Component library and styling
- **React Router** - Client-side routing
- **pinyin-pro** - Chinese pinyin search support
- **js-cookie** - Selected-season persistence and legacy Team Builder migration
- **dnd-kit** - Retained by the dormant formation editor while that experiment
  is unavailable from the product routes
- **Cloudflare Pages Functions + D1** - Write-only telemetry and battle-report
  collection; all recommendation and leaderboard reads remain static

## Getting Started

### Prerequisites

- Node.js 22 (pinned in `.node-version`) and pnpm 11

CI and Corepack target the exact `packageManager` version in `package.json`.
Locally, pnpm installation is left to Homebrew, Corepack, mise, or another
external tool, so compatible pnpm 11 releases do not bootstrap a second CLI
before running project commands.

### Installation

```bash
pnpm install --frozen-lockfile
```

Local installs use pnpm's global virtual store, so repeated installs in
no-mistakes worktrees reuse the same dependency graph and each checkout keeps
only a small symlink-based `node_modules`. pnpm disables that optimization
automatically in cache-cold CI environments.

### Development

```bash
# Start the client-only Vite dev server on http://localhost:3000
pnpm start

# Type-check with the Go-native typescript@7 (no emit)
pnpm typecheck

# Run unit/integration tests once (Vitest)
pnpm test

# Run dev-server and production-prerender e2e tests (Playwright);
# first time: pnpm exec playwright install
pnpm test:e2e

# Run only the production prerender/no-JavaScript browser checks
pnpm test:prerender

# Client bundle + build-time React prerender -> build/
pnpm build

# Preview the production build locally
pnpm preview
```

> Vite/esbuild strips types at build time but does **not** type-check, so
> `pnpm typecheck` is the type gate. See [AGENTS.md](AGENTS.md) for the full
> pre-completion verification checklist.
>
> `pnpm start` remains the fast HMR loop: it does not run the server bundle or
> prerender routes. Use `pnpm build && pnpm preview` when checking the exact
> production HTML, hydration, or JavaScript-disabled behavior.

## Project Structure

```
web/
├── functions/           # Pages Functions (`/api/telemetry/rounds`, `/api/battles`)
├── migrations/          # D1 schema migrations
├── public/              # Static assets, crawler directives, and Pages headers
│   ├── game-data/       # Publicly fetchable game data for copied LLM prompts
│   └── game-assets/     # Local hero/tactic cards, manifest, and fallback
├── scripts/
│   ├── build.mjs        # Client build + server build + per-route prerender
│   └── capture-visual-audit.mjs # Playwright route/state screenshot audit
├── index.html           # Vite HTML entry (module script, gtag snippet)
├── src/
│   ├── components/      # React components
│   │   ├── common/      # Reusable components (AutocompleteInput, TagList, etc.)
│   │   ├── game/        # Game-related components (GameBoard, RoundInfo, etc.)
│   │   ├── layout/      # Layout components (AppLayout, Header)
│   │   ├── setup/       # Setup phase components
│   │   └── teamBuilder/ # Editable three-team formation workbench
│   ├── context/         # React Context (GameContext for state management)
│   ├── hooks/           # Custom React hooks (usePinyin)
│   ├── pages/           # Page components (GameAdvisor, Analytics, NotFound, etc.)
│   ├── seo/             # Route SEO config, <head> manager, and HTML document assembly
│   ├── services/        # In-memory api shim and game logic (TypeScript)
│   ├── theme/           # Custom 演武策牒 MUI theme configuration
│   ├── types/           # Hand-written domain/recommendation/game-state types
│   ├── utils/           # Utility functions (storage, rankings, clipboard)
│   ├── data.ts          # Typed JSON boundary (imports/casts the bundled data)
│   ├── recommendation_data.json # Generated model artifact (do not hand-edit)
│   ├── App.tsx          # Main application component
│   ├── createEmotionCache.ts # Shared client/server MUI style cache
│   ├── entry-server.tsx # Build-time React renderer
│   └── index.tsx        # Browser createRoot/hydrateRoot entry
├── tests/               # Dev-server Playwright e2e specs
├── tests-production/    # Prerender, no-JS, and hydration Playwright specs
├── .node-version        # Pinned Node version
├── tsconfig.json        # TypeScript config (type-check only)
├── vite.config.js       # Vite + Vitest config
├── playwright.config.js # Playwright config (starts dev server on :3000)
├── playwright.prerender.config.js # Production preview config (:4173)
├── package.json         # Dependencies and scripts
└── README.md            # This file
```

## Key Components

### Setup Phase
- **SetupForm**: Select the initial heroes and skills
- **AutocompleteInput**: Search with Chinese and pinyin support
- **TagList**: Display and manage selected items

### Game Phase

The draft has ten rounds. A one-click win gate controls progression from Round
6 to 7 and Round 8 to 9. The existing support pick remains optional after Round
6, and any support selections carry through the later rounds. A completed
supported draft can therefore contain up to 15 heroes and 28 skills. The
current roster relationship page reads that full selected pool, including
support items, without recommending or applying a formation.

- **GameBoard**: Main game container managing the draft rounds. On wide desktop
  the option workspace and current roster share one two-column viewport; on
  mobile the roster is a disclosure below the option workspace. Once all three
  candidate groups are complete, the secondary green chat-bubbles action
  `复制给微信好友` renders a controls-free, fixed-1200px-wide PNG entirely in the
  browser, independent of the responsive page layout. The image includes the
  round and season, every candidate group with one clearly marked AI
  recommendation, current roster score, all acquired hero and tactic cards, and
  support markers. It omits the page title, candidate heading, completion
  counts, and all guide-tier metadata strips. A recommendation that still
  matches the roster is reused; otherwise copying runs the same deterministic
  engine solely for the export, without selecting a group for the player. It is
  copied through the binary Clipboard API when allowed; otherwise a preview
  offers native file sharing when supported, download, and mobile
  long-press/save guidance for sending it to WeChat.
- **RoundInfo**: Display current round information with an accessible ten-round
  campaign-plaque progress rail
- **CurrentTeam**: Keep 当前阵容, its roster 评分/score, the edit control, and season
  as equal-height items in one compact header line. Narrow screens abbreviate
  the edit and season controls instead of wrapping them. The hero list places
  one support slot first and the tactic list places two first; each open slot
  displays only a plus sign. Accepting a support choice replaces only the open
  slot or slots, keeps selected support cards ahead of the ordinary roster, and
  removing one restores its placeholder. Active A/B/C offers are excluded from
  roster and support editing, while option editing and saved-progress restore
  reject owned roster items, so offers and the roster remain disjoint. A roster
  save or support change keeps the active offers, current recommendation, and
  selected option visible while automatically rescoring them. Only a request
  for the newest roster revision may replace those scores or settle the analysis
  loading indicator.
- **RecommendationPanel**: Highlight the top-ranked option set (ranked by per-round 评分/score)
- **AnalysisGrid**: Own both direct option editing and analysis in one card
  surface, so every candidate's complete local art appears once. Desktop keeps
  all three groups visible in one row; tablet and mobile stack A/B/C vertically
  in document order without tabs or discarding any group's edits. Each group
  shows its marginal 评分/score and key point breakdown. Its evidence summary
  covers only features activated by that option, not evidence already present
  in the current pool. Hero candidates
  include their compact S–D guide ranking; skill candidates
  remain bare names because the legacy skill tier/note metadata was removed.
  When the gated preference model is available it also labels each card with the 玩家选择概率,
  highlights the highest as 玩家选择最高 (independently from the AI 推荐 card), and — only when the
  two tops differ by a meaningful margin — shows a short non-causal A/B/C disagreement note
- **Current roster relationship page**: `/team-builder` keeps the original URL
  but no longer recommends or applies formations. It automatically includes
  only the current roster, including support heroes and tactics, and renders
  one readable card per item. Each card shows supported positive direct
  relationships grouped by whether the related item is a hero or tactic,
  orders each group by model weight, and lets the player show 3, 5, or all
  entries per group. Non-positive weights are omitted because this surface is a pairing
  reference, not a rejection signal. Every progress bar uses
  one page-wide scale, so lengths stay comparable across cards. Player-facing
  labels translate direct hero-pair (`HP`) and hero-carried-tactic (`HS`)
  evidence as `武将同队` and `武将携带战法`, with signed relative-score impact and
  supporting battle count; contextual families stay excluded because the
  roster has no concrete three-team carrier assignment. The page explicitly
  explains that the previous automatic recommendations were paused for quality
  reasons, may return after a better method is found, and that current results
  are reference information rather than automatic team advice. The dormant
  formation/scoring services remain available for future research.
- **KnownStrongTeams**: Filters the imported strong/championship library against
  the acquired pool and the current offers. Hero rounds keep cards concise and
  collapse same-roster build variants (whose skill differences are hidden) into a
  single direction so distinct rosters fill the remaining slots; skill rounds keep
  those variants and reveal the source formation and both per-hero skill slots.

### 演武攻略

- **YanwuGuide**: Lazy-loaded `/guides/yanwu` page backed by the guide-only
  database module. It is the only component that renders `攻略数据由但丁与你提供`
  and the approved Bilibili/Douyin profile links. The links use compact,
  equal-weight outlined actions and open the external profiles in new tabs. The
  filtered strong-team library starts collapsed at every viewport size; its
  filter and expand action remain available on demand.
- The matchup matrix is read as **column build versus row build** and remains a
  reference view; neither it nor the S–D hero ranking changes model scores.

### Analytics
- **Analytics**: Player-friendly dashboard driven by the generated paired-model artifact
- A separate **匿名选项统计** section is shown when
  `public/game-data/telemetry_data.json` contains schema-v5 item analytics. Its 武将/战法
  toggle switches two responsive, height-capped tables showing every aggregated item:
  **游戏最常提供** ranks by offer count and shows offer rate, while **玩家最常选择**
  ranks by pick count and shows the conditional picked-when-offered rate. Offer counts
  include only the three option sets shown for that round, never items already in the pool
  or support slots. Ties use a deterministic name ordering, counts always remain visible,
  and the exact count-derived percentages remain visible for every row.
- The telemetry rankings and paired-model **历史战报分析** are separate, named page
  sections. Battle-count provenance, the historical-experience caveat, filters, and the
  model-weight/relationship tables live only inside the battle-report section.
- The telemetry artifact still retains diagnostic round, position, score-margin,
  recommendation-agreement, preference-model status/evidence, and evaluation aggregates,
  but Analytics does not show them in this player-facing ranking section.
  Backward-compatible schema-v2/v3/v4 readers remain for stale deployed assets;
  schema-v2 artifacts have no item analytics, so the section is omitted entirely.
- Question-led layout with a plain-language guide to the three player-facing measures:
  模型权重 (an individual hero/skill's relative-strength coefficient), 组合分 (an
  additional relationship coefficient), and 参考场次 (supporting battles). Individual
  hero/skill tables rank by model weight with deterministic tie-breakers.
- One two-level relationship panel keeps six independent full-family rankings out
  of a crowded tab bar: 武将搭配 has 两人同队 (HP) and exact 三人同队 (HT); 战法搭配 has
  自己携带 (HS) and 队内战法 (THS); 特殊加成 has catalog-backed 缘分 (B) and aggregate
  机制联动 (M). THS means the tactic can exist anywhere in the exact team, including
  on the named hero. B shows its required member count and catalog members. M shows the
  human-readable mechanic, 联动方式 (interaction mode), and friendly/enemy side; its
  weight belongs to that aggregate relationship and is never assigned to one concrete
  skill pair. HC, SP, TSP, and disabled TS3 are excluded from this panel. Each included
  family retains every fitted relationship, including negative weights. The browser
  filters the complete selected family before rendering, initially shows at most 40
  matching rows, reports visible, matching, and full-family counts where they differ,
  and reveals subsequent matches in deterministic batches of 40 through an accessible
  显示更多 control; expanding one mode or query never carries into another.
- Relationship filters preserve each full-list rank. HP/HT use contained heroes;
  HS/THS use their encoded hero or tactic; B uses catalog members. M remains an
  unfiltered aggregate because tactic participation is not presented as a concrete-pair
  attribution. Inapplicable filters are explicitly described as not applied. Usage and
  relationship families keep their own independent orderings.
- In the 全部战法 skill ranking, a skill is labelled `影 · <name>` only when the
  source battle explicitly carried 影 provenance (for example an upstream `影・`
  tactic) or its skill catalog entry is marked `shadow: true`. Sharing a name with
  an orange hero's innate skill is not enough: this prevents malformed/OCR reports
  such as an equipped 星罗棋布 from creating a false 影 label. The generated
  analytics retain the explicit-shadow observation count separately.
- Technical model diagnostics (accuracy vs baseline, log loss, Brier, backtest sample/feature
  counts) live in an optional, collapsed accordion so they don't get in a casual player's way.

### Common
- **ErrorBoundary**: Global error handling
- **GameCardArt**: Local manifest-backed hero and tactic art with a
  text-preserving fallback
- **GameLoadingPanel**: Shared light paper loading treatment for lazy routes,
  data-backed panels, and team formation; the pre-hydration curtain mirrors it
  before React starts
- **ResponsiveDisclosure**: By default, keeps dense detail expanded on larger
  screens while giving mobile users a toggle; callers can instead enable an
  initially collapsed disclosure at every viewport size. Content stays mounted
  in either mode.

## Data & Logic

Core app data is bundled at build time. Copied web-LLM prompts may fetch the public static data files for extra details:

- `public/game-data/database.json` — canonical catalog plus imported guide data.
  Heroes use an optional compact `ranking` (`S`–`D`) with no within-tier order;
  only omissions accepted by the audited importer contract stay unranked (see
  its [contract decisions](../.agents/manual-skills/update-game-database-from-csv/SKILL.md#audited-contract-decisions)).
  Ranked skills likewise use optional `ranking` (`S`–`D`) plus `category`; unlisted
  skills stay unranked. Known teams store a formation and two alternative-aware
  skill slots for each of three heroes, with `strong` and/or `championship`
  provenance. `yanwuGuide` stores current-name attribution and the public source
  label `三谋演武-但丁与你.xlsx`, plus the 13×13 matchup matrix, five championship
  reference groups, and analysis sections. Copied
  prompts link to the file with a weekly `?v=<week-start-date>` cache-buster.
- `../data/import_yanwu_workbook.py` — validates the exact seven-sheet
  `三谋演武-飞将吕布.xlsx` contract and renders the guide-backed portion of the
  database deterministically. It is dry-run by default, writes only with
  `--apply`, publishes the separate current-name workbook label
  `三谋演武-但丁与你.xlsx`, normalizes the reviewed author-name markers to 但丁与你, and
  excludes the workbook's contact line. The separately reviewed social profile
  links are page-owned content, not imported workbook payload.
- `public/game-data/formula.md` — public formula reference for copied web-LLM prompts.
- `src/recommendation_data.json` — the paired-model artifact **generated** by
  `data/build_recommendation_data.py` (don't hand-edit).
- `src/services/api.ts` — in-memory shim exposing `getDatabaseItems`,
  `getRecommendation`, and `getAnalytics` (backed by `recommendationEngine.ts`).
- `src/services/recommendationModel.ts` — canonical client-side builders for
  the model feature ids documented in the root
  [Data conventions](../README.md#data-conventions-recommendation_datajson);
  always use these rather than re-deriving ids inline (they must match the
  Python builder).
- `src/data.ts` — the central typed boundary that imports and casts the canonical public database plus bundled `recommendation_data.json` once (typed against `src/types/`).

## State Management

Uses React Context API with `useReducer` for global state:

- Game state (current round, heroes, skills)
- Round inputs (3 option sets)
- Recommendations and selections
- Auto-save to versioned `localStorage` on every state change

## Persistence

Game progress is automatically saved in a versioned `gameProgress`
`localStorage` envelope with no application-defined expiry:

- Current game state
- Round inputs
- Automatically restored on page load

Malformed records and records with an unsupported version are ignored. The
legacy `gameProgress` cookie is intentionally not migrated or restored. The
paused automatic Team Builder's versioned `teamBuilder` storage reader remains
only for backward-compatible cleanup. Resetting game progress still clears any
old arrangement.

The selected season is persisted in its own `selectedSeason` cookie, kept
separate from game progress so it survives a game reset; when the cookie is
missing, malformed, or out of range it falls back to the latest available
season.

Anonymous telemetry uses a capped `localStorage` retry queue and a tab-owned
per-game session ID. Its aggregate data contract and retention workflow are
documented below.

The static `public/game-data/telemetry_data.json` file contains deterministic
aggregate player-choice counts and, after its evidence/quality gates pass, a
regularized conditional-choice model. It deliberately contains no event IDs,
session IDs, timestamps, pools, offers, choices, or other row-level data. The
recommendation scores, recommendation positions, and model-version labels are
reported by the browser and treated as indicative; the offline builder checks
their bounded shape and internal consistency but does not replay them against
historical recommendation models. The browser continues to use only the paired
battle model for recommendations; the
preference model supplies a separately labelled player-choice probability and
is omitted from the option cards unless both its evidence and prequential quality
gates pass.

The stateful production builder publishes aggregate schema v5 with exactly
Rounds 1–10: Round 9 is a two-item hero round and Round 10 is a three-item skill
round. The browser-to-Function source-event wire contract remains schema v1.
The no-`--state` full-export builder stays frozen at aggregate schema v3 and
Rounds 1–8 for offline compatibility; it rejects exports containing Round 9 or
10 events.

The repository-root `data/telemetry_state.json` is a separate generated,
aggregate-only checkpoint used by the weekly builder. It is not served to the
browser and contains cumulative counters, a fixed-size anonymous session
estimate, resumable model state, and the last processed D1 row ID—not raw
event records or stable client/session identifiers. Model features that
correlate pools/offers with choices, subsequent changes to those features, and
model quality/prediction deltas are committed only in groups supported
by at least ten new events; cumulative public-style offer/pick counters retain
the lower counts shown in Analytics.

## Cloudflare Pages Functions and D1 setup

The existing Git-connected Cloudflare Pages project remains the deployment
source of truth; no Wrangler configuration file is required.

1. Create a D1 database in the Cloudflare dashboard.
2. In the Pages project, add a production D1 binding named exactly
   `TELEMETRY_DB`, pointing at that database. Add a separate preview binding if
   preview deployments should accept telemetry.
3. Initialize a new database from `web/` (replace the database name or ID):

   ```bash
   pnpm dlx wrangler@4.112.0 d1 execute <database-name-or-id> --remote \
     --file=migrations/0001_round_telemetry.sql --yes
   pnpm dlx wrangler@4.112.0 d1 execute <database-name-or-id> --remote \
     --file=migrations/0003_web_battle_submissions.sql --yes
   ```

4. Redeploy after adding the binding. `/api/health` and
   `/api/telemetry/rounds` plus `/api/battles` are then served by Pages
   Functions. Static recommendation pages and `/contributors` never query D1.

### Ten-round telemetry rollout

The ten-round beta rollout reset the checked-in aggregate checkpoint and public
schema-v5 artifact to zero history. Updating the repository alone does not
change the remote D1 database.

The one-time remote D1 reset for the Rounds 1–10 constraint has completed.
The routine **Update telemetry data** workflow no longer exposes or invokes a
destructive reset option, so manual and scheduled runs both preserve cumulative
history. The recovery migration
`migrations/0004_round_telemetry_rounds_10_reset.sql` and the builder's
`--reset-and-fold-export` flag remain available for deliberate incident
recovery outside the routine workflow.

### Weekly aggregate workflow

The `Update telemetry data` GitHub Actions workflow uses the schedule declared
in `.github/workflows/update-telemetry-data.yml` and can also be started
manually. Configure it in the repository settings:

1. Add the `CLOUDFLARE_API_TOKEN` Actions secret. Use an account-scoped token
   limited to **D1 Read** and D1 **Edit/Write** for the account that owns the
   telemetry database. The existing token can be reused; no separate retention
   secret is required.
2. Add `CLOUDFLARE_ACCOUNT_ID` as a non-secret Actions variable.
3. Add `CLOUDFLARE_D1_DATABASE_NAME` as a non-secret Actions variable.
4. Allow GitHub Actions to read and write repository contents so the workflow's
   scoped `contents: write` permission can push the changed generated file.

The workflow first validates the D1 schema and conditionally executes the
AUTOINCREMENT upgrade file when an existing table still needs it, then exports
the currently retained `round_telemetry` rows to `$RUNNER_TEMP`. This direct
execution keeps the dashboard-managed Pages project free of a committed
Wrangler configuration. The builder folds only IDs newer than the committed
cursor into `../data/telemetry_state.json` and renders the cumulative public
schema-v5 artifact solely from that checkpoint. It then runs the web type-check,
unit tests, and production build. Exactly the checkpoint and
`public/game-data/telemetry_data.json` are eligible for staging, and they are
committed together when either changes.
After publication, the job summary reports both the number of newly validated
events added by that run and the cumulative validated-event total.

The builder fails closed for an unverifiable D1 export or table schema, while
quarantining individual malformed, catalog-mismatched, or impossible events and
publishing only their aggregate `invalid_event_count`. A client-supplied model
label or event can therefore never block publication by referring to an
unavailable historical model. The workflow does not upload the SQL export or
commit when the generated bytes are unchanged. The export is created owner-only
and deleted immediately after the Python builder consumes it, before dependency
installation or repository web scripts run. Its logs and job summary report
only aggregate counts: newly validated and cumulative validated events, D1
size, rows older than 14 days, rows deleted, and any remaining backlog. No raw
row or ID is printed or uploaded.

Checkout does not persist its GitHub credential; the workflow exposes that
token only to the final push step. It records the initial `master` SHA and
requires `origin/master` to remain at that SHA before pushing. If another commit
lands during the build, the run fails so a later run can rebuild from the new
source instead of rebasing generated state.

Only after the generated checkpoint/artifact is already on the current
`master`, the workflow deletes one bounded batch of at most 10,000 rows whose
ID is covered by the committed cursor and whose server timestamp is older than
14 days. The AUTOINCREMENT migration and sequence checks ensure newly inserted
rows can never fall behind that cursor. A failed build or push deletes nothing;
a failed purge is safe to retry next week. The aggregate checkpoint continues
to represent validated historical telemetry, and no R2/raw archive is used. If
more eligible rows remain after the bounded batch, the workflow records that
aggregate count and fails so the operator can rerun it or add rate limiting;
the 14-day live-table window is therefore a monitored target rather than an
unbounded deletion claim.

Deleting a row removes it from the live D1 table, but Cloudflare's always-on
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) may
still restore provider history for the plan's recovery window. This workflow
does not create or retain any additional raw backup.

Manual workflow dispatch follows the same non-destructive path as the weekly
schedule. Normal runs fail if the checkpoint is missing or incompatible; they
never silently discard cumulative history. The retained recovery migration and
builder flag are intentionally not wired into GitHub Actions because either
can discard telemetry history.

Run the same path locally with:

```bash
pnpm dlx wrangler@4.112.0 d1 export <database-name> --remote \
  --table=round_telemetry --output=/tmp/round_telemetry.sql
# From the repository root:
make build-telemetry EXPORT=/tmp/round_telemetry.sql
```

No browser or Pages Function secret is required for ingestion.

For local Pages/D1 integration testing, build first and pass the local binding
explicitly:

```bash
pnpm build
pnpm dlx wrangler@4.112.0 pages dev build --d1 TELEMETRY_DB=<database-id>
```

## Deployment

Deployed to Cloudflare Pages. `pnpm build` produces the `build/` output
directory with a route-specific HTML entry point for each public page, plus
`sitemap.xml` and `404.html`. Each HTML entry contains the real React-rendered
route and its critical MUI styles, so content remains readable without
JavaScript. The browser hydrates that same markup for client-side navigation
and interaction; no runtime Node server is required on Cloudflare Pages.

## Development Notes

### Recommendation debug context

After calculating a draft recommendation, open the browser developer console
and run:

```js
copy(sanmouDebug())
```

`sanmouDebug()` logs the structured context and returns the same value as
pretty-printed JSON, while Chrome DevTools' `copy(...)` helper places it on the
clipboard. Paste that JSON into an agent together with the result you expected.
For example: “I expected option A instead of B; explain why B won.”

On the draft page, the export contains the current pool and offers, all three
ranked scores, every activated model feature, support counts, and the atomic
outcome coefficient, selection-count adjustment, and final weight where
applicable. It also contains the authoritative skill-to-hero route order
(including the current-pool-order tie-break for equal HS weights) and the
separately labelled player-choice prediction. The dormant formation optimiser
keeps its separate debug builders for future evaluation, but they are not
reachable from the product routes. Its coordinate-pass evaluations are not included in the prefix
counters; their bound is recorded in the
[team-context evaluation note](../data/evaluation/TEAM_CONTEXT_EVALUATION.md#runtime-scope-and-exclusions).
It also records each hero-search depth's proxy cutoff and exact-guide
reservations, then carries the guide
maximum-cardinality objective, occupied-skill conflicts, augmenting owner moves,
and final slot assignments. Every rejected guide-skill alternative is
canonically ranked before the bounded rejected list is truncated; alternatives
distinguish scored, feasible-but-pruned, priority-rejected, and infeasible routes,
while unscored routes use null decision fields rather than fabricated values.
Selected model skill routes retain their strongest rejected routes with
gain/support ordering and canonical-slot placement effect. Unplaced skills
separate qualified routes to selected heroes from routes that exist only through
unplaced heroes. The trace is diagnostic only and does not change recommendation
ranking.

The export is generated locally from data already loaded by the page. It does
not upload anything and deliberately excludes telemetry/session identifiers,
cookies, unrelated local storage, and the full battle corpus/model maps. Calling
it before a recommendation is ready returns a `not-ready` explanation instead.

### Pinyin Search
Chinese hero and skill names can be searched using pinyin romanization for easier input.

### MUI Theme
Uses a custom light **演武策牒** theme in `src/theme/theme.ts`: flat warm
rice-paper surfaces, smoky-ink text, explicit muted-jade, seal-red, bronze-gold,
and purple shade scales, plus high-contrast focus indicators. Songti serif
headings and functional elevation retain the strategy-table character without
adding decorative page texture or flattening interactive cards and overlays.
The local card-art contract and 祝融 asset mapping are documented in
[`public/game-assets/README.md`](public/game-assets/README.md).

## Troubleshooting

### Build Issues
- Delete `node_modules`, then run `pnpm install --frozen-lockfile`
- Clear browser site data (`localStorage` and cookies)
- Run `pnpm typecheck` and `pnpm build` to surface type/build errors

## Contributing

1. Create a feature branch from `master`
2. Make changes with proper commit messages
3. Verify per [AGENTS.md](AGENTS.md): `pnpm typecheck`, `pnpm test`,
   `pnpm test:e2e`, `pnpm build`
4. Submit a pull request

## License

Proprietary - Internal use only
</content>
</invoke>
