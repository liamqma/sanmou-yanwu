import type {
  FeatureFamily,
  PairedModel,
  RecommendationCatalog,
} from '../types/recommendation';
import {
  FEATURE_RELATIONSHIP_LABELS,
  MECHANIC_RELATION_LABELS,
  formatSignedWeight,
} from './featureLabels';
import {
  F_HERO_PAIR,
  F_HERO_SKILL,
  F_MECHANIC,
  F_SKILL_PAIR,
  F_TEAM_HERO_SKILL,
  F_TEAM_SKILL_PAIR,
  heroPairId,
  heroSkillId,
  mechanicWitnesses,
  skillPairId,
  thsId,
  tspId,
  type AssignedHero,
  type MechanicWitness,
  type MechanicWitnessSkill,
} from './recommendationModel';
import {
  applyTeamBuilderMove,
  type TeamBuilderLayout,
  type TeamBuilderMoveSource,
  type TeamBuilderMoveTarget,
  type TeamBuilderTeam,
} from './teamBuilderArrangement';

export type RelationshipPreviewKind = 'hero' | 'skill';
export type PairRelationshipFamily = 'HP' | 'HS' | 'THS' | 'SP' | 'TSP' | 'M';
export interface RelationshipPreviewItem {
  kind: RelationshipPreviewKind;
  name: string;
}

export interface PairRelationshipPreview {
  featureId: string;
  family: PairRelationshipFamily;
  label: string;
  weight: number;
  support: number;
  source: RelationshipPreviewItem;
  target: RelationshipPreviewItem;
  accessibleLabel: string;
  mechanicWitness?: MechanicWitness;
  carrierHero?: string;
}

export interface PairRelationshipAggregatePreview {
  source: RelationshipPreviewItem;
  target: RelationshipPreviewItem;
  total: number;
  components: readonly PairRelationshipPreview[];
  accessibleLabel: string;
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
  family: FeatureFamily;
  weight: number;
  support: number;
}

