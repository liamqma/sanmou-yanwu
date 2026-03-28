---
name: miniprogram-vue
description: >
  Development skill for the 三谋对局助手 (Game Advisor) uni-app mini program.
  Use this skill whenever working on the miniprogram-vue project — including UI changes,
  service logic, visual verification, testing, or build configuration. It covers the
  project architecture, component map, data flow, build setup, common pitfalls, and
  how to visually inspect changes with Playwright screenshots.
---

# 三谋对局助手 — Game Advisor Mini Program

## Project Overview

- **Framework**: uni-app (Vue 3) + Wot Design Uni component library
- **Build targets**: H5 (web, dev/testing) and WeChat Mini Program (production)
- **Dev server**: `npm run dev:h5` → `http://localhost:5173`
- **WeChat build**: `npm run build:mp-weixin` (uses `scripts/mp-weixin-build.sh` to inject `UNI_APP_ID` from `.env`)
- **Tests**: Playwright (`npx playwright test --reporter=line`)

## Architecture

```
src/
├── pages/
│   ├── index/index.vue      # Main game page (setup + playing phases)
│   └── analytics/index.vue  # Stats dashboard (hero/skill win rates, synergies)
├── components/
│   └── ItemPicker.vue       # Custom filterable multi-select (heroes/skills)
├── composables/
│   ├── useGame.js           # Game state machine (shared module-level state)
│   └── usePinyin.js         # Pinyin conversion helper for ItemPicker search
├── services/
│   ├── dataStore.js         # Data fetching + caching (uni.request / fetch)
│   ├── gameLogic.js         # Round type logic, item counts per round
│   ├── promptGenerator.js   # Builds LLM prompt from battle context
│   └── recommendationEngine.js # Analytics, win rates, wilson scores, synergy
└── static/                  # Static assets
```

## Key Components

### ItemPicker.vue (custom component)
- Replaces the old `wd-select-picker` — do NOT use `wd-select-picker` for hero/skill selection
- Props: `items` (string[]), `modelValue` (string[]), `label`, `placeholder`, `max`
- Emits: `update:modelValue`
- Built-in pinyin search (via `usePinyin.js` + `pinyin-pro` library)
- Labels shown as `汉字 Pinyin` (e.g. `曹操 Caocao`)
- Search is case-insensitive; filters by Chinese characters or pinyin prefix

### Wot Design Uni components used
- `wd-card` — section containers
- `wd-tag` — selected item chips (closable)
- `wd-button` — action buttons
- `wd-notice-bar` — error display
- `wd-loading` — loading spinner
- `wd-toast` — success/info notifications
- `wd-tabs` / `wd-tab` — analytics page tabs

## Game Flow (useGame.js)

State is **module-level** (shared singleton across component instances on the same page):

```
setup phase → playing phase (8 rounds) → done
```

- **Setup phase**: User selects 3 sets of heroes + skills via `ItemPicker`
- **Playing phase**: Each round asks for current hero + 1–2 skills; AI recommendation generated per round
- Round type (hero vs. skill) determined by `gameLogic.getItemsPerSet()`

## Data & Services

- **Data source (H5 dev)**: Proxied via Vite from `web/src/` (see `vite.config.js` proxy)
- **Data source (WeChat)**: Fetched from Gitee raw URLs; requires `Referer: https://gitee.com/` header
- `dataStore.js` `fetchJson` checks HTTP status codes and rejects with descriptive errors on non-2xx responses
- Key data files: `database.json` (heroes/skills), `battle_stats.json` (win rates, pair stats, combinations)

## Build Configuration

### WeChat AppID
The AppID is **never hardcoded** in source. It's injected at build time:
1. `src/manifest.json` contains `WECHAT_APP_ID_PLACEHOLDER`
2. Create `.env` with `UNI_APP_ID=wx...` (gitignored; see `.env.example`)
3. `npm run dev:mp-weixin` / `npm run build:mp-weixin` calls `scripts/mp-weixin-build.sh`
   which substitutes the placeholder, runs the build, then restores the placeholder

### Sass
- Pinned to `sass@1.77.8` — do NOT upgrade beyond 1.77.x (avoids `@import` deprecation warnings)

### Wot Design style overrides
- Use **unscoped** `<style>` (not `<style scoped>`) to pierce component shadow boundaries
- Target classes like `.wd-card__content`, `.wd-cell__value`, `.wd-button__txt`

## Visual Verification Workflow

### 1. Start dev server
```bash
cd miniprogram-vue && npm run dev:h5
```

### 2. Take screenshots with Playwright
```javascript
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });

  // Main game page
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tests/tmp_rovodev_main.png', fullPage: true });

  // Analytics dashboard
  await page.goto('http://localhost:5173/pages/analytics/index', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tests/tmp_rovodev_analytics.png', fullPage: true });

  await browser.close();
})();
```

### 3. Interactive picker screenshot
```javascript
await page.locator('text=初始武将').first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tests/tmp_rovodev_picker.png', fullPage: true });

// Test pinyin search
await page.fill('input[placeholder*="搜索"]', 'cao');
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/tmp_rovodev_search.png', fullPage: true });
```

### 4. View screenshots
Use `open_files` on the PNG to inspect for visual issues.

## Running Tests
```bash
cd miniprogram-vue && npx playwright test --reporter=line
```

Test files in `tests/`: `setup.spec.js`, `recommendation.spec.js`, `synergy.spec.js`, `promptGenerator.spec.js`

> Note: `recommendation.spec.js` has a known pre-existing flakiness issue unrelated to code changes.

## Pages Reference

| Page | Route | Description |
|---|---|---|
| Main | `pages/index/index` | Setup phase (3 sets) + playing phase (8 rounds) + AI recommendation |
| Analytics | `pages/analytics/index` | Win rate tables, usage stats, synergy analysis, hero combinations |

## Verification Checklist

After any change, take a screenshot and confirm:
- [ ] No error banners or console errors
- [ ] Affected UI renders correctly at 375px mobile width
- [ ] Interactive elements (pickers, buttons, tabs) respond as expected
- [ ] Data loads and displays without issues
- [ ] No visual regressions on unrelated parts of the page

## Temp File Rules
- All temp screenshots: prefix with `tmp_rovodev_`
- Clean up temp files after verification using `delete_file`
- Test artifacts go in `tests/` or `test-results/` directories
