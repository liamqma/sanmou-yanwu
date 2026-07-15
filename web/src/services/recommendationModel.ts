/**
 * Pure paired-model primitives shared by the recommendation engine.
 *
 * Feature extraction here MUST stay in lockstep with
 * `data/build_recommendation_data.py` (`team_features`) — the client scores
 * rosters against weights fitted on exactly these feature ids. See README.md
 * "Recommendation pipeline".
 *
 * A team is described by its heroes and, per hero, an *assigned* list of
 * non-default skills. The model scores `w · features(team)`, a relative
 * roster-strength number against the learned metagame. It is NOT an
 * opponent-specific win probability.
 */
import type { PairedModel, RecommendationCatalog } from '../types/recommendation';

export const F_HERO = 'H';
export const F_SKILL = 'S';
export const F_HERO_PAIR = 'HP';
export const F_HERO_SKILL = 'HS';
export const F_SKILL_PAIR = 'SP';

/** A hero with the specific non-default skills assigned to it on a team. */
export interface AssignedHero {
  name: string;
  /** Non-default skills assigned to this hero (defaults excluded upstream). */
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

/**
 * Build the binary feature-id set for a team (presence-encoded, matching the
 * Python builder). Returns a Set of feature ids.
 */
export function teamFeatureIds(team: AssignedHero[]): Set<string> {
  const feats = new Set<string>();
  const heroes = team.map((h) => h.name).filter(Boolean);

  for (const hero of heroes) feats.add(heroId(hero));

  const uniqHeroes = uniq(heroes).sort();
  for (let i = 0; i < uniqHeroes.length; i++) {
    for (let j = i + 1; j < uniqHeroes.length; j++) {
      feats.add(heroPairId(uniqHeroes[i], uniqHeroes[j]));
    }
  }

  for (const { name: hero, skills } of team) {
    if (!hero) continue;
    const s = uniq((skills || []).filter(Boolean));
    for (const skill of s) {
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
 * Relative roster-strength score for a team: the sum of fitted weights over the
 * team's active features. Higher = relatively stronger against the metagame.
 * The intercept is intentionally omitted — it is a constant shared by every
 * option a user compares, so it never changes a ranking.
 */
export function scoreTeam(team: AssignedHero[], model: PairedModel): number {
  let score = 0;
  for (const fid of teamFeatureIds(team)) score += weightOf(model, fid);
  return score;
}

/**
 * Score just the hero-level features (hero presence + hero pairs) of a set of
 * heroes, ignoring skills. Used for roster-strength deltas in hero rounds where
 * skills are not yet assigned.
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

export function evidenceFor(team: AssignedHero[], model: PairedModel): EvidenceSummary {
  let featureCount = 0;
  let totalSupport = 0;
  let minSupport = Infinity;
  for (const fid of teamFeatureIds(team)) {
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
