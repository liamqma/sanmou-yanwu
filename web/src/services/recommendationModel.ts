/**
 * Pure paired-model primitives shared by the recommendation engine.
 *
 * Feature extraction here MUST stay in lockstep with
 * `data/build_recommendation_data.py` (`team_features`) — the client scores
 * rosters against final weights keyed by exactly these feature ids. Atomic
 * weights include the selection-count prior; interaction weights remain fitted
 * outcome coefficients. See README.md "Recommendation pipeline".
 *
 * A team is described by its heroes and, per hero, an *assigned* list of
 * currently filled equipped slots. Ordinary tactic families retain their
 * non-default/deduplicated semantics; M retains slot instances. The model scores
 * `w · features(team)`, a relative
 * roster-strength number against the learned metagame. It is NOT an
 * opponent-specific win probability.
 */
import type {
  PairedModel,
  RecommendationCatalog,
  ScoringMechanicRelationship,
} from '../types/recommendation';

export const F_HERO = 'H';
export const F_SKILL = 'S';
export const F_HERO_PAIR = 'HP';
export const F_HERO_SKILL = 'HS';
export const F_SKILL_PAIR = 'SP';
export const F_TEAM_HERO_SKILL = 'THS';
export const F_TEAM_SKILL_PAIR = 'TSP';
export const F_HERO_TRIO = 'HT';
export const F_TEAM_SKILL_TRIO = 'TS3';
export const F_HERO_CAMP = 'HC';
export const F_BOND = 'B';
export const F_MECHANIC = 'M';

const MECH_CONSUMER_RELATIONS = new Set([
  'benefits_from',
  'requires',
  'consumes',
]);
const ENEMY_TARGET_MASK = 1 << 3;

/** A hero with its currently filled equipped-skill slots on one team. */
export interface AssignedHero {
  name: string;
  /** Equipped slots in order; M preserves duplicates while ordinary families deduplicate. */
  skills: string[];
}

/** Sorted, comma-free join used to build order-independent pair ids. */
export const sortPair = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

const uniq = (xs: string[]): string[] => [...new Set(xs)];

// --------------------------------------------------------------------------- #
// Canonical feature-id builders — the ONLY place these ids are assembled.
//
// The Python builder (`data/build_recommendation_data.py`) keys its weights on
// exactly these strings, so every consumer (engine, prompt generator, analytics)
// MUST route through these helpers rather than re-deriving `H|…`/`HP|…` inline.
// A future change to the keying (e.g. locale-aware sorting) then stays in one
// place instead of silently diverging across hand-rolled copies.
// --------------------------------------------------------------------------- #

/** `H|<hero>` — hero presence. */
export const heroId = (hero: string): string => `${F_HERO}|${hero}`;

/** `S|<skill>` — non-default skill presence. */
export const skillId = (skill: string): string => `${F_SKILL}|${skill}`;

/** `HP|<a>|<b>` — unordered hero pair (operands sorted for order independence). */
export const heroPairId = (a: string, b: string): string => {
  const [x, y] = sortPair(a, b);
  return `${F_HERO_PAIR}|${x}|${y}`;
};

/** `HS|<hero>|<skill>` — hero assigned a non-default skill. */
export const heroSkillId = (hero: string, skill: string): string =>
  `${F_HERO_SKILL}|${hero}|${skill}`;

/** `SP|<hero>|<a>|<b>` — within-hero skill pair (skills sorted for order independence). */
export const skillPairId = (hero: string, s1: string, s2: string): string => {
  const [x, y] = sortPair(s1, s2);
  return `${F_SKILL_PAIR}|${hero}|${x}|${y}`;
};

/** `THS|<hero>|<skill>` — hero and tactic anywhere in one concrete team. */
export const thsId = (hero: string, skill: string): string =>
  `${F_TEAM_HERO_SKILL}|${hero}|${skill}`;

/** `TSP|<a>|<b>` — tactic pair anywhere in one concrete team. */
export const tspId = (skillA: string, skillB: string): string => {
  const [first, second] = sortPair(skillA, skillB);
  return `${F_TEAM_SKILL_PAIR}|${first}|${second}`;
};

