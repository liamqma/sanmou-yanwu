import type {
  PreferencePrediction,
  TelemetryData,
} from '../types/telemetryData';
import type { RoundType } from '../types/game';

export interface PreferenceContext {
  roundNumber: number;
  roundType: RoundType;
  poolBefore: {
    heroes: string[];
    skills: string[];
    heroSupport?: string;
    skillsSupport?: string[];
  };
  offeredSets: string[][];
  pairedScores: number[];
}

const featureId = (...parts: unknown[]): string => JSON.stringify(parts);

export const preferenceFeatures = (
  context: PreferenceContext,
  optionIndex: number
): Record<string, number> => {
  const scoreMean =
    context.pairedScores.reduce((sum, score) => sum + score, 0) / 3;
  const centeredScore =
    (context.pairedScores[optionIndex] - scoreMean) / 10;
  const features: Record<string, number> = {
    [featureId('score')]: centeredScore,
    [featureId('round_score', context.roundNumber)]: centeredScore,
    [featureId('position', optionIndex)]: 1,
  };
  const poolItems: [RoundType, string][] = [
    ...context.poolBefore.heroes.map(
      (item): [RoundType, string] => ['hero', item]
    ),
    ...context.poolBefore.skills.map(
      (item): [RoundType, string] => ['skill', item]
    ),
    ...(context.poolBefore.heroSupport
      ? ([['hero', context.poolBefore.heroSupport]] as [RoundType, string][])
      : []),
    ...(context.poolBefore.skillsSupport || []).map(
      (item): [RoundType, string] => ['skill', item]
    ),
  ];

  for (const item of context.offeredSets[optionIndex]) {
    features[featureId('item', context.roundType, item)] = 1;
    for (const [poolType, poolItem] of poolItems) {
      features[
        featureId(
          'pool_item',
          poolType,
          poolItem,
          context.roundType,
          item
        )
      ] = 1;
    }
  }
  return features;
};

const softmax = (values: number[]): [number, number, number] => {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) =>
    Math.exp(Math.max(-700, Math.min(700, value - maximum)))
  );
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total) as [
    number,
    number,
    number,
  ];
};

/**
 * Match the one-decimal percentages shown in the UI while preserving an exact
 * 100.0% total. The same quantized probabilities are stored in telemetry.
 */
export const normalizePreferenceForDisplay = (
  probabilities: [number, number, number]
): [number, number, number] => {
  const scaled = probabilities.map((probability) => probability * 1000);
  const units = scaled.map(Math.floor);
  let remainder = 1000 - units.reduce((sum, value) => sum + value, 0);
  const order = [0, 1, 2].sort(
    (left, right) =>
      scaled[right] - units[right] - (scaled[left] - units[left]) ||
      left - right
  );
  for (let index = 0; index < remainder; index += 1) {
    units[order[index % order.length]] += 1;
  }
  remainder = 1000 - units.reduce((sum, value) => sum + value, 0);
  if (remainder !== 0) units[0] += remainder;
  return units.map((value) => value / 1000) as [number, number, number];
};

export const predictPlayerPreference = (
  artifact: TelemetryData,
  context: PreferenceContext
): PreferencePrediction | null => {
  const model = artifact.preference_model;
  if (
    !model ||
    model.status !== 'ready' ||
    !model.version ||
    context.offeredSets.length !== 3 ||
    context.offeredSets.some((set) => set.length === 0) ||
    context.pairedScores.length !== 3 ||
    context.pairedScores.some((score) => !Number.isFinite(score))
  ) {
    return null;
  }

  const utilities = [0, 1, 2].map((optionIndex) =>
    Object.entries(preferenceFeatures(context, optionIndex)).reduce(
      (sum, [key, value]) => sum + (model.weights[key] || 0) * value,
      0
    )
  );
  const probabilities = normalizePreferenceForDisplay(softmax(utilities));
  const ranked = [0, 1, 2].sort(
    (left, right) =>
      probabilities[right] - probabilities[left] || left - right
  );
  return {
    version: model.version,
    probabilities,
    top_index: ranked[0],
    probability_margin:
      probabilities[ranked[0]] - probabilities[ranked[1]],
    meaningful_margin: model.meaningful_probability_margin,
  };
};
