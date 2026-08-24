const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');
const { seedStoredProgress } = require('./helpers');

const heroNames = Object.keys(database.heroes || {}).sort();
const heroSkills = new Set(
  [
    ...Object.values(database.heroes || {}).map((hero) => hero.skill).filter(Boolean),
    ...Object.entries(database.skills || {})
      .filter(([, skill]) => skill.shadow === true)
      .map(([name]) => name),
  ]
);
const regularSkills = Object.keys(database.skills || {})
  .filter((skill) => !heroSkills.has(skill))
  .sort();

const smallHeroes = heroNames.slice(0, 3);
const smallSkills = regularSkills.slice(0, 4);
const supportHero = heroNames[3];
const supportSkill = regularSkills[4];
const completeTeamIds = [
  'yanwu-司马懿-曹操-曹丕-73954cef88c92b17',
  'yanwu-袁术-皇甫嵩2-孙坚2-5a51cfe3cf60e395',
  'yanwu-祝融-孟获-诸葛亮2-f6d9988bcd6821cb',
];
const completeTeamComps = completeTeamIds.map((id) => {
  const comp = database.team.find((team) => team.id === id);
  if (!comp) throw new Error(`Missing Team Builder fixture ${id}`);
  return comp;
});
const completeHeroes = completeTeamComps.flatMap((team) =>
  team.members.map(({ hero }) => hero)
);
const completeSkills = completeTeamComps.flatMap((team) =>
  team.members.flatMap(({ skillSlots }) =>
    skillSlots.map((alternatives) => alternatives[0])
  )
);
if (
  new Set(completeHeroes).size !== 9 ||
  new Set(completeSkills).size !== 18
) {
  throw new Error('Team Builder fixture must contain 9 heroes and 18 unique skills');
}

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

const crowdedHeroPoolProgress = progressFor({
  heroes: heroNames.slice(0, 12),
  skills: smallSkills,
});

const completePoolProgress = progressFor({
  heroes: completeHeroes,
  skills: completeSkills,
});

const overflowHeroes = [
  ...completeHeroes,
  ...heroNames.filter((hero) => !completeHeroes.includes(hero)).slice(0, 8),
];
const overflowSkills = [
  ...completeSkills,
  ...regularSkills
    .filter((skill) => !completeSkills.includes(skill))
    .slice(0, 10),
];
const overflowPoolProgress = progressFor({
  heroes: overflowHeroes,
  skills: overflowSkills,
});
const relationshipHeroes = ['张昭', '陆逊', '黄盖', '曹操'];
const relationshipSkills = ['烈火张天', '风助火势'];
const relationshipPoolProgress = progressFor({
  heroes: relationshipHeroes,
  skills: relationshipSkills,
});

const emptyStoredTeam = () => ({
  formation: '',
  heroes: Array.from({ length: 3 }, () => ({
    hero: null,
    row: '前排',
    skills: [null, null],
  })),
});

const relationshipLayout = ({
  thirdHero = '黄盖',
  fireAssigned = true,
} = {}) => {
  const layout = [emptyStoredTeam(), emptyStoredTeam(), emptyStoredTeam()];
  layout[0].heroes[0].hero = '张昭';
  layout[0].heroes[0].skills[0] = fireAssigned ? '烈火张天' : null;
  layout[0].heroes[1].hero = '陆逊';
  layout[0].heroes[2].hero = thirdHero;
  return layout;
};

async function seedTeamBuilderLayout(page, layout) {
  const poolKey = JSON.stringify({
    heroes: [...relationshipHeroes].sort(),
    skills: [...relationshipSkills].sort(),
  });
  await page.addInitScript(
    ({ poolKey: key, layout: storedLayout }) => {
      localStorage.setItem(
        'teamBuilder',
        JSON.stringify({ version: 2, poolKey: key, layout: storedLayout }),
      );
    },
    { poolKey, layout },
  );
}

