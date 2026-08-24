import { database, recommendationData } from '../data';
import type { TeamComp } from '../types/domain';
import type {
  CurrentRoundInputs,
  GameState,
  Recommendation,
  RoundType,
} from '../types/game';
import type {
  AtomicWeightComponent,
  FeatureFamily,
  PairedModel,
} from '../types/recommendation';
import type {
  FormationRecommendation,
  OptionAnalysis,
  ProjectedTeam,
} from './recommendationEngine';
import {
  teamBuilderConfidenceSupport,
} from './recommendationEngine';
import { labelFeature } from './featureLabels';
import {
  heroId,
  heroPairId,
  heroSkillId,
  skillId,
  teamFeatureIds,
} from './recommendationModel';
import type { TeamBuilderLayout } from './teamBuilderArrangement';

export const SANMOU_DEBUG_SCHEMA = 'sanmou-recommendation-debug/v1' as const;

const displayPoints = (weight: number): number =>
  Math.round(weight * 100) / 10;

const featureFamily = (featureId: string): FeatureFamily =>
  featureId.split('|')[0] as FeatureFamily;

const featureMeaning = (featureId: string): string => {
  const [family, ...names] = featureId.split('|');
  if (family === 'H') return `武将个体：${names[0]}`;
  if (family === 'S') return `战法个体：${names[0]}`;
  const { label } = labelFeature(featureId, recommendationData.catalog);
  if (family === 'HP' || family === 'HT' || family === 'HC' || family === 'B') {
    return `武将配合：${label}`;
  }
  if (family === 'HS' || family === 'THS') return `武将与战法：${label}`;
  if (family === 'SP' || family === 'TSP' || family === 'TS3') {
    return `战法搭配：${label}`;
  }
  if (family === 'M') return label;
  return featureId;
};

const modelMetadata = () => ({
  model_type: recommendationData.schema.model_type,
  schema_version: recommendationData.schema.version,
  catalog_version: recommendationData.catalog.catalog_version,
  scoring_version: recommendationData.model.scoring_version,
  relationship_version: recommendationData.catalog.relationship_version,
  mechanics_version: recommendationData.catalog.mechanics_version,
  corpus_version: recommendationData.battle_counts.corpus_version,
  total_battles: recommendationData.battle_counts.total_battles,
  minimum_support: {
    H: recommendationData.model.min_support_single,
    S: recommendationData.model.min_support_single,
    HP: recommendationData.model.min_support_pair,
    HS: recommendationData.model.min_support_pair,
    SP: recommendationData.model.min_support_pair,
    THS: recommendationData.model.min_support_team_context,
    TSP: recommendationData.model.min_support_team_context,
    HT: recommendationData.model.min_support_high_order,
    TS3: recommendationData.model.min_support_high_order,
    HC: recommendationData.model.min_support_relationship,
    B: recommendationData.model.min_support_relationship,
    M: recommendationData.model.min_support_mechanic,
  },
  selection_prior: recommendationData.model.selection_prior ?? null,
  score_scale: 'display points = final model weight × 10, rounded to one decimal',
  score_meaning:
    'Atomic hero/skill weights combine paired battle outcomes with season-aware player-selection count; interactions remain outcome-only. This is not an opponent-specific win probability.',
});

export interface RoundDebugInput {
  season: number;
  gameState: GameState;
  roundType: RoundType;
  currentRoundInputs: CurrentRoundInputs;
  recommendation: Recommendation | null;
}

