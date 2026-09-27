import { recommendationData } from '../../data';
import {
  recommendSkillSet,
  type OptionAnalysis,
} from '../recommendationEngine';
import {
  SANMOU_DEBUG_SCHEMA,
  buildRoundRecommendationDebugContext,
  clearSanmouDebugContextForTests,
  registerSanmouDebugContext,
} from '../recommendationDebug';

const evaluatedFeature = (
  featureId: string,
  weight: number,
  support: number
) => ({
  featureId,
  label: featureId.split('|').slice(1).join(' + '),
  family: featureId.split('|')[0],
  weight,
  support,
  displayPoints: weight * 10,
});

const option = (
  setIndex: number,
  rank: number,
  score: number,
  featureId: string,
  featureWeight = score / 10
): OptionAnalysis => ({
  set_index: setIndex,
  items: [`item-${setIndex}`],
  final_score: score,
  rank,
  item_scores: [
    { item: `item-${setIndex}`, score, support: 10 + setIndex },
  ],
  synergies: [],
  combo_synergies: [],
  combo_tradeoffs: [],
  tradeoffs: [],
  evidence: {
    featureCount: 1,
    totalSupport: 10 + setIndex,
    minSupport: 10 + setIndex,
  },
  debug: {
    rawScore: score / 10,
    evaluatedFeatures: [evaluatedFeature(featureId, featureWeight, 10)],
  },
});

