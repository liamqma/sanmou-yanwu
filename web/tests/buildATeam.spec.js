const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');
const { seedStoredProgress } = require('./helpers');

const heroNames = Object.keys(database.heroes || {}).sort();
const signatureSkills = new Set(
  Object.values(database.heroes || {}).map((hero) => hero.skill).filter(Boolean)
);
const regularSkills = Object.keys(database.skills || {})
  .filter((skill) => !signatureSkills.has(skill))
  .sort();

const smallHeroes = heroNames.slice(0, 3);
const smallSkills = regularSkills.slice(0, 4);
const supportHero = heroNames[3];
const supportSkill = regularSkills[4];
const completeHeroes = heroNames.slice(0, 9);
const completeSkills = regularSkills.slice(0, 18);

const progressFor = ({
  heroes,
  skills,
  supportHero: selectedSupportHero = null,
  supportSkills = [],
}) => ({
  gameState: {
    current_heroes: heroes,
    current_skills: skills,
    support_hero: selectedSupportHero,
    support_skills: supportSkills,
    round_number: 1,
    round_history: [],
  },
  currentRoundInputs: { set1: [], set2: [], set3: [] },
});

const smallPoolProgress = progressFor({
  heroes: smallHeroes,
  skills: smallSkills,
  supportHero,
  supportSkills: [supportSkill],
});

const completePoolProgress = progressFor({
  heroes: completeHeroes,
  skills: completeSkills,
});

async function openBuilder(page) {
  await page.goto('/team-builder');
  await expect(
    page.getByRole('heading', { level: 1, name: '队伍策案' })
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole('heading', { name: '我的比赛阵容' })
  ).toBeVisible({ timeout: 30000 });
}

