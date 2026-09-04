const { test, expect } = require('@playwright/test');
const recommendationData = require('../src/recommendation_data.json');
const {
  anySkills,
  database,
  makeGameState,
  seedGame,
} = require('./helpers');

const { model } = recommendationData;
const supported = (featureId) =>
  Number(model.support[featureId] ?? 0) >= model.min_support_pair &&
  Number.isFinite(model.weights[featureId]) &&
  model.weights[featureId] !== 0;

const relationshipFixture = (() => {
  const heroPairs = Object.keys(model.weights)
    .filter((featureId) => featureId.startsWith('HP|') && supported(featureId))
    .map((featureId) => featureId.split('|').slice(1));
  const directCarrying = Object.keys(model.weights)
    .filter((featureId) => featureId.startsWith('HS|') && supported(featureId))
    .map((featureId) => featureId.split('|').slice(1));

  for (const [hero, skill] of directCarrying) {
    const pair = heroPairs.find(([first, second]) => first === hero || second === hero);
    if (!pair || !database.heroes[hero] || !database.skills[skill]) continue;
    const currentHero = pair[0] === hero ? pair[1] : pair[0];
    if (!database.heroes[currentHero]) continue;
    return { candidateHero: hero, currentHero, currentSkill: skill };
  }
  throw new Error('Expected one supported hero with both HP and HS evidence');
})();

const seedRelationshipRound = async (page) => {
  const { candidateHero, currentHero, currentSkill } = relationshipFixture;
  const heroNames = Object.keys(database.heroes).filter(
    (name) => name !== candidateHero && name !== currentHero
  );
  const currentHeroes = [currentHero, ...heroNames.slice(0, 3)];
  const candidateFillers = heroNames
    .filter((name) => !currentHeroes.includes(name))
    .slice(0, 8);
  const currentSkills = [
    currentSkill,
    ...anySkills(20).filter((name) => name !== currentSkill).slice(0, 7),
  ];
  const candidates = [candidateHero, ...candidateFillers];

  await seedGame(
    page,
    makeGameState({ roundNumber: 1, heroes: currentHeroes, skills: currentSkills }),
    {
      set1: candidates.slice(0, 3),
      set2: candidates.slice(3, 6),
      set3: candidates.slice(6, 9),
    }
  );
  return { ...relationshipFixture, fifthCandidate: candidates[1] };
};

test('multi-focus workbench supports drag, tap, a four-node cap, and Chinese labels', async ({
  page,
}) => {
  const { currentHero, currentSkill, fifthCandidate } =
    await seedRelationshipRound(page);
  const workbench = page.getByTestId('candidate-relationship-workbench');
  const dropzone = workbench.getByTestId('relationship-focus-dropzone');

  await expect(workbench.getByRole('heading', { name: '多点关系图' })).toBeVisible();
  await expect(workbench.getByTestId('relationship-focus-count')).toHaveText('2 / 4');
  await expect(workbench).toContainText('同队：两名武将直接搭配');
  await expect(workbench).toContainText('携带：武将直接携带战法');
  await expect(workbench).not.toContainText(/\b(?:HP|HS)\b/);

  await workbench
    .getByRole('button', { name: currentHero, exact: true })
    .dragTo(dropzone);
  await workbench
    .getByRole('button', { name: currentSkill, exact: true })
    .click();
  await expect(workbench.getByTestId('relationship-focus-count')).toHaveText('4 / 4');

  await workbench
    .getByRole('button', { name: fifthCandidate, exact: true })
    .click();
  await expect(workbench.getByRole('status')).toContainText(
    '最多同时聚焦 4 个节点'
  );
  await expect(workbench.getByTestId('relationship-focus-count')).toHaveText('4 / 4');

  await workbench.getByRole('button', { name: '全部关系' }).click();
  await expect(workbench.getByRole('button', { name: '全部关系' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('mobile replaces the dense canvas with a grouped relationship list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRelationshipRound(page);
  const workbench = page.getByTestId('candidate-relationship-workbench');

  await expect(workbench.getByTestId('relationship-graph-desktop')).not.toBeVisible();
  await expect(workbench.getByTestId('relationship-graph-mobile')).toBeVisible();
  await expect(workbench.getByText('武将同队').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
