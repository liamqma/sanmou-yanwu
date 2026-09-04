const { test, expect } = require('@playwright/test');

const DAILY_YANWU_URL = '/daily-yanwu?dailyYanwuFixture=reference';
const REFERENCE_HEROES = ['黄盖', '张宝', '李儒'];

const expectNoHorizontalOverflow = async (page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
};

test.describe('每天演武', () => {
  test('renders an immersive entry and completes the deterministic three-card flow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 810 });
    await page.goto(DAILY_YANWU_URL);

    await expect(
      page.getByRole('heading', { level: 1, name: '每天演武' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主要导航' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: '移动导航' })).toHaveCount(0);
    await expect(page.locator('.MuiContainer-root')).toHaveCount(0);
    await expect(page.getByTestId('daily-yanwu-shared-hero')).toHaveCount(1);
    await expect(page.getByTestId('daily-yanwu-empty-hero')).toHaveCount(3);
    await expect(page.getByTestId('daily-yanwu-shared-tactic')).toHaveCount(8);

    for (const removedCopy of [
      '赛程',
      '开赛预告',
      '可抽取抽将',
      '查看规则',
      '赛季排行',
    ]) {
      await expect(page.getByText(removedCopy, { exact: true })).toHaveCount(0);
    }

    const note = page.locator('[data-visual-priority="tertiary"]');
    const entryButton = page.getByRole('button', { name: '抽取初始' });
    await expect(note).toBeVisible();
    const hierarchy = await page.evaluate(() => {
      const noteElement = document.querySelector('[data-visual-priority="tertiary"]');
      const buttonElement = [...document.querySelectorAll('button')].find(
        (button) => button.textContent?.includes('抽取初始'),
      );
      if (!noteElement || !buttonElement) return null;
      const noteStyle = getComputedStyle(noteElement);
      const buttonStyle = getComputedStyle(buttonElement);
      return {
        noteOpacity: Number(noteStyle.opacity),
        noteFontSize: Number.parseFloat(noteStyle.fontSize),
        buttonFontSize: Number.parseFloat(buttonStyle.fontSize),
      };
    });
    expect(hierarchy).not.toBeNull();
    expect(hierarchy.noteOpacity).toBeLessThan(0.8);
    expect(hierarchy.noteFontSize).toBeLessThan(hierarchy.buttonFontSize);

    await entryButton.click();
    const dialog = page.getByRole('dialog', {
      name: '抽取本期个人初始武将',
    });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('daily-yanwu-draw-card')).toHaveCount(3);
    await expect(page.getByLabel(/未揭晓武将卡/)).toHaveCount(3);
    await expect(note).toBeHidden();
    const flipContract = await page
      .locator('.daily-yanwu-draw-card__inner')
      .evaluateAll((cards) =>
        cards.map((card) => ({
          delay: Number.parseFloat(getComputedStyle(card).transitionDelay) * 1000,
          transform: getComputedStyle(card).transform,
          transformStyle: getComputedStyle(card).transformStyle,
          backfaceVisibility: getComputedStyle(card.firstElementChild).backfaceVisibility,
        })),
      );
    expect(flipContract.map(({ delay }) => Math.round(delay))).toEqual([0, 120, 240]);
    expect(flipContract.every(({ transformStyle }) => transformStyle === 'preserve-3d')).toBe(
      true,
    );
    expect(
      flipContract.every(({ backfaceVisibility }) => backfaceVisibility === 'hidden'),
    ).toBe(true);
    const titleBarCoverage = await page
      .locator('.daily-yanwu-draw-card')
      .evaluateAll((cards) =>
        cards.map((card) => {
          const cardRect = card.getBoundingClientRect();
          const caption = card.querySelector('.daily-yanwu-draw-card__caption');
          const captionRect = caption.getBoundingClientRect();
          return {
            coveredBottomRatio: (cardRect.bottom - captionRect.top) / cardRect.height,
            captionBottomInset: cardRect.bottom - captionRect.bottom,
            backgroundColor: getComputedStyle(caption).backgroundColor,
          };
        }),
      );
    expect(
      titleBarCoverage.every(
        ({ coveredBottomRatio, captionBottomInset, backgroundColor }) =>
          coveredBottomRatio >= 0.14 &&
          coveredBottomRatio <= 0.17 &&
          captionBottomInset <= 6 &&
          backgroundColor === 'rgb(53, 32, 15)',
      ),
    ).toBe(true);

    await page.getByRole('button', { name: '抽取', exact: true }).click();
    await expect(page.getByTestId('daily-yanwu-page')).toHaveAttribute(
      'data-phase',
      'flipping',
    );
    await expect(page.getByLabel(/正在揭晓武将卡/)).toHaveCount(3);

    const confirm = page.getByRole('button', { name: '确认' });
    await expect(confirm).toBeVisible({ timeout: 3000 });
    const revealedTransforms = await page
      .locator('.daily-yanwu-draw-card__inner')
      .evaluateAll((cards) => cards.map((card) => getComputedStyle(card).transform));
    expect(new Set(revealedTransforms).size).toBe(1);
    expect(revealedTransforms[0]).not.toBe(flipContract[0].transform);
    for (const hero of REFERENCE_HEROES) {
      await expect(page.getByLabel(`抽取武将：${hero}`)).toBeVisible();
    }

    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('daily-yanwu-empty-hero')).toHaveCount(0);
    await expect(page.getByTestId('daily-yanwu-selected-hero')).toHaveCount(3);
    for (const hero of REFERENCE_HEROES) {
      await expect(page.getByLabel(`已抽取武将：${hero}`)).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  });

  test('supports the basic draw flow entirely from the keyboard', async ({ page }) => {
    await page.goto(DAILY_YANWU_URL);

    const entryButton = page.getByRole('button', { name: '抽取初始' });
    await expect(entryButton).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(entryButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: '抽取', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');

    const confirm = page.getByRole('button', { name: '确认' });
    await expect(confirm).toBeFocused({ timeout: 3000 });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('daily-yanwu-selected-hero')).toHaveCount(3);
    await expect(page.getByRole('button', { name: '重新抽取' })).toBeFocused();
  });

  test('reduced motion reveals immediately without disabling the result', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(DAILY_YANWU_URL);
    await page.getByRole('button', { name: '抽取初始' }).click();
    await page.getByRole('button', { name: '抽取', exact: true }).click();

    await expect(page.getByRole('button', { name: '确认' })).toBeVisible({
      timeout: 1000,
    });
    const transitionDuration = await page
      .locator('.daily-yanwu-draw-card__inner')
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(transitionDuration.split(',').every((value) => value.trim() === '0s')).toBe(
      true,
    );
    for (const hero of REFERENCE_HEROES) {
      await expect(page.getByLabel(`抽取武将：${hero}`)).toBeVisible();
    }
  });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 810 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`${viewport.name} entry and draw overlay do not overflow horizontally`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(DAILY_YANWU_URL);
      await expect(page.getByRole('button', { name: '抽取初始' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: '抽取初始' }).click();
      await expect(
        page.getByRole('dialog', { name: '抽取本期个人初始武将' }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
});
