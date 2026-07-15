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
const sortPair = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/**
 * Build the binary feature-id set for a team (presence-encoded, matching the
 * Python builder). Returns a Set of feature ids.
 */
export function teamFeatureIds(team: AssignedHero[]): Set<string> {
  const feats = new Set<string>();
  const heroes = team.map((h) => h.name).filter(Boolean);

  for (const hero of heroes) feats.add(`${F_HERO}|${hero}`);

  const uniqHeroes = uniq(heroes).sort();
  for (let i = 0; i < uniqHeroes.length; i++) {
    for (let j = i + 1; j < uniqHeroes.length; j++) {
      const [a, b] = sortPair(uniqHeroes[i], uniqHeroes[j]);
      feats.add(`${F_HERO_PAIR}|${a}|${b}`);
    }
  }

  for (const { name: hero, skills } of team) {
    if (!hero) continue;
    const s = uniq((skills || []).filter(Boolean));
    for (const skill of s) {
      feats.add(`${F_SKILL}|${skill}`);
      feats.add(`${F_HERO_SKILL}|${hero}|${skill}`);
    }
    const sorted = [...s].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [a, b] = sortPair(sorted[i], sorted[j]);
        feats.add(`${F_SKILL_PAIR}|${hero}|${a}|${b}`);
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
