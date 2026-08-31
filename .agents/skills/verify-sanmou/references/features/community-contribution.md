# Community contribution

The `/contribute` route validates a reviewed battle report and posts it through
the write-only Pages Function. `/contributors` reads the separately generated
static leaderboard.

## Sub-features

- Copyable DeepSeek OCR prompt with a collapsed full preview.
- Best-effort JSON parsing and partial catalog-backed prefill.
- Fully manual two-team confirmation as an alternative to JSON.
- Six heroes, signature tactics, twelve equipped tactics, winner, season, and
  duplicate/availability validation.
- Current-model score preview for both teams.
- Optional exact contributor name and separate contribution-season cookies.
- Idempotent retry with one stable submission ID.
- Success/error/full-queue messaging at the `/api/battles` boundary.
- Static contributor totals and ranking with preserved, escaped names.
- Navigation between contribution, leaderboard, and advisor routes.

## How to get to it (user POV)

Open `上传战报`. Optionally copy `复制 DeepSeek 提示词`, process a screenshot
outside the app, and paste the returned JSON. Repair unrecognized fields in the
confirmation form, or skip JSON and enter both teams manually. Select `战报赛季`
and `本场胜方`, review both lineup scores, then activate `提交战报`.

Open `战报贡献榜` to see the last published aggregate. From there, use
`上传我的战报` or `返回对局推荐`.

## Driving it with Playwright

Always intercept the write endpoint. The maintained suites already do so:

```bash
pnpm exec playwright test tests/battleContribution.spec.js --workers=1
pnpm exec playwright test tests/contributeShadowSkills.spec.js --workers=1
pnpm exec playwright test tests/uploadLeaderboard.spec.js --workers=1
```

Stable handles include:

- headings `上传战报`, `阵容 1`, `阵容 2`, and `战报贡献榜`;
- textboxes `贡献榜名字（选填）`,
  `粘贴 DeepSeek 返回的 JSON（可选）`, and `DeepSeek OCR 提示词`;
- comboboxes `战报赛季`, `本场胜方`, and the positional hero/tactic labels;
- regions `阵容 1`, `阵容 2`, and `贡献者排名`;
- buttons `提交战报`, `复制 DeepSeek 提示词`, `上传我的战报`, and
  `返回对局推荐`.

A submission proof intercepts `**/api/battles`, inspects the exact request,
returns a production-shaped response, and verifies the corresponding UI state.
Retry proof must show that the second request retains the same submission ID and
payload. Leaderboard proof intercepts the static JSON file and demonstrates that
untrusted names render as text rather than markup.

## Gotchas

- Never submit a verification report to the deployed endpoint. Route mocking at
  `/api/battles` preserves the real browser validation and transport boundary.
- JSON prefill is deliberately partial: recognized values survive while missing
  or unknown fields stay editable. The final form remains the approval gate.
- A recognized hero deterministically supplies its read-only signature tactic.
  Equipped signature/shadow transfers have separate strict validation.
- The contribution season is stored independently from the advisor's selected
  season. Changing one must not modify the other.
- An explicitly empty contributor name is valid and persisted as an empty
  cookie value.
- Retries are transport-idempotent. Do not generate a new submission ID after a
  transient failure.
- The leaderboard is static and can lag a successful upload until the daily
  import. A successful submit must not assert immediate leaderboard presence.
- Contributor text preserves printable Unicode and meaningful whitespace; React
  escaping must prevent markup execution.
- The advisor must not request the leaderboard artifact before navigating to
  `/contributors`.