/** `HT|<a>|<b>|<c>` — exact concrete hero trio. */
export const htId = (heroA: string, heroB: string, heroC: string): string =>
  `${F_HERO_TRIO}|${[heroA, heroB, heroC].sort().join('|')}`;

/** `TS3|<a>|<b>|<c>` — tactic triple anywhere in one concrete team. */
export const ts3Id = (skillA: string, skillB: string, skillC: string): string =>
  `${F_TEAM_SKILL_TRIO}|${[skillA, skillB, skillC].sort().join('|')}`;

/** Exclusive same-camp composition id. */
export const hcId = (count: 2 | 3): string => `${F_HERO_CAMP}|${count}`;

/** Activated named bond id. */
export const bondId = (name: string): string => `${F_BOND}|${name}`;

/** `M|<mechanic>|<consumer relation>|<target side>`. */
export const mechanicId = (
  mechanic: string,
  consumerRelation: 'benefits_from' | 'requires' | 'consumes',
  targetSide: 'friendly' | 'enemy'
): string => `${F_MECHANIC}|${mechanic}|${consumerRelation}|${targetSide}`;

/** Fail closed on a malformed generated relationship/mechanics contract. */
export function validateRecommendationCatalog(
  catalog: RecommendationCatalog,
  model?: PairedModel
): void {
  if (!/^[0-9a-f]{12}$/.test(catalog.relationship_version)) {
    throw new Error('Missing or invalid relationship_version');
  }
  const relationships = catalog.relationships;
  if (!relationships || typeof relationships !== 'object') {
    throw new Error('Missing recommendation relationships');
  }
  for (const [hero, camp] of Object.entries(relationships.hero_camp)) {
    if (!hero || !camp) throw new Error('Invalid hero-camp relationship');
  }
  const names = new Set<string>();
  for (const bond of relationships.bonds) {
    if (!bond.name || names.has(bond.name)) throw new Error('Invalid duplicate bond name');
    names.add(bond.name);
    if (bond.required_members !== 2 && bond.required_members !== 3) {
      throw new Error(`Invalid bond threshold for ${bond.name}`);
    }
    if (
      bond.required_members > bond.members.length ||
      bond.members.some((member) => !member) ||
      new Set(bond.members).size !== bond.members.length ||
      [...bond.members].sort().some((member, index) => member !== bond.members[index])
    ) {
      throw new Error(`Invalid normalized bond members for ${bond.name}`);
    }
  }

  if (!/^[0-9a-f]{12}$/.test(catalog.mechanics_version)) {
    throw new Error('Missing or invalid mechanics_version');
  }
  const mechanics = catalog.mechanics;
  if (
    !mechanics ||
    (mechanics.certainty_mode !== 'explicit_only' &&
      mechanics.certainty_mode !== 'all_reviewed')
  ) {
    throw new Error('Missing or invalid recommendation mechanics');
  }
  const mechanicIds = Object.keys(mechanics.mechanic_names);
  if (
    mechanicIds.some(
      (mechanic, index) =>
        !mechanic ||
        !mechanics.mechanic_names[mechanic] ||
        mechanic !== [...mechanicIds].sort()[index]
    )
  ) {
    throw new Error('Invalid normalized mechanic names');
  }
  const relationOrder = new Map([
    ['provides', 0],
    ['benefits_from', 1],
    ['requires', 2],
    ['consumes', 3],
  ]);
  const subjectOrder = new Map([
    ['self', 0],
    ['ally', 1],
    ['enemy', 2],
    ['any', 3],
    ['team', 4],
    ['unknown', 5],
  ]);
  const skillNames = Object.keys(mechanics.skills);
  if (skillNames.some((skill, index) => !skill || skill !== [...skillNames].sort()[index])) {
    throw new Error('Invalid normalized mechanic skill map');
  }
  for (const [skill, skillRelationships] of Object.entries(mechanics.skills)) {
    if (!Array.isArray(skillRelationships) || skillRelationships.length === 0) {
      throw new Error(`Invalid mechanic relationships for ${skill}`);
    }
    const seen = new Set<string>();
    let previousKey: string | null = null;
    for (const relationship of skillRelationships) {
      if (
        Object.keys(relationship).sort().join('|') !== 'mechanic|relation|subject' ||
        !relationOrder.has(relationship.relation) ||
        !subjectOrder.has(relationship.subject) ||
        !Object.hasOwn(mechanics.mechanic_names, relationship.mechanic)
      ) {
        throw new Error(`Invalid mechanic relationship for ${skill}`);
      }
      const identity = `${relationship.relation}|${relationship.mechanic}|${relationship.subject}`;
      if (seen.has(identity)) throw new Error(`Duplicate mechanic relationship for ${skill}`);
      seen.add(identity);
      const sortKey = `${String(relationOrder.get(relationship.relation)).padStart(2, '0')}|${relationship.mechanic}|${String(subjectOrder.get(relationship.subject)).padStart(2, '0')}`;
      if (previousKey !== null && sortKey < previousKey) {
        throw new Error(`Unsorted mechanic relationships for ${skill}`);
      }
      previousKey = sortKey;
    }
  }
  if (model) {
    if (!/^[0-9a-f]{12}$/.test(model.scoring_version)) {
      throw new Error('Missing or invalid scoring_version');
    }
    if (model.mech_certainty_mode !== mechanics.certainty_mode) {
      throw new Error('Model and mechanics certainty modes differ');
    }
    if (
      model.enabled_families.includes(F_MECHANIC) &&
      (model.min_support_mechanic < 1 ||
        model.min_mechanic_pair_diversity < 1 ||
        model.mechanic_shrinkage < 0 ||
        model.mechanic_shrinkage > 1)
    ) {
      throw new Error('Invalid production MECH configuration');
    }
  }
}

