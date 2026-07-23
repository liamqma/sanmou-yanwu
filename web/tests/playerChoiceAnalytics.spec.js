const { test, expect } = require('@playwright/test');
const telemetry = require('../public/game-data/telemetry_data.json');

const byName = (left, right) =>
  left.name < right.name ? -1 : left.name > right.name ? 1 : 0;

const item = (
  name,
  offerCount,
  pickedCount,
  opportunityCount
) => ({
  name,
  offer_count: offerCount,
  opportunity_count: opportunityCount,
  picked_count: pickedCount,
  rate_suppressed: offerCount < 10,
});

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
          item('曹操', 30, 12, opportunityCount('hero')),
          item('刘备', 25, 18, opportunityCount('hero')),
          item('关羽', 20, 18, opportunityCount('hero')),
          item('张飞', 20, 8, opportunityCount('hero')),
          item('赵云', 15, 14, opportunityCount('hero')),
          item('周瑜', 10, 0, opportunityCount('hero')),
          item('孙权', 9, 9, opportunityCount('hero')),
        ].sort(byName),
        skills: [
          item('万人之敌', 60, 20, opportunityCount('skill')),
          item('一计决胜', 50, 30, opportunityCount('skill')),
          item('七进七出', 50, 25, opportunityCount('skill')),
          item('上兵伐谋', 40, 30, opportunityCount('skill')),
          item('临机制胜', 35, 8, opportunityCount('skill')),
          item('不屈意志', 20, 10, opportunityCount('skill')),
          item('临阵突袭', 9, 9, opportunityCount('skill')),
        ].sort(byName),
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

test('Analytics omits player-choice rankings for a schema-v2 artifact', async ({
  page,
}) => {
  const telemetryResponse = page.waitForResponse((response) =>
    response.url().includes('/game-data/telemetry_data.json')
  );
  await page.goto('/analytics');
  await telemetryResponse;
  await expect(
    page.getByRole('heading', { name: '数据洞察' })
  ).toBeVisible({ timeout: 15000 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );

  await expect(page.getByTestId('player-choice-analytics')).toHaveCount(0);
});

test('Analytics renders schema-v3 top-five offer and pick rankings', async ({
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
  await expect(section.getByText('玩家最关心的选择排行')).toBeVisible();

  const heroToggle = section.getByRole('button', { name: '武将' });
  const skillToggle = section.getByRole('button', { name: '战法' });
  await expect(heroToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(skillToggle).toHaveAttribute('aria-pressed', 'false');

  const offered = section.getByTestId('telemetry-ranking-offers');
  const picked = section.getByTestId('telemetry-ranking-picks');
  await expect(offered.getByRole('heading', { name: '系统最常提供' })).toBeVisible();
  await expect(picked.getByRole('heading', { name: '玩家最常选择' })).toBeVisible();
  await expect(offered.getByTestId('telemetry-ranking-row')).toHaveCount(5);
  await expect(picked.getByTestId('telemetry-ranking-row')).toHaveCount(5);
  await expect(offered.getByTestId('telemetry-ranking-name')).toHaveText([
    '曹操',
    '刘备',
    '关羽',
    '张飞',
    '赵云',
  ]);
  await expect(picked.getByTestId('telemetry-ranking-name')).toHaveText([
    '关羽',
    '刘备',
    '赵云',
    '曹操',
    '孙权',
  ]);

  const topOffer = offered.getByTestId('telemetry-ranking-row').first();
  await expect(topOffer).toContainText('30 次');
  await expect(topOffer).toContainText('提供率 78.9%');
  await expect(topOffer.getByRole('progressbar')).toHaveAttribute(
    'aria-valuemax',
    '30'
  );
  await expect(topOffer.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '30'
  );

  const lowSupportPick = picked
    .getByTestId('telemetry-ranking-row')
    .filter({ hasText: '孙权' });
  await expect(lowSupportPick).toContainText('9 次');
  await expect(lowSupportPick).toContainText('提供后选择率 样本不足');

  for (const hiddenText of [
    '有效选择',
    '匿名对局',
    '接受 AI 推荐',
    '偏好模型',
    '各轮选择与位置偏好',
    '位置选择',
    'AI 评分领先幅度与接受率',
    '留出集',
  ]) {
    await expect(section.getByText(hiddenText, { exact: false })).toHaveCount(0);
  }

  await skillToggle.click();
  await expect(skillToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(offered.getByTestId('telemetry-ranking-name')).toHaveText([
    '万人之敌',
    '一计决胜',
    '七进七出',
    '上兵伐谋',
    '临机制胜',
  ]);
  await expect(picked.getByTestId('telemetry-ranking-name')).toHaveText([
    '一计决胜',
    '上兵伐谋',
    '七进七出',
    '万人之敌',
    '不屈意志',
  ]);
});
