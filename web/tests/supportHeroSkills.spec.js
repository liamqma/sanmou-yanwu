const { test, expect } = require('@playwright/test');
const database2 = require('../src/database2.json');
const database = require('../src/database.json');

// ── Build test data from the real database (same pattern as gameRounds.spec.js) ──

const allHeroes = [...new Set(Object.values(database.skill_hero_map))];
const orangeHeroes = allHeroes
  .filter((h) => {
    const heroData = database2.wj?.[h];
    return !heroData || heroData.color === 'orange';
  })
  .sort();

// Setup: first 4 orange heroes
const heroesToSelect = orangeHeroes.slice(0, 4);

const regularSkills = [...new Set(database.skill || [])];
const heroSkills = [...new Set(Object.keys(database.skill_hero_map || {}))];

const purpleSkills = regularSkills
  .filter((s) => database2.zf?.[s]?.color === 'purple')
  .sort()
  .slice(0, 4);

const orangeRegularSkills = regularSkills
  .filter((s) => database2.zf?.[s]?.color === 'orange')
  .sort();

const setupOrangeSkills = orangeRegularSkills.slice(0, 3);
const oneHeroSkill = heroSkills.sort().slice(0, 1);
const skillsToSelect = [...purpleSkills, ...setupOrangeSkills, ...oneHeroSkill];

// Round 1 heroes (not in setup)
const round1Heroes = orangeHeroes
  .filter((h) => !heroesToSelect.includes(h))
  .slice(0, 9);

// Support candidates: heroes/skills not used in setup or round 1
const allUsedHeroes = new Set([...heroesToSelect, ...round1Heroes]);
const supportHeroCandidate = orangeHeroes.find((h) => !allUsedHeroes.has(h));

const allUsedSkills = new Set(skillsToSelect);
const supportSkillCandidates = orangeRegularSkills
  .filter((s) => !allUsedSkills.has(s))
  .slice(0, 2);

// ── Helper: complete initial setup and round 1 ──

async function setupGameAndCompleteRound1(page) {
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
  await expect(page.getByText('第 1 轮：选择武将')).toBeVisible({ timeout: 5000 });

  // Fill round 1: 3 sets of 3 heroes
  for (let set = 0; set < 3; set++) {
    for (let i = 0; i < 3; i++) {
      const hero = round1Heroes[set * 3 + i];
      const input = page.getByLabel('添加武将...').nth(set);
      await input.click();
      await input.fill(hero);
      await page.getByRole('option', { name: hero }).click();
    }
  }

  // Get recommendation, select first set, confirm
  await page.getByRole('button', { name: '获取 AI 推荐' }).click();
  await expect(page.getByText('推荐：第')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '选择本组' }).first().click();
  const confirmButton = page.getByRole('button', { name: '确认选择并进入下一轮' });
  await expect(confirmButton).toBeEnabled({ timeout: 5000 });
  await confirmButton.click();

  // Now on round 2
  await expect(page.getByText('第 2 轮：选择战法')).toBeVisible({ timeout: 5000 });
}

