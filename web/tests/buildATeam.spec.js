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
const relationshipHeroes = [
  '张昭',
  '陆逊',
  '黄盖',
  '曹操',
  '凌统',
  '周瑜',
  '周瑜2',
];
const relationshipSkills = ['烈火张天', '风助火势', '烈火焚营'];
const relationshipPoolProgress = progressFor({
  heroes: relationshipHeroes,
  skills: relationshipSkills,
});
const stabilityPoolProgress = progressFor({
  heroes: relationshipHeroes,
  skills: ['风助火势', '烈火焚营', '烈火张天'],
});
const sparseRelationshipHeroes = ['乐进', '于吉', '公孙瓒'];
const sparseRelationshipPoolProgress = progressFor({
  heroes: sparseRelationshipHeroes,
  skills: [],
});
const partialSuppressionHeroes = ['乐进', '于禁', '典韦'];
const partialSuppressionSkills = ['未雨绸缪'];
const partialSuppressionPoolProgress = progressFor({
  heroes: partialSuppressionHeroes,
  skills: partialSuppressionSkills,
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

const richPairRelationshipLayout = () => {
  const layout = relationshipLayout();
  layout[0].heroes[0].skills = ['风助火势', '烈火焚营'];
  return layout;
};

const sparseRelationshipLayout = () => {
  const layout = [emptyStoredTeam(), emptyStoredTeam(), emptyStoredTeam()];
  sparseRelationshipHeroes.forEach((hero, heroIndex) => {
    layout[0].heroes[heroIndex].hero = hero;
  });
  return layout;
};

const partialSuppressionLayout = () => {
  const layout = [emptyStoredTeam(), emptyStoredTeam(), emptyStoredTeam()];
  partialSuppressionHeroes.forEach((hero, heroIndex) => {
    layout[0].heroes[heroIndex].hero = hero;
  });
  layout[0].heroes[0].skills[0] = partialSuppressionSkills[0];
  return layout;
};

const denseTeamRelationshipLayout = () => {
  const layout = [emptyStoredTeam(), emptyStoredTeam(), emptyStoredTeam()];
  layout[0].heroes[0].hero = '凌统';
  layout[0].heroes[1].hero = '周瑜';
  layout[0].heroes[2].hero = '周瑜2';
  return layout;
};

async function seedTeamBuilderLayout(
  page,
  layout,
  { heroes = relationshipHeroes, skills = relationshipSkills } = {},
) {
  const poolKey = JSON.stringify({
    heroes: [...heroes].sort(),
    skills: [...skills].sort(),
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
  // Drag previews can update target decoration while dnd-kit processes the
  // pointer on an animation frame. Re-resolve and re-center until those frames
  // settle so mouse-up occurs over the intended element under parallel CI load.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: attempt === 0 ? 12 : 2,
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
}

function expectStableBox(before, after) {
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height']) {
    expect(
      Math.abs(after[key] - before[key]),
      `${key} changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}`,
    ).toBeLessThanOrEqual(1);
  }
}

async function expectRailContainedByShell(shell, primary, rail) {
  const [shellBox, primaryBox, railBox] = await Promise.all([
    shell.boundingBox(),
    primary.boundingBox(),
    rail.boundingBox(),
  ]);
  expect(shellBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(Math.abs(shellBox.height - 68)).toBeLessThanOrEqual(1);
  expect(Math.abs(primaryBox.height - 68)).toBeLessThanOrEqual(1);
  expect(Math.abs(railBox.height - 24)).toBeLessThanOrEqual(1);
  expect(Math.abs(primaryBox.y - shellBox.y)).toBeLessThanOrEqual(0.1);
  expect(
    Math.abs(primaryBox.y + primaryBox.height - (shellBox.y + shellBox.height)),
  ).toBeLessThanOrEqual(0.1);
  expect(railBox.y).toBeGreaterThanOrEqual(shellBox.y + 44 - 0.1);
  expect(railBox.y + railBox.height).toBeLessThanOrEqual(
    shellBox.y + shellBox.height + 0.1,
  );
}

async function expectPrimaryContentFullyVisible(primary) {
  const metrics = await primary.evaluate((element) => {
    const primaryBox = element.getBoundingClientRect();
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      lines: [...element.querySelectorAll('[data-pool-primary-line]')].map(
        (line) => {
          const box = line.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        },
      ),
      top: primaryBox.top,
      bottom: primaryBox.bottom,
    };
  });
  expect(metrics.lines).toHaveLength(2);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
  for (const line of metrics.lines) {
    expect(line.top).toBeGreaterThanOrEqual(metrics.top - 0.1);
    expect(line.bottom).toBeLessThanOrEqual(metrics.bottom + 0.1);
  }
}

async function expectEvidenceFullyVisible(rows) {
  const metrics = await rows.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        whiteSpace: style.whiteSpace,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        textOverflow: style.textOverflow,
        lineHeight: Number.parseFloat(style.lineHeight),
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
      };
    }),
  );
  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.whiteSpace).toBe('normal');
    expect(metric.overflowX).not.toBe('hidden');
    expect(metric.overflowY).not.toBe('hidden');
    expect(metric.textOverflow).not.toBe('ellipsis');
    expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth + 1);
    expect(metric.scrollHeight).toBeLessThanOrEqual(metric.clientHeight + 1);
  }
  return metrics;
}

