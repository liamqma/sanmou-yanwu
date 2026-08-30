const { test, expect } = require('@playwright/test');
const database = require('../public/game-data/database.json');
const recommendationData = require('../src/recommendation_data.json');
const { seedStoredProgress } = require('./helpers');

function expectedModelFeature(featureId) {
  const weights = recommendationData.model?.weights;
  const support = recommendationData.model?.support;
  if (
    !weights ||
    !Object.prototype.hasOwnProperty.call(weights, featureId) ||
    !Number.isFinite(weights[featureId])
  ) {
    throw new Error(`Missing finite recommendation weight for ${featureId}`);
  }
  if (
    !support ||
    !Object.prototype.hasOwnProperty.call(support, featureId) ||
    !Number.isInteger(support[featureId])
  ) {
    throw new Error(`Missing integer recommendation support for ${featureId}`);
  }

  const weight = weights[featureId];
  return {
    featureId,
    formattedWeight: `${weight < 0 ? '−' : '+'}${Math.abs(weight).toFixed(4)}`,
    support: support[featureId],
  };
}

const zhangZhaoFire = expectedModelFeature('HS|张昭|烈火张天');
const zhangZhaoLuXun = expectedModelFeature('HP|张昭|陆逊');
const zhangZhaoHuangGai = expectedModelFeature('HP|张昭|黄盖');
const mengHuoTrio = expectedModelFeature('HT|孟获|木鹿大王|祝融');
const diaoChanTrio = expectedModelFeature('HT|孟获|祝融|貂蝉');

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
const relationshipSkills = [
  '烈火张天',
  '风助火势',
  '烈火焚营',
  '胜敌益强',
];
const relationshipPoolProgress = progressFor({
  heroes: relationshipHeroes,
  skills: relationshipSkills,
});
const stabilityPoolProgress = progressFor({
  heroes: relationshipHeroes,
  skills: ['风助火势', '烈火焚营', '烈火张天', '胜敌益强'],
});
const hoverCleanupHeroes = ['孟获', '祝融', '木鹿大王', '貂蝉'];
const hoverCleanupSkills = ['步步为营'];
const hoverCleanupPoolProgress = progressFor({
  heroes: hoverCleanupHeroes,
  skills: hoverCleanupSkills,
});
const qualityHero = '皇甫嵩2';
const qualitySkills = ['忘私相助', '如沐春风'];
const qualityPoolProgress = progressFor({
  heroes: [qualityHero],
  skills: qualitySkills,
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

const hoverCleanupLayout = () => {
  const layout = [emptyStoredTeam(), emptyStoredTeam(), emptyStoredTeam()];
  hoverCleanupHeroes.slice(0, 3).forEach((hero, heroIndex) => {
    layout[0].heroes[heroIndex].hero = hero;
  });
  layout[0].heroes[0].skills[0] = hoverCleanupSkills[0];
  return layout;
};

const qualityLayout = () => {
  const layout = [emptyStoredTeam(), emptyStoredTeam(), emptyStoredTeam()];
  layout[0].heroes[0].hero = qualityHero;
  layout[0].heroes[0].skills = [...qualitySkills];
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

async function expectMinimumTouchTarget(target) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  return box;
}

async function expectFullyExposed(target) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const exposure = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    let left = Math.max(0, rect.left);
    let top = Math.max(0, rect.top);
    let right = Math.min(document.documentElement.clientWidth, rect.right);
    let bottom = Math.min(document.documentElement.clientHeight, rect.bottom);
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      if (/hidden|clip|auto|scroll|overlay/.test(style.overflowX)) {
        left = Math.max(left, bounds.left);
        right = Math.min(right, bounds.right);
      }
      if (/hidden|clip|auto|scroll|overlay/.test(style.overflowY)) {
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
      }
    }
    return {
      height: rect.height,
      width: rect.width,
      exposedHeight: Math.max(0, bottom - top),
      exposedWidth: Math.max(0, right - left),
    };
  });
  expect(exposure.exposedWidth).toBeGreaterThanOrEqual(exposure.width - 1);
  expect(exposure.exposedHeight).toBeGreaterThanOrEqual(exposure.height - 1);
  return exposure;
}

async function expectFullyExposedTouchTarget(target) {
  const exposure = await expectFullyExposed(target);
  expect(exposure.width).toBeGreaterThanOrEqual(44);
  expect(exposure.height).toBeGreaterThanOrEqual(44);
  return exposure;
}

async function expectQualityDropHighlight(surface, expectedBackground) {
  await expect(surface).toHaveAttribute(
    'data-team-builder-drop-highlighted',
    'true',
  );
  const appearance = await surface.evaluate((element) => {
    const parseColor = (value) => {
      const match = value.match(
        /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/,
      );
      if (!match) throw new Error(`Unsupported browser color: ${value}`);
      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] === undefined ? 1 : Number(match[4]),
      ];
    };
    const composite = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      return [
        (foreground[0] * foreground[3] +
          background[0] * background[3] * (1 - foreground[3])) /
          alpha,
        (foreground[1] * foreground[3] +
          background[1] * background[3] * (1 - foreground[3])) /
          alpha,
        (foreground[2] * foreground[3] +
          background[2] * background[3] * (1 - foreground[3])) /
          alpha,
        alpha,
      ];
    };
    const layers = [];
    for (let current = element; current; current = current.parentElement) {
      layers.push(parseColor(getComputedStyle(current).backgroundColor));
    }
    let background = [255, 255, 255, 1];
    for (const layer of layers.reverse()) {
      background = composite(layer, background);
    }
    const style = getComputedStyle(element);
    const marker = parseColor(style.boxShadow);
    const luminance = (color) => {
      const channels = color.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const markerLuminance = luminance(marker);
    const backgroundLuminance = luminance(background);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
      markerContrast:
        (Math.max(markerLuminance, backgroundLuminance) + 0.05) /
        (Math.min(markerLuminance, backgroundLuminance) + 0.05),
    };
  });
  expect(appearance.backgroundColor).toBe(expectedBackground);
  expect(appearance.backgroundImage).not.toBe('none');
  expect(appearance.boxShadow).toContain('rgb(23, 76, 66)');
  expect(appearance.boxShadow).toContain('inset');
  expect(appearance.markerContrast).toBeGreaterThanOrEqual(3);
}

