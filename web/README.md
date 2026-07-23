# Game Advisor - React Application

A React application for game team composition analysis and AI-prompt
generation. All recommendation and current Analytics logic runs in the browser;
`src/services/api.ts` is an in-memory scoring shim (not an HTTP client) that
reads the bundled `database.json` and `recommendation_data.json`. An isolated
Cloudflare Pages Function writes anonymous confirmed-round telemetry to D1 but
does not participate in recommendation. See the root [README.md](../README.md)
for how the model data is generated.

## Features

- **Setup Phase**: Select starting heroes and skills with pinyin search support
- **Game Flow**: Round-by-round draft with recommendations for optimal team building (see [GAME_RULE.md](../GAME_RULE.md))
- **Manual Editing**: Edit team composition manually at any time
- **Analytics Dashboard**: Player-friendly, question-led analytics — hero/skill rankings by 胜率参考 (smoothed win rate, with 参考场次 as supporting context), 组合分 synergy tables, usage, and optional (collapsed) model diagnostics
- **Auto-save**: Progress automatically saved to cookies
- **Anonymous round telemetry**: Always-on, non-blocking offer/score/choice
  logging through a Cloudflare Pages Function with an offline local retry queue
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## Tech Stack

- **React** 19 - UI framework
- **Vite** - Dev server and production bundler
- **Vitest** - Unit/integration test runner (`src/**` plus Pages Functions)
- **TypeScript** (Go-native `typescript@7`) - standalone type checker (no emit)
- **Playwright** - End-to-end tests (under `tests/`)
- **Material-UI (MUI)** - Component library and styling
- **React Router** - Client-side routing
- **pinyin-pro** - Chinese pinyin search support
- **js-cookie** - Cookie-based persistence
- **Cloudflare Pages Functions + D1** - Write-only anonymous round telemetry

## Getting Started

### Prerequisites

- Node.js 22 (pinned in `.node-version`) and npm

### Installation

```bash
npm install
```

### Development

```bash
# Start the Vite dev server on http://localhost:3000
npm start

# Type-check with the Go-native typescript@7 (no emit)
npm run typecheck

# Run unit/integration tests once (Vitest)
npm test

# Run end-to-end tests (Playwright); first time: npx playwright install
npm run test:e2e

# Production build -> build/ (the Cloudflare Pages output dir)
npm run build

# Preview the production build locally
npm run preview
```

> Vite/esbuild strips types at build time but does **not** type-check, so
> `npm run typecheck` is the type gate. See [AGENTS.md](AGENTS.md) for the full
> pre-completion verification checklist.

## Project Structure

```
web/
├── functions/           # Cloudflare Pages Functions (`/api/telemetry/rounds`)
├── migrations/          # D1 schema migrations
├── public/              # Static assets (+ _redirects SPA fallback)
│   └── game-data/       # Publicly fetchable game data for copied LLM prompts
├── index.html           # Vite HTML entry (module script, gtag snippet)
├── src/
│   ├── components/      # React components
│   │   ├── common/      # Reusable components (AutocompleteInput, TagList, etc.)
│   │   ├── game/        # Game-related components (GameBoard, RoundInfo, etc.)
│   │   ├── layout/      # Layout components (AppLayout, Header)
│   │   └── setup/       # Setup phase components
│   ├── context/         # React Context (GameContext for state management)
│   ├── hooks/           # Custom React hooks (usePinyin)
│   ├── pages/           # Page components (GameAdvisor, Analytics, etc.)
│   ├── services/        # In-memory api shim and game logic (TypeScript)
│   ├── theme/           # Custom 墨策台 MUI theme configuration
│   ├── types/           # Hand-written domain/recommendation/game-state types
│   ├── utils/           # Utility functions (storage, tiers, clipboard)
│   ├── data.ts          # Typed JSON boundary (imports/casts the bundled data)
│   ├── recommendation_data.json # Generated model artifact (do not hand-edit)
│   ├── App.tsx          # Main application component
│   └── index.tsx        # Application entry point
├── tests/               # Playwright e2e specs
├── .node-version        # Pinned Node version
├── tsconfig.json        # TypeScript config (type-check only)
├── vite.config.js       # Vite + Vitest config
├── playwright.config.js # Playwright config (starts dev server on :3000)
├── package.json         # Dependencies and scripts
└── README.md            # This file
```

