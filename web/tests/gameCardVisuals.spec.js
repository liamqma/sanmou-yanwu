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

const portraitRoundState = () => makeGameState({
  roundNumber: 1,
  heroes: heroesWithMeta.slice(0, 4),
  skills: anySkills(8),
});

const portraitRoundInputs = () => ({
  set1: heroesWithMeta.slice(4, 7),
  set2: heroesWithMeta.slice(7, 10),
  set3: heroesWithMeta.slice(10, 13),
});

test.describe('local game-card presentation', () => {
  test('browser decodes every manifest-backed hero and tactic as a complete portrait', async ({ page }) => {
    await page.goto('/');
    const paths = [
      ...Object.values(manifest.heroes),
      ...Object.values(manifest.tactics),
    ].map((entry) => entry.path);
    const decoded = await page.evaluate(
      (sources) => Promise.all(sources.map((src) => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve({
          src,
          width: image.naturalWidth,
          height: image.naturalHeight,
          loaded: true,
        });
        image.onerror = () => resolve({ src, width: 0, height: 0, loaded: false });
        image.src = src;
      }))),
      paths
    );

    expect(decoded.filter((image) => !image.loaded)).toEqual([]);
    expect(decoded.filter((image) => image.height / image.width <= 1.45)).toEqual([]);
  });

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

  test('team builder visibly renders complete local hero and tactic cards', async ({ page }) => {
    await seedGame(
      page,
      { ...roundState(), current_skills: Object.keys(manifest.tactics).slice(0, 18) },
      roundInputs()
    );
    await page.goto('/team-builder');
    await expect(page.getByRole('heading', { name: '我的比赛阵容' })).toBeVisible({
      timeout: 30000,
    });

    const heroImages = page.locator(
      '[data-testid^="hero-art-"] [data-testid^="game-card-hero-"] img'
    );
    const tacticImages = page.locator(
      '[data-testid^="skill-slot-"] [data-testid^="game-card-tactic-"] img'
    );
    await expect.poll(() => heroImages.count(), { timeout: 30000 }).toBeGreaterThan(0);
    await expect.poll(() => tacticImages.count(), { timeout: 30000 }).toBeGreaterThan(0);

    for (const images of [heroImages, tacticImages]) {
      const image = images.first();
      await expect(image).toBeVisible();
      await expect(image).toHaveCSS('object-fit', 'contain');
      await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
      const naturalSize = await image.evaluate((node) => ({
        width: node.naturalWidth,
        height: node.naturalHeight,
      }));
      expect(naturalSize.height).toBeGreaterThan(naturalSize.width);
      expect(await image.getAttribute('src')).toMatch(/^\/game-assets\/(heroes|tactics)\//);
      const box = await image.boundingBox();
      expect(box).toBeTruthy();
      expect(Math.min(box.width, box.height)).toBeGreaterThan(30);
    }
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

  test('keeps compact option and roster art as complete portrait cards on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 844 });
    await seedGame(page, portraitRoundState(), portraitRoundInputs());

    const tabletOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth
    );
    expect(tabletOverflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 390, height: 844 });

    const optionSection = page.getByRole('region', { name: '本轮三组选项' });
    const optionLists = optionSection.getByTestId('game-card-list');
    await expect(optionLists).toHaveCount(3);

    const firstOptionCards = optionLists.first().locator('[data-card-size="mini"]');
    await expect(firstOptionCards).toHaveCount(3);
    for (const card of await firstOptionCards.all()) {
      const box = await card.boundingBox();
      expect(box).toBeTruthy();
      expect(box.height / box.width).toBeGreaterThan(1.45);
      await expect(card.locator('img')).toHaveCSS('object-fit', 'contain');
    }

    const listOverflow = await optionLists.evaluateAll((lists) =>
      lists.map((list) => list.scrollWidth - list.clientWidth)
    );
    expect(listOverflow.every((overflow) => overflow <= 1)).toBe(true);

    await page.getByRole('button', { name: '展开当前阵容与仓库' }).click();
    const roster = page.getByRole('region', { name: '当前阵容' });
    const rosterLists = roster.getByTestId('game-card-list');
    await expect(rosterLists).toHaveCount(2);
    await expect(rosterLists.first()).toHaveAttribute('data-card-layout', 'portrait-grid');

    const rosterCard = rosterLists.first().locator('[data-card-size="mini"]').first();
    const rosterBox = await rosterCard.boundingBox();
    expect(rosterBox).toBeTruthy();
    expect(rosterBox.height / rosterBox.width).toBeGreaterThan(1.45);

    const documentOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth
    );
    expect(documentOverflow).toBeLessThanOrEqual(1);
  });
});