async function expectComboboxTouchTarget(combobox) {
  await expectMinimumTouchTarget(combobox);
  const boxes = await combobox.evaluate((element) => {
    const bounds = (target) => {
      if (!target) throw new Error('Missing autocomplete interaction root');
      const box = target.getBoundingClientRect();
      return { width: box.width, height: box.height };
    };
    return [
      bounds(element.closest('.MuiAutocomplete-inputRoot')),
      bounds(element.closest('.MuiAutocomplete-root')),
    ];
  });
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

async function expectAccessibleContrast(target) {
  const ratio = await target.evaluate((element) => {
    const parseColor = (value) => {
      const match = value.match(
        /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/,
      );
      if (!match) throw new Error(`Unsupported browser color: ${value}`);
      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] === undefined ? 1 : Number(match[4]),
      ];
    };
    const composite = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (foreground[0] * foreground[3] +
          background[0] * background[3] * (1 - foreground[3])) /
          alpha,
        (foreground[1] * foreground[3] +
          background[1] * background[3] * (1 - foreground[3])) /
          alpha,
        (foreground[2] * foreground[3] +
          background[2] * background[3] * (1 - foreground[3])) /
          alpha,
        alpha,
      ];
    };
    const layers = [];
    for (let current = element; current; current = current.parentElement) {
      layers.push(parseColor(getComputedStyle(current).backgroundColor));
    }
    let background = [255, 255, 255, 1];
    for (const layer of layers.reverse()) {
      background = composite(layer, background);
    }
    const foreground = composite(
      parseColor(getComputedStyle(element).color),
      background,
    );
    const luminance = (color) => {
      const channels = color.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

async function expectRailContainedByShell(shell, primary, rail) {
  await expect(rail).toHaveAttribute('data-relationship-transition-state', 'visible');
  await rail.page().waitForTimeout(170);
  const [shellBox, primaryBox, railBox] = await Promise.all([
    shell.boundingBox(),
    primary.boundingBox(),
    rail.boundingBox(),
  ]);
  expect(shellBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(Math.abs(shellBox.height - 46)).toBeLessThanOrEqual(1);
  expect(Math.abs(primaryBox.height - 44)).toBeLessThanOrEqual(1);
  expect(Math.abs(railBox.height - 44)).toBeLessThanOrEqual(1);
  expect(Math.abs(primaryBox.y - (shellBox.y + 1))).toBeLessThanOrEqual(0.2);
  expect(Math.abs(railBox.y - primaryBox.y)).toBeLessThanOrEqual(0.2);
  expect(railBox.y + railBox.height).toBeLessThanOrEqual(
    shellBox.y + shellBox.height - 1 + 0.1,
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
  expect(Math.abs(shellBefore.height - 46)).toBeLessThanOrEqual(1);
  expect(Math.abs(primaryBefore.height - 44)).toBeLessThanOrEqual(1);
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
        '[data-testid="relationship-score-lane"]',
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
  const rail = targetShell.getByTestId('relationship-score-lane');
  await expect(rail).toHaveAttribute(
    'data-relationship-count',
    String(expectedRelationshipCount),
  );
  // Let every one-shot exit settle before checking that a stationary pointer
  // causes no further ownership or DOM oscillation. Several cards can hand off
  // at once, so a fixed delay can end between their independently scheduled
  // passive effects even though each exit itself lasts only 150ms.
  await page.waitForTimeout(180);
  await expect(
    page.locator(
      '[data-testid="relationship-score-lane"][data-relationship-count="0"]',
    ),
  ).toHaveCount(0);
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
    // A rejected gesture can still fire the source's tap-selection fallback.
    // Its alert shifts a near-fold repository card below the viewport, so each
    // retry must restore the source before sending new pointer coordinates.
    await source.scrollIntoViewIfNeeded();
    await expect(source).toBeInViewport();
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
  await expect(page.getByTestId('team-builder-drag-preview')).toBeVisible();

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
    await page.goto('/team-builder');

    await expect(
      page.getByRole('heading', { level: 1, name: '队伍策案' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: '还没有可编排的卡池' })
    ).toBeVisible();
    const backAction = page.getByRole('button', {
      name: '返回',
      exact: true,
    });
    const emptyStateAction = page
      .getByRole('button', { name: '返回对局推荐' })
      .last();
    await expectMinimumTouchTarget(backAction);
    await expectMinimumTouchTarget(emptyStateAction);
    await expect(
      page.getByRole('heading', { name: '我的比赛阵容' })
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: '编辑队伍' })).toHaveCount(0);
  });
});

