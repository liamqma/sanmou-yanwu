import { database } from '../../data';
import { createEmptyTeamBuilderLayout } from '../teamBuilderArrangement';
import type {
  FormationRecommendation,
  OptionAnalysis,
} from '../recommendationEngine';
import {
  SANMOU_DEBUG_SCHEMA,
  buildRoundRecommendationDebugContext,
  buildTeamFormationDebugContext,
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
  featureId: string
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
    evaluatedFeatures: [evaluatedFeature(featureId, score / 10, 10)],
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
    expect(JSON.stringify(context)).not.toContain('model.weights');
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

  test('exports formation policy, optimiser alternatives, gates, and current edits', () => {
    const heroes = Object.keys(database.heroes).slice(0, 9);
    const skills = Object.keys(database.skills).slice(0, 18);
    const formation: FormationRecommendation = {
      incomplete: false,
      options: [
        {
          teams: [
            {
              heroes: [],
              strength: 0,
              evidence: {
                heroSynergy: [],
                heroSkill: [],
                skillSynergy: [],
              },
            },
          ],
        },
      ],
      debug: {
        policy: 'evidence-only-team-builder',
        heroPoolCount: 9,
        skillPoolCount: 18,
        boundedHeroCount: 9,
        qualifiedHeroPairs: 4,
        qualifiedHeroTrios: 1,
        candidateSelectionsEvaluated: 8,
        prioritizedExactGuideCoreCount: 1,
        rankingOrder: ['more usable exact 3/3 guide cores'],
        topCandidates: [
          {
            rank: 1,
            exactGuideIds: ['guide-1'],
            totalModelGain: 12.3,
            rawTotalModelGain: 1.23,
            exactChampionshipTeams: 0,
            exactRankingScore: 3,
            heroesPlaced: 3,
            completeTrios: 1,
            heroSupport: 90,
            canonicalKey: heroes.slice(0, 3).join('|'),
            teams: [],
          },
          {
            rank: 2,
            exactGuideIds: [],
            totalModelGain: 13,
            rawTotalModelGain: 1.3,
            exactChampionshipTeams: 0,
            exactRankingScore: 0,
            heroesPlaced: 6,
            completeTrios: 2,
            heroSupport: 80,
            canonicalKey: 'runner-up',
            teams: [],
          },
        ],
      },
    };

    const context = buildTeamFormationDebugContext({
      season: 16,
      heroes,
      skills,
      supportItems: new Set([heroes[0], skills[0]]),
      formation,
      resultReady: true,
      currentLayout: createEmptyTeamBuilderLayout(),
      currentLayoutMatchesRecommendation: false,
    });

    expect(context).toMatchObject({
      page: 'team-formation-suggestion',
      status: 'ready',
      optimizer_trace: {
        candidateSelectionsEvaluated: 8,
        prioritizedExactGuideCoreCount: 1,
      },
      strongest_rejected_alternatives: [
        { rank: 2, canonicalKey: 'runner-up' },
      ],
      current_layout: {
        matches_original_recommendation: false,
        user_edited: true,
      },
    });
    const gates = context.evidence_gates as Record<string, unknown[]>;
    expect(gates.heroes).toHaveLength(9);
    expect(gates.hero_pairs).toHaveLength(36);
    expect(gates.skills).toHaveLength(18);
    expect(gates.hero_skill_routes).toHaveLength(18);
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
