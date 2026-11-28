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

const completedState = () => {
  const rosterSkills = anySkills(19);

  return {
    ...makeGameState({
      roundNumber: 11,
      heroes: heroesWithMeta.slice(0, 9),
      skills: rosterSkills.slice(0, 18),
    }),
    support_hero: heroesWithMeta[9],
    // One support skill is a valid UI state and ensures read-only rendering,
    // rather than a full-support conditional, is what hides coaching controls.
    support_skills: rosterSkills.slice(18, 19),
    round7_interstitial_dismissed: true,
    round9_interstitial_dismissed: true,
  };
};

test.describe('Accessibility and responsive layout', () => {
  test('mobile setup prioritizes the roster form and keeps secondary destinations in one menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().clearCookies();
    await page.goto('/');

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '演武配将与战法推荐',
      }),
    ).toBeVisible({ timeout: 30000 });

    const selector = page.getByRole('combobox', { name: '当前赛季' });
    const heroInput = page.getByLabel('输入武将名或拼音...');
    await expect(selector).toBeVisible();
    await expect(heroInput).toBeVisible();

    const [headerBox, selectorBox, heroInputBox] = await Promise.all([
      page.locator('header').boundingBox(),
      selector.boundingBox(),
      heroInput.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(selectorBox).not.toBeNull();
    expect(heroInputBox).not.toBeNull();
    expect(
      headerBox.height,
      'the focused mobile header should remain compact',
    ).toBeLessThanOrEqual(70);
    expect(
      heroInputBox.y,
      'the first roster input should follow the season selector',
    ).toBeGreaterThanOrEqual(selectorBox.y + selectorBox.height);

    await expect(
      page.getByRole('navigation', { name: '主要导航' }),
    ).not.toBeVisible();
    await expect(page.getByRole('button', { name: '重置' })).toHaveCount(0);

    const mobileNavigation = page.getByRole('navigation', {
      name: '移动导航',
    });
    await expect(mobileNavigation).toBeVisible();
    const menuButton = page.locator('#mobile-navigation-button');
    await expect(menuButton).toHaveRole('button', { name: '菜单' });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-haspopup', 'menu');
    await expect(menuButton).not.toHaveAttribute('aria-expanded', 'true');
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    let menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    menu = page.getByRole('menu');
    const advisorItem = menu.getByRole('menuitem', { name: '对局推荐' });
    await expect(advisorItem).toBeVisible();
    await expect(advisorItem).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('menuitem', { name: '队伍推荐' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: '数据洞察' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '战报贡献榜' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '上传战报' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: '重置进度' })).toHaveCount(0);
    const contributorsItem = menu.getByRole('menuitem', { name: '战报贡献榜' });
    await contributorsItem.click();
    await expect(menu).not.toBeVisible();
    await expect(page).toHaveURL(/\/contributors$/);
  });

  test('the shared mobile menu replaces horizontal navigation through sm and reflects progress', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await seedGame(page, lateRoundState(), lateRoundInputs());
    await page.goto('/analytics');

    await expect(page.getByRole('navigation', { name: '主要导航' })).not.toBeVisible();
    const mobileNavigation = page.getByRole('navigation', { name: '移动导航' });
    await expect(mobileNavigation).toBeVisible();
    await mobileNavigation.getByRole('button', { name: '菜单' }).click();

    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: '数据洞察' }))
      .toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('menuitem', { name: '队伍推荐' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: '重置进度' })).toBeVisible();

    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.getByRole('navigation', { name: '移动导航' })).not.toBeVisible();
    await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible();
  });

  test('each primary page exposes one level-one heading', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '演武配将与战法推荐',
      }),
    ).toBeVisible();

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { level: 1, name: '数据洞察' })).toBeVisible();

    await page.goto('/contributors');
    await expect(page.getByRole('heading', { level: 1, name: '战报贡献榜' })).toBeVisible();

    await seedGame(page, lateRoundState(), lateRoundInputs());
    const roundHeading = page.getByRole('heading', {
      level: 1,
      name: '第 7 轮：选择武将',
    });
    await expect(roundHeading).toHaveCount(1);

  });

  test('completed game has one h1 and keeps its support roster read-only', async ({ page }) => {
    const gameState = completedState();
    expect(gameState.support_hero).toBeTruthy();
    expect(gameState.support_skills).toHaveLength(1);

    await seedGame(page, gameState);

    const levelOneHeadings = page.getByRole('heading', { level: 1 });
    await expect(levelOneHeadings).toHaveCount(1);
    await expect(levelOneHeadings).toHaveAccessibleName('对局完成');

    const roster = page.getByRole('region', { name: '当前阵容' });
    await expect(roster).toBeVisible();
    await expect(roster.getByTestId(`game-card-hero-${gameState.support_hero}`)).toBeVisible();
    await expect(roster.getByTestId(`game-card-tactic-${gameState.support_skills[0]}`)).toBeVisible();
    await expect(roster.getByText('★ 支援', { exact: true })).toHaveCount(2);

    await expect(roster.getByTestId('CancelIcon')).toHaveCount(0);
    await expect(
      roster.getByRole('button', {
        name: /^推荐(?:支援|自选)(?:武将|战法)$/,
      }),
    ).toHaveCount(0);
    await expect(roster.getByRole('button', { name: '编辑队伍' })).toHaveCount(0);
  });

  test('support recommendation actions use support wording', async ({ page }) => {
    await seedGame(page, lateRoundState(), lateRoundInputs());

    const roster = page.getByRole('region', { name: '当前阵容' });
    await expect(roster.getByRole('button', { name: '推荐支援武将' })).toBeVisible();
    await expect(roster.getByRole('button', { name: '推荐支援战法' })).toHaveCount(2);
    await expect(
      roster.getByRole('button', { name: /^推荐自选(?:武将|战法)$/ }),
    ).toHaveCount(0);
  });

  test('mobile round-one roster disclosure keeps its header on one line and actions aligned', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedGame(
      page,
      makeGameState({
        roundNumber: 1,
        heroes: heroesWithMeta.slice(0, 4),
        skills: anySkills(8),
      }),
    );

    const rosterToggle = page.getByRole('button', {
      name: '展开当前阵容与仓库',
    });
    const roster = page.getByRole('region', { name: '当前阵容' });
    await expect(rosterToggle).toBeVisible();
    await expect(roster).not.toBeVisible();
    await rosterToggle.click();

    const heading = roster.getByRole('heading', {
      level: 2,
      name: '当前阵容',
    });
    const season = roster.getByTestId('current-season-chip');
    await expect(heading).toBeVisible();
    await expect(season).toBeVisible();
    await expect(
      roster.getByText('CURRENT ROSTER', { exact: true }),
    ).toHaveCount(0);

    const [headingBox, seasonBox] = await Promise.all([
      heading.boundingBox(),
      season.boundingBox(),
    ]);
    expect(headingBox).not.toBeNull();
    expect(seasonBox).not.toBeNull();
    expect(Math.abs(seasonBox.y - headingBox.y)).toBeLessThanOrEqual(8);

    const heroSupport = roster.getByRole('button', {
      name: '推荐支援武将',
    });
    const skillSupport = roster.getByRole('button', {
      name: '推荐支援战法',
    }).first();
    const [heroButtonBox, skillButtonBox] = await Promise.all([
      heroSupport.boundingBox(),
      skillSupport.boundingBox(),
    ]);
    expect(heroButtonBox).not.toBeNull();
    expect(skillButtonBox).not.toBeNull();
    expect(Math.abs(heroButtonBox.width - skillButtonBox.width)).toBeLessThan(2);
    expect(Math.abs(heroButtonBox.height - skillButtonBox.height)).toBeLessThan(2);

    await expect(
      page.getByRole('region', { name: '本轮三组选项' }),
    ).toBeVisible();
    await expect(
      page.getByLabel('输入武将名或拼音搜索武将'),
    ).toHaveCount(3);
  });

  test('the current-roster header stays on one line at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await seedGame(
      page,
      makeGameState({
        roundNumber: 1,
        heroes: heroesWithMeta.slice(0, 4),
        skills: anySkills(8),
      }),
    );

    await page.getByRole('button', { name: '展开当前阵容与仓库' }).click();
    const roster = page.getByRole('region', { name: '当前阵容' });
    const controls = [
      roster.getByRole('heading', { level: 2, name: '当前阵容' }),
      roster.getByRole('button', { name: '编辑队伍' }),
      roster.getByTestId('current-season-chip'),
    ];
    await Promise.all(controls.map((control) => expect(control).toBeVisible()));

    const rosterBox = await roster.boundingBox();
    const controlBoxes = await Promise.all(controls.map((control) => control.boundingBox()));
    expect(rosterBox).not.toBeNull();
    expect(controlBoxes.every(Boolean)).toBe(true);

    const boxes = controlBoxes.filter(Boolean);
    expect(Math.max(...boxes.map((box) => box.y)) - Math.min(...boxes.map((box) => box.y)))
      .toBeLessThanOrEqual(8);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(rosterBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(rosterBox.x + rosterBox.width + 1);
    }
    expect(boxes[1].width).toBeGreaterThanOrEqual(44);
    expect(boxes[1].height).toBeGreaterThanOrEqual(44);

    const documentOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth
    );
    expect(documentOverflow).toBeLessThanOrEqual(1);
  });

  test('mobile round-7 interstitial puts its primary action before the roster', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedGame(
      page,
      {
        ...lateRoundState(),
        round7_interstitial_dismissed: false,
      },
      lateRoundInputs(),
    );

    const action = page.getByRole('button', { name: '我已获胜，进入第 7 轮' });
    const roster = page.getByRole('region', { name: '当前阵容' });
    await expect(action).toBeVisible();
    await expect(roster).toBeVisible();
    await expect(
      page.getByText(
        '提示：建议先确认核心武将，再围绕核心挑选其余武将与战法。请尽早确认支援选择，AI 才能据此给出更精准的推荐。',
      ),
    ).toHaveCount(0);

    const [actionBox, rosterBox] = await Promise.all([
      action.boundingBox(),
      roster.boundingBox(),
    ]);
    expect(actionBox).not.toBeNull();
    expect(rosterBox).not.toBeNull();
    expect(
      actionBox.y + actionBox.height,
      'mobile primary action should end above the current-roster region',
    ).toBeLessThanOrEqual(rosterBox.y);
  });

  test('mobile round progress uses a complete non-scrolling grid', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedGame(page, lateRoundState(), lateRoundInputs());

    const progress = page.getByRole('list', { name: '10 轮进度' });
    await expect(progress).toBeVisible();
    await expect(progress.getByRole('listitem')).toHaveCount(10);
    await expect(progress.getByRole('listitem', { name: /第 7 轮.*当前/ })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('region', { name: '10 轮进度，可横向滚动' })).not.toBeVisible();
  });

  test('mobile keeps key recommendation actions visible while details are collapsible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedGame(page, lateRoundState(), lateRoundInputs());
    await page.getByRole('button', { name: '获取 AI 推荐' }).click();

    const firstDetails = page.getByRole('button', { name: '展开第1组选后阵容' });
    await expect(firstDetails).toBeVisible({ timeout: 60000 });
    // Mobile keeps all three options in document order so the next group is
    // reached by normal vertical scrolling rather than a hidden tab state.
    await expect(page.getByRole('button', { name: '选择本组' })).toHaveCount(3);
    await expect(page.getByTestId('mobile-option-switcher')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '展开第2组选后阵容' })).toBeVisible();
    await expect(page.getByRole('button', { name: '展开第3组选后阵容' })).toBeVisible();

    // The verdict and the win rates stay visible without expanding.
    await expect(page.getByTestId('option-score-0')).toBeVisible();
    await expect(page.getByTestId('option-strengths-0')).toBeVisible();
    await expect(page.getByTestId('option-lineup').first()).not.toBeVisible();

    // Expanding reveals the lineup this set leads to.
    await firstDetails.click();
    await expect(page.getByTestId('option-lineup').first()).toBeVisible();
    await expect(page.getByTestId('option-lineup').first()).toContainText('队伍一');
  });

  test('mobile analytics tables disclose into labelled keyboard-focusable regions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/analytics');

    const telemetryDisclosure = page.getByRole('button', {
      name: '展开游戏最常提供武将排行',
    });
    await expect(telemetryDisclosure).toBeVisible({ timeout: 15000 });
    await telemetryDisclosure.click();

    const telemetryTableRegion = page.getByRole('region', {
      name: '游戏最常提供武将排行表格，可滚动',
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
  });

  test('analytics shows the anonymous choice statistics under one page heading', async ({ page }) => {
    await page.goto('/analytics');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: '数据洞察' })).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByTestId('player-choice-analytics').getByRole('heading', { level: 2, name: '匿名选项统计' })
    ).toBeVisible();
    // The old model's battle-report half is gone.
    await expect(page.getByTestId('battle-report-analytics')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /数据与算法说明/ })).toHaveCount(0);
  });
});
