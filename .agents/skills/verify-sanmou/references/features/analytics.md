# Analytics

The `/analytics` route separates anonymous player-choice aggregates from the
historical battle-model explanation and rankings.

## Sub-features

- Optional `匿名选项统计` offer and picked-when-offered rankings from the static
  telemetry artifact.
- `历史战报分析` provenance, caveat, and explanation of model weight,
  relationship score, and support.
- Hero and tactic model-weight rankings plus usage rankings.
- One two-level relationship panel exposing HP, HT, HS, THS, B, and M modes.
- Hero/tactic filters that preserve true full-list rank.
- Forty-row progressive disclosure for large relationship families, including
  negative fitted relationships.
- Responsive, keyboard-focusable table disclosures.
- Collapsed technical data/algorithm diagnostics.

## How to get to it (user POV)

Open `数据洞察` from the desktop rail or mobile menu, or visit `/analytics`.
Expand a ranking on narrow screens, filter by a hero or tactic, choose one of
`武将搭配`, `战法搭配`, or `特殊加成`, then choose its relationship mode. Use
`显示更多` to reveal another result batch. Activate `数据与算法说明` for the
optional diagnostics.

## Driving it with Playwright

Use the suites by behavior:

```bash
pnpm exec playwright test tests/accessibilityLayout.spec.js \
  -g 'analytics' --workers=1
pnpm exec playwright test tests/analyticsSearchKeepsTrueRank.spec.js --workers=1
pnpm exec playwright test tests/analyticsRelationships.spec.js --workers=1
pnpm exec playwright test tests/playerChoiceAnalytics.spec.js --workers=1
pnpm exec playwright test tests/playerPreferenceFlow.spec.js --workers=1
pnpm exec playwright test tests/analyticsShadowSkillLabel.spec.js --workers=1
```

Stable handles include:

- the `数据洞察` level-one heading;
- `player-choice-analytics` and `battle-report-analytics` test IDs;
- labelled regions such as `全部武将排名表格，可滚动`;
- `relationship-ranking-panel`, `relationship-ranking-row`, and
  `relationship-show-more` test IDs;
- group/mode buttons such as `武将搭配`, `两人同队`, and `机制联动`;
- hero/tactic search placeholders and the `数据与算法说明` button.

For a ranking/filter proof, record a target's rank before filtering, apply the
user-visible filter, and show that the surviving row keeps the same rank. For a
relationship-mode proof, show the selected group and mode, the labelled table,
its exact semantics, signed score, and support. On mobile, confirm the table is
inside a labelled focusable scroll region without document overflow.

## Gotchas

- `匿名选项统计` is artifact-gated and can be absent for older telemetry schemas.
  Absence is valid only when the fixture lacks item analytics.
- Individual hero/tactic tables sort by model weight and do not present weight
  as a win rate.
- Filters preserve global rank rather than renumbering visible rows.
- HP and HT filter by contained heroes; HS/THS use their encoded identities; B
  filters through catalog members. M is an aggregate mechanic relation, so hero
  and tactic filters are explicitly not applied.
- Relationship families are independent. Do not infer one mode's meaning or
  expansion state from another.
- Large families show at most 40 matching rows initially. A query or mode change
  resets progressive disclosure.
- Negative weights are intentional and must remain reachable.
- `影 ·` labelling requires explicit shadow provenance or catalog metadata; a
  name collision with a signature tactic is insufficient.
- Technical diagnostics start collapsed and remain secondary to player-facing
  rankings.
