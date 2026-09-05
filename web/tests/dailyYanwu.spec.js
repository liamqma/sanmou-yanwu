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

  test('uses one centered 1280×720 artboard and preserves normalized geometry', async ({
    page,
  }) => {
    const cases = [
      {
        name: 'desktop',
        viewport: { width: 1440, height: 810 },
        frame: { x: 80, y: 45, width: 1280, height: 720 },
      },
      {
        name: 'tablet',
        viewport: { width: 1024, height: 768 },
        frame: { x: 0, y: 96, width: 1024, height: 576 },
      },
      {
        name: 'phone landscape',
        viewport: { width: 844, height: 390 },
        frame: { x: 75.33, y: 0, width: 693.33, height: 390 },
      },
      {
        name: 'portrait letterbox',
        viewport: { width: 390, height: 844 },
        frame: { x: 0, y: 312.31, width: 390, height: 219.38 },
      },
    ];
    const geometrySelectors = {
      stage: '[data-testid="daily-yanwu-stage"]',
      title: '[data-testid="daily-yanwu-arena-title"]',
      selection: '.daily-yanwu__selection',
      heroGrid: '.daily-yanwu__hero-grid',
      tacticGrid: '.daily-yanwu__tactic-grid',
      entryButton: '.daily-yanwu-button--entry',
    };
    let desktopGeometry;

    for (const current of cases) {
      await page.setViewportSize(current.viewport);
      await page.goto(DAILY_YANWU_URL);
      await expect(page.getByRole('button', { name: '抽取初始' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const frame = await page.getByTestId('daily-yanwu-frame').boundingBox();
      expect(frame, `${current.name} frame`).not.toBeNull();
      for (const key of ['x', 'y', 'width', 'height']) {
        expect(frame[key], `${current.name} frame ${key}`).toBeCloseTo(
          current.frame[key],
          0,
        );
      }
      // Subpixel device-pixel rounding can move the measured ratio by ~0.00006.
      expect(frame.width / frame.height).toBeCloseTo(16 / 9, 3);
      expect(frame.width).toBeLessThanOrEqual(1280);
      expect(frame.height).toBeLessThanOrEqual(720);

      const geometry = await page.evaluate((selectors) => {
        const frameElement = document.querySelector('[data-testid="daily-yanwu-frame"]');
        const frameRect = frameElement.getBoundingClientRect();
        return Object.fromEntries(
          Object.entries(selectors).map(([key, selector]) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return [key, {
              x: (rect.x - frameRect.x) / frameRect.width,
              y: (rect.y - frameRect.y) / frameRect.height,
              width: rect.width / frameRect.width,
              height: rect.height / frameRect.height,
            }];
          }),
        );
      }, geometrySelectors);

      if (!desktopGeometry) desktopGeometry = geometry;
      else {
        for (const key of Object.keys(geometrySelectors)) {
          for (const dimension of ['x', 'y', 'width', 'height']) {
            expect(
              geometry[key][dimension],
              `${current.name} ${key} normalized ${dimension}`,
            ).toBeCloseTo(desktopGeometry[key][dimension], 3);
          }
        }
      }
    }
  });

  test('binds the title to the stage center and crops the 战八方 title strip', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 810 });
    await page.goto(DAILY_YANWU_URL);

    const [stage, title, heroCard, tacticCard] = await Promise.all([
      page.getByTestId('daily-yanwu-stage').boundingBox(),
      page.getByTestId('daily-yanwu-arena-title').boundingBox(),
      page.getByTestId('daily-yanwu-shared-hero').boundingBox(),
      page.getByTestId('daily-yanwu-shared-tactic').first().boundingBox(),
    ]);
    expect(stage).not.toBeNull();
    expect(title).not.toBeNull();
    const titleCenterError = Math.abs(
      title.x + title.width / 2 - (stage.x + stage.width / 2),
    );
    expect(titleCenterError).toBeLessThanOrEqual(4);
    expect(heroCard.width).toBeCloseTo(58, 0);
    expect(tacticCard.width).toBeCloseTo(62, 0);

    const source = page.getByTestId('daily-yanwu-scene-source');
    await expect(source).toHaveAttribute(
      'src',
      '/game-assets/tactics/zhan_ba_fang.png',
    );
    const sourceCrop = await page.evaluate(() => {
      const crop = document.querySelector('[data-testid="daily-yanwu-scene-crop"]');
      const image = document.querySelector('[data-testid="daily-yanwu-scene-source"]');
      const cropRect = crop.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      return {
        visibleBottomRatio: (cropRect.bottom - imageRect.top) / imageRect.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
    });
    expect(sourceCrop).toEqual(
      expect.objectContaining({ naturalWidth: 160, naturalHeight: 248 }),
    );
    expect(sourceCrop.visibleBottomRatio).toBeLessThan(0.87);

    await page.getByRole('button', { name: '抽取初始' }).click();
    const [veil, frame] = await Promise.all([
      page.locator('.daily-yanwu__veil').boundingBox(),
      page.getByTestId('daily-yanwu-frame').boundingBox(),
    ]);
    expect(veil).not.toBeNull();
    expect(frame).not.toBeNull();
    for (const key of ['x', 'y', 'width', 'height']) {
      expect(veil[key], `veil ${key}`).toBeCloseTo(frame[key], 1);
    }
  });
});
