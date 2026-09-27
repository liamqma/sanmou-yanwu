/**
 * Client-side recommendation engine (opponent-aware paired model).
 *
 * Loads nothing itself — callers pass the generated artifact
 * (`recommendation_data.json`, see `data/build_recommendation_data.py`) plus the
 * catalog. All scoring is pure and local: a team's *relative roster strength* is
 * `w · features(team)` under the final artifact model. Atomic H/S weights include
 * the established count prior; HP/HS also include a positive-only co-selection
 * lift. All other interaction weights remain outcome-only.
 *
 * The user never enters an opponent. Scores are relative strengths against the
 * learned metagame, NOT opponent-specific win probabilities. Offered-set
 * recommendations rank options by the *marginal* roster-strength improvement
 * they add to the current pool, together with the evidence behind that gain.
 */
import type {
  RecommendationData,
  PairedModel,
  RecommendationCatalog,
  BondRelationship,
} from '../types/recommendation';
import type { GameplayDatabase } from '../types/domain';
import {
  labelAnalyticsRelationship,
  labelFeature,
} from './featureLabels';
import {
  type AssignedHero,
  F_BOND,
  scoreHeroes,
  weightOf,
  supportOf,
  teamFeatureIds,
  heroId,
  skillId,
  heroPairId,
  heroSkillId,
  skillPairId,
} from './recommendationModel';

// --------------------------------------------------------------------------- #
// Shared result types
// --------------------------------------------------------------------------- #

export interface Contribution {
  /** Canonical model feature id, e.g. `HP|祝融|貂蝉`. */
  featureId: string;
  /** Human-readable label, e.g. a hero pair "祝融 + 貂蝉" or a hero-skill pair. */
  label: string;
  /** Canonical feature-family prefix. */
  family: string;
  /** Final model weight (roster-strength contribution). */
  weight: number;
  /** Support/evidence: battles this feature was observed in. */
  support: number;
}

export interface EvaluatedFeature extends Contribution {
  /** Player-facing points (`weight * 10`, rounded to one decimal). */
  displayPoints: number;
}

export interface SkillRouteCandidateDebug extends EvaluatedFeature {
  hero: string;
  currentPoolIndex: number;
  rank: number;
  selected: boolean;
  tiedForBestWeight: boolean;
}

export interface SkillRouteDebug {
  skill: string;
  standalone: EvaluatedFeature;
  chosenHero: string | null;
  chosenRoute: EvaluatedFeature | null;
  rankingOrder: string[];
  selectionReason: string;
  tiedBestHeroes: string[];
  alternatives: SkillRouteCandidateDebug[];
  rawTotal: number;
  displayTotal: number;
}

export interface OptionDecisionDebug {
  /** Unrounded raw score before the player-facing ×10 conversion. */
  rawScore: number;
  /** Every newly activated feature, including neutral/missing-weight rows. */
  evaluatedFeatures: EvaluatedFeature[];
  /** Present for skill rounds to show the exact best-hero routing decision. */
  skillRoutes?: SkillRouteDebug[];
}

export interface OptionAnalysis {
  set_index: number;
  items: string[];
  /** Marginal roster-strength gain this option adds to the current pool. */
  final_score: number;
  rank: number;
  /** Per-item marginal contribution (same units as final_score). */
  item_scores: { item: string; score: number; support: number }[];
  /** Strongest positive synergies this option unlocks with the current pool. */
  synergies: Contribution[];
  /**
   * Strongest positive *combo* synergies only (pair/hero-skill families:
   * HP/HS/SP), computed from the full contribution list before truncation so
   * dominant single-item H/S weights can never crowd real combos out.
   */
  combo_synergies: Contribution[];
  /** Strongest negative combo contributions, kept separate from atomic tradeoffs. */
  combo_tradeoffs: Contribution[];
  /** Notable negative contributions (tradeoffs) this option brings. */
  tradeoffs: Contribution[];
  /** Aggregate evidence for newly activated marginal features only. */
  evidence: { featureCount: number; totalSupport: number; minSupport: number };
  /** Console-debug trace; not rendered in the player-facing recommendation UI. */
  debug: OptionDecisionDebug;
}