export function buildRoundRecommendationDebugContext({
  season,
  gameState,
  roundType,
  currentRoundInputs,
  recommendation,
}: RoundDebugInput): Record<string, unknown> {
  const offeredSets = [
    currentRoundInputs.set1 ?? [],
    currentRoundInputs.set2 ?? [],
    currentRoundInputs.set3 ?? [],
  ];
  const base = {
    schema: SANMOU_DEBUG_SCHEMA,
    page: 'candidate-suggestion',
    model: modelMetadata(),
    input: {
      season,
      round: gameState.round_number,
      round_type: roundType,
      current_pool: {
        heroes: [...gameState.current_heroes],
        skills: [...gameState.current_skills],
        support_hero: gameState.support_hero,
        support_skills: [...gameState.support_skills],
        heroes_used_for_scoring: [
          ...gameState.current_heroes,
          ...(gameState.support_hero ? [gameState.support_hero] : []),
        ],
        skills_used_for_scoring: [
          ...gameState.current_skills,
          ...gameState.support_skills,
        ],
      },
      offered_sets: offeredSets.map((items, index) => ({
        index,
        label: String.fromCharCode(65 + index),
        items: [...items],
      })),
    },
  };

  const analysis = recommendation?.analysis as OptionAnalysis[] | undefined;
  if (!recommendation || !Array.isArray(analysis) || analysis.length === 0) {
    return {
      ...base,
      status: 'not-ready',
      reason: 'No recommendation has been calculated for the current offers.',
      next_step:
        'Complete all three option sets and click 获取 AI 推荐, then run sanmouDebug() again.',
    };
  }

  const recommendedIndex = recommendation.recommended_set_index;
  const ranked = [...analysis].sort((left, right) => left.rank - right.rank);
  const winner =
    typeof recommendedIndex === 'number'
      ? analysis.find(({ set_index }) => set_index === recommendedIndex)
      : undefined;
  const runnerUp = ranked.find(({ set_index }) => set_index !== recommendedIndex);

  return {
    ...base,
    status: 'ready',
    decision: {
      recommended_index: recommendedIndex,
      recommended_label:
        typeof recommendedIndex === 'number'
          ? String.fromCharCode(65 + recommendedIndex)
          : null,
      ranking_rule: [
        'higher final_score',
        'higher total evidence support when displayed scores tie',
        'lower option index when still tied',
      ],
      ranking: ranked.map((option) => ({
        rank: option.rank,
        option: String.fromCharCode(65 + option.set_index),
        final_score: option.final_score,
        raw_score: option.debug?.rawScore ?? null,
        total_support: option.evidence.totalSupport,
        minimum_support_in_active_evidence: option.evidence.minSupport,
      })),
      winner_margin_over_runner_up:
        winner && runnerUp
          ? Math.round((winner.final_score - runnerUp.final_score) * 10) / 10
          : null,
    },
    options: analysis.map((option) => ({
      option: String.fromCharCode(65 + option.set_index),
      index: option.set_index,
      rank: option.rank,
      items: [...option.items],
      raw_score: option.debug?.rawScore ?? null,
      display_score: option.final_score,
      item_scores: option.item_scores.map((item) => ({ ...item })),
      evidence: { ...option.evidence },
      score_calculation:
        option.debug?.evaluatedFeatures.map((feature) => ({
          feature_id: feature.featureId,
          meaning: featureMeaning(feature.featureId),
          family: feature.family,
          weight: feature.weight,
          display_points: feature.displayPoints,
          support: feature.support,
          atomic_components:
            recommendationData.model.atomic_components?.[feature.featureId] ?? null,
          confidence:
            feature.family === 'H' || feature.family === 'S'
              ? feature.support < 20
                ? 'low'
                : feature.support < 100
                  ? 'medium'
                  : 'high'
              : null,
          contributes_to_score: feature.weight !== 0,
        })) ?? [],
      skill_routing:
        option.debug?.skillRoutes?.map((route) => ({
          skill: route.skill,
          standalone: {
            feature_id: route.standalone.featureId,
            weight: route.standalone.weight,
            display_points: route.standalone.displayPoints,
            support: route.standalone.support,
          },
          chosen_hero: route.chosenHero,
          chosen_route: route.chosenRoute
            ? {
                feature_id: route.chosenRoute.featureId,
                weight: route.chosenRoute.weight,
                display_points: route.chosenRoute.displayPoints,
                support: route.chosenRoute.support,
              }
            : null,
          ranking_order: [...route.rankingOrder],
          selection_reason: route.selectionReason,
          tied_best_heroes: [...route.tiedBestHeroes],
          alternatives: route.alternatives.map((alternative) => ({
            rank: alternative.rank,
            hero: alternative.hero,
            current_pool_index: alternative.currentPoolIndex,
            selected: alternative.selected,
            tied_for_best_weight: alternative.tiedForBestWeight,
            feature_id: alternative.featureId,
            weight: alternative.weight,
            display_points: alternative.displayPoints,
            support: alternative.support,
          })),
          raw_total: route.rawTotal,
          display_total: route.displayTotal,
        })) ?? [],
    })),
    player_preference_model: recommendation.preference
      ? {
          ...(recommendation.preference as Record<string, unknown>),
          affects_ai_recommendation: false,
          note:
            'This separately labelled model describes historical player choices and never changes the paired-model AI recommendation.',
        }
      : {
          available: false,
          affects_ai_recommendation: false,
        },
  };
}

