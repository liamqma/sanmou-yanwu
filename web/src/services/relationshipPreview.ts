import type {
  FeatureFamily,
  PairedModel,
} from '../types/recommendation';
import {
  FEATURE_RELATIONSHIP_LABELS,
  formatSignedWeight,
} from './featureLabels';
import {
  F_HERO_PAIR,
  F_HERO_SKILL,
  F_HERO_TRIO,
  F_SKILL_PAIR,
  heroPairId,
  heroSkillId,
  htId,
  skillPairId,
} from './recommendationModel';
import {
  applyTeamBuilderMove,
  type TeamBuilderLayout,
  type TeamBuilderMoveSource,
  type TeamBuilderMoveTarget,
} from './teamBuilderArrangement';

export type RelationshipPreviewKind = 'hero' | 'skill';
/** The only relationship families that Team Builder may present. */
export type PairRelationshipFamily = 'HP' | 'HS' | 'SP' | 'HT';
export interface RelationshipPreviewItem {
  kind: RelationshipPreviewKind;
  name: string;
}

export interface PairRelationshipPreview {
  featureId: string;
  family: PairRelationshipFamily;
  /** Compact visible label used in the aggregate breakdown. */
  detailLabel: string;
  label: string;
  weight: number;
  support: number;
  source: RelationshipPreviewItem;
  target: RelationshipPreviewItem;
  accessibleLabel: string;
  carrierHero?: string;
}

export interface PairRelationshipAggregatePreview {
  source: RelationshipPreviewItem;
  target: RelationshipPreviewItem;
  total: number;
  components: readonly PairRelationshipPreview[];
  accessibleLabel: string;
  /** Optional unambiguous compact prefix, used by the team-level HT score. */
  compactLabel?: string;
  /** Optional dialog heading for a relationship owned by a team, not an item pair. */
  detailHeading?: string;
}

export interface RelationshipPreviewIndex {
  readonly bySource: ReadonlyMap<
    string,
    ReadonlyMap<string, readonly PairRelationshipPreview[]>
  >;
}

interface MutableRelationshipPreviewIndex {
  bySource: Map<string, Map<string, PairRelationshipPreview[]>>;
}

interface FeatureMetadata {
  featureId: string;
  family: PairRelationshipFamily;
  weight: number;
  support: number;
}

const DISPLAYED_FAMILIES = new Set<PairRelationshipFamily>([
  F_HERO_PAIR,
  F_HERO_SKILL,
  F_SKILL_PAIR,
  F_HERO_TRIO,
]);

export const relationshipPreviewItemKey = (
  item: RelationshipPreviewItem
): string => `${item.kind}:${item.name}`;

const emptyIndex = (): MutableRelationshipPreviewIndex => ({
  bySource: new Map(),
});

const previewSupportFloor = (
  model: PairedModel,
  family: PairRelationshipFamily
): number =>
  family === F_HERO_TRIO
    ? model.min_support_high_order
    : model.min_support_pair;

const featureMetadata = (
  model: PairedModel,
  featureId: string
): FeatureMetadata | null => {
  const family = featureId.split('|', 1)[0] as FeatureFamily;
  if (!DISPLAYED_FAMILIES.has(family as PairRelationshipFamily)) return null;
  if (!model.enabled_families.includes(family)) return null;
  if (!Object.hasOwn(model.weights, featureId)) return null;
  const weight = model.weights[featureId];
  const support = Object.hasOwn(model.support, featureId)
    ? model.support[featureId]
    : 0;
  if (
    weight === 0 ||
    support < previewSupportFloor(model, family as PairRelationshipFamily)
  ) {
    return null;
  }
  return {
    featureId,
    family: family as PairRelationshipFamily,
    weight,
    support,
  };
};