const PAIR_FAMILIES = new Set<PairRelationshipFamily>([
  'HP',
  'HS',
  'THS',
  'SP',
  'TSP',
  'M',
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
  family === F_TEAM_HERO_SKILL || family === F_TEAM_SKILL_PAIR
    ? model.min_support_team_context
    : family === F_MECHANIC
      ? model.min_support_mechanic
      : model.min_support_pair;

const featureMetadata = (
  model: PairedModel,
  featureId: string
): FeatureMetadata | null => {
  const family = featureId.split('|', 1)[0] as FeatureFamily;
  if (!PAIR_FAMILIES.has(family as PairRelationshipFamily)) return null;
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
  return { featureId, family, weight, support };
};

const pairAccessibleLabel = (
  family: PairRelationshipFamily,
  source: RelationshipPreviewItem,
  target: RelationshipPreviewItem,
  weight: number,
  support: number,
  carrierHero?: string,
  witness?: MechanicWitness,
  mechanicName?: string
): string => {
  const signed = formatSignedWeight(weight, 4);
  const evidence = `，参考 ${support} 场`;
  if (family === F_HERO_PAIR) {
    return `搭配：武将${source.name}与武将${target.name}，模型权重 ${signed}${evidence}`;
  }
  if (family === F_HERO_SKILL) {
    const hero = source.kind === 'hero' ? source.name : target.name;
    const skill = source.kind === 'skill' ? source.name : target.name;
    return `携带：武将${hero}直接携带战法${skill}，模型权重 ${signed}${evidence}`;
  }
  if (family === F_TEAM_HERO_SKILL) {
    const hero = source.kind === 'hero' ? source.name : target.name;
    const skill = source.kind === 'skill' ? source.name : target.name;
    return `同队：武将${hero}与战法${skill}处于同一队，模型权重 ${signed}${evidence}`;
  }
  if (family === F_SKILL_PAIR) {
    return `同武将：战法${source.name}与战法${target.name}均由${carrierHero ?? '同一武将'}携带，模型权重 ${signed}${evidence}`;
  }
  if (family === F_TEAM_SKILL_PAIR) {
    return `战法搭配：战法${source.name}与战法${target.name}处于同一队，模型权重 ${signed}${evidence}`;
  }
  const describeWitnessSkill = (skill: MechanicWitnessSkill): string =>
    skill.origin === 'default'
      ? `${skill.carrierHero}的自带战法${skill.skill}`
      : `${skill.carrierHero}战法位${skill.slotIndex}的${skill.skill}`;
  return witness
    ? `机制：${describeWitnessSkill(witness.provider)}提供${mechanicName ?? witness.mechanic}，${describeWitnessSkill(witness.consumer)}${MECHANIC_RELATION_LABELS[witness.relation] ?? witness.relation}，模型权重 ${signed}${evidence}`
    : `机制：${source.name}与${target.name}，模型权重 ${signed}${evidence}`;
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
  options: {
    carrierHero?: string;
    mechanicWitness?: MechanicWitness;
    mechanicName?: string;
  } = {}
) => {
  if (!PAIR_FAMILIES.has(metadata.family as PairRelationshipFamily)) return;
  const family = metadata.family as PairRelationshipFamily;
  const label = FEATURE_RELATIONSHIP_LABELS[family] ?? family;
  const create = (
    source: RelationshipPreviewItem,
    target: RelationshipPreviewItem
  ): PairRelationshipPreview => ({
    featureId: metadata.featureId,
    family,
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
      options.carrierHero,
      options.mechanicWitness,
      options.mechanicName
    ),
    ...(options.carrierHero ? { carrierHero: options.carrierHero } : {}),
    ...(options.mechanicWitness
      ? { mechanicWitness: options.mechanicWitness }
      : {}),
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
 * Build pool-stable HP/HS/THS/TSP lookups directly from canonical ids. This is
 * O(pool²) once per pool/model, never a scan of the complete model weight map.
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
      for (const featureId of [heroSkillId(hero, skill), thsId(hero, skill)]) {
        const metadata = featureMetadata(model, featureId);
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
  }

  for (let first = 0; first < uniqueSkills.length; first += 1) {
    for (let second = first + 1; second < uniqueSkills.length; second += 1) {
      const metadata = featureMetadata(
        model,
        tspId(uniqueSkills[first], uniqueSkills[second])
      );
      if (metadata) {
        addSymmetric(
          index,
          metadata,
          { kind: 'skill', name: uniqueSkills[first] },
          { kind: 'skill', name: uniqueSkills[second] }
        );
      }
    }
  }

  return sortIndex(index);
}

const assignedHeroes = (team: TeamBuilderTeam): AssignedHero[] =>
  team.heroes.flatMap((slot) =>
    slot.hero
      ? [
          {
            name: slot.hero,
            // Preserve equipped-slot positions for mechanics witnesses; the
            // extractor ignores the empty sentinel but retains array indexes.
            skills: slot.skills.map((skill) => skill ?? ''),
          },
        ]
      : []
  );

const witnessItem = (
  witnessSkill: MechanicWitnessSkill
): RelationshipPreviewItem =>
  witnessSkill.origin === 'default'
    ? { kind: 'hero', name: witnessSkill.carrierHero }
    : { kind: 'skill', name: witnessSkill.skill };

/** Recompute carrier-dependent SP and witness-backed M from one concrete layout. */
export function buildContextualRelationshipPreviewIndex(
  layout: TeamBuilderLayout,
  model: PairedModel,
  catalog: RecommendationCatalog
): RelationshipPreviewIndex {
  const index = emptyIndex();
  const enabled = new Set(model.enabled_families);

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

    const assigned = assignedHeroes(team);
    if (
      !enabled.has(F_MECHANIC) ||
      assigned.length !== 3 ||
      new Set(assigned.map(({ name }) => name)).size !== 3
    ) {
      continue;
    }
    for (const witness of mechanicWitnesses(assigned, catalog)) {
      const metadata = featureMetadata(model, witness.featureId);
      if (!metadata) continue;
      addSymmetric(
        index,
        metadata,
        witnessItem(witness.provider),
        witnessItem(witness.consumer),
        {
          mechanicWitness: witness,
          mechanicName:
            catalog.mechanics.mechanic_names[witness.mechanic] ??
            witness.mechanic,
        }
      );
    }
  }

  return sortIndex(index);
}

/** Apply the real move semantics before deriving carrier-dependent previews. */
export function buildProspectiveContextualRelationshipPreviewIndex(
  layout: TeamBuilderLayout,
  source: TeamBuilderMoveSource,
  target: TeamBuilderMoveTarget,
  model: PairedModel,
  catalog: RecommendationCatalog
): RelationshipPreviewIndex {
  return buildContextualRelationshipPreviewIndex(
    applyTeamBuilderMove(layout, source, target),
    model,
    catalog
  );
}

/** Merge static and contextual relationships for one highlighted card. */
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
 * every distinct canonical feature for an on-demand breakdown.
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
    const total = distinct.reduce((sum, component) => sum + component.weight, 0);
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
