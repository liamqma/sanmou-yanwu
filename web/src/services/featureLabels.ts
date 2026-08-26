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

export const MECHANIC_SIDE_LABELS = {
  friendly: '友方',
  enemy: '敌方',
} as const;

const ANALYTICS_MECHANIC_CONSUMER_RELATIONS = [
  'benefits_from',
  'requires',
  'consumes',
] as const;

type AnalyticsMechanicConsumerRelation =
  (typeof ANALYTICS_MECHANIC_CONSUMER_RELATIONS)[number];

const isAnalyticsMechanicConsumerRelation = (
  relation: string
): relation is AnalyticsMechanicConsumerRelation =>
  ANALYTICS_MECHANIC_CONSUMER_RELATIONS.some(
    (supported) => supported === relation
  );

export interface AnalyticsRelationshipLabel {
  label: string;
  family: string;
  heroes: string[];
  skills: string[];
  mechanic?: {
    name: string;
    consumerRelation: AnalyticsMechanicConsumerRelation;
    consumerRelationLabel: string;
    side: keyof typeof MECHANIC_SIDE_LABELS;
    sideLabel: string;
  };
}

/**
 * Player-facing relationship wording for the unified Analytics ranking.
 * Unlike the compact evidence formatter below, this deliberately spells out
 * the activation relationship. M labels fail closed unless every player-facing
 * value can be resolved exactly from the reviewed catalog contract.
 */
export function labelAnalyticsRelationship(
  featureId: string,
  catalog: RecommendationCatalog
): AnalyticsRelationshipLabel {
  const [family, ...names] = featureId.split('|');
  if (family === 'HP') {
    return {
      label: `${names[0]} 同队 ${names[1]}`,
      family,
      heroes: names.slice(0, 2),
      skills: [],
    };
  }
  if (family === 'HT') {
    return {
      label: `${names.slice(0, 3).join('、')} 三人同队`,
      family,
      heroes: names.slice(0, 3),
      skills: [],
    };
  }
  if (family === F_HERO_SKILL) {
    return {
      label: `${names[0]} 携带 ${names[1]}`,
      family,
      heroes: names.slice(0, 1),
      skills: names.slice(1, 2),
    };
  }
  if (family === F_TEAM_HERO_SKILL) {
    return {
      label: `${names[0]} 队内存在 ${names[1]}`,
      family,
      heroes: names.slice(0, 1),
      skills: names.slice(1, 2),
    };
  }
  if (family === F_BOND) {
    return {
      label: `缘分 · ${names[0]}`,
      family,
      heroes: [],
      skills: [],
    };
  }
  if (family === F_MECHANIC) {
    if (names.length !== 3) {
      throw new Error(
        `Malformed Analytics M feature; expected mechanic, relation, and side: ${featureId}`
      );
    }
    const [mechanic, consumerRelation, rawSide] = names;
    const name = catalog.mechanics.mechanic_names[mechanic];
    if (!name) {
      throw new Error(
        `Analytics M feature references an unknown catalog mechanic: ${mechanic}`
      );
    }
    if (!isAnalyticsMechanicConsumerRelation(consumerRelation)) {
      throw new Error(
        `Analytics M feature has an unsupported consumer relation: ${consumerRelation}`
      );
    }
    if (rawSide !== 'friendly' && rawSide !== 'enemy') {
      throw new Error(`Analytics M feature has an invalid side: ${rawSide}`);
    }
    const side = rawSide;
    const consumerRelationLabel = MECHANIC_RELATION_LABELS[consumerRelation];
    const sideLabel = MECHANIC_SIDE_LABELS[side];
    return {
      label: `机制联动：${name} · ${consumerRelationLabel}（${sideLabel}）`,
      family,
      heroes: [],
      skills: [],
      mechanic: {
        name,
        consumerRelation,
        consumerRelationLabel,
        side,
        sideLabel,
      },
    };
  }
  throw new Error(`Unsupported Analytics relationship family: ${family}`);
}

/** Format a model weight to fixed precision with an explicit sign. */
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
