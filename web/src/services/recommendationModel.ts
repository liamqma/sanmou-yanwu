/**
 * Pure paired-model primitives shared by the recommendation engine.
 *
 * Feature extraction here MUST stay in lockstep with
 * `data/build_recommendation_data.py` (`team_features`) — the client scores
 * rosters against weights fitted on exactly these feature ids. See README.md
 * "Recommendation pipeline".
 *
 * A team is described by its heroes and, per hero, an *assigned* list of
 * non-default skills. Offline-parsed mechanics add each hero's catalog
 * signature plus reusable numeric/status context at scoring time. The model
 * scores `w · features(team)`, a relative roster-strength number against the
 * learned metagame. It is NOT an
 * opponent-specific win probability.
 */
import type {
  PairedModel,
  RecommendationCatalog,
  RecommendationMechanics,
  StatusRecipientScope,
} from '../types/recommendation';

export const F_HERO = 'H';
export const F_SKILL = 'S';
export const F_HERO_PAIR = 'HP';
export const F_HERO_SKILL = 'HS';
export const F_SKILL_PAIR = 'SP';
export const F_MECHANIC = 'M';
export const F_PROVIDER = 'MP';
export const F_CONSUMER = 'MC';
export const F_MECHANIC_INTERACTION = 'MX';
export const F_HERO_MECHANIC_INTERACTION = 'HMX';
export const F_HERO_META = 'HM';
export const F_CAMP = 'HC';
export const F_HERO_SCALING_MATCH = 'HSM';
export const F_TROOP_MATCH = 'HTM';
export const F_BOND = 'B';
export const F_BOND_MECHANIC = 'BM';

/** A hero with the specific non-default skills assigned to it on a team. */
export interface AssignedHero {
  name: string;
  /** Non-default skills assigned to this hero (defaults excluded upstream). */
  skills: string[];
}

/** Sorted, comma-free join used to build order-independent pair ids. */
export const sortPair = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

const uniq = (xs: string[]): string[] => [...new Set(xs)];
const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const probabilityUnion = (probabilities: number[]): number =>
  round6(
    1 -
      probabilities.reduce(
        (unavailable, probability) =>
          unavailable * (1 - Math.min(1, Math.max(0, probability))),
        1
      )
  );

const probabilityUnionGrouped = (
  events: Array<{ eventId: string; probability: number }>
): number => {
  const grouped = new Map<string, number>();
  for (const event of events) {
    grouped.set(
      event.eventId,
      Math.max(grouped.get(event.eventId) ?? 0, event.probability)
    );
  }
  return probabilityUnion(
    [...grouped]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, value]) => value)
  );
};

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

interface MechanicInstance {
  hero: string;
  skill: string;
  probability: number;
  recipientScopes: ReadonlySet<StatusRecipientScope>;
  eligibleRecipients?: ReadonlySet<string>;
  eventId: string;
}

const statusScopes = (
  row: {
    provides_scopes?: Record<string, StatusRecipientScope[]>;
    consumes_scopes?: Record<string, StatusRecipientScope[]>;
  },
  field: 'provides_scopes' | 'consumes_scopes',
  status: string
): ReadonlySet<StatusRecipientScope> =>
  new Set(row[field]?.[status] ?? ['unknown']);

const statusScopesCompatible = (
  provider: MechanicInstance,
  consumer: MechanicInstance
): boolean => {
  if (
    provider.recipientScopes.has('unknown') ||
    consumer.recipientScopes.has('unknown')
  ) {
    return true;
  }
  for (const providerScope of provider.recipientScopes) {
    for (const consumerScope of consumer.recipientScopes) {
      if (providerScope === 'enemy' || consumerScope === 'enemy') {
        if (providerScope === 'enemy' && consumerScope === 'enemy') return true;
        continue;
      }
      if (providerScope === 'self' && consumerScope === 'self') {
        if (provider.hero === consumer.hero) return true;
      } else if (providerScope === 'self' && consumerScope === 'ally') {
        if (provider.hero !== consumer.hero) return true;
      } else if (providerScope === 'ally' && consumerScope === 'self') {
        if (provider.hero !== consumer.hero) return true;
      } else {
        return true;
      }
    }
  }
  return false;
};