async function startPointerDrag(page, source) {
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();
  const x = sourceBox.x + sourceBox.width / 2;
  const y = sourceBox.y + sourceBox.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y, { steps: 3 });
  await expect(page.locator('[data-dnd-dragging="true"]')).toBeAttached();
}

async function movePointerTo(page, target) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 12,
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
}

async function openBuilder(page) {
  await page.goto('/team-builder');
  await expect(
    page.getByRole('heading', { level: 1, name: '队伍策案' })
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole('heading', { name: '我的比赛阵容' })
  ).toBeVisible({ timeout: 30000 });
}

async function dragWholeBlock(page, source, target) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const dragging = page.locator('[data-dnd-dragging="true"]');
  let dragStarted = false;

  // A previous dnd-kit drop can finish rendering before its shared pointer
  // manager releases. Under parallel browser load, a pointer-down in that
  // short window is ignored permanently, so retry the complete gesture rather
  // than extending a wall-clock sleep and waiting on an event that was lost.
  for (let attempt = 0; attempt < 3 && !dragStarted; attempt += 1) {
    const sourceBox = await source.boundingBox();
    expect(sourceBox).not.toBeNull();
    const sourceX = sourceBox.x + sourceBox.width / 2;
    const sourceY = sourceBox.y + sourceBox.height / 2;
    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down();
    // Cross dnd-kit's 5px mouse threshold before its 10px movement
    // tolerance, matching a normal progressive pointer gesture.
    await page.mouse.move(sourceX + 6, sourceY, { steps: 3 });
    dragStarted = await dragging
      .waitFor({ state: 'attached', timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    if (!dragStarted) {
      await page.mouse.up();
      await expect(dragging).toHaveCount(0);
      await page.waitForTimeout(300);
    }
  }
  expect(dragStarted).toBe(true);

  // A failed attempt can trigger the tap-selection fallback and shift the
  // layout, so resolve the target position only after dragging is observable.
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;
  await page.mouse.move(targetX, targetY, { steps: 12 });
  // Pointer coordinates are applied on an animation frame. Releasing first can
  // drop at the previous position when parallel workers delay that frame.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  );
  await page.mouse.up();
  // Let the overlay's short drop animation release the shared drag manager
  // before a caller starts a second gesture.
  await page.waitForTimeout(300);
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
      const poolSkill = page.getByTestId(`pool-skill-${skill}`);
      await expect(poolSkill).toBeVisible();
      await expect(
        poolSkill.getByText(database.skills[skill].type, { exact: true })
      ).toHaveCount(0);
    }

    const firstPoolHero = page.getByTestId(`pool-hero-${smallHeroes[0]}`);
    await expect(firstPoolHero).toContainText(smallHeroes[0]);
    await expect(
      page.getByTestId(`pool-hero-camp-${smallHeroes[0]}`)
    ).toHaveText(database.heroes[smallHeroes[0]].camp);
    await expect(firstPoolHero).toContainText(
      `${database.heroes[smallHeroes[0]].ranking}档`
    );
    await expect(page.getByTestId(`pool-hero-${supportHero}`)).toContainText(
      '支援'
    );
    await expect(page.getByTestId(`pool-skill-${supportSkill}`)).toContainText(
      '支援'
    );
    await expect(page.getByText(/\d+ 个可用/)).toHaveCount(0);
    const campColors = await Promise.all(
      smallHeroes.slice(0, 2).map((hero) =>
        page
          .getByTestId(`pool-hero-${hero}`)
          .evaluate((element) => getComputedStyle(element).backgroundColor)
      )
    );
    expect(campColors[0]).not.toBe(campColors[1]);

    const workbench = page.getByRole('region', {
      name: '我的比赛阵容',
    });
    const actions = workbench.getByRole('group', { name: '阵容操作' });
    await expect(
      actions.getByRole('button', { name: '生成强度复盘提示词' })
    ).toBeVisible();
    await expect(
      actions.getByRole('button', { name: /微信好友配将.*开发中/ })
    ).toBeVisible();

    await actions
      .getByRole('button', { name: '了解强度复盘提示词' })
      .click();
    const explainer = page.getByRole('dialog', {
      name: '强度复盘提示词是什么？',
    });
    await expect(explainer).toBeVisible();
    await expect(
      page.getByText('强度复盘提示词是什么？', { exact: true })
    ).toBeVisible();
    await expect(explainer).toContainText(/检查配置是否合理/);
    await expect(explainer).toContainText(/当前卡池内可执行的改进建议/);
    await expect(explainer).not.toContainText('database.json');
    await expect(explainer).not.toContainText('formula.md');
    await expect(explainer).toContainText(/评分是相对阵容强度，不代表胜率/);
    await expect(explainer).toContainText(/不会上传阵容/);
    await page.keyboard.press('Escape');
    await expect(explainer).not.toBeVisible();
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
    const campSeal = page.getByTestId('hero-camp-0-0');
    await expect(campSeal).toHaveText(
      database.heroes[smallHeroes[0]].camp
    );
    const campSealBox = await campSeal.boundingBox();
    expect(campSealBox).not.toBeNull();
    expect(campSealBox.width).toBe(28);
    expect(campSealBox.height).toBe(28);
    await expect(
      page.getByText(`自带 · ${database.heroes[smallHeroes[0]].skill}`, {
        exact: true,
      })
    ).toHaveCount(0);
    await expect(
      page.getByText(
        `${database.heroes[smallHeroes[0]].troop} · ${
          database.heroes[smallHeroes[0]].ranking || '武将'
        }`,
        { exact: true }
      )
    ).toHaveCount(0);
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
    const analyticsEvents = await page.evaluate(() =>
      (window.dataLayer || [])
        .filter((entry) => entry?.[0] === 'event')
        .map((entry) => [entry[0], entry[1], entry.length])
    );
    expect(analyticsEvents).toContainEqual([
      'event',
      'copy_team_strength_review_prompt',
      2,
    ]);
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
    await expect(page.getByText('已恢复保存', { exact: true })).toHaveCount(0);
  });

  test('whole hero and skill blocks drag, while removal returns the whole hero card to the pool', async ({
    page,
  }) => {
    await openBuilder(page);

    await dragWholeBlock(
      page,
      page.getByRole('button', { name: `选择武将 ${smallHeroes[0]}` }),
      page.getByTestId('hero-slot-0-0')
    );
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      smallHeroes[0]
    );

    await dragWholeBlock(
      page,
      page.getByRole('button', { name: `选择战法 ${smallSkills[0]}` }),
      page.getByTestId('skill-slot-0-0-0')
    );
    await expect(page.getByTestId('skill-slot-0-0-0')).toContainText(
      smallSkills[0]
    );
    await dragWholeBlock(
      page,
      page.getByTestId('skill-slot-0-0-0'),
      page.getByTestId('skill-slot-0-0-1')
    );
    await expect(page.getByTestId('skill-slot-0-0-1')).toContainText(
      smallSkills[0]
    );
    await dragWholeBlock(
      page,
      page.getByTestId('hero-slot-0-0'),
      page.getByTestId('hero-slot-0-1')
    );
    await expect(page.getByTestId('hero-slot-0-1')).toContainText(
      smallHeroes[0]
    );
    await expect(page.getByTestId('skill-slot-0-0-1')).toContainText(
      smallSkills[0]
    );
    await expect(
      page.getByRole('button', { name: /拖动(?:武将|战法)/ })
    ).toHaveCount(0);

    await page.getByLabel(`移除战法 ${smallSkills[0]}`).click();
    await page.getByLabel(`移除武将 ${smallHeroes[0]}`).click();

    await expect(page.getByTestId(`pool-hero-${smallHeroes[0]}`)).toBeVisible();
    await expect(page.getByTestId(`pool-skill-${smallSkills[0]}`)).toBeVisible();
    await expect(page.getByTestId('hero-slot-0-1')).toContainText(
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

  test('marks WeChat sharing in Chinese and keeps the unfinished action disabled', async ({
    page,
  }) => {
    await openBuilder(page);

    const shareButton = page.getByRole('button', {
      name: /微信好友配将.*开发中/,
    });
    await expect(shareButton).toBeVisible();
    await expect(shareButton).toBeDisabled();
    await expect(shareButton).toHaveClass(/Mui-disabled/);
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
    await expect(page.getByRole('button', { name: '清空编排' })).toHaveCount(0);
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText(`已选择：${smallHeroes[0]}`)).toHaveCount(0);
  });
});

