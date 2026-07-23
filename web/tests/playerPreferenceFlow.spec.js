const { test, expect } = require('@playwright/test');
const telemetry = require('../public/game-data/telemetry_data.json');
const {
  seedGame,
  makeGameState,
  heroesWithMeta,
  anySkills,
} = require('./helpers');

const readyArtifact = () => ({
  ...telemetry,
  schema: { version: 3, source_event_schema_version: 1 },
  summary: {
    ...telemetry.summary,
    event_count: 240,
    session_count: 40,
    recommendation_accepted_count: 160,
    model_versions: [
      {
        version: telemetry.summary.model_versions[0].version,
        event_count: 240,
      },
    ],
  },
  rounds: telemetry.rounds.map((round) => ({
    ...round,
    event_count: 30,
    recommendation_accepted_count: 20,
    chosen_position_counts: [10, 10, 10],
    recommended_position_counts: [12, 10, 8],
    rate_suppressed: false,
    preference_top_disagreement_count: 8,
    meaningful_preference_disagreement_count: 5,
    player_preference_agreement_count: 15,
    average_meaningful_preference_disagreement_margin: null,
  })),
  analytics: {
    minimum_rate_support: 10,
    items: { heroes: [], skills: [] },
    score_margins: [
      {
        key: 'tie',
        label: '并列',
        event_count: 240,
        recommendation_accepted_count: 160,
        rate_suppressed: false,
      },
      ...['0_to_1', '1_to_3', 'over_3'].map((key) => ({
        key,
        label: key,
        event_count: 0,
        recommendation_accepted_count: 0,
        rate_suppressed: true,
      })),
    ],
  },
  preference_model: {
    model_type: 'conditional-choice-logit',
    feature_schema_version: 1,
    meaningful_probability_margin: 0.1,
    l2: 0.05,
    evidence: {
      event_count: 240,
      session_count: 40,
      recommendation_disagreement_count: 80,
      minimum_event_count: 240,
      minimum_session_count: 40,
      minimum_recommendation_disagreement_count: 30,
      holdout_event_count: 48,
      minimum_holdout_event_count: 36,
    },
    status: 'ready',
    version: 'preference-v1:0000000000000001',
    held_out: {
      event_count: 48,
      accuracy: 0.7,
      log_loss: 0.8,
      brier: 0.15,
      calibration_error: 0.05,
      train_event_count: 192,
      paired_accuracy: 0.65,
      uniform_log_loss: 1.098612288668,
    },
    weights: { '["position",1]': 2 },
    support: { '["position",1]': 240 },
  },
});

test('ready preference probabilities flow from static model to UI and telemetry', async ({
  page,
}) => {
  let artifactLoaded = false;
  const loggedRounds = [];
  await page.route('**/game-data/telemetry_data.json', async (route) => {
    artifactLoaded = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(readyArtifact()),
    });
  });
  await page.route('**/api/telemetry/rounds', async (route) => {
    const body = route.request().postDataJSON();
    loggedRounds.push(...body.events);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        accepted: body.events.length,
        duplicates: 0,
      }),
    });
  });

  const team = heroesWithMeta.slice(0, 4);
  const candidates = heroesWithMeta.slice(4, 13);
  await seedGame(
    page,
    makeGameState({ roundNumber: 1, heroes: team, skills: anySkills(8) }),
    {
      set1: candidates.slice(0, 3),
      set2: candidates.slice(3, 6),
      set3: candidates.slice(6, 9),
    }
  );
  await expect.poll(() => artifactLoaded).toBe(true);

  await page.getByRole('button', { name: '获取 AI 推荐' }).click();
  const displayed = [];
  for (const index of [0, 1, 2]) {
    const label = page.getByTestId(`option-preference-${index}`);
    await expect(label).toBeVisible();
    await expect(label).toContainText('玩家选择概率：');
    displayed.push(
      Number((await label.innerText()).match(/(\d+\.\d)%/)[1]) / 100
    );
  }
  expect(displayed.reduce((sum, probability) => sum + probability, 0)).toBe(1);
  expect(
    displayed.every(
      (probability) =>
        Math.abs(probability * 1000 - Math.round(probability * 1000)) < 1e-9
    )
  ).toBe(true);
  expect(displayed[1]).toBeGreaterThan(displayed[0]);
  await expect(
    page.getByText('玩家选择最高', { exact: true })
  ).toBeVisible();

  const cards = page.getByTestId('analysis-set-card');
  const aiIndex = await cards.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.dataset.aiRecommended === 'true')
  );
  const playerChoiceIndex = await cards.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.dataset.playerChoiceTop === 'true')
  );
  expect(aiIndex).toBeGreaterThanOrEqual(0);
  expect(playerChoiceIndex).toBe(1);
  if (aiIndex !== playerChoiceIndex) {
    const optionLetter = (index) => String.fromCharCode(65 + index);
    await expect(page.getByTestId('preference-disagreement')).toHaveText(
      `AI 按当前阵容强度推荐 ${optionLetter(aiIndex)}；玩家选择模型认为 ${optionLetter(playerChoiceIndex)} 更常被选（${(displayed[playerChoiceIndex] * 100).toFixed(1)}%）。这是相似阵容与选项中的总体选择倾向。 这描述玩家偏好，不会改变 AI 推荐。`
    );
  } else {
    await expect(page.getByTestId('preference-disagreement')).toHaveCount(0);
  }

  await page.getByRole('button', { name: '选择本组' }).first().click();
  await page
    .getByRole('button', { name: '确认选择并进入下一轮' })
    .click();
  await expect.poll(() => loggedRounds.length).toBe(1);
  expect(loggedRounds[0].preference_model_version).toBe(
    'preference-v1:0000000000000001'
  );
  expect(loggedRounds[0].preference_probabilities).toEqual(displayed);
});