export interface SetRecommendation {
  recommended_set: number;
  analysis: OptionAnalysis[];
}

// --------------------------------------------------------------------------- #
// Helpers
// --------------------------------------------------------------------------- #

/** Convenience accessor for the paired model inside the artifact. */
const model = (data: RecommendationData): PairedModel => data.model;

/**
 * Marginal roster-strength gain of `combinedTeam` over `baseTeam`, plus the
 * feature contributions that changed. Because the score is additive over
 * features, the delta is exactly the sum of weights on features present in the
 * combined roster but not the base.
 */
function marginalContributions(
  baseTeam: AssignedHero[],
  combinedTeam: AssignedHero[],
  m: PairedModel
): {
  delta: number;
  contributions: Contribution[];
  evaluatedFeatures: EvaluatedFeature[];
} {
  const baseFeatures = teamFeatureIds(baseTeam, undefined, false);
  const combined = teamFeatureIds(combinedTeam, undefined, false);
  const contributions: Contribution[] = [];
  const evaluatedFeatures: EvaluatedFeature[] = [];
  let delta = 0;
  for (const fid of combined) {
    if (baseFeatures.has(fid)) continue;
    const w = weightOf(m, fid);
    const { label, family } = labelFeature(fid);
    const evaluated = {
      featureId: fid,
      label,
      family,
      weight: w,
      support: supportOf(m, fid),
      displayPoints: displayScore(w),
    };
    evaluatedFeatures.push(evaluated);
    if (w === 0) continue;
    delta += w;
    contributions.push(evaluated);
  }
  contributions.sort((a, b) => b.weight - a.weight);
  evaluatedFeatures.sort((a, b) =>
    b.weight !== a.weight
      ? b.weight - a.weight
      : a.featureId.localeCompare(b.featureId)
  );
  return { delta, contributions, evaluatedFeatures };
}

