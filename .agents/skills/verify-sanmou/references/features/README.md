# Sanmou web feature map

Behavior-level inventory of the React application. Agents use this map to find
the real user path, the maintained Playwright coverage, and the observable result
that counts as proof. It complements the detailed product contracts in
`README.md`, `GAME_RULE.md`, and `web/README.md`.

This is a product map, not a catalog of the recommender's `H`, `S`, `HP`, or
other model feature families.

## Baseline preconditions

- Run commands from `web/` unless a file says otherwise.
- Use Node.js 22, pnpm 11, and the checked-in lockfile.
- Let Playwright seed browser state through `tests/helpers.js`; do not hand-edit
  application source to reach a later round.
- If port 3000 already responds, run the verification skill's doctor and refuse
  to reuse a server from another checkout.
- Prefer roles, accessible names, labels, and `data-testid` selectors over CSS
  classes, coordinates, or DOM order.
- Wait for observable states. Recommendation and Team Builder worker results are
  asynchronous.
- Intercept write endpoints at their production boundary. Never create live
  telemetry or battle submissions as verification data.

## Proof and skip reporting

For a feature or fix, cover every affected entry point and reachable success,
validation/error, empty, cancellation, responsive, and persistence state named
in its file. Capture the action and stable result in a trace or screenshot and
assert non-visual side effects where relevant.

If account, browser capability, OS integration, remote storage, or another
external prerequisite blocks a path, name the attempted route and prerequisite.
Cover the closest real path without claiming the blocked path passed.

## Feature index

- [Advisor and ten-round draft](advisor-draft.md): setup, season, offers,
  recommendation, support choices, qualification gates, sharing, completion,
  persistence, and reset.
- [Team Builder](team-builder.md): Round 4 navigation, direct-route roster and
  automatic-recommendation prerequisites, generated three-team layout,
  accessible editing, relationship evidence, prompt copy, and persistence.
- [Analytics](analytics.md): anonymous choice counts, battle-model rankings,
  relationship modes, filters, progressive disclosure, and diagnostics.
- [Community contribution](community-contribution.md): OCR prompt, partial/manual
  confirmation, validation, write-boundary behavior, and static contributor
  leaderboard.
- [Yanwu guide](yanwu-guide.md): tier lists, strong-team library, matchup
  explorer, analysis, and attribution.
- [Application shell and delivery](app-shell-and-delivery.md): responsive
  navigation, route metadata, card assets, loading/error states, prerender,
  no-JavaScript content, and hydration.
- [Multi-surface journeys](multi-surface-journeys.md): state and navigation paths
  that cross feature boundaries. Finish here for a broad regression sweep.

## Full sweep

Run the feature specs named by each file, then the production-prerender suite.
For a visual change, also run:

```bash
(
set -euo pipefail
evidence_root="$(mktemp -d "${TMPDIR:-/tmp}/sanmou-verification.sweep.XXXXXX")"
visual_dir="$evidence_root/visual"
report="$visual_dir/report.json"
printf 'Evidence directory: %s\nReport: %s\n' "$evidence_root" "$report"
VISUAL_AUDIT_BASE_URL=http://127.0.0.1:3000 \
  node scripts/capture-visual-audit.mjs "$visual_dir"
test -s "$report"
)
```

That command assumes the verification run already started and health-checked
the same IPv4 Vite endpoint as described in the parent `SKILL.md`. Retain the
printed run-unique directory and inspect its printed report path.

## Entry contract

Every feature file uses the same four H2 sections:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with Playwright`
4. `Gotchas`
