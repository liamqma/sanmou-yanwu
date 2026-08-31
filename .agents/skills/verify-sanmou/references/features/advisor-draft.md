# Advisor and ten-round draft

The `/` route takes a player from initial roster entry through ten rounds of
offer comparison and into the completed-game state.

## Sub-features

- Current-season selection and persistence.
- Initial selection of exactly four heroes and eight tactics with Chinese or
  pinyin search.
- Three offered groups per round, with the late-round shapes defined in
  `GAME_RULE.md`.
- AI recommendation, per-option score/evidence, explicit group selection, and
  round confirmation.
- Workbook-backed `本轮阵容方向` suggestions without bypassing model scoring.
- Optional support hero and tactic selection, replacement, and removal.
- Win-qualification gates before Rounds 7 and 9.
- Current-roster editing/disclosure, automatic rescoring, ten-round progress,
  and saved-progress restore.
- Round image copy/download for WeChat, game completion, and progress reset.

## How to get to it (user POV)

Open `/`, choose the current season, enter four heroes and eight tactics, then
activate `开始对局`. Fill all three offered groups, activate `获取 AI 推荐`, choose
one `选择本组`, and confirm it to advance. Repeat through Round 10.

Support actions live in `当前阵容` when available. On narrow screens, first
activate `展开当前阵容与仓库`. Qualification pauses present
`我赢了，进入下一轮`. A complete game offers the final team configuration; reset
is in the desktop rail or mobile menu once progress exists.

## Driving it with Playwright

Use these maintained journeys:

```bash
pnpm exec playwright test tests/setup.spec.js --workers=1
pnpm exec playwright test tests/gameRounds.spec.js --workers=1
pnpm exec playwright test tests/supportHeroSkills.spec.js --workers=1
pnpm exec playwright test tests/knownStrongTeams.spec.js --workers=1
pnpm exec playwright test tests/seasonSelection.spec.js --workers=1
pnpm exec playwright test tests/optionAnalysisLabels.spec.js --workers=1
pnpm exec playwright test tests/gameCardVisuals.spec.js \
  -g 'copies a complete round PNG' --workers=1
```

For a narrow proof, seed a later state with `seedGame` and `makeGameState` from
`tests/helpers.js`. Stable handles include:

- headings `第 N 轮：选择武将`, `第 N 轮：选择战法`, and `对局完成`;
- `当前赛季`, setup and round-search combobox labels;
- buttons `开始对局`, `获取 AI 推荐`, `选择本组`,
  `确认选择并进入下一轮`, and `我赢了，进入下一轮`;
- regions `本轮三组选项` and `当前阵容`;
- `option-score-N`, `analysis-set-card`, and `game-card-*` test IDs.

Proof of a round change includes the selected state, the enabled confirmation,
the next round heading, and the mocked telemetry request where that side effect
is relevant. Proof of persistence includes a reload and the restored user state.
Proof of sharing includes the generated PNG dimensions and clipboard or download
result, not only the success toast.

## Gotchas

- Clear browser storage for an initial-setup proof. Later-round fixtures must use
  the versioned `gameProgress` envelope through `tests/helpers.js`.
- Season limits support candidates; it does not restrict initial setup or normal
  round inputs.
- Skill rounds offer orange tactics only. Signature/shadow classification comes
  from the catalog rather than visible color alone.
- Recommendation and rescoring are asynchronous. Wait for visible scores,
  recommendation text, or the progress indicator to settle.
- Mobile keeps all A/B/C option groups in document order and collapses the
  current roster; it does not use an option tab switcher.
- Qualification dismissal is persisted separately for the two gates. Always
  verify reload behavior when changing either gate.
- Intercept `/api/telemetry/rounds`; verification must not write live events.
- Support changes must preserve the current offers and selected group while new
  scores settle.
