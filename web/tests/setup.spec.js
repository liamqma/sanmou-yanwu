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

test.describe('Initial Setup - select 4 orange 初始武将', () => {
  test('users can select 4 orange heroes during initial setup', async ({ page }) => {
    // 1. Navigate and wait for the setup form to load
    await page.goto('/');
    await expect(page.getByText('初始武将')).toBeVisible({ timeout: 30000 });

    // Verify we start at 0/4
    await expect(page.getByText('初始武将 (0/4)')).toBeVisible();

    // 2. Select 4 orange heroes one by one
    for (let i = 0; i < heroesToSelect.length; i++) {
      const heroName = heroesToSelect[i];

      // Type the hero name into the autocomplete input
      const heroInput = page.getByLabel('输入武将名或拼音...');
      await heroInput.click();
      await heroInput.fill(heroName);

      // Wait for the dropdown option to appear, then click it
      const option = page.getByRole('option', { name: heroName });
      await expect(option).toBeVisible({ timeout: 5000 });
      await option.click();

      // Verify the count increments
      await expect(
        page.getByText(`初始武将 (${i + 1}/4)`)
      ).toBeVisible();
    }

    // 3. Assert all 4 heroes are displayed as chips
    for (const heroName of heroesToSelect) {
      await expect(page.getByText(heroName).first()).toBeVisible();
    }

    // 4. Assert the autocomplete input is disabled after 4 selections
    const heroInput = page.getByLabel('输入武将名或拼音...');
    await expect(heroInput).toBeDisabled();

    // 5. Confirm each selected hero is orange in database2.json
    for (const heroName of heroesToSelect) {
      const heroData = database2.wj?.[heroName];
      // Hero must either be explicitly orange, or not in database2 (allowed by app logic)
      expect(
        !heroData || heroData.color === 'orange',
        `Expected ${heroName} to be orange, got ${heroData?.color}`
      ).toBe(true);
    }
  });
});
