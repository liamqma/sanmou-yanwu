# Multi-surface journeys

These paths cross route or persistence boundaries. Read this file in addition to
the individual feature files whenever a change affects shared state, navigation,
or delivery.

## Sub-features

- Advisor roster to unlocked Team Builder, edited formation, and reload.
- Draft known-team direction to the full Yanwu guide and back.
- Successful contribution messaging to the separately published leaderboard.
- Desktop/mobile navigation with progress-gated destinations and reset.
- Saved advisor progress through production prerender hydration.
- Prerendered route through client-side navigation without content replacement.

## How to get to it (user POV)

1. Enter or restore an advisor roster, open `队伍推荐`, edit a card or formation,
   reload, and return to `对局推荐`.
2. Generate a round recommendation, follow `查看完整阵容库`, inspect the guide,
   and return through `对局推荐`.
3. Submit a valid mocked report, follow the contribution copy to
   `战报贡献榜`, and understand that publication is daily rather than immediate.
4. With progress present, switch routes through both desktop and mobile
   navigation, then reset and confirm the state-dependent actions disappear.
5. Load a production route with saved progress and ensure hydration reveals the
   restored round rather than flashing or replacing it with default setup.

## Driving it with Playwright

Use existing cross-boundary coverage rather than inventing a test-only route:

```bash
pnpm exec playwright test tests/supportHeroSkills.spec.js \
  -g 'team display' --workers=1
pnpm exec playwright test tests/buildATeam.spec.js \
  -g 'persists an edited lineup' --workers=1
pnpm exec playwright test tests/knownStrongTeams.spec.js --workers=1
pnpm exec playwright test tests/uploadLeaderboard.spec.js --workers=1
pnpm exec playwright test tests/accessibilityLayout.spec.js \
  -g 'mobile menu' --workers=1
pnpm test:prerender
```

For a changed journey, prefer one trace that contains the trigger, transition,
and destination state. Verify persisted state after a real reload. When the
journey crosses a write boundary, inspect the intercepted request and then use a
separate static artifact fixture for the read side.

## Gotchas

- Advisor progress and Team Builder layout use separate versioned
  `localStorage` records. Resetting progress clears both; changing the selected
  season does not.
- The advisor's season cookie and contribution-season cookie are independent.
- Team Builder navigation is hidden without progress even though direct routing
  still shows a valid empty state.
- A successful battle upload does not update the leaderboard in the same
  session. The write queue and generated static read artifact are intentionally
  separated.
- The full guide link from a known-team direction opens a new tab. Handle the
  new page rather than waiting for same-page navigation.
- Production hydration must restore saved progress before marking the page
  ready. Default setup must not flash as the final hydrated state.
- Client navigation after hydration must retain route content and emit no
  hydration mismatch errors.