const roundTo = (x: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** Scale a raw roster-strength delta to a friendlier 0-ish..N display number. */
const displayScore = (x: number): number => roundTo(x * 10, 1);

const evaluatedFeature = (
  m: PairedModel,
  featureId: string
): EvaluatedFeature => {
  const { label, family } = labelFeature(featureId);
  const weight = weightOf(m, featureId);
  return {
    featureId,
    label,
    family,
    weight,
    support: supportOf(m, featureId),
    displayPoints: displayScore(weight),
  };
};

/**
 * Top positive *combo* contributions (pair/hero-skill families) from the full,
 * already-weight-sorted contribution list. Single-item hero (`H`) and skill
 * (`S`) contributions are excluded here so they cannot displace real combos when
 * they dominate the overall top ranks. Applied before slicing.
 */
const topComboSynergies = (contributions: Contribution[]): Contribution[] =>
  contributions.filter((c) => c.weight > 0 && c.family !== 'H' && c.family !== 'S').slice(0, 5);

/** Most negative combo contributions, ordered by absolute impact. */
const topComboTradeoffs = (contributions: Contribution[]): Contribution[] =>
  contributions
    .filter((c) => c.weight < 0 && c.family !== 'H' && c.family !== 'S')
    .sort((a, b) => a.weight - b.weight)
    .slice(0, 5);

/** Evidence behind the marginal score only; pre-existing pool features do not count. */
const marginalEvidence = (
  contributions: Contribution[]
): OptionAnalysis['evidence'] => ({
  featureCount: contributions.length,
  totalSupport: contributions.reduce((sum, item) => sum + item.support, 0),
  minSupport:
    contributions.length === 0
      ? 0
      : Math.min(...contributions.map((item) => item.support)),
});

/**
 * Route a non-default skill to the current hero that maximises its
 * hero-skill weight. Returns
 * the best AssignedHero-style contribution for scoring a not-yet-assigned skill.
 */
function bestHeroForSkill(
  skill: string,
  heroes: string[],
  m: PairedModel
): {
  hero: string | null;
  weight: number;
  rankingOrder: string[];
  selectionReason: string;
  tiedBestHeroes: string[];
  routes: SkillRouteCandidateDebug[];
} {
  const ranked = heroes
    .map((hero, currentPoolIndex) => ({
      hero,
      currentPoolIndex,
      route: evaluatedFeature(m, heroSkillId(hero, skill)),
    }))
    .sort((left, right) =>
      right.route.weight !== left.route.weight
        ? right.route.weight - left.route.weight
        : left.currentPoolIndex - right.currentPoolIndex
    );
  const chosen = ranked[0] ?? null;
  const tiedBestHeroes = chosen
    ? ranked
        .filter(({ route }) => route.weight === chosen.route.weight)
        .map(({ hero }) => hero)
    : [];
  return {
    hero: chosen?.hero ?? null,
    weight: chosen?.route.weight ?? 0,
    rankingOrder: [
      'higher hero-skill HS weight',
      'earlier hero in current-pool order when HS weights tie',
    ],
    selectionReason:
      tiedBestHeroes.length > 1
        ? 'highest HS weight tied; earliest hero in current-pool order won'
        : chosen
          ? 'highest HS weight'
          : 'no current hero was available',
    tiedBestHeroes,
    routes: ranked.map(({ hero, currentPoolIndex, route }, index) => ({
      ...route,
      hero,
      currentPoolIndex,
      rank: index + 1,
      selected: index === 0,
      tiedForBestWeight: chosen !== null && route.weight === chosen.route.weight,
    })),
  };
}

/**
 * Roster-strength score (display units) for the *current* pool. This is the same
 * additive, opponent-free number that each option's marginal gain is measured
 * in, so the pool score and the option gains share one scale.
 *
 * It combines:
 *  - hero-pool strength (hero presence + hero-pair features), and
 *  - an understandable approximation for already-owned but not-yet-assigned
 *    skills: each skill's standalone `S` weight plus its best routing onto a
 *    current hero (`HS`).
 */
function currentRosterScoreRaw(
  currentHeroes: string[],
  currentSkills: string[],
  m: PairedModel
): number {
  let raw = scoreHeroes(currentHeroes, m);
  for (const skill of currentSkills) {
    if (!skill) continue;
    raw += weightOf(m, skillId(skill));
    const { weight } = bestHeroForSkill(skill, currentHeroes, m);
    raw += weight;
  }
  return displayScore(raw);
}

/**
 * Public helper: the current roster's display score for the given heroes and
 * already-owned skills. Pure and opponent-free — safe to call before any
 * recommendation is requested (e.g. from the CURRENT ROSTER header).
 */
export function currentRosterScore(
  currentHeroes: string[],
  currentSkills: string[],
  data: RecommendationData
): number {
  return currentRosterScoreRaw(currentHeroes, currentSkills, model(data));
}

// --------------------------------------------------------------------------- #
// Offered-set recommendations (hero rounds)
// --------------------------------------------------------------------------- #

/**
 * Recommend one of three offered hero sets by marginal roster-strength gain.
 *
 * The current pool (already-chosen heroes) is the base team; each option's score
 * is how much relative strength it adds — its own hero features plus the new
 * hero↔pool pair synergies it unlocks. We do NOT assume any future offers.
 */
export function recommendHeroSet(
  availableSets: string[][],
  currentHeroes: string[],
  data: RecommendationData,
  _currentSkills: string[] = []
): SetRecommendation {
  const m = model(data);
  const baseTeam: AssignedHero[] = currentHeroes.map((name) => ({ name, skills: [] }));

  const analysis: OptionAnalysis[] = availableSets.map((heroes, setIndex) => {
    const combined: AssignedHero[] = [
      ...baseTeam,
      ...heroes.map((name) => ({ name, skills: [] as string[] })),
    ];
    const { delta, contributions, evaluatedFeatures } =
      marginalContributions(baseTeam, combined, m);

    // Per-hero marginal contribution (each hero added on top of base+others).
    const item_scores = heroes.map((hero) => {
      const w =
        weightOf(m, heroId(hero)) +
        currentHeroes.reduce((acc, other) => {
          return acc + weightOf(m, heroPairId(hero, other));
        }, 0);
      return {
        item: hero,
        score: displayScore(w),
        support: supportOf(m, heroId(hero)),
      };
    });

    const ev = marginalEvidence(contributions);
    return {
      set_index: setIndex,
      items: heroes,
      final_score: displayScore(delta),
      rank: 0,
      item_scores,
      synergies: contributions.filter((c) => c.weight > 0).slice(0, 5),
      combo_synergies: topComboSynergies(contributions),
      combo_tradeoffs: topComboTradeoffs(contributions),
      tradeoffs: contributions.filter((c) => c.weight < 0).slice(0, 3),
      evidence: ev,
      debug: {
        rawScore: delta,
        evaluatedFeatures,
      },
    };
  });

  return finaliseSetRecommendation(analysis);
}

// --------------------------------------------------------------------------- #
// Offered-set recommendations (skill rounds)
// --------------------------------------------------------------------------- #

/**
 * Recommend one of three offered skill sets by marginal roster-strength gain.
 *
 * Skills are not yet bound to a hero, so each candidate skill is routed to the
 * current hero that maximises its hero-skill weight (mirroring the eventual
 * assignment). The option score is the sum of those best-routed contributions
 * plus the standalone skill weight.
 */
export function recommendSkillSet(
  availableSets: string[][],
  currentHeroes: string[],
  _currentSkills: string[],
  data: RecommendationData
): SetRecommendation {
  const m = model(data);

  const analysis: OptionAnalysis[] = availableSets.map((skills, setIndex) => {
    let delta = 0;
    const contributions: Contribution[] = [];
    const evaluatedFeatures: EvaluatedFeature[] = [];
    const skillRoutes: SkillRouteDebug[] = [];
    const item_scores = skills.map((skill) => {
      const standaloneFeature = evaluatedFeature(m, skillId(skill));
      const routeDecision = bestHeroForSkill(skill, currentHeroes, m);
      const { hero, weight } = routeDecision;
      const chosenRoute = routeDecision.routes[0] ?? null;
      const total = standaloneFeature.weight + weight;
      delta += total;
      evaluatedFeatures.push(standaloneFeature);
      if (chosenRoute) evaluatedFeatures.push(chosenRoute);
      if (standaloneFeature.weight !== 0) contributions.push(standaloneFeature);
      if (chosenRoute && chosenRoute.weight !== 0)
        contributions.push(chosenRoute);
      skillRoutes.push({
        skill,
        standalone: standaloneFeature,
        chosenHero: hero,
        chosenRoute,
        rankingOrder: routeDecision.rankingOrder,
        selectionReason: routeDecision.selectionReason,
        tiedBestHeroes: routeDecision.tiedBestHeroes,
        alternatives: routeDecision.routes,
        rawTotal: total,
        displayTotal: displayScore(total),
      });
      return {
        item: skill,
        score: displayScore(total),
        support: standaloneFeature.support,
      };
    });

    contributions.sort((a, b) => b.weight - a.weight);
    evaluatedFeatures.sort((left, right) =>
      right.weight !== left.weight
        ? right.weight - left.weight
        : left.featureId.localeCompare(right.featureId)
    );
    return {
      set_index: setIndex,
      items: skills,
      final_score: displayScore(delta),
      rank: 0,
      item_scores,
      synergies: contributions.filter((c) => c.weight > 0).slice(0, 5),
      combo_synergies: topComboSynergies(contributions),
      combo_tradeoffs: topComboTradeoffs(contributions),
      tradeoffs: contributions.filter((c) => c.weight < 0).slice(0, 3),
      evidence: {
        featureCount: contributions.length,
        totalSupport: contributions.reduce((a, c) => a + c.support, 0),
        minSupport: contributions.length ? Math.min(...contributions.map((c) => c.support)) : 0,
      },
      debug: {
        rawScore: delta,
        evaluatedFeatures,
        skillRoutes,
      },
    };
  });

  return finaliseSetRecommendation(analysis);
}

function finaliseSetRecommendation(analysis: OptionAnalysis[]): SetRecommendation {
  // Deterministic ranking: higher final_score wins; ties broken by evidence then index.
  const ordered = [...analysis].sort((a, b) => {
    if (b.final_score !== a.final_score) return b.final_score - a.final_score;
    if (b.evidence.totalSupport !== a.evidence.totalSupport) {
      return b.evidence.totalSupport - a.evidence.totalSupport;
    }
    return a.set_index - b.set_index;
  });
  ordered.forEach((a, i) => {
    a.rank = i + 1;
  });
  const recommended_set = ordered.length > 0 ? ordered[0].set_index : 0;
  // Return analysis in original set order for stable rendering.
  return { recommended_set, analysis };
}

// --------------------------------------------------------------------------- #
// Support pick (after round 6): one hero + two skills
// --------------------------------------------------------------------------- #

export interface HeroCandidate {
  hero: string;
  finalScore: number;
  details: { individualScore: number; pairScore: number; skillHeroScore: number };
  support: number;
}
export interface SingleHeroRecommendation {
  hero: string | null;
  analysis: HeroCandidate[];
}

/**
 * Recommend one support hero from the unchosen pool by marginal roster strength:
 * the hero's own weight plus its pair synergies with the current heroes.
 * `skillHeroScore` credits the best routing of already-owned skills to the hero.
 */
export function recommendSingleHero(
  unchosenHeroes: string[],
  currentHeroes: string[],
  currentSkills: string[],
  data: RecommendationData,
  catalog: RecommendationCatalog
): SingleHeroRecommendation {
  if (!unchosenHeroes || unchosenHeroes.length === 0) {
    return { hero: null, analysis: [] };
  }
  const m = model(data);

  const candidates: HeroCandidate[] = unchosenHeroes.map((hero) => {
    const individual = weightOf(m, heroId(hero));
    const pair = currentHeroes.reduce((acc, other) => {
      return acc + weightOf(m, heroPairId(hero, other));
    }, 0);
    // Best skills (from current pool) this hero could carry.
    const nonDefault = currentSkills.filter((s) => s !== catalog.default_skill[hero]);
    const skillHero = nonDefault
      .map((s) => weightOf(m, heroSkillId(hero, s)))
      .filter((w) => w > 0)
      .sort((x, y) => y - x)
      .slice(0, 2)
      .reduce((a, b) => a + b, 0);
    return {
      hero,
      finalScore: displayScore(individual + pair + skillHero),
      details: {
        individualScore: displayScore(individual),
        pairScore: displayScore(pair),
        skillHeroScore: displayScore(skillHero),
      },
      support: supportOf(m, heroId(hero)),
    };
  });

  candidates.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (b.support !== a.support) return b.support - a.support;
    return a.hero.localeCompare(b.hero);
  });
  return { hero: candidates[0]?.hero ?? null, analysis: candidates };
}