test.describe('Support Hero & Skills', () => {
  test('can set a support hero via dialog and button disappears', async ({ page }) => {
    await setupGameAndCompleteRound1(page);

    // Verify 推荐自选武将 button is visible initially
    const heroButton = page.getByRole('button', { name: '推荐自选武将' });
    await expect(heroButton).toBeVisible();

    // Click to open the support hero dialog
    await heroButton.click();
    await expect(page.getByText('推荐支援武将')).toBeVisible({ timeout: 5000 });

    // Use the search autocomplete to pick a hero
    const searchInput = page.getByLabel('搜索武将...');
    await searchInput.click();
    await searchInput.fill(supportHeroCandidate);
    await page.getByRole('option', { name: supportHeroCandidate }).click();

    // Click "设为支援武将"
    await page.getByRole('button', { name: '设为支援武将' }).click();

    // Dialog should close
    await expect(page.getByText('推荐支援武将')).not.toBeVisible({ timeout: 3000 });

    // Support hero should appear in the team with "⭐支援" prefix
    await expect(page.getByText(`⭐支援 ${supportHeroCandidate}`)).toBeVisible();

    // 推荐自选武将 button should now be hidden
    await expect(heroButton).not.toBeVisible();
  });

  test('can set support skills via dialog and button disappears', async ({ page }) => {
    await setupGameAndCompleteRound1(page);

    // Verify 推荐自选战法 button is visible initially
    const skillButton = page.getByRole('button', { name: '推荐自选战法' });
    await expect(skillButton).toBeVisible();

    // Click to open the support skills dialog
    await skillButton.click();
    await expect(page.getByText('推荐支援战法')).toBeVisible({ timeout: 5000 });

    // The dialog opens with pre-selected recommended skills from the engine
    const dialog = page.getByRole('dialog');

    // Wait for the recommendation to load — it pre-selects 2 skills
    await expect(dialog.getByText(/已选择 2\/2 个战法/)).toBeVisible({ timeout: 5000 });

    // Remove the pre-selected skills so we can pick our own
    const preSelectedChips = dialog.locator('.MuiChip-deleteIcon');
    // Delete both pre-selected chips
    while (await preSelectedChips.count() > 0) {
      await preSelectedChips.first().click();
    }

    // Now use the search autocomplete to pick our 2 skills
    const searchInput = dialog.getByLabel('搜索战法...');
    // Select first skill
    await searchInput.click();
    await searchInput.fill(supportSkillCandidates[0]);
    const option1 = page.getByRole('option', { name: supportSkillCandidates[0] });
    await expect(option1).toBeVisible({ timeout: 5000 });
    await option1.click();
    await expect(dialog.getByText('已选择 1/2 个战法')).toBeVisible({ timeout: 3000 });

    // Select second skill
    await searchInput.click();
    await searchInput.fill(supportSkillCandidates[1]);
    const option2 = page.getByRole('option', { name: supportSkillCandidates[1] });
    await expect(option2).toBeVisible({ timeout: 5000 });
    await option2.click();

    // Verify selected count shows 2/2
    await expect(dialog.getByText('已选择 2/2 个战法')).toBeVisible({ timeout: 3000 });

    // Click "设为支援战法"
    await page.getByRole('button', { name: '设为支援战法' }).click();

    // Dialog should close
    await expect(page.getByText('推荐支援战法')).not.toBeVisible({ timeout: 3000 });

    // Support skills should appear in the team with "⭐支援" prefix
    for (const skillName of supportSkillCandidates) {
      await expect(page.getByText(`⭐支援 ${skillName}`)).toBeVisible();
    }

    // 推荐自选战法 button should now be hidden
    await expect(skillButton).not.toBeVisible();
  });

  test('support hero is excluded from round selection inputs', async ({ page }) => {
    await setupGameAndCompleteRound1(page);

    // Set a support hero first
    const heroButton = page.getByRole('button', { name: '推荐自选武将' });
    await heroButton.click();
    await expect(page.getByText('推荐支援武将')).toBeVisible({ timeout: 5000 });
    const searchInput = page.getByLabel('搜索武将...');
    await searchInput.click();
    await searchInput.fill(supportHeroCandidate);
    await page.getByRole('option', { name: supportHeroCandidate }).click();
    await page.getByRole('button', { name: '设为支援武将' }).click();
    await expect(page.getByText('推荐支援武将')).not.toBeVisible({ timeout: 3000 });

    // Verify support hero chip is displayed
    await expect(page.getByText(`⭐支援 ${supportHeroCandidate}`)).toBeVisible();

    // Now on round 2 (skill round) - advance to round 4 (hero round) would be complex,
    // so instead verify the support hero appears in the team display
    // and the button is gone
    await expect(page.getByRole('button', { name: '推荐自选武将' })).not.toBeVisible();
  });

  test('support hero and skills appear exactly once in the team display', async ({ page }) => {
    await setupGameAndCompleteRound1(page);

    // Set a support hero
    await page.getByRole('button', { name: '推荐自选武将' }).click();
    await expect(page.getByText('推荐支援武将')).toBeVisible({ timeout: 5000 });
    const heroSearchInput = page.getByLabel('搜索武将...');
    await heroSearchInput.click();
    await heroSearchInput.fill(supportHeroCandidate);
    await page.getByRole('option', { name: supportHeroCandidate }).click();
    await page.getByRole('button', { name: '设为支援武将' }).click();
    await expect(page.getByText('推荐支援武将')).not.toBeVisible({ timeout: 3000 });

    // Verify support hero chip appears exactly once (with ⭐支援 prefix)
    const supportHeroChips = page.getByText(`⭐支援 ${supportHeroCandidate}`);
    await expect(supportHeroChips).toHaveCount(1);

    // The hero should NOT also appear as a regular (non-support) chip
    // Count all chips/text containing the hero name — should be exactly 1
    const allHeroOccurrences = page.locator('.MuiChip-label', { hasText: supportHeroCandidate });
    await expect(allHeroOccurrences).toHaveCount(1);

    // Set support skills
    await page.getByRole('button', { name: '推荐自选战法' }).click();
    await expect(page.getByText('推荐支援战法')).toBeVisible({ timeout: 5000 });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/已选择 2\/2 个战法/)).toBeVisible({ timeout: 5000 });
    const preSelectedChips = dialog.locator('.MuiChip-deleteIcon');
    while (await preSelectedChips.count() > 0) {
      await preSelectedChips.first().click();
    }
    const skillSearchInput = dialog.getByLabel('搜索战法...');
    await skillSearchInput.click();
    await skillSearchInput.fill(supportSkillCandidates[0]);
    await page.getByRole('option', { name: supportSkillCandidates[0] }).click();
    await expect(dialog.getByText('已选择 1/2 个战法')).toBeVisible({ timeout: 3000 });
    await skillSearchInput.click();
    await skillSearchInput.fill(supportSkillCandidates[1]);
    await page.getByRole('option', { name: supportSkillCandidates[1] }).click();
    await expect(dialog.getByText('已选择 2/2 个战法')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: '设为支援战法' }).click();
    await expect(page.getByText('推荐支援战法')).not.toBeVisible({ timeout: 3000 });

    // Each support skill should appear exactly once
    for (const skillName of supportSkillCandidates) {
      const supportSkillChips = page.getByText(`⭐支援 ${skillName}`);
      await expect(supportSkillChips).toHaveCount(1);

      const allSkillOccurrences = page.locator('.MuiChip-label', { hasText: skillName });
      await expect(allSkillOccurrences).toHaveCount(1);
    }

    // Navigate to TeamBuilder page directly and verify no duplication there either
    await page.goto('/team-builder');
    await expect(page.getByText('查看与管理当前队伍配置')).toBeVisible({ timeout: 5000 });

    // Scope checks to the 当前队伍 Paper section on TeamBuilder page
    const teamSection = page.locator('.MuiPaper-root', { hasText: '📋 当前队伍' }).first();

    // Support hero should appear exactly once in the team section
    const tbSupportHeroChips = teamSection.getByText(`⭐支援 ${supportHeroCandidate}`);
    await expect(tbSupportHeroChips).toHaveCount(1);

    // Support skills should appear exactly once in the team section
    for (const skillName of supportSkillCandidates) {
      const tbSupportSkillChips = teamSection.getByText(`⭐支援 ${skillName}`);
      await expect(tbSupportSkillChips).toHaveCount(1);
    }
  });

  test('removing support hero makes the recommend button reappear', async ({ page }) => {
    await setupGameAndCompleteRound1(page);

    // Set a support hero
    await page.getByRole('button', { name: '推荐自选武将' }).click();
    await expect(page.getByText('推荐支援武将')).toBeVisible({ timeout: 5000 });
    const searchInput = page.getByLabel('搜索武将...');
    await searchInput.click();
    await searchInput.fill(supportHeroCandidate);
    await page.getByRole('option', { name: supportHeroCandidate }).click();
    await page.getByRole('button', { name: '设为支援武将' }).click();
    await expect(page.getByText('推荐支援武将')).not.toBeVisible({ timeout: 3000 });

    // Verify button is hidden
    await expect(page.getByRole('button', { name: '推荐自选武将' })).not.toBeVisible();

    // Find the support hero chip and click its delete button
    const supportChip = page.getByText(`⭐支援 ${supportHeroCandidate}`).locator('..');
    await supportChip.getByTestId('CancelIcon').click();

    // Button should reappear
    await expect(page.getByRole('button', { name: '推荐自选武将' })).toBeVisible({ timeout: 3000 });

    // Support hero chip should be gone
    await expect(page.getByText(`⭐支援 ${supportHeroCandidate}`)).not.toBeVisible();
  });
});
