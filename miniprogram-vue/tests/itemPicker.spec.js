const { test, expect } = require('playwright/test');

// uni-input renders a wrapper element; the actual native input is inside it.
const SEARCH_INPUT = '.search-input .uni-input-input';

test.describe('ItemPicker - selection keeps popup open', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
  });

  test('hero picker stays open after selecting an item', async ({ page }) => {
    // Open the hero picker
    await page.locator('.picker-trigger').filter({ hasText: '初始武将' }).click({ force: true });
    await page.waitForTimeout(500);

    // Popup should be visible
    await expect(page.locator('.picker-popup')).toBeVisible();

    // Click the first available item
    await page.locator('.popup-item:not(.item-selected):not(.item-disabled)').first().click({ force: true });
    await page.waitForTimeout(400);

    // Popup should still be visible after selection (not closed)
    await expect(page.locator('.picker-popup')).toBeVisible({ timeout: 2000 });
  });

  test('hero picker clears search text after selecting an item', async ({ page }) => {
    // Open the hero picker
    await page.locator('.picker-trigger').filter({ hasText: '初始武将' }).click({ force: true });
    await page.waitForTimeout(500);

    // Type something in the search box (target the native input inside uni-input)
    await page.locator(SEARCH_INPUT).fill('曹');
    await page.waitForTimeout(300);

    // Verify search text is present
    await expect(page.locator(SEARCH_INPUT)).toHaveValue('曹');

    // Click the first available (filtered) item
    await page.locator('.popup-item:not(.item-selected):not(.item-disabled)').first().click({ force: true });
    await page.waitForTimeout(400);

    // Search text should be cleared after selection
    await expect(page.locator(SEARCH_INPUT)).toHaveValue('');
  });

  test('hero picker search input stays focused after selecting an item', async ({ page }) => {
    // Open the hero picker
    await page.locator('.picker-trigger').filter({ hasText: '初始武将' }).click({ force: true });
    await page.waitForTimeout(500);

    // Type a search term
    await page.locator(SEARCH_INPUT).fill('关');
    await page.waitForTimeout(300);

    // Select first result
    await page.locator('.popup-item:not(.item-selected):not(.item-disabled)').first().click({ force: true });
    await page.waitForTimeout(400);

    // Popup still visible
    await expect(page.locator('.picker-popup')).toBeVisible();

    // Search input should be cleared and ready for next search
    await expect(page.locator(SEARCH_INPUT)).toHaveValue('');

    // Should be able to type again immediately (input is focused/active)
    await page.locator(SEARCH_INPUT).fill('张');
    await page.waitForTimeout(300);
    await expect(page.locator(SEARCH_INPUT)).toHaveValue('张');

    // The filtered list should update based on new search
    const filteredCount = await page.locator('.popup-item:not(.item-disabled)').count();
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('hero picker closes only when max selection is reached', async ({ page }) => {
    // Open the hero picker (max is 4 heroes)
    await page.locator('.picker-trigger').filter({ hasText: '初始武将' }).click({ force: true });
    await page.waitForTimeout(500);

    // Select 3 heroes (below max of 4) - popup should stay open each time
    for (let i = 0; i < 3; i++) {
      await page.locator('.popup-item:not(.item-selected):not(.item-disabled)').first().click({ force: true });
      await page.waitForTimeout(400);
      // Popup must remain open after each selection below the max
      await expect(page.locator('.picker-popup')).toBeVisible({ timeout: 2000 });
    }

    // After 3 selections, count text should show 3 selected
    await expect(page.locator('.count-text')).toContainText('已选 3');

    // Close manually
    await page.locator('.popup-confirm').click({ force: true });
    await page.waitForTimeout(300);

    // Now the popup should be gone
    await expect(page.locator('.picker-popup')).not.toBeVisible();
  });

  test('search input is auto-focused after selection — can type without clicking input', async ({ page }) => {
    // Open the hero picker
    await page.locator('.picker-trigger').filter({ hasText: '初始武将' }).click({ force: true });
    await page.waitForTimeout(500);

    // Select the first item (no search, just click)
    await page.locator('.popup-item:not(.item-selected):not(.item-disabled)').first().click({ force: true });

    // Wait for the nextTick re-focus to complete
    await page.waitForTimeout(400);

    // Now type WITHOUT clicking the input — if it's truly focused, the text appears
    await page.keyboard.type('关');
    await page.waitForTimeout(200);

    // The search input should contain the typed text, proving it was focused
    await expect(page.locator(SEARCH_INPUT)).toHaveValue('关');

    // The filtered list should have updated
    const filteredCount = await page.locator('.popup-item:not(.item-disabled)').count();
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('skill picker stays open and clears search after selection', async ({ page }) => {
    // Open the skill picker
    await page.locator('.picker-trigger').filter({ hasText: '初始战法' }).click({ force: true });
    await page.waitForTimeout(500);

    // Popup should be visible
    await expect(page.locator('.picker-popup')).toBeVisible();

    // Type a search term
    await page.locator(SEARCH_INPUT).fill('马');
    await page.waitForTimeout(300);

    // Select first result
    await page.locator('.popup-item:not(.item-selected):not(.item-disabled)').first().click({ force: true });
    await page.waitForTimeout(400);

    // Popup should remain open
    await expect(page.locator('.picker-popup')).toBeVisible({ timeout: 2000 });

    // Search text should be cleared
    await expect(page.locator(SEARCH_INPUT)).toHaveValue('');
  });
});