const pairAccessibleLabel = (
  family: 'HP' | 'HS' | 'SP',
  source: RelationshipPreviewItem,
  target: RelationshipPreviewItem,
  weight: number,
  support: number,
  carrierHero?: string
): string => {
  const signed = formatSignedWeight(weight, 4);
  const evidence = `，参考 ${support} 场`;
  if (family === F_HERO_PAIR) {
    return `武将搭配：武将${source.name}与武将${target.name}直接成对，模型权重 ${signed}${evidence}`;
  }
  if (family === F_HERO_SKILL) {
    const hero = source.kind === 'hero' ? source.name : target.name;
    const skill = source.kind === 'skill' ? source.name : target.name;
    return `直接携带：武将${hero}直接携带战法${skill}，模型权重 ${signed}${evidence}`;
  }
  return `同武将：战法${source.name}与战法${target.name}均由${carrierHero ?? '同一武将'}携带，模型权重 ${signed}${evidence}`;
};

const addOneWay = (
  index: MutableRelationshipPreviewIndex,
  relationship: PairRelationshipPreview
) => {
  const sourceKey = relationshipPreviewItemKey(relationship.source);
  const targetKey = relationshipPreviewItemKey(relationship.target);
  if (sourceKey === targetKey) return;
  let targets = index.bySource.get(sourceKey);
  if (!targets) {
    targets = new Map();
    index.bySource.set(sourceKey, targets);
  }
  let relationships = targets.get(targetKey);
  if (!relationships) {
    relationships = [];
    targets.set(targetKey, relationships);
  }
  if (
    relationships.some(
      ({ family, featureId }) =>
        family === relationship.family && featureId === relationship.featureId
    )
  ) {
    return;
  }
  relationships.push(relationship);
};

const addSymmetric = (
  index: MutableRelationshipPreviewIndex,
  metadata: FeatureMetadata,
  first: RelationshipPreviewItem,
  second: RelationshipPreviewItem,
  options: { carrierHero?: string } = {}
) => {
  if (metadata.family === F_HERO_TRIO) return;
  const family = metadata.family;
  const label = FEATURE_RELATIONSHIP_LABELS[family] ?? family;
  const create = (
    source: RelationshipPreviewItem,
    target: RelationshipPreviewItem
  ): PairRelationshipPreview => ({
    featureId: metadata.featureId,
    family,
    detailLabel: label,
    label,
    weight: metadata.weight,
    support: metadata.support,
    source,
    target,
    accessibleLabel: pairAccessibleLabel(
      family,
      source,
      target,
      metadata.weight,
      metadata.support,
      options.carrierHero
    ),
    ...(options.carrierHero ? { carrierHero: options.carrierHero } : {}),
  });
  addOneWay(index, create(first, second));
  addOneWay(index, create(second, first));
};

const sortIndex = (
  mutable: MutableRelationshipPreviewIndex
): RelationshipPreviewIndex => {
  for (const targets of mutable.bySource.values()) {
    for (const relationships of targets.values()) {
      relationships.sort((left, right) =>
        Math.abs(right.weight) !== Math.abs(left.weight)
          ? Math.abs(right.weight) - Math.abs(left.weight)
          : left.featureId.localeCompare(right.featureId)
      );
    }
  }
  return mutable;
};

/**
 * Build pool-stable direct HP and HS lookups from canonical ids. THS, TSP and
 * M remain scoring features but are deliberately not presentation evidence.
 */
export function buildStaticRelationshipPreviewIndex(
  heroes: readonly string[],
  skills: readonly string[],
  model: PairedModel
): RelationshipPreviewIndex {
  const index = emptyIndex();
  const uniqueHeroes = [...new Set(heroes)];
  const uniqueSkills = [...new Set(skills)];

  for (let first = 0; first < uniqueHeroes.length; first += 1) {
    for (let second = first + 1; second < uniqueHeroes.length; second += 1) {
      const metadata = featureMetadata(
        model,
        heroPairId(uniqueHeroes[first], uniqueHeroes[second])
      );
      if (metadata) {
        addSymmetric(
          index,
          metadata,
          { kind: 'hero', name: uniqueHeroes[first] },
          { kind: 'hero', name: uniqueHeroes[second] }
        );
      }
    }
  }

  for (const hero of uniqueHeroes) {
    for (const skill of uniqueSkills) {
      const metadata = featureMetadata(model, heroSkillId(hero, skill));
      if (metadata) {
        addSymmetric(
          index,
          metadata,
          { kind: 'hero', name: hero },
          { kind: 'skill', name: skill }
        );
      }
    }
  }

  return sortIndex(index);
}