const statusEvents = (
  row: RecommendationMechanics['skills'][string],
  role: 'provides' | 'consumes'
): Array<{
  status: string;
  probability: number;
  recipientScopes: ReadonlySet<StatusRecipientScope>;
  eventId: string;
}> => {
  const events = role === 'provides' ? row.provides_events : row.consumes_events;
  if (events) {
    return events.map((event) => ({
      status: event.status,
      probability: event.probability,
      recipientScopes: new Set([event.recipient_scope]),
      eventId: event.event_id ?? `legacy:${event.status}:${event.recipient_scope}`,
    }));
  }
  const scopeField =
    role === 'provides' ? 'provides_scopes' : 'consumes_scopes';
  return row[role].map((status) => ({
    status,
    probability: 1,
    recipientScopes: statusScopes(row, scopeField, status),
    eventId: `legacy:${role}:${status}`,
  }));
};

const bondIndexes = new WeakMap<
  RecommendationMechanics,
  Map<string, string[]>
>();

const bondIndexFor = (
  mechanics: RecommendationMechanics
): Map<string, string[]> => {
  const cached = bondIndexes.get(mechanics);
  if (cached) return cached;
  const index = new Map<string, string[]>();
  for (const [bondName, bond] of Object.entries(mechanics.bonds)) {
    for (const hero of bond.members) {
      index.set(hero, [...(index.get(hero) ?? []), bondName]);
    }
  }
  bondIndexes.set(mechanics, index);
  return index;
};

interface ActiveBond {
  name: string;
  activeMembers: string[];
}

const activeBondCaches = new WeakMap<
  RecommendationMechanics,
  Map<string, ActiveBond[]>
>();

const activeBondsFor = (
  mechanics: RecommendationMechanics,
  heroes: string[]
): ActiveBond[] => {
  let cache = activeBondCaches.get(mechanics);
  if (!cache) {
    cache = new Map<string, ActiveBond[]>();
    activeBondCaches.set(mechanics, cache);
  }
  const key = [...heroes].sort().join('|');
  const cached = cache.get(key);
  if (cached) return cached;

  const teamNames = new Set(heroes);
  const index = bondIndexFor(mechanics);
  const relevantNames = new Set(
    heroes.flatMap((hero) => index.get(hero) ?? [])
  );
  const active = [...relevantNames]
    .map((name) => ({
      name,
      activeMembers: mechanics.bonds[name].members.filter((member) =>
        teamNames.has(member)
      ),
    }))
    .filter(
      ({ name, activeMembers }) =>
        activeMembers.length >= mechanics.bonds[name].required_members
    );
  cache.set(key, active);
  return active;
};

