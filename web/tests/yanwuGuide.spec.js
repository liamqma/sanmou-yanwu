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
    await expect(page.getByText('同一档位内的武将不分先后。')).toHaveCount(0);
    const teamLibrary = page.getByTestId('guide-team-library');
    await expect(teamLibrary.getByRole('heading', { name: '强队阵容' })).toBeVisible();
    await expect(teamLibrary.getByRole('tab')).toHaveCount(0);
    await expect(teamLibrary.getByTestId('guide-team-card')).toHaveCount(
      database.team.length
    );

    const championshipCount = database.team.filter((team) =>
      team.sources.includes('championship')
    ).length;
    await teamLibrary.getByRole('combobox', { name: '档位' }).click();
    await page.getByRole('option', { name: '冠军' }).click();
    const championshipCards = teamLibrary.getByTestId('guide-team-card');
    await expect(championshipCards).toHaveCount(championshipCount);
    await expect(championshipCards.getByTestId('guide-team-tier')).toHaveText(
      Array(championshipCount).fill('冠军')
    );
    await expect(championshipCards.getByText(/^冠军参考/)).toHaveCount(0);
    await expect(championshipCards.getByText('魏国', { exact: true })).toHaveCount(0);
    await expect(championshipCards.getByText('蜀国', { exact: true })).toHaveCount(0);

    const regularSCount = database.team.filter(
      (team) =>
        team.ranking === 'S' &&
        !team.sources.includes('championship')
    ).length;
    await teamLibrary.getByRole('combobox', { name: '档位' }).click();
    await page.getByRole('option', { name: 'S' }).click();
    const regularSCards = teamLibrary.getByTestId('guide-team-card');
    await expect(regularSCards).toHaveCount(regularSCount);
    await expect(regularSCards.getByTestId('guide-team-tier')).toHaveText(
      Array(regularSCount).fill('S')
    );
    await expect(page.getByRole('heading', { name: '阵容克制查询' })).toBeVisible();
    await expect(page.getByRole('table', { name: '阵容克制关系' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '阵容解析' })).toBeVisible();

    const guide = database.yanwuGuide;
    expect(guide.matchups.buildIds).toHaveLength(13);
    expect(guide.championshipGroups).toHaveLength(5);
    expect(guide.analysisSections.length).toBeGreaterThan(0);

    const matchupTable = page.getByRole('table', {
      name: '阵容克制关系',
    });
    await expect(
      matchupTable.getByText('司马懿 + 曹操 + 曹丕', { exact: true })
    ).toHaveCount(1);
    await expect(
      matchupTable.getByText('曹丕 + 曹操 + (法刀) 司马懿', { exact: true })
    ).toHaveCount(1);

    await page.getByRole('combobox', { name: '己方阵容' }).click();
    await expect(
      page.getByRole('option', {
        name: '司马懿 + 曹操 + 曹丕',
        exact: true,
      })
    ).toHaveCount(1);
    await expect(
      page.getByRole('option', {
        name: '曹丕 + 曹操 + (法刀) 司马懿',
        exact: true,
      })
    ).toHaveCount(1);
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: '对局推荐' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('攻略数据由三谋吕布提供', { exact: true }))
      .toHaveCount(0);
  });
});
