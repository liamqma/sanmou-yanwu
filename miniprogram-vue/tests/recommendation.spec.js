const { test, expect } = require('playwright/test');

test.describe('Recommendation Flow', () => {
  test('should get recommendation after filling 3 sets', async ({ page }) => {
    test.setTimeout(120000);
    page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Helper to select items and close picker
    async function pickItems(label, count) {
      await page.locator('.picker-trigger').filter({ hasText: label }).click({ force: true });
      await page.waitForTimeout(1000);
      
      // With v-if, only one popup's DOM exists at a time
      for (let i = 0; i < count; i++) {
        await page.locator('.popup-item:not(.item-selected):not(.item-disabled)').first().click({ force: true });
        await page.waitForTimeout(400);
      }
      
      // Close the popup
      await page.waitForTimeout(300);
      await page.locator('.popup-confirm').click({ force: true });
      await page.waitForTimeout(1500);
    }

    // Select 4 heroes, then 8 skills
    await pickItems('初始武将', 4);
    await pickItems('初始战法', 8);

    // Start game
    await page.waitForTimeout(500);
    await page.locator('uni-button').filter({ hasText: '开始对局' }).click({ force: true });
    await page.waitForTimeout(2000);

    // Verify round 1 UI
    await expect(page.locator('text=第 1 轮')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=第 1 组')).toBeVisible();

    // Fill 3 sets of 3 heroes each
    for (let setIdx = 0; setIdx < 3; setIdx++) {
      await pickItems(`第 ${setIdx + 1} 组`, 3);
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
