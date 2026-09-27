const { test, expect } = require('@playwright/test');
const { seedGame, makeGameState } = require('./helpers');
const database = require('../public/game-data/database.json');

const heroes = Object.keys(database.heroes).slice(0, 4);
const skills = Object.keys(database.skills).slice(0, 8);

test.describe('reset progress', () => {
  test.beforeEach(async ({ page }) => {
    // Native confirm() is blocked in some embedded browsers, so the app must
    // not depend on it; fail loudly if it is ever used again.
    page.on('dialog', (dialog) => {
      throw new Error(`unexpected native dialog: ${dialog.message()}`);
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedGame(page, makeGameState({ roundNumber: 2, heroes, skills }), { set1: [], set2: [], set3: [] });
    await expect(page.getByRole('heading', { level: 1, name: '第 2 轮：选择战法' })).toHaveCount(1);
  });

  test('cancel keeps the game', async ({ page }) => {
    await page.getByRole('button', { name: '重置' }).click();
    const dialog = page.getByRole('dialog', { name: '重置全部进度？' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: '第 2 轮：选择战法' })).toHaveCount(1);
  });

  test('confirm returns to setup', async ({ page }) => {
    await page.getByRole('button', { name: '重置' }).click();
    await page.getByRole('dialog', { name: '重置全部进度？' }).getByRole('button', { name: '重置' }).click();
    await expect(page.getByText('初始武将 (0/4)')).toBeVisible();
  });
});
