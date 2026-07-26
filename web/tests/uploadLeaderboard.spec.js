const { test, expect } = require('@playwright/test');

const leaderboardArtifact = {
  schema_version: 1,
  updated_date: '2026-07-24',
  updated_through_id: 10,
  summary: {
    processed_reports: 10,
    accepted_reports: 9,
    rejected_reports: 1,
  },
  contributors: [
    { name: '<img src=x onerror=alert(1)>', accepted_reports: 5 },
    { name: '  玩家  甲  ', accepted_reports: 3 },
    { name: '貂蝉😀', accepted_reports: 1 },
  ],
};

const mockLeaderboard = (page) =>
  page.route('**/game-data/web_upload_data.json*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(leaderboardArtifact),
    }),
  );

test.describe('Static upload leaderboard', () => {
  test('navigation opens the dedicated escaped leaderboard without loading it on the advisor', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    let leaderboardRequests = 0;
    await page.route('**/game-data/web_upload_data.json*', (route) => {
      leaderboardRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(leaderboardArtifact),
      });
    });
    await page.goto('/');

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '初始名册 · 演武开局',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: '贡献者排名' }),
    ).toHaveCount(0);
    expect(leaderboardRequests).toBe(0);

    const setupNavigation = page.getByRole('navigation', {
      name: '主要导航',
    });
    await expect(setupNavigation).toBeVisible();
    await expect(
      setupNavigation.getByRole('button', { name: '数据洞察' }),
    ).toBeVisible();
    await expect(
      setupNavigation.getByRole('button', { name: '上传战报' }),
    ).toBeVisible();
    await expect(
      setupNavigation.getByRole('button', { name: '对局推荐' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重置' })).toHaveCount(0);

    await setupNavigation
      .getByRole('button', { name: '战报贡献榜' })
      .click();
    await expect(page).toHaveURL(/\/contributors$/);
    await expect(
      page.getByRole('heading', { level: 1, name: '战报贡献榜' }),
    ).toBeVisible();

    const ranking = page.getByRole('region', { name: '贡献者排名' });
    await expect(
      ranking.getByRole('heading', { level: 2, name: '贡献者排名' }),
    ).toBeVisible();
    await expect(ranking.getByText('更新至 2026-07-24')).toBeVisible();
    await expect(ranking.getByText('已收录 9 份有效战报')).toBeVisible();
    await expect(
      ranking.getByText('<img src=x onerror=alert(1)>', { exact: true }),
    ).toBeVisible();
    await expect(ranking.locator('img')).toHaveCount(0);

    const spacedName = ranking.locator('[title="  玩家  甲  "]');
    await expect(spacedName).toBeVisible();
    expect(await spacedName.textContent()).toBe('  玩家  甲  ');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(leaderboardRequests).toBe(1);

    await ranking.getByRole('button', { name: '上传我的战报' }).click();
    await expect(page).toHaveURL(/\/contribute$/);
    await expect(
      page.getByRole('heading', { level: 1, name: '上传战报' }),
    ).toBeVisible();
  });

  test('mobile renders the full leaderboard inline without a teaser or drawer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLeaderboard(page);
    await page.goto('/contributors');

    await expect(
      page.getByRole('heading', { level: 1, name: '战报贡献榜' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: '贡献者排名' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '打开战报贡献榜' }),
    ).toHaveCount(0);
    await expect(page.locator('.MuiDrawer-paper')).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.getByRole('button', { name: '返回对局推荐' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '初始名册 · 演武开局',
      }),
    ).toBeVisible();
  });
});