export type MechanicConsumerRelation =
  | 'benefits_from'
  | 'requires'
  | 'consumes';
export type MechanicSkillOrigin = 'default' | 'equipped';

/** One concrete skill instance that participates in a reviewed M witness. */
export interface MechanicWitnessSkill {
  skill: string;
  carrierHero: string;
  origin: MechanicSkillOrigin;
  /** Canonical skill slot: default/signature is 0; equipped slots start at 1. */
  slotIndex: number;
}

/**
 * Concrete proof that one provider instance and one consumer instance emit an
 * M feature. M ids deliberately omit both skill identities, so preview callers
 * must retain this witness rather than reverse-infer a pair from the id.
 */
export interface MechanicWitness {
  provider: MechanicWitnessSkill;
  consumer: MechanicWitnessSkill;
  mechanic: string;
  relation: MechanicConsumerRelation;
  side: 'friendly' | 'enemy';
  featureId: string;
}

interface MechanicSkillInstance {
  id: number;
  carrierIndex: number;
  skill: string;
}

interface MechanicWitnessSkillInstance extends MechanicSkillInstance {
  carrierHero: string;
  origin: MechanicSkillOrigin;
  slotIndex: number;
}

interface MechanicWitnessSpec {
  mechanic: string;
  relation: MechanicConsumerRelation;
  side: 'friendly' | 'enemy';
  featureId: string;
}

interface MechanicPairFeatures {
  sameCarrier: MechanicWitnessSpec[];
  differentCarrier: MechanicWitnessSpec[];
}

type MechanicPairIndex = Map<string, Map<string, MechanicPairFeatures>>;

const mechanicPairIndexCache = new WeakMap<
  RecommendationCatalog['mechanics'],
  MechanicPairIndex
>();

const mechanicTargetMask = (
  subject: ScoringMechanicRelationship['subject'],
  carrierIndex: number
): number => {
  const friendlyMask = 0b111;
  const carrierMask = 1 << carrierIndex;
  if (subject === 'self') return carrierMask;
  if (subject === 'ally') return friendlyMask & ~carrierMask;
  if (subject === 'team') return friendlyMask;
  if (subject === 'enemy') return ENEMY_TARGET_MASK;
  if (subject === 'any') return friendlyMask | ENEMY_TARGET_MASK;
  return 0; // `unknown` deliberately has no possible target.
};