interface FeatureGate {
  feature_id: string;
  meaning: string;
  family: FeatureFamily;
  weight: number;
  display_points: number;
  support: number;
  required_support: number;
  passed: boolean;
  atomic_components?: AtomicWeightComponent | null;
}

const featureGate = (m: PairedModel, featureId: string): FeatureGate => {
  const family = featureFamily(featureId);
  const support = m.support[featureId] ?? 0;
  const requiredSupport = teamBuilderConfidenceSupport(m, family);
  const weight = m.weights[featureId] ?? 0;
  return {
    feature_id: featureId,
    meaning: featureMeaning(featureId),
    family,
    weight,
    display_points: displayPoints(weight),
    support,
    required_support: requiredSupport,
    passed: support >= requiredSupport,
    ...(family === 'H' || family === 'S'
      ? { atomic_components: m.atomic_components?.[featureId] ?? null }
      : {}),
  };
};

const combinations = (items: string[], size: 2 | 3): string[][] => {
  const result: string[][] = [];
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      if (size === 2) {
        result.push([items[first], items[second]]);
        continue;
      }
      for (let third = second + 1; third < items.length; third += 1) {
        result.push([items[first], items[second], items[third]]);
      }
    }
  }
  return result;
};

const groupPasses = (heroes: string[], m: PairedModel): boolean => {
  if (heroes.some((hero) => !featureGate(m, heroId(hero)).passed)) return false;
  for (let first = 0; first < heroes.length; first += 1) {
    for (let second = first + 1; second < heroes.length; second += 1) {
      if (!featureGate(m, heroPairId(heroes[first], heroes[second])).passed)
        return false;
    }
  }
  return true;
};

const selectedAssignedTeams = (
  formation: FormationRecommendation | null
): ProjectedTeam[] =>
  formation && !formation.incomplete ? formation.options[0]?.teams ?? [] : [];

const relevantGuideTeams = (
  teamComps: TeamComp[],
  heroPool: Set<string>,
  skillPool: Set<string>,
  m: PairedModel
) =>
  teamComps.flatMap((comp) => {
    const matchedHeroes = comp.members
      .map(({ hero }) => hero)
      .filter((hero) => heroPool.has(hero));
    if (matchedHeroes.length < 2) return [];
    return [
      {
        id: comp.id,
        ranking: comp.ranking,
        sources: [...comp.sources],
        formation: comp.formation,
        matched_heroes: matchedHeroes,
        members: comp.members.map((member) => ({
          hero: member.hero,
          hero_owned: heroPool.has(member.hero),
          skill_slots: member.skillSlots.map((alternatives) =>
            alternatives
              .filter((skill) => skillPool.has(skill))
              .map((skill) => ({
                skill,
                skill_gate: featureGate(m, skillId(skill)),
                hero_skill_gate: featureGate(
                  m,
                  heroSkillId(member.hero, skill)
                ),
                is_signature_skill:
                  recommendationData.catalog.default_skill[member.hero] === skill,
              }))
          ),
        })),
      },
    ];
  });

