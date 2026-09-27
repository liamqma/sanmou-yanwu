import { recommendationData } from '../data';
import type {
  CurrentRoundInputs,
  GameState,
  Recommendation,
  RoundType,
} from '../types/game';
import type { OptionAnalysis } from './recommendationEngine';
import { labelFeature } from './featureLabels';

export const SANMOU_DEBUG_SCHEMA = 'sanmou-recommendation-debug/v1' as const;

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
    'H/S combine outcomes with the established count prior; HP/HS combine outcomes with a positive-only season-aware co-selection lift. Other interactions remain outcome-only. This is not an opponent-specific win probability.',
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
          relationship_components:
            recommendationData.model.relationship_components?.[feature.featureId] ?? null,
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

type DebugContextFactory = () => Record<string, unknown>;
let activeDebugFactory: DebugContextFactory | null = null;
let activeRegistration: symbol | null = null;

const noActiveDebugContext = (): Record<string, unknown> => ({
  schema: SANMOU_DEBUG_SCHEMA,
  page: 'unsupported',
  status: 'not-ready',
  reason:
    'Open the draft page before running sanmouDebug().',
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