/** Build numeric feature values for a team, matching the Python builder. */
export function teamFeatureValues(
  team: AssignedHero[],
  mechanics?: PairedModel['mechanics']
): Map<string, number> {
  const feats = new Map<string, number>();
  const heroes = team.map((h) => h.name).filter(Boolean);

  for (const hero of heroes) feats.set(heroId(hero), 1);

  const uniqHeroes = uniq(heroes).sort();
  for (let i = 0; i < uniqHeroes.length; i++) {
    for (let j = i + 1; j < uniqHeroes.length; j++) {
      feats.set(heroPairId(uniqHeroes[i], uniqHeroes[j]), 1);
    }
  }

  for (const { name: hero, skills } of team) {
    if (!hero) continue;
    const s = uniq((skills || []).filter(Boolean));
    for (const skill of s) {
      feats.set(skillId(skill), 1);
      feats.set(heroSkillId(hero, skill), 1);
    }
    const sorted = [...s].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        feats.set(skillPairId(hero, sorted[i], sorted[j]), 1);
      }
    }
  }

  if (!mechanics) return feats;

  const providers = new Map<string, MechanicInstance[]>();
  const consumers = new Map<string, MechanicInstance[]>();
  const append = (
    target: Map<string, MechanicInstance[]>,
    status: string,
    instance: MechanicInstance
  ) => target.set(status, [...(target.get(status) ?? []), instance]);
  const addValue = (featureId: string, value: number) =>
    feats.set(featureId, round6((feats.get(featureId) ?? 0) + value));
  const camps = new Map<string, number>();
  const troops = new Map<string, number>();

  for (const hero of heroes) {
    const row = mechanics.heroes[hero];
    if (!row) continue;
    camps.set(row.camp, (camps.get(row.camp) ?? 0) + 1);
    troops.set(row.troop, (troops.get(row.troop) ?? 0) + 1);
    addValue(`${F_HERO_META}|CAMP|${row.camp}`, 1);
    addValue(`${F_HERO_META}|TROOP|${row.troop}`, 1);
    for (const [attribute, value] of Object.entries(row.normalized_stats)) {
      addValue(`${F_HERO_META}|STAT|${attribute}`, value);
    }
  }
  const sameCampCount = Math.max(0, ...camps.values());
  if (sameCampCount >= 3) feats.set(`${F_CAMP}|SAME|3`, 0.1);
  else if (sameCampCount === 2) feats.set(`${F_CAMP}|SAME|2`, 0.05);

  for (const { name: hero, skills } of team) {
    if (!hero) continue;
    const heroRow = mechanics.heroes[hero];
    const activeSkills = uniq([
      mechanics.default_skill[hero] ?? '',
      ...(skills || []),
    ].filter(Boolean));
    for (const skill of activeSkills) {
      const row = mechanics.skills[skill];
      if (!row) continue;
      for (const [feature, value] of Object.entries(row.features)) {
        addValue(`${F_MECHANIC}|${feature}`, value);
        if (feature.startsWith('SCALES_WITH|')) {
          const attribute = feature.split('|', 2)[1];
          const stat = heroRow?.normalized_stats[attribute];
          if (stat !== undefined) {
            addValue(
              `${F_HERO_SCALING_MATCH}|${attribute}`,
              row.probability * stat
            );
          }
        }
        if (feature.startsWith('TROOP_TARGET|')) {
          const troop = feature.split('|', 2)[1];
          const matching = troops.get(troop) ?? 0;
          if (matching > 0) {
            addValue(
              `${F_TROOP_MATCH}|${troop}`,
              (row.probability * matching) / 3
            );
          }
        }
      }
      for (const event of statusEvents(row, 'provides')) {
        append(providers, event.status, {
          hero,
          skill,
          probability: row.probability * event.probability,
          recipientScopes: event.recipientScopes,
          eventId: `skill:${hero}:${skill}:${event.eventId}`,
        });
      }
      for (const event of statusEvents(row, 'consumes')) {
        append(consumers, event.status, {
          hero,
          skill,
          probability: row.probability * event.probability,
          recipientScopes: event.recipientScopes,
          eventId: `skill:${hero}:${skill}:${event.eventId}`,
        });
      }
    }
  }

  for (const { name: bondName, activeMembers } of activeBondsFor(
    mechanics,
    heroes
  )) {
    const row = mechanics.bonds[bondName];
    feats.set(`${F_BOND}|${bondName}`, 1);
    const memberShare = activeMembers.length / 3;
    addValue(`${F_BOND_MECHANIC}|ACTIVE_MEMBER_SHARE`, memberShare);
    for (const [feature, value] of Object.entries(row.features)) {
      addValue(`${F_BOND_MECHANIC}|${feature}`, value * memberShare);
    }
    const eligibleRecipients =
      row.recipient_scope === 'active_members'
        ? new Set(activeMembers)
        : undefined;
    for (const member of activeMembers) {
      for (const event of statusEvents(row, 'provides')) {
        append(providers, event.status, {
          hero: member,
          skill: `bond:${bondName}`,
          probability: row.probability * event.probability,
          recipientScopes: event.recipientScopes,
          eligibleRecipients,
          eventId: `bond:${bondName}:${event.eventId}`,
        });
      }
      for (const event of statusEvents(row, 'consumes')) {
        append(consumers, event.status, {
          hero: member,
          skill: `bond:${bondName}`,
          probability: row.probability * event.probability,
          recipientScopes: event.recipientScopes,
          eligibleRecipients,
          eventId: `bond:${bondName}:${event.eventId}`,
        });
      }
    }
  }

  for (const [status, instances] of providers) {
    feats.set(
      `${F_PROVIDER}|${status}`,
      probabilityUnionGrouped(
        instances.map((instance) => ({
          eventId: instance.eventId,
          probability: instance.probability,
        }))
      )
    );
  }
  for (const [status, instances] of consumers) {
    feats.set(
      `${F_CONSUMER}|${status}`,
      probabilityUnionGrouped(
        instances.map((instance) => ({
          eventId: instance.eventId,
          probability: instance.probability,
        }))
      )
    );
  }

  for (const status of [...providers.keys()].filter((name) => consumers.has(name)).sort()) {
    const beneficiaryValues = new Map<
      string,
      Array<{ eventId: string; probability: number }>
    >();
    const allPairValues: Array<{ eventId: string; probability: number }> = [];
    for (const consumer of consumers.get(status) ?? []) {
      const externalProbability = probabilityUnionGrouped(
        (providers.get(status) ?? [])
          .filter(
            (provider) =>
              (provider.hero !== consumer.hero ||
                provider.skill !== consumer.skill) &&
              (provider.eligibleRecipients === undefined ||
                provider.eligibleRecipients.has(consumer.hero)) &&
              statusScopesCompatible(provider, consumer)
          )
          .map((provider) => ({
            eventId: provider.eventId,
            probability: provider.probability,
          }))
      );
      if (externalProbability <= 0) continue;
      const pairEvent = {
        eventId: consumer.eventId,
        probability: round6(externalProbability * consumer.probability),
      };
      allPairValues.push(pairEvent);
      beneficiaryValues.set(consumer.hero, [
        ...(beneficiaryValues.get(consumer.hero) ?? []),
        pairEvent,
      ]);
    }
    if (allPairValues.length > 0) {
      feats.set(
        `${F_MECHANIC_INTERACTION}|${status}`,
        probabilityUnionGrouped(allPairValues)
      );
    }
    for (const [hero, values] of beneficiaryValues) {
      feats.set(
        `${F_HERO_MECHANIC_INTERACTION}|${hero}|${status}`,
        probabilityUnionGrouped(values)
      );
    }
  }

  return feats;
}