/** Recompute carrier-aware SP from concrete current assignments only. */
export function buildContextualRelationshipPreviewIndex(
  layout: TeamBuilderLayout,
  model: PairedModel
): RelationshipPreviewIndex {
  const index = emptyIndex();

  for (const team of layout) {
    for (const slot of team.heroes) {
      if (!slot.hero) continue;
      const skills = slot.skills.filter(
        (skill): skill is string => skill !== null
      );
      for (let first = 0; first < skills.length; first += 1) {
        for (let second = first + 1; second < skills.length; second += 1) {
          const metadata = featureMetadata(
            model,
            skillPairId(slot.hero, skills[first], skills[second])
          );
          if (metadata) {
            addSymmetric(
              index,
              metadata,
              { kind: 'skill', name: skills[first] },
              { kind: 'skill', name: skills[second] },
              { carrierHero: slot.hero }
            );
          }
        }
      }
    }
  }

  return sortIndex(index);
}

/** Apply the real move semantics before deriving carrier-aware SP previews. */
export function buildProspectiveContextualRelationshipPreviewIndex(
  layout: TeamBuilderLayout,
  source: TeamBuilderMoveSource,
  target: TeamBuilderMoveTarget,
  model: PairedModel
): RelationshipPreviewIndex {
  return buildContextualRelationshipPreviewIndex(
    applyTeamBuilderMove(layout, source, target),
    model
  );
}

/** Merge displayed pair relationships for one highlighted card. */
export function relationshipTargetsFor(
  source: RelationshipPreviewItem,
  ...indexes: readonly RelationshipPreviewIndex[]
): ReadonlyMap<string, readonly PairRelationshipPreview[]> {
  const sourceKey = relationshipPreviewItemKey(source);
  const merged = new Map<string, PairRelationshipPreview[]>();
  for (const index of indexes) {
    const targets = index.bySource.get(sourceKey);
    if (!targets) continue;
    for (const [targetKey, relationships] of targets) {
      const current = merged.get(targetKey) ?? [];
      for (const relationship of relationships) {
        if (
          !current.some(
            ({ family, featureId }) =>
              family === relationship.family &&
              featureId === relationship.featureId
          )
        ) {
          current.push(relationship);
        }
      }
      current.sort((left, right) =>
        Math.abs(right.weight) !== Math.abs(left.weight)
          ? Math.abs(right.weight) - Math.abs(left.weight)
          : left.featureId.localeCompare(right.featureId)
      );
      merged.set(targetKey, current);
    }
  }
  return merged;
}

/**
 * Collapse each related source/target pair to one signed score while retaining
 * every distinct displayed canonical feature for an on-demand breakdown.
 */
export function aggregateRelationshipTargetsFor(
  source: RelationshipPreviewItem,
  ...indexes: readonly RelationshipPreviewIndex[]
): ReadonlyMap<string, PairRelationshipAggregatePreview> {
  const sourceKey = relationshipPreviewItemKey(source);
  const aggregates = new Map<string, PairRelationshipAggregatePreview>();
  for (const [targetKey, components] of relationshipTargetsFor(
    source,
    ...indexes
  )) {
    if (targetKey === sourceKey || components.length === 0) continue;
    const distinct = components.filter(
      (component, index) =>
        components.findIndex(
          ({ featureId }) => featureId === component.featureId
        ) === index
    );
    const total = distinct.reduce(
      (sum, component) => sum + component.weight,
      0
    );
    if (total === 0) continue;
    const target = distinct[0].target;
    const signed = formatSignedWeight(total, 4);
    aggregates.set(targetKey, {
      source,
      target,
      total,
      components: distinct,
      accessibleLabel: `${target.name}与${source.name}的关系总分 ${signed}，共 ${distinct.length} 项；查看完整明细`,
    });
  }
  return aggregates;
}

