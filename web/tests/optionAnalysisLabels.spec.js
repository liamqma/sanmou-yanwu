const { test, expect } = require('@playwright/test');
const {
  seedGame, makeGameState,
  heroesWithMeta, heroChipLabel, rankedSkills, skillChipLabel, anySkills,
} = require('./helpers');

// 选项分析 (option analysis): the lineup model's verdict per offered set, and
// the `名 · 档位` labels on candidate chips. Labels appear only inside 选项分析;
// team chips, autocomplete and the setup form show bare names.

test.describe('选项分析', () => {
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

  test('each option shows its gap to the best set and the lineup it leads to', async ({ page }) => {
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
    await expect(page.getByTestId('option-score-0')).toBeVisible({ timeout: 60000 });

    // Exactly one set is recommended, and it is a best one.
    const recommended = page.locator('[data-testid="analysis-set-card"][data-ai-recommended="true"]');
    await expect(recommended).toHaveCount(1);
    await expect(recommended.locator('[data-testid^="option-score-"]')).toHaveText('最优');
    for (const i of [0, 1, 2]) {
      await expect(page.getByTestId(`option-score-${i}`)).toHaveText(/^(最优|比最优低\d+\.\d)$/);
      await expect(page.getByTestId(`option-strengths-${i}`)).toHaveText(
        /^选后三队胜率 (\d+%|—) \/ (\d+%|—) \/ (\d+%|—)$/
      );
      // The lineup after the pick fields the offered heroes, in bold.
      const lineup = cards.nth(i).getByTestId('option-lineup');
      await expect(lineup).toContainText('队伍一');
      const offered = candidates.slice(3 * i, 3 * i + 3);
      const bold = await lineup.locator('strong').allTextContents();
      expect(bold.length).toBeGreaterThan(0);
      expect(bold.every((name) => offered.includes(name))).toBe(true);
    }

    // What the old model showed is gone.
    await expect(page.getByTestId('current-roster-score')).toHaveCount(0);
    await expect(page.getByText(/单项|玩家选择概率/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '复制 AI 分析提示词' })).toHaveCount(0);
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
    await expect(
      page.getByRole('img', { name: `${teamHero}武将卡面`, exact: true }).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(heroChipLabel(teamHero), { exact: true })).toHaveCount(0);
  });
});
