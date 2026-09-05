const { test, expect } = require('@playwright/test');

const REFERENCE_HEROES = ['黄盖', '张宝', '李儒'];

const rectanglesOverlap = (first, second) =>
  first.x < second.x + second.width &&
  first.x + first.width > second.x &&
  first.y < second.y + second.height &&
  first.y + first.height > second.y;

test.describe('production daily Yanwu', () => {
  test('ignores the development fixture and draws unique random heroes', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__dailyYanwuRandomCalls = 0;
      Math.random = () => {
        window.__dailyYanwuRandomCalls += 1;
        return 0;
      };
    });
    await page.goto('/daily-yanwu?dailyYanwuFixture=reference');

    const callsBeforeDraw = await page.evaluate(
      () => window.__dailyYanwuRandomCalls,
    );
    await page.getByRole('button', { name: '抽取初始' }).click();
    const callsAfterDraw = await page.evaluate(
      () => window.__dailyYanwuRandomCalls,
    );
    expect(callsAfterDraw).toBeGreaterThan(callsBeforeDraw);

    await page.getByRole('button', { name: '抽取', exact: true }).click();
    const confirmButton = page.getByRole('button', { name: '确认' });
    await expect(confirmButton).toBeVisible({ timeout: 1000 });
    const drawnHeroes = await page
      .locator('[aria-label^="抽取武将："]')
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute('aria-label').replace('抽取武将：', '')),
      );
    expect(drawnHeroes).toHaveLength(3);
    expect(new Set(drawnHeroes).size).toBe(3);
    expect(drawnHeroes).not.toContain('孙坚');
    expect(drawnHeroes).not.toEqual(REFERENCE_HEROES);

    await confirmButton.click();
    const callsBeforeRedraw = await page.evaluate(
      () => window.__dailyYanwuRandomCalls,
    );
    await page.getByRole('button', { name: '重新抽取' }).click();
    const callsAfterRedraw = await page.evaluate(
      () => window.__dailyYanwuRandomCalls,
    );
    expect(callsAfterRedraw).toBeGreaterThan(callsBeforeRedraw);
  });

  test('keeps explanatory copy readable in phone landscape', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/daily-yanwu');

    const notice = page.getByTestId('daily-yanwu-development-notice');
    const badge = notice.locator('.daily-yanwu__development-badge');
    const availability = notice.locator('span');
    const creatorNote = page.getByTestId('daily-yanwu-creator-note');
    await expect(notice).toBeVisible();
    await expect(creatorNote).toBeVisible();

    const fontSizes = await Promise.all(
      [badge, availability, creatorNote].map((locator) =>
        locator.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      ),
    );
    for (const fontSize of fontSizes) {
      expect(fontSize).toBeGreaterThanOrEqual(12);
    }

    const [creatorBox, noticeBox, selectionBox, buttonBox, titleBox] =
      await Promise.all([
        creatorNote.boundingBox(),
        notice.boundingBox(),
        page.locator('.daily-yanwu__selection').boundingBox(),
        page.getByRole('button', { name: '抽取初始' }).boundingBox(),
        page.getByTestId('daily-yanwu-arena-title').boundingBox(),
      ]);
    for (const box of [
      creatorBox,
      noticeBox,
      selectionBox,
      buttonBox,
      titleBox,
    ]) {
      expect(box).not.toBeNull();
    }
    for (const explanationBox of [creatorBox, noticeBox]) {
      for (const coreBox of [selectionBox, buttonBox, titleBox]) {
        expect(rectanglesOverlap(explanationBox, coreBox)).toBe(false);
      }
    }
    expect(rectanglesOverlap(creatorBox, noticeBox)).toBe(false);

    await page.screenshot({
      path: testInfo.outputPath('phone-landscape-beta-copy.png'),
      fullPage: false,
    });
  });
});