test.describe('Team Builder manual workshop', () => {
  test.beforeEach(async ({ page, context }) => {
    await seedStoredProgress(page, smallPoolProgress);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('keeps secondary and support-dialog touch targets at 44px', async ({
    page,
  }) => {
    await openBuilder(page);

    await expectMinimumTouchTarget(
      page.getByRole('button', { name: '返回', exact: true })
    );

    await page
      .getByTestId(`pool-hero-${smallHeroes[0]}-primary`)
      .click();
    const cancelSelection = page.getByRole('button', {
      name: '取消',
      exact: true,
    });
    await expectMinimumTouchTarget(cancelSelection);
    await cancelSelection.click();

    await page.getByRole('button', { name: /调整参赛卡池/ }).click();
    const roster = page.getByRole('region', { name: '当前阵容' });
    await roster.getByRole('button', { name: '编辑队伍' }).click();
    await expectComboboxTouchTarget(
      roster.getByRole('combobox', { name: '添加武将...' }),
    );
    await expectComboboxTouchTarget(
      roster.getByRole('combobox', { name: '添加战法...' }),
    );
    await roster
      .getByRole('button', { name: '推荐支援战法' })
      .click();
    const dialog = page.getByRole('dialog', { name: '推荐支援战法' });
    await expect(dialog.getByText(/本次已选 1\/1 个战法/)).toBeVisible();
    await expectComboboxTouchTarget(
      dialog.getByRole('combobox', { name: '搜索战法...' }),
    );

    const closeAction = dialog.getByRole('button', {
      name: '关闭',
      exact: true,
    });
    const confirmAction = dialog.getByRole('button', {
      name: '设为支援战法',
    });
    const closeBox = await expectMinimumTouchTarget(closeAction);
    const confirmBox = await expectMinimumTouchTarget(confirmAction);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(confirmBox.x);

    const deleteTarget = dialog.locator('.MuiChip-deleteIcon').first();
    const deleteBox = await expectMinimumTouchTarget(deleteTarget);
    const selectedChip = deleteTarget.locator('..');
    const [chipBox, labelBox] = await Promise.all([
      selectedChip.boundingBox(),
      selectedChip.locator('.MuiChip-label').boundingBox(),
    ]);
    expect(chipBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(deleteBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width);
    expect(deleteBox.x + deleteBox.width).toBeLessThanOrEqual(
      chipBox.x + chipBox.width
    );
  });

  test('keeps assigned tactic quality readable through interaction states', async ({
    page,
  }) => {
    await seedStoredProgress(page, qualityPoolProgress);
    await seedTeamBuilderLayout(page, qualityLayout(), {
      heroes: [qualityHero],
      skills: qualitySkills,
    });
    await openBuilder(page);

    const orange = page.getByTestId('skill-slot-0-0-0');
    const purple = page.getByTestId('skill-slot-0-0-1');
    const orangeSurface = orange.locator('..');
    const purpleSurface = purple.locator('..');
    const orangeRemove = orangeSurface.getByRole('button', {
      name: `移除战法 ${qualitySkills[0]}`,
    });
    const purpleRemove = purpleSurface.getByRole('button', {
      name: `移除战法 ${qualitySkills[1]}`,
    });

    await expect(orangeSurface).toHaveAttribute('data-skill-quality', 'orange');
    await expect(purpleSurface).toHaveAttribute('data-skill-quality', 'purple');
    await expect(orangeSurface).toHaveCSS(
      'background-color',
      'rgba(214, 154, 56, 0.22)',
    );
    await expect(purpleSurface).toHaveCSS(
      'background-color',
      'rgba(139, 103, 184, 0.2)',
    );
    const boundaries = await Promise.all(
      [orangeSurface, purpleSurface].map((surface) =>
        surface.evaluate((element) => {
          const style = getComputedStyle(element, '::after');
          return { color: style.borderTopColor, style: style.borderTopStyle };
        }),
      ),
    );
    expect(boundaries[0].style).toBe('dashed');
    expect(boundaries[1].style).toBe('dashed');
    expect(boundaries[0].color).not.toBe(boundaries[1].color);

    for (const target of [
      orange.locator('[data-team-builder-primary-content="true"]'),
      purple.locator('[data-team-builder-primary-content="true"]'),
      orangeRemove,
      purpleRemove,
    ]) {
      await expectAccessibleContrast(target);
    }
    await expectMinimumTouchTarget(orangeRemove);
    await expectMinimumTouchTarget(purpleRemove);
    await orangeRemove.hover();
    await expectAccessibleContrast(orangeRemove);
    await purpleRemove.hover();
    await expectAccessibleContrast(purpleRemove);

    await orange.hover();
    const relationshipScore = purpleSurface.getByTestId('relationship-score');
    await expect(relationshipScore).toBeVisible();
    await expectAccessibleContrast(relationshipScore);
    await expectAccessibleContrast(orangeRemove);

    await orange.click();
    await expect(orangeSurface).toHaveCSS('background-color', 'rgb(118, 93, 49)');
    await expectAccessibleContrast(
      orange.locator('[data-team-builder-primary-content="true"]'),
    );
    await expectAccessibleContrast(orangeRemove);
    await expectQualityDropHighlight(
      purpleSurface,
      'rgba(139, 103, 184, 0.2)',
    );
    await page.getByRole('button', { name: '取消', exact: true }).click();

    await purple.hover();
    await expectAccessibleContrast(purpleRemove);
    await purple.click();
    await expect(purpleSurface).toHaveCSS('background-color', 'rgb(104, 77, 130)');
    await expectAccessibleContrast(
      purple.locator('[data-team-builder-primary-content="true"]'),
    );
    await expectAccessibleContrast(purpleRemove);
    await expectQualityDropHighlight(
      orangeSurface,
      'rgba(214, 154, 56, 0.22)',
    );
    await page.getByRole('button', { name: '取消', exact: true }).click();

    await startPointerDrag(page, orange);
    await movePointerTo(page, purple);
    await expectQualityDropHighlight(
      purpleSurface,
      'rgba(139, 103, 184, 0.2)',
    );
    await page.mouse.up();
    await expect(orangeSurface).toHaveAttribute('data-skill-quality', 'purple');
    await expect(purpleSurface).toHaveAttribute('data-skill-quality', 'orange');
    await expect(page.locator('[data-dnd-dragging="true"]')).toHaveCount(0);
    await page.waitForTimeout(300);

    await startPointerDrag(page, orange);
    await movePointerTo(page, purple);
    await expectQualityDropHighlight(
      purpleSurface,
      'rgba(214, 154, 56, 0.22)',
    );
    await page.mouse.up();
    await expect(orangeSurface).toHaveAttribute('data-skill-quality', 'orange');
    await expect(purpleSurface).toHaveAttribute('data-skill-quality', 'purple');
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

    const [heroArtBox, heroControlsBox] = await Promise.all([
      page
        .getByTestId('hero-art-0-0')
        .getByTestId(`game-card-hero-${smallHeroes[0]}`)
        .boundingBox(),
      page.getByTestId('hero-controls-0-0').boundingBox(),
    ]);
    expect(heroArtBox).not.toBeNull();
    expect(heroControlsBox).not.toBeNull();
    expect(
      Math.abs(
        heroArtBox.y + heroArtBox.height -
          (heroControlsBox.y + heroControlsBox.height),
      ),
    ).toBeLessThanOrEqual(1);
    expect(heroArtBox.width / heroArtBox.height).toBeGreaterThanOrEqual(0.58);
    expect(heroArtBox.width / heroArtBox.height).toBeLessThanOrEqual(0.68);

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
      page.getByTestId(`pool-hero-${smallHeroes[0]}`),
      page.getByTestId('hero-slot-0-0')
    );
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      smallHeroes[0]
    );

    await dragWholeBlock(
      page,
      page.getByTestId(`pool-skill-${smallSkills[0]}`),
      page.getByTestId('skill-slot-0-0-0')
    );
    await expect(page.getByTestId('skill-slot-0-0-0')).toContainText(
      smallSkills[0]
    );
    await dragWholeBlock(
      page,
      page.getByTestId('skill-slot-0-0-0').locator('..'),
      page.getByTestId('skill-slot-0-0-1')
    );
    await expect(page.getByTestId('skill-slot-0-0-1')).toContainText(
      smallSkills[0]
    );
    await dragWholeBlock(
      page,
      page.getByTestId('hero-art-0-0'),
      page.getByTestId('hero-art-0-1')
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
      '拖入或点选战法'
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
    await page.getByTestId('hero-slot-0-0').locator('..').press('Enter');
    await expect(page.getByTestId('hero-slot-0-0')).toContainText(
      smallHeroes[0]
    );

    await page.getByTestId('hero-slot-0-0').locator('..').press('Enter');
    await page
      .getByRole('button', { name: '放回武将仓库' })
      .press('Enter');
    await expect(page.getByTestId(`pool-hero-${smallHeroes[0]}`)).toBeVisible();

    await page
      .getByRole('button', { name: `选择武将 ${smallHeroes[0]}` })
      .press('Enter');
    await page.getByTestId('hero-slot-0-0').locator('..').press('Enter');
    await page.getByTestId('hero-slot-0-0').locator('..').press('Enter');
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

  test('shows one aggregate per target and complete mouse/keyboard breakdowns', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    const teamCard = page.getByTestId('team-card-0');
    const teamScoreBefore = await teamCard.getByTestId('team-strength').innerText();
    const evidenceSnapshot = () =>
      teamCard.getByTestId('team-evidence').evaluateAll((rows) =>
        rows.map((row) => ({
          text: row.textContent,
          title: row.getAttribute('title'),
        })),
      );
    const evidenceBefore = await evidenceSnapshot();
    expect(evidenceBefore.map(({ text }) => text).join(' ')).not.toMatch(
      /同阵营|缘分/,
    );
    await expect(teamCard).not.toContainText(/同阵营|缘分/);
    const fire = page.getByTestId('skill-slot-0-0-0');
    await fire.hover();
    expect(await evidenceSnapshot()).toEqual(evidenceBefore);
    await expect(teamCard).not.toContainText(/同阵营|缘分/);
    await expect(fire).toHaveAttribute('data-preview-state', 'selected');

    const zhangZhaoCard = page.getByTestId('hero-card-0-0');
    const zhangZhaoScore = zhangZhaoCard.getByTestId('relationship-score');
    await expect(zhangZhaoScore).toHaveText(zhangZhaoFire.formattedWeight);
    await expect(zhangZhaoCard.getByTestId('relationship-score')).toHaveCount(1);
    await expect(zhangZhaoScore).toHaveAccessibleName(
      `张昭与烈火张天的关系总分 ${zhangZhaoFire.formattedWeight}，共 1 项；查看完整明细`,
    );
    await zhangZhaoScore.focus();
    await zhangZhaoScore.press('Enter');
    const zhangBreakdown = page.getByRole('dialog');
    await expect(zhangBreakdown).toContainText(
      `张昭 × 烈火张天 ${zhangZhaoFire.formattedWeight}`,
    );
    await expect(zhangBreakdown.getByTestId('relationship-detail-row')).toHaveCount(1);
    await expect(zhangBreakdown).toContainText(
      `携带${zhangZhaoFire.formattedWeight} · 参考 ${zhangZhaoFire.support} 场`,
    );
    await expect(zhangBreakdown).not.toContainText(/同队|战法搭配|机制/);
    await page.getByRole('button', { name: '关闭关系分明细' }).click();

    const luXunCard = page.getByTestId('hero-card-0-1');
    await expect(luXunCard.getByTestId('relationship-score')).toHaveCount(0);
    await expect(
      page.getByTestId('pool-skill-风助火势').getByTestId('relationship-score'),
    ).toHaveCount(0);
    await expect(
      page.getByTestId('pool-skill-胜敌益强').getByTestId('relationship-score'),
    ).toHaveCount(0);
    await expect(page.getByTestId('pool-hero-曹操')).toHaveAttribute(
      'data-preview-state',
      'unrelated',
    );
    await expect(page.getByTestId('pool-hero-曹操')).toHaveCSS(
      'opacity',
      '1',
    );

    const pageHeading = page.getByRole('heading', {
      level: 1,
      name: '队伍策案',
    });
    await page.evaluate(() => document.activeElement?.blur());
    await pageHeading.hover();
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    await expect(
      page.locator(
        '[data-testid="relationship-score-lane"]:not([data-relationship-count="0"])',
      ),
    ).toHaveCount(0);

    await page.getByTestId('hero-slot-0-0').hover();
    await expect(luXunCard.getByTestId('relationship-score')).toHaveText(
      zhangZhaoLuXun.formattedWeight,
    );
    await expect(
      page.getByTestId('hero-card-0-2').getByTestId('relationship-score'),
    ).toHaveText(zhangZhaoHuangGai.formattedWeight);
    await expect(
      fire.locator('..').getByTestId('relationship-score'),
    ).toHaveText(zhangZhaoFire.formattedWeight);
    await expect(
      page.getByTestId('pool-skill-胜敌益强').getByTestId('relationship-score'),
    ).toHaveCount(0);
    expect(await evidenceSnapshot()).toEqual(evidenceBefore);
    await expect(teamCard).not.toContainText(/同阵营|缘分/);
    await expect(teamCard.getByTestId('team-strength')).toHaveText(
      teamScoreBefore,
    );

    await pageHeading.hover();
    await expect(page.getByTestId('team-relationship-score-lane')).toHaveCount(0);
  });

  test('executes relationship transitions with normal and reduced motion', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, richPairRelationshipLayout());
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openBuilder(page);

    const source = page.getByTestId('skill-slot-0-0-0');
    const lane = page
      .getByTestId('skill-slot-0-0-1')
      .locator('..')
      .getByTestId('relationship-score-lane');
    await source.hover();
    await expect(lane).toHaveAttribute(
      'data-relationship-transition-state',
      'visible',
    );
    const normalStyle = await lane.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        duration: style.transitionDuration,
        property: style.transitionProperty,
        timing: style.transitionTimingFunction,
      };
    });
    expect(normalStyle).toEqual({
      duration: '0.15s, 0.15s',
      property: 'opacity, transform',
      timing: 'ease, ease',
    });

    await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
    await expect(lane).toHaveAttribute(
      'data-relationship-transition-state',
      'exiting',
    );
    const normalAnimations = await lane.evaluate((element) =>
      element.getAnimations().map((animation) => ({
        property:
          'transitionProperty' in animation
            ? animation.transitionProperty
            : null,
        transforms: animation.effect
          ? animation.effect
              .getKeyframes()
              .map((keyframe) => keyframe.transform)
              .filter(Boolean)
          : [],
      })),
    );
    expect(
      [...new Set(normalAnimations.map(({ property }) => property))].sort(),
    ).toEqual(['opacity', 'transform']);
    expect(
      normalAnimations
        .flatMap(({ transforms }) => transforms)
        .some(
          (transform) =>
            transform === 'translateY(2px)' ||
            /matrix\([^)]*,\s*2\)$/.test(transform),
        ),
    ).toBe(true);

    await page.waitForTimeout(170);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await source.hover();
    await expect(lane).toHaveAttribute(
      'data-relationship-transition-state',
      'visible',
    );
    const reducedStyle = await lane.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        duration: style.transitionDuration,
        transform: style.transform,
        animations: element.getAnimations().length,
      };
    });
    expect(reducedStyle).toEqual({
      duration: '0s',
      transform: 'none',
      animations: 0,
    });
  });

  test('keeps a repository HS source stable on desktop and 320px', async ({
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
      const source = sourceCard;
      const targetCard = page.getByTestId('hero-card-0-0');
      const targetPrimary = page.getByTestId('hero-slot-0-0');
      const unrelatedCard = page.getByTestId('pool-skill-烈火焚营');

      await assertStationaryPreviewStability(page, {
        source,
        sourceCard,
        tracked: [grid, targetCard, unrelatedCard],
      });
      const targetRail = targetCard.getByTestId('relationship-score-lane');
      await expect(targetRail).toBeVisible();
      await expectRailContainedByShell(
        targetPrimary.locator('..'),
        targetPrimary,
        targetRail,
      );
      await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
      await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    }
  });

  test('keeps stationary lower and boundary pointers stable for direct HS', async ({
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
      const owner = page.getByTestId('pool-skill-烈火张天');
      const targetPrimary = page.getByTestId('hero-slot-0-0');
      const targetShell = targetPrimary.locator('..');

      for (const yOffset of [1, 22, 44]) {
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
        await page.evaluate(() => document.activeElement?.blur());
        await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
        await page.waitForTimeout(180);
      }
    }
  });

  test('keeps stationary assigned hero and skill relationship rails stable on desktop and 320px', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, richPairRelationshipLayout());

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openBuilder(page);

      const heroOwner = page.getByTestId('hero-slot-0-0').locator('..');
      const heroTargetPrimary = page.getByTestId('hero-slot-0-1');
      await assertStationaryRelationshipActivation(page, {
        owner: heroOwner,
        targetShell: heroTargetPrimary.locator('..'),
        targetPrimary: heroTargetPrimary,
        targetContent: heroTargetPrimary.locator(
          '[data-team-builder-primary-content="true"]',
        ),
        yOffset: 22,
        expectedRelationshipCount: 1,
      });
      await page.evaluate(() => document.activeElement?.blur());
      await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
      await page.waitForTimeout(180);

      const skillOwner = page.getByTestId('skill-slot-0-0-0').locator('..');
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
        expectedRelationshipCount: 1,
      });
      await assertStationaryRelationshipActivation(page, {
        owner: skillOwner,
        targetShell: skillTargetShell,
        targetPrimary: skillTargetPrimary,
        targetContent: skillTargetPrimary.locator(
          '[data-team-builder-primary-content="true"]',
        ),
        xFraction: 0.92,
        yOffset: 22,
        expectedRelationshipCount: 1,
        expectInitialTarget: false,
      });
      const aggregateScore = skillTargetShell.getByTestId('relationship-score');
      await expect(aggregateScore).toHaveCount(1);
      await aggregateScore.press('Enter');
      await expect(page.getByTestId('relationship-detail-row')).toHaveCount(1);
      await page.keyboard.press('Escape');
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

  test('keeps the 孟获 relationship evidence stable and exposes every item weight', async ({
    page,
  }) => {
    await seedStoredProgress(page, hoverCleanupPoolProgress);
    await seedTeamBuilderLayout(page, hoverCleanupLayout(), {
      heroes: hoverCleanupHeroes,
      skills: hoverCleanupSkills,
    });

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await openBuilder(page);

      const teamCard = page.getByTestId('team-card-0');
      const teamSummary = page.getByTestId('team-summary-0');
      const source = page.getByTestId('skill-slot-0-0-0');
      const sourceCard = source.locator('..');
      const evidenceSnapshot = () =>
        teamCard.getByTestId('team-evidence').evaluateAll((rows) =>
          rows.map((row) => ({
            text: row.textContent,
            title: row.getAttribute('title'),
          })),
        );
      const evidenceBefore = await evidenceSnapshot();
      expect(evidenceBefore.map(({ text }) => text).join(' ')).not.toMatch(
        /同队|战法搭配|机制|同阵营|缘分/,
      );
      expect(evidenceBefore.map(({ title }) => title).join(' ')).not.toContain(
        '孟获 + 木鹿大王 + 祝融',
      );
      await expect(teamCard).not.toContainText(
        /同队|战法搭配|机制|同阵营|缘分/,
      );
      const scoreBefore = await teamCard.getByTestId('team-strength').innerText();

      await assertStationaryPreviewStability(page, {
        source,
        sourceCard,
        tracked: [teamCard, teamSummary],
      });

      expect(await evidenceSnapshot()).toEqual(evidenceBefore);
      await expect(teamCard.getByTestId('team-strength')).toHaveText(scoreBefore);
      await expect(teamCard).not.toContainText(/同阵营|缘分/);
      await expect(page.getByTestId('team-relationship-status')).toHaveCount(0);
      await expect(page.getByTestId('team-relationship-score-lane')).toHaveCount(0);

      const mengHuoScore = page
        .getByTestId('hero-card-0-0')
        .getByTestId('relationship-score');
      await expect(mengHuoScore).toHaveCount(1);
      await mengHuoScore.click();
      const breakdown = page.getByRole('dialog');
      await expect(breakdown.locator('[data-feature-id="HS|孟获|步步为营"]')).toHaveCount(1);
      await expect(breakdown.locator('[data-feature-id^="THS|"]')).toHaveCount(0);
      await expect(breakdown.locator('[data-feature-id^="TSP|"]')).toHaveCount(0);
      await expect(breakdown.locator('[data-feature-id^="M|"]')).toHaveCount(0);
      await expect(breakdown.getByTestId('relationship-detail-row')).toHaveCount(1);
      await page.keyboard.press('Escape');
      for (const visibleScore of await page.getByTestId('relationship-score').all()) {
        await expect(visibleScore).not.toHaveAccessibleName(
          /同队|战法搭配|机制|同阵营|缘分/,
        );
      }
      await page.evaluate(() => document.activeElement?.blur());
      await source.hover();
      const activeGroups = page.locator(
        '[data-relationship-transition-state="visible"]',
      );
      await expect(activeGroups.first()).toHaveCSS(
        'transition-property',
        'opacity, transform',
      );
      await expect(activeGroups.first()).toHaveCSS(
        'transition-duration',
        '0.15s, 0.15s',
      );

      await page.getByTestId('hero-slot-0-0').hover();
      const trioLane = page.getByTestId('team-relationship-score-lane-0');
      const trioScore = trioLane.getByTestId('relationship-score');
      await expect(trioScore).toHaveText(
        `三人组 ${mengHuoTrio.formattedWeight}`,
      );
      await expect(trioScore).toHaveAccessibleName(
        /精确武将三人组孟获、木鹿大王、祝融/,
      );
      await expect(page.locator('[data-feature-id="HT|孟获|木鹿大王|祝融"]')).toHaveCount(0);
      await trioScore.focus();
      await trioScore.press('Enter');
      const trioBreakdown = page.getByRole('dialog');
      await expect(trioBreakdown.locator('[data-feature-id="HT|孟获|木鹿大王|祝融"]')).toHaveCount(1);
      await expect(trioBreakdown.getByTestId('relationship-detail-row')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.activeElement?.blur());

      await page.getByRole('heading', { level: 1, name: '队伍策案' }).hover();
      await page.waitForTimeout(180);
      expect(await evidenceSnapshot()).toEqual(evidenceBefore);
      await expect(teamCard.getByTestId('team-strength')).toHaveText(scoreBefore);
      await expect(teamCard).not.toContainText(
        /同队|战法搭配|机制|同阵营|缘分/,
      );
      await expect(page.locator('[data-preview-state]')).toHaveCount(0);

      const dimensions = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('skill-slot-0-0-0').hover();
    const reducedGroup = page.locator(
      '[data-relationship-transition-state="visible"]',
    ).first();
    await expect(reducedGroup).toHaveCSS('transition-duration', '0s');
    await expect(reducedGroup).toHaveCSS('transform', 'none');
  });

  test('keeps exact HT interactive while the pointer crosses same-team heroes', async ({
    page,
  }) => {
    await seedStoredProgress(page, hoverCleanupPoolProgress);
    await seedTeamBuilderLayout(page, hoverCleanupLayout(), {
      heroes: hoverCleanupHeroes,
      skills: hoverCleanupSkills,
    });
    await openBuilder(page);

    await page.getByTestId('hero-slot-0-2').hover();
    const trioLane = page.getByTestId('team-relationship-score-lane-0');
    const trioScore = trioLane.getByTestId('relationship-score');
    await expect(trioScore).toHaveText(`三人组 ${mengHuoTrio.formattedWeight}`);
    await expect(trioLane.getByTestId('relationship-score-lane')).toHaveAttribute(
      'data-relationship-transition-state',
      'visible',
    );

    const scoreBox = await trioScore.boundingBox();
    expect(scoreBox).not.toBeNull();
    await page.mouse.move(
      scoreBox.x + scoreBox.width / 2,
      scoreBox.y + scoreBox.height / 2,
      { steps: 12 },
    );
    await expect(trioLane.getByTestId('relationship-score-lane')).toHaveAttribute(
      'data-relationship-transition-state',
      'visible',
    );
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.getByRole('dialog')).toContainText(
      `队伍 1 · 精确三人组 孟获、木鹿大王、祝融 ${mengHuoTrio.formattedWeight}`,
    );
  });

  test('shows one exact HT for a concrete post-replacement hero drag', async ({
    page,
  }) => {
    await seedStoredProgress(page, hoverCleanupPoolProgress);
    await seedTeamBuilderLayout(page, hoverCleanupLayout(), {
      heroes: hoverCleanupHeroes,
      skills: hoverCleanupSkills,
    });
    await openBuilder(page);

    const diaoChan = page.getByTestId('pool-hero-貂蝉');
    await diaoChan.hover();
    await expect(
      page.locator('[data-testid^="team-relationship-score-lane-"]')
        .getByTestId('relationship-score'),
    ).toHaveCount(0);

    const replacementSlot = page.getByTestId('hero-slot-0-2');
    await replacementSlot.scrollIntoViewIfNeeded();
    await startPointerDrag(page, diaoChan);
    await movePointerTo(page, replacementSlot);
    const prospectiveTrio = page
      .getByTestId('team-relationship-score-lane-0')
      .getByTestId('relationship-score');
    await expect(prospectiveTrio).toHaveText(
      `三人组 ${diaoChanTrio.formattedWeight}`,
    );
    await expect(prospectiveTrio).toHaveAccessibleName(
      /精确武将三人组孟获、祝融、貂蝉/,
    );
    await expect(
      page.locator('[data-testid^="team-relationship-score-lane-"]')
        .getByTestId('relationship-score'),
    ).toHaveCount(1);

    await page.mouse.up();
    await expect(page.getByTestId('hero-slot-0-2')).toContainText('貂蝉');
    await page.getByTestId('hero-slot-0-2').hover();
    const activeTrio = page
      .getByTestId('team-relationship-score-lane-0')
      .getByTestId('relationship-score');
    await activeTrio.focus();
    await activeTrio.press('Enter');
    const breakdown = page.getByRole('dialog');
    await expect(
      breakdown.locator('[data-feature-id="HT|孟获|祝融|貂蝉"]'),
    ).toHaveCount(1);
    await expect(breakdown.getByTestId('relationship-detail-row')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement?.blur());

    await page.getByRole('button', { name: '移除武将 祝融' }).click();
    await page.getByTestId('hero-slot-0-0').hover();
    await expect(
      page.locator('[data-testid^="team-relationship-score-lane-"]')
        .getByTestId('relationship-score'),
    ).toHaveCount(0);
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

    const poolHero = page.getByTestId('pool-hero-曹操');
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
    const skillScore = page
      .getByTestId('skill-slot-0-1-0')
      .locator('..')
      .getByTestId('relationship-score');
    await expect(skillScore).toHaveText(zhangZhaoFire.formattedWeight);
    await movePointerTo(page, skillScore);
    await page.mouse.up();

    await expect(page.locator('[data-dnd-dragging="true"]')).toHaveCount(0);
    await expect(zhangZhao).toContainText('张昭');
    await expect(luXun).toContainText('陆逊');
  });

  test('opens a score without selecting or dragging its related card', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    await page.getByTestId('skill-slot-0-0-0').hover();
    const zhangZhaoScore = page
      .getByTestId('hero-card-0-0')
      .getByTestId('relationship-score');
    await expect(zhangZhaoScore).toHaveText(zhangZhaoFire.formattedWeight);
    await zhangZhaoScore.focus();
    await zhangZhaoScore.press('Enter');

    await expect(page.getByRole('dialog')).toContainText(
      `张昭 × 烈火张天 ${zhangZhaoFire.formattedWeight}`,
    );
    await expect(page.getByText('已选择：烈火张天')).toHaveCount(0);
    await expect(page.getByTestId('hero-slot-0-2')).toContainText('黄盖');
  });

  test('uses keyboard focus and tap selection, then clears each transient state', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(page, relationshipLayout());
    await openBuilder(page);

    const teamCard = page.getByTestId('team-card-0');
    const evidenceSnapshot = () =>
      teamCard.getByTestId('team-evidence').evaluateAll((rows) =>
        rows.map((row) => ({
          text: row.textContent,
          title: row.getAttribute('title'),
        })),
      );
    const evidenceBefore = await evidenceSnapshot();
    const scoreBefore = await teamCard.getByTestId('team-strength').innerText();
    const expectPermanentEvidenceUnchanged = async () => {
      expect(await evidenceSnapshot()).toEqual(evidenceBefore);
      await expect(teamCard.getByTestId('team-strength')).toHaveText(scoreBefore);
      await expect(teamCard).not.toContainText(/同阵营|缘分/);
    };
    await expectPermanentEvidenceUnchanged();

    const fire = page.getByTestId('skill-slot-0-0-0');
    await fire.locator('..').focus();
    await expect(fire).toHaveAttribute('data-preview-state', 'selected');
    await expectPermanentEvidenceUnchanged();
    const focusedZhangZhaoScore = page
      .getByTestId('hero-card-0-0')
      .getByTestId('relationship-score');
    await expect(focusedZhangZhaoScore).toHaveText(
      zhangZhaoFire.formattedWeight,
    );
    await focusedZhangZhaoScore.focus();
    await focusedZhangZhaoScore.press('Enter');
    await expect(page.getByRole('dialog')).toContainText(
      `携带${zhangZhaoFire.formattedWeight} · 参考 ${zhangZhaoFire.support} 场`,
    );
    await expect(page.getByRole('dialog')).not.toContainText(
      /同队|战法搭配|机制/,
    );
    await expectPermanentEvidenceUnchanged();
    await page.keyboard.press('Escape');

    await page.evaluate(() => document.activeElement?.blur());
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);

    await fire.click();
    await expect(page.getByText('已选择：烈火张天')).toBeVisible();
    await expect(fire).toHaveAttribute('data-preview-state', 'selected');
    await expect(
      page.getByTestId('hero-card-0-0').getByTestId('relationship-score'),
    ).toHaveText(zhangZhaoFire.formattedWeight);
    await expectPermanentEvidenceUnchanged();

    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('已选择：烈火张天')).toHaveCount(0);
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
  });

  test('keeps M hidden before and after a concrete warehouse drag target', async ({
    page,
  }) => {
    await seedTeamBuilderLayout(
      page,
      relationshipLayout({ fireAssigned: false }),
    );
    await openBuilder(page);

    const fire = page.getByTestId('pool-skill-烈火张天');
    const teamCard = page.getByTestId('team-card-0');
    const scoreBefore = await teamCard.getByTestId('team-strength').innerText();
    const evidenceBefore = await teamCard
      .getByTestId('team-evidence')
      .evaluateAll((rows) =>
        rows.map((row) => ({
          text: row.textContent,
          title: row.getAttribute('title'),
        })),
      );
    await fire.hover();
    const luXunCard = page.getByTestId('hero-card-0-1');
    await expect(luXunCard.getByTestId('relationship-score')).toHaveCount(0);

    await startPointerDrag(page, fire);
    await expect(
      page.getByTestId('pool-skill-烈火张天'),
    ).toHaveAttribute('data-preview-state', 'selected');
    await movePointerTo(page, page.getByTestId('skill-slot-0-1-0'));
    await expect(luXunCard.getByTestId('relationship-score')).toHaveCount(0);
    for (const score of await page.getByTestId('relationship-score').all()) {
      await expect(score).not.toHaveAccessibleName(/同队|战法搭配|机制/);
    }
    await expect(teamCard.getByTestId('team-strength')).toHaveText(scoreBefore);
    expect(
      await teamCard.getByTestId('team-evidence').evaluateAll((rows) =>
        rows.map((row) => ({
          text: row.textContent,
          title: row.getAttribute('title'),
        })),
      ),
    ).toEqual(evidenceBefore);
    await page.mouse.up();
    await expect(page.locator('[data-dnd-dragging="true"]')).toHaveCount(0);
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
  });

  test('clears contextual previews after a cancelled drag', async ({ page }) => {
    await seedTeamBuilderLayout(
      page,
      relationshipLayout({ thirdHero: '曹操' }),
    );
    await openBuilder(page);

    const huangGai = page.getByTestId('pool-hero-黄盖');
    await startPointerDrag(page, huangGai);
    await movePointerTo(
      page,
      page.getByRole('heading', { level: 1, name: '队伍策案' }),
    );
    await page.mouse.up();

    await expect(page.getByTestId('pool-hero-黄盖')).toBeVisible();
    await expect(page.locator('[data-preview-state]')).toHaveCount(0);
    await expect(page.getByTestId('team-relationship-score-lane')).toHaveCount(0);
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
      .locator('[aria-label^="队伍 "][aria-label*="武将位"]')
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
    await expectMinimumTouchTarget(restoreButton);
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

  test('exposes complete hero controls and tactic names at 320px', async ({
    page,
  }) => {
    await seedStoredProgress(page, qualityPoolProgress);
    await seedTeamBuilderLayout(page, qualityLayout(), {
      heroes: [qualityHero],
      skills: qualitySkills,
    });
    await openBuilder(page);

    const region = page.getByRole('region', { name: '队伍 1 武将配置' });
    const card = page.getByTestId('hero-card-0-0');
    const art = page.getByTestId('hero-art-0-0');
    const controls = page.getByTestId('hero-controls-0-0');
    const geometry = await card.evaluate((element) => {
      const bounds = (target) => {
        if (!target) throw new Error('Missing hero card section');
        const rect = target.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      };
      return {
        art: bounds(element.querySelector('[data-testid="hero-art-0-0"]')),
        card: bounds(element),
        controls: bounds(
          element.querySelector('[data-testid="hero-controls-0-0"]'),
        ),
      };
    });
    expect(geometry.card.width).toBeGreaterThanOrEqual(325);
    expect(geometry.art.width).toBeGreaterThanOrEqual(141);
    expect(geometry.art.height).toBeGreaterThanOrEqual(220);
    expect(geometry.controls.width).toBeGreaterThanOrEqual(163);
    expect(geometry.controls.left).toBeGreaterThanOrEqual(
      geometry.art.right + 5,
    );
    expect(geometry.controls.right).toBeLessThanOrEqual(
      geometry.card.right - 5,
    );
    expect(geometry.controls.top).toBeGreaterThanOrEqual(geometry.card.top);
    expect(geometry.controls.bottom).toBeLessThanOrEqual(
      geometry.card.bottom,
    );

    const scrollGeometry = await region.evaluate((element) => ({
      clientWidth: element.clientWidth,
      overflowX: getComputedStyle(element).overflowX,
      scrollWidth: element.scrollWidth,
    }));
    expect(scrollGeometry.overflowX).toBe('auto');
    expect(scrollGeometry.scrollWidth).toBeGreaterThan(
      scrollGeometry.clientWidth,
    );

    const rowSelector = page.getByRole('group', {
      name: `${qualityHero}站位`,
    });
    for (const row of ['前排', '后排']) {
      await expectFullyExposedTouchTarget(
        rowSelector.getByRole('button', { name: `${qualityHero} ${row}` }),
      );
    }

    for (const [skillIndex, skill] of qualitySkills.entries()) {
      const primary = page.getByTestId(`skill-slot-0-0-${skillIndex}`);
      const surface = primary.locator('..');
      const remove = surface.getByRole('button', {
        name: `移除战法 ${skill}`,
      });
      await expectFullyExposed(surface);
      await expectFullyExposedTouchTarget(primary);
      await expectFullyExposedTouchTarget(remove);
      const label = primary.locator(
        '[data-team-builder-primary-content="true"]',
      );
      await expectFullyExposed(label);
      const labelGeometry = await label.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        width: element.getBoundingClientRect().width,
      }));
      expect(labelGeometry.width).toBeGreaterThanOrEqual(
        labelGeometry.scrollWidth - 1,
      );
      expect(labelGeometry.scrollWidth).toBeLessThanOrEqual(
        labelGeometry.clientWidth + 1,
      );
    }

    const dimensions = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await expect(art).toBeVisible();
    await expect(controls).toBeVisible();
  });

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

  test('keeps direct score breakdown and relation-free card taps usable at 320px', async ({
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
    const poolZhouYuButton = poolZhouYu.getByTestId('pool-hero-周瑜-primary');

    await expect(zhangZhaoCard.getByTestId('relationship-score-lane')).toHaveCount(0);
    await expect(poolZhouYu.getByTestId('relationship-score-lane')).toHaveCount(0);
    await expect(page.getByTestId('team-relationship-score-lane')).toHaveCount(0);

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
    expect(Math.abs(headerBox.height - 46)).toBeLessThanOrEqual(1);
    expect(Math.abs(heroButtonBox.height - 44)).toBeLessThanOrEqual(1);
    expect(Math.abs(removeButtonBox.height - 44)).toBeLessThanOrEqual(1);
    expect(Math.abs(poolBox.height - 46)).toBeLessThanOrEqual(1);
    expect(Math.abs(poolButtonBox.height - 44)).toBeLessThanOrEqual(1);
    expect(heroButtonBox.y + heroButtonBox.height).toBeLessThanOrEqual(
      headerBox.y + 45.1,
    );
    expect(poolButtonBox.y + poolButtonBox.height).toBeLessThanOrEqual(
      poolBox.y + 45.1,
    );

    await zhangZhaoHeader.tap({ position: { x: 12, y: 22 } });
    await expect(page.getByText('已选择：张昭')).toBeVisible();
    await zhangZhaoHeader.tap({ position: { x: 12, y: 22 } });
    await expect(page.getByText('已选择：张昭')).toHaveCount(0);

    await fire.locator('..').tap({ position: { x: 12, y: 22 } });
    await expect(page.getByText('已选择：烈火张天')).toBeVisible();
    const zhangZhaoRail = zhangZhaoHeader.getByTestId('relationship-score-lane');
    const poolZhouYuRail = poolZhouYu.getByTestId('relationship-score-lane');
    await expect(
      zhangZhaoRail.getByTestId('relationship-score'),
    ).toHaveText(zhangZhaoFire.formattedWeight);
    await expect(poolZhouYuRail).toHaveCount(0);
    await expectRailContainedByShell(
      zhangZhaoHeader,
      zhangZhao,
      zhangZhaoRail,
    );
    await expectPrimaryContentFullyVisible(poolZhouYuButton);

    await zhangZhaoRail.getByTestId('relationship-score').tap();
    const detail = page.getByRole('dialog');
    await expect(detail).toContainText(
      `张昭 × 烈火张天 ${zhangZhaoFire.formattedWeight}`,
    );
    await expect(page.getByText('已选择：烈火张天')).toBeVisible();
    const detailBox = await detail.boundingBox();
    expect(detailBox).not.toBeNull();
    expect(detailBox.x).toBeGreaterThanOrEqual(0);
    expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(320);

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);

    await page.getByRole('button', { name: '关闭关系分明细' }).tap();
    await expect(detail).toHaveCount(0);
    const poolWind = page.getByTestId('pool-skill-风助火势');
    const poolWindButton = poolWind.getByTestId('pool-skill-风助火势-primary');
    await poolWindButton.scrollIntoViewIfNeeded();
    await expect(poolWind.getByTestId('relationship-score-lane')).toHaveCount(0);
    await poolWind.tap({ position: { x: 12, y: 22 } });
    await expect(page.getByText('已选择：风助火势')).toBeVisible();
    await expect(page.getByText('已选择：烈火张天')).toHaveCount(0);
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
      page.getByTestId(`pool-hero-${smallHeroes[1]}`),
    ]) {
      await expect(dragSurface).toHaveCSS('touch-action', 'manipulation');
    }
    await expect(
      page.getByRole('button', { name: /拖动(?:武将|战法)/ })
    ).toHaveCount(0);

    const scrollSource = page.getByTestId(`pool-hero-${smallHeroes[1]}`);
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