export interface SkillCandidate {
  skill: string;
  finalScore: number;
  details: { individualScore: number; skillHeroScore: number };
  support: number;
}
/** The best-scoring joint pair, with the roster gain it adds. */
export interface SkillPairChoice {
  skills: [string, string];
  /** Joint roster-strength gain (display units): S + feasible HS routing + SP. */
  pairScore: number;
  /**
   * The synergy bonus that is realised only when both skills land on the *same*
   * hero (the within-hero skill-pair weight). Zero when routed to two heroes.
   */
  sameHeroSynergy: number;
}
export interface TwoSkillsRecommendation {
  skills: string[];
  /** Per-single-skill breakdown (for the details list). */
  analysis: SkillCandidate[];
  /** The jointly-chosen best pair; null when fewer than two skills are offered. */
  pair: SkillPairChoice | null;
}

/**
 * Recommend the skills needed for the currently open support slots. Two open
 * slots are chosen jointly; one open slot uses the same per-skill ranking.
 *
 * For every unordered candidate pair we evaluate the roster gain of adding both:
 *   • each skill's standalone `S|` presence weight, plus
 *   • the best *feasible* hero routing (`HS|`) among the current heroes — either
 *     both skills on the strongest hero, or one on each of the two best heroes,
 *     whichever scores higher, plus
 *   • the within-hero skill-pair weight (`SP|`) **only** when the higher-scoring
 *     routing places both skills on the same hero.
 * The highest-scoring pair wins. This lets a strong same-hero `SP` synergy pull
 * a pair together that a per-skill ranking would have split. Deterministic
 * tie-breaks by joint score, then skill names.
 */