async function readPreviewScrollMetrics(source) {
  return source.evaluate((element) => {
    const scrollOwners = [];
    let ancestor = element.parentElement;
    let depth = 1;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (/auto|scroll|overlay/.test(`${style.overflowX} ${style.overflowY}`)) {
        scrollOwners.push({
          depth,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          scrollTop: ancestor.scrollTop,
          scrollLeft: ancestor.scrollLeft,
        });
      }
      ancestor = ancestor.parentElement;
      depth += 1;
    }
    return {
      scrollOwners,
      windowScrollTop: window.scrollY,
      windowScrollLeft: window.scrollX,
      documentScrollTop: document.scrollingElement?.scrollTop ?? null,
      documentScrollLeft: document.scrollingElement?.scrollLeft ?? null,
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
}

async function assertStationaryPreviewStability(
  page,
  { source, sourceCard, tracked },
) {
  await source.scrollIntoViewIfNeeded();
  const beforeBoxes = await Promise.all(
    [sourceCard, ...tracked].map((locator) => locator.boundingBox()),
  );
  const beforeMetrics = await readPreviewScrollMetrics(source);
  const sourceTestId = await source.getAttribute('data-testid');
  expect(sourceTestId).toBeTruthy();

  await page.evaluate((testId) => {
    const workbench = document.querySelector(
      '[aria-labelledby="formation-workbench-title"]',
    );
    if (!workbench) throw new Error('Missing formation workbench');
    const findSource = () =>
      [...workbench.querySelectorAll('[data-testid]')].find(
        (element) => element.getAttribute('data-testid') === testId,
      );
    const states = [];
    const sample = () => {
      const state = findSource()?.getAttribute('data-preview-state') ?? null;
      if (states.at(-1) !== state) states.push(state);
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(workbench, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-preview-state'],
    });
    window.__teamBuilderPreviewObserver = { observer, sample, states };
  }, sourceTestId);

  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await expect(source).toHaveAttribute('data-preview-state', 'selected');
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const observationStart = await page.evaluate(() => {
    const state = window.__teamBuilderPreviewObserver;
    state.sample();
    state.observationStart = state.states.length - 1;
    return state.observationStart;
  });
  expect(observationStart).toBeGreaterThanOrEqual(0);

  await page.waitForTimeout(550);
  await expect(source).toHaveAttribute('data-preview-state', 'selected');
  const afterBoxes = await Promise.all(
    [sourceCard, ...tracked].map((locator) => locator.boundingBox()),
  );
  const afterMetrics = await readPreviewScrollMetrics(source);
  const transitions = await page.evaluate(() => {
    const state = window.__teamBuilderPreviewObserver;
    state.sample();
    state.observer.disconnect();
    return {
      all: state.states,
      observed: state.states.slice(state.observationStart),
    };
  });

  const firstSelected = transitions.all.indexOf('selected');
  expect(firstSelected).toBeGreaterThanOrEqual(0);
  expect(transitions.all.slice(firstSelected)).toEqual(['selected']);
  expect(transitions.observed).toEqual(['selected']);
  beforeBoxes.forEach((before, index) => {
    expectStableBox(before, afterBoxes[index]);
  });
  expect(afterMetrics.scrollOwners).toEqual(beforeMetrics.scrollOwners);
  expect(afterMetrics.windowScrollTop).toBe(beforeMetrics.windowScrollTop);
  expect(afterMetrics.windowScrollLeft).toBe(beforeMetrics.windowScrollLeft);
  expect(afterMetrics.documentScrollTop).toBe(beforeMetrics.documentScrollTop);
  expect(afterMetrics.documentScrollLeft).toBe(beforeMetrics.documentScrollLeft);
  expect(afterMetrics.viewportWidth).toBe(beforeMetrics.viewportWidth);
  expect(beforeMetrics.documentWidth).toBeLessThanOrEqual(
    beforeMetrics.viewportWidth,
  );
  expect(afterMetrics.documentWidth).toBe(beforeMetrics.documentWidth);
  expect(afterMetrics.documentWidth).toBeLessThanOrEqual(
    afterMetrics.viewportWidth,
  );
}

async function assertStationaryRelationshipActivation(page, {
  owner,
  targetShell,
  targetPrimary,
  targetContent,
  xFraction = 0.5,
  yOffset,
  expectedRelationshipCount,
  expectInitialTarget = true,
}) {
  await page.evaluate(() => document.activeElement?.blur());
  await expect(page.locator('[data-preview-state]')).toHaveCount(0);
  await targetShell.scrollIntoViewIfNeeded();
  const [shellBefore, primaryBefore, contentBefore] = await Promise.all([
    targetShell.boundingBox(),
    targetPrimary.boundingBox(),
    targetContent.boundingBox(),
  ]);
  expect(shellBefore).not.toBeNull();
  expect(primaryBefore).not.toBeNull();
  expect(contentBefore).not.toBeNull();
  expect(Math.abs(shellBefore.height - 68)).toBeLessThanOrEqual(1);
  expect(Math.abs(primaryBefore.height - 68)).toBeLessThanOrEqual(1);
  const point = {
    x: shellBefore.x + shellBefore.width * xFraction,
    y: shellBefore.y + yOffset,
  };

  // Establish the pointer location before another primary takes focus. This
  // reproduces relationship activation under a completely stationary pointer.
  await page.mouse.move(point.x, point.y);
  if (expectInitialTarget) {
    await expect(targetPrimary).toHaveAttribute(
      'data-preview-state',
      'selected',
    );
  }
  await page.evaluate(() => {
    const workbench = document.querySelector(
      '[aria-labelledby="formation-workbench-title"]',
    );
    if (!workbench) throw new Error('Missing formation workbench');
    const states = [];
    const sample = () => {
      const selected = [...workbench.querySelectorAll(
        '[data-team-builder-preview-primary="true"][data-preview-state="selected"]',
      )].map((element) => element.getAttribute('data-testid'));
      const rails = [...workbench.querySelectorAll(
        '[data-testid="relationship-badges"]',
      )].map((element) => element.getAttribute('data-relationship-count'));
      const state = JSON.stringify({ selected, rails });
      if (states.at(-1) !== state) states.push(state);
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(workbench, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-preview-state', 'data-relationship-count'],
    });
    const state = {
      observer,
      sample,
      states,
      pointerMoves: 0,
      onPointerMove: () => {
        state.pointerMoves += 1;
      },
    };
    window.addEventListener('pointermove', state.onPointerMove, true);
    window.__stationaryRelationshipObserver = state;
  });

  await owner.evaluate((element) => element.focus({ preventScroll: true }));
  await expect(owner).toHaveAttribute('data-preview-state', 'selected');
  const rail = targetShell.getByTestId('relationship-badges');
  await expect(rail).toHaveAttribute(
    'data-relationship-count',
    String(expectedRelationshipCount),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
  const observationStart = await page.evaluate(() => {
    const state = window.__stationaryRelationshipObserver;
    state.sample();
    state.observationStart = state.states.length - 1;
    return state.observationStart;
  });
  expect(observationStart).toBeGreaterThanOrEqual(0);

  await page.waitForTimeout(550);
  await expect(owner).toHaveAttribute('data-preview-state', 'selected');
  const [shellAfter, primaryAfter, contentAfter] = await Promise.all([
    targetShell.boundingBox(),
    targetPrimary.boundingBox(),
    targetContent.boundingBox(),
  ]);
  const observation = await page.evaluate(() => {
    const state = window.__stationaryRelationshipObserver;
    state.sample();
    state.observer.disconnect();
    window.removeEventListener('pointermove', state.onPointerMove, true);
    return {
      transitions: state.states.slice(state.observationStart),
      pointerMoves: state.pointerMoves,
    };
  });
  expect(observation.pointerMoves).toBe(0);
  expect(observation.transitions).toHaveLength(1);
  expectStableBox(shellBefore, shellAfter);
  expectStableBox(primaryBefore, primaryAfter);
  expectStableBox(contentBefore, contentAfter);
  await expectRailContainedByShell(targetShell, targetPrimary, rail);
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

  // A failed attempt can trigger the tap-selection fallback, and contextual
  // rails can shift the target after drag-over starts. Re-resolve it through
  // the same settling helper used by the preview-specific drag checks.
  await movePointerTo(page, target);
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
    await expect(page.getByText(`已选择：${smallHeroes[0]}`)).toHaveCount(0);
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
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

    const teamCard = page.getByTestId('team-card-0');
    const teamScoreBefore = await teamCard.getByTestId('team-strength').innerText();
    const fire = page.getByTestId('skill-slot-0-0-0');
    await fire.hover();
    await expect(fire).toHaveAttribute('data-preview-state', 'selected');

    const zhangZhaoCard = page.getByTestId('hero-card-0-0');
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

    const luXunCard = page.getByTestId('hero-card-0-1');
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
    await expect(
      page.locator(
        '[data-testid="relationship-badges"]:not([data-relationship-count="0"])',
      ),
    ).toHaveCount(0);

    await page.getByTestId('hero-slot-0-0').hover();
    await expect(luXunCard.getByTestId('relationship-badges')).toContainText(
      '搭配 +0.1030',
    );
    await expect(
      page.getByTestId('hero-card-0-2').getByTestId('relationship-badges'),
    ).toContainText('搭配 −0.0364');
    await expect(
      fire.locator('..').getByTestId('relationship-badges'),
    ).toContainText('携带 +0.0621');
    const teamBadges = page
      .getByTestId('team-card-0')
      .getByTestId('team-relationship-badges');
    await expect(teamBadges).toContainText('缘分·柱石之臣 +0.2438');
    await expect(teamBadges).toContainText('3人同阵营 +0.6591');
    const contextualEvidence = teamCard.getByTestId('team-evidence');
    await expect(contextualEvidence).toHaveCount(3);
    await expect(contextualEvidence.filter({ hasText: '3人同阵营' })).toHaveCount(0);
    await expect(
      contextualEvidence.filter({ hasText: '缘分 · 柱石之臣' }),
    ).toHaveCount(0);
    await expect(teamCard.getByTestId('team-strength')).toHaveText(
      teamScoreBefore,
    );

    await pageHeading.hover();
    await expect(
      page.locator(
        '[data-testid="team-relationship-badges"]:not([data-relationship-count="0"])',
      ),
    ).toHaveCount(0);
  });

  test('keeps a later repository source stable with pair previews on desktop and 320px', async ({
    page,
  }) => {
    await seedStoredProgress(page, stabilityPoolProgress);
    await seedTeamBuilderLayout(
      page,
      relationshipLayout({ fireAssigned: false }),
    );

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openBuilder(page);

      const grid = page.getByTestId('repository-skill-grid');
      const sourceCard = page.getByTestId('pool-skill-烈火张天');
      const source = sourceCard.getByRole('button', { name: /^选择战法 / });
      const windCard = page.getByTestId('pool-skill-风助火势');
      const campCard = page.getByTestId('pool-skill-烈火焚营');
      await source.scrollIntoViewIfNeeded();
      const [sourceBefore, earlierTarget] = await Promise.all([
        sourceCard.boundingBox(),
        windCard.boundingBox(),
      ]);
      expect(sourceBefore).not.toBeNull();
      expect(earlierTarget).not.toBeNull();
      expect(sourceBefore.y).toBeGreaterThan(earlierTarget.y + 1);

      await assertStationaryPreviewStability(page, {
        source,
        sourceCard,
        tracked: [grid, windCard, campCard],
      });
      const windRail = windCard.getByTestId('relationship-badges');
      await expect(windRail).toBeVisible();
      const windPrimary = windCard.getByRole('button', {
        name: /^选择战法 /,
      });
      await expectRailContainedByShell(windCard, windPrimary, windRail);
      await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
      await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    }
  });

  test('keeps stationary lower and boundary pointers stable in later repository rows', async ({
    page,
  }) => {
    await seedStoredProgress(page, stabilityPoolProgress);
    await seedTeamBuilderLayout(
      page,
      relationshipLayout({ fireAssigned: false }),
    );

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openBuilder(page);
      const owner = page
        .getByTestId('pool-skill-风助火势')
        .getByRole('button', { name: /^选择战法 / });
      const targetShell = page.getByTestId('pool-skill-烈火张天');
      const targetPrimary = targetShell.getByRole('button', {
        name: /^选择战法 /,
      });
      const firstCard = page.getByTestId('pool-skill-风助火势');
      const [targetBox, firstBox] = await Promise.all([
        targetShell.boundingBox(),
        firstCard.boundingBox(),
      ]);
      expect(targetBox).not.toBeNull();
      expect(firstBox).not.toBeNull();
      expect(targetBox.y).toBeGreaterThan(firstBox.y + 1);

      for (const yOffset of [44, 60, 67]) {
        await assertStationaryRelationshipActivation(page, {
          owner,
          targetShell,
          targetPrimary,
          targetContent: targetPrimary.locator(
            '[data-team-builder-primary-content="true"]',
          ),
          yOffset,
          expectedRelationshipCount: 1,
        });
      }
    }
  });

  test('keeps stationary assigned hero, skill, and +N regions stable on desktop and 320px', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, richPairRelationshipLayout());

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openBuilder(page);

      const heroOwner = page.getByTestId('hero-slot-0-0');
      const heroTargetPrimary = page.getByTestId('hero-slot-0-1');
      await assertStationaryRelationshipActivation(page, {
        owner: heroOwner,
        targetShell: heroTargetPrimary.locator('..'),
        targetPrimary: heroTargetPrimary,
        targetContent: heroTargetPrimary.locator(
          '[data-team-builder-primary-content="true"]',
        ),
        yOffset: 60,
        expectedRelationshipCount: 1,
      });

      const skillOwner = page.getByTestId('skill-slot-0-0-0');
      const skillTargetPrimary = page.getByTestId('skill-slot-0-0-1');
      const skillTargetShell = skillTargetPrimary.locator('..');
      await assertStationaryRelationshipActivation(page, {
        owner: skillOwner,
        targetShell: skillTargetShell,
        targetPrimary: skillTargetPrimary,
        targetContent: skillTargetPrimary.locator(
          '[data-team-builder-primary-content="true"]',
        ),
        yOffset: 45,
        expectedRelationshipCount: 4,
      });
      await assertStationaryRelationshipActivation(page, {
        owner: skillOwner,
        targetShell: skillTargetShell,
        targetPrimary: skillTargetPrimary,
        targetContent: skillTargetPrimary.locator(
          '[data-team-builder-primary-content="true"]',
        ),
        xFraction: 0.92,
        yOffset: 60,
        expectedRelationshipCount: 4,
        expectInitialTarget: false,
      });
      await expect(
        skillTargetShell.getByRole('button', {
          name: '显示另有 1 项关系',
        }),
      ).toBeVisible();
    }
  });

  test('does not toggle preview DOM during repeated movement inside one primary', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, richPairRelationshipLayout());
    await openBuilder(page);

    const source = page.getByTestId('skill-slot-0-0-0');
    const target = page.getByTestId('skill-slot-0-0-1');
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).not.toBeNull();
    await page.mouse.move(sourceBox.x + 18, sourceBox.y + 18);
    await expect(source).toHaveAttribute('data-preview-state', 'selected');

    await page.evaluate(() => {
      const workbench = document.querySelector(
        '[aria-labelledby="formation-workbench-title"]',
      );
      if (!workbench) throw new Error('Missing formation workbench');
      const states = [];
      const sample = () => {
        const selected = [...workbench.querySelectorAll(
          '[data-team-builder-preview-primary="true"][data-preview-state="selected"]',
        )].map((element) => element.getAttribute('data-testid'));
        const state = JSON.stringify(selected);
        if (states.at(-1) !== state) states.push(state);
      };
      sample();
      const record = { states, mutations: 0, sample, observer: null };
      record.observer = new MutationObserver((mutations) => {
        record.mutations += mutations.length;
        sample();
      });
      record.observer.observe(workbench, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-preview-state', 'data-relationship-count'],
      });
      window.__repeatedPointerPreviewObserver = record;
    });

    for (const offset of [22, 27, 32, 37, 42]) {
      await page.mouse.move(sourceBox.x + offset, sourceBox.y + 18);
    }
    await page.waitForTimeout(550);
    await expect(source).toHaveAttribute('data-preview-state', 'selected');
    const observation = await page.evaluate(() => {
      const record = window.__repeatedPointerPreviewObserver;
      record.sample();
      record.observer.disconnect();
      return { states: record.states, mutations: record.mutations };
    });
    expect(observation.states).toEqual([
      JSON.stringify(['skill-slot-0-0-0']),
    ]);
    expect(observation.mutations).toBe(0);

    await target.hover({ position: { x: 18, y: 18 } });
    await expect(target).toHaveAttribute('data-preview-state', 'selected');
    await expect(source).not.toHaveAttribute('data-preview-state', 'selected');
  });

  test('keeps team B/HC header previews geometry-stable on desktop and 320px', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openBuilder(page);

      const source = page.getByTestId('hero-slot-0-0');
      const sourceCard = page.getByTestId('hero-card-0-0');
      const teamCard = page.getByTestId('team-card-0');
      const teamSummary = page.getByTestId('team-summary-0');
      const teamSidecar = page.getByTestId('team-relationship-sidecar-0');
      const formationControl = page.getByTestId('formation-control-0');
      const formationLabel = page.getByTestId('formation-label-0');
      const formationValue = page.getByTestId('formation-value-0');
      const evidence = teamCard.getByTestId('team-evidence');
      await expectEvidenceFullyVisible(evidence);

      await assertStationaryPreviewStability(page, {
        source,
        sourceCard,
        tracked: [
          teamCard,
          teamSummary,
          teamSidecar,
          formationControl,
          formationLabel,
          formationValue,
        ],
      });
      await expectEvidenceFullyVisible(evidence);
      const teamRail = teamSidecar.getByTestId('team-relationship-badges');
      await expect(teamRail).toContainText('3人同阵营 +0.6591');
      await expectRailContainedByShell(
        teamSidecar,
        formationControl,
        teamRail,
      );
      const [formationValueBox, teamRailBox] = await Promise.all([
        formationValue.boundingBox(),
        teamRail.boundingBox(),
      ]);
      expect(formationValueBox).not.toBeNull();
      expect(teamRailBox).not.toBeNull();
      expect(
        formationValueBox.y + formationValueBox.height,
      ).toBeLessThanOrEqual(teamRailBox.y + 0.1);
      const relatedHeroCard = page.getByTestId('hero-card-0-1');
      const relatedHeroRail = relatedHeroCard.getByTestId(
        'relationship-badges',
      );
      await expect(relatedHeroRail).toBeVisible();
      const relatedHeroPrimary = page.getByTestId('hero-slot-0-1');
      await expectRailContainedByShell(
        relatedHeroPrimary.locator('..'),
        relatedHeroPrimary,
        relatedHeroRail,
      );
      await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
      await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    }
  });

  test('keeps the hover origin while opening a related card pair +N control', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, richPairRelationshipLayout());
    await openBuilder(page);

    const source = page.getByTestId('skill-slot-0-0-0');
    const targetPrimary = page.getByTestId('skill-slot-0-0-1');
    const target = targetPrimary.locator('..');
    await source.hover();
    await expect(source).toHaveAttribute('data-preview-state', 'selected');

    await targetPrimary.hover();
    await expect(targetPrimary).toHaveAttribute('data-preview-state', 'selected');
    await expect(source).not.toHaveAttribute('data-preview-state', 'selected');

    await source.hover();
    await expect(source).toHaveAttribute('data-preview-state', 'selected');
    const rail = target.getByTestId('relationship-badges');
    await expect(rail).toHaveAttribute('data-relationship-count', '4');
    await expectRailContainedByShell(target, targetPrimary, rail);
    const more = rail.getByRole('button', { name: '显示另有 1 项关系' });

    await more.hover();
    await expect(source).toHaveAttribute('data-preview-state', 'selected');
    await more.click();
    await expect(source).toHaveAttribute('data-preview-state', 'selected');
    let details = page.getByRole('list', { name: '其余关系' });
    await expect(details).toBeVisible();
    await expect(details).toContainText('机制 +0.0247');
    await expect(details).toContainText('参考 1346 场');
    await details.hover();
    await expect(source).toHaveAttribute('data-preview-state', 'selected');
    const detailsId = await more.getAttribute('aria-controls');
    expect(detailsId).toBeTruthy();
    await expect(details).toHaveAttribute('id', detailsId);
    expect(
      await details.evaluate(
        (element) =>
          element.closest('[data-testid="relationship-badges"]') === null,
      ),
    ).toBe(true);

    await details.focus();
    await details.press('Escape');
    await expect(details).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(source).toHaveAttribute('data-preview-state', 'selected');

    await more.click();
    details = page.getByRole('list', { name: '其余关系' });
    await expect(details).toBeVisible();
    await more.click();
    await expect(details).toHaveCount(0);
    await expect(source).toHaveAttribute('data-preview-state', 'selected');
    await page.evaluate(() => document.activeElement?.blur());

    await targetPrimary.hover();
    await expect(targetPrimary).toHaveAttribute('data-preview-state', 'selected');
    await expect(source).not.toHaveAttribute('data-preview-state', 'selected');

    await source.hover();
    await expect(source).toHaveAttribute('data-preview-state', 'selected');
    const reopenedMore = target
      .getByTestId('relationship-badges')
      .getByRole('button', { name: '显示另有 1 项关系' });
    await reopenedMore.click();
    details = page.getByRole('list', { name: '其余关系' });
    await expect(details).toBeVisible();
    await page.setViewportSize({ width: 900, height: 720 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    if ((await details.count()) > 0) {
      await expect(details).toBeVisible();
      const repositioned = await details.boundingBox();
      expect(repositioned).not.toBeNull();
      expect(repositioned.x).toBeGreaterThanOrEqual(-1);
      expect(repositioned.x + repositioned.width).toBeLessThanOrEqual(901);
    } else {
      await expect(
        page.locator('[data-relationship-details-interaction][aria-expanded="true"]'),
      ).toHaveCount(0);
      await source.hover();
      const outsideMore = target
        .getByTestId('relationship-badges')
        .getByRole('button', { name: '显示另有 1 项关系' });
      await outsideMore.click();
      details = page.getByRole('list', { name: '其余关系' });
      await expect(details).toBeVisible();
    }

    await page.mouse.click(4, 4);
    await expect(details).toHaveCount(0);
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
  });

  test('restores hero and skill hover when returning from remove controls', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    const hero = page.getByTestId('hero-slot-0-0');
    const removeHero = page.getByRole('button', { name: '移除武将 张昭' });
    await hero.hover();
    await expect(hero).toHaveAttribute('data-preview-state', 'selected');
    await removeHero.hover();
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    await hero.hover();
    await expect(hero).toHaveAttribute('data-preview-state', 'selected');

    const skill = page.getByTestId('skill-slot-0-0-0');
    const removeSkill = page.getByRole('button', {
      name: '移除战法 烈火张天',
    });
    await skill.hover();
    await expect(skill).toHaveAttribute('data-preview-state', 'selected');
    await removeSkill.hover();
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    await skill.hover();
    await expect(skill).toHaveAttribute('data-preview-state', 'selected');
  });

  test('rejects hero drops over nested row and skill controls', async ({
    page,
  }) => {
    const layout = relationshipLayout();
    layout[0].heroes[1].skills[0] = layout[0].heroes[0].skills[0];
    layout[0].heroes[0].skills[0] = null;
    await seedTeamBuilderLayout(page, layout);
    await openBuilder(page);

    const poolHero = page
      .getByTestId('pool-hero-曹操')
      .getByRole('button');
    const zhangZhao = page.getByTestId('hero-slot-0-0');
    const luXun = page.getByTestId('hero-slot-0-1');
    for (const nestedTarget of [
      page.getByRole('button', { name: '张昭 前排' }),
      page.getByTestId('skill-slot-0-0-0'),
    ]) {
      await startPointerDrag(page, poolHero);
      await movePointerTo(page, nestedTarget);
      await page.mouse.up();
      await expect(page.locator('[data-dnd-dragging="true"]')).toHaveCount(0);
      await expect(zhangZhao).toContainText('张昭');
      await expect(luXun).toContainText('陆逊');
      await expect(poolHero).toBeVisible();
      await page.waitForTimeout(300);
    }

    await startPointerDrag(page, zhangZhao);
    const skillRail = page
      .getByTestId('skill-slot-0-1-0')
      .locator('..')
      .getByTestId('relationship-badges');
    await expect(skillRail).toContainText('携带 +0.0621');
    await movePointerTo(page, skillRail.locator('[data-feature-family]').first());
    await page.mouse.up();

    await expect(page.locator('[data-dnd-dragging="true"]')).toHaveCount(0);
    await expect(zhangZhao).toContainText('张昭');
    await expect(luXun).toContainText('陆逊');
  });

  test('keeps a visible relationship rail as part of the card drag surface', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    await page.getByTestId('skill-slot-0-0-0').hover();
    const zhouYuRail = page
      .getByTestId('pool-hero-周瑜')
      .getByTestId('relationship-badges');
    await expect(zhouYuRail).toContainText('同队 +0.0139');
    await dragWholeBlock(
      page,
      zhouYuRail,
      page.getByTestId('hero-slot-0-2'),
    );

    await expect(page.getByTestId('hero-slot-0-2')).toContainText('周瑜');
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
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
      page.getByTestId('hero-card-0-1').getByText('机制 +0.0247'),
    ).toBeVisible();

    await page.evaluate(() => document.activeElement?.blur());
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);

    await fire.click();
    await expect(page.getByText('已选择：烈火张天')).toBeVisible();
    await expect(fire).toHaveAttribute('data-preview-state', 'selected');
    await expect(
      page.getByTestId('hero-card-0-0').getByText('携带 +0.0621'),
    ).toBeVisible();

    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('已选择：烈火张天')).toHaveCount(0);
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
  });

  test('associates active B/HC text with keyboard focus and tap selection', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    const zhangZhao = page.getByTestId('hero-slot-0-0');
    await zhangZhao.hover();
    await expect(page.getByTestId('team-relationship-status')).toHaveCount(0);

    const teamRegion = page.getByRole('region', {
      name: '队伍 1 武将配置',
    });
    await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
    await teamRegion.focus();
    await page.keyboard.press('Tab');
    await expect(zhangZhao).toBeFocused();
    const describedBy = await zhangZhao.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const status = page.getByTestId('team-relationship-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toContainText('已激活3人同阵营');
    await expect(status).toContainText('已激活缘分·柱石之臣');
    await expect(page.locator(`#${describedBy}`)).toHaveText(
      await status.innerText(),
    );

    await page.keyboard.press('Tab');
    await expect(status).toHaveCount(0);
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    await zhangZhao.click();
    await expect(page.getByText('已选择：张昭')).toBeVisible();
    await expect(zhangZhao).toHaveAttribute('aria-describedby', describedBy);
    await expect(status).toContainText('模型权重 +0.6591');
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
    const luXunCard = page.getByTestId('hero-card-0-1');
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
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
  });

  test('keeps participating team weights while a hero is dragged over its own slot', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    const zhangZhao = page.getByTestId('hero-slot-0-0');
    await startPointerDrag(page, zhangZhao);
    await movePointerTo(page, zhangZhao);

    const teamBadges = page
      .getByTestId('team-card-0')
      .getByTestId('team-relationship-badges');
    await expect(teamBadges).toHaveAttribute('data-relationship-count', '2');
    await expect(teamBadges).toContainText('3人同阵营 +0.6591');
    await expect(teamBadges).toContainText('缘分·柱石之臣 +0.2438');

    await page.mouse.up();
    await expect(zhangZhao).toContainText('张昭');
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
    await expect(
      page.locator(
        '[data-testid="team-relationship-badges"]:not([data-relationship-count="0"])',
      ),
    ).toHaveCount(0);

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
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    await expect(page.getByTestId('team-relationship-badges')).toHaveCount(0);
  });

  test('clears contextual previews after a cancelled drag', async ({ page }) => {
    await seedTeamBuilderLayout(
      page,
      relationshipLayout({ thirdHero: '曹操' }),
    );
    await openBuilder(page);

    const huangGai = page
      .getByTestId('pool-hero-黄盖')
      .getByRole('button');
    await startPointerDrag(page, huangGai);
    await movePointerTo(
      page,
      page.getByRole('heading', { level: 1, name: '队伍策案' }),
    );
    await page.mouse.up();

    await expect(page.getByTestId('pool-hero-黄盖')).toBeVisible();
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    await expect(page.getByTestId('team-relationship-badges')).toHaveCount(0);
  });
});