test.describe('Team Builder contextual relationship weights', () => {
  test.beforeEach(async ({ page }) => {
    await seedStoredProgress(page, relationshipPoolProgress);
  });

  test('shows exact positive, negative, multiple, and witness-backed badges on hover', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    const fire = page.getByTestId('skill-slot-0-0-0');
    await fire.hover();
    await expect(fire).toHaveAttribute('data-preview-state', 'selected');

    const zhangZhaoCard = page.getByTestId('hero-slot-0-0').locator('..');
    await expect(zhangZhaoCard.getByTestId('relationship-badges')).toContainText(
      '携带 +0.0621',
    );
    await expect(zhangZhaoCard.getByTestId('relationship-badges')).toContainText(
      '同队 +0.0429',
    );
    await expect(page.getByTestId('hero-slot-0-0')).toHaveAttribute(
      'aria-label',
      /携带：武将张昭直接携带战法烈火张天，模型权重 \+0\.0621/,
    );

    const luXunCard = page.getByTestId('hero-slot-0-1').locator('..');
    await expect(luXunCard.getByTestId('relationship-badges')).toContainText(
      '同队 +0.0504',
    );
    await expect(luXunCard.getByTestId('relationship-badges')).toContainText(
      '机制 +0.0247',
    );

    await expect(
      page.getByTestId('pool-skill-风助火势').getByTestId('relationship-badges'),
    ).toContainText('战法搭配 −0.0452');
    await expect(page.getByTestId('pool-hero-曹操')).toHaveAttribute(
      'data-preview-state',
      'unrelated',
    );
    await expect(page.getByTestId('pool-hero-曹操')).toHaveCSS(
      'opacity',
      '0.58',
    );

    const pageHeading = page.getByRole('heading', {
      level: 1,
      name: '队伍策案',
    });
    await pageHeading.hover();
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    await expect(page.getByTestId('relationship-badges')).toHaveCount(0);

    await page.getByTestId('hero-slot-0-0').hover();
    await expect(luXunCard.getByTestId('relationship-badges')).toContainText(
      '搭配 +0.1030',
    );
    await expect(
      page.getByTestId('hero-slot-0-2').locator('..').getByTestId('relationship-badges'),
    ).toContainText('搭配 −0.0364');
    await expect(
      fire.locator('..').getByTestId('relationship-badges'),
    ).toContainText('携带 +0.0621');
    const teamBadges = page
      .getByTestId('team-card-0')
      .getByTestId('team-relationship-badges');
    await expect(teamBadges).toContainText('缘分·柱石之臣 +0.2438');
    await expect(teamBadges).toContainText('3人同阵营 +0.6591');

    await pageHeading.hover();
    await expect(page.getByTestId('team-relationship-badges')).toHaveCount(0);
  });

  test('uses keyboard focus and tap selection, then clears each transient state', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    const fire = page.getByTestId('skill-slot-0-0-0');
    await fire.focus();
    await expect(fire).toHaveAttribute('data-preview-state', 'selected');
    await expect(
      page.getByTestId('hero-slot-0-1').locator('..').getByText('机制 +0.0247'),
    ).toBeVisible();

    await page.evaluate(() => document.activeElement?.blur());
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);

    await fire.click();
    await expect(page.getByText('已选择：烈火张天')).toBeVisible();
    await expect(fire).toHaveAttribute('data-preview-state', 'selected');
    await expect(
      page.getByTestId('hero-slot-0-0').locator('..').getByText('携带 +0.0621'),
    ).toBeVisible();

    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('已选择：烈火张天')).toHaveCount(0);
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
  });

  test('adds carrier-dependent M only after a warehouse skill has a drag target', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(
      page,
      relationshipLayout({ fireAssigned: false }),
    );
    await openBuilder(page);

    const fire = page
      .getByTestId('pool-skill-烈火张天')
      .getByRole('button');
    await fire.hover();
    const luXunCard = page.getByTestId('hero-slot-0-1').locator('..');
    await expect(
      luXunCard.locator('[data-feature-family="M"]'),
    ).toHaveCount(0);

    await startPointerDrag(page, fire);
    await expect(
      page.getByTestId('pool-skill-烈火张天'),
    ).toHaveAttribute('data-preview-state', 'selected');
    await movePointerTo(page, page.getByTestId('skill-slot-0-1-0'));
    await expect(luXunCard.locator('[data-feature-family="M"]')).toContainText(
      '机制 +0.0247',
    );
    await page.mouse.up();
    await expect(page.locator('[data-dnd-dragging="true"]')).toHaveCount(0);
  });

  test('marks prospective B/HC as activated, removed, or retained after real replacement', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(
      page,
      relationshipLayout({ thirdHero: '曹操' }),
    );
    await openBuilder(page);

    const huangGai = page
      .getByTestId('pool-hero-黄盖')
      .getByRole('button');
    await huangGai.hover();
    await expect(page.getByTestId('team-relationship-badges')).toHaveCount(0);

    await startPointerDrag(page, huangGai);
    await movePointerTo(page, page.getByTestId('hero-slot-0-2'));
    const teamBadges = page
      .getByTestId('team-card-0')
      .getByTestId('team-relationship-badges');
    await expect(teamBadges).toContainText('新激活·3人同阵营 +0.6591');
    await expect(teamBadges).toContainText('保留·缘分·柱石之臣 +0.2438');
    await expect(teamBadges).toContainText('将移除·2人同阵营 +0.1647');
    await expect(
      teamBadges.locator('[data-team-feature-status="activated"]'),
    ).toHaveCount(1);
    await expect(
      teamBadges.locator('[data-team-feature-status="retained"]'),
    ).toHaveCount(1);
    await expect(
      teamBadges.locator('[data-team-feature-status="removed"]'),
    ).toHaveCount(1);

    await page.mouse.up();
    await expect(page.getByTestId('hero-slot-0-2')).toContainText('黄盖');
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
      const flags = {
        warningSeen: false,
        loadingSeen: false,
        ticksWhileLoading: 0,
      };
      window.__teamBuilderFlashFlags = flags;
      const scan = () => {
        const text = document.body ? document.body.innerText : '';
        if (text.includes('不足以推荐完整的编排')) flags.warningSeen = true;
        if (
          text.includes('正在查找合适阵容') ||
          text.includes('正在完善队伍')
        ) {
          flags.loadingSeen = true;
        }
      };
      const start = () => {
        scan();
        new MutationObserver(scan).observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        window.setInterval(() => {
          const text = document.body ? document.body.innerText : '';
          if (
            text.includes('正在查找合适阵容') ||
            text.includes('正在完善队伍')
          ) {
            flags.ticksWhileLoading += 1;
          }
        }, 10);
      };
      if (document.documentElement) start();
      else document.addEventListener('DOMContentLoaded', start);
    });

    await openBuilder(page);
    const flags = await page.evaluate(() => window.__teamBuilderFlashFlags);
    expect(flags.loadingSeen).toBe(true);
    expect(flags.warningSeen).toBe(false);
    expect(flags.ticksWhileLoading).toBeGreaterThanOrEqual(2);
  });

  test('keeps the player-chosen formation after refresh', async ({ page }) => {
    await openBuilder(page);

    await expect
      .poll(
        () => page.locator('[data-testid^="hero-camp-"]').count(),
        { timeout: 30000 }
      )
      .toBeGreaterThan(0);
    const seededFormation = await page
      .getByTestId('formation-select-0')
      .inputValue();
    const replacementFormation = Object.keys(database.formations).find(
      (formation) => formation !== seededFormation
    );
    expect(replacementFormation).toBeTruthy();
    await page.getByRole('combobox', { name: '阵型' }).first().click();
    await page
      .getByRole('option', { name: replacementFormation })
      .click();
    await expect(page.getByTestId('formation-select-0')).toHaveValue(
      replacementFormation
    );
    await expect(
      page.getByRole('button', { name: '恢复阵容库推荐' })
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('heading', { name: '我的比赛阵容' })
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('formation-select-0')).toHaveValue(
      replacementFormation
    );
    await expect(
      page.getByRole('button', { name: '恢复阵容库推荐' })
    ).toBeVisible();
  });

  test('ignores an unscoped legacy formation-only save when seeding the current pool', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'teamBuilder',
        JSON.stringify([{ formation: '方圆阵', heroes: [] }])
      );
    });

    await openBuilder(page);
    await expect
      .poll(
        () => page.locator('[data-testid^="hero-camp-"]').count(),
        { timeout: 30000 }
      )
      .toBeGreaterThan(0);
    await expect(page.getByTestId('formation-select-0')).not.toHaveValue(
      '方圆阵'
    );
    await expect(page.getByTestId('formation-select-0')).not.toHaveValue('');
  });

  test('seeds exactly one evidence-only editable three-team formation', async ({
    page,
  }) => {
    await openBuilder(page);

    await expect(
      page.getByText(
        '只编入自身与搭配都达到模型最低证据量的武将和战法；权重只影响排序，不阻止填入。',
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      page.getByText(/可信特征要求|高证据配合|加分不低于/)
    ).toHaveCount(0);
    await expect(page.getByText(/阵型和前后排由你确认/)).toHaveCount(0);
    await expect(page.getByText('最佳推荐', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '恢复阵容库推荐' })
    ).toHaveCount(0);
    await expect(page.getByTestId('recommendation-success')).toHaveText(
      '已编入 3 支完整队伍'
    );
    const debugContext = await page.evaluate(() =>
      JSON.parse(window.sanmouDebug())
    );
    expect(debugContext).toMatchObject({
      schema: 'sanmou-recommendation-debug/v1',
      page: 'team-formation-suggestion',
      status: 'ready',
      optimizer_trace: {
        policy: 'evidence-only-team-builder',
      },
      current_layout: {
        matches_original_recommendation: true,
        user_edited: false,
      },
    });
    expect(debugContext.recommended_teams).toHaveLength(3);
    expect(debugContext.optimizer_trace.winner).toMatchObject({ rank: 1 });
    await expect(page.getByRole('button', { name: '清空编排' })).toHaveCount(0);
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

    const placedHeroCount = await page
      .locator('[data-testid^="hero-camp-"]')
      .count();
    expect(placedHeroCount).toBe(9);
    await expect(
      page
        .getByRole('region', { name: '武将仓库' })
        .getByRole('button', { name: /^选择武将 / })
    ).toHaveCount(0);

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('总评分');
    expect(body).not.toContain('胜率');
    expect(body).toContain('加分');
    expect(body).toContain('参考');
    const seededFormations = await page
      .locator('[data-testid^="formation-select-"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.value).sort()
      );
    expect(seededFormations.filter(Boolean).length).toBeGreaterThan(0);
    const evidenceRows = page.getByTestId('team-evidence');
    expect(await evidenceRows.count()).toBeGreaterThan(0);
    for (const row of await evidenceRows.all()) {
      await expect(row).toHaveCSS('white-space', 'normal');
      await expect(row).not.toHaveCSS('text-overflow', 'ellipsis');
    }

    const placedHeroLabels = await page
      .locator('[data-testid^="hero-slot-"]')
      .evaluateAll((slots) =>
        slots.map((slot) => slot.getAttribute('aria-label') || '')
      );
    const firstRecommendedHero = completeHeroes.find((hero) =>
      placedHeroLabels.some((label) => label.includes(`：${hero}，`))
    );
    expect(firstRecommendedHero).toBeTruthy();
    await page
      .getByRole('button', { name: `${firstRecommendedHero} 后排` })
      .click();
    const restoreButton = page.getByRole('button', {
      name: '恢复阵容库推荐',
    });
    await expect(restoreButton).toBeVisible();
    await restoreButton.click();
    await expect(page.getByText('已恢复当前卡池的阵容库推荐')).toBeVisible();
    await expect(restoreButton).toHaveCount(0);

    const header = page.getByTestId('formation-workbench-header');
    const title = header.getByRole('heading', { name: '我的比赛阵容' });
    const actions = header.getByRole('group', { name: '阵容操作' });
    const [headerBox, titleBox, actionsBox] = await Promise.all([
      header.boundingBox(),
      title.boundingBox(),
      actions.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(titleBox.y).toBeLessThan(actionsBox.y + actionsBox.height);
    expect(actionsBox.y).toBeLessThan(titleBox.y + titleBox.height);
    expect(
      headerBox.x + headerBox.width - (actionsBox.x + actionsBox.width)
    ).toBeLessThanOrEqual(24);
  });
});