export function recommendTwoSkills(
  unchosenSkills: string[],
  currentHeroes: string[],
  _currentSkills: string[],
  data: RecommendationData,
  selectionCount: 1 | 2 = 2
): TwoSkillsRecommendation {
  const empty: TwoSkillsRecommendation = { skills: [], analysis: [], pair: null };
  if (!unchosenSkills || unchosenSkills.length < selectionCount) return empty;
  const m = model(data);
  const skills = [...new Set(unchosenSkills)];
  if (skills.length < selectionCount) return empty;

  // Per-single-skill breakdown (retained for the details list / single ranking).
  const candidates: SkillCandidate[] = skills.map((skill) => {
    const individual = weightOf(m, skillId(skill));
    const { weight: skillHero } = bestHeroForSkill(skill, currentHeroes, m);
    return {
      skill,
      finalScore: displayScore(individual + Math.max(0, skillHero)),
      details: {
        individualScore: displayScore(individual),
        skillHeroScore: displayScore(Math.max(0, skillHero)),
      },
      support: supportOf(m, skillId(skill)),
    };
  });
  candidates.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (b.support !== a.support) return b.support - a.support;
    return a.skill.localeCompare(b.skill);
  });

  if (selectionCount === 1) {
    return {
      skills: candidates[0] ? [candidates[0].skill] : [],
      analysis: candidates,
      pair: null,
    };
  }

  // Per-hero HS weight for a skill (0 when no positive routing exists).
  const hsWeight = (hero: string, skill: string): number =>
    weightOf(m, heroSkillId(hero, skill));
  const spWeight = (hero: string, a: string, b: string): number =>
    weightOf(m, skillPairId(hero, a, b));

  // Joint routing gain for a pair (s1, s2): the max over
  //   (a) both on one hero h:  HS(h,s1)+HS(h,s2)+SP(h,s1,s2), and
  //   (b) one on hero h1, the other on hero h2 (h1≠h2): HS(h1,·)+HS(h2,·).
  const routingGain = (
    s1: string,
    s2: string
  ): { gain: number; sameHeroSynergy: number } => {
    let best = 0; // routing is optional; never worse than 0
    let bestSameHeroSynergy = 0;
    // (a) both on the same hero.
    for (const h of currentHeroes) {
      const g = hsWeight(h, s1) + hsWeight(h, s2) + spWeight(h, s1, s2);
      if (g > best) {
        best = g;
        bestSameHeroSynergy = spWeight(h, s1, s2);
      }
    }
    // (b) split across two distinct heroes.
    for (let i = 0; i < currentHeroes.length; i++) {
      for (let j = 0; j < currentHeroes.length; j++) {
        if (i === j) continue;
        const g = hsWeight(currentHeroes[i], s1) + hsWeight(currentHeroes[j], s2);
        if (g > best) {
          best = g;
          bestSameHeroSynergy = 0;
        }
      }
    }
    return { gain: best, sameHeroSynergy: bestSameHeroSynergy };
  };

  let bestPair: SkillPairChoice | null = null;
  let bestRaw = -Infinity;
  const sorted = [...skills].sort();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const s1 = sorted[i];
      const s2 = sorted[j];
      const presence = weightOf(m, skillId(s1)) + weightOf(m, skillId(s2));
      const { gain, sameHeroSynergy } = routingGain(s1, s2);
      const raw = presence + gain;
      const key = `${s1}|${s2}`;
      if (
        bestPair === null ||
        raw > bestRaw + 1e-9 ||
        (Math.abs(raw - bestRaw) <= 1e-9 && key < `${bestPair.skills[0]}|${bestPair.skills[1]}`)
      ) {
        bestRaw = raw;
        bestPair = {
          skills: [s1, s2],
          pairScore: displayScore(raw),
          sameHeroSynergy: displayScore(sameHeroSynergy),
        };
      }
    }
  }

  return {
    skills: bestPair ? [...bestPair.skills] : [],
    analysis: candidates,
    pair: bestPair,
  };
}