const pairWitnessSpecs = (
  providerRelationships: ScoringMechanicRelationship[],
  consumerRelationships: ScoringMechanicRelationship[],
  sameCarrier: boolean
): MechanicWitnessSpec[] => {
  const specs = new Map<string, MechanicWitnessSpec>();
  for (const provider of providerRelationships) {
    if (provider.relation !== 'provides') continue;
    const providerTargets = mechanicTargetMask(provider.subject, 0);
    if (providerTargets === 0) continue;
    for (const consumer of consumerRelationships) {
      if (
        !MECH_CONSUMER_RELATIONS.has(consumer.relation) ||
        provider.mechanic !== consumer.mechanic
      ) {
        continue;
      }
      const overlap =
        providerTargets & mechanicTargetMask(consumer.subject, sameCarrier ? 0 : 1);
      if (overlap === 0) continue;
      const relation = consumer.relation as MechanicConsumerRelation;
      const addSpec = (side: 'friendly' | 'enemy') => {
        const featureId = mechanicId(provider.mechanic, relation, side);
        specs.set(featureId, {
          mechanic: provider.mechanic,
          relation,
          side,
          featureId,
        });
      };
      if ((overlap & ENEMY_TARGET_MASK) !== 0) addSpec('enemy');
      if ((overlap & 0b111) !== 0) addSpec('friendly');
    }
  }
  return [...specs.values()];
};

/**
 * Compile the immutable contract into ordered skill-pair compatibility once.
 * Subject overlap depends only on whether the two slot instances share a
 * carrier, so hot formation scoring never needs to rebuild target sets or scan
 * relationship arrays.
 */
const mechanicPairIndex = (
  mechanics: RecommendationCatalog['mechanics']
): MechanicPairIndex => {
  const cached = mechanicPairIndexCache.get(mechanics);
  if (cached) return cached;
  const index: MechanicPairIndex = new Map();
  const skillRelationships = Object.entries(mechanics.skills);
  for (const [providerSkill, providerRelationships] of skillRelationships) {
    if (!providerRelationships.some(({ relation }) => relation === 'provides')) {
      continue;
    }
    const consumers = new Map<string, MechanicPairFeatures>();
    for (const [consumerSkill, consumerRelationships] of skillRelationships) {
      if (
        !consumerRelationships.some(({ relation }) =>
          MECH_CONSUMER_RELATIONS.has(relation)
        )
      ) {
        continue;
      }
      const sameCarrier = pairWitnessSpecs(
        providerRelationships,
        consumerRelationships,
        true
      );
      const differentCarrier = pairWitnessSpecs(
        providerRelationships,
        consumerRelationships,
        false
      );
      if (sameCarrier.length > 0 || differentCarrier.length > 0) {
        consumers.set(consumerSkill, { sameCarrier, differentCarrier });
      }
    }
    if (consumers.size > 0) index.set(providerSkill, consumers);
  }
  mechanicPairIndexCache.set(mechanics, index);
  return index;
};

