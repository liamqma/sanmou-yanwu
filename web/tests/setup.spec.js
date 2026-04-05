const { test, expect } = require('@playwright/test');
const database2 = require('../src/database2.json');
const database = require('../src/database.json');

// Get orange heroes from the real database (same logic as api.getDatabaseItems)
const allHeroes = [...new Set(Object.values(database.skill_hero_map))];
const orangeHeroes = allHeroes.filter((h) => {
  const heroData = database2.wj?.[h];
  return !heroData || heroData.color === 'orange';
});
orangeHeroes.sort();

// Pick 4 orange heroes for the test
const heroesToSelect = orangeHeroes.slice(0, 4);

// Build skill lists from the real database
const regularSkills = [...new Set(database.skill || [])];
const heroSkills = [...new Set(Object.keys(database.skill_hero_map || {}))];

// 4 purple regular skills
const purpleSkills = regularSkills
  .filter((s) => database2.zf?.[s]?.color === 'purple')
  .sort()
  .slice(0, 4);

// 3 orange regular skills + 1 hero skill (hero skills are orange by nature)
const orangeRegularSkills = regularSkills
  .filter((s) => database2.zf?.[s]?.color === 'orange')
  .sort()
  .slice(0, 3);
const oneHeroSkill = heroSkills.sort().slice(0, 1);

const skillsToSelect = [...purpleSkills, ...orangeRegularSkills, ...oneHeroSkill];

test.describe('Initial Setup', () => {
  test('users can select 4 orange heroes and 8 skills (4 purple + 4 orange, one possibly a hero skill)', async ({
    page,
  }) => {
    // 1. Navigate and wait for the setup form to load
    await page.goto('/');
    await expect(page.getByText('初始武将')).toBeVisible({ timeout: 30000 });

    // Verify we start at 0/4 heroes and 0/8 skills
    await expect(page.getByText('初始武将 (0/4)')).toBeVisible();
    await expect(page.getByText('初始战法 (0/8)')).toBeVisible();

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

    // Confirm each selected hero is orange
    for (const heroName of heroesToSelect) {
      const heroData = database2.wj?.[heroName];
      expect(
        !heroData || heroData.color === 'orange',
        `Expected ${heroName} to be orange, got ${heroData?.color}`
      ).toBe(true);
    }

    // ── Select 8 skills: 4 purple + 3 orange regular + 1 hero skill ──
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
      (s) => database2.zf?.[s]?.color === 'purple'
    );
    const selectedOrangeRegular = skillsToSelect.filter(
      (s) => database2.zf?.[s]?.color === 'orange'
    );
    const selectedHeroSkills = skillsToSelect.filter((s) =>
      heroSkills.includes(s)
    );

    expect(selectedPurple).toHaveLength(4);
    expect(selectedOrangeRegular.length + selectedHeroSkills.length).toBe(4);
    expect(selectedHeroSkills.length).toBeLessThanOrEqual(1);

    // Start button should now be enabled with 4 heroes + 8 skills
    await expect(startButton).toBeEnabled();
  });
});
