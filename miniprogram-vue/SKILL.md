---
name: miniprogram-vue
description: >
  Essential skill for any work on the 三谋对局助手 (Game Advisor) WeChat mini program
  in the miniprogram-vue/ directory. Load this skill before making UI changes, fixing bugs,
  adding features, writing tests, or changing build configuration — it has critical gotchas
  (custom components, AppID injection, sass version pin) that will save you from common mistakes.
---

# 三谋对局助手 — Game Advisor Mini Program

## Quick Reference

| Task | Command |
|---|---|
| Start H5 dev server | `cd miniprogram-vue && npm run dev:h5` → `http://localhost:5173` |
| Run tests | `cd miniprogram-vue && npx playwright test --reporter=line` |
| WeChat dev | `cd miniprogram-vue && npm run dev:mp-weixin` (requires `.env`) |
| WeChat build | `cd miniprogram-vue && npm run build:mp-weixin` (requires `.env`) |

## Architecture

```
src/
├── pages/
│   ├── index/index.vue      # Main game page (setup + playing phases)
│   └── analytics/index.vue  # Stats dashboard (hero/skill win rates, synergies)
├── components/
│   └── ItemPicker.vue       # Custom filterable multi-select (heroes/skills)
├── composables/
│   ├── useGame.js           # Game state machine (shared module-level singleton)
│   └── usePinyin.js         # Pinyin conversion for ItemPicker search
├── services/
│   ├── dataStore.js         # Data fetching + caching
│   ├── gameLogic.js         # Round type / item count logic
│   ├── promptGenerator.js   # Builds LLM prompt from battle context
│   └── recommendationEngine.js # Win rates, wilson scores, synergy analytics
└── static/
```

## Critical Gotchas

### 1. Use `ItemPicker.vue`, NOT `wd-select-picker`
Hero and skill selection uses the custom `ItemPicker.vue` component — `wd-select-picker` was removed. When adding new pickers, always use `ItemPicker`:
```vue
<ItemPicker v-model="selected" :items="allHeroes" label="选择武将" :max="4" />
```
Props: `items` (string[]), `modelValue` (string[]), `label`, `placeholder`, `max`  
Search: case-insensitive, supports Chinese characters and pinyin prefix (e.g. `cao` → 曹操)

### 2. WeChat AppID is never hardcoded
`src/manifest.json` contains `WECHAT_APP_ID_PLACEHOLDER`. The build scripts inject the real ID from `.env`:
- Copy `.env.example` → `.env` and set `UNI_APP_ID=wx...`
- `npm run dev:mp-weixin` and `npm run build:mp-weixin` handle injection automatically via `scripts/mp-weixin-build.sh`

### 3. Don't upgrade sass beyond 1.77.x
Pinned to `sass@1.77.8` to avoid `@import` deprecation warnings from uni-app internals.

### 4. Wot Design style overrides need unscoped styles
To pierce Wot Design component boundaries, use unscoped `<style>` (not `<style scoped>`):
```vue
<style>
.wd-card__content { padding: 12px; }
</style>
```

### 5. `useGame.js` state is module-level (singleton)
All reactive state in `useGame.js` lives at module scope — it's intentionally shared across all component instances on the same page. Don't refactor it into local `setup()` state.

## Data & Services

- **H5 dev**: Data proxied via Vite from `web/src/` (configured in `vite.config.js`)
- **WeChat**: Fetched from Gitee raw URLs; requires `Referer: https://gitee.com/` header (set in proxy)
- Key files: `database.json` (heroes/skills list), `battle_stats.json` (win rates, pair stats, combos)
- `fetchJson` validates HTTP status and rejects non-2xx with a descriptive error

## Visual Verification

After UI changes, take a Playwright screenshot and inspect with `open_files`:

```bash
# 1. Start dev server (keep running in background)
cd miniprogram-vue && npm run dev:h5 &

# 2. Run a quick screenshot script
node -e "
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: 'tests/tmp_rovodev_main.png', fullPage: true });
  await b.close();
})();
"
```

Then `open_files(['miniprogram-vue/tests/tmp_rovodev_main.png'])` to inspect.  
For the analytics page use route `/pages/analytics/index`.

## Tests

```bash
cd miniprogram-vue && npx playwright test --reporter=line
```

Test files: `setup.spec.js`, `recommendation.spec.js` *(known flaky — pre-existing)*, `synergy.spec.js`, `promptGenerator.spec.js`

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