test.describe('Team Builder fresh entry', () => {
  test('requires a valid game roster before enabling pool edits', async ({
    page,
  }) => {
    await openBuilder(page);
    await page.getByRole('button', { name: /调整参赛卡池/ }).click();

    await expect(
      page.getByText('请先创建对局卡池，再回来编排三支队伍。')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑队伍' })).toHaveCount(0);
  });
});

test.describe('Team Builder manual workshop', () => {
  test.beforeEach(async ({ page, context }) => {
    await seedStoredProgress(page, smallPoolProgress);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('shows the current roster and support items in the repositories', async ({
    page,
  }) => {
    await openBuilder(page);

    for (const hero of smallHeroes) {
      await expect(page.getByTestId(`pool-hero-${hero}`)).toBeVisible();
    }
    for (const skill of smallSkills) {
      await expect(page.getByTestId(`pool-skill-${skill}`)).toBeVisible();
    }

    await expect(page.getByTestId(`pool-hero-${supportHero}`)).toContainText(
      '支援'
    );
    await expect(page.getByTestId(`pool-skill-${supportSkill}`)).toContainText(
      '支援'
    );
  });

  test('tap-to-place builds, reviews, and persists an edited lineup', async ({
    page,
  }) => {
    await openBuilder(page);

    await page.getByTestId(`pool-hero-${smallHeroes[0]}`).click();
    await expect(page.getByText(`已选择：${smallHeroes[0]}`)).toBeVisible();
    await page.getByTestId('hero-slot-0-0').click();
    await page.getByTestId(`pool-skill-${smallSkills[0]}`).click();
    await page.getByTestId('skill-slot-0-0-0').click();
    await page.getByTestId(`pool-skill-${smallSkills[1]}`).click();
    await page.getByTestId('skill-slot-0-0-1').click();

    const heroSlot = page.getByTestId('hero-slot-0-0');
    await expect(heroSlot).toContainText(smallHeroes[0]);
    await expect(page.getByTestId('skill-slot-0-0-0')).toContainText(
      smallSkills[0]
    );
    await expect(page.getByTestId('skill-slot-0-0-1')).toContainText(
      smallSkills[1]
    );

    await page.getByRole('combobox', { name: '阵型' }).first().click();
    await page.getByRole('option', { name: '锥形阵' }).click();
    await page
      .getByRole('button', { name: `${smallHeroes[0]} 后排` })
      .click();

    await page
      .getByRole('button', { name: '生成强度复盘提示词' })
      .click();
    await expect(page.getByText('强度复盘提示词已复制')).toBeVisible();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain('精确的已编辑阵容');
    expect(prompt).toContain('队伍1');
    expect(prompt).toContain('阵型：锥形阵');
    expect(prompt).toContain(`${smallHeroes[0]}｜站位：后排`);
    expect(prompt).toContain(`额外战法：${smallSkills[0]}、${smallSkills[1]}`);
    expect(prompt).toMatch(
      /\/game-data\/database\.json\?v=\d{4}-\d{2}-\d{2}/
    );
    expect(prompt).toContain('/game-data/formula.md');

    await page.reload();
    await expect(
      page.getByRole('heading', { name: '我的比赛阵容' })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      smallHeroes[0]
    );
    await expect(page.getByTestId('formation-select-0')).toHaveValue('锥形阵');
    await expect(
      page.getByRole('button', { name: `${smallHeroes[0]} 后排` })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('pointer drag works and removing a hero returns its whole card to the pool', async ({
    page,
  }) => {
    await openBuilder(page);

    await page
      .getByRole('button', { name: `拖动武将 ${smallHeroes[0]}` })
      .dragTo(page.getByTestId('hero-slot-0-0'));
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      smallHeroes[0]
    );

    await page.getByTestId(`pool-skill-${smallSkills[0]}`).click();
    await page.getByTestId('skill-slot-0-0-0').click();
    await page.getByLabel(`移除武将 ${smallHeroes[0]}`).click();

    await expect(page.getByTestId(`pool-hero-${smallHeroes[0]}`)).toBeVisible();
    await expect(page.getByTestId(`pool-skill-${smallSkills[0]}`)).toBeVisible();
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      '拖入或点选武将'
    );
  });

  test('moving a hero to an empty slot leaves its tactics editable in place', async ({
    page,
  }) => {
    await openBuilder(page);

    await page.getByTestId(`pool-hero-${smallHeroes[0]}`).click();
    await page.getByTestId('hero-slot-0-0').click();
    await page.getByTestId(`pool-skill-${smallSkills[0]}`).click();
    await page.getByTestId('skill-slot-0-0-0').click();
    await expect(page.getByTestId('skill-slot-0-0-0')).toContainText(
      smallSkills[0]
    );

    await page.getByTestId('hero-slot-0-0').click();
    await page.getByTestId('hero-slot-0-1').click();

    await expect(page.getByTestId('hero-slot-0-1')).toContainText(
      smallHeroes[0]
    );
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      '拖入或点选武将'
    );
    await expect(page.getByTestId('skill-slot-0-0-0')).toContainText(
      smallSkills[0]
    );

    await page.getByTestId(`pool-skill-${smallSkills[1]}`).click();
    await page.getByTestId('skill-slot-0-0-0').click();
    await expect(page.getByTestId('skill-slot-0-0-0')).toContainText(
      smallSkills[1]
    );
    await expect(page.getByTestId(`pool-skill-${smallSkills[0]}`)).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('heading', { name: '我的比赛阵容' })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('hero-slot-0-1')).toContainText(
      smallHeroes[0]
    );
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      '拖入或点选武将'
    );
    await expect(page.getByTestId('skill-slot-0-0-0')).toContainText(
      smallSkills[1]
    );

    await page.getByRole('button', { name: `移除战法 ${smallSkills[1]}` }).click();
    await expect(page.getByTestId(`pool-skill-${smallSkills[1]}`)).toBeVisible();
    await expect(page.getByTestId('skill-slot-0-0-0')).toContainText(
      `战法 1`
    );
  });

  test('marks WeChat sharing in Chinese and copies a concise fallback', async ({
    page,
  }) => {
    await openBuilder(page);
    await page.getByTestId(`pool-hero-${smallHeroes[0]}`).click();
    await page.getByTestId('hero-slot-0-0').click();

    const shareButton = page.getByRole('button', {
      name: /分享给微信好友.*开发中/,
    });
    await expect(shareButton).toBeVisible();
    await shareButton.click();
    await expect(
      page.getByText(/阵容已复制，请打开微信粘贴分享/)
    ).toBeVisible();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).toContain('三国谋定天下三队阵容');
    expect(shared).toContain(smallHeroes[0]);
    expect(shared).not.toContain('/game-data/');
  });

  test('supports keyboard placement, warehouse return, and selection reset', async ({
    page,
  }) => {
    await openBuilder(page);

    await page
      .getByRole('button', { name: `选择武将 ${smallHeroes[0]}` })
      .press('Enter');
    await page.getByTestId('hero-slot-0-0').press('Enter');
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      smallHeroes[0]
    );

    await page.getByTestId('hero-slot-0-0').press('Enter');
    await page
      .getByRole('button', { name: '放回武将仓库' })
      .press('Enter');
    await expect(page.getByTestId(`pool-hero-${smallHeroes[0]}`)).toBeVisible();

    await page
      .getByRole('button', { name: `选择武将 ${smallHeroes[0]}` })
      .press('Enter');
    await page.getByTestId('hero-slot-0-0').press('Enter');
    await page.getByTestId('hero-slot-0-0').press('Enter');
    await expect(page.getByText(`已选择：${smallHeroes[0]}`)).toBeVisible();
    await page.getByRole('button', { name: '清空编排' }).click();
    await expect(page.getByText(`已选择：${smallHeroes[0]}`)).toHaveCount(0);
  });
});