describe('recommendation browser debug context', () => {
  afterEach(() => {
    clearSanmouDebugContextForTests();
    vi.restoreAllMocks();
  });

  test('exports an exact, copy-ready round ranking and feature calculation', () => {
    const analysis = [
      option(0, 2, 7, 'H|甲'),
      option(1, 1, 9, 'HP|乙|现有武将'),
      option(2, 3, 3, 'H|丙'),
    ];
    const context = buildRoundRecommendationDebugContext({
      season: 16,
      roundType: 'hero',
      gameState: {
        current_heroes: ['现有武将'],
        current_skills: ['现有战法'],
        support_hero: '支援武将',
        support_skills: ['支援战法'],
        round_number: 4,
        round_history: [],
      },
      currentRoundInputs: {
        set1: ['甲'],
        set2: ['乙'],
        set3: ['丙'],
      },
      recommendation: {
        recommended_set_index: 1,
        analysis,
        preference: {
          top_index: 0,
          probabilities: [0.5, 0.3, 0.2],
        },
      },
    });

    expect(context).toMatchObject({
      schema: SANMOU_DEBUG_SCHEMA,
      page: 'candidate-suggestion',
      status: 'ready',
      decision: {
        recommended_index: 1,
        recommended_label: 'B',
        winner_margin_over_runner_up: 2,
      },
      player_preference_model: {
        top_index: 0,
        affects_ai_recommendation: false,
      },
    });
    expect(
      (context.options as Array<Record<string, unknown>>)[1]
    ).toMatchObject({
      option: 'B',
      display_score: 9,
      score_calculation: [
        {
          feature_id: 'HP|乙|现有武将',
          meaning: '武将配合：乙 + 现有武将',
          display_points: 9,
          support: 10,
        },
      ],
    });
    expect(context.model).toMatchObject({
      selection_prior: recommendationData.model.selection_prior,
    });
    expect(JSON.stringify(context)).not.toContain('model.weights');
  });

  test('exports the authoritative current-pool tie-break for equal skill routes', () => {
    const result = recommendSkillSet(
      [['虚构战法']],
      ['乙', '甲'],
      [],
      recommendationData
    );
    const context = buildRoundRecommendationDebugContext({
      season: 16,
      roundType: 'skill',
      gameState: {
        current_heroes: ['乙', '甲'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
        round_number: 2,
        round_history: [],
      },
      currentRoundInputs: {
        set1: ['虚构战法'],
        set2: [],
        set3: [],
      },
      recommendation: {
        recommended_set_index: result.recommended_set,
        analysis: result.analysis,
      },
    });
    const route = (
      context.options as Array<{
        skill_routing: Array<Record<string, unknown>>;
      }>
    )[0].skill_routing[0];

    expect(route).toMatchObject({
      chosen_hero: '乙',
      ranking_order: [
        'higher hero-skill HS weight',
        'earlier hero in current-pool order when HS weights tie',
      ],
      selection_reason:
        'highest HS weight tied; earliest hero in current-pool order won',
      tied_best_heroes: ['乙', '甲'],
      alternatives: [
        {
          rank: 1,
          hero: '乙',
          current_pool_index: 0,
          selected: true,
          tied_for_best_weight: true,
        },
        {
          rank: 2,
          hero: '甲',
          current_pool_index: 1,
          selected: false,
          tied_for_best_weight: true,
        },
      ],
    });
  });

  test('exposes outcome and count components for atomic scoring rows', () => {
    const context = buildRoundRecommendationDebugContext({
      season: 16,
      roundType: 'hero',
      gameState: {
        current_heroes: [],
        current_skills: [],
        support_hero: null,
        support_skills: [],
        round_number: 1,
        round_history: [],
      },
      currentRoundInputs: { set1: ['公孙瓒'], set2: [], set3: [] },
      recommendation: {
        recommended_set_index: 0,
        analysis: [option(0, 1, -7, 'H|公孙瓒')],
      },
    });
    const scoreRow = (
      context.options as Array<{
        score_calculation: Array<Record<string, unknown>>;
      }>
    )[0].score_calculation[0];

    expect(scoreRow).toMatchObject({
      feature_id: 'H|公孙瓒',
      confidence: 'low',
      atomic_components: recommendationData.model.atomic_components?.['H|公孙瓒'],
    });
  });

  test('exposes outcome, appearance, and final components for HP/HS scoring rows', () => {
    for (const family of ['HP', 'HS'] as const) {
      const entry = Object.entries(
        recommendationData.model.relationship_components ?? {}
      ).find(
        ([featureId, component]) =>
          featureId.startsWith(`${family}|`) && component.count_adjustment > 0
      );
      expect(entry).toBeDefined();
      const [featureId, component] = entry!;
      const context = buildRoundRecommendationDebugContext({
        season: 16,
        roundType: family === 'HP' ? 'hero' : 'skill',
        gameState: {
          current_heroes: [],
          current_skills: [],
          support_hero: null,
          support_skills: [],
          round_number: 1,
          round_history: [],
        },
        currentRoundInputs: { set1: ['appearance-lift'], set2: [], set3: [] },
        recommendation: {
          recommended_set_index: 0,
          analysis: [
            option(
              0,
              1,
              component.final_weight * 10,
              featureId,
              component.final_weight
            ),
          ],
        },
      });
      const scoreRow = (
        context.options as Array<{
          score_calculation: Array<Record<string, unknown>>;
        }>
      )[0].score_calculation[0];

      expect(scoreRow).toMatchObject({
        feature_id: featureId,
        weight: component.final_weight,
        atomic_components: null,
        relationship_components: component,
      });
      expect(component.final_weight).toBe(
        recommendationData.model.weights[featureId]
      );
      expect(component.count_adjustment).toBeGreaterThan(0);
    }
  });

  test('preserves an exact raw model weight that does not round-trip through display points', () => {
    const featureId = 'HS|乐进|七进七出';
    const exactModelWeight = -0.030764;
    const displayScore = exactModelWeight * 10;
    expect(displayScore / 10).not.toBe(exactModelWeight);

    const context = buildRoundRecommendationDebugContext({
      season: 16,
      roundType: 'skill',
      gameState: {
        current_heroes: [],
        current_skills: [],
        support_hero: null,
        support_skills: [],
        round_number: 1,
        round_history: [],
      },
      currentRoundInputs: { set1: ['七进七出'], set2: [], set3: [] },
      recommendation: {
        recommended_set_index: 0,
        analysis: [
          option(0, 1, displayScore, featureId, exactModelWeight),
        ],
      },
    });
    const scoreRow = (
      context.options as Array<{
        score_calculation: Array<Record<string, unknown>>;
      }>
    )[0].score_calculation[0];

    expect(scoreRow).toMatchObject({
      feature_id: featureId,
      weight: exactModelWeight,
      relationship_components:
        recommendationData.model.relationship_components?.[featureId],
    });
  });

  test('reports not-ready context before a round recommendation exists', () => {
    const context = buildRoundRecommendationDebugContext({
      season: 1,
      roundType: 'hero',
      gameState: {
        current_heroes: [],
        current_skills: [],
        support_hero: null,
        support_skills: [],
        round_number: 1,
        round_history: [],
      },
      currentRoundInputs: { set1: [], set2: [], set3: [] },
      recommendation: null,
    });

    expect(context).toMatchObject({
      status: 'not-ready',
      page: 'candidate-suggestion',
    });
  });

  test('registers sanmouDebug as a pretty JSON console function and cleans stale owners safely', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const releaseFirst = registerSanmouDebugContext(() => ({
      schema: SANMOU_DEBUG_SCHEMA,
      page: 'first',
      status: 'ready',
    }));
    const releaseSecond = registerSanmouDebugContext(() => ({
      schema: SANMOU_DEBUG_SCHEMA,
      page: 'second',
      status: 'ready',
    }));

    releaseFirst();
    const serialized = window.sanmouDebug?.();
    expect(serialized).toBeTruthy();
    expect(JSON.parse(serialized!)).toMatchObject({
      page: 'second',
      status: 'ready',
    });
    expect(serialized).toContain('\n  "page": "second"');

    releaseSecond();
    expect(JSON.parse(window.sanmouDebug!())).toMatchObject({
      page: 'unsupported',
      status: 'not-ready',
    });
  });
});