/** Optional per-hero camp metadata sourced from database.json. */
export type HeroMeta = Record<string, { camp?: string }>;

// --------------------------------------------------------------------------- #
// Analytics (for the Analytics page)
// --------------------------------------------------------------------------- #

export interface AnalyticsEntity {
  name: string;
  wins: number;
  losses: number;
  total: number;
  /** Raw win rate (0..1). */
  winRate: number;
  /** Smoothed win rate toward the global prior (0..1). */
  smoothedWinRate: number;
  /** Final relative roster-strength weight (0 when absent from the artifact). */
  strength: number;
  /** Observations explicitly marked as an 影战法 by source provenance. */
  shadowTotal: number;
}

export const ANALYTICS_RELATIONSHIP_FAMILIES = [
  'HP',
  'HT',
  'HS',
  'THS',
  'B',
  'M',
] as const;

export type AnalyticsRelationshipFamily =
  (typeof ANALYTICS_RELATIONSHIP_FAMILIES)[number];

export interface AnalyticsRelationshipRanking {
  /** Rank in the complete, unfiltered family list. */
  rank: number;
  /** Canonical id retained as a stable React/data key; never rendered to players. */
  featureId: string;
  family: AnalyticsRelationshipFamily;
  /** Catalog-aware, explicit relationship wording. */
  label: string;
  /** Exact fitted model coefficient. */
  weight: number;
  support: number;
  heroes: string[];
  skills: string[];
  bond?: BondRelationship;
  mechanic?: {
    name: string;
    consumerRelation: string;
    consumerRelationLabel: string;
    side: 'friendly' | 'enemy';
    sideLabel: string;
  };
}