test.describe('Team Builder sparse relationship stability', () => {
  test.beforeEach(async ({ page }) => {
    await seedStoredProgress(page, sparseRelationshipPoolProgress);
  });

  test('keeps a sole B/HC evidence row stable on desktop and 320px', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, sparseRelationshipLayout(), {
      heroes: sparseRelationshipHeroes,
      skills: [],
    });

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openBuilder(page);

      const source = page.getByTestId('hero-slot-0-1');
      const sourceCard = page.getByTestId('hero-card-0-1');
      const teamCard = page.getByTestId('team-card-0');
      const teamSummary = page.getByTestId('team-summary-0');
      const teamSidecar = page.getByTestId('team-relationship-sidecar-0');
      const evidence = teamCard.getByTestId('team-evidence');
      await expect(evidence).toHaveCount(1);
      await expect(evidence).toContainText('2人同阵营');

      await assertStationaryPreviewStability(page, {
        source,
        sourceCard,
        tracked: [teamCard, teamSummary, teamSidecar],
      });

      await expect(evidence).toHaveCount(0);
      const placeholder = teamCard.getByTestId('team-evidence-placeholder');
      await expect(placeholder).toHaveCount(1);
      await expect(placeholder).toHaveText('同阵营关系 · 状态见右侧');
      await expectEvidenceFullyVisible(placeholder);
      await expect(
        teamSidecar.getByTestId('team-relationship-badges'),
      ).toContainText('2人同阵营 +0.1647');
      const primaryBox = await source.boundingBox();
      expect(primaryBox).not.toBeNull();
      expect(primaryBox.height).toBeGreaterThanOrEqual(44);

      await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
      await expect(evidence).toContainText('2人同阵营');
      await expect(placeholder).toHaveCount(0);
    }
  });
});