## Key Components

### Setup Phase
- **SetupForm**: Select the initial heroes and skills
- **AutocompleteInput**: Search with Chinese and pinyin support
- **TagList**: Display and manage selected items

### Game Phase
- **GameBoard**: Main game container managing the draft rounds
- **RoundInfo**: Display current round information with stepper
- **CurrentTeam**: Show current team (with its roster 评分/score) and manual edit capability
- **OptionSetInput**: Input 3 option sets (3 items each)
- **RecommendationPanel**: Highlight the top-ranked option set (ranked by per-round 评分/score)
- **AnalysisGrid**: Show 3 option sets, each with its marginal 评分/score and key point breakdown

### Analytics
- **Analytics**: Player-friendly dashboard driven by the generated paired-model artifact
- A separate **玩家选择洞察** (player-choice insights) section, driven by
  `public/game-data/telemetry_data.json`, reports offer/pick counts, AI-recommendation
  acceptance, per-round historical agreement and position bias, score-margin behaviour,
  and meaningful paired-vs-preference disagreements. It only describes how players chose
  (never win rate, never AI scoring); percentages below the support threshold are hidden,
  and preference-model status/held-out metrics surface only once the gates pass.
- Question-led layout with a plain-language guide to the three player-facing measures:
  胜率参考 (smoothed win rate), 组合分 (combo score — the model's extra pairing/hero-skill
  bonus, shown only on the synergy tables), and 参考场次 (reference battles). Individual
  hero/skill tables are ranked by 胜率参考 (descending, with deterministic tie-breakers);
  usage and top synergies keep their own orderings.
- In the 全部战法 skill ranking, a skill is labelled `影 · <name>` when it can only
  appear as a transferred/split (影) skill carried by another hero — either because
  it is an orange hero's innate (自带) skill (its carrier's own usage is excluded by
  the data builder) or because it is absent from the catalog entirely (only orange
  heroes and their orange skills are catalogued, so an uncatalogued skill belongs to
  a non-orange hero and can only surface here as a transfer). Its stats then reflect
  only that transferred usage.
- Technical model diagnostics (accuracy vs baseline, log loss, Brier, backtest sample/feature
  counts) live in an optional, collapsed accordion so they don't get in a casual player's way.

### Common
- **ErrorBoundary**: Global error handling
- **LoadingSkeleton**: Loading states for better UX
- **ResponsiveDisclosure**: Keeps dense detail expanded on larger screens while giving mobile users a toggle to collapse it (content stays mounted)

## Data & Logic

Core app data is bundled at build time. Copied web-LLM prompts may fetch the public static data files for extra details:

- `public/game-data/database.json` — canonical source data for heroes, skills, and hero↔skill mappings; copied prompts link to it with a weekly `?v=<week-start-date>` cache-buster.
- `public/game-data/formula.md` — public formula reference for copied web-LLM prompts.
- `src/recommendation_data.json` — the paired-model artifact **generated** by
  `data/build_recommendation_data.py` (don't hand-edit).
- `src/services/api.ts` — in-memory shim exposing `getDatabaseItems`,
  `getRecommendation`, and `getAnalytics` (backed by `recommendationEngine.ts`).
- `src/services/recommendationModel.ts` — canonical builders for the model's
  feature ids (`H|`, `S|`, `HP|`, `HS|`, `SP|`); always use these rather than
  re-deriving ids inline (they must match the Python builder).
- `src/data.ts` — the central typed boundary that imports and casts the canonical public database plus bundled `recommendation_data.json` once (typed against `src/types/`).

## State Management

Uses React Context API with `useReducer` for global state:

- Game state (current round, heroes, skills)
- Round inputs (3 option sets)
- Recommendations and selections
- Auto-save to cookies on every state change

## Persistence

Game progress is automatically saved to cookies with a 1-year expiry:
- Current game state
- Round inputs
- Automatically restored on page load

Anonymous telemetry uses a capped `localStorage` retry queue and a tab-owned
per-game session ID. See the root
[telemetry implementation plan](../TELEMETRY_IMPLEMENTATION_PLAN.md) for the
data contract and storage details.

The static `public/game-data/telemetry_data.json` file contains deterministic
aggregate player-choice counts and, after its evidence/quality gates pass, a
regularized conditional-choice model. It deliberately contains no event IDs,
session IDs, timestamps, pools, offers, choices, or other row-level data. The
browser continues to use only the paired battle model for recommendations; the
preference model supplies a separately labelled player-choice probability and
is omitted from the option cards unless both its evidence and held-out quality
gates pass.

## Cloudflare telemetry setup

The existing Git-connected Cloudflare Pages project remains the deployment
source of truth; no Wrangler configuration file is required.

1. Create a D1 database in the Cloudflare dashboard.
2. In the Pages project, add a production D1 binding named exactly
   `TELEMETRY_DB`, pointing at that database. Add a separate preview binding if
   preview deployments should accept telemetry.
3. Apply the migration from `web/` (replace the database name):

   ```bash
   npx wrangler d1 execute <database-name> \
     --remote \
     --file=migrations/0001_round_telemetry.sql
   ```

4. Redeploy after adding the binding. `/api/health` and
   `/api/telemetry/rounds` are then served by Pages Functions.

### Weekly aggregate workflow

The `Update telemetry data` GitHub Actions workflow uses the schedule declared
in `.github/workflows/update-telemetry-data.yml` and can also be started
manually. Configure it in the repository settings:

1. Add the `CLOUDFLARE_API_TOKEN` Actions secret. Use an account-scoped token
   limited to **D1 Read** for the account that owns the telemetry database.
2. Add `CLOUDFLARE_ACCOUNT_ID` as a non-secret Actions variable.
3. Add `CLOUDFLARE_D1_DATABASE_NAME` as a non-secret Actions variable.
4. Allow GitHub Actions to read and write repository contents so the workflow's
   scoped `contents: write` permission can push the changed generated file.

The workflow exports only `round_telemetry` to `$RUNNER_TEMP`, runs the builder,
then runs the web type-check, unit tests, and production build against the new
artifact before staging only `web/public/game-data/telemetry_data.json`. The builder fails
closed for unverifiable schema/catalog/model contracts, while quarantining
individual malformed or impossible events and publishing only their aggregate
`invalid_event_count`. It does not upload the SQL export or commit when the
generated bytes are unchanged. Checkout does not persist its GitHub credential;
the workflow exposes that token only to the final push step. The builder
recomputes event scores and tie-breaks from the recorded paired model version.
Before deploying a new `src/recommendation_data.json`, retain the previous
artifact under `../data/recommendation_models/` so historical events remain
verifiable. Run the same path locally with:

```bash
npx wrangler d1 export <database-name> --remote \
  --table=round_telemetry --output=/tmp/round_telemetry.sql
# From the repository root:
make build-telemetry EXPORT=/tmp/round_telemetry.sql
```

No browser or Pages Function secret is required for ingestion. The later
operational hardening and rate-limiting work is tracked in Phase 4 of the root
[telemetry implementation plan](../TELEMETRY_IMPLEMENTATION_PLAN.md).

For local Pages/D1 integration testing, build first and pass the local binding
explicitly:

```bash
npm run build
npx wrangler pages dev build --d1 TELEMETRY_DB=<database-id>
```

## Deployment

Deployed to Cloudflare Pages. `npm run build` produces the `build/` output
directory, and `public/_redirects` provides the SPA fallback
(`/* /index.html 200`) so client-side routes resolve on refresh/deep-link.

## Development Notes

### Pinyin Search
Chinese hero and skill names can be searched using pinyin romanization for easier input.

### MUI Theme
Uses a custom **墨策台** ("ink-strategy desk") theme in `src/theme/theme.ts` — a
warm rice-paper, smoky-ink, muted-jade, and seal-red editorial palette with Songti
serif headings, layered over MUI's component library.

## Troubleshooting

### Build Issues
- Delete `node_modules` and `package-lock.json`, then run `npm install`
- Clear browser cache and cookies
- Run `npm run typecheck` and `npm run build` to surface type/build errors

## Contributing

1. Create a feature branch from `master`
2. Make changes with proper commit messages
3. Verify per [AGENTS.md](AGENTS.md): `npm run typecheck`, `npm test`,
   `npm run test:e2e`, `npm run build`
4. Submit a pull request

## License

Proprietary - Internal use only
</content>
</invoke>