export type AnalyticsRelationshipRankings = Record<
  AnalyticsRelationshipFamily,
  AnalyticsRelationshipRanking[]
>;

export interface AnalyticsResult {
  summary: {
    total_battles: number;
    total_heroes: number;
    total_skills: number;
    team1_wins: number;
    team2_wins: number;
    prior_win_rate: number;
    /** Deterministic content hash of the training corpus (no build timestamp). */
    corpus_version: string;
  };
  model_quality: {
    accuracy: number | null;
    log_loss: number | null;
    brier: number | null;
    baseline_accuracy: number | null;
    n_test: number;
    n_features: number;
  };
  heroes: AnalyticsEntity[];
  skills: AnalyticsEntity[];
  hero_usage: [string, number][];
  skill_usage: [string, number][];
  /** Player-facing relationship families enabled by the fitted model. */
  enabledRelationshipFamilies: AnalyticsRelationshipFamily[];
  /** Complete independent rankings for every player-facing relationship family. */
  relationshipRankings: AnalyticsRelationshipRankings;
}

/**
 * Build the Analytics-page payload from the generated artifact. The `heroes` and
 * `skills` rankings are returned sorted by descending relative roster-strength
 * (`模型权重`), with deterministic tie-breakers (descending reference battles,
 * then name) so consumers can render them directly. The model column still exposes
 * each item's full-precision relative roster-strength
 * weight, and the smoothed-win-rate / reference-battle columns remain available.
 * Usage and relationship rankings keep their own orderings. Each enabled
 * player-facing relationship family exposes every fitted weight, sorted by
 * weight descending and then canonical feature id. The UI applies filters
 * before progressively disclosing those immutable full-family ranks. Backtest
 * metrics surface model quality.
 */