test.describe('Team Builder partial relationship stability', () => {
  test.beforeEach(async ({ page }) => {
    await seedStoredProgress(page, partialSuppressionPoolProgress);
  });

  test('keeps shifted replacement evidence stable on desktop and 320px', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, partialSuppressionLayout(), {
      heroes: partialSuppressionHeroes,
      skills: partialSuppressionSkills,
    });

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openBuilder(page);

      const source = page.getByTestId('hero-slot-0-2');
      const sourceCard = page.getByTestId('hero-card-0-2');
      const teamCard = page.getByTestId('team-card-0');
      const teamSummary = page.getByTestId('team-summary-0');
      const evidenceShell = teamCard.getByTestId('team-evidence-shell');
      const evidence = teamCard.getByTestId('team-evidence');
      await expect(evidence).toHaveCount(3);
      await expect(evidence.nth(0)).toContainText('3人同阵营');
      await expect(evidence.nth(1)).toContainText('缘分 · 五子良将');
      await expect(evidence.nth(2)).toContainText('机制联动');

      await assertStationaryPreviewStability(page, {
        source,
        sourceCard,
        tracked: [teamCard, teamSummary, evidenceShell],
      });

      await expect(evidence).toHaveCount(2);
      await expect(evidence.nth(0)).toContainText('缘分 · 五子良将');
      await expect(evidence.nth(1)).toContainText('机制联动');
      const placeholder = teamCard.getByTestId('team-evidence-placeholder');
      await expect(placeholder).toHaveCount(1);
      await expect(placeholder).toHaveText('同阵营关系 · 状态见右侧');
      await expectEvidenceFullyVisible(
        teamCard.locator(
          '[data-testid="team-evidence"], [data-testid="team-evidence-placeholder"]',
        ),
      );
    }
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

  test('omits inactive rails and keeps visible relationship areas interactive', async ({
    page,
  }) => {
    await seedStoredProgress(page, relationshipPoolProgress);
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    const fire = page.getByTestId('skill-slot-0-0-0');
    const zhangZhao = page.getByTestId('hero-slot-0-0');
    const zhangZhaoHeader = zhangZhao.locator('..');
    const zhangZhaoCard = page.getByTestId('hero-card-0-0');
    const removeZhangZhao = zhangZhaoHeader.getByRole('button', {
      name: '移除武将 张昭',
    });
    const poolZhouYu = page.getByTestId('pool-hero-周瑜');
    const poolZhouYuButton = poolZhouYu.getByRole('button');

    await expect(zhangZhaoCard.getByTestId('relationship-badges')).toHaveCount(0);
    await expect(poolZhouYu.getByTestId('relationship-badges')).toHaveCount(0);
    await expect(
      page.getByTestId('team-card-0').getByTestId('team-relationship-badges'),
    ).toHaveCount(0);

    const [headerBox, heroButtonBox, removeButtonBox, poolBox, poolButtonBox] =
      await Promise.all([
        zhangZhaoHeader.boundingBox(),
        zhangZhao.boundingBox(),
        removeZhangZhao.boundingBox(),
        poolZhouYu.boundingBox(),
        poolZhouYuButton.boundingBox(),
      ]);
    for (const box of [
      headerBox,
      heroButtonBox,
      removeButtonBox,
      poolBox,
      poolButtonBox,
    ]) {
      expect(box).not.toBeNull();
    }
    expect(headerBox.height).toBeLessThanOrEqual(
      Math.max(heroButtonBox.height, removeButtonBox.height) + 2,
    );
    expect(poolBox.height).toBeLessThanOrEqual(poolButtonBox.height + 2);

    await fire.tap();
    await expect(page.getByText('已选择：烈火张天')).toBeVisible();
    const zhangZhaoRail = zhangZhaoCard.getByTestId('relationship-badges');
    const poolZhouYuRail = poolZhouYu.getByTestId('relationship-badges');
    await expect(zhangZhaoRail.getByText('携带 +0.0621')).toBeVisible();
    await expect(poolZhouYuRail.getByText('同队 +0.0139')).toBeVisible();
    await expectRailContainedByShell(
      poolZhouYu,
      poolZhouYuButton,
      poolZhouYuRail,
    );
    await expectPrimaryContentFullyVisible(poolZhouYuButton);

    await poolZhouYuRail.getByText('同队 +0.0139').tap();
    await expect(page.getByText('已选择：周瑜')).toBeVisible();
    await expect(page.getByTestId('pool-hero-周瑜')).toHaveAttribute(
      'data-preview-state',
      'selected',
    );

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  });

  test('opens every hidden team relationship from +N by touch and keyboard', async ({
    page,
  }) => {
    await seedStoredProgress(page, relationshipPoolProgress);
    await seedTeamBuilderLayout(page, denseTeamRelationshipLayout());
    await openBuilder(page);

    const zhouYu = page.getByTestId('hero-slot-0-1');
    await zhouYu.tap();
    await expect(page.getByText('已选择：周瑜')).toBeVisible();
    const teamRail = page
      .getByTestId('team-card-0')
      .getByTestId('team-relationship-badges');
    await expect(teamRail).toHaveAttribute('data-relationship-count', '5');
    const more = teamRail.getByRole('button', {
      name: '显示另有 2 项队伍关系',
    });
    const [moreTargetBox, moreBadgeBox] = await Promise.all([
      more.boundingBox(),
      more.getByText('+2', { exact: true }).boundingBox(),
    ]);
    expect(moreTargetBox).not.toBeNull();
    expect(moreBadgeBox).not.toBeNull();
    expect(moreTargetBox.width).toBeGreaterThanOrEqual(24);
    expect(moreTargetBox.height).toBeGreaterThanOrEqual(24);
    expect(moreBadgeBox.height).toBeLessThanOrEqual(20);

    await more.tap();
    await expect(page.getByText('已选择：周瑜')).toBeVisible();
    let details = page.getByRole('list', { name: '其余队伍关系' });
    await expect(details.getByRole('listitem')).toHaveCount(2);
    await expect(details).toContainText('缘分·顾曲唱和 −0.0244');
    await expect(details).toContainText('参考 36 场');
    await expect(details).toContainText('缘分·苦肉计 +0.0003');
    await expect(details).toContainText('参考 93 场');
    await more.tap();
    await expect(details).toHaveCount(0);

    await page.getByRole('button', { name: '取消' }).tap();
    await page.getByTestId('skill-slot-0-0-1').focus();
    await page.keyboard.press('Tab');
    await expect(zhouYu).toBeFocused();
    const keyboardMore = teamRail.getByRole('button', {
      name: '显示另有 2 项队伍关系',
    });
    await keyboardMore.focus();
    await keyboardMore.press('Enter');
    details = page.getByRole('list', { name: '其余队伍关系' });
    await expect(details).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(details).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(details).toHaveCount(0);
    await expect(keyboardMore).toBeFocused();
    await expect(keyboardMore).toHaveAttribute('aria-expanded', 'false');

    await keyboardMore.press('Enter');
    details = page.getByRole('list', { name: '其余队伍关系' });
    await expect(details).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(details).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(details).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: '队伍 1 武将配置' }),
    ).toBeFocused();

    const dimensions = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return {
        viewport,
        document: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll('*')]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              testId: element.getAttribute('data-testid'),
              text: element.textContent?.trim().slice(0, 60),
              left: rect.left,
              right: rect.right,
              width: rect.width,
            };
          })
          .filter(({ left, right }) => left < -1 || right > viewport + 1)
          .slice(0, 10),
      };
    });
    expect(dimensions, JSON.stringify(dimensions.overflowing, null, 2)).toMatchObject({
      document: dimensions.viewport,
    });
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