test.describe('Team Builder desktop warehouse', () => {
  test.use({ viewport: { width: 1280, height: 664 } });

  test('keeps hero cards inside their repository at short viewport heights', async ({
    page,
  }) => {
    await seedStoredProgress(page, crowdedHeroPoolProgress);
    await openBuilder(page);

    const heroRepository = page.getByRole('region', { name: '武将仓库' });
    const skillRepository = page.getByRole('region', { name: '战法仓库' });
    const heroButtons = heroRepository.getByRole('button', {
      name: /^选择武将 /,
    });
    await expect(heroButtons).toHaveCount(12);

    const [heroRepositoryBox, skillRepositoryBox, lastHeroBottom] =
      await Promise.all([
        heroRepository.boundingBox(),
        skillRepository.boundingBox(),
        heroButtons.evaluateAll((buttons) =>
          Math.max(
            ...buttons.map(
              (button) =>
                button.parentElement?.getBoundingClientRect().bottom ?? 0
            )
          )
        ),
      ]);

    expect(heroRepositoryBox).not.toBeNull();
    expect(skillRepositoryBox).not.toBeNull();
    expect(lastHeroBottom).toBeLessThanOrEqual(
      heroRepositoryBox.y + heroRepositoryBox.height + 1
    );
    expect(skillRepositoryBox.y).toBeGreaterThanOrEqual(
      heroRepositoryBox.y + heroRepositoryBox.height
    );
  });
});

