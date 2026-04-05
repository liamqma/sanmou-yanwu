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

// Pick 4 orange heroes for initial setup
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

// Pick a purple skill and an orange skill for the round test
const aPurpleSkill = regularSkills
  .filter((s) => database2.zf?.[s]?.color === 'purple')
  .sort()[0];
const anOrangeSkill = regularSkills
  .filter(
    (s) =>
      database2.zf?.[s]?.color === 'orange' &&
      !orangeRegularSkills.includes(s) // not already used in setup
  )
  .sort()[0];

// Additional heroes for round 1 (not used in setup)
const round1Heroes = orangeHeroes.filter((h) => !heroesToSelect.includes(h)).slice(0, 9);

test.describe('Game Rounds - Skill Selection', () => {
  test('during skill rounds, only orange skills are available (not purple)', async ({
    page,
  }) => {
    // ── Reset any saved progress and complete initial setup ──
    // Clear cookies/storage to avoid restoring previous game state
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page.getByText('初始武将')).toBeVisible({ timeout: 30000 });

    // Select 4 heroes
    for (const heroName of heroesToSelect) {
      const heroInput = page.getByLabel('输入武将名或拼音...');
      await heroInput.click();
      await heroInput.fill(heroName);
      await page.getByRole('option', { name: heroName }).click();
    }

    // Select 8 skills
    for (const skillName of skillsToSelect) {
      const skillInput = page.getByLabel('输入战法名或拼音...');
      await skillInput.click();
      await skillInput.fill(skillName);
      await page.getByRole('option', { name: skillName }).click();
    }

    // Start the game
    await page.getByRole('button', { name: '开始对局' }).click();

    // ── Round 1 (hero round) - fill 3 sets of 3 heroes each ──
    await expect(page.getByText('第 1 轮：选择武将')).toBeVisible({ timeout: 5000 });

    for (let set = 0; set < 3; set++) {
      for (let i = 0; i < 3; i++) {
        const hero = round1Heroes[set * 3 + i];
        // After each selection, the filled input disappears, so always target the set's input
        const input = page.getByLabel('添加武将...').nth(set);
        await input.click();
        await input.fill(hero);
        await page.getByRole('option', { name: hero }).click();
      }
    }

    // Get recommendation, select the recommended set, and confirm round 1
    await page.getByRole('button', { name: '获取 AI 推荐' }).click();
    // Wait for recommendation to appear, then select the first set
    await expect(page.getByText('推荐：第')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '选择本组' }).first().click();
    const confirmButton = page.getByRole('button', { name: '确认选择并进入下一轮' });
    await expect(confirmButton).toBeEnabled({ timeout: 5000 });
    await confirmButton.click();

    // ── Round 2 (skill round) - verify only orange skills appear ──
    await expect(page.getByText('第 2 轮：选择战法')).toBeVisible({ timeout: 5000 });

    // Type a purple skill name - should show no options
    const skillInput = page.getByLabel('添加战法...').first();
    await skillInput.click();
    await skillInput.fill(aPurpleSkill);
    await expect(page.getByText('No matches found')).toBeVisible({ timeout: 3000 });

    // Clear and type an orange skill name - should show the option
    await skillInput.fill('');
    await skillInput.fill(anOrangeSkill);
    const orangeOption = page.getByRole('option', { name: anOrangeSkill });
    await expect(orangeOption).toBeVisible({ timeout: 5000 });
  });
});
