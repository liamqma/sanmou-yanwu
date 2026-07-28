const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');

// Merged database (see web/scripts/merge_database.js) schema:
//   - heroes: orange heroes only (no `color` field on entries). Each hero has
//     a `skill` field naming its signature (hero-exclusive) skill.
//   - skills: { color, desc, shadow? }. Hero-skill draft rules apply to both
//     heroes[*].skill signatures and skills explicitly marked `shadow`.
const orangeHeroes = Object.keys(database.heroes || {}).sort();

// Pick 4 orange heroes for the test
const heroesToSelect = orangeHeroes.slice(0, 4);

// Build skill lists from the real database
const HERO_SKILL_SET = new Set(
  [
    ...Object.values(database.heroes || {}).map(h => h.skill).filter(Boolean),
    ...Object.entries(database.skills || {})
      .filter(([, skill]) => skill.shadow === true)
      .map(([name]) => name),
  ]
);
const allSkillNames = Object.keys(database.skills || {});
const regularSkills = allSkillNames.filter(n => !HERO_SKILL_SET.has(n));
const heroSkills   = allSkillNames.filter(n => HERO_SKILL_SET.has(n)).sort();

// 4 purple regular skills
const purpleSkills = regularSkills
  .filter((s) => database.skills[s]?.color === 'purple')
  .sort()
  .slice(0, 4);

// 3 orange regular skills + 1 orange signature skill.
const orangeRegularSkills = regularSkills
  .filter((s) => database.skills[s]?.color === 'orange')
  .sort()
  .slice(0, 3);
const oneHeroSkill = heroSkills
  .filter((s) => database.skills[s]?.color === 'orange')
  .slice(0, 1);

const skillsToSelect = [...purpleSkills, ...orangeRegularSkills, ...oneHeroSkill];

test.describe('Initial Setup', () => {
  test('users can select 4 heroes and 8 skills, then enter the first round', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Navigate and wait for the setup form to load
    await page.goto('/');
    await expect(page.getByText('初始武将')).toBeVisible({ timeout: 30000 });

    // Verify we start at 0/4 heroes and 0/8 skills
    await expect(page.getByText('初始武将 (0/4)')).toBeVisible();
    await expect(page.getByText('初始战法 (0/8)')).toBeVisible();
    await expect(
      page.getByText('未选择任何内容', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('输入初始 4 个武将和 8 个战法以开始对局。', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText('4个橙色战法和4个紫色战法', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('请选择恰好 4 个武将和 8 个战法以开始', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText('录入当前阵容', { exact: true }),
    ).toHaveCount(0);

    // Start button should be disabled
    const startButton = page.getByRole('button', { name: '开始对局' });
    await expect(startButton).toBeDisabled();

    // ── Select 4 orange heroes ──
    for (let i = 0; i < heroesToSelect.length; i++) {
      const heroName = heroesToSelect[i];

      const heroInput = page.getByLabel('输入武将名或拼音...');
      await heroInput.click();
      await heroInput.fill(heroName);

      const option = page.getByRole('option', { name: heroName });
      await expect(option).toBeVisible({ timeout: 5000 });
      await option.click();

      await expect(page.getByText(`初始武将 (${i + 1}/4)`)).toBeVisible();
    }

    // Assert all 4 heroes are displayed as chips
    for (const heroName of heroesToSelect) {
      await expect(page.getByText(heroName).first()).toBeVisible();
    }

    // Hero input is disabled after 4 selections
    await expect(page.getByLabel('输入武将名或拼音...')).toBeDisabled();

    // Confirm each selected hero is in the merged DB (which is orange-only).
    for (const heroName of heroesToSelect) {
      expect(
        !!database.heroes?.[heroName],
        `Expected ${heroName} to be present in merged (orange-only) hero list`
      ).toBe(true);
    }

    // ── Select 8 skills: 4 purple + 3 orange regular + 1 orange signature ──
    for (let i = 0; i < skillsToSelect.length; i++) {
      const skillName = skillsToSelect[i];

      const skillInput = page.getByLabel('输入战法名或拼音...');
      await skillInput.click();
      await skillInput.fill(skillName);

      const option = page.getByRole('option', { name: skillName });
      await expect(option).toBeVisible({ timeout: 5000 });
      await option.click();

      await expect(page.getByText(`初始战法 (${i + 1}/8)`)).toBeVisible();
    }

    // Assert all 8 skills are displayed as chips
    for (const skillName of skillsToSelect) {
      await expect(page.getByText(skillName).first()).toBeVisible();
    }

    // Skill input is disabled after 8 selections
    await expect(page.getByLabel('输入战法名或拼音...')).toBeDisabled();

    // Verify skill colors: 4 purple + 4 orange (3 regular + 1 hero)
    const selectedPurple = skillsToSelect.filter(
      (s) => database.skills?.[s]?.color === 'purple' && !HERO_SKILL_SET.has(s)
    );
    const selectedOrangeRegular = skillsToSelect.filter(
      (s) => database.skills?.[s]?.color === 'orange' && !HERO_SKILL_SET.has(s)
    );
    const selectedHeroSkills = skillsToSelect.filter((s) =>
      heroSkills.includes(s)
    );

    expect(selectedPurple).toHaveLength(4);
    expect(selectedOrangeRegular.length + selectedHeroSkills.length).toBe(4);
    expect(selectedHeroSkills.length).toBeLessThanOrEqual(1);

    // Start button should now be enabled with 4 heroes + 8 skills
    await expect(startButton).toBeEnabled();

    // Starting the game restores the full game navigation.
    await startButton.click();
    const roundHeading = page.getByRole('heading', {
      level: 1,
      name: '第 1 轮：选择武将',
    });
    await expect(roundHeading).toHaveCount(1);
    const navigation = page.getByRole('navigation', { name: '主要导航' });
    await expect(navigation).toBeVisible();
    await expect(
      navigation.getByRole('link', { name: '对局推荐' }),
    ).toBeVisible();
    await expect(
      navigation.getByRole('button', { name: '重置' }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: '初始设置导航' }),
    ).toHaveCount(0);
  });
});