/** Feature-id compatibility helper for consumers that only need presence. */
export function teamFeatureIds(
  team: AssignedHero[],
  mechanics?: PairedModel['mechanics']
): Set<string> {
  return new Set(teamFeatureValues(team, mechanics).keys());
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
 * Relative roster-strength score for a team: the sum of fitted weights over the
 * team's active features. Higher = relatively stronger against the metagame.
 * The intercept is intentionally omitted — it is a constant shared by every
 * option a user compares, so it never changes a ranking.
 */
const teamScoreCaches = new WeakMap<PairedModel, Map<string, number>>();
const TEAM_SCORE_CACHE_CAP = 50_000;

const assignedTeamKey = (team: AssignedHero[]): string =>
  team
    .map(({ name, skills }) => `${name}:${uniq((skills || []).filter(Boolean)).sort().join(',')}`)
    .sort()
    .join(';');

export function scoreTeam(team: AssignedHero[], model: PairedModel): number {
  let cache = teamScoreCaches.get(model);
  if (!cache) {
    cache = new Map<string, number>();
    teamScoreCaches.set(model, cache);
  }
  const key = assignedTeamKey(team);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let score = 0;
  for (const [fid, value] of teamFeatureValues(team, model.mechanics)) {
    score += weightOf(model, fid) * value;
  }
  if (cache.size >= TEAM_SCORE_CACHE_CAP) cache.clear();
  cache.set(key, score);
  return score;
}

/**
 * Score heroes with their catalog signature mechanics but no assigned
 * non-default skills. Used for roster-strength deltas before draft skills are
 * assigned.
 */
export function scoreHeroes(heroes: string[], model: PairedModel): number {
  return scoreTeam(heroes.map((name) => ({ name, skills: [] })), model);
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
  /** Number of distinct fitted (non-neutral) features that contributed. */
  featureCount: number;
  /** Sum of support counts across contributing features. */
  totalSupport: number;
  /** Minimum support among contributing features (weakest evidence link). */
  minSupport: number;
}

/** A single fitted feature that fired for a team, with its family + evidence. */
export interface ActiveContribution {
  /** Feature id (e.g. `HP|a|b`). */
  featureId: string;
  /** Feature family (H/S/HP/HS/SP). */
  family: string;
  /** Realized contribution (fitted coefficient × current feature value). */
  weight: number;
  /** Fitted model coefficient before applying the current numeric value. */
  coefficient: number;
  /** Current team feature value (binary families use 1). */
  value: number;
  /** Support/evidence: battles this feature was observed in. */
  support: number;
}

/**
 * All fitted (non-neutral) features that fire for a fully-assigned team, with
 * their weight + support. This is the canonical source of per-team "why" — the
 * engine's positive evidence display filters and groups these rather than
 * re-deriving feature ids inline. Ordered by descending weight, then feature id
 * for determinism.
 */
export function activeTeamContributions(
  team: AssignedHero[],
  model: PairedModel
): ActiveContribution[] {
  const out: ActiveContribution[] = [];
  for (const [fid, value] of teamFeatureValues(team, model.mechanics)) {
    const coefficient = model.weights[fid];
    if (coefficient === undefined || coefficient === 0) continue;
    out.push({
      featureId: fid,
      family: fid.split('|')[0],
      weight: coefficient * value,
      coefficient,
      value,
      support: supportOf(model, fid),
    });
  }
  out.sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.featureId.localeCompare(b.featureId)));
  return out;
}

export function evidenceFor(team: AssignedHero[], model: PairedModel): EvidenceSummary {
  let featureCount = 0;
  let totalSupport = 0;
  let minSupport = Infinity;
  for (const fid of teamFeatureValues(team, model.mechanics).keys()) {
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
