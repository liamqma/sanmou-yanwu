const { test, expect } = require('@playwright/test');
const {
  seedGame, makeGameState,
  heroesWithMeta, skillsWithTier,
  heroChipLabel, skillChipLabel, anySkills,
} = require('./helpers');

// Acceptance tests for the labels added to 选项分析 (option analysis):
//   - hero rounds: each candidate hero chip shows `名 · 定位#排名` (label#rank)
//   - skill rounds: each candidate skill chip shows `名 · 战法等级` (tier)
// See web/src/components/game/AnalysisGrid.js (itemChipLabel).
//
// Labels must appear ONLY inside 选项分析 — the rest of the app (team chips,
// autocomplete, setup form) was intentionally left showing bare names.

test.describe('选项分析 — hero & skill labels', () => {
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

  test('fire comparison: current baseline + three projected bars, plain copy', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const team = heroesWithMeta.slice(0, 4);
    const candidates = heroesWithMeta.slice(4, 13);

    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      { set1: candidates.slice(0, 3), set2: candidates.slice(3, 6), set3: candidates.slice(6, 9) },
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();

    // Current-pool baseline fire bar (full-width, above the cards).
    await expect(page.getByTestId('fire-baseline-card')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('fire-bar-current')).toBeVisible();
    await expect(page.getByText('当前阵容火力')).toBeVisible();

    // Three projected fire bars, one per option.
    await expect(page.getByTestId('fire-bar-option-0')).toBeVisible();
    await expect(page.getByTestId('fire-bar-option-1')).toBeVisible();
    await expect(page.getByTestId('fire-bar-option-2')).toBeVisible();

    // Visible projected/gain copy and plain helper text.
    await expect(page.getByText('选择后火力').first()).toBeVisible();
    await expect(page.getByText('本轮增加').first()).toBeVisible();
    await expect(
      page.getByText('火力分只用于比较当前阵容和本轮三个选项，越高越好。'),
    ).toBeVisible();

    // New plain headings replace the old technical labels.
    await expect(page.getByText('单项加分:').first()).toBeVisible();
    await expect(page.getByText('推荐理由:').first()).toBeVisible();
    await expect(page.getByText('主要加分项:').first()).toBeVisible();

    // Old confusing/technical wording is gone.
    await expect(page.getByText(/项特征/)).toHaveCount(0);
    await expect(page.getByText('关键协同:')).toHaveCount(0);
    await expect(page.getByText('潜在取舍:')).toHaveCount(0);
    await expect(page.getByText('武将评分:')).toHaveCount(0);
    await expect(page.getByText('战法评分:')).toHaveCount(0);
    await expect(
      page.getByText('分数为相对当前阵容的强度提升，非对特定对手的胜率。'),
    ).toHaveCount(0);
    await expect(page.getByText(/相对阵容强度提升/)).toHaveCount(0);
  });

  test('hero round: candidate chips under 单项加分 show 定位#排名', async ({ page }) => {
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

  test('skill round: candidate chips under 单项加分 show 战法等级 (tier)', async ({ page }) => {
    const team = heroesWithMeta.slice(0, 4);
    const candidates = skillsWithTier.slice(0, 9);

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