test.describe('Team Builder best default', () => {
  test.beforeEach(async ({ page }) => {
    await seedStoredProgress(page, completePoolProgress);
  });

  test('complete pool paints loading without an insufficient warning flash', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const flags = { warningSeen: false, loadingSeen: false };
      window.__teamBuilderFlashFlags = flags;
      const scan = () => {
        const text = document.body ? document.body.innerText : '';
        if (text.includes('不足以推荐完整的编排')) flags.warningSeen = true;
        if (text.includes('正在优化')) flags.loadingSeen = true;
      };
      const start = () => {
        scan();
        new MutationObserver(scan).observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      };
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start);
    });

    await openBuilder(page);
    const flags = await page.evaluate(() => window.__teamBuilderFlashFlags);
    expect(flags.loadingSeen).toBe(true);
    expect(flags.warningSeen).toBe(false);
  });

  test('seeds exactly one best editable three-team formation', async ({
    page,
  }) => {
    await openBuilder(page);

    await expect(page.getByText('最佳推荐', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /^队伍 [123]$/ })
    ).toHaveCount(3);
    await expect(page.getByTestId('team-strength')).toHaveCount(3);
    await expect(page.locator('[data-testid^="hero-slot-"]')).toHaveCount(9);
    await expect(page.locator('[data-testid^="skill-slot-"]')).toHaveCount(18);
    await expect(
      page.getByRole('button', { name: '方案一（推荐）' })
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: '方案二' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '方案三' })).toHaveCount(0);

    for (const hero of completeHeroes) {
      await expect(
        page
          .getByRole('region', { name: /队伍 [123] 武将配置/ })
          .getByText(hero, { exact: true })
      ).toHaveCount(1);
    }

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('总评分');
    expect(body).not.toContain('胜率');
    expect(body).toContain('加分');
    expect(body).toContain('参考');
  });
});

test.describe('Team Builder mobile placement', () => {
  test.use({ viewport: { width: 320, height: 844 }, hasTouch: true });

  test('keeps actions and tap destinations usable without page overflow', async ({
    page,
  }) => {
    await seedStoredProgress(page, smallPoolProgress);
    await openBuilder(page);

    await page.getByTestId(`pool-hero-${smallHeroes[0]}`).tap();
    await page.getByTestId('hero-slot-0-0').tap();
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      smallHeroes[0]
    );
    await page.getByTestId(`pool-skill-${smallSkills[0]}`).tap();
    await page.getByTestId('skill-slot-0-0-0').tap();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);

    const slotBox = await page.getByTestId('hero-slot-0-0').boundingBox();
    expect(slotBox).not.toBeNull();
    expect(slotBox.height).toBeGreaterThanOrEqual(44);

    for (const target of [
      page.getByRole('button', { name: `拖动武将 ${smallHeroes[0]}` }),
      page.getByRole('button', { name: `移除武将 ${smallHeroes[0]}` }),
      page.getByRole('button', { name: `${smallHeroes[0]} 后排` }),
      page.getByTestId('skill-slot-0-0-0'),
      page.getByRole('button', { name: `拖动战法 ${smallSkills[0]}` }),
      page.getByRole('button', { name: `移除战法 ${smallSkills[0]}` }),
    ]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }

    await expect(
      page.getByRole('button', { name: '生成强度复盘提示词' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /分享给微信好友.*开发中/ })
    ).toBeVisible();
  });
});
