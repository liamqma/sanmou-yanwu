import { database, recommendationData } from '../../data';
import { createEmptyTeamBuilderLayout } from '../teamBuilderArrangement';
import {
  recommendHybridTeams,
  recommendSkillSet,
  type FormationRecommendation,
  type OptionAnalysis,
} from '../recommendationEngine';
import {
  SANMOU_DEBUG_SCHEMA,
  buildRoundRecommendationDebugContext,
  buildTeamFormationDebugContext,
  clearSanmouDebugContextForTests,
  registerSanmouDebugContext,
} from '../recommendationDebug';
import { heroId, heroSkillId, skillId } from '../recommendationModel';

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

const emptyGuideMatchingTrace = () => ({
  objective: 'maximize assigned guide slots',
  slotCount: 0,
  uniqueSkillCount: 0,
  matchedSlotCount: 0,
  eventLimit: 24,
  events: [],
  omittedEventCount: 0,
  finalAssignments: [],
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
    const beamPrunedHero = Object.keys(database.heroes).find(
      (hero) =>
        (recommendationData.model.support[`H|${hero}`] ?? 0) >=
        recommendationData.model.min_support_single
    )!;
    const heroes = [
      beamPrunedHero,
      ...Object.keys(database.heroes)
        .filter((hero) => hero !== beamPrunedHero)
        .slice(0, 8),
    ];
    const skills = Object.keys(database.skills).slice(0, 18);
    const formation: FormationRecommendation = {
      incomplete: false,
      options: [
        {
          teams: [
            {
              heroes: [
                {
                  name: heroes[1],
                  skills: [skills[0]],
                  skillScore: 0,
                },
              ],
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
        heroPoolCap: 15,
        boundedHeroCount: 9,
        consideredHeroes: [...heroes].sort(),
        excludedHeroes: [],
        qualifiedHeroPairs: 4,
        qualifiedHeroTrios: 1,
        candidateSelectionsEvaluated: 8,
        prioritizedExactGuideCoreCount: 1,
        rankingOrder: ['more usable exact 3/3 guide cores'],
        beamPruning: [
          {
            depth: 1,
            preCapCount: 80,
            retainedCount: 64,
            nominalCap: 64,
            effectiveCap: 64,
            proxyRankingOrder: ['higher unassigned hero model gain'],
            nominalCutoff: null,
            retainedCutoff: null,
            exactGuideReservations: [],
            retainedOnlyByReservationCount: 0,
          },
        ],
        heroSelectionReachability: heroes.map((hero, index) => ({
          hero,
          qualifiedGroupCount: 1,
          reachedFinalEvaluation: index !== 0,
          depths: [
            {
              depth: 1,
              generatedContainingSelectionCount: 1,
              retainedContainingSelectionCount: index === 0 ? 0 : 1,
              reservedContainingSelectionCount: 0,
              entirelyProxyPruned: index === 0,
            },
          ],
        })),
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
            teams: [
              {
                heroes: heroes.slice(0, 3),
                skills: {},
                guideId: 'guide-1',
                guideMatchDecision: {
                  rankingOrder: [
                    'higher matched hero count',
                    'higher evidence-qualified skill-slot count',
                    'championship source before non-championship source',
                    'higher guide ranking score (S=3, A=2, other=1)',
                    'lower stable guide ID by locale order',
                  ],
                  selected: {
                    guideId: 'guide-1',
                    matchedHeroes: heroes.slice(0, 3),
                    matchedHeroCount: 3,
                    qualifiedSkillSlotCount: 2,
                    championship: false,
                    ranking: 'S',
                    rankingScore: 3,
                    stableId: 'guide-1',
                  },
                  rejectedCandidateLimit: 4,
                  rejected: [
                    {
                      guideId: 'guide-2',
                      matchedHeroes: heroes.slice(0, 3),
                      matchedHeroCount: 3,
                      qualifiedSkillSlotCount: 1,
                      championship: true,
                      ranking: 'S',
                      rankingScore: 3,
                      stableId: 'guide-2',
                    },
                  ],
                  omittedRejectedCount: 0,
                },
                prioritizedExactGuide: true,
              },
            ],
            skillRouting: {
              guideMatching: {
                slotRankingOrder: [],
                alternativeRankingOrder: [],
                maximumCardinality: emptyGuideMatchingTrace(),
                slots: [],
              },
              modelRouting: {
                rankingOrder: ['higher incremental model gain'],
                rejectedCandidateLimit: 4,
                steps: [
                  {
                    step: 1,
                    candidateCount: 2,
                    selected: {
                      hero: heroes[0],
                      additions: [skills[0]],
                      gain: 0.8,
                      support: 24,
                      stableKey: `${heroes[0]}|HS|${skills[0]}`,
                      placements: [
                        {
                          skill: skills[0],
                          slotIndex: 1,
                          preferredGuideSlot: true,
                        },
                      ],
                    },
                    rejected: [
                      {
                        hero: heroes[1],
                        additions: [skills[0]],
                        gain: 0.7,
                        support: 20,
                        stableKey: `${heroes[1]}|HS|${skills[0]}`,
                        placements: [
                          {
                            skill: skills[0],
                            slotIndex: 0,
                            preferredGuideSlot: false,
                          },
                        ],
                      },
                    ],
                    omittedRejectedCount: 0,
                  },
                ],
              },
            },
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
            skillRouting: {
              guideMatching: {
                slotRankingOrder: [],
                alternativeRankingOrder: [],
                maximumCardinality: emptyGuideMatchingTrace(),
                slots: [],
              },
              modelRouting: {
                rankingOrder: [],
                rejectedCandidateLimit: 4,
                steps: [],
              },
            },
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
        beamPruning: [
          {
            depth: 1,
            preCapCount: 80,
            retainedCount: 64,
          },
        ],
        winner: {
          teams: [
            {
              guideMatchDecision: {
                selected: { guideId: 'guide-1', qualifiedSkillSlotCount: 2 },
                rejected: [
                  { guideId: 'guide-2', qualifiedSkillSlotCount: 1 },
                ],
              },
            },
          ],
          skillRouting: {
            guideMatching: {
              maximumCardinality: {
                objective: 'maximize assigned guide slots',
                matchedSlotCount: 0,
                finalAssignments: [],
              },
            },
            modelRouting: {
              steps: [
                {
                  selected: {
                    hero: heroes[0],
                    placements: [
                      { skill: skills[0], preferredGuideSlot: true },
                    ],
                  },
                  rejected: [{ hero: heroes[1], gain: 0.7 }],
                },
              ],
            },
          },
        },
        runner_up: { rank: 2, canonicalKey: 'runner-up' },
      },
      current_layout: {
        matches_original_recommendation: false,
        user_edited: true,
      },
    });
    const gates = context.evidence_gates as Record<
      string,
      Array<Record<string, unknown>>
    >;
    expect(gates.heroes).toHaveLength(9);
    expect(gates.hero_pairs).toHaveLength(36);
    expect(gates.skills).toHaveLength(18);
    expect(gates.hero_skill_routes).toHaveLength(18);
    expect(
      gates.heroes.find(({ feature_id }) => feature_id === heroId(heroes[1]))
    ).toMatchObject({
      atomic_components:
        recommendationData.model.atomic_components?.[heroId(heroes[1])],
    });
    expect(
      gates.skills.find(({ feature_id }) => feature_id === skillId(skills[0]))
    ).toMatchObject({
      atomic_components:
        recommendationData.model.atomic_components?.[skillId(skills[0])],
    });
    expect(gates.hero_pairs[0]).not.toHaveProperty('atomic_components');
    const scoreBreakdown = (
      context.recommended_teams as Array<{
        full_score_breakdown: Array<Record<string, unknown>>;
      }>
    )[0].full_score_breakdown;
    expect(
      scoreBreakdown.find(({ feature_id }) => feature_id === heroId(heroes[1]))
    ).toHaveProperty('atomic_components');
    expect(
      scoreBreakdown.find(({ feature_id }) => feature_id === skillId(skills[0]))
    ).toHaveProperty('atomic_components');
    expect(
      scoreBreakdown.find(
        ({ feature_id }) => feature_id === heroSkillId(heroes[1], skills[0])
      )
    ).not.toHaveProperty('atomic_components');
    expect(context).not.toHaveProperty('strongest_rejected_alternatives');
    const unplaced = context.unplaced_items as {
      heroes: Array<Record<string, unknown>>;
    };
    expect(
      unplaced.heroes.find(({ name }) => name === beamPrunedHero)
    ).toMatchObject({
      qualified_pair_or_trio_count: 1,
      selection_search_reachability: {
        reached_final_evaluation: false,
        depths: [
          {
            generatedContainingSelectionCount: 1,
            retainedContainingSelectionCount: 0,
            entirelyProxyPruned: true,
          },
        ],
      },
      reason: 'qualified_groups_entirely_pruned_by_proxy_beam',
    });
    const optimizer = context.optimizer_trace as Record<string, unknown>;
    expect(optimizer).not.toHaveProperty('topCandidates');
    expect(optimizer).toHaveProperty('winner');
    expect(optimizer).toHaveProperty('runner_up');
  });

  test('distinguishes skill routes to selected heroes from routes only to unplaced heroes', () => {
    const heroes = [
      '司马懿',
      ...Object.keys(database.heroes)
        .filter((hero) => hero !== '司马懿')
        .slice(0, 8),
    ];
    const skills = [
      '一计决胜',
      ...Object.keys(database.skills)
        .filter((skill) => skill !== '一计决胜')
        .slice(0, 17),
    ];
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
    };

    const context = buildTeamFormationDebugContext({
      season: 16,
      heroes,
      skills,
      supportItems: new Set(),
      formation,
      resultReady: true,
      currentLayout: createEmptyTeamBuilderLayout(),
      currentLayoutMatchesRecommendation: true,
    });
    const unplacedSkills = (
      context.unplaced_items as {
        skills: Array<Record<string, unknown>>;
      }
    ).skills;
    const skill = unplacedSkills.find(({ name }) => name === '一计决胜');

    expect(skill).toMatchObject({
      evidence_qualified_routes: {
        selected_heroes: [],
        unplaced_heroes: expect.arrayContaining(['司马懿']),
      },
      reason: 'evidence_qualified_routes_exist_only_to_unplaced_heroes',
    });
  });

  test('uses the authoritative 15-hero boundary for gates, guides, routes, and unplaced reasons', () => {
    const excludedHero = '司马懿';
    const consideredHeroes = Array.from(
      { length: 15 },
      (_, index) => `h${String(index).padStart(2, '0')}`
    );
    const heroes = [...consideredHeroes, excludedHero];
    const skills = [
      '一计决胜',
      ...Object.keys(database.skills)
        .filter((skill) => skill !== '一计决胜')
        .slice(0, 17),
    ];
    const formation = recommendHybridTeams(
      heroes,
      skills,
      recommendationData,
      recommendationData.catalog,
      {},
      database.team ?? []
    );
    const context = buildTeamFormationDebugContext({
      season: 16,
      heroes,
      skills,
      supportItems: new Set(),
      formation,
      resultReady: true,
      currentLayout: createEmptyTeamBuilderLayout(),
      currentLayoutMatchesRecommendation: true,
    });

    expect(formation.debug).toMatchObject({
      heroPoolCap: 15,
      consideredHeroes,
      excludedHeroes: [
        {
          hero: excludedHero,
          sortedPoolRank: 16,
          reason: 'excluded_by_alphabetical_hero_pool_cap',
        },
      ],
    });
    const gates = context.evidence_gates as {
      heroes: unknown[];
      hero_pairs: unknown[];
      hero_skill_routes: Array<{
        skill: string;
        routes: Array<{ hero: string }>;
      }>;
      pool_cap_exclusions: Array<{ hero: string }>;
    };
    expect(gates.heroes).toHaveLength(15);
    expect(gates.hero_pairs).toHaveLength(105);
    expect(gates.pool_cap_exclusions).toEqual([
      expect.objectContaining({ hero: excludedHero }),
    ]);
    const skillRoutes = gates.hero_skill_routes.find(
      ({ skill }) => skill === '一计决胜'
    )!;
    expect(skillRoutes.routes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ hero: excludedHero })])
    );
    expect(
      (context.relevant_guide_teams as Array<{ matched_heroes: string[] }>).some(
        ({ matched_heroes }) => matched_heroes.includes(excludedHero)
      )
    ).toBe(false);
    const unplaced = context.unplaced_items as {
      heroes: Array<Record<string, unknown>>;
      skills: Array<Record<string, unknown>>;
    };
    expect(unplaced.heroes.find(({ name }) => name === excludedHero)).toMatchObject({
      individual_gate: null,
      qualified_pair_or_trio_count: 0,
      reason: 'excluded_by_alphabetical_hero_pool_cap',
    });
    expect(unplaced.skills.find(({ name }) => name === '一计决胜')).toMatchObject({
      evidence_qualified_routes: {
        selected_heroes: [],
        unplaced_heroes: [],
      },
      reason: 'no_evidence_qualified_hero_skill_route',
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
