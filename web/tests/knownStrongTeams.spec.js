const { test, expect } = require('@playwright/test');
const { database, seedGame, makeGameState, heroesWithMeta, anySkills } = require('./helpers');

// Acceptance tests for the 已知强力阵容 panel (web/src/components/game/KnownStrongTeams.js):
//   - renders above the "AI 推荐" panel during hero rounds
//   - surfaces known strong comps that overlap the current team
//   - rows are sorted by tier, strongest first
//   - hidden entirely on skill rounds

const TIER_ORDER = { OP: 0, T0: 1, 'T1+': 2, T1: 3, T2: 4, T3: 5, T4: 6 };

// A known comp to anchor on: put all three of its heroes on the team so it is
// guaranteed to appear (selectedCount === 3).
const anchorComp = database.team[0];
const extraHero = heroesWithMeta.find((h) => !anchorComp.heroes.includes(h));
const team = [...anchorComp.heroes, extraHero];
const candidates = heroesWithMeta.filter((h) => !team.includes(h)).slice(0, 9);
const heroInputs = {
  set1: candidates.slice(0, 3),
  set2: candidates.slice(3, 6),
  set3: candidates.slice(6, 9),
};

test.describe('已知强力阵容 panel', () => {
  test('hero round: shows the anchor comp, above the AI 推荐 panel', async ({ page }) => {
    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      heroInputs,
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();

    const panelHeading = page.getByRole('heading', { name: '已知强力阵容' });
    await expect(panelHeading).toBeVisible({ timeout: 15000 });

    const panel = page.locator('.MuiPaper-root', { hasText: '已知强力阵容' }).first();
    // The anchor comp's tier and all three heroes are present.
    await expect(panel.getByText(anchorComp.tier, { exact: true }).first()).toBeVisible();
    for (const hero of anchorComp.heroes) {
      await expect(panel.getByText(hero, { exact: true }).first()).toBeVisible();
    }

    // The panel sits above the AI 推荐 recommendation panel.
    const panelBox = await panelHeading.boundingBox();
    const recBox = await page.getByRole('heading', { name: 'AI 推荐' }).boundingBox();
    expect(panelBox.y).toBeLessThan(recBox.y);
  });

  test('hero round: rows are sorted by tier, strongest first', async ({ page }) => {
    await seedGame(
      page,
      makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
      heroInputs,
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    await expect(page.getByRole('heading', { name: '已知强力阵容' })).toBeVisible({ timeout: 15000 });

    const panel = page.locator('.MuiPaper-root', { hasText: '已知强力阵容' }).first();
    const tierTexts = await panel.locator('tbody tr td:first-child').allInnerTexts();
    expect(tierTexts.length).toBeGreaterThan(1);

    const ranks = tierTexts.map((t) => TIER_ORDER[t.trim()] ?? Number.MAX_SAFE_INTEGER);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test('skill round: panel is hidden', async ({ page }) => {
    await seedGame(
      page,
      // Round 2 is a skill round — the panel is hero-only.
      makeGameState({ roundNumber: 2, heroes: team, skills: anySkills(8) }),
      { set1: anySkills(3), set2: anySkills(8).slice(3, 6), set3: anySkills(8).slice(5, 8) },
    );

    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    // Recommendation rendered (skill round), but no 已知强力阵容 panel.
    await expect(page.getByText('选项分析')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: '已知强力阵容' })).toHaveCount(0);
  });
});