export interface FormationDebugInput {
  season: number;
  heroes: string[];
  skills: string[];
  supportItems: Set<string>;
  formation: FormationRecommendation | null;
  resultReady: boolean;
  currentLayout: TeamBuilderLayout;
  currentLayoutMatchesRecommendation: boolean;
}

export function buildTeamFormationDebugContext({
  season,
  heroes,
  skills,
  supportItems,
  formation,
  resultReady,
  currentLayout,
  currentLayoutMatchesRecommendation,
}: FormationDebugInput): Record<string, unknown> {
  const m = recommendationData.model;
  const uniqueHeroes = [...new Set(heroes)];
  const uniqueSkills = [...new Set(skills)];
  const consideredHeroes = formation?.debug?.consideredHeroes ?? uniqueHeroes;
  const excludedHeroes = formation?.debug?.excludedHeroes ?? [];
  const excludedHeroByName = new Map(
    excludedHeroes.map((exclusion) => [exclusion.hero, exclusion])
  );
  const heroReachabilityByName = new Map(
    (formation?.debug?.heroSelectionReachability ?? []).map((reachability) => [
      reachability.hero,
      reachability,
    ])
  );
  const heroSet = new Set(consideredHeroes);
  const skillSet = new Set(uniqueSkills);
  const teams = selectedAssignedTeams(formation);
  const selectedHeroes = new Set(
    teams.flatMap((team) => team.heroes.map(({ name }) => name))
  );
  const selectedSkills = new Set(
    teams.flatMap((team) => team.heroes.flatMap(({ skills: assigned }) => assigned))
  );
  const pairGroups = combinations(consideredHeroes, 2);

  const base = {
    schema: SANMOU_DEBUG_SCHEMA,
    page: 'team-formation-suggestion',
    model: modelMetadata(),
    input: {
      season,
      heroes: uniqueHeroes,
      skills: uniqueSkills,
      support_items: [...supportItems].sort(),
    },
  };

  if (!resultReady || !formation) {
    return {
      ...base,
      status: 'not-ready',
      reason:
        uniqueHeroes.length < 9 || uniqueSkills.length < 18
          ? `Automatic recommendation needs at least 9 heroes and 18 skills; current pool has ${uniqueHeroes.length} heroes and ${uniqueSkills.length} skills.`
          : 'The team recommendation is still being calculated.',
      next_step:
        'Wait for the team formation page to finish loading, then run sanmouDebug() again.',
    };
  }

  const heroGates = consideredHeroes.map((hero) =>
    featureGate(m, heroId(hero))
  );
  const heroPairGates = pairGroups.map(([first, second]) =>
    featureGate(m, heroPairId(first, second))
  );
  const skillGates = uniqueSkills.map((skill) => featureGate(m, skillId(skill)));
  const heroSkillGates = uniqueSkills.map((skill) => {
    const allRoutes = consideredHeroes.map((hero) => ({
      hero,
      is_signature_skill:
        recommendationData.catalog.default_skill[hero] === skill,
      gate: featureGate(m, heroSkillId(hero, skill)),
    }));
    const observedRoutes = allRoutes.filter(
      ({ gate }) => gate.support > 0 || gate.weight !== 0
    );
    return {
      skill,
      routes: observedRoutes,
      omitted_zero_evidence_routes: allRoutes.length - observedRoutes.length,
      omitted_route_meaning:
        'The omitted hero routes have zero support and zero fitted weight.',
    };
  });
  const supportedSkillPairs = Object.keys({ ...m.support, ...m.weights })
    .filter((featureId) => {
      const [family, hero, first, second] = featureId.split('|');
      return (
        family === 'SP' &&
        heroSet.has(hero) &&
        skillSet.has(first) &&
        skillSet.has(second)
      );
    })
    .sort()
    .map((featureId) => featureGate(m, featureId));

  const optimizerTrace = formation.debug
    ? (({ topCandidates, ...summary }) => ({
        ...summary,
        winner: topCandidates[0] ?? null,
        runner_up: topCandidates[1] ?? null,
      }))(formation.debug)
    : null;

  const recommendedTeams = teams.map((team, index) => {
    const assigned = team.heroes.map((hero) => ({
      name: hero.name,
      skills: [...hero.skills],
    }));
    const scoreRows = [
      ...teamFeatureIds(
        assigned,
        recommendationData.catalog,
        true,
        new Set(recommendationData.model.enabled_families)
      ),
    ]
      .map((featureId) => featureGate(m, featureId))
      .sort((left, right) =>
        right.weight !== left.weight
          ? right.weight - left.weight
          : left.feature_id.localeCompare(right.feature_id)
      );
    return {
      team: index + 1,
      heroes: team.heroes.map((hero) => ({
        name: hero.name,
        skills: [...hero.skills],
        skill_slots: hero.skillSlots ? [...hero.skillSlots] : undefined,
        skill_score: hero.skillScore,
        slot_index: hero.slotIndex,
      })),
      strength: team.strength,
      formation: team.formation ?? null,
      guide_match: team.knownTeam ? { ...team.knownTeam } : null,
      full_score_breakdown: scoreRows,
      score_check: {
        raw_sum: scoreRows.reduce((sum, row) => sum + row.weight, 0),
        displayed_sum_before_final_rounding: scoreRows.reduce(
          (sum, row) => sum + row.display_points,
          0
        ),
      },
    };
  });

  return {
    ...base,
    status: formation.incomplete ? 'incomplete' : 'ready',
    policy: {
      name: 'evidence-only-team-builder',
      rules: [
        'Every placed hero must independently pass its H evidence gate.',
        'Every hero pair inside a selected pair/trio must independently pass its HP evidence gate.',
        'Every placed skill must independently pass both its S and assigned-hero HS evidence gates.',
        'Positive, zero, and negative supported weights remain eligible and affect ranking.',
        'A usable exact 3/3 guide core is ranked before fully assigned model gain.',
        'Guide data preserves qualified slots but never bypasses an evidence gate.',
        'Reviewed M mechanics affect only exact concrete teams and remain observational residual associations, not causal rules.',
      ],
    },
    optimizer_trace: optimizerTrace,
    recommended_teams: recommendedTeams,
    evidence_gates: {
      heroes: heroGates,
      hero_pairs: heroPairGates,
      skills: skillGates,
      hero_skill_routes: heroSkillGates,
      observed_skill_pairs: supportedSkillPairs,
      pool_cap_exclusions: excludedHeroes.map((exclusion) => ({ ...exclusion })),
    },
    relevant_guide_teams: relevantGuideTeams(
      database.team ?? [],
      heroSet,
      skillSet,
      m
    ),
    unplaced_items: {
      heroes: uniqueHeroes
        .filter((hero) => !selectedHeroes.has(hero))
        .map((hero) => {
          const exclusion = excludedHeroByName.get(hero);
          if (exclusion) {
            return {
              name: hero,
              support_item: supportItems.has(hero),
              individual_gate: null,
              qualified_pair_or_trio_count: 0,
              pool_cap_exclusion: { ...exclusion },
              reason: 'excluded_by_alphabetical_hero_pool_cap',
            };
          }
          const gate = featureGate(m, heroId(hero));
          const reachability = heroReachabilityByName.get(hero);
          const qualifiedGroupCount =
            reachability?.qualifiedGroupCount ??
            ([
              ...pairGroups,
              ...combinations(consideredHeroes, 3),
            ].filter(
              (group) => group.includes(hero) && groupPasses(group, m)
            ).length);
          return {
            name: hero,
            support_item: supportItems.has(hero),
            individual_gate: gate,
            qualified_pair_or_trio_count: qualifiedGroupCount,
            selection_search_reachability: reachability
              ? {
                  reached_final_evaluation: reachability.reachedFinalEvaluation,
                  depths: reachability.depths.map((depth) => ({ ...depth })),
                }
              : null,
            reason: !gate.passed
              ? 'atomic_hero_evidence_gate_failed'
              : qualifiedGroupCount === 0
                ? 'no_fully_evidence_qualified_pair_or_trio'
                : reachability && !reachability.reachedFinalEvaluation
                  ? 'qualified_groups_entirely_pruned_by_proxy_beam'
                  : 'eligible_groups_reached_final_evaluation_but_lost_global_ranking',
          };
        }),
      skills: uniqueSkills
        .filter((skill) => !selectedSkills.has(skill))
        .map((skill) => {
          const gate = featureGate(m, skillId(skill));
          const evidenceQualifiedHeroes = consideredHeroes.filter(
            (hero) =>
              recommendationData.catalog.default_skill[hero] !== skill &&
              featureGate(m, heroSkillId(hero, skill)).passed
          );
          const selectedHeroRoutes = evidenceQualifiedHeroes.filter((hero) =>
            selectedHeroes.has(hero)
          );
          const unplacedHeroRoutes = evidenceQualifiedHeroes.filter(
            (hero) => !selectedHeroes.has(hero)
          );
          return {
            name: skill,
            support_item: supportItems.has(skill),
            individual_gate: gate,
            evidence_qualified_routes: {
              selected_heroes: selectedHeroRoutes,
              unplaced_heroes: unplacedHeroRoutes,
            },
            reason: !gate.passed
              ? 'atomic_skill_evidence_gate_failed'
              : selectedHeroRoutes.length > 0
                ? 'routes_to_selected_heroes_lost_assignment_or_capacity_ranking'
                : unplacedHeroRoutes.length > 0
                  ? 'evidence_qualified_routes_exist_only_to_unplaced_heroes'
                  : 'no_evidence_qualified_hero_skill_route',
          };
        }),
    },
    current_layout: {
      matches_original_recommendation: currentLayoutMatchesRecommendation,
      user_edited: !currentLayoutMatchesRecommendation,
      layout: currentLayout,
    },
  };
}

