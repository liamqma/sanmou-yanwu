const { test, expect } = require('@playwright/test');
const manifest = require('../public/game-assets/manifest.json');
const { seedGame, makeGameState, heroesWithMeta, anySkills } = require('./helpers');

const roundState = () => ({
  ...makeGameState({
    roundNumber: 7,
    heroes: heroesWithMeta.slice(0, 9),
    skills: anySkills(18),
  }),
  round7_interstitial_dismissed: true,
});

const roundInputs = () => ({
  set1: heroesWithMeta.slice(9, 11),
  set2: heroesWithMeta.slice(11, 13),
  set3: heroesWithMeta.slice(13, 15),
});

test.describe('local game-card presentation', () => {
  test('shows three desktop card groups and one switchable mobile group without CDN image requests', async ({ page }) => {
    const remoteCardRequests = [];
    page.on('request', request => {
      if (/cdn\.sgmdtx\.com\/img\//.test(request.url())) remoteCardRequests.push(request.url());
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await seedGame(page, roundState(), roundInputs());
    await page.getByRole('button', { name: '获取 AI 推荐' }).click();

    const groups = page.getByTestId('analysis-set-card');
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toBeVisible();
    await expect(groups.nth(1)).toBeVisible();
    await expect(groups.nth(2)).toBeVisible();
    await expect(page.locator('[data-testid^="game-card-hero-"] img').first()).toHaveAttribute('loading', 'lazy');
    expect(remoteCardRequests).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    const warehouseToggle = page.getByRole('button', { name: '展开当前阵容与仓库' });
    await expect(warehouseToggle).toBeVisible();
    await expect(page.getByRole('region', { name: '当前阵容' })).not.toBeVisible();
    await warehouseToggle.click();
    await expect(page.getByRole('region', { name: '当前阵容' })).toBeVisible();
    await page.getByRole('button', { name: '收起当前阵容与仓库' }).click();

    const switcher = page.getByTestId('mobile-option-switcher');
    await expect(switcher).toBeVisible();
    await expect(groups.nth(0)).toBeVisible();
    await expect(groups.nth(1)).not.toBeVisible();
    await page.getByRole('button', { name: '查看第2组选项' }).click();
    await expect(groups.nth(0)).not.toBeVisible();
    await expect(groups.nth(1)).toBeVisible();
    await expect(page.getByRole('button', { name: '查看第2组选项' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('uses the named local fallback when a card image fails', async ({ page }) => {
    const hero = heroesWithMeta[0];
    const asset = manifest.heroes[hero];
    expect(asset).toBeTruthy();
    await page.route(`**${asset.path}`, route => route.fulfill({ status: 404, body: '' }));
    await seedGame(page, roundState(), roundInputs());

    const card = page.getByTestId(`game-card-hero-${hero}`).first();
    await expect(card).toHaveAttribute('data-card-fallback', 'true');
    await expect(card.getByRole('img')).toHaveAttribute('src', '/game-assets/card-fallback.svg');
    await expect(card).toContainText(hero);
  });
});