function mechanicSkillInstances(
  team: AssignedHero[],
  catalog: RecommendationCatalog,
  includeWitnessMetadata: false
): MechanicSkillInstance[];
function mechanicSkillInstances(
  team: AssignedHero[],
  catalog: RecommendationCatalog,
  includeWitnessMetadata: true
): MechanicWitnessSkillInstance[];
function mechanicSkillInstances(
  team: AssignedHero[],
  catalog: RecommendationCatalog,
  includeWitnessMetadata: boolean
): Array<MechanicSkillInstance | MechanicWitnessSkillInstance> {
  const instances: Array<MechanicSkillInstance | MechanicWitnessSkillInstance> = [];
  let instanceId = 0;
  team.forEach((hero, carrierIndex) => {
    const signature = catalog.default_skill[hero.name];
    if (!signature) throw new Error(`Missing canonical signature for ${hero.name}`);
    const signatureInstance = { id: instanceId, carrierIndex, skill: signature };
    instances.push(
      includeWitnessMetadata
        ? {
            ...signatureInstance,
            carrierHero: hero.name,
            origin: 'default',
            slotIndex: 0,
          }
        : signatureInstance
    );
    instanceId += 1;
    (hero.skills ?? []).forEach((skill, equippedIndex) => {
      if (!skill) return;
      const equippedInstance = { id: instanceId, carrierIndex, skill };
      instances.push(
        includeWitnessMetadata
          ? {
              ...equippedInstance,
              carrierHero: hero.name,
              origin: 'equipped',
              slotIndex: equippedIndex + 1,
            }
          : equippedInstance
      );
      instanceId += 1;
    });
  });
  return instances;
}

const forEachMechanicMatch = <
  TInstance extends MechanicSkillInstance,
  TOutput,
>(
  instances: TInstance[],
  pairIndex: MechanicPairIndex,
  output: TOutput,
  collect: (
    output: TOutput,
    provider: TInstance,
    consumer: TInstance,
    spec: MechanicWitnessSpec
  ) => void
): void => {
  for (const provider of instances) {
    const consumers = pairIndex.get(provider.skill);
    if (!consumers) continue;
    for (const consumer of instances) {
      if (provider.id === consumer.id) continue;
      const pair = consumers.get(consumer.skill);
      if (!pair) continue;
      const active =
        provider.carrierIndex === consumer.carrierIndex
          ? pair.sameCarrier
          : pair.differentCarrier;
      for (const spec of active) collect(output, provider, consumer, spec);
    }
  }
};

const collectMechanicFeatureId = (
  features: Set<string>,
  _provider: MechanicSkillInstance,
  _consumer: MechanicSkillInstance,
  spec: MechanicWitnessSpec
): void => {
  features.add(spec.featureId);
};

const addMechanicFeatureIds = (
  team: AssignedHero[],
  catalog: RecommendationCatalog,
  features: Set<string>
): void => {
  const pairIndex = mechanicPairIndex(catalog.mechanics);
  if (pairIndex.size === 0) return;
  forEachMechanicMatch(
    mechanicSkillInstances(team, catalog, false),
    pairIndex,
    features,
    collectMechanicFeatureId
  );
};

const collectMechanicWitness = (
  witnesses: MechanicWitness[],
  provider: MechanicWitnessSkillInstance,
  consumer: MechanicWitnessSkillInstance,
  spec: MechanicWitnessSpec
): void => {
  witnesses.push({
    provider: {
      skill: provider.skill,
      carrierHero: provider.carrierHero,
      origin: provider.origin,
      slotIndex: provider.slotIndex,
    },
    consumer: {
      skill: consumer.skill,
      carrierHero: consumer.carrierHero,
      origin: consumer.origin,
      slotIndex: consumer.slotIndex,
    },
    mechanic: spec.mechanic,
    relation: spec.relation,
    side: spec.side,
    featureId: spec.featureId,
  });
};

/** Extract concrete provider/consumer witnesses without collapsing M identity. */
export function mechanicWitnesses(
  team: AssignedHero[],
  catalog: RecommendationCatalog
): MechanicWitness[] {
  const heroNames = Array.from(team, (hero) => hero?.name);
  if (
    team.length !== 3 ||
    heroNames.some(
      (name) => typeof name !== 'string' || name.trim().length === 0
    ) ||
    new Set(heroNames).size !== 3
  ) {
    return [];
  }
  const pairIndex = mechanicPairIndex(catalog.mechanics);
  if (pairIndex.size === 0) return [];
  const witnesses: MechanicWitness[] = [];
  forEachMechanicMatch(
    mechanicSkillInstances(team, catalog, true),
    pairIndex,
    witnesses,
    collectMechanicWitness
  );
  return witnesses;
}

/**
 * Build the binary feature-id set for a roster. H/S/HP/HS/SP remain pool-safe;
 * context families fire only for an exact concrete three-hero team.
 */
