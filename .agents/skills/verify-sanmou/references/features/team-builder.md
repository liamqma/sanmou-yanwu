# Team Builder

The state-dependent `/team-builder` route recommends and edits three concrete
teams from the player's acquired card pool.

## Sub-features

- Focused empty state when no valid roster exists.
- Worker-backed, evidence-gated initial three-team recommendation and loading
  state.
- Hero/tactic repositories, support markers, and current-roster editing.
- Tap-to-place, keyboard, pointer/touch drag-and-drop, swapping, removal, and
  cancellation.
- Formation and front/back-row controls with three live per-team scores.
- Permanent relationship evidence and transient HP, HS, SP, and exact-trio HT
  previews with accessible breakdown dialogs.
- Current-pool-scoped layout persistence, restore-recommendation action, and
  stale/legacy save handling.
- Strength-review prompt copy and its explanatory dialog.
- Desktop and narrow-screen repository/card containment.

## How to get to it (user POV)

Build a roster on `/`, start the draft, and advance to Round 4. `队伍推荐`
then appears in both navigation and the round action. A direct visit to
`/team-builder` also works before Round 4 when a saved game has a non-empty
roster; without one it shows `还没有可编排的卡池` and a `返回对局推荐` action.

With any non-empty pool, select or drag cards from `武将仓库` and `战法仓库`
into the three team regions. Choose an `阵型`, toggle each hero's front/back
row, inspect a visible relationship score, or activate `生成强度复盘提示词`.
Automatic recommendation starts only with at least 9 unique heroes and 18
unique tactics; smaller pools remain manually editable. Player edits persist
on reload and can be replaced with the current pool's recommendation when one
is available.

## Driving it with Playwright

`tests/buildATeam.spec.js` is the authoritative interaction suite. Run focused
journeys while iterating because the full file intentionally covers many
pointer, keyboard, responsive, and relationship states:

```bash
pnpm exec playwright test tests/buildATeam.spec.js \
  -g 'requires a valid game roster' --workers=1
pnpm exec playwright test tests/buildATeam.spec.js \
  -g 'tap-to-place builds, reviews, and persists' --workers=1
pnpm exec playwright test tests/buildATeam.spec.js \
  -g 'whole hero and skill blocks drag' --workers=1
pnpm exec playwright test tests/buildATeam.spec.js \
  -g 'seeds exactly one evidence-only editable three-team formation' --workers=1
```

Also use `tests/localAgentTeamBuilder.spec.js` only when the explicit local-agent
control changes, and `tests/accessibilityLayout.spec.js` for the empty/mobile
layout contracts. Before completion, run the full web checks required by
`web/AGENTS.md`, including the complete Team Builder suite.

Stable handles include:

- headings `队伍策案`, `还没有可编排的卡池`, and `我的比赛阵容`;
- regions `我的比赛阵容`, `武将仓库`, `战法仓库`, and
  `队伍 N 武将配置`;
- `pool-hero-*`, `pool-skill-*`, `hero-slot-T-H`,
  `skill-slot-T-H-S`, and `formation-select-T` test IDs;
- buttons `生成强度复盘提示词`, `恢复阵容库推荐`, and the explicit remove,
  row, cancel, and relationship-detail controls.

A convincing edit proof places a hero and tactics through a user control,
changes formation or row when relevant, checks the rendered team, reloads, and
confirms the same saved layout. Relationship proof must include the visible
source/target context, signed score, complete dialog breakdown, and focus-safe
close behavior.

## Gotchas

- `队伍推荐` is absent from navigation and the round action through Round 3;
  both unlock at Round 4. Direct routing remains available earlier for a saved
  roster and must retain its no-roster empty state.
- Automatic recommendation requires at least 9 unique heroes and 18 unique
  tactics. Smaller pools open the manual workshop without running it.
- A full recommendation can take up to 30 seconds on shared CI CPU. Wait on
  `我的比赛阵容` or the loading panel, not a guessed delay.
- Use the existing seeded fixtures in `buildATeam.spec.js`. Team Builder storage
  is versioned and keyed to the sorted current pool; an arbitrary layout may be
  intentionally discarded.
- HP, HS, SP, and HT are the displayed relationship families. THS, TSP, M, HC,
  and B still affect scoring but must not appear as relationship evidence.
- Dragging has a real activation threshold and moving geometry. Use the suite's
  pointer helpers rather than `dragTo` or coordinate guesses.
- Tactic slots remain with their original team position when a hero moves to an
  empty slot; this is deliberate and covered behavior.
- Narrow team cards intentionally scroll inside their team region. Document-level
  horizontal overflow is still a failure.
- Clipboard proof should inspect copied text through a granted test permission;
  it must not depend only on a toast.
