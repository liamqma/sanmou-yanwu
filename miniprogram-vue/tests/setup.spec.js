const { test, expect } = require('playwright/test');

test.describe('Setup Page', () => {

  test('data loads from proxy - no 404', async ({ page }) => {
    const failedRequests = [];
    page.on('response', (response) => {
      if (response.url().includes('/data/') && response.status() >= 400) {
        failedRequests.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    expect(failedRequests).toEqual([]);
  });

  test('database.json loads successfully', async ({ page }) => {
    const response = await page.request.get('/data/database.json');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('skill_hero_map');
    expect(data).toHaveProperty('skill');
    expect(Object.keys(data.skill_hero_map).length).toBeGreaterThan(0);
  });

  test('page renders setup form after data loads', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Should show the card title
    await expect(page.locator('text=对局设置').first()).toBeVisible();

    // Should show hero and skill cells
    await expect(page.locator('text=初始武将')).toBeVisible();
    await expect(page.locator('text=初始战法')).toBeVisible();

    // Should show start button
    await expect(page.locator('text=开始对局')).toBeVisible();
  });

  test('hero picker opens and shows filterable list', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Click the hero cell to open picker
    await page.locator('text=初始武将').click();
    await page.waitForTimeout(1000);

    // Should show the picker action sheet with search and hero list
    await expect(page.locator('text=输入中文或拼音搜索...')).toBeVisible();
    await expect(page.locator('text=确认')).toBeVisible();
  });

  test('no errors on page - screenshot', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'tests/tmp_rovodev_screenshot.png', fullPage: true });
    expect(errors).toEqual([]);
  });
});