export function getAnalytics(
  data: RecommendationData,
  database: GameplayDatabase
): AnalyticsResult {
  const m = model(data);
  const a = data.analytics;

  const toEntity = (row: {
    name: string;
    wins: number;
    losses: number;
    total: number;
    win_rate: number;
    smoothed_win_rate: number;
    shadow_total?: number;
  }, family: 'H' | 'S'): AnalyticsEntity => ({
    name: row.name,
    wins: row.wins,
    losses: row.losses,
    total: row.total,
    winRate: row.win_rate,
    smoothedWinRate: row.smoothed_win_rate,
    strength: weightOf(m, `${family}|${row.name}`),
    shadowTotal: row.shadow_total ?? 0,
  });

  // Rank both lists by 模型权重 (relative roster strength) descending, with
  // deterministic tie-breakers so equal-strength rows are stably ordered.
  const byStrength = (x: AnalyticsEntity, y: AnalyticsEntity): number =>
    y.strength - x.strength ||
    y.total - x.total ||
    x.name.localeCompare(y.name, 'zh-Hans-CN');

  const heroes = a.heroes.map((r) => toEntity(r, 'H')).sort(byStrength);
  const skills = a.skills.map((r) => toEntity(r, 'S')).sort(byStrength);

  const hero_usage: [string, number][] = [...a.heroes]
    .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name))
    .map((r) => [r.name, r.total]);
  const skill_usage: [string, number][] = [...a.skills]
    .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name))
    .map((r) => [r.name, r.total]);

  const bondByName = new Map(
    data.catalog.relationships.bonds.map((bond) => [bond.name, bond])
  );
  const collectRelationshipFamily = (
    family: AnalyticsRelationshipFamily
  ): AnalyticsRelationshipRanking[] => {
    if (!m.enabled_families.includes(family)) return [];
    return (Object.entries(m.weights) as [string, number][])
      .filter(([featureId]) => featureId.startsWith(`${family}|`))
      .sort(([leftId, leftWeight], [rightId, rightWeight]) =>
        rightWeight !== leftWeight
          ? rightWeight - leftWeight
          : leftId < rightId
            ? -1
            : leftId > rightId
              ? 1
              : 0
      )
      .map(([featureId, weight], index) => {
        const display = labelAnalyticsRelationship(featureId, data.catalog);
        const bondName = family === F_BOND ? featureId.split('|')[1] : null;
        const bond = bondName ? bondByName.get(bondName) : undefined;
        if (family === F_BOND && !bond) {
          throw new Error(`Missing catalog bond for Analytics feature: ${bondName}`);
        }
        return {
          rank: index + 1,
          featureId,
          family,
          label: display.label,
          weight,
          support: supportOf(m, featureId),
          heroes: bond ? [...bond.members] : display.heroes,
          skills: display.skills,
          ...(bond
            ? {
                bond: {
                  ...bond,
                  members: [...bond.members],
                },
              }
            : {}),
          ...(display.mechanic ? { mechanic: display.mechanic } : {}),
        };
      });
  };

  const relationshipRankings = Object.fromEntries(
    ANALYTICS_RELATIONSHIP_FAMILIES.map((family) => [
      family,
      collectRelationshipFamily(family),
    ])
  ) as AnalyticsRelationshipRankings;
  const enabledRelationshipFamilies = ANALYTICS_RELATIONSHIP_FAMILIES.filter(
    (family) => m.enabled_families.includes(family)
  );

  return {
    summary: {
      total_battles: data.battle_counts.total_battles,
      total_heroes: Object.keys(database.heroes || {}).length,
      total_skills: Object.keys(database.skills || {}).length,
      team1_wins: data.battle_counts.team1_wins,
      team2_wins: data.battle_counts.team2_wins,
      prior_win_rate: a.prior_win_rate,
      corpus_version: data.battle_counts.corpus_version,
    },
    model_quality: {
      accuracy: data.backtest.accuracy,
      log_loss: data.backtest.log_loss,
      brier: data.backtest.brier,
      baseline_accuracy: data.backtest.baseline_accuracy ?? null,
      n_test: data.backtest.n_test,
      n_features: m.n_features,
    },
    heroes,
    skills,
    hero_usage,
    skill_usage,
    enabledRelationshipFamilies,
    relationshipRankings,
  };
}
