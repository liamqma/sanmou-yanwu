const { test, expect } = require('@playwright/test');
const telemetry = require('../public/game-data/telemetry_data.json');
const database = require('../public/game-data/database.json');

const phaseThreeArtifact = () => {
  const eventCount = telemetry.summary.event_count;
  const accepted = telemetry.rounds.reduce(
    (sum, round) => sum + round.recommendation_accepted_count,
    0
  );
  const opportunityCount = (roundType) =>
    telemetry.rounds
      .filter((round) => round.round_type === roundType)
      .reduce((sum, round) => sum + round.event_count, 0);
  return {
    ...telemetry,
    schema: { version: 3, source_event_schema_version: 1 },
    summary: {
      ...telemetry.summary,
      recommendation_accepted_count: accepted,
    },
    rounds: telemetry.rounds.map((round) => ({
      ...round,
      rate_suppressed: round.event_count < 10,
      preference_top_disagreement_count: null,
      meaningful_preference_disagreement_count: null,
      player_preference_agreement_count: null,
      average_meaningful_preference_disagreement_margin: null,
    })),
    analytics: {
      minimum_rate_support: 10,
      items: {
        heroes: [
          {
            name: Object.keys(database.heroes)[0],
            offer_count: 10,
            opportunity_count: opportunityCount('hero'),
            picked_count: 5,
            rate_suppressed: false,
          },
        ],
        skills: [
          {
            name: Object.keys(database.skills)[0],
            offer_count: 10,
            opportunity_count: opportunityCount('skill'),
            picked_count: 4,
            rate_suppressed: false,
          },
        ],
      },
      score_margins: [
        {
          key: 'tie',
          label: '并列',
          event_count: eventCount,
          recommendation_accepted_count: accepted,
          rate_suppressed: false,
        },
        ...[
          ['0_to_1', '0–1 分'],
          ['1_to_3', '1–3 分'],
          ['over_3', '超过 3 分'],
        ].map(([key, label]) => ({
          key,
          label,
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
        event_count: eventCount,
        session_count: telemetry.summary.session_count,
        recommendation_disagreement_count: eventCount - accepted,
        minimum_event_count: 240,
        minimum_session_count: 40,
        minimum_recommendation_disagreement_count: 30,
        holdout_event_count: 20,
        minimum_holdout_event_count: 36,
      },
      status: 'insufficient_evidence',
      version: null,
      held_out: null,
      weights: {},
      support: {},
    },
  };
};

test('Analytics exposes the aggregate-only player choice telemetry hand-off', async ({
  page,
}) => {
  await page.goto('/analytics');

  const section = page.getByTestId('player-choice-analytics');
  const accepted = telemetry.rounds.reduce(
    (sum, round) => sum + round.recommendation_accepted_count,
    0
  );
  const acceptance =
    telemetry.summary.event_count < 10
      ? '样本不足'
      : `${((accepted / telemetry.summary.event_count) * 100).toFixed(1)}%`;
  const modelStatus =
    telemetry.preference_model?.status === 'ready'
      ? '偏好模型已启用'
      : telemetry.preference_model?.status === 'quality_gate_failed'
        ? '模型质量门未通过'
        : '正在积累偏好证据';
  await expect(section).toBeVisible({ timeout: 15000 });
  await expect(section.getByText('玩家选择洞察')).toBeVisible();
  await expect(page.getByTestId('telemetry-event-count')).toContainText(
    String(telemetry.summary.event_count)
  );
  await expect(page.getByTestId('telemetry-session-count')).toContainText(
    String(telemetry.summary.session_count)
  );
  await expect(page.getByTestId('telemetry-acceptance-rate')).toContainText(
    acceptance
  );
  await expect(section.getByText(modelStatus)).toBeVisible();
  await expect(
    section.getByRole('region', { name: '各轮玩家选择表格，可滚动' })
  ).toBeVisible();
});

test('Analytics renders schema-v3 offer, agreement, and score-margin aggregates', async ({
  page,
}) => {
  const artifact = phaseThreeArtifact();
  await page.route('**/game-data/telemetry_data.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(artifact),
    })
  );
  await page.goto('/analytics');

  const section = page.getByTestId('player-choice-analytics');
  await expect(section).toBeVisible({ timeout: 15000 });
  await expect(
    section.getByRole('columnheader', {
      name: '偏好模型与历史选择一致',
    })
  ).toBeVisible();
  await expect(section.getByText('武将出现与选择')).toBeVisible();
  await expect(section.getByText('战法出现与选择')).toBeVisible();
  await expect(section.getByText('AI 评分领先幅度与接受率')).toBeVisible();
  await expect(section.getByText('模型未启用').first()).toBeVisible();
});
