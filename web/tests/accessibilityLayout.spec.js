const { test, expect } = require('@playwright/test');
const {
  seedGame,
  makeGameState,
  heroesWithMeta,
  anySkills,
} = require('./helpers');

const lateRoundState = () => ({
  ...makeGameState({
    roundNumber: 7,
    heroes: heroesWithMeta.slice(0, 9),
    skills: anySkills(18),
  }),
  round7_interstitial_dismissed: true,
});

const lateRoundInputs = () => ({
  set1: heroesWithMeta.slice(9, 11),
  set2: heroesWithMeta.slice(11, 13),
  set3: heroesWithMeta.slice(13, 15),
});

test.describe('Accessibility and responsive layout', () => {
  test('each primary page exposes one level-one heading', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '录入当前阵容' })).toBeVisible();

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { level: 1, name: '数据洞察' })).toBeVisible();

    await seedGame(page, lateRoundState(), lateRoundInputs());
    await expect(page.getByRole('heading', { level: 1, name: '第 7 轮：选择武将' })).toBeVisible();

    await page.goto('/team-builder');
    await expect(page.getByRole('heading', { level: 1, name: '队伍策案' })).toBeVisible();

    await page.goto('/build-a-team');
    await expect(page.getByRole('heading', { level: 1, name: '组队 / Build a Team' })).toBeVisible();
  });

  test('mobile round progress uses a complete non-scrolling grid', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedGame(page, lateRoundState(), lateRoundInputs());

    const progress = page.getByRole('list', { name: '8 轮进度' });
    await expect(progress).toBeVisible();
    await expect(progress.getByRole('listitem')).toHaveCount(8);
    await expect(progress.getByRole('listitem', { name: /第 7 轮.*当前/ })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('region', { name: '8 轮进度，可横向滚动' })).not.toBeVisible();
  });

  test('mobile keeps key recommendation actions visible while details are collapsible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedGame(page, lateRoundState(), lateRoundInputs());
    await page.getByRole('button', { name: '获取 AI 推荐' }).click();

    const firstDetails = page.getByRole('button', { name: '展开第1组详细分析' });
    await expect(firstDetails).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: '选择本组' })).toHaveCount(3);

    await firstDetails.click();
    await expect(page.getByText('评分详情:').first()).toBeVisible();
  });

  test('mobile analytics tables disclose into labelled keyboard-focusable regions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/analytics');

    const disclosure = page.getByRole('button', { name: '展开全部武将排名' });
    await expect(disclosure).toBeVisible({ timeout: 15000 });
    await disclosure.click();

    const tableRegion = page.getByRole('region', { name: '全部武将排名表格，可滚动' });
    await expect(tableRegion).toBeVisible();
    await expect(tableRegion).toHaveAttribute('tabindex', '0');
  });
});
