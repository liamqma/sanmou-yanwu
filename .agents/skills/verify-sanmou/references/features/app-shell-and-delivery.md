# Application shell and delivery

The shared shell supplies responsive navigation and error/loading treatment.
The production build prerenders every route and hydrates it into the same client
application.

## Sub-features

- Desktop command rail and compact mobile/tablet menu with active-route state.
- Progress-gated Team Builder navigation, reset action, discussion-group dialog,
  and battle-count footer.
- One level-one heading per primary route and a focused not-found page.
- Per-route title, description, canonical URL, robots policy, Open Graph data,
  and structured data.
- Local manifest-backed hero/tactic art with a named fallback.
- Shared lazy-route, data, and Team Builder loading treatment.
- Route-specific production prerender with critical styles.
- Readable no-JavaScript content, hydration curtain, restored-state hydration,
  client navigation, and fail-open startup behavior.
- Desktop/tablet/mobile visual diagnostics for overflow, page errors, and theme
  surfaces.

## How to get to it (user POV)

At desktop width, use the left `主要导航` rail. At mobile and tablet widths,
activate `菜单` inside `移动导航`, choose a destination, or open the discussion
and reset actions. Visit an unknown path for `页面未找到`.

A production visitor receives readable route content before JavaScript starts.
The temporary `谋` curtain protects hydration and then disappears; if the
client bundle fails, prerendered content becomes readable rather than remaining
blocked.

## Driving it with Playwright

Use the maintained shell and delivery suites:

```bash
pnpm exec playwright test tests/accessibilityLayout.spec.js --workers=1
pnpm exec playwright test tests/seo.spec.js --workers=1
pnpm exec playwright test tests/gameCardVisuals.spec.js --workers=1
pnpm test:prerender
```

For visual UI changes, start a doctor-checked Vite server as described in the
parent skill and run:

```bash
(
set -euo pipefail
evidence_root="$(mktemp -d "${TMPDIR:-/tmp}/sanmou-verification.shell.XXXXXX")"
visual_dir="$evidence_root/visual"
report="$visual_dir/report.json"
printf 'Evidence directory: %s\nReport: %s\n' "$evidence_root" "$report"
VISUAL_AUDIT_BASE_URL=http://127.0.0.1:3000 \
  node scripts/capture-visual-audit.mjs "$visual_dir"
test -s "$report"
)
```

Stable handles include the `主要导航` and `移动导航` regions,
`mobile-navigation-button`, route-specific level-one headings,
`game-loading-panel`, `game-card-*`, and hydration attributes on `html` and
`#root`.

Shell proof must exercise the affected viewport and route transition, not only
inspect a static link. Production proof must use the built preview and show the
prerendered content, curtain lifecycle, and final hydrated route where relevant.
Inspect the run-unique report path printed by the command; a zero command exit
alone is insufficient if expected evidence files are missing.

## Gotchas

- The MUI `md` breakpoint changes mobile navigation to the desktop rail at
  900px. A 768px viewport still uses the mobile menu.
- `队伍推荐` and reset are state-dependent. Seed progress before expecting them.
- Public content routes are indexable; `/team-builder` and unknown routes are
  `noindex,follow`.
- `/404.html` is a concrete prerender target while unknown client routes render
  the same not-found content through React Router.
- The production suite deliberately blocks bundles and route chunks. Its waits
  represent expected loading states, not flaky delays.
- With JavaScript disabled, interaction is unavailable but route content and
  critical styling must remain visible and uninert.
- Card images must come from the local manifest. A failed asset uses
  `/game-assets/card-fallback.svg` and keeps the item name readable.
- Intentional horizontal scrollers inside Team Builder are allowed; document-level
  horizontal overflow is not.
- The visual audit assumes a running server and creates screenshots plus
  `report.json`; cleanup must preserve that directory.