type DebugContextFactory = () => Record<string, unknown>;
let activeDebugFactory: DebugContextFactory | null = null;
let activeRegistration: symbol | null = null;

const noActiveDebugContext = (): Record<string, unknown> => ({
  schema: SANMOU_DEBUG_SCHEMA,
  page: 'unsupported',
  status: 'not-ready',
  reason:
    'Open the candidate suggestion or team formation suggestion page before running sanmouDebug().',
});

declare global {
  interface Window {
    /** Returns pretty, copy-ready JSON and logs the corresponding object. */
    sanmouDebug?: () => string;
  }
}

const installGlobalDebugFunction = (): void => {
  if (typeof window === 'undefined') return;
  window.sanmouDebug = () => {
    let context: Record<string, unknown>;
    try {
      context = activeDebugFactory?.() ?? noActiveDebugContext();
    } catch (error) {
      context = {
        schema: SANMOU_DEBUG_SCHEMA,
        page: 'unknown',
        status: 'error',
        reason:
          error instanceof Error ? error.message : 'Unknown debug export error',
      };
    }
    console.info(
      'Sanmou recommendation debug context. Copy with: copy(sanmouDebug())',
      context
    );
    return JSON.stringify(context, null, 2);
  };
};

export function registerSanmouDebugContext(
  factory: DebugContextFactory
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const registration = Symbol('sanmou-debug-registration');
  activeRegistration = registration;
  activeDebugFactory = factory;
  installGlobalDebugFunction();
  return () => {
    if (activeRegistration !== registration) return;
    activeRegistration = null;
    activeDebugFactory = null;
  };
}

export function clearSanmouDebugContextForTests(): void {
  activeRegistration = null;
  activeDebugFactory = null;
  if (typeof window !== 'undefined') delete window.sanmouDebug;
}