export function teamFeatureIds(
  team: AssignedHero[],
  catalog?: RecommendationCatalog,
  concreteTeam = true,
  enabledFamilies?: ReadonlySet<string>
): Set<string> {
  const feats = new Set<string>();
  const heroes = team.map((h) => h.name).filter(Boolean);

  for (const hero of heroes) feats.add(heroId(hero));

  const uniqHeroes = uniq(heroes).sort();
  for (let i = 0; i < uniqHeroes.length; i++) {
    for (let j = i + 1; j < uniqHeroes.length; j++) {
      feats.add(heroPairId(uniqHeroes[i], uniqHeroes[j]));
    }
  }

  const teamSkills = new Set<string>();
  for (const { name: hero, skills } of team) {
    if (!hero) continue;
    const signature = catalog?.default_skill[hero];
    const s = uniq(
      (skills || []).filter((skill) => Boolean(skill) && skill !== signature)
    );
    for (const skill of s) {
      teamSkills.add(skill);
      feats.add(skillId(skill));
      feats.add(heroSkillId(hero, skill));
    }
    const sorted = [...s].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        feats.add(skillPairId(hero, sorted[i], sorted[j]));
      }
    }
  }

  const isConcreteTeam =
    concreteTeam && team.length === 3 && uniqHeroes.length === 3;
  if (!isConcreteTeam) return feats;

  const familyEnabled = (family: string) =>
    enabledFamilies === undefined || enabledFamilies.has(family);
  const sortedSkills = [...teamSkills].sort();
  if (familyEnabled(F_TEAM_HERO_SKILL)) {
    for (const hero of uniqHeroes) {
      for (const skill of sortedSkills) feats.add(thsId(hero, skill));
    }
  }
  if (familyEnabled(F_TEAM_SKILL_PAIR)) {
    for (let first = 0; first < sortedSkills.length; first++) {
      for (let second = first + 1; second < sortedSkills.length; second++) {
        feats.add(tspId(sortedSkills[first], sortedSkills[second]));
      }
    }
  }
  if (familyEnabled(F_HERO_TRIO)) {
    feats.add(htId(uniqHeroes[0], uniqHeroes[1], uniqHeroes[2]));
  }
  if (familyEnabled(F_TEAM_SKILL_TRIO)) {
    for (let first = 0; first < sortedSkills.length; first++) {
      for (let second = first + 1; second < sortedSkills.length; second++) {
        for (let third = second + 1; third < sortedSkills.length; third++) {
          feats.add(ts3Id(sortedSkills[first], sortedSkills[second], sortedSkills[third]));
        }
      }
    }
  }

  if (familyEnabled(F_MECHANIC)) {
    if (!catalog) {
      if (enabledFamilies?.has(F_MECHANIC)) {
        throw new Error('Concrete M scoring requires the recommendation catalog');
      }
    } else {
      addMechanicFeatureIds(team, catalog, feats);
    }
  }

  const relationships = catalog?.relationships;
  if (!relationships) return feats;
  const camps = uniqHeroes.map((hero) => relationships.hero_camp[hero]);
  if (camps.every(Boolean)) {
    const counts = new Map<string, number>();
    for (const camp of camps) counts.set(camp, (counts.get(camp) ?? 0) + 1);
    const largest = Math.max(...counts.values());
    if (
      familyEnabled(F_HERO_CAMP) &&
      (largest === 2 || largest === 3)
    ) {
      feats.add(hcId(largest));
    }
  }
  if (familyEnabled(F_BOND)) {
    const heroSet = new Set(uniqHeroes);
    for (const bond of relationships.bonds) {
      const activeMembers = bond.members.filter((member) => heroSet.has(member)).length;
      if (activeMembers >= bond.required_members) feats.add(bondId(bond.name));
    }
  }
  return feats;
}

/** Model weight for a feature id (missing → neutral prior of 0). */
export function weightOf(model: PairedModel, featureId: string): number {
  return model.weights[featureId] ?? 0;
}

