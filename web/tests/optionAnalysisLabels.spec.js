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
  test('hero round: candidate chips under 武将评分 show 定位#排名', async ({ page }) => {
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

  test('skill round: candidate chips under 战法评分 show 战法等级 (tier)', async ({ page }) => {
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
