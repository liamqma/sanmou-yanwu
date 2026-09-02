const { test, expect } = require('@playwright/test');
const { database } = require('./helpers');

const BILIBILI_URL = 'https://space.bilibili.com/326647108';
const DOUYIN_URL = 'https://www.douyin.com/user/MS4wLjABAAAAsW-zc2NaMalApO_7XcufkGRtpNfz4GV5077_ErdwkjpFWWMyImmREXPYb6AjMGDl';

test.describe('演武攻略', () => {
  test('presents the imported workbook sections and keeps attribution on this page only', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/guides/yanwu');

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '三国谋定天下演武武将、战法与阵容指南',
      })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('yanwu-guide-attribution')).toContainText(
      '攻略数据由但丁与你提供'
    );
    await expect(page.getByText('攻略数据由但丁与你提供', { exact: true }))
      .toHaveCount(1);
    const updatedDate = database.yanwuGuide.source.updatedAt.slice(0, 10);
    expect(database.yanwuGuide.source.updatedAt).toBe(updatedDate);
    await expect(page.getByTestId('yanwu-guide-attribution')).toContainText(
      `数据更新：${updatedDate}`
    );

    const authorAccounts = page.getByTestId('yanwu-author-accounts');
    await expect(authorAccounts.getByRole('heading', { name: '关注攻略作者' })).toBeVisible();
    const bilibiliLink = authorAccounts.getByRole('link', {
      name: '在哔哩哔哩打开但丁与你的主页（新窗口）',
    });
    const douyinLink = authorAccounts.getByRole('link', {
      name: '在抖音打开但丁与你的主页（新窗口）',
    });
    await expect(bilibiliLink).toHaveAttribute('href', BILIBILI_URL);
    await expect(douyinLink).toHaveAttribute('href', DOUYIN_URL);
    for (const accountLink of [bilibiliLink, douyinLink]) {
      await expect(accountLink).toHaveAttribute('target', '_blank');
      await expect(accountLink).toHaveAttribute('rel', 'noreferrer');
      await expect(accountLink.locator('svg')).toHaveCount(2);
    }
    await expect(authorAccounts.locator('img')).toHaveCount(0);
    await expect(
      page.getByText('保存对应图片后，使用哔哩哔哩或抖音扫码关注但丁与你。', { exact: true })
    ).toHaveCount(0);
    const bilibiliLinkBox = await bilibiliLink.boundingBox();
    const douyinLinkBox = await douyinLink.boundingBox();
    expect(bilibiliLinkBox).not.toBeNull();
    expect(douyinLinkBox).not.toBeNull();
    expect(Math.abs(bilibiliLinkBox.y - douyinLinkBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(bilibiliLinkBox.height - douyinLinkBox.height)).toBeLessThanOrEqual(1);

    await expect(page.getByRole('heading', { name: '国家武将排行榜' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '战法排行榜' })).toBeVisible();
    const rankedSkillCount = Object.values(database.skills).filter(
      (skill) => skill.ranking && skill.category
    ).length;
    await expect(page.getByTestId('guide-skill-rankings').locator('.MuiChip-root'))
      .toHaveCount(rankedSkillCount);
    await expect(page.getByText('同一档位内的武将不分先后。')).toHaveCount(0);
    const teamLibrary = page.getByTestId('guide-team-library');
    await expect(teamLibrary.getByRole('heading', { name: '强队阵容' })).toBeVisible();
    await expect(teamLibrary.getByRole('tab')).toHaveCount(0);
    const allTeamCards = teamLibrary.getByTestId('guide-team-card');
    await expect(allTeamCards).toHaveCount(database.team.length);
    const allTeamsDisclosure = teamLibrary.getByRole('button', {
      name: `展开${database.team.length}组阵容`,
    });
    await expect(allTeamsDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(allTeamCards.first()).not.toBeVisible();

    const championshipCount = database.team.filter((team) =>
      team.sources.includes('championship')
    ).length;
    await teamLibrary.getByRole('combobox', { name: '档位' }).click();
    await page.getByRole('option', { name: '冠军' }).click();
    const championshipCards = teamLibrary.getByTestId('guide-team-card');
    await expect(championshipCards).toHaveCount(championshipCount);
    const championshipDisclosure = teamLibrary.getByRole('button', {
      name: `展开${championshipCount}组阵容`,
    });
    await expect(championshipDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(championshipCards.first()).not.toBeVisible();
    await championshipDisclosure.click();
    await expect(championshipCards.first()).toBeVisible();
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
    await expect(page.getByText('攻略数据由但丁与你提供', { exact: true }))
      .toHaveCount(0);
  });
});
