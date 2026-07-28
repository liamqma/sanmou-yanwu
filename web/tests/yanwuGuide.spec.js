const { test, expect } = require('@playwright/test');
const { database } = require('./helpers');

test.describe('演武攻略', () => {
  test('presents all five workbook sections and keeps attribution on this page only', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/guides/yanwu');

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '三国谋定天下演武武将与阵容指南',
      })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('yanwu-guide-attribution')).toContainText(
      '攻略数据由三谋吕布提供'
    );
    await expect(page.getByText('攻略数据由三谋吕布提供', { exact: true }))
      .toHaveCount(1);

    await expect(page.getByRole('heading', { name: '国家武将排行榜' })).toBeVisible();
    await expect(page.getByText('同一档位内的武将不分先后。')).toBeVisible();
    await expect(page.getByRole('heading', { name: '强队阵容库' })).toBeVisible();
    await expect(page.getByTestId('guide-team-card').first()).toBeVisible();
    await expect(page.getByText('夺冠御三家', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '阵容克制查询' })).toBeVisible();
    await expect(page.getByRole('table', { name: '阵容克制关系' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '阵容解析' })).toBeVisible();

    const guide = database.yanwuGuide;
    expect(guide.matchups.buildIds).toHaveLength(13);
    expect(guide.championshipGroups).toHaveLength(5);
    expect(guide.analysisSections.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: '对局推荐' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('攻略数据由三谋吕布提供', { exact: true }))
      .toHaveCount(0);
  });
});
