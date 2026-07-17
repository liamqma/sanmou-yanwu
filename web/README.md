# Game Advisor - React Application

A **client-side-only** React application for game team composition analysis and
AI-prompt generation. There is **no backend server**: all recommendation and
analytics logic runs in the browser, and `src/services/api.ts` is an in-memory
shim (not an HTTP client) that reads the bundled `database.json` and
`recommendation_data.json`. See the root [README.md](../README.md) for how those
data files are generated.

## Features

- **Setup Phase**: Select starting heroes and skills with pinyin search support
- **Game Flow**: Round-by-round draft with recommendations for optimal team building (see [GAME_RULE.md](../GAME_RULE.md))
- **Manual Editing**: Edit team composition manually at any time
- **Analytics Dashboard**: Player-friendly, question-led analytics — hero/skill rankings by 强度加成 (relative roster strength, with 胜率参考/参考场次 as supporting context), usage, top synergies, and optional (collapsed) model diagnostics
- **Auto-save**: Progress automatically saved to cookies
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## Tech Stack

- **React** 19 - UI framework
- **Vite** - Dev server and production bundler
- **Vitest** - Unit/integration test runner (scoped to `src/**`)
- **TypeScript** (Go-native `typescript@7`) - standalone type checker (no emit)
- **Playwright** - End-to-end tests (under `tests/`)
- **Material-UI (MUI)** - Component library and styling
- **React Router** - Client-side routing
- **pinyin-pro** - Chinese pinyin search support
- **js-cookie** - Cookie-based persistence

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
├── public/              # Static assets (+ _redirects SPA fallback)
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
│   ├── database.json    # Source data (heroes, skills, mappings)
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
- Question-led layout with a plain-language guide to the three player-facing measures:
  胜率参考 (smoothed win rate), 强度加成 (relative roster strength / model weight), and
  参考场次 (reference battles). Hero/skill tables are ranked by 强度加成 (descending, with
  deterministic tie-breakers); usage and top synergies keep their own orderings.
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

All data is bundled at build time; nothing is fetched over the network:

- `src/database.json` — source data for heroes, skills, and hero↔skill mappings.
- `src/recommendation_data.json` — the paired-model artifact **generated** by
  `data/build_recommendation_data.py` (don't hand-edit).
- `src/services/api.ts` — in-memory shim exposing `getDatabaseItems`,
  `getRecommendation`, and `getAnalytics` (backed by `recommendationEngine.ts`).
- `src/services/recommendationModel.ts` — canonical builders for the model's
  feature ids (`H|`, `S|`, `HP|`, `HS|`, `SP|`); always use these rather than
  re-deriving ids inline (they must match the Python builder).
- `src/data.ts` — the central typed boundary that imports and casts the bundled
  `database.json`/`recommendation_data.json` once (typed against `src/types/`).

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

## Deployment

Deployed as a static site to Cloudflare Pages. `npm run build` produces the
`build/` output directory, and `public/_redirects` provides the SPA fallback
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
