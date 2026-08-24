import type {
  FeatureFamily,
  RecommendationCatalog,
} from '../types/recommendation';
import {
  F_BOND,
  F_HERO_CAMP,
  F_HERO_SKILL,
  F_MECHANIC,
  F_TEAM_HERO_SKILL,
} from './recommendationModel';

export const FEATURE_RELATIONSHIP_LABELS: Readonly<
  Partial<Record<FeatureFamily, string>>
> = {
  HP: '搭配',
  HS: '携带',
  THS: '同队',
  SP: '同武将',
  TSP: '战法搭配',
  M: '机制',
};

export const MECHANIC_RELATION_LABELS: Readonly<Record<string, string>> = {
  benefits_from: '受益于',
  requires: '需要',
  consumes: '消耗',
};

/** Format a model weight to fixed precision with an explicit Unicode sign. */
export function formatSignedWeight(weight: number, digits: number): string {
  return `${weight >= 0 ? '+' : '−'}${Math.abs(weight).toFixed(digits)}`;
}

/** Central player-facing formatter for canonical model feature ids. */
export function labelFeature(
  featureId: string,
  catalog?: RecommendationCatalog
): { label: string; family: string } {
  const [family, ...names] = featureId.split('|');
  if (family === F_HERO_SKILL) {
    return { label: `${names[0]} · ${names[1]}`, family };
  }
  if (family === F_TEAM_HERO_SKILL) {
    return { label: `${names[0]} + ${names[1]}`, family };
  }
  if (family === F_HERO_CAMP) {
    return { label: `${names[0]}人同阵营`, family };
  }
  if (family === F_BOND) {
    return { label: `缘分 · ${names[0]}`, family };
  }
  if (family === F_MECHANIC) {
    const [mechanic, relation, side] = names;
    const mechanicName =
      catalog?.mechanics.mechanic_names[mechanic] ?? mechanic;
    return {
      label: `机制联动：${mechanicName} · ${MECHANIC_RELATION_LABELS[relation] ?? relation}（${side === 'enemy' ? '敌方' : '友方'}）`,
      family,
    };
  }
  return { label: names.join(' + '), family };
}
