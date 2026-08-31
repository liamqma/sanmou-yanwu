# Yanwu guide

The public `/guides/yanwu` route presents the imported 飞将吕布 guide data as a
reference view separate from recommendation scoring.

## Sub-features

- Country-grouped hero tiers and categorized tactic tiers.
- Collapsed, filterable strong/championship team library.
- Thirteen-by-thirteen lineup matchup reference and selectors.
- Championship groups and prose analysis sections.
- Source attribution and normalized update date.
- Links back to the advisor and from in-round known-team suggestions.

## How to get to it (user POV)

Open `演武攻略` from the desktop rail or mobile menu, or visit
`/guides/yanwu`. Review the hero and tactic rankings, choose a `档位`, expand the
matching team library, and use the matchup selectors under `阵容克制查询`.
Return through `对局推荐`. During a draft, `本轮阵容方向` also links to the full
library in a new tab.

## Driving it with Playwright

Use the guide and draft-direction suites:

```bash
pnpm exec playwright test tests/yanwuGuide.spec.js --workers=1
pnpm exec playwright test tests/knownStrongTeams.spec.js --workers=1
```

Stable handles include:

- the level-one heading
  `三国谋定天下演武武将、战法与阵容指南`;
- `yanwu-guide-attribution`, `guide-skill-rankings`,
  `guide-team-library`, and `guide-team-card` test IDs;
- headings `国家武将排行榜`, `战法排行榜`, `强队阵容`,
  `阵容克制查询`, and `阵容解析`;
- comboboxes `档位` and `己方阵容`;
- the `阵容克制关系` table and `对局推荐` link.

Proof should show the source-derived section, an applied tier filter, expansion
of the filtered cards, and at least one exact lineup in both the matchup table
and selector. Navigation proof must also show that guide attribution disappears
outside this route.

## Gotchas

- The team library starts collapsed at every viewport size. Hidden cards still
  exist in the DOM, so assert visibility as well as count.
- Championship provenance sorts ahead of ordinary S teams but is not a new
  model tier.
- The matrix is column build versus row build and is reference-only. It does not
  alter recommendation scores.
- Guide rankings and known teams never bypass the recommender's evidence gates.
- `攻略数据由飞将吕布提供` belongs only on this page. The displayed update value
  is date-only even if source metadata contains a timestamp.
- Similar lineup names, including parenthetical variants, are distinct options;
  use exact accessible names.