test.describe('Team Builder mobile placement', () => {
  test.use({ viewport: { width: 320, height: 844 }, hasTouch: true });

  test('keeps every hero card inside its repository on a narrow screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 521, height: 667 });
    await seedStoredProgress(page, overflowPoolProgress);
    await openBuilder(page);

    const heroRepository = page.locator('section[aria-label="武将仓库"]');
    const skillRepository = page.locator('section[aria-label="战法仓库"]');
    const poolHeroButtons = heroRepository.getByRole('button', {
      name: /^选择武将 /,
    });
    await expect
      .poll(() => poolHeroButtons.count(), { timeout: 30000 })
      .toBeGreaterThanOrEqual(8);
    await expect(page.getByTestId('recommendation-warning')).toHaveText(
      '部分武将或战法未通过证据量门槛，已保留空位。'
    );
    await expect(page.getByTestId('recommendation-warning')).toHaveClass(
      /MuiAlert-standardWarning/
    );
    await skillRepository.scrollIntoViewIfNeeded();

    const [heroRepositoryBox, lastHeroBox, skillRepositoryBox] =
      await Promise.all([
        heroRepository.boundingBox(),
        poolHeroButtons.last().boundingBox(),
        skillRepository.boundingBox(),
      ]);
    expect(heroRepositoryBox).not.toBeNull();
    expect(lastHeroBox).not.toBeNull();
    expect(skillRepositoryBox).not.toBeNull();
    expect(lastHeroBox.y + lastHeroBox.height).toBeLessThanOrEqual(
      heroRepositoryBox.y + heroRepositoryBox.height + 1
    );
    expect(heroRepositoryBox.y + heroRepositoryBox.height).toBeLessThanOrEqual(
      skillRepositoryBox.y + 1
    );
    expect(
      await heroRepository.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
  });

  test('shows the same relationship weights after touch selection without overflow', async ({
    page,
  }) => {
    await seedStoredProgress(page, relationshipPoolProgress);
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    await page.getByTestId('skill-slot-0-0-0').tap();
    await expect(page.getByText('已选择：烈火张天')).toBeVisible();
    await expect(
      page.getByTestId('hero-slot-0-0').locator('..').getByText('携带 +0.0621'),
    ).toBeVisible();
    await expect(
      page.getByTestId('hero-slot-0-1').locator('..').getByText('机制 +0.0247'),
    ).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await page.getByRole('button', { name: '取消' }).tap();
    await expect(page.getByTestId('relationship-badges')).toHaveCount(0);
  });

  test('keeps actions and tap destinations usable without page overflow', async ({
    page,
  }) => {
    await seedStoredProgress(page, smallPoolProgress);
    await openBuilder(page);

    const poolHeroButton = page.getByRole('button', {
      name: `选择武将 ${smallHeroes[0]}`,
    });
    const poolSkillButton = page.getByRole('button', {
      name: `选择战法 ${smallSkills[0]}`,
    });
    for (const source of [poolHeroButton, poolSkillButton]) {
      const box = await source.boundingBox();
      expect(box).not.toBeNull();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }

    await poolHeroButton.tap();
    await page.getByTestId('hero-slot-0-0').tap();
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      smallHeroes[0]
    );
    await poolSkillButton.tap();
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
      page.getByTestId('hero-slot-0-0'),
      page.getByRole('button', { name: `移除武将 ${smallHeroes[0]}` }),
      page.getByRole('button', { name: `${smallHeroes[0]} 后排` }),
      page.getByTestId('skill-slot-0-0-0'),
      page.getByRole('button', { name: `移除战法 ${smallSkills[0]}` }),
    ]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }

    for (const dragSurface of [
      page.getByTestId('hero-slot-0-0'),
      page.getByTestId('skill-slot-0-0-0'),
      page
        .getByTestId(`pool-hero-${smallHeroes[1]}`)
        .getByRole('button'),
    ]) {
      await expect(dragSurface).toHaveCSS('touch-action', 'manipulation');
    }
    await expect(
      page.getByRole('button', { name: /拖动(?:武将|战法)/ })
    ).toHaveCount(0);

    const scrollSource = page
      .getByTestId(`pool-hero-${smallHeroes[1]}`)
      .getByRole('button');
    await scrollSource.scrollIntoViewIfNeeded();
    const scrollSourceBox = await scrollSource.boundingBox();
    expect(scrollSourceBox).not.toBeNull();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    const touchX = scrollSourceBox.x + scrollSourceBox.width / 2;
    const touchY = scrollSourceBox.y + scrollSourceBox.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: touchX, y: touchY }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: touchX, y: Math.max(10, touchY - 90) }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(scrollBefore);
    await expect(
      page.getByText(`已选择：${smallHeroes[1]}`)
    ).toHaveCount(0);

    await expect(
      page.getByRole('button', { name: '生成强度复盘提示词' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /微信好友配将.*开发中/ })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /微信好友配将.*开发中/ })
    ).toBeDisabled();
  });
});
