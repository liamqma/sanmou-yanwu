const { test, expect } = require('@playwright/test');
const {
  seedGame, makeGameState,
  heroesWithMeta, heroChipLabel, rankedSkills, skillChipLabel, anySkills,
} = require('./helpers');

// Acceptance tests for the labels added to 选项分析 (option analysis):
//   - hero rounds: each candidate hero chip shows `名 · 档位`
//   - skill rounds: ranked candidate chips show `名 · 档位`
// See web/src/components/game/AnalysisGrid.js (itemChipLabel).
//
// Labels must appear ONLY inside 选项分析 — the rest of the app (team chips,
// autocomplete, setup form) was intentionally left showing bare names.

test.describe('选项分析 — hero & skill labels', () => {
  test('sanmouDebug exports not-ready and exact recommendation contexts', async ({ page }) => {
    const team = heroesWithMeta.slice(0, 4);
    const candidates = heroesWithMeta.slice(4, 13);
    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      {
        set1: candidates.slice(0, 3),
        set2: candidates.slice(3, 6),
        set3: candidates.slice(6, 9),
      },
    );

    const before = await page.evaluate(() => JSON.parse(window.sanmouDebug()));
    expect(before).toMatchObject({
      page: 'candidate-suggestion',
      status: 'not-ready',
    });

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    await expect(page.getByText('选项分析')).toBeVisible({ timeout: 15000 });
    const after = await page.evaluate(() => JSON.parse(window.sanmouDebug()));
    expect(after).toMatchObject({
      schema: 'sanmou-recommendation-debug/v1',
      page: 'candidate-suggestion',
      status: 'ready',
    });
    expect(after.options).toHaveLength(3);
    expect(after.decision.ranking).toHaveLength(3);
    expect(after.options[0].score_calculation.length).toBeGreaterThan(0);
    expect(after.model).not.toHaveProperty('weights');
  });

  test('successful round-prompt copies record the GA event without prompt data', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const team = heroesWithMeta.slice(0, 4);
    const candidates = heroesWithMeta.slice(4, 13);

    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      {
        set1: candidates.slice(0, 3),
        set2: candidates.slice(3, 6),
        set3: candidates.slice(6, 9),
      },
    );

    await page.getByRole('button', { name: '复制 AI 分析提示词' }).click();
    await expect(page.getByText('提示词已复制到剪贴板')).toBeVisible();

    const analyticsEvents = await page.evaluate(() =>
      (window.dataLayer || [])
        .filter((entry) => entry?.[0] === 'event')
        .map((entry) => [entry[0], entry[1], entry.length])
    );
    expect(analyticsEvents).toContainEqual([
      'event',
      'copy_round_analysis_prompt',
      2,
    ]);
  });

  test('desktop: all three option sets share one horizontal row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const team = heroesWithMeta.slice(0, 4);
    const candidates = heroesWithMeta.slice(4, 13);

    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      { set1: candidates.slice(0, 3), set2: candidates.slice(3, 6), set3: candidates.slice(6, 9) },
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    const cards = page.getByTestId('analysis-set-card');
    await expect(cards).toHaveCount(3, { timeout: 15000 });
    const boxes = await cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));

    expect(Math.max(...boxes.map(({ y }) => y)) - Math.min(...boxes.map(({ y }) => y))).toBeLessThan(2);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].x).toBeLessThan(boxes[2].x);
  });

  test('score comparison: current roster score + per-option 评分, no 火力', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const team = heroesWithMeta.slice(0, 4);
    const candidates = heroesWithMeta.slice(4, 13);

    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      { set1: candidates.slice(0, 3), set2: candidates.slice(3, 6), set3: candidates.slice(6, 9) },
    );

    // The 当前阵容 heading keeps the roster score beside it before any AI request.
    const rosterScore = page.getByTestId('current-roster-score');
    await expect(rosterScore).toBeVisible({ timeout: 15000 });
    await expect(rosterScore).toHaveText(/评分 -?\d+\.\d/);

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();

    // Each option card shows a signed one-decimal 评分.
    for (const i of [0, 1, 2]) {
      const optionScore = page.getByTestId(`option-score-${i}`);
      await expect(optionScore).toBeVisible();
      await expect(optionScore).toHaveText(/评分：[+−]\d+\.\d/);
    }

    // Candidate rows stay visible without a misleading additive heading.
    await expect(page.getByText('单项加分:')).toHaveCount(0);

    // The standalone fire baseline panel and all fire bars are gone.
    await expect(page.getByTestId('fire-baseline-card')).toHaveCount(0);
    await expect(page.getByTestId('fire-bar-current')).toHaveCount(0);
    await expect(page.getByTestId('fire-bar-option-0')).toHaveCount(0);
    await expect(page.getByTestId('fire-bar-option-1')).toHaveCount(0);
    await expect(page.getByTestId('fire-bar-option-2')).toHaveCount(0);

    // No 火力 terminology anywhere, and removed blocks/wording are absent.
    await expect(page.getByText(/火力/)).toHaveCount(0);
    await expect(page.getByText('当前阵容火力')).toHaveCount(0);
    await expect(page.getByText('选择后火力')).toHaveCount(0);
    await expect(page.getByText('本轮增加')).toHaveCount(0);
    await expect(page.getByText('推荐理由:')).toHaveCount(0);
    await expect(page.getByText('可能减分项:')).toHaveCount(0);
    await expect(page.getByText(/项特征/)).toHaveCount(0);
  });

  test('hero round: candidate chips show hero ranking', async ({ page }) => {
    // 4 team heroes + 9 distinct candidate heroes (3 per option set), all with metadata.
    const team = heroesWithMeta.slice(0, 4);
    const candidates = heroesWithMeta.slice(4, 13);

    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      {
        set1: candidates.slice(0, 3),
        set2: candidates.slice(3, 6),
        set3: candidates.slice(6, 9),
      },
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    await expect(page.getByText('选项分析')).toBeVisible({ timeout: 15000 });

    // Every candidate hero renders its labeled chip in 选项分析 (labels render
    // nowhere else — see the scoping test below).
    for (const hero of candidates) {
      await expect(page.getByText(heroChipLabel(hero), { exact: true }).first()).toBeVisible();
    }
  });

  test('skill round: ranked candidate chips show skill ranking', async ({ page }) => {
    const team = heroesWithMeta.slice(0, 4);
    const candidates = rankedSkills.slice(0, 9);

    await seedGame(
      page,
      // Round 2 is a skill round (see gameLogic.getRoundType).
      makeGameState({ roundNumber: 2, heroes: team, skills: anySkills(8) }),
      {
        set1: candidates.slice(0, 3),
        set2: candidates.slice(3, 6),
        set3: candidates.slice(6, 9),
      },
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    await expect(page.getByText('选项分析')).toBeVisible({ timeout: 15000 });

    for (const skill of candidates) {
      await expect(page.getByText(skillChipLabel(skill), { exact: true }).first()).toBeVisible();
    }
  });

  test('labels stay scoped to 选项分析 — team chips remain bare names', async ({ page }) => {
    const team = heroesWithMeta.slice(0, 4);
    const candidates = heroesWithMeta.slice(4, 13);

    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      { set1: candidates.slice(0, 3), set2: candidates.slice(3, 6), set3: candidates.slice(6, 9) },
    );

    // The current-team area shows the team heroes; they must NOT carry the label.
    const teamHero = team[0];
    await expect(page.getByText(teamHero, { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(heroChipLabel(teamHero), { exact: true })).toHaveCount(0);
  });
});
