const { test, expect } = require('@playwright/test');
const recommendationData = require('../src/recommendation_data.json');
const { database, seedGame, makeGameState } = require('./helpers');

function relationshipFixture() {
  const { model } = recommendationData;
  const byHero = new Map();

  for (const [featureId, weight] of Object.entries(model.weights)) {
    const [family, source, target] = featureId.split('|');
    if (
      !['HP', 'HS'].includes(family) ||
      !Number.isFinite(weight) ||
      weight === 0 ||
      (model.support[featureId] ?? 0) < model.min_support_pair
    ) {
      continue;
    }

    for (const [focus, other] of [
      [source, target],
      [target, source],
    ]) {
      if (!database.heroes[focus]) continue;
      const relationships = byHero.get(focus) ?? { positive: [], negative: [] };
      relationships[weight > 0 ? 'positive' : 'negative'].push({
        featureId,
        other,
        weight,
      });
      byHero.set(focus, relationships);
    }
  }

  for (const [focus, relationships] of byHero) {
    relationships.positive.sort((a, b) => b.weight - a.weight);
    relationships.negative.sort((a, b) => a.weight - b.weight);
    if (relationships.positive.length < 6 || relationships.negative.length < 1) {
      continue;
    }

    const selected = [
      ...relationships.positive.slice(0, 6),
      relationships.negative[0],
    ];
    const heroes = [focus];
    const skills = [];
    for (const relationship of selected) {
      if (database.heroes[relationship.other]) heroes.push(relationship.other);
      if (database.skills[relationship.other]) skills.push(relationship.other);
    }

    return {
      focus,
      negativeTarget: relationships.negative[0].other,
      heroes: [...new Set(heroes)],
      skills: [...new Set(skills)],
    };
  }

  throw new Error('No roster relationship fixture has six positive edges');
}

const fixture = relationshipFixture();

function rosterState() {
  const state = makeGameState({
    roundNumber: 6,
    heroes: fixture.heroes.slice(0, -1),
    skills: fixture.skills.slice(0, -1),
  });
  return {
    ...state,
    support_hero: fixture.heroes.at(-1) ?? null,
    support_skills: fixture.skills.length ? [fixture.skills.at(-1)] : [],
  };
}

async function openRelationships(page) {
  await seedGame(page, rosterState(), {
    set1: [],
    set2: [],
    set3: [],
  });
  await page.goto('/team-builder');
}

test('shows only supported current-roster relationships with adjustable limits', async ({ page }, testInfo) => {
  await openRelationships(page);

  await expect(page.getByRole('heading', { level: 1, name: '当前阵容关系' })).toBeVisible();
  await expect(page.getByText('旧版队伍推荐已暂停')).toBeVisible();
  await expect(page.getByText(/未来可能重新开放真正的队伍推荐/)).toBeVisible();
  await expect(page.getByText(/不会自动配队/)).toBeVisible();

  const rosterNames = [...fixture.heroes, ...fixture.skills];
  for (const name of rosterNames) {
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
  }

  const main = page.getByTestId('current-roster-relationships');
  await expect(main.getByText(/^HP$/)).toHaveCount(0);
  await expect(main.getByText(/^HS$/)).toHaveCount(0);
  await expect(main.getByText(/武将同队|武将携带战法/).first()).toBeVisible();
  await expect(main.getByText('正向关系')).toHaveCount(0);
  await expect(main.getByText('负向关系')).toHaveCount(0);

  const focusCard = page.getByTestId(`relationship-card-hero-${fixture.focus}`);
  const relationshipRows = focusCard.locator('[data-relationship-row="true"]');
  await expect(relationshipRows).toHaveCount(3);
  await expect(focusCard.getByText(fixture.negativeTarget, { exact: true })).toHaveCount(0);
  await expect(focusCard.getByText(/−\d/)).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('team-builder-relationships-desktop.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: '5 条' }).click();
  await expect(relationshipRows).toHaveCount(5);

  await page.getByRole('button', { name: '全部' }).click();
  await expect(relationshipRows).toHaveCount(6);

  const progressBars = main.getByRole('progressbar');
  await expect(progressBars.first()).toBeVisible();
  const values = await progressBars.evaluateAll((elements) =>
    elements.map((element) => Number(element.getAttribute('aria-valuenow')))
  );
  expect(Math.max(...values)).toBe(100);
  expect(values.some((value) => value > 0 && value < 100)).toBe(true);
});

test('keeps the relationship list readable without horizontal overflow on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRelationships(page);

  const focusCard = page.getByTestId(`relationship-card-hero-${fixture.focus}`);
  const relationshipList = focusCard.getByTestId(`relationship-list-hero:${fixture.focus}`);
  await expect(relationshipList.locator('[data-relationship-row="true"]')).toHaveCount(3);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('team-builder-relationships-mobile.png'),
    fullPage: true,
  });
  await focusCard.screenshot({
    path: testInfo.outputPath('team-builder-relationship-card-mobile.png'),
  });
});

test('briefly explains when a selected item has no supported relationship', async ({ page }) => {
  await seedGame(
    page,
    makeGameState({ roundNumber: 1, heroes: [fixture.focus], skills: [] }),
    { set1: [], set2: [], set3: [] }
  );
  await page.goto('/team-builder');

  const card = page.getByTestId(`relationship-card-hero-${fixture.focus}`);
  await expect(card.getByText(/暂时没有足够战报支持的搭配关系/)).toBeVisible();
  await expect(card.getByText(/随着你继续选择/)).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveCount(0);
});