const sourceHeroName = (
  layout: TeamBuilderLayout,
  source: TeamBuilderMoveSource
): string | null => {
  if (source.kind !== 'hero') return null;
  return source.origin === 'pool'
    ? source.hero
    : layout[source.teamIndex]?.heroes[source.heroIndex]?.hero ?? null;
};

/**
 * Return at most one team-owned HT preview for the highlighted hero. A pool
 * hero has no HT context until a concrete drag-over target defines the exact
 * post-replacement team. The canonical feature is therefore never repeated on
 * multiple hero cards.
 */
export function buildHeroTrioRelationshipPreviews(
  layout: TeamBuilderLayout,
  source: TeamBuilderMoveSource,
  model: PairedModel,
  prospectiveTarget?: TeamBuilderMoveTarget | null
): ReadonlyMap<number, PairRelationshipAggregatePreview> {
  const hero = sourceHeroName(layout, source);
  if (!hero || source.kind !== 'hero') return new Map();

  let concreteLayout = layout;
  if (prospectiveTarget) {
    if (
      prospectiveTarget.kind !== 'hero' ||
      prospectiveTarget.destination !== 'slot'
    ) {
      return new Map();
    }
    concreteLayout = applyTeamBuilderMove(layout, source, prospectiveTarget);
  } else if (source.origin === 'pool') {
    return new Map();
  }

  const teamIndex = concreteLayout.findIndex((team) =>
    team.heroes.some((slot) => slot.hero === hero)
  );
  if (teamIndex < 0) return new Map();
  const heroes = concreteLayout[teamIndex].heroes.flatMap((slot) =>
    slot.hero ? [slot.hero] : []
  );
  if (heroes.length !== 3 || new Set(heroes).size !== 3) return new Map();

  const featureId = htId(heroes[0], heroes[1], heroes[2]);
  const metadata = featureMetadata(model, featureId);
  if (!metadata || metadata.family !== F_HERO_TRIO) return new Map();

  const canonicalHeroes = [...heroes].sort();
  const trioName = canonicalHeroes.join('、');
  const sourceItem: RelationshipPreviewItem = { kind: 'hero', name: hero };
  const targetItem: RelationshipPreviewItem = {
    kind: 'hero',
    name: trioName,
  };
  const signed = formatSignedWeight(metadata.weight, 4);
  const component: PairRelationshipPreview = {
    featureId,
    family: F_HERO_TRIO,
    detailLabel: '精确三人组',
    label: '精确三人组',
    weight: metadata.weight,
    support: metadata.support,
    source: sourceItem,
    target: targetItem,
    accessibleLabel: `精确三人组：武将${trioName}组成同一队，模型权重 ${signed}，参考 ${metadata.support} 场`,
  };
  return new Map([
    [
      teamIndex,
      {
        source: sourceItem,
        target: targetItem,
        total: metadata.weight,
        components: [component],
        compactLabel: '三人组',
        detailHeading: `队伍 ${teamIndex + 1} · 精确三人组 ${trioName}`,
        accessibleLabel: `队伍 ${teamIndex + 1}，精确武将三人组${trioName}，关系总分 ${signed}，共 1 项；查看完整明细`,
      },
    ],
  ]);
}

export function resolveRelationshipPreviewItem(
  layout: TeamBuilderLayout,
  source: TeamBuilderMoveSource
): RelationshipPreviewItem | null {
  if (source.origin === 'pool') {
    return source.kind === 'hero'
      ? { kind: 'hero', name: source.hero }
      : { kind: 'skill', name: source.skill };
  }
  const slot = layout[source.teamIndex]?.heroes[source.heroIndex];
  if (!slot) return null;
  if (source.kind === 'hero') {
    return slot.hero ? { kind: 'hero', name: slot.hero } : null;
  }
  const skill = slot.skills[source.skillIndex];
  return skill ? { kind: 'skill', name: skill } : null;
}
