const { test, expect } = require('playwright/test');

test.describe('Recommendation Flow', () => {
  test('should get recommendation after filling 3 sets', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Select 4 heroes
    await page.locator('text=初始武将').click({ force: true });
    await page.waitForTimeout(1000);
    for (let i = 0; i < 4; i++) {
      await page.locator('.wd-checkbox:visible').nth(i).click({ force: true });
      await page.waitForTimeout(200);
    }
    await page.locator('.wd-action-sheet .wd-button:visible').click({ force: true });
    await page.waitForTimeout(1500);

    // Select 8 skills
    await page.locator('text=初始战法').click({ force: true });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 8; i++) {
      await page.locator('.wd-checkbox:visible').nth(i).click({ force: true });
      await page.waitForTimeout(200);
    }
    await page.locator('.wd-action-sheet .wd-button:visible').click({ force: true });
    await page.waitForTimeout(1000);

    // Start game
    await page.locator('uni-button').filter({ hasText: '开始对局' }).click({ force: true });
    await page.waitForTimeout(1000);

    // Verify round 1 UI
    await expect(page.locator('text=第 1 轮')).toBeVisible();
    await expect(page.locator('text=第 1 组')).toBeVisible();

    // Fill 3 sets of 3 heroes each (use different heroes for each set)
    for (let setIdx = 0; setIdx < 3; setIdx++) {
      const setLabel = `第 ${setIdx + 1} 组`;
      await page.locator('.wd-cell').filter({ hasText: setLabel }).click({ force: true });
      await page.waitForTimeout(1000);

      // Select 3 heroes starting from different offsets
      for (let i = 0; i < 3; i++) {
        await page.locator('.wd-checkbox:visible').nth(setIdx * 3 + i).click({ force: true });
        await page.waitForTimeout(200);
      }
      await page.locator('.wd-action-sheet .wd-button:visible').click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Click recommend
    await page.locator('uni-button').filter({ hasText: '获取推荐' }).click({ force: true });
    await page.waitForTimeout(5000);

    // Should show recommendation result (trophy icon + "推荐" text)
    const pageText = await page.textContent('body');
    expect(pageText).toContain('推荐');

    // Should NOT show error
    expect(pageText).not.toContain('获取推荐失败');

    // Should show "选第" buttons
    const selectButtons = page.locator('uni-button').filter({ hasText: /选第.*组/ });
    await expect(selectButtons.first()).toBeVisible();

    await page.screenshot({ path: 'test-results/recommendation-result.png', fullPage: true });
  });
});
