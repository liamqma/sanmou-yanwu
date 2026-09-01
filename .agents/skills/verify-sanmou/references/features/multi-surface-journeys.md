# Multi-surface journeys

These paths cross route or persistence boundaries. Read this file in addition to
the individual feature files whenever a change affects shared state, navigation,
or delivery.

## Sub-features

- Advisor roster to unlocked Team Builder, edited formation, and reload.
- Draft known-team direction to the full Yanwu guide and back.
- Successful contribution messaging to the separately published leaderboard.
- Desktop/mobile navigation with Round 4 Team Builder gating and progress-gated
  reset.
- Saved advisor progress through production prerender hydration.
- Prerendered route through client-side navigation without content replacement.

## How to get to it (user POV)

1. Enter or restore an advisor roster at Round 4 or later, open `队伍推荐`,
   edit a card or formation, reload, and return to `对局推荐`.
2. Generate a round recommendation, follow `查看完整阵容库`, inspect the guide,
   and return through `对局推荐`.
3. Submit a valid mocked report, follow the contribution copy to
   `战报贡献榜`, and understand that publication is daily rather than immediate.
4. With progress present, switch routes through both desktop and mobile
   navigation, then reset and confirm the state-dependent actions disappear.
5. Load a production route with saved progress and ensure hydration reveals the
   restored round rather than flashing or replacing it with default setup.

## Driving it with Playwright

The existing suites cover the constituent states, but journeys 1–4 are not each
covered by one trigger-to-destination test. Use these as fragment coverage
without claiming that they prove the complete transitions:

```bash
pnpm exec playwright test tests/supportHeroSkills.spec.js \
  -g 'team display' --workers=1
pnpm exec playwright test tests/buildATeam.spec.js \
  -g 'persists an edited lineup' --workers=1
pnpm exec playwright test tests/knownStrongTeams.spec.js --workers=1
pnpm exec playwright test tests/battleContribution.spec.js \
  -g 'validates locally, previews both teams' --workers=1
pnpm exec playwright test tests/uploadLeaderboard.spec.js --workers=1
pnpm exec playwright test tests/accessibilityLayout.spec.js \
  -g 'mobile menu' --workers=1
pnpm test:prerender
```

`knownStrongTeams.spec.js` checks the guide link contract but does not open it.
`battleContribution.spec.js` exposes the post-submit leaderboard action, while
`uploadLeaderboard.spec.js` enters the leaderboard from ordinary navigation.
The selected mobile-menu test checks gating and breakpoints without navigating
or resetting.

When journeys 1–4 change, retain a trace and drive the uncovered transition
through visible controls:

1. Seed Round 4 or later, start at `/`, activate `队伍推荐`, edit a card or
   formation, reload to verify persistence, then activate `对局推荐`.
2. Generate `本轮阵容方向`, activate `查看完整阵容库`, handle its new page,
   verify the Yanwu guide heading, then activate that page's `对局推荐` link.
3. Intercept `/api/battles`, submit a complete report, verify the success and
   daily-publication message, activate `查看战报贡献榜`, and verify the destination
   against a separately intercepted static leaderboard artifact.
4. Seed Round 4 or later, navigate once through the desktop rail and once
   through a mobile `菜单` item, then accept the `重置进度` confirmation and
   verify the advisor setup plus disappearance of Team Builder and reset actions.

For every changed journey, capture the trigger, transition, and destination
state in one trace. Verify persisted state after a real reload. At write
boundaries, inspect the intercepted request and keep the static read fixture
separate.

## Gotchas

- Advisor progress and Team Builder layout use separate versioned
  `localStorage` records. Resetting progress clears both; changing the selected
  season does not.
- The advisor's season cookie and contribution-season cookie are independent.
- Team Builder navigation is hidden through Round 3 and appears at Round 4.
  Direct routing works earlier with a non-empty roster and shows the valid empty
  state when no roster exists; automatic recommendation separately requires at
  least 9 unique heroes and 18 unique tactics.
- A successful battle upload does not update the leaderboard in the same
  session. The write queue and generated static read artifact are intentionally
  separated.
- The full guide link from a known-team direction opens a new tab. Handle the
  new page rather than waiting for same-page navigation.
- Production hydration must restore saved progress before marking the page
  ready. Default setup must not flash as the final hydrated state.
- Client navigation after hydration must retain route content and emit no
  hydration mismatch errors.
