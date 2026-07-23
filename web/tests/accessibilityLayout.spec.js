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

    // Per-option 评分 stays visible without expanding; 火力 wording is gone.
    await expect(page.getByTestId('option-score-0')).toBeVisible();
    await expect(page.getByText(/火力/)).toHaveCount(0);

    // Expanding reveals the compact 组合加分项 detail (or its empty-state).
    await firstDetails.click();
    await expect(
      page.getByText('组合加分项:').or(page.getByText('暂无明显加分项。')).first(),
    ).toBeVisible();
    await expect(page.getByText('推荐理由:')).toHaveCount(0);
    await expect(page.getByText('可能减分项:')).toHaveCount(0);
  });

  test('mobile analytics tables disclose into labelled keyboard-focusable regions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/analytics');

    const telemetryDisclosure = page.getByRole('button', {
      name: '展开系统最常提供武将排行',
    });
    await expect(telemetryDisclosure).toBeVisible({ timeout: 15000 });
    await telemetryDisclosure.click();

    const telemetryTableRegion = page.getByRole('region', {
      name: '系统最常提供武将排行表格，可滚动',
    });
    await expect(telemetryTableRegion).toBeVisible();
    await expect(telemetryTableRegion).toHaveAttribute('tabindex', '0');
    expect(
      await telemetryTableRegion.evaluate((element) => {
        const styles = window.getComputedStyle(element);
        return {
          maxHeight: styles.maxHeight,
          overflowY: styles.overflowY,
        };
      })
    ).toEqual({ maxHeight: '520px', overflowY: 'auto' });

    const disclosure = page.getByRole('button', { name: '展开全部武将排名' });
    await expect(disclosure).toBeVisible({ timeout: 15000 });
    await disclosure.click();

    const tableRegion = page.getByRole('region', { name: '全部武将排名表格，可滚动' });
    await expect(tableRegion).toBeVisible();
    await expect(tableRegion).toHaveAttribute('tabindex', '0');
  });

  test('analytics separates telemetry from the battle-report guide', async ({ page }) => {
    await page.goto('/analytics');

    // The single level-one heading is preserved.
    await expect(page.getByRole('heading', { level: 1, name: '数据洞察' })).toBeVisible({ timeout: 15000 });

    const telemetrySection = page.getByTestId('player-choice-analytics');
    const battleSection = page.getByTestId('battle-report-analytics');
    await expect(
      telemetrySection.getByRole('heading', {
        level: 2,
        name: '匿名选项统计',
      })
    ).toBeVisible();
    await expect(
      battleSection.getByRole('heading', {
        level: 2,
        name: '历史战报分析',
      })
    ).toBeVisible();
    await expect(telemetrySection).not.toContainText('所有结论都来自已记录的');
    await expect(battleSection).toContainText('所有结论都来自已记录的');
    expect(
      await page.evaluate(() => {
        const telemetryElement = document.querySelector(
          '[data-testid="player-choice-analytics"]'
        );
        const battleElement = document.querySelector(
          '[data-testid="battle-report-analytics"]'
        );
        return Boolean(
          telemetryElement &&
            battleElement &&
            telemetryElement.compareDocumentPosition(battleElement) &
              Node.DOCUMENT_POSITION_FOLLOWING
        );
      })
    ).toBe(true);

    // The battle-report section owns the guide to its three measures.
    await expect(
      battleSection.getByRole('heading', { name: '三步看懂这些数字' })
    ).toBeVisible();
    await expect(battleSection.getByText('胜率参考')).not.toHaveCount(0);
    await expect(battleSection.getByText('组合分')).not.toHaveCount(0);
    await expect(battleSection.getByText('参考场次')).not.toHaveCount(0);
    await expect(battleSection.getByText('强度加成')).toHaveCount(0);

    // Actionable sections come before the optional diagnostics section.
    await expect(battleSection.getByRole('heading', { name: '先看谁更值得选' })).toBeVisible();
    await expect(battleSection.getByRole('heading', { name: '再看哪些搭配效果好' })).toBeVisible();

    // The action-oriented filter section replaces the old "筛选名册" wording.
    await expect(battleSection.getByRole('heading', { name: '只看我关心的武将和战法' })).toBeVisible();
  });

  test('data-and-algorithm details start collapsed and expand by keyboard', async ({ page }) => {
    await page.goto('/analytics');

    const summary = page.getByRole('button', { name: /数据与算法说明/ });
    await expect(summary).toBeVisible({ timeout: 15000 });

    // Collapsed by default: the accordion summary reports aria-expanded=false and
    // the technical details inside are not yet visible.
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('技术指标')).not.toBeVisible();

    // Keyboard-accessible: focus and activate the summary to expand it.
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('技术指标')).toBeVisible();
    // Original technical metrics remain available under the technical subheading.
    await expect(page.getByText(/对数损失/)).toBeVisible();
  });
});
