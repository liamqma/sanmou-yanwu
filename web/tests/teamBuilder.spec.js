const { test, expect } = require('@playwright/test');
const { seedGame, makeGameState } = require('./helpers');

const HEROES = ['刘备', '关羽', '张飞', '诸葛亮', '赵云', '马超', '曹操', '司马懿', '夏侯惇', '孙权', '周瑜', '陆逊', '吕布', '张辽', '貂蝉'];
const SKILLS = [
  '乐不思蜀', '暗渡阴平', '恩威并行', '未雨绸缪', '诱敌深入', '风助火势', '瞋目横矛', '掠阵破军',
  '及锋而试', '调和阴阳', '蹈锋饮血', '践墨随敌', '机变无穷', '潜龙在渊', '御敌临前', '虎步连环',
  '神略制变', '惩前毖后', '万军辟易', '谋而后动', '黄天惑心', '断戈夺锋', '空城计', '步步为营',
  '智破千军', '挫锐折锋', '运智铺谋', '十面埋伏',
];

const seedFullPool = (page) =>
  seedGame(page, makeGameState({ roundNumber: 10, heroes: HEROES, skills: SKILLS }), {
    set1: [],
    set2: [],
    set3: [],
  });

const placedHeroCards = (page) => page.locator('[data-testid^="team-slot-card-hero-"]');

async function firstPlacedHero(page) {
  const testId = await placedHeroCards(page).first().getAttribute('data-testid');
  return testId.replace('team-slot-card-hero-', '');
}

test.describe('team builder', () => {
  test('allocates the roster into three teams and greys out placed cards', async ({ page }) => {
    await seedFullPool(page);
    const builder = page.getByRole('region', { name: '队伍编排' });
    await expect(builder).toBeVisible();
    await expect(placedHeroCards(page)).toHaveCount(9);
    await expect(page.locator('[data-testid^="team-slot-card-tactic-"]')).toHaveCount(18);
    await expect(builder.getByText('自动分配')).toBeVisible();
    await expect(builder.getByTestId('team-builder-two-of-three')).toContainText('三局两胜');
    await expect(builder.getByTestId('team-builder-team-1')).toContainText('胜率');

    const hero = await firstPlacedHero(page);
    const roster = page.getByRole('region', { name: '当前阵容' });
    await expect(roster.getByTestId(`game-card-hero-${hero}`)).toHaveCSS('opacity', '0.48');
  });

  test('manual edits switch to manual mode, survive a reload, and can be undone', async ({ page }) => {
    await seedFullPool(page);
    const builder = page.getByRole('region', { name: '队伍编排' });
    await expect(placedHeroCards(page)).toHaveCount(9);
    const hero = await firstPlacedHero(page);

    await builder.getByRole('button', { name: `队伍一第1位武将：${hero}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: '移回当前阵容' }).click();
    await expect(placedHeroCards(page)).toHaveCount(8);
    await expect(builder.getByText('已手动调整')).toBeVisible();
    const roster = page.getByRole('region', { name: '当前阵容' });
    await expect(roster.getByTestId(`game-card-hero-${hero}`)).toHaveCSS('opacity', '1');

    await page.reload();
    await expect(placedHeroCards(page)).toHaveCount(8);
    await expect(builder.getByText('已手动调整')).toBeVisible();

    await builder.getByRole('button', { name: '队伍一第1位武将：空' }).click();
    await page.getByRole('dialog').getByRole('button', { name: `选择${hero}` }).click();
    await expect(placedHeroCards(page)).toHaveCount(9);

    await builder.getByRole('button', { name: '恢复自动分配' }).click();
    await expect(builder.getByText('自动分配')).toBeVisible();
    await expect(builder.getByRole('button', { name: '恢复自动分配' })).toHaveCount(0);
  });

  test('drags a card from 当前阵容 into an empty slot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedFullPool(page);
    const builder = page.getByRole('region', { name: '队伍编排' });
    await expect(placedHeroCards(page)).toHaveCount(9);
    const hero = await firstPlacedHero(page);
    await builder.getByRole('button', { name: `队伍一第1位武将：${hero}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: '移回当前阵容' }).click();
    await expect(placedHeroCards(page)).toHaveCount(8);

    const source = page.getByRole('region', { name: '当前阵容' }).getByTestId(`game-card-hero-${hero}`);
    const target = builder.getByRole('button', { name: '队伍一第1位武将：空' });
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    await target.scrollIntoViewIfNeeded();
    const to = await target.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect(builder.getByRole('button', { name: `队伍一第1位武将：${hero}` })).toBeVisible();
  });

  test('uses the slot picker on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedFullPool(page);
    const builder = page.getByRole('region', { name: '队伍编排' });
    await expect(placedHeroCards(page)).toHaveCount(9);
    const hero = await firstPlacedHero(page);
    await builder.getByRole('button', { name: `队伍一第1位武将：${hero}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: '移回当前阵容' }).click();
    await builder.getByRole('button', { name: '队伍一第1位武将：空' }).click();
    await page.getByRole('dialog').getByRole('button', { name: `选择${hero}` }).click();
    await expect(builder.getByRole('button', { name: `队伍一第1位武将：${hero}` })).toBeVisible();
  });
});