/** Support/evidence count for a feature id (missing → 0). */
export function supportOf(model: PairedModel, featureId: string): number {
  return model.support[featureId] ?? 0;
}

/**
 * Relative roster-strength score for a team: the sum of final model weights over the
 * team's active features. Higher = relatively stronger against the metagame.
 * The intercept is intentionally omitted — it is a constant shared by every
 * option a user compares, so it never changes a ranking.
 */
export function scoreTeam(
  team: AssignedHero[],
  model: PairedModel,
  catalog?: RecommendationCatalog,
  concreteTeam = true,
  enabledFamilies: ReadonlySet<string> = new Set(model.enabled_families)
): number {
  let score = 0;
  for (const fid of teamFeatureIds(
    team,
    catalog,
    concreteTeam,
    enabledFamilies
  )) {
    score += weightOf(model, fid);
  }
  return score;
}

/**
 * Score just the hero-level features (hero presence + hero pairs) of a set of
 * heroes, ignoring skills. Used for roster-strength deltas in hero rounds where
 * skills are not yet assigned.
 */
export function scoreHeroes(heroes: string[], model: PairedModel): number {
  return scoreTeam(
    heroes.map((name) => ({ name, skills: [] })),
    model,
    undefined,
    false
  );
}

/**
 * Split a skill list into (defaultSkills, nonDefaultSkills) for a hero using the
 * catalog's default-skill map. The default (signature) skill is not a feature.
 */
export function nonDefaultSkillsForHero(
  hero: string,
  skills: string[],
  catalog: RecommendationCatalog
): string[] {
  const def = catalog.default_skill[hero];
  return skills.filter((s) => s && s !== def);
}

/** Evidence summary for a score: total support of the features that fired. */
export interface EvidenceSummary {
  /** Number of distinct emitted (non-neutral) features that contributed. */
  featureCount: number;
  /** Sum of support counts across contributing features. */
  totalSupport: number;
  /** Minimum support among contributing features (weakest evidence link). */
  minSupport: number;
}

/** A single emitted feature that fired for a team, with its family + evidence. */
export interface ActiveContribution {
  /** Feature id (e.g. `HP|a|b`). */
  featureId: string;
  /** Canonical feature-family prefix. */
  family: string;
  /** Final model weight (relative roster-strength contribution). */
  weight: number;
  /** Support/evidence: battles this feature was observed in. */
  support: number;
}

/**
 * All emitted (non-neutral) features that fire for a fully-assigned team, with
 * their weight + support. This is the canonical source of per-team "why" — the
 * engine's positive evidence display filters and groups these rather than
 * re-deriving feature ids inline. Ordered by descending weight, then feature id
 * for determinism.
 */
export function activeTeamContributions(
  team: AssignedHero[],
  model: PairedModel,
  catalog?: RecommendationCatalog
): ActiveContribution[] {
  const out: ActiveContribution[] = [];
  const enabledFamilies = new Set(model.enabled_families);
  for (const fid of teamFeatureIds(team, catalog, true, enabledFamilies)) {
    const w = model.weights[fid];
    if (w === undefined || w === 0) continue;
    out.push({ featureId: fid, family: fid.split('|')[0], weight: w, support: supportOf(model, fid) });
  }
  out.sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.featureId.localeCompare(b.featureId)));
  return out;
}

export function evidenceFor(
  team: AssignedHero[],
  model: PairedModel,
  catalog?: RecommendationCatalog
): EvidenceSummary {
  let featureCount = 0;
  let totalSupport = 0;
  let minSupport = Infinity;
  const enabledFamilies = new Set(model.enabled_families);
  for (const fid of teamFeatureIds(team, catalog, true, enabledFamilies)) {
    if (model.weights[fid] === undefined) continue;
    featureCount += 1;
    const sup = supportOf(model, fid);
    totalSupport += sup;
    if (sup < minSupport) minSupport = sup;
  }
  return {
    featureCount,
    totalSupport,
    minSupport: minSupport === Infinity ? 0 : minSupport,
  };
}
