/**
 * Client-side recommendation engine (opponent-aware paired model).
 *
 * Loads nothing itself — callers pass the generated artifact
 * (`recommendation_data.json`, see `data/build_recommendation_data.py`) plus the
 * catalog. All scoring is pure and local: a team's *relative roster strength* is
 * `w · features(team)` under the final artifact model. Atomic hero/skill weights
 * include the selection-count prior; interaction weights remain outcome-only.
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
} from '../types/recommendation';
import type {
  GameplayDatabase,
  TeamComp,
  TeamRanking,
  TeamSource,
} from '../types/domain';
import {
  type AssignedHero,
  type ActiveContribution,
  F_HERO,
  F_SKILL,
  F_HERO_PAIR,
  F_HERO_SKILL,
  F_SKILL_PAIR,
  F_TEAM_HERO_SKILL,
  F_TEAM_SKILL_PAIR,
  F_HERO_TRIO,
  F_CAMP,
  F_BOND,
  F_MECH,
  F_HERO_MECH,
  F_TEAM_SKILL_TRIPLE,
  scoreTeam,
  scoreHeroes,
  weightOf,
  supportOf,
  activeTeamContributions,
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
  /** Feature family (H/S/HP/HS/SP). */
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

// Qualitative factors the single additive paired score blends — shown in the
// details panel instead of hand-tuned numeric weights.
export const HERO_RECOMMEND_FACTORS = [
  '武将个体强度',
  '与已选武将的配合',
  '与已选战法的配合',
] as const;

export const SKILL_RECOMMEND_FACTORS = [
  '战法个体强度',
  '与已选武将/战法的配合',
] as const;

// --------------------------------------------------------------------------- #
// Helpers
// --------------------------------------------------------------------------- #

/** Convenience accessor for the paired model inside the artifact. */
const model = (data: RecommendationData): PairedModel => data.model;

/** Label a feature id for display (drops the family prefix, joins names). */
export function labelFeature(featureId: string): { label: string; family: string } {
  const parts = featureId.split('|');
  const family = parts[0];
  const names = parts.slice(1);
  if (family === F_HERO_SKILL || family === F_TEAM_HERO_SKILL) {
    return { label: `${names[0]} · ${names[1]}`, family };
  }
  if (family === F_CAMP) return { label: `${names[0]}人同阵营`, family };
  if (family === F_BOND) return { label: `缘分 · ${names[0]}`, family };
  if (family === F_MECH) return { label: `${names[0]}状态配合`, family };
  if (family === F_HERO_MECH) return { label: `${names[0]} · ${names[1]}状态配合`, family };
  return { label: names.join(' + '), family };
}

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
  const baseFeatures = teamFeatureIds(baseTeam);
  const combined = teamFeatureIds(combinedTeam);
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
 * hero-skill weight (this is how the final formation will assign it). Returns
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
 *    current hero (`HS`), mirroring how the final formation will bind it.
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
 * Recommend two support skills from the unchosen pool by choosing the *pair*
 * jointly — not two independent top-1 picks.
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
  data: RecommendationData
): TwoSkillsRecommendation {
  const empty: TwoSkillsRecommendation = { skills: [], analysis: [], pair: null };
  if (!unchosenSkills || unchosenSkills.length < 2) return empty;
  const m = model(data);
  const skills = [...new Set(unchosenSkills)];
  if (skills.length < 2) return empty;

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

// --------------------------------------------------------------------------- #
// Final formation: 3 disjoint teams + unique 18-skill assignment
// --------------------------------------------------------------------------- #

export interface ProjectedHero {
  name: string;
  skills: string[];
  /** Sum of hero-skill weights for the assigned skills. */
  skillScore: number;
  /** Canonical 0-based hero slot when a partial guide build preserves gaps. */
  slotIndex?: number;
  /** Exact two-slot placement; `skills` remains the dense scoring view. */
  skillSlots?: [string | null, string | null];
}
/** One positive paired-model evidence row shown under a team. */
export interface EvidenceItem {
  /** Human-readable label for the feature (names only, family prefix dropped). */
  label: string;
  /** Positive display-unit contribution (加分). */
  gain: number;
  /** Support/evidence: battles this feature was observed in (参考 K 场). */
  support: number;
}

/**
 * Positive active evidence for a team, grouped by plain-worded family. Only
 * positive contributions are surfaced (no win probabilities, no deductions).
 */
export interface TeamEvidence {
  /** 武将配合 — hero-pair (HP) contributions. */
  heroSynergy: EvidenceItem[];
  /** 武将与战法 — hero-skill (HS) contributions. */
  heroSkill: EvidenceItem[];
  /** 战法搭配 — within-hero skill-pair (SP) contributions. */
  skillSynergy: EvidenceItem[];
}

export interface ProjectedTeam {
  heroes: ProjectedHero[];
  /** Relative roster strength of the currently assigned team. */
  strength: number;
  /** Compact positive paired-model evidence for this team. */
  evidence: TeamEvidence;
  /** Canonical guide formation when this team matched `database.team`. */
  formation?: string;
  /** Guide provenance and partial/exact skill-slot coverage. */
  knownTeam?: KnownTeamMatch;
}

export interface KnownTeamMatch {
  id: string;
  ranking: TeamRanking;
  sources: TeamSource[];
  matchedHeroSlots: number;
  totalHeroSlots: 3;
  matchedSkillSlots: number;
  totalSkillSlots: 6;
}

/**
 * One formation option with up to three disjoint 3-hero teams.
 * Each team carries its own display-unit 评分 and compact positive evidence.
 * No aggregate 总评分 or optimiser internals are surfaced.
 */
export interface FormationOption {
  teams: ProjectedTeam[];
}

export interface FormationGuideMatchCandidateDebug {
  guideId: string;
  matchedHeroes: string[];
  matchedHeroCount: number;
  qualifiedSkillSlotCount: number;
  championship: boolean;
  ranking: TeamRanking;
  rankingScore: number;
  stableId: string;
}

export interface FormationGuideMatchDecisionDebug {
  rankingOrder: string[];
  selected: FormationGuideMatchCandidateDebug;
  rejectedCandidateLimit: number;
  rejected: FormationGuideMatchCandidateDebug[];
  omittedRejectedCount: number;
}

export interface FormationDebugTeam {
  heroes: string[];
  skills: Record<string, [string | null, string | null]>;
  guideId?: string;
  guideMatchDecision?: FormationGuideMatchDecisionDebug;
  prioritizedExactGuide: boolean;
}

export interface FormationSelectionProxyDebug {
  exactGuideCount: number;
  heroGain: number;
  heroesPlaced: number;
  completeTrios: number;
  heroSupport: number;
  canonicalKey: string;
}

export interface FormationBeamPruningDebug {
  depth: number;
  preCapCount: number;
  retainedCount: number;
  nominalCap: number;
  effectiveCap: number;
  proxyRankingOrder: string[];
  nominalCutoff: FormationSelectionProxyDebug | null;
  retainedCutoff: FormationSelectionProxyDebug | null;
  exactGuideReservations: Array<{
    guideId: string;
    canonicalKey: string;
    proxyRank: number;
    outsideNominalCutoff: boolean;
  }>;
  retainedOnlyByReservationCount: number;
}

export interface FormationHeroBeamDepthDebug {
  depth: number;
  generatedContainingSelectionCount: number;
  retainedContainingSelectionCount: number;
  reservedContainingSelectionCount: number;
  entirelyProxyPruned: boolean;
}

export interface FormationHeroSearchReachabilityDebug {
  hero: string;
  qualifiedGroupCount: number;
  reachedFinalEvaluation: boolean;
  depths: FormationHeroBeamDepthDebug[];
}

export interface FormationGuideSkillCandidateDebug {
  skill: string;
  gain: number;
  support: number;
  stableKey: string;
}

export interface FormationGuideSkillSlotDebug {
  slotKey: string;
  hero: string;
  slotIndex: number;
  priority: {
    matchedHeroCount: number;
    qualifiedSkillSlotCount: number;
    championship: boolean;
    rankingScore: number;
    stableKey: string;
  };
  selected: FormationGuideSkillCandidateDebug | null;
  rejectedCandidateLimit: number;
  rejected: FormationGuideSkillCandidateDebug[];
  omittedRejectedCount: number;
}

export interface FormationSkillRouteCandidateDebug {
  hero: string;
  additions: string[];
  gain: number;
  support: number;
  stableKey: string;
  placements: Array<{
    skill: string;
    slotIndex: number;
    preferredGuideSlot: boolean;
  }>;
}

export interface FormationGuideMatchingTrace {
  objective: string;
  slotCount: number;
  uniqueSkillCount: number;
  matchedSlotCount: number;
  eventLimit: number;
  events: Array<
    | {
        type: 'occupied-skill-conflict';
        rootSlotKey: string;
        requestingSlotKey: string;
        skill: string;
        occupyingSlotKey: string;
        resolvedByOwnerMove: boolean;
      }
    | {
        type: 'augmenting-owner-move';
        rootSlotKey: string;
        requestedBySlotKey: string;
        ownerSlotKey: string;
        fromSkill: string;
        toSkill: string;
      }
    | {
        type: 'slot-assigned';
        rootSlotKey: string;
        slotKey: string;
        skill: string;
        reason: 'unoccupied-skill' | 'owner-moved-by-augmenting-path';
      }
  >;
  omittedEventCount: number;
  finalAssignments: Array<{ slotKey: string; skill: string | null }>;
}

export interface FormationSkillRoutingDebug {
  guideMatching: {
    slotRankingOrder: string[];
    alternativeRankingOrder: string[];
    maximumCardinality: FormationGuideMatchingTrace;
    slots: FormationGuideSkillSlotDebug[];
  };
  modelRouting: {
    rankingOrder: string[];
    rejectedCandidateLimit: number;
    steps: Array<{
      step: number;
      candidateCount: number;
      selected: FormationSkillRouteCandidateDebug;
      rejected: FormationSkillRouteCandidateDebug[];
      omittedRejectedCount: number;
    }>;
  };
}

export interface FormationDebugCandidate {
  rank: number;
  exactGuideIds: string[];
  totalModelGain: number;
  rawTotalModelGain: number;
  exactChampionshipTeams: number;
  exactRankingScore: number;
  heroesPlaced: number;
  completeTrios: number;
  heroSupport: number;
  canonicalKey: string;
  teams: FormationDebugTeam[];
  skillRouting: FormationSkillRoutingDebug;
}

export interface FormationDecisionDebug {
  policy: 'evidence-only-team-builder';
  heroPoolCount: number;
  skillPoolCount: number;
  heroPoolCap: number;
  boundedHeroCount: number;
  consideredHeroes: string[];
  excludedHeroes: Array<{
    hero: string;
    sortedPoolRank: number;
    reason: 'excluded_by_alphabetical_hero_pool_cap';
  }>;
  qualifiedHeroPairs: number;
  qualifiedHeroTrios: number;
  candidateSelectionsEvaluated: number;
  prioritizedExactGuideCoreCount: number;
  rankingOrder: string[];
  beamPruning: FormationBeamPruningDebug[];
  heroSelectionReachability: FormationHeroSearchReachabilityDebug[];
  /** Detailed traces for only the winner and immediate runner-up. */
  topCandidates: FormationDebugCandidate[];
}

export interface FormationRecommendation {
  /**
   * Up to three deterministic, distinct feasible formation options, ordered
   * 方案一（推荐） / 方案二 / 方案三. Option one is the recommended winner; options
   * two and three use different canonical hero partitions and are selected for
   * diversity. Fewer than three are returned when fewer distinct feasible
   * candidates exist.
   */
  options: FormationOption[];
  /** True when the pool wasn't large enough to run formation recommendation. */
  incomplete: boolean;
  /** Compact optimiser trace used only by the browser-console debug export. */
  debug?: FormationDecisionDebug;
}

/** Optional per-hero camp metadata sourced from database.json. */
export type HeroMeta = Record<string, { camp?: string }>;

/**
 * Displayed-point band for the top-two-team sum. After the single best top-two
 * sum is found, every feasible formation whose top-two sum is within this many
 * display points of that global maximum is retained; the same-camp preference
 * then ranks the whole retained set. This is a true two-stage global
 * band (find max → keep within band → rank), never a pairwise tolerance.
 */
const TOP_TWO_BAND = 2.5;

/**
 * Hard upper bound on the number of hero partitions that are *fully* skill-
 * assigned and scored (the expensive {@link projectFormation} pass). The beam
 * unions a strength-ranked and a camp-ranked slice per level, so its worst-case
 * product (~56·18·8) can exceed the pre-camp search size; this
 * cap pulls the fully-evaluated set back near the previous ~1920 bound while a
 * deterministic strength/camp interleave (see {@link capPartitions}) keeps
 * a deliberate mix of both kinds of candidate. Small pools enumerate far fewer
 * than this; the cap keeps the full 15-hero post-round-10 pool bounded without
 * excluding heroes before trio strength and camp cohesion have been evaluated.
 */
export const PARTITION_EVAL_CAP = 1920;

/** Team Builder placements use every feature that cleared its model support floor. */
export const TEAM_BUILDER_SUPPORT_MULTIPLIER = 1;

/** Smallest contribution shown as positive evidence in the player-facing scale. */
export const TEAM_BUILDER_VISIBLE_DISPLAY_GAIN = 0.1;

/** Maximum hero pool supported by the ten-round draft contract. */
const FORMATION_HERO_POOL_CAP = 15;

/**
 * Full 13–15-hero pools produce far more third-team variants than improve the
 * primary objective. Retain this many disjoint two-trio candidates—interleaved
 * between hero-strength and same-camp rankings—before constructing the
 * third trio from the remaining heroes. At up to two third-trio variants per
 * pair, this keeps the expensive full assignment pass near the interactive
 * budget while generating prospective main-team trios from all available
 * heroes rather than pre-trimming the pool.
 */
const LARGE_POOL_PAIR_CAP = 160;

/** Hero-only strength (hero + internal hero-pair weights) of a trio. */
function trioHeroStrength(trio: string[], m: PairedModel): number {
  let s = 0;
  for (const h of trio) s += weightOf(m, heroId(h));
  for (let i = 0; i < trio.length; i++) {
    for (let j = i + 1; j < trio.length; j++) {
      s += weightOf(m, heroPairId(trio[i], trio[j]));
    }
  }
  return s;
}

/** All 3-combinations of an array (indices), deterministic order. */
function combinations3(items: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      for (let k = j + 1; k < items.length; k++) out.push([items[i], items[j], items[k]]);
  return out;
}

const KNOWN_TEAM_SKILL_SLOTS = 6 as const;
const KNOWN_TEAM_PARTITION_CAP = 640;

const trioKey = (trio: Iterable<string>): string =>
  [...trio].sort().join('|');

const teamRankingScore = (ranking: TeamRanking): number =>
  ranking === 'S' ? 3 : ranking === 'A' ? 2 : 1;

interface KnownTeamPreference {
  comp: TeamComp;
  key: string;
  localMatchedSkillSlots: number;
}

interface KnownSkillSlot {
  key: string;
  teamKey: string;
  hero: string;
  slotIndex: number;
  alternatives: string[];
}

interface KnownTeamAssignment {
  preference: KnownTeamPreference;
  matchedSkillSlots: number;
}

type KnownTeamIndex = Map<string, KnownTeamPreference[]>;

const isChampionshipComp = (comp: TeamComp): boolean =>
  comp.sources.includes('championship');

const knownSlots = (
  preference: KnownTeamPreference,
  skillPool: Set<string>,
  catalog: RecommendationCatalog
): KnownSkillSlot[] =>
  preference.comp.members.flatMap((member) =>
    member.skillSlots.map((alternatives, slotIndex) => ({
      key: `${preference.comp.id}|${member.hero}|${slotIndex}`,
      teamKey: preference.key,
      hero: member.hero,
      slotIndex,
      alternatives: alternatives.filter(
        (skill) =>
          skillPool.has(skill) &&
          skill !== catalog.default_skill[member.hero]
      ),
    }))
  );

/**
 * Deterministic maximum-cardinality matching from guide skill slots to owned
 * skills. This resolves alternatives across all selected guide teams together,
 * so a skill is never promised to two heroes.
 */
const MAXIMUM_KNOWN_SLOT_MATCHING_EVENT_LIMIT = 24;

interface KnownSlotMatchingResult {
  assignments: Map<string, string>;
  debug?: FormationGuideMatchingTrace;
}

function maximumKnownSlotMatching(
  slots: KnownSkillSlot[],
  captureDebug = false
): KnownSlotMatchingResult {
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));
  const skillOwner = new Map<string, string>();
  const slotSkill = new Map<string, string>();
  const events: FormationGuideMatchingTrace['events'] | undefined = captureDebug
    ? []
    : undefined;
  let omittedEventCount = 0;
  const record = captureDebug
    ? (event: FormationGuideMatchingTrace['events'][number]) => {
        if (events!.length < MAXIMUM_KNOWN_SLOT_MATCHING_EVENT_LIMIT) {
          events!.push(event);
        } else {
          omittedEventCount += 1;
        }
      }
    : undefined;

  const assign = (
    slotKey: string,
    seenSlots: Set<string>,
    seenSkills: Set<string>,
    rootSlotKey: string,
    requestedBySlotKey: string | null
  ): boolean => {
    if (seenSlots.has(slotKey)) return false;
    seenSlots.add(slotKey);
    const slot = slotByKey.get(slotKey);
    if (!slot) return false;
    const previousSkill = slotSkill.get(slotKey);

    for (const skill of slot.alternatives) {
      if (seenSkills.has(skill)) continue;
      seenSkills.add(skill);
      const owner = skillOwner.get(skill);
      let ownerMoved = false;
      let conflict:
        | Extract<
            FormationGuideMatchingTrace['events'][number],
            { type: 'occupied-skill-conflict' }
          >
        | undefined;
      if (owner !== undefined) {
        if (record) {
          conflict = {
            type: 'occupied-skill-conflict',
            rootSlotKey,
            requestingSlotKey: slotKey,
            skill,
            occupyingSlotKey: owner,
            resolvedByOwnerMove: false,
          };
          record(conflict);
        }
        ownerMoved = assign(
          owner,
          seenSlots,
          seenSkills,
          rootSlotKey,
          slotKey
        );
        if (conflict) conflict.resolvedByOwnerMove = ownerMoved;
      }
      if (owner === undefined || ownerMoved) {
        if (previousSkill !== undefined) {
          skillOwner.delete(previousSkill);
          if (record) {
            record({
              type: 'augmenting-owner-move',
              rootSlotKey,
              requestedBySlotKey: requestedBySlotKey ?? rootSlotKey,
              ownerSlotKey: slotKey,
              fromSkill: previousSkill,
              toSkill: skill,
            });
          }
        } else if (record) {
          record({
            type: 'slot-assigned',
            rootSlotKey,
            slotKey,
            skill,
            reason:
              owner === undefined
                ? 'unoccupied-skill'
                : 'owner-moved-by-augmenting-path',
          });
        }
        skillOwner.set(skill, slotKey);
        slotSkill.set(slotKey, skill);
        return true;
      }
    }
    return false;
  };

  for (const slot of slots) {
    assign(slot.key, new Set(), new Set(), slot.key, null);
  }
  const result: KnownSlotMatchingResult = { assignments: slotSkill };
  if (captureDebug) {
    result.debug = {
      objective:
        'maximize assigned guide slots; process higher-priority slots first and move an existing owner only along an augmenting path',
      slotCount: slots.length,
      uniqueSkillCount: new Set(slots.flatMap(({ alternatives }) => alternatives))
        .size,
      matchedSlotCount: slotSkill.size,
      eventLimit: MAXIMUM_KNOWN_SLOT_MATCHING_EVENT_LIMIT,
      events: events!,
      omittedEventCount,
      finalAssignments: slots.map(({ key }) => ({
        slotKey: key,
        skill: slotSkill.get(key) ?? null,
      })),
    };
  }
  return result;
}

function compareKnownPreferences(
  left: KnownTeamPreference,
  right: KnownTeamPreference
): number {
  if (left.localMatchedSkillSlots !== right.localMatchedSkillSlots) {
    return right.localMatchedSkillSlots - left.localMatchedSkillSlots;
  }
  const championshipDelta =
    Number(isChampionshipComp(right.comp)) -
    Number(isChampionshipComp(left.comp));
  if (championshipDelta !== 0) return championshipDelta;
  const rankingDelta =
    teamRankingScore(right.comp.ranking) -
    teamRankingScore(left.comp.ranking);
  if (rankingDelta !== 0) return rankingDelta;
  return left.comp.id < right.comp.id
    ? -1
    : left.comp.id > right.comp.id
      ? 1
      : 0;
}

function buildKnownTeamIndex(
  teamComps: TeamComp[],
  heroPool: Set<string>,
  skillPool: Set<string>,
  catalog: RecommendationCatalog
): KnownTeamIndex {
  const grouped = new Map<string, KnownTeamPreference[]>();
  for (const comp of teamComps) {
    if (!comp.members.every(({ hero }) => heroPool.has(hero))) continue;
    const key = trioKey(comp.members.map(({ hero }) => hero));
    const provisional: KnownTeamPreference = {
      comp,
      key,
      localMatchedSkillSlots: 0,
    };
    const localMatchedSkillSlots = maximumKnownSlotMatching(
      knownSlots(provisional, skillPool, catalog)
    ).assignments.size;
    // A hero trio with no usable guide skill is a pure model fallback, not a
    // database-backed match.
    if (localMatchedSkillSlots === 0) continue;
    const preference = { ...provisional, localMatchedSkillSlots };
    const variants = grouped.get(key) ?? [];
    variants.push(preference);
    grouped.set(key, variants);
  }

  const index: KnownTeamIndex = new Map();
  for (const [key, variants] of grouped) {
    variants.sort(compareKnownPreferences);
    index.set(key, variants);
  }
  return index;
}

function selectKnownPreferences(
  trios: string[][],
  knownTeamIndex: KnownTeamIndex,
  skillPool: string[],
  catalog: RecommendationCatalog,
  cache: Map<string, KnownTeamPreference[]>
): KnownTeamPreference[] {
  const keys = trios
    .map(trioKey)
    .filter((key) => knownTeamIndex.has(key))
    .sort();
  const cacheKey = keys.join('||');
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  if (keys.length === 0) {
    cache.set(cacheKey, []);
    return [];
  }

  const skillSet = new Set(skillPool);
  const groups = keys.map((key) => knownTeamIndex.get(key)!);
  let best: KnownTeamPreference[] = [];
  let bestScore: GuideCandidateScore | null = null;

  const visit = (groupIndex: number, selected: KnownTeamPreference[]) => {
    if (groupIndex < groups.length) {
      for (const preference of groups[groupIndex]) {
        visit(groupIndex + 1, [...selected, preference]);
      }
      return;
    }

    const ordered = [...selected].sort(compareKnownPreferences);
    const slots = ordered.flatMap((preference) =>
      knownSlots(preference, skillSet, catalog)
    );
    const matching = maximumKnownSlotMatching(slots).assignments;
    const matchedByTeam = new Map<string, number>();
    for (const slot of slots) {
      if (!matching.has(slot.key)) continue;
      matchedByTeam.set(
        slot.teamKey,
        (matchedByTeam.get(slot.teamKey) ?? 0) + 1
      );
    }
    const matches = ordered
      .map((preference) => ({
        preference,
        matchedSkillSlots: matchedByTeam.get(preference.key) ?? 0,
      }))
      .filter(({ matchedSkillSlots }) => matchedSkillSlots > 0);
    const score: GuideCandidateScore = {
      exactTeams: matches.filter(
        ({ matchedSkillSlots }) =>
          matchedSkillSlots === KNOWN_TEAM_SKILL_SLOTS
      ).length,
      matchedTeams: matches.length,
      matchedSkillSlots: matches.reduce(
        (sum, { matchedSkillSlots }) => sum + matchedSkillSlots,
        0
      ),
      championshipTeams: matches.filter(({ preference }) =>
        isChampionshipComp(preference.comp)
      ).length,
      rankingScore: matches.reduce(
        (sum, { preference }) =>
          sum + teamRankingScore(preference.comp.ranking),
        0
      ),
      key: matches
        .map(({ preference }) => preference.comp.id)
        .sort()
        .join('|'),
    };
    if (
      bestScore === null ||
      compareGuideCandidateScores(score, bestScore) < 0
    ) {
      best = ordered;
      bestScore = score;
    }
  };

  visit(0, []);
  cache.set(cacheKey, best);
  return best;
}

/**
 * Marginal contribution of assigning `skill` to `hero`, given the skills already
 * on that hero: the hero-skill weight plus any within-hero skill-pair weights it
 * forms with the hero's current skills. The standalone `S|` presence weight is
 * *not* included here because every one of the 18 unique skills is placed
 * exactly once, so `S|` fires identically for any complete assignment and cannot
 * change which assignment is best. Returns `-Infinity` for the hero's own
 * signature skill (which is never draftable).
 */
function assignMarginal(
  hero: string,
  skill: string,
  currentSkills: string[],
  m: PairedModel,
  catalog: RecommendationCatalog
): number {
  if (skill === catalog.default_skill[hero]) return -Infinity;
  let w = weightOf(m, heroSkillId(hero, skill));
  for (const other of currentSkills) {
    w += weightOf(m, skillPairId(hero, skill, other));
  }
  return w;
}

/** Total assigned-skill contribution (HS + within-hero SP) of a hero's skills. */
function heroAssignedScore(
  hero: string,
  skills: string[],
  m: PairedModel
): number {
  let s = 0;
  for (const sk of skills) s += weightOf(m, heroSkillId(hero, sk));
  const sorted = [...skills].sort();
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++)
      s += weightOf(m, skillPairId(hero, sorted[i], sorted[j]));
  return s;
}

interface SkillAssignmentResult {
  heroes: Map<string, { skills: string[]; score: number }>;
  knownTeams: Map<string, KnownTeamAssignment>;
}

/**
 * Globally assign exactly 18 unique skills across the three teams (2 per hero),
 * never a hero's own signature skill. Guide-slot matches are locked first;
 * every remaining slot is filled by the existing model assignment and bounded
 * swap pass. Returns null if the supplied pool has no valid signature-safe
 * assignment.
 */
function assignSkills(
  trios: string[][],
  skillPool: string[],
  m: PairedModel,
  catalog: RecommendationCatalog,
  knownPreferences: KnownTeamPreference[] = []
): SkillAssignmentResult | null {
  const heroes = trios.flat();
  const need = heroes.length * 2;
  const uniqueSkills = [...new Set(skillPool)];
  const skillSet = new Set(uniqueSkills);

  const orderedPreferences = [...knownPreferences].sort(
    compareKnownPreferences
  );
  const guideSlots = orderedPreferences.flatMap((preference) =>
    knownSlots(preference, skillSet, catalog)
  );
  const guideMatching = maximumKnownSlotMatching(guideSlots).assignments;
  const guideSlotByKey = new Map(guideSlots.map((slot) => [slot.key, slot]));
  const preferredSlotSkills = new Map<string, [string | null, string | null]>();
  const lockedSkills = new Map<string, Set<string>>();
  heroes.forEach((hero) => {
    preferredSlotSkills.set(hero, [null, null]);
    lockedSkills.set(hero, new Set());
  });
  for (const [slotKey, skill] of guideMatching) {
    const slot = guideSlotByKey.get(slotKey);
    if (!slot) continue;
    preferredSlotSkills.get(slot.hero)![slot.slotIndex] = skill;
    lockedSkills.get(slot.hero)!.add(skill);
  }

  // Score the shortlist once per skill. Alongside standalone and best-possible
  // hero-skill value, credit the strongest *positive* feasible within-hero pair
  // the skill can form. Crediting both members keeps an individually weak but
  // jointly decisive pair together through the 28→18 prune; the subsequent
  // global assignment still decides whether that potential can be realised.
  const bestHsWeight = new Map<string, number>();
  for (const skill of uniqueSkills) {
    let w = -Infinity;
    for (const hero of heroes) {
      if (skill === catalog.default_skill[hero]) continue;
      const hw = weightOf(m, heroSkillId(hero, skill));
      if (hw > w) w = hw;
    }
    bestHsWeight.set(skill, w === -Infinity ? 0 : w);
  }
  const bestPositiveSp = new Map(uniqueSkills.map((skill) => [skill, 0]));
  for (const hero of heroes) {
    const signature = catalog.default_skill[hero];
    for (let i = 0; i < uniqueSkills.length; i += 1) {
      const first = uniqueSkills[i];
      if (first === signature) continue;
      for (let j = i + 1; j < uniqueSkills.length; j += 1) {
        const second = uniqueSkills[j];
        if (second === signature) continue;
        const synergy = weightOf(m, skillPairId(hero, first, second));
        if (synergy <= 0) continue;
        if (synergy > (bestPositiveSp.get(first) ?? 0)) {
          bestPositiveSp.set(first, synergy);
        }
        if (synergy > (bestPositiveSp.get(second) ?? 0)) {
          bestPositiveSp.set(second, synergy);
        }
      }
    }
  }
  const orderedSkills = uniqueSkills
    .map((skill) => ({
      skill,
      score:
        weightOf(m, skillId(skill)) +
        (bestHsWeight.get(skill) ?? 0) +
        (bestPositiveSp.get(skill) ?? 0),
    }))
    .sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.skill.localeCompare(b.skill)
    )
    .map(({ skill }) => skill);

  const assign = new Map<string, string[]>();
  heroes.forEach((hero) => {
    assign.set(
      hero,
      preferredSlotSkills
        .get(hero)!
        .filter((skill): skill is string => skill !== null)
    );
  });
  const capacity = new Map<string, number>();
  heroes.forEach((hero) =>
    capacity.set(hero, 2 - (assign.get(hero)?.length ?? 0))
  );

  const matchedGuideSkills = new Set(guideMatching.values());
  const remaining = orderedSkills
    .filter((skill) => !matchedGuideSkills.has(skill))
    .slice(0, need - matchedGuideSkills.size);

  // Greedy: repeatedly place the (open-slot hero, remaining skill) with the max
  // marginal gain. Deterministic tie-breaks by hero then skill name.
  while (remaining.length > 0 && [...capacity.values()].some((c) => c > 0)) {
    let best: { hero: string; skill: string; w: number } | null = null;
    for (const hero of heroes) {
      if ((capacity.get(hero) ?? 0) <= 0) continue;
      for (const skill of remaining) {
        const w = assignMarginal(hero, skill, assign.get(hero)!, m, catalog);
        if (
          best === null ||
          w > best.w ||
          (w === best.w && (hero < best.hero || (hero === best.hero && skill < best.skill)))
        ) {
          best = { hero, skill, w };
        }
      }
    }
    if (!best) break;
    assign.get(best.hero)!.push(best.skill);
    capacity.set(best.hero, (capacity.get(best.hero) ?? 0) - 1);
    remaining.splice(remaining.indexOf(best.skill), 1);
  }

  // Greedy placement can leave a signature skill on its owner when that is the
  // last nominal candidate (assignMarginal returns -Infinity, but a candidate
  // still exists). Repair each such conflict with a valid cross-hero swap. If
  // no repair exists, reject this partition instead of emitting an illegal
  // formation.
  for (const hero of heroes) {
    const own = catalog.default_skill[hero];
    if (!own) continue;
    const ownSkills = assign.get(hero)!;
    const badIndex = ownSkills.indexOf(own);
    if (badIndex < 0) continue;

    let repaired = false;
    for (const otherHero of heroes) {
      if (otherHero === hero || own === catalog.default_skill[otherHero]) continue;
      const otherSkills = assign.get(otherHero)!;
      for (let i = 0; i < otherSkills.length; i++) {
        if (lockedSkills.get(otherHero)!.has(otherSkills[i])) continue;
        if (otherSkills[i] === catalog.default_skill[hero]) continue;
        [ownSkills[badIndex], otherSkills[i]] = [otherSkills[i], ownSkills[badIndex]];
        repaired = true;
        break;
      }
      if (repaired) break;
    }
    if (!repaired) return null;
  }

  // Skill assignment prioritises the *two strongest* team scores, keeping the
  // third team strictly secondary (topTwoSum + 0.25 * thirdStrength). This
  // matches the formation-level objective (make the two main teams as strong as
  // possible, then the third), so the assignment step never routes skills away
  // from the best two teams merely to improve the third. Which heroes team up
  // (and hence camp structure) is fixed by the partition.
  const assignmentScoreCache = new Map<string, number>();
  const assignedTrioScore = (trio: string[]): number => {
    const key = [...trio]
      .sort()
      .map((name) => `${name}:${[...(assign.get(name) ?? [])].sort().join(',')}`)
      .join(';');
    const cached = assignmentScoreCache.get(key);
    if (cached !== undefined) return cached;
    const score = scoreTeam(
      trio.map((name) => ({ name, skills: assign.get(name) ?? [] })),
      m,
      catalog
    );
    assignmentScoreCache.set(key, score);
    return score;
  };
  const assignmentObjective = (): number => {
    const scores = trios
      .map(assignedTrioScore)
      .sort((a, b) => b - a);
    return scores[0] + scores[1] + 0.25 * scores[2];
  };

  // Bounded local improvement: swap two assigned skills when it raises the
  // top-two-weighted objective (the two main teams first, third secondary).
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let a = 0; a < heroes.length; a++) {
      for (let b = a + 1; b < heroes.length; b++) {
        const ha = heroes[a];
        const hb = heroes[b];
        const sa = assign.get(ha)!;
        const sb = assign.get(hb)!;
        for (let i = 0; i < sa.length; i++) {
          for (let j = 0; j < sb.length; j++) {
            if (
              lockedSkills.get(ha)!.has(sa[i]) ||
              lockedSkills.get(hb)!.has(sb[j])
            ) {
              continue;
            }
            // Never assign a hero its own signature skill via a swap.
            if (sb[j] === catalog.default_skill[ha] || sa[i] === catalog.default_skill[hb]) continue;
            const before = assignmentObjective();
            [sa[i], sb[j]] = [sb[j], sa[i]];
            const after = assignmentObjective();
            if (after > before + 1e-9) {
              improved = true;
            } else {
              [sa[i], sb[j]] = [sb[j], sa[i]]; // revert
            }
          }
        }
      }
    }
    if (!improved) break;
  }

  const result = new Map<string, { skills: string[]; score: number }>();
  for (const hero of heroes) {
    const preferred = preferredSlotSkills.get(hero) ?? [null, null];
    const fallback = (assign.get(hero) ?? [])
      .filter((skill) => !lockedSkills.get(hero)!.has(skill))
      .sort();
    const skills = [...preferred];
    for (let index = 0; index < skills.length; index += 1) {
      if (skills[index] === null) skills[index] = fallback.shift() ?? null;
    }
    const completeSkills = skills.filter(
      (skill): skill is string => skill !== null
    );
    result.set(hero, {
      skills: completeSkills,
      score: heroAssignedScore(hero, completeSkills, m),
    });
  }
  const knownTeams = new Map<string, KnownTeamAssignment>();
  for (const preference of orderedPreferences) {
    const matchedSkillSlots = guideSlots.filter(
      (slot) =>
        slot.teamKey === preference.key && guideMatching.has(slot.key)
    ).length;
    knownTeams.set(preference.key, {
      preference,
      matchedSkillSlots,
    });
  }
  return { heroes: result, knownTeams };
}

/** True when every hero on the team shares the same (defined) camp. */
function isAllSameCamp(trio: string[], meta: HeroMeta): boolean {
  const camps = trio.map((h) => meta[h]?.camp);
  if (camps.some((c) => !c)) return false;
  return camps.every((c) => c === camps[0]);
}

/**
 * Same-camp preference score for a set of trios (higher is better). It is
 * best-effort: it never overrides skill/signature feasibility and only breaks
 * ties within the top-two-sum tolerance band.
 */
interface StructureScore {
  sameCampTeams: number;
}

function structureScore(trios: string[][], meta: HeroMeta): StructureScore {
  let sameCampTeams = 0;
  for (const trio of trios) {
    if (isAllSameCamp(trio, meta)) sameCampTeams += 1;
  }
  return { sameCampTeams };
}

/** Compact positive, family-grouped evidence for one fully-assigned team. */
function buildTeamEvidence(
  team: AssignedHero[],
  m: PairedModel,
  catalog: RecommendationCatalog
): TeamEvidence {
  const active = activeTeamContributions(team, m, catalog);
  const toItem = (c: ActiveContribution): EvidenceItem => ({
    label: labelFeature(c.featureId).label,
    gain: displayScore(c.weight),
    support: c.support,
  });
  // Already sorted by weight; show at most two positive rows per readable group.
  const pickMany = (families: string[]): EvidenceItem[] =>
    active
      .filter((contribution) => families.includes(contribution.family) && contribution.weight > 0)
      .map(toItem)
      .filter((item) => item.gain > 0)
      .slice(0, 2);
  return {
    heroSynergy: pickMany([F_HERO_PAIR, F_HERO_TRIO, F_CAMP, F_BOND]),
    heroSkill: pickMany([F_HERO_SKILL, F_TEAM_HERO_SKILL, F_HERO_MECH]),
    skillSynergy: pickMany([F_SKILL_PAIR, F_TEAM_SKILL_PAIR, F_TEAM_SKILL_TRIPLE, F_MECH]),
  };
}

/**
 * A fully skill-assigned team *without* the (relatively expensive) positive
 * evidence rows. Evidence is deferred to the single winning formation only —
 * /team-builder already has a noticeable compute delay, so we never build
 * evidence for the many discarded partitions.
 */
interface DraftTeam {
  heroes: ProjectedHero[];
  /** Assigned heroes (name + skills) — the input to scoreTeam / evidence. */
  assigned: AssignedHero[];
  /** Real `scoreTeam` strength (raw units). */
  strength: number;
  knownTeam?: KnownTeamAssignment;
}

/** Assemble fully-assigned draft teams + their real `scoreTeam` strengths. */
function projectFormation(
  trios: string[][],
  skillPool: string[],
  m: PairedModel,
  catalog: RecommendationCatalog,
  knownPreferences: KnownTeamPreference[] = []
): { teams: DraftTeam[]; strengths: number[] } | null {
  const assignment = assignSkills(
    trios,
    skillPool,
    m,
    catalog,
    knownPreferences
  );
  if (!assignment) return null;
  const teams: DraftTeam[] = trios.map((trio) => {
    const heroes: ProjectedHero[] = trio.map((name) => {
      const a = assignment.heroes.get(name)!;
      return { name, skills: a.skills, skillScore: displayScore(a.score) };
    });
    const assigned = heroes.map((p) => ({ name: p.name, skills: p.skills }));
    const strength = scoreTeam(assigned, m, catalog);
    const knownTeam = assignment.knownTeams.get(trioKey(trio));
    return {
      heroes,
      assigned,
      strength,
      ...(knownTeam && knownTeam.matchedSkillSlots > 0
        ? { knownTeam }
        : {}),
    };
  });
  return { teams, strengths: teams.map((t) => t.strength) };
}

/** Same-camp score for a single trio (higher = more desirable). */
function trioStructureRank(trio: string[], meta: HeroMeta): number {
  return isAllSameCamp(trio, meta) ? 1 : 0;
}

/**
 * Union of the strength-ranked and same-camp-ranked top slices of a trio list,
 * de-duplicated and returned in a deterministic order. Keeping both kinds of
 * candidate ensures the beam retains same-camp trios that a pure strength prune
 * would drop, while still bounding the branching factor.
 */
function beamTrios(
  trios: string[][],
  m: PairedModel,
  meta: HeroMeta,
  byStrength: number,
  byStructure: number
): string[][] {
  const decorated = trios.map((trio) => ({
    trio,
    s: trioHeroStrength(trio, m),
    st: trioStructureRank(trio, meta),
    canon: [...trio].sort().join(','),
  }));
  const strengthTop = [...decorated]
    .sort((x, y) => (y.s !== x.s ? y.s - x.s : x.canon.localeCompare(y.canon)))
    .slice(0, byStrength);
  const structureTop = [...decorated]
    .sort((x, y) =>
      y.st !== x.st ? y.st - x.st : y.s !== x.s ? y.s - x.s : x.canon.localeCompare(y.canon)
    )
    .slice(0, byStructure);
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const { trio, canon } of [...strengthTop, ...structureTop]) {
    if (seen.has(canon)) continue;
    seen.add(canon);
    out.push(trio);
  }
  return out;
}

/** Canonical, order-independent key for a hero partition (order trios & heroes). */
function partitionKey(trios: string[][]): string {
  return trios
    .map(trioKey)
    .sort()
    .join('||');
}

/** Canonical, order-independent key for the two prospective main teams. */
function trioPairKey(trios: [string[], string[]]): string {
  return trios
    .map((trio) => [...trio].sort().join('|'))
    .sort()
    .join('||');
}

interface TrioPairCandidate {
  trios: [string[], string[]];
  strength: number;
  structure: number;
  key: string;
}

/**
 * Interleave hero-strength and same-camp rankings for prospective main
 * team pairs. This mirrors {@link capPartitions}, but happens before selecting
 * a third team so the full 15-hero pool does not spend most of its runtime
 * skill-assigning minor third-team variants.
 */
function capTrioPairs(
  candidates: TrioPairCandidate[],
  cap: number
): TrioPairCandidate[] {
  if (candidates.length <= cap) return candidates;
  const cmpKey = (a: TrioPairCandidate, b: TrioPairCandidate) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  const byStrength = [...candidates].sort((a, b) =>
    b.strength !== a.strength
      ? b.strength - a.strength
      : b.structure !== a.structure
        ? b.structure - a.structure
        : cmpKey(a, b)
  );
  const byStructure = [...candidates].sort((a, b) =>
    b.structure !== a.structure
      ? b.structure - a.structure
      : b.strength !== a.strength
        ? b.strength - a.strength
        : cmpKey(a, b)
  );
  const picked: TrioPairCandidate[] = [];
  const seen = new Set<string>();
  let i = 0;
  let j = 0;
  const take = (candidate: TrioPairCandidate) => {
    if (seen.has(candidate.key)) return;
    seen.add(candidate.key);
    picked.push(candidate);
  };
  while (picked.length < cap && (i < byStrength.length || j < byStructure.length)) {
    if (i < byStrength.length) take(byStrength[i++]);
    if (picked.length >= cap) break;
    if (j < byStructure.length) take(byStructure[j++]);
  }
  return picked;
}

/**
 * Build one deterministic, hero-strength-first partition containing `hero`.
 * This is used only as a coverage fallback after the normal large-pool
 * trio/pair beam. It ensures a hero whose decisive value lives in HS/SP
 * features still reaches the full skill-assignment scorer at least once.
 */
function coveragePartition(
  hero: string,
  pool: string[],
  m: PairedModel,
  heroMeta: HeroMeta
): [string[], string[], string[]] | null {
  const first = beamTrios(
    combinations3(pool).filter((trio) => trio.includes(hero)),
    m,
    heroMeta,
    1,
    0
  )[0];
  if (!first) return null;

  const usedFirst = new Set(first);
  const remainingAfterFirst = pool.filter((candidate) => !usedFirst.has(candidate));
  const second = beamTrios(
    combinations3(remainingAfterFirst),
    m,
    heroMeta,
    1,
    0
  )[0];
  if (!second) return null;

  const used = new Set([...first, ...second]);
  const remaining = pool.filter((candidate) => !used.has(candidate));
  const third = beamTrios(combinations3(remaining), m, heroMeta, 1, 0)[0];
  return third ? [first, second, third] : null;
}

/**
 * Large-pool search: find prospective main-team pairs first, then construct the
 * third team from the nine or fewer remaining heroes. Final ranking is still
 * performed only after global 18-skill assignment in {@link recommendTeams};
 * this is a bounded candidate-generation strategy, not a replacement score.
 */
function enumerateLargePoolPartitions(
  pool: string[],
  m: PairedModel,
  heroMeta: HeroMeta
): [string[], string[], string[]][] {
  const pairCandidates: TrioPairCandidate[] = [];
  const seenPairs = new Set<string>();
  const firstTrios = beamTrios(combinations3(pool), m, heroMeta, 40, 16);
  for (const first of firstTrios) {
    const usedFirst = new Set(first);
    const remainingAfterFirst = pool.filter((hero) => !usedFirst.has(hero));
    const secondTrios = beamTrios(
      combinations3(remainingAfterFirst),
      m,
      heroMeta,
      12,
      6
    );
    for (const second of secondTrios) {
      const trios: [string[], string[]] = [first, second];
      const key = trioPairKey(trios);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      pairCandidates.push({
        trios,
        strength: trioHeroStrength(first, m) + trioHeroStrength(second, m),
        structure:
          trioStructureRank(first, heroMeta) +
          trioStructureRank(second, heroMeta),
        key,
      });
    }
  }

  const selectedPairs = capTrioPairs(pairCandidates, LARGE_POOL_PAIR_CAP);
  const partitions: [string[], string[], string[]][] = [];
  const seenPartitions = new Set<string>();
  const coveredHeroes = new Set<string>();
  const addPartition = (partition: [string[], string[], string[]]) => {
    const key = partitionKey(partition);
    if (seenPartitions.has(key)) return;
    seenPartitions.add(key);
    partitions.push(partition);
    for (const hero of partition.flat()) coveredHeroes.add(hero);
  };
  for (const { trios: [first, second] } of selectedPairs) {
    const used = new Set([...first, ...second]);
    const remaining = pool.filter((hero) => !used.has(hero));
    // Keep the strongest and the most camp-cohesive construction of team
    // three. The union is deterministic and de-duplicated by beamTrios.
    const thirdTrios = beamTrios(combinations3(remaining), m, heroMeta, 1, 1);
    for (const third of thirdTrios) {
      addPartition([first, second, third]);
    }
  }

  // Hero-only trio and pair pruning cannot see HS/SP value. Reserve one
  // strongest feasible partition for each hero that the normal beam missed, so
  // all supported heroes survive into the expensive full evaluation pass. The
  // fallback adds at most one partition per hero and therefore remains far
  // below PARTITION_EVAL_CAP on a 15-hero pool.
  for (const hero of pool) {
    if (coveredHeroes.has(hero)) continue;
    const partition = coveragePartition(hero, pool, m, heroMeta);
    if (partition) addPartition(partition);
  }
  return capPartitions(partitions, m, heroMeta, PARTITION_EVAL_CAP);
}

/**
 * Deterministically cap the fully-evaluated partition set at {@link PARTITION_EVAL_CAP}.
 *
 * The beam can enumerate more disjoint partitions than we want to skill-assign
 * and score (that pass is the /team-builder compute cost). Rather than truncate
 * in enumeration order — which would bias toward whichever trio happened to sort
 * first — we rank every partition two ways and *interleave*: a strength proxy
 * (top-two trio hero-strength, matching the top-two-sum selection goal) and a
 * same-camp proxy. Alternating one pick from each list preserves a deliberate
 * mix of strong and camp-cohesive partitions while bounding the count. Dedupe is
 * by canonical key, so the result is total, transitive and order-independent.
 */
function capPartitions(
  partitions: [string[], string[], string[]][],
  m: PairedModel,
  meta: HeroMeta,
  cap: number
): [string[], string[], string[]][] {
  if (partitions.length <= cap) return partitions;
  const decorated = partitions.map((trios) => {
    const hs = trios.map((t) => trioHeroStrength(t, m)).sort((a, b) => b - a);
    const ss = structureScore(trios, meta);
    return {
      trios,
      strength: hs[0] + hs[1],
      structure: ss.sameCampTeams,
      key: partitionKey(trios),
    };
  });
  const cmpKey = (a: { key: string }, b: { key: string }) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  const byStrength = [...decorated].sort((a, b) =>
    b.strength !== a.strength
      ? b.strength - a.strength
      : b.structure !== a.structure
        ? b.structure - a.structure
        : cmpKey(a, b)
  );
  const byStructure = [...decorated].sort((a, b) =>
    b.structure !== a.structure
      ? b.structure - a.structure
      : b.strength !== a.strength
        ? b.strength - a.strength
        : cmpKey(a, b)
  );
  const picked: [string[], string[], string[]][] = [];
  const seen = new Set<string>();
  let i = 0;
  let j = 0;
  const take = (c: { trios: [string[], string[], string[]]; key: string }) => {
    if (seen.has(c.key)) return;
    seen.add(c.key);
    picked.push(c.trios);
  };
  while (picked.length < cap && (i < byStrength.length || j < byStructure.length)) {
    if (i < byStrength.length) take(byStrength[i++]);
    if (picked.length >= cap) break;
    if (j < byStructure.length) take(byStructure[j++]);
  }
  return picked;
}

/**
 * Enumerate a bounded, deterministic beam of disjoint 3×3 hero partitions. For
 * pools up to 12 heroes, each level unions strength- and same-camp-ranked
 * slices. For 13–15 heroes, the search selects the two prospective main teams
 * first and constructs a third team from the remaining heroes. Both paths cap
 * the fully-evaluated set at {@link PARTITION_EVAL_CAP}; exported for the
 * evaluation-bound regression test.
 */
export function enumerateFormationPartitions(
  pool: string[],
  m: PairedModel,
  heroMeta: HeroMeta
): [string[], string[], string[]][] {
  // The game contract tops out at 15 heroes. Canonically rank and cap any
  // out-of-contract caller before combination generation, preventing a 16+
  // input from turning into an unbounded combinatorial search.
  const boundedPool = [...new Set(pool)]
    .sort((a, b) => {
      const wa = weightOf(m, heroId(a));
      const wb = weightOf(m, heroId(b));
      return wb !== wa ? wb - wa : a.localeCompare(b);
    })
    .slice(0, FORMATION_HERO_POOL_CAP);

  if (boundedPool.length > 12) {
    return enumerateLargePoolPartitions(boundedPool, m, heroMeta);
  }

  const partitions: [string[], string[], string[]][] = [];
  const seen = new Set<string>();
  const firstTrios = beamTrios(combinations3(boundedPool), m, heroMeta, 40, 16);
  for (const t1 of firstTrios) {
    const used1 = new Set(t1);
    const rest1 = boundedPool.filter((h) => !used1.has(h));
    const secondTrios = beamTrios(combinations3(rest1), m, heroMeta, 12, 6);
    for (const t2 of secondTrios) {
      const used2 = new Set([...t1, ...t2]);
      const rest2 = boundedPool.filter((h) => !used2.has(h));
      const thirdTrios = beamTrios(combinations3(rest2), m, heroMeta, 4, 4);
      for (const t3 of thirdTrios) {
        const canon = partitionKey([t1, t2, t3]);
        if (seen.has(canon)) continue;
        seen.add(canon);
        partitions.push([t1, t2, t3]);
      }
    }
  }
  return capPartitions(partitions, m, heroMeta, PARTITION_EVAL_CAP);
}

interface KnownPartitionProxy {
  partition: [string[], string[], string[]];
  knownTeams: number;
  matchedSlots: number;
  championshipTeams: number;
  rankingScore: number;
  sameCampTeams: number;
  heroStrength: number;
  key: string;
}

const triosAreDisjoint = (trios: string[][]): boolean =>
  new Set(trios.flat()).size === trios.length * 3;

function knownPartitionProxy(
  partition: [string[], string[], string[]],
  knownTeamIndex: KnownTeamIndex,
  m: PairedModel,
  heroMeta: HeroMeta
): KnownPartitionProxy {
  const preferences = partition
    .map((trio) => knownTeamIndex.get(trioKey(trio))?.[0])
    .filter(
      (preference): preference is KnownTeamPreference =>
        preference !== undefined
    );
  return {
    partition,
    knownTeams: preferences.length,
    matchedSlots: preferences.reduce(
      (sum, preference) => sum + preference.localMatchedSkillSlots,
      0
    ),
    championshipTeams: preferences.filter(({ comp }) =>
      isChampionshipComp(comp)
    ).length,
    rankingScore: preferences.reduce(
      (sum, { comp }) => sum + teamRankingScore(comp.ranking),
      0
    ),
    sameCampTeams: structureScore(partition, heroMeta).sameCampTeams,
    heroStrength: partition.reduce(
      (sum, trio) => sum + trioHeroStrength(trio, m),
      0
    ),
    key: partitionKey(partition),
  };
}

function compareKnownPartitionProxies(
  left: KnownPartitionProxy,
  right: KnownPartitionProxy
): number {
  if (left.knownTeams !== right.knownTeams)
    return right.knownTeams - left.knownTeams;
  if (left.matchedSlots !== right.matchedSlots)
    return right.matchedSlots - left.matchedSlots;
  if (left.championshipTeams !== right.championshipTeams)
    return right.championshipTeams - left.championshipTeams;
  if (left.rankingScore !== right.rankingScore)
    return right.rankingScore - left.rankingScore;
  if (left.sameCampTeams !== right.sameCampTeams)
    return right.sameCampTeams - left.sameCampTeams;
  if (Math.abs(left.heroStrength - right.heroStrength) > 1e-9)
    return right.heroStrength - left.heroStrength;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/**
 * Reserve a bounded set of partitions containing usable `database.team`
 * trios, then fill the rest of the unchanged 1,920-candidate budget with the
 * model beam. The hybrid search therefore never performs a second unbounded
 * optimisation pass.
 */
function enumerateHybridFormationPartitions(
  pool: string[],
  m: PairedModel,
  heroMeta: HeroMeta,
  knownTeamIndex: KnownTeamIndex
): [string[], string[], string[]][] {
  const modelPartitions = enumerateFormationPartitions(pool, m, heroMeta);
  if (knownTeamIndex.size === 0) return modelPartitions;

  const knownTrios = [...knownTeamIndex.values()]
    .map((variants) => variants[0])
    .sort(compareKnownPreferences)
    .map(({ comp }) => comp.members.map(({ hero }) => hero));
  const preferred: [string[], string[], string[]][] = [];
  const seenPreferred = new Set<string>();
  const addPreferred = (trios: string[][]) => {
    if (trios.length !== 3 || !triosAreDisjoint(trios)) return;
    const partition = trios as [string[], string[], string[]];
    const key = partitionKey(partition);
    if (seenPreferred.has(key)) return;
    seenPreferred.add(key);
    preferred.push(partition);
  };

  for (let first = 0; first < knownTrios.length; first += 1) {
    const firstTrio = knownTrios[first];
    const usedFirst = new Set(firstTrio);
    const afterFirst = pool.filter((hero) => !usedFirst.has(hero));

    const secondFallbacks = beamTrios(
      combinations3(afterFirst),
      m,
      heroMeta,
      8,
      4
    );
    for (const secondTrio of secondFallbacks) {
      const used = new Set([...firstTrio, ...secondTrio]);
      const remaining = pool.filter((hero) => !used.has(hero));
      const thirdFallbacks = beamTrios(
        combinations3(remaining),
        m,
        heroMeta,
        2,
        2
      );
      for (const thirdTrio of thirdFallbacks) {
        addPreferred([firstTrio, secondTrio, thirdTrio]);
      }
    }

    for (let second = first + 1; second < knownTrios.length; second += 1) {
      const secondTrio = knownTrios[second];
      if (!triosAreDisjoint([firstTrio, secondTrio])) continue;
      const used = new Set([...firstTrio, ...secondTrio]);
      const remaining = pool.filter((hero) => !used.has(hero));
      const thirdFallbacks = beamTrios(
        combinations3(remaining),
        m,
        heroMeta,
        2,
        2
      );
      for (const thirdTrio of thirdFallbacks) {
        addPreferred([firstTrio, secondTrio, thirdTrio]);
      }

      for (
        let third = second + 1;
        third < knownTrios.length;
        third += 1
      ) {
        addPreferred([firstTrio, secondTrio, knownTrios[third]]);
      }
    }
  }

  const rankedPreferred = preferred
    .map((partition) =>
      knownPartitionProxy(partition, knownTeamIndex, m, heroMeta)
    )
    .sort(compareKnownPartitionProxies)
    .slice(0, KNOWN_TEAM_PARTITION_CAP)
    .map(({ partition }) => partition);

  const combined: [string[], string[], string[]][] = [];
  const seen = new Set<string>();
  for (const partition of [...rankedPreferred, ...modelPartitions]) {
    const key = partitionKey(partition);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(partition);
    if (combined.length === PARTITION_EVAL_CAP) break;
  }
  return combined;
}

interface FormationCandidate {
  teams: DraftTeam[];
  /** Fully-assigned team strengths, sorted strongest-first. */
  sorted: number[];
  topTwoSum: number;
  thirdStrength: number;
  totalStrength: number;
  structure: StructureScore;
  /** Deterministic canonical key over the hero partition. */
  key: string;
  guide: GuideCandidateScore;
}

interface GuideCandidateScore {
  exactTeams: number;
  matchedTeams: number;
  matchedSkillSlots: number;
  championshipTeams: number;
  rankingScore: number;
  key: string;
}

function guideCandidateScore(teams: DraftTeam[]): GuideCandidateScore {
  const matches = teams
    .map(({ knownTeam }) => knownTeam)
    .filter(
      (knownTeam): knownTeam is KnownTeamAssignment =>
        knownTeam !== undefined && knownTeam.matchedSkillSlots > 0
    );
  return {
    exactTeams: matches.filter(
      ({ matchedSkillSlots }) =>
        matchedSkillSlots === KNOWN_TEAM_SKILL_SLOTS
    ).length,
    matchedTeams: matches.length,
    matchedSkillSlots: matches.reduce(
      (sum, { matchedSkillSlots }) => sum + matchedSkillSlots,
      0
    ),
    championshipTeams: matches.filter(({ preference }) =>
      isChampionshipComp(preference.comp)
    ).length,
    rankingScore: matches.reduce(
      (sum, { preference }) =>
        sum + teamRankingScore(preference.comp.ranking),
      0
    ),
    key: matches
      .map(({ preference }) => preference.comp.id)
      .sort()
      .join('|'),
  };
}

function compareGuideCandidateScores(
  left: GuideCandidateScore,
  right: GuideCandidateScore
): number {
  if (left.exactTeams !== right.exactTeams)
    return right.exactTeams - left.exactTeams;
  if (left.matchedTeams !== right.matchedTeams)
    return right.matchedTeams - left.matchedTeams;
  if (left.matchedSkillSlots !== right.matchedSkillSlots)
    return right.matchedSkillSlots - left.matchedSkillSlots;
  if (left.championshipTeams !== right.championshipTeams)
    return right.championshipTeams - left.championshipTeams;
  if (left.rankingScore !== right.rankingScore)
    return right.rankingScore - left.rankingScore;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/**
 * Lexicographic ranking comparator for candidates that have *already* been
 * retained inside the global top-two band (see {@link recommendTeams}). The
 * *better* candidate compares less-than, so a stable min-pick keeps the winner.
 *
 * This comparator is total, transitive and order-independent — it does NOT
 * apply any tolerance. The strength band is enforced once, globally, before
 * ranking; here every retained candidate is treated as strength-tied and ranked
 * purely by the camp preference and then deterministic tie-breaks:
 *
 *  1. More all-same-camp teams.
 *  2. Stronger third team.
 *  3. Higher total strength.
 *  4. Deterministic canonical key.
 */
function compareCandidates(a: FormationCandidate, b: FormationCandidate): number {
  if (a.structure.sameCampTeams !== b.structure.sameCampTeams)
    return b.structure.sameCampTeams - a.structure.sameCampTeams;
  if (Math.abs(a.thirdStrength - b.thirdStrength) > 1e-9)
    return a.thirdStrength > b.thirdStrength ? -1 : 1;
  if (Math.abs(a.totalStrength - b.totalStrength) > 1e-9)
    return a.totalStrength > b.totalStrength ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Number of formation options surfaced to the user (方案一/二/三). */
const MAX_OPTIONS = 3;

/**
 * Order a candidate's fully-assigned teams strongest-first (stable, readable)
 * and build its user-facing {@link ProjectedTeam}s (per-team display 评分 and
 * compact positive evidence). No aggregate score is produced.
 */
function candidateToOption(
  candidate: FormationCandidate,
  m: PairedModel,
  catalog: RecommendationCatalog
): FormationOption {
  const ordered = [...candidate.teams].sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return a.heroes
      .map((h) => h.name)
      .join(',')
      .localeCompare(b.heroes.map((h) => h.name).join(','));
  });
  const teams: ProjectedTeam[] = ordered.map((t) => ({
    heroes: t.heroes,
    strength: displayScore(t.strength),
    evidence: buildTeamEvidence(t.assigned, m, catalog),
    ...(t.knownTeam
      ? {
          formation: t.knownTeam.preference.comp.formation,
          knownTeam: {
            id: t.knownTeam.preference.comp.id,
            ranking: t.knownTeam.preference.comp.ranking,
            sources: [...t.knownTeam.preference.comp.sources],
            matchedHeroSlots: 3,
            totalHeroSlots: 3,
            matchedSkillSlots: t.knownTeam.matchedSkillSlots,
            totalSkillSlots: KNOWN_TEAM_SKILL_SLOTS,
          },
        }
      : {}),
  }));
  return { teams };
}

/**
 * Number of heroes the two partitions place on the same canonical team. Used as
 * an overlap proxy so diversity picks avoid trivial team-order variants of an
 * already-selected option. Higher = more similar.
 */
function partitionSimilarity(a: FormationCandidate, b: FormationCandidate): number {
  const aTeams = a.teams.map((t) => new Set(t.heroes.map((h) => h.name)));
  const bTeams = b.teams.map((t) => t.heroes.map((h) => h.name));
  // For each team in b, its best-matching team in a (max shared heroes).
  return bTeams.reduce((sum, team) => {
    const best = Math.max(...aTeams.map((s) => team.filter((h) => s.has(h)).length));
    return sum + best;
  }, 0);
}

/**
 * Deterministically pick up to {@link MAX_OPTIONS} distinct feasible options
 * from the already-scored candidates — with no additional partition evaluation.
 *
 * Option one is always the winner. Each subsequent option is chosen from the
 * remaining candidates (distinct canonical partition keys only) to maximise
 * diversity: minimise the maximum hero-overlap against any already-selected
 * option, then prefer the candidate the ranking comparator likes best, then a
 * deterministic canonical key. This yields meaningfully different formations
 * rather than trivial team-order variants, with no randomness.
 */
function selectDiverseOptions(
  ranked: FormationCandidate[],
  m: PairedModel,
  catalog: RecommendationCatalog
): FormationOption[] {
  if (ranked.length === 0) return [];
  const chosen: FormationCandidate[] = [ranked[0]];
  const usedKeys = new Set<string>([ranked[0].key]);
  while (chosen.length < MAX_OPTIONS) {
    let best: FormationCandidate | null = null;
    let bestOverlap = Infinity;
    let bestRank = Infinity;
    for (let idx = 0; idx < ranked.length; idx += 1) {
      const c = ranked[idx];
      if (usedKeys.has(c.key)) continue;
      const overlap = Math.max(...chosen.map((s) => partitionSimilarity(s, c)));
      if (
        overlap < bestOverlap ||
        (overlap === bestOverlap && idx < bestRank) ||
        (overlap === bestOverlap && idx === bestRank && best !== null && c.key < best.key)
      ) {
        best = c;
        bestOverlap = overlap;
        bestRank = idx;
      }
    }
    if (!best) break;
    chosen.push(best);
    usedKeys.add(best.key);
  }
  return chosen.map((candidate) => candidateToOption(candidate, m, catalog));
}

/**
 * Optimise all three disjoint 3-hero teams together with their unique 18-skill
 * assignment, then expose up to three distinct feasible formation options.
 *
 * Selection is driven by *fully skill-assigned* teams, not a hero-only proxy:
 *
 *  1. Enumerate a bounded, deterministic beam of disjoint 3×3 hero partitions.
 *     Each level's candidates are the *union* of a strength-ranked and a
 *     same-camp-ranked top slice, so camp-cohesive partitions survive the prune
 *     while runtime stays bounded.
 *  2. For every retained partition, run the global unique 18-skill assignment
 *     (2/hero, never a signature skill) and score each team with the full model.
 *  3. Hybrid callers first retain the best feasible guide-coverage class
 *     (exact teams, matched teams, matched slots, source/rank, stable ID).
 *     Within it, select in the original two global model stages, never
 *     pairwise: (a) find the single absolute maximum top-two-team summed
 *     strength and retain every formation whose top-two sum is within a
 *     {@link TOP_TWO_BAND}-point display band of that maximum; (b) rank the
 *     retained set with a pure, transitive lexicographic comparator — same-camp
 *     teams, then the stronger third team, total strength, and a deterministic
 *     key. Camp preference never overrides skill/signature feasibility and
 *     never widens the band.
 *  4. Option one is that winner; options two and three are a deterministic
 *     diversity selection over the *same already-scored candidates* (distinct
 *     canonical partition keys, minimal hero-overlap) — no extra evaluation.
 *
 * No aggregate 总评分 is produced; each team carries its own display 评分.
 * `heroMeta` carries camp metadata from the database; when omitted the camp
 * preference is simply inert. Hero ranking is presentation-only; known-team
 * guide rank can break hybrid guide ties, but is never added to model scores.
 *
 * Deterministic and bounded for the full 9–15-hero progression pool. Every
 * supported hero reaches at least one fully evaluated partition; out-of-contract
 * 16+ pools are deterministically capped to the 15 strongest individual heroes.
 * {@link PARTITION_EVAL_CAP} bounds the expensive full skill-assignment pass.
 */
const incompleteFormationRecommendation = (): FormationRecommendation => ({
  options: [],
  incomplete: true,
});

interface FormationSearch {
  m: PairedModel;
  skills: string[];
  catalog: RecommendationCatalog;
  heroMeta: HeroMeta;
  partitions: [string[], string[], string[]][];
  knownTeamIndex?: KnownTeamIndex;
  knownPreferenceCache: Map<string, KnownTeamPreference[]>;
  preferKnownTeams: boolean;
}

function prepareFormationSearch(
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData,
  catalog: RecommendationCatalog,
  heroMeta: HeroMeta,
  teamComps?: TeamComp[]
): FormationSearch | null {
  const m = model(data);
  const heroes = [...new Set(heroPool)];
  const skills = [...new Set(skillPool)];

  if (heroes.length < 9 || skills.length < 18) return null;

  // Canonically rank the complete supported pool before feeding it to the
  // bounded beam. Do not trim within the 15-hero game contract: a low-weight
  // hero can still form a top trio through HP/HS synergy or provide camp
  // metadata. Out-of-contract input is deterministically capped before any
  // combination generation.
  const rankedHeroes = [...heroes].sort((a, b) => {
    const wa = weightOf(m, heroId(a));
    const wb = weightOf(m, heroId(b));
    if (wb !== wa) return wb - wa;
    return a.localeCompare(b);
  });
  const pool = rankedHeroes.slice(0, FORMATION_HERO_POOL_CAP);

  const knownTeamIndex = teamComps
    ? buildKnownTeamIndex(
        teamComps,
        new Set(pool),
        new Set(skills),
        catalog
      )
    : undefined;
  const partitions = knownTeamIndex
    ? enumerateHybridFormationPartitions(
        pool,
        m,
        heroMeta,
        knownTeamIndex
      )
    : enumerateFormationPartitions(pool, m, heroMeta);

  return {
    m,
    skills,
    catalog,
    heroMeta,
    partitions,
    knownTeamIndex,
    knownPreferenceCache: new Map(),
    preferKnownTeams: teamComps !== undefined,
  };
}

function evaluateFormationPartition(
  search: FormationSearch,
  trios: [string[], string[], string[]]
): FormationCandidate | null {
  const knownPreferences = search.knownTeamIndex
    ? selectKnownPreferences(
        trios,
        search.knownTeamIndex,
        search.skills,
        search.catalog,
        search.knownPreferenceCache
      )
    : [];
  const projected = projectFormation(
    trios,
    search.skills,
    search.m,
    search.catalog,
    knownPreferences
  );
  if (!projected) return null;
  const { teams, strengths } = projected;
  const sorted = [...strengths].sort((a, b) => b - a);
  return {
    teams,
    sorted,
    topTwoSum: sorted[0] + sorted[1],
    thirdStrength: sorted[2],
    totalStrength: strengths.reduce((a, b) => a + b, 0),
    structure: structureScore(trios, search.heroMeta),
    key: partitionKey(trios),
    guide: guideCandidateScore(teams),
  };
}

function finishFormationRecommendation(
  candidates: FormationCandidate[],
  search: FormationSearch
): FormationRecommendation {
  if (candidates.length === 0) return incompleteFormationRecommendation();

  // Hybrid stage 1: database coverage is lexicographically primary. Model-only
  // callers give every candidate the same empty guide score and remain exactly
  // equivalent to the original search.
  let eligible = candidates;
  if (search.preferKnownTeams) {
    const bestGuide = [...candidates]
      .map(({ guide }) => guide)
      .sort(compareGuideCandidateScores)[0];
    eligible = candidates.filter(
      ({ guide }) =>
        compareGuideCandidateScores(guide, bestGuide) === 0
    );
  }

  // Stage 2: true global band. Find the single absolute-maximum top-two sum,
  // retain every candidate whose top-two sum is no more than TOP_TWO_BAND
  // *display points* below that maximum, then rank the retained set with the
  // pure lexicographic comparator (same-camp, then third team, total, key).
  // This is order-independent: the band is fixed once against a global anchor,
  // never applied pairwise.
  const maxTopTwo = Math.max(...eligible.map((c) => c.topTwoSum));
  const bandRaw = TOP_TWO_BAND / 10; // display points → raw units
  const retained = eligible.filter(
    (candidate) =>
      candidate.topTwoSum >= maxTopTwo - bandRaw - 1e-9
  );
  retained.sort(compareCandidates);

  // Keep every surfaced option inside the same 2.5-display-point top-two band
  // as the recommended winner. This avoids trading away meaningful main-team
  // strength merely to make alternatives look different. The retained array is
  // already comparator-ranked with the winner first.
  const rankedFromWinner = retained;

  // Option one is the winner. Options two and three come from a deterministic
  // diversity selection over the ranked set — distinct canonical partition keys,
  // minimal hero overlap. When fewer than three distinct feasible candidates
  // exist, only those available are returned.
  const options = selectDiverseOptions(rankedFromWinner, search.m, search.catalog);

  return {
    options,
    incomplete: false,
  };
}

function runFormationSearch(search: FormationSearch): FormationRecommendation {
  const candidates: FormationCandidate[] = [];
  for (const trios of search.partitions) {
    const candidate = evaluateFormationPartition(search, trios);
    if (candidate) candidates.push(candidate);
  }
  return finishFormationRecommendation(candidates, search);
}

export function recommendTeams(
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData,
  catalog: RecommendationCatalog,
  heroMeta: HeroMeta = {}
): FormationRecommendation {
  const search = prepareFormationSearch(
    heroPool,
    skillPool,
    data,
    catalog,
    heroMeta
  );
  return search
    ? runFormationSearch(search)
    : incompleteFormationRecommendation();
}

interface ConfidentFeature {
  weight: number;
  support: number;
}

export const teamBuilderConfidenceSupport = (
  m: PairedModel,
  family: string
): number =>
  TEAM_BUILDER_SUPPORT_MULTIPLIER *
  (family === F_HERO || family === F_SKILL
    ? m.min_support_single
    : family === F_HERO_TRIO || family === F_TEAM_SKILL_TRIPLE
      ? (m.min_support_high_order ?? m.min_support_pair)
      : family === F_HERO_PAIR || family === F_HERO_SKILL || family === F_SKILL_PAIR
        ? m.min_support_pair
        : (m.min_support_context ?? m.min_support_pair));

export const isConfidentDisplayFeature = (
  weight: number,
  support: number,
  minimumSupport: number
): boolean =>
  support >= minimumSupport &&
  displayScore(weight) >= TEAM_BUILDER_VISIBLE_DISPLAY_GAIN;

const isSupportedTeamBuilderFeature = (
  _weight: number,
  support: number,
  minimumSupport: number
): boolean => support >= minimumSupport;

function confidentFeature(
  m: PairedModel,
  featureId: string
): ConfidentFeature | null {
  const weight = weightOf(m, featureId);
  const support = supportOf(m, featureId);
  const family = featureId.split('|')[0];
  return isSupportedTeamBuilderFeature(
    weight,
    support,
    teamBuilderConfidenceSupport(m, family)
  )
    ? { weight, support }
    : null;
}

interface ConfidentHeroGroup {
  heroes: string[];
  gain: number;
  support: number;
  key: string;
  mask: number;
}

function confidentHeroGroups(
  heroes: string[],
  size: 2 | 3,
  m: PairedModel
): ConfidentHeroGroup[] {
  const indexByHero = new Map(heroes.map((hero, index) => [hero, index]));
  const combinations =
    size === 3
      ? combinations3(heroes)
      : heroes.flatMap((first, firstIndex) =>
          heroes
            .slice(firstIndex + 1)
            .map((second) => [first, second])
        );
  const groups: ConfidentHeroGroup[] = [];
  for (const group of combinations) {
    let gain = 0;
    let support = 0;
    let confident = true;
    for (const hero of group) {
      const feature = confidentFeature(m, heroId(hero));
      if (!feature) {
        confident = false;
        break;
      }
      gain += feature.weight;
      support += feature.support;
    }
    if (!confident) continue;
    for (let first = 0; first < group.length; first += 1) {
      for (let second = first + 1; second < group.length; second += 1) {
        const feature = confidentFeature(
          m,
          heroPairId(group[first], group[second])
        );
        if (!feature) {
          confident = false;
          break;
        }
        gain += feature.weight;
        support += feature.support;
      }
      if (!confident) break;
    }
    if (!confident) continue;
    const sorted = [...group].sort();
    groups.push({
      heroes: sorted,
      gain,
      support,
      key: sorted.join('|'),
      mask: sorted.reduce(
        (mask, hero) => mask | (1 << indexByHero.get(hero)!),
        0
      ),
    });
  }
  // The game contract caps the pool at 15 heroes, so keep every qualified
  // group. Candidate-set bounding happens only after exact guide matches have
  // been attached, preventing a gain cutoff from discarding a curated core.
  return groups.sort((left, right) =>
    right.gain !== left.gain
      ? right.gain - left.gain
      : right.support !== left.support
        ? right.support - left.support
        : left.key.localeCompare(right.key)
  );
}

interface ConservativeGuideMatch {
  comp: TeamComp;
  matchedHeroes: string[];
  potentialSkillSlots: number;
}

const CONSERVATIVE_GUIDE_MATCH_RANKING_ORDER = [
  'higher matched hero count',
  'higher evidence-qualified skill-slot count',
  'championship source before non-championship source',
  'higher guide ranking score (S=3, A=2, other=1)',
  'lower stable guide ID by locale order',
];

const compareConservativeGuideMatches = (
  left: ConservativeGuideMatch,
  right: ConservativeGuideMatch
): number => {
  if (left.matchedHeroes.length !== right.matchedHeroes.length)
    return right.matchedHeroes.length - left.matchedHeroes.length;
  if (left.potentialSkillSlots !== right.potentialSkillSlots)
    return right.potentialSkillSlots - left.potentialSkillSlots;
  const championshipDelta =
    Number(isChampionshipComp(right.comp)) -
    Number(isChampionshipComp(left.comp));
  if (championshipDelta !== 0) return championshipDelta;
  const rankingDelta =
    teamRankingScore(right.comp.ranking) -
    teamRankingScore(left.comp.ranking);
  if (rankingDelta !== 0) return rankingDelta;
  return left.comp.id.localeCompare(right.comp.id);
};

const conservativeGuideMatchCandidateDebug = (
  candidate: ConservativeGuideMatch
): FormationGuideMatchCandidateDebug => ({
  guideId: candidate.comp.id,
  matchedHeroes: [...candidate.matchedHeroes],
  matchedHeroCount: candidate.matchedHeroes.length,
  qualifiedSkillSlotCount: candidate.potentialSkillSlots,
  championship: isChampionshipComp(candidate.comp),
  ranking: candidate.comp.ranking,
  rankingScore: teamRankingScore(candidate.comp.ranking),
  stableId: candidate.comp.id,
});

const CONSERVATIVE_GUIDE_MATCH_REJECTED_LIMIT = 4;

const conservativeGuideMatchDecisionDebug = (
  selected: ConservativeGuideMatch,
  teamComps: TeamComp[],
  heroes: string[],
  skillPool: Set<string>,
  catalog: RecommendationCatalog,
  m: PairedModel
): FormationGuideMatchDecisionDebug => {
  const selectedId = selected.comp.id;
  const candidates = conservativeGuideMatchCandidates(
    heroes,
    teamComps,
    skillPool,
    catalog,
    m
  );
  const rejected = candidates.filter(({ comp }) => comp.id !== selectedId);
  return {
    rankingOrder: [...CONSERVATIVE_GUIDE_MATCH_RANKING_ORDER],
    selected: conservativeGuideMatchCandidateDebug(selected),
    rejectedCandidateLimit: CONSERVATIVE_GUIDE_MATCH_REJECTED_LIMIT,
    rejected: rejected
      .slice(0, CONSERVATIVE_GUIDE_MATCH_REJECTED_LIMIT)
      .map(conservativeGuideMatchCandidateDebug),
    omittedRejectedCount: Math.max(
      0,
      rejected.length - CONSERVATIVE_GUIDE_MATCH_REJECTED_LIMIT
    ),
  };
};

const isConfidentGuideSkillRoute = (
  m: PairedModel,
  hero: string,
  skill: string
): boolean =>
  confidentFeature(m, skillId(skill)) !== null &&
  confidentFeature(m, heroSkillId(hero, skill)) !== null;

/**
 * Annotate an already model-selected pair/trio with its best guide source.
 * Guide data never places a hero: at least two members must already have
 * independently cleared H and every within-group HP confidence gate.
 */
function conservativeGuideMatchCandidates(
  heroes: string[],
  teamComps: TeamComp[],
  skillPool: Set<string>,
  catalog: RecommendationCatalog,
  m: PairedModel
): ConservativeGuideMatch[] {
  const heroSet = new Set(heroes);
  return teamComps
    .flatMap((comp) => {
      const matchedMembers = comp.members.filter(({ hero }) => heroSet.has(hero));
      if (matchedMembers.length < 2) return [];
      const matchedHeroes = matchedMembers.map(({ hero }) => hero);
      const potentialSkillSlots = matchedMembers.reduce(
        (count, member) =>
          count +
          member.skillSlots.filter((alternatives) =>
            alternatives.some(
              (skill) =>
                skillPool.has(skill) &&
                skill !== catalog.default_skill[member.hero] &&
                isConfidentGuideSkillRoute(m, member.hero, skill)
            )
          ).length,
        0
      );
      return [{ comp, matchedHeroes, potentialSkillSlots }];
    })
    .sort(compareConservativeGuideMatches);
}

function bestConservativeGuideMatch(
  heroes: string[],
  teamComps: TeamComp[],
  skillPool: Set<string>,
  catalog: RecommendationCatalog,
  m: PairedModel
): ConservativeGuideMatch | undefined {
  return conservativeGuideMatchCandidates(
    heroes,
    teamComps,
    skillPool,
    catalog,
    m
  )[0];
}

interface ConservativeTeamGroup {
  group: ConfidentHeroGroup;
  guide?: ConservativeGuideMatch;
  /** Exact 3/3 guide core with at least one owned, evidence-qualified guide slot. */
  prioritizedExactGuide: boolean;
}

interface ConservativeGroupSelection {
  groups: ConservativeTeamGroup[];
  usedMask: number;
  exactGuideIds: string[];
  heroGain: number;
  heroSupport: number;
  heroesPlaced: number;
  completeTrios: number;
  key: string;
}

/**
 * Keep the mixed pair/trio search bounded while reserving the best extension
 * for every exact-guide core. The final winner is chosen only after the
 * globally unique skill assignment has produced a full model score.
 */
const CONSERVATIVE_SELECTION_BEAM_CAP = 64;

const CONSERVATIVE_SELECTION_PROXY_RANKING_ORDER = [
  'more usable exact 3/3 guide cores',
  'higher unassigned hero model gain',
  'more heroes placed',
  'more complete trios',
  'higher hero evidence support',
  'lower stable canonical key by locale order',
];

const exactGuideIdsFor = (groups: ConservativeTeamGroup[]): string[] =>
  groups
    .filter(({ prioritizedExactGuide }) => prioritizedExactGuide)
    .map(({ guide }) => guide!.comp.id)
    .sort();

function makeConservativeGroupSelection(
  groups: ConservativeTeamGroup[],
  usedMask: number
): ConservativeGroupSelection {
  const ordered = [...groups].sort((left, right) =>
    left.group.key.localeCompare(right.group.key)
  );
  return {
    groups: ordered,
    usedMask,
    exactGuideIds: exactGuideIdsFor(ordered),
    heroGain: ordered.reduce((sum, { group }) => sum + group.gain, 0),
    heroSupport: ordered.reduce((sum, { group }) => sum + group.support, 0),
    heroesPlaced: ordered.reduce(
      (sum, { group }) => sum + group.heroes.length,
      0
    ),
    completeTrios: ordered.filter(({ group }) => group.heroes.length === 3)
      .length,
    key: ordered.map(({ group }) => group.key).join('||'),
  };
}

const conservativeSelectionProxyDebug = (
  selection: ConservativeGroupSelection
): FormationSelectionProxyDebug => ({
  exactGuideCount: selection.exactGuideIds.length,
  heroGain: selection.heroGain,
  heroesPlaced: selection.heroesPlaced,
  completeTrios: selection.completeTrios,
  heroSupport: selection.heroSupport,
  canonicalKey: selection.key,
});

/** Proxy ordering for the bounded search; final ordering uses assigned skills. */
function compareConservativeSelectionProxy(
  left: ConservativeGroupSelection,
  right: ConservativeGroupSelection
): number {
  if (left.exactGuideIds.length !== right.exactGuideIds.length)
    return right.exactGuideIds.length - left.exactGuideIds.length;
  if (Math.abs(left.heroGain - right.heroGain) > 1e-9)
    return right.heroGain - left.heroGain;
  if (left.heroesPlaced !== right.heroesPlaced)
    return right.heroesPlaced - left.heroesPlaced;
  if (left.completeTrios !== right.completeTrios)
    return right.completeTrios - left.completeTrios;
  if (left.heroSupport !== right.heroSupport)
    return right.heroSupport - left.heroSupport;
  return left.key.localeCompare(right.key);
}

function capConservativeSelections(
  selections: ConservativeGroupSelection[],
  depth: number
): {
  retained: ConservativeGroupSelection[];
  debug: FormationBeamPruningDebug;
} {
  const ordered = [...selections].sort(compareConservativeSelectionProxy);
  const proxyRank = new Map(
    ordered.map((selection, index) => [selection.key, index + 1])
  );
  if (ordered.length <= CONSERVATIVE_SELECTION_BEAM_CAP) {
    return {
      retained: ordered,
      debug: {
        depth,
        preCapCount: ordered.length,
        retainedCount: ordered.length,
        nominalCap: CONSERVATIVE_SELECTION_BEAM_CAP,
        effectiveCap: CONSERVATIVE_SELECTION_BEAM_CAP,
        proxyRankingOrder: [...CONSERVATIVE_SELECTION_PROXY_RANKING_ORDER],
        nominalCutoff: null,
        retainedCutoff: ordered.length
          ? conservativeSelectionProxyDebug(ordered.at(-1)!)
          : null,
        exactGuideReservations: [],
        retainedOnlyByReservationCount: 0,
      },
    };
  }

  // A low raw-weight exact team must not disappear merely because a different
  // exact or model-only core sorts above it. Keep one best extension containing
  // every exact guide ID, then fill the remaining beam by proxy strength. The
  // reserve is still bounded by the at-most-455 qualified trios in a 15-hero
  // pool, rather than by the combinatorial number of guide-ID sets.
  const reserved = new Map<string, ConservativeGroupSelection>();
  for (const selection of ordered) {
    for (const guideId of selection.exactGuideIds) {
      if (!reserved.has(guideId)) reserved.set(guideId, selection);
    }
  }
  const picked = [...new Map(
    [...reserved.values()].map((selection) => [selection.key, selection])
  ).values()];
  const pickedKeys = new Set(picked.map(({ key }) => key));
  const effectiveCap = Math.max(
    CONSERVATIVE_SELECTION_BEAM_CAP,
    reserved.size
  );
  for (const selection of ordered) {
    if (picked.length >= effectiveCap) break;
    if (pickedKeys.has(selection.key)) continue;
    picked.push(selection);
    pickedKeys.add(selection.key);
  }
  const retained = picked.sort(compareConservativeSelectionProxy);
  const exactGuideReservations = [...reserved.entries()].map(
    ([guideId, selection]) => ({
      guideId,
      canonicalKey: selection.key,
      proxyRank: proxyRank.get(selection.key)!,
      outsideNominalCutoff:
        proxyRank.get(selection.key)! > CONSERVATIVE_SELECTION_BEAM_CAP,
    })
  );
  return {
    retained,
    debug: {
      depth,
      preCapCount: ordered.length,
      retainedCount: retained.length,
      nominalCap: CONSERVATIVE_SELECTION_BEAM_CAP,
      effectiveCap,
      proxyRankingOrder: [...CONSERVATIVE_SELECTION_PROXY_RANKING_ORDER],
      nominalCutoff: conservativeSelectionProxyDebug(
        ordered[CONSERVATIVE_SELECTION_BEAM_CAP - 1]
      ),
      retainedCutoff: retained.length
        ? conservativeSelectionProxyDebug(retained.at(-1)!)
        : null,
      exactGuideReservations,
      retainedOnlyByReservationCount: new Set(
        exactGuideReservations
          .filter(({ outsideNominalCutoff }) => outsideNominalCutoff)
          .map(({ canonicalKey }) => canonicalKey)
      ).size,
    },
  };
}

/** Enumerate bounded, disjoint selections of one to three mixed pairs/trios. */
function enumerateConservativeGroupSelections(
  candidateGroups: ConservativeTeamGroup[],
  consideredHeroes: string[]
): {
  selections: ConservativeGroupSelection[];
  beamPruning: FormationBeamPruningDebug[];
  heroReachability: FormationHeroSearchReachabilityDebug[];
} {
  const candidates = [...candidateGroups].sort((left, right) =>
    left.group.key.localeCompare(right.group.key)
  );
  let frontier: ConservativeGroupSelection[] = [
    makeConservativeGroupSelection([], 0),
  ];
  const selections: ConservativeGroupSelection[] = [];
  const beamPruning: FormationBeamPruningDebug[] = [];
  const heroReachability = consideredHeroes.map((hero) => ({
    hero,
    qualifiedGroupCount: candidates.filter(({ group }) =>
      group.heroes.includes(hero)
    ).length,
    reachedFinalEvaluation: false,
    depths: [] as FormationHeroBeamDepthDebug[],
  }));

  for (let depth = 0; depth < 3; depth += 1) {
    const nextByKey = new Map<string, ConservativeGroupSelection>();
    for (const selection of frontier) {
      for (const candidate of candidates) {
        if ((selection.usedMask & candidate.group.mask) !== 0) continue;
        const extended = makeConservativeGroupSelection(
          [...selection.groups, candidate],
          selection.usedMask | candidate.group.mask
        );
        nextByKey.set(extended.key, extended);
      }
    }
    const generated = [...nextByKey.values()];
    const capped = capConservativeSelections(generated, depth + 1);
    const reservedKeys = new Set(
      capped.debug.exactGuideReservations.map(({ canonicalKey }) => canonicalKey)
    );
    const generatedCounts = new Map(
      consideredHeroes.map((hero) => [hero, 0])
    );
    const retainedCounts = new Map(
      consideredHeroes.map((hero) => [hero, 0])
    );
    const reservedCounts = new Map(
      consideredHeroes.map((hero) => [hero, 0])
    );
    const countContainingHeroes = (
      selection: ConservativeGroupSelection,
      counts: Map<string, number>
    ) => {
      for (const { group } of selection.groups) {
        for (const hero of group.heroes) {
          counts.set(hero, (counts.get(hero) ?? 0) + 1);
        }
      }
    };
    for (const selection of generated) {
      countContainingHeroes(selection, generatedCounts);
    }
    for (const selection of capped.retained) {
      countContainingHeroes(selection, retainedCounts);
      if (reservedKeys.has(selection.key)) {
        countContainingHeroes(selection, reservedCounts);
      }
    }
    for (const reachability of heroReachability) {
      const generatedContainingSelectionCount =
        generatedCounts.get(reachability.hero) ?? 0;
      const retainedContainingSelectionCount =
        retainedCounts.get(reachability.hero) ?? 0;
      const reservedContainingSelectionCount =
        reservedCounts.get(reachability.hero) ?? 0;
      reachability.depths.push({
        depth: depth + 1,
        generatedContainingSelectionCount,
        retainedContainingSelectionCount,
        reservedContainingSelectionCount,
        entirelyProxyPruned:
          generatedContainingSelectionCount > 0 &&
          retainedContainingSelectionCount === 0,
      });
      if (retainedContainingSelectionCount > 0) {
        reachability.reachedFinalEvaluation = true;
      }
    }
    frontier = capped.retained;
    beamPruning.push(capped.debug);
    if (frontier.length === 0) break;
    selections.push(...frontier);
  }

  return { selections, beamPruning, heroReachability };
}

interface ConservativeHeroPlacement {
  name: string;
  slotIndex: number;
}

function placeConservativeTeamHeroes(
  heroes: string[],
  guide?: ConservativeGuideMatch
): ConservativeHeroPlacement[] {
  if (!guide) {
    return [...heroes]
      .sort()
      .map((name, slotIndex) => ({ name, slotIndex }));
  }
  const slotByHero = new Map(
    guide.comp.members.map(({ hero }, slotIndex) => [hero, slotIndex])
  );
  const placements: ConservativeHeroPlacement[] = [];
  const usedSlots = new Set<number>();
  for (const hero of guide.matchedHeroes) {
    const slotIndex = slotByHero.get(hero);
    if (slotIndex === undefined) continue;
    placements.push({ name: hero, slotIndex });
    usedSlots.add(slotIndex);
  }
  const openSlots = [0, 1, 2].filter((slot) => !usedSlots.has(slot));
  const fallbackHeroes = heroes
    .filter((hero) => !slotByHero.has(hero))
    .sort();
  fallbackHeroes.forEach((name, index) => {
    const slotIndex = openSlots[index];
    if (slotIndex !== undefined) placements.push({ name, slotIndex });
  });
  return placements.sort((left, right) => left.slotIndex - right.slotIndex);
}

type ConservativeSkillSlots = [string | null, string | null];

interface ConservativeGuideSkillSlot extends KnownSkillSlot {
  matchedHeroCount: number;
  potentialSkillSlots: number;
  championship: boolean;
  rankingScore: number;
}

function compareConservativeGuideSkillSlots(
  left: ConservativeGuideSkillSlot,
  right: ConservativeGuideSkillSlot
): number {
  if (left.matchedHeroCount !== right.matchedHeroCount)
    return right.matchedHeroCount - left.matchedHeroCount;
  if (left.potentialSkillSlots !== right.potentialSkillSlots)
    return right.potentialSkillSlots - left.potentialSkillSlots;
  if (left.championship !== right.championship)
    return Number(right.championship) - Number(left.championship);
  if (left.rankingScore !== right.rankingScore)
    return right.rankingScore - left.rankingScore;
  return left.key.localeCompare(right.key);
}

/**
 * Build guide claims only for heroes actually present in a qualified 2/3 or
 * 3/3 core. Every alternative still has to clear its atomic S and hero-skill
 * HS gates. Exact cores outrank partial cores when two guide slots compete for
 * one owned skill; model gain orders alternatives within the same guide slot.
 */
function conservativeGuideSkillSlots(
  teamGroups: ConservativeTeamGroup[],
  skillPool: Set<string>,
  m: PairedModel,
  catalog: RecommendationCatalog
): ConservativeGuideSkillSlot[] {
  const slots = teamGroups.flatMap(({ group, guide }, teamIndex) => {
    if (!guide) return [];
    const matchedHeroes = new Set(guide.matchedHeroes);
    return guide.comp.members.flatMap((member) => {
      if (!matchedHeroes.has(member.hero)) return [];
      return member.skillSlots.map((alternatives, slotIndex) => {
        const eligible = alternatives
          .filter(
            (skill) =>
              skillPool.has(skill) &&
              skill !== catalog.default_skill[member.hero] &&
              isConfidentGuideSkillRoute(m, member.hero, skill)
          )
          .sort((left, right) => {
            const leftGain =
              weightOf(m, skillId(left)) +
              weightOf(m, heroSkillId(member.hero, left));
            const rightGain =
              weightOf(m, skillId(right)) +
              weightOf(m, heroSkillId(member.hero, right));
            if (Math.abs(leftGain - rightGain) > 1e-9)
              return rightGain - leftGain;
            const leftSupport =
              supportOf(m, skillId(left)) +
              supportOf(m, heroSkillId(member.hero, left));
            const rightSupport =
              supportOf(m, skillId(right)) +
              supportOf(m, heroSkillId(member.hero, right));
            return leftSupport !== rightSupport
              ? rightSupport - leftSupport
              : left.localeCompare(right);
          });
        return {
          key: `conservative|${teamIndex}|${guide.comp.id}|${member.hero}|${slotIndex}`,
          teamKey: group.key,
          hero: member.hero,
          slotIndex,
          alternatives: eligible,
          matchedHeroCount: guide.matchedHeroes.length,
          potentialSkillSlots: guide.potentialSkillSlots,
          championship: isChampionshipComp(guide.comp),
          rankingScore: teamRankingScore(guide.comp.ranking),
        };
      });
    });
  });
  return slots
    .filter(({ alternatives }) => alternatives.length > 0)
    .sort(compareConservativeGuideSkillSlots);
}

interface ConservativeSkillCandidate {
  hero: string;
  additions: string[];
  gain: number;
  support: number;
  key: string;
}

function compareConservativeSkillCandidates(
  left: ConservativeSkillCandidate,
  right: ConservativeSkillCandidate
): number {
  if (Math.abs(left.gain - right.gain) > 1e-9)
    return right.gain - left.gain;
  if (left.support !== right.support) return right.support - left.support;
  return left.key.localeCompare(right.key);
}

const CONSERVATIVE_GUIDE_SLOT_REJECTED_LIMIT = 4;
const CONSERVATIVE_MODEL_ROUTE_REJECTED_LIMIT = 4;

interface ConservativeSkillAssignmentResult {
  assignments: Map<string, ConservativeSkillSlots>;
  debug?: FormationSkillRoutingDebug;
}

function assignConservativeSkills(
  teamGroups: ConservativeTeamGroup[],
  skillPool: string[],
  m: PairedModel,
  catalog: RecommendationCatalog,
  captureDebug = false
): ConservativeSkillAssignmentResult {
  const heroes = teamGroups.flatMap(({ group }) => group.heroes);
  const heroSet = new Set(heroes);
  const availableSkills = new Set(skillPool);
  const assigned = new Map<string, ConservativeSkillSlots>(
    heroes.map((hero) => [hero, [null, null]])
  );
  const usedSkills = new Set<string>();

  // Guide policy wins among routes that passed the same evidence gates as
  // model-only placements. Match all selected 2/3 and 3/3 cores together so a
  // unique owned skill is never reserved twice; absent guide heroes make no
  // claims. The remaining open slots are filled by the model loop below.
  const guideSlots = conservativeGuideSkillSlots(
    teamGroups,
    availableSkills,
    m,
    catalog
  );
  const guideSlotByKey = new Map(guideSlots.map((slot) => [slot.key, slot]));
  const guideMatchingResult = maximumKnownSlotMatching(guideSlots, captureDebug);
  const guideMatching = guideMatchingResult.assignments;
  const guideMatchingDebug = captureDebug
    ? guideSlots.map((slot) => {
        const selectedSkill = guideMatching.get(slot.key);
        const rejected = slot.alternatives.filter(
          (skill) => skill !== selectedSkill
        );
        const describeSkill = (
          skill: string
        ): FormationGuideSkillCandidateDebug => ({
          skill,
          gain:
            weightOf(m, skillId(skill)) +
            weightOf(m, heroSkillId(slot.hero, skill)),
          support:
            supportOf(m, skillId(skill)) +
            supportOf(m, heroSkillId(slot.hero, skill)),
          stableKey: skill,
        });
        return {
          slotKey: slot.key,
          hero: slot.hero,
          slotIndex: slot.slotIndex,
          priority: {
            matchedHeroCount: slot.matchedHeroCount,
            qualifiedSkillSlotCount: slot.potentialSkillSlots,
            championship: slot.championship,
            rankingScore: slot.rankingScore,
            stableKey: slot.key,
          },
          selected: selectedSkill ? describeSkill(selectedSkill) : null,
          rejectedCandidateLimit: CONSERVATIVE_GUIDE_SLOT_REJECTED_LIMIT,
          rejected: rejected
            .slice(0, CONSERVATIVE_GUIDE_SLOT_REJECTED_LIMIT)
            .map(describeSkill),
          omittedRejectedCount: Math.max(
            0,
            rejected.length - CONSERVATIVE_GUIDE_SLOT_REJECTED_LIMIT
          ),
        };
      })
    : undefined;
  for (const [slotKey, skill] of guideMatching) {
    const slot = guideSlotByKey.get(slotKey);
    if (!slot) continue;
    assigned.get(slot.hero)![slot.slotIndex] = skill;
    usedSkills.add(skill);
  }

  const guideByHero = new Map<string, ConservativeGuideMatch>();
  for (const { guide } of teamGroups) {
    if (!guide) continue;
    for (const hero of guide.matchedHeroes) guideByHero.set(hero, guide);
  }

  const preferredGuideSlot = (
    hero: string,
    skill: string,
    slots: ConservativeSkillSlots
  ): number | null => {
    const guide = guideByHero.get(hero);
    if (!guide) return null;
    const member = guide.comp.members.find(({ hero: name }) => name === hero);
    if (!member) return null;
    const slotIndex = member.skillSlots.findIndex(
      (alternatives, index) =>
        slots[index] === null && alternatives.includes(skill)
    );
    return slotIndex >= 0 ? slotIndex : null;
  };

  const modelRoutingSteps = captureDebug
    ? ([] as FormationSkillRoutingDebug['modelRouting']['steps'])
    : undefined;
  const candidateDebug = captureDebug
    ? (
        candidate: ConservativeSkillCandidate,
        sourceSlots: ConservativeSkillSlots
      ): FormationSkillRouteCandidateDebug => {
        const projected: ConservativeSkillSlots = [...sourceSlots];
        const placements = candidate.additions.flatMap((skill) => {
          const preferred = preferredGuideSlot(
            candidate.hero,
            skill,
            projected
          );
          const slotIndex = preferred ?? projected.indexOf(null);
          if (slotIndex < 0) return [];
          projected[slotIndex] = skill;
          return [
            {
              skill,
              slotIndex,
              preferredGuideSlot: preferred !== null,
            },
          ];
        });
        return {
          hero: candidate.hero,
          additions: [...candidate.additions],
          gain: candidate.gain,
          support: candidate.support,
          stableKey: candidate.key,
          placements,
        };
      }
    : undefined;

  const spFeatures = Object.entries(m.weights).flatMap(
    ([featureId]): { hero: string; first: string; second: string; feature: ConfidentFeature }[] => {
      const [family, hero, first, second] = featureId.split('|');
      if (family !== F_SKILL_PAIR || !heroSet.has(hero) || !first || !second)
        return [];
      const feature = confidentFeature(m, featureId);
      return feature ? [{ hero, first, second, feature }] : [];
    }
  );

  while (true) {
    const candidates: ConservativeSkillCandidate[] = [];
    for (const hero of heroes) {
      const slots = assigned.get(hero)!;
      const current = new Set(
        slots.filter((skill): skill is string => skill !== null)
      );
      const openSlots = slots.filter((skill) => skill === null).length;
      if (openSlots === 0) continue;
      const signature = catalog.default_skill[hero];

      for (const skill of availableSkills) {
        if (skill === signature || usedSkills.has(skill)) continue;
        const skillFeature = confidentFeature(m, skillId(skill));
        const heroSkillFeature = confidentFeature(
          m,
          heroSkillId(hero, skill)
        );
        if (!skillFeature || !heroSkillFeature) continue;
        const supportedPairs = [...current]
          .map((other) => confidentFeature(m, skillPairId(hero, skill, other)))
          .filter((feature): feature is ConfidentFeature => feature !== null);
        candidates.push({
          hero,
          additions: [skill],
          gain:
            skillFeature.weight +
            heroSkillFeature.weight +
            supportedPairs.reduce((sum, feature) => sum + feature.weight, 0),
          support:
            skillFeature.support +
            heroSkillFeature.support +
            supportedPairs.reduce((sum, feature) => sum + feature.support, 0),
          key: `${hero}|HS|${skill}`,
        });
      }

      for (const { hero: featureHero, first, second, feature } of spFeatures) {
        if (featureHero !== hero) continue;
        if (
          first === signature ||
          second === signature ||
          !availableSkills.has(first) ||
          !availableSkills.has(second)
        ) {
          continue;
        }
        const pair = [first, second];
        const additions = pair.filter((skill) => !current.has(skill));
        if (
          additions.length === 0 ||
          additions.length > openSlots ||
          additions.some((skill) => {
            if (usedSkills.has(skill)) return true;
            return (
              confidentFeature(m, skillId(skill)) === null ||
              confidentFeature(m, heroSkillId(hero, skill)) === null
            );
          })
        ) {
          continue;
        }
        let gain = feature.weight;
        let support = feature.support;
        for (const skill of additions) {
          const single = confidentFeature(m, skillId(skill))!;
          const hs = confidentFeature(m, heroSkillId(hero, skill))!;
          gain += single.weight + hs.weight;
          support += single.support + hs.support;
        }
        candidates.push({
          hero,
          additions: [...additions].sort(),
          gain,
          support,
          key: `${hero}|SP|${[first, second].sort().join('|')}`,
        });
      }
    }

    candidates.sort(compareConservativeSkillCandidates);
    const best = candidates[0];
    if (!best) break;
    const slots = assigned.get(best.hero)!;
    if (candidateDebug && modelRoutingSteps) {
      const selected = candidateDebug(best, slots);
      modelRoutingSteps.push({
        step: modelRoutingSteps.length + 1,
        candidateCount: candidates.length,
        selected,
        rejected: candidates
          .slice(1, CONSERVATIVE_MODEL_ROUTE_REJECTED_LIMIT + 1)
          .map((candidate) =>
            candidateDebug(candidate, assigned.get(candidate.hero)!)
          ),
        omittedRejectedCount: Math.max(
          0,
          candidates.length - 1 - CONSERVATIVE_MODEL_ROUTE_REJECTED_LIMIT
        ),
      });
      for (const { skill, slotIndex } of selected.placements) {
        slots[slotIndex] = skill;
        usedSkills.add(skill);
      }
      continue;
    }
    for (const skill of best.additions) {
      const slotIndex =
        preferredGuideSlot(best.hero, skill, slots) ?? slots.indexOf(null);
      if (slotIndex < 0) break;
      slots[slotIndex] = skill;
      usedSkills.add(skill);
    }
  }
  const result: ConservativeSkillAssignmentResult = {
    assignments: assigned,
  };
  if (captureDebug) {
    result.debug = {
      guideMatching: {
        slotRankingOrder: [
          'higher matched hero count',
          'higher evidence-qualified guide-slot count',
          'championship source before non-championship source',
          'higher guide ranking score',
          'lower stable slot key by locale order',
        ],
        alternativeRankingOrder: [
          'higher standalone S plus assigned-hero HS gain',
          'higher combined S plus HS support',
          'lower stable skill key by locale order',
        ],
        maximumCardinality: guideMatchingResult.debug!,
        slots: guideMatchingDebug!,
      },
      modelRouting: {
        rankingOrder: [
          'higher incremental model gain',
          'higher combined feature support',
          'lower stable route key by locale order',
        ],
        rejectedCandidateLimit: CONSERVATIVE_MODEL_ROUTE_REJECTED_LIMIT,
        steps: modelRoutingSteps!,
      },
    };
  }
  return result;
}

interface EvaluatedConservativeSelection {
  selection: ConservativeGroupSelection;
  teamGroups: ConservativeTeamGroup[];
  skillAssignments: Map<string, ConservativeSkillSlots>;
  skillRouting?: FormationSkillRoutingDebug;
  totalFormationGain: number;
  exactChampionshipTeams: number;
  exactRankingScore: number;
}

const orderConservativeTeamGroups = (
  groups: ConservativeTeamGroup[]
): ConservativeTeamGroup[] =>
  [...groups].sort((left, right) =>
    right.group.gain !== left.group.gain
      ? right.group.gain - left.group.gain
      : left.group.key.localeCompare(right.group.key)
  );

function evaluateConservativeSelection(
  selection: ConservativeGroupSelection,
  skills: string[],
  m: PairedModel,
  catalog: RecommendationCatalog,
  captureDebug = false
): EvaluatedConservativeSelection {
  const teamGroups = orderConservativeTeamGroups(selection.groups);
  const skillAssignment = assignConservativeSkills(
    teamGroups,
    skills,
    m,
    catalog,
    captureDebug
  );
  const skillAssignments = skillAssignment.assignments;
  const totalFormationGain = teamGroups.reduce(
    (sum, { group }) =>
      sum +
      scoreTeam(
        group.heroes.map((name) => ({
          name,
          skills: (skillAssignments.get(name) ?? [null, null]).filter(
            (skill): skill is string => skill !== null
          ),
        })),
        m,
        catalog
      ),
    0
  );
  const exactGroups = teamGroups.filter(
    ({ prioritizedExactGuide }) => prioritizedExactGuide
  );
  return {
    selection,
    teamGroups,
    skillAssignments,
    skillRouting: skillAssignment.debug,
    totalFormationGain,
    exactChampionshipTeams: exactGroups.filter(({ guide }) =>
      isChampionshipComp(guide!.comp)
    ).length,
    exactRankingScore: exactGroups.reduce(
      (sum, { guide }) => sum + teamRankingScore(guide!.comp.ranking),
      0
    ),
  };
}

/**
 * Final conservative ordering: usable exact guides and fully assigned model
 * strength both outrank how many heroes happened to fit into complete trios.
 */
function compareEvaluatedConservativeSelections(
  left: EvaluatedConservativeSelection,
  right: EvaluatedConservativeSelection
): number {
  if (
    left.selection.exactGuideIds.length !==
    right.selection.exactGuideIds.length
  ) {
    return (
      right.selection.exactGuideIds.length -
      left.selection.exactGuideIds.length
    );
  }
  if (Math.abs(left.totalFormationGain - right.totalFormationGain) > 1e-9)
    return right.totalFormationGain - left.totalFormationGain;
  if (left.exactChampionshipTeams !== right.exactChampionshipTeams)
    return right.exactChampionshipTeams - left.exactChampionshipTeams;
  if (left.exactRankingScore !== right.exactRankingScore)
    return right.exactRankingScore - left.exactRankingScore;
  if (left.selection.heroesPlaced !== right.selection.heroesPlaced)
    return right.selection.heroesPlaced - left.selection.heroesPlaced;
  if (left.selection.completeTrios !== right.selection.completeTrios)
    return right.selection.completeTrios - left.selection.completeTrios;
  if (left.selection.heroSupport !== right.selection.heroSupport)
    return right.selection.heroSupport - left.selection.heroSupport;
  return left.selection.key.localeCompare(right.selection.key);
}

function conservativeCandidateDebug(
  candidate: EvaluatedConservativeSelection,
  rank: number,
  teamComps: TeamComp[],
  skillPool: Set<string>,
  catalog: RecommendationCatalog,
  m: PairedModel
): FormationDebugCandidate {
  if (!candidate.skillRouting)
    throw new Error('Detailed candidate trace was not captured');
  return {
    rank,
    exactGuideIds: [...candidate.selection.exactGuideIds],
    totalModelGain: displayScore(candidate.totalFormationGain),
    rawTotalModelGain: candidate.totalFormationGain,
    exactChampionshipTeams: candidate.exactChampionshipTeams,
    exactRankingScore: candidate.exactRankingScore,
    heroesPlaced: candidate.selection.heroesPlaced,
    completeTrios: candidate.selection.completeTrios,
    heroSupport: candidate.selection.heroSupport,
    canonicalKey: candidate.selection.key,
    teams: candidate.teamGroups.map(({ group, guide, prioritizedExactGuide }) => ({
      heroes: [...group.heroes],
      skills: Object.fromEntries(
        group.heroes.map((hero) => [
          hero,
          [...(candidate.skillAssignments.get(hero) ?? [null, null])] as [
            string | null,
            string | null,
          ],
        ])
      ),
      ...(guide
        ? {
            guideId: guide.comp.id,
            guideMatchDecision: conservativeGuideMatchDecisionDebug(
              guide,
              teamComps,
              group.heroes,
              skillPool,
              catalog,
              m
            ),
          }
        : {}),
      prioritizedExactGuide,
    })),
    skillRouting: candidate.skillRouting,
  };
}

function buildConfidentTeamEvidence(
  team: AssignedHero[],
  m: PairedModel,
  catalog: RecommendationCatalog
): TeamEvidence {
  const displayFamilies = new Set([
    F_HERO_PAIR, F_HERO_SKILL, F_SKILL_PAIR, F_TEAM_HERO_SKILL,
    F_TEAM_SKILL_PAIR, F_HERO_TRIO, F_CAMP, F_BOND, F_MECH,
    F_HERO_MECH, F_TEAM_SKILL_TRIPLE,
  ]);
  const active = activeTeamContributions(team, m, catalog).filter(
    ({ featureId, family }) =>
      displayFamilies.has(family) &&
      isConfidentDisplayFeature(
        weightOf(m, featureId),
        supportOf(m, featureId),
        teamBuilderConfidenceSupport(m, family)
      )
  );
  const pickMany = (families: string[]): EvidenceItem[] =>
    active
      .filter((contribution) => families.includes(contribution.family))
      .map((contribution) => ({
        label: labelFeature(contribution.featureId).label,
        gain: displayScore(contribution.weight),
        support: contribution.support,
      }))
      .slice(0, 2);
  return {
    heroSynergy: pickMany([F_HERO_PAIR, F_HERO_TRIO, F_CAMP, F_BOND]),
    heroSkill: pickMany([F_HERO_SKILL, F_TEAM_HERO_SKILL, F_HERO_MECH]),
    skillSynergy: pickMany([F_SKILL_PAIR, F_TEAM_SKILL_PAIR, F_TEAM_SKILL_TRIPLE, F_MECH]),
  };
}

/**
 * Evidence-only Team Builder policy. Every placed hero, skill, and relationship
 * must clear the model's support floor. Positive, zero, and negative
 * weights all remain eligible and affect ranking. Supported exact 3/3 guide
 * cores with at least one qualified owned guide skill are prioritized first;
 * fully assigned total model gain then ranks mixed pair/trio formations ahead
 * of complete-team count. Guide data preserves a qualified 2/3 or 3/3 core's
 * canonical hero slots and formation, then reserves owned, qualified guide
 * skills for matched heroes before model-only fallback; it never places an
 * absent guide hero or bypasses the evidence gates.
 */
function recommendConservativeHybridTeams(
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData,
  catalog: RecommendationCatalog,
  teamComps: TeamComp[]
): FormationRecommendation {
  const heroes = [...new Set(heroPool)];
  const skills = [...new Set(skillPool)];
  if (heroes.length < 9 || skills.length < 18)
    return incompleteFormationRecommendation();

  const m = model(data);
  const sortedHeroes = [...heroes].sort();
  const boundedHeroes = sortedHeroes.slice(0, FORMATION_HERO_POOL_CAP);
  const excludedHeroes = sortedHeroes
    .slice(FORMATION_HERO_POOL_CAP)
    .map((hero, index) => ({
      hero,
      sortedPoolRank: FORMATION_HERO_POOL_CAP + index + 1,
      reason: 'excluded_by_alphabetical_hero_pool_cap' as const,
    }));
  const skillSet = new Set(skills);
  const candidateGroups: ConservativeTeamGroup[] = [
    ...confidentHeroGroups(boundedHeroes, 3, m),
    ...confidentHeroGroups(boundedHeroes, 2, m),
  ].map((group) => {
    const guide = bestConservativeGuideMatch(
      group.heroes,
      teamComps,
      skillSet,
      catalog,
      m
    );
    return {
      group,
      guide,
      prioritizedExactGuide:
        guide !== undefined &&
        guide.matchedHeroes.length === 3 &&
        guide.potentialSkillSlots > 0,
    };
  });
  const selectionSearch = enumerateConservativeGroupSelections(
    candidateGroups,
    boundedHeroes
  );
  const evaluated = selectionSearch.selections
    .map((selection) =>
      evaluateConservativeSelection(selection, skills, m, catalog)
    )
    .sort(compareEvaluatedConservativeSelections);
  const detailedCandidates = evaluated.slice(0, 2).map((candidate) =>
    evaluateConservativeSelection(candidate.selection, skills, m, catalog, true)
  );
  const winner = detailedCandidates[0] ?? evaluated[0];
  const teamGroups = winner?.teamGroups ?? [];
  const skillAssignments =
    winner?.skillAssignments ?? new Map<string, ConservativeSkillSlots>();
  const teams: ProjectedTeam[] = teamGroups.map(({ group, guide }) => {
    const placements = placeConservativeTeamHeroes(group.heroes, guide);
    const assignedHeroes: AssignedHero[] = placements.map(({ name }) => ({
      name,
      skills: (skillAssignments.get(name) ?? [null, null]).filter(
        (skill): skill is string => skill !== null
      ),
    }));
    const matchedSkillSlots = guide
      ? guide.matchedHeroes.reduce((count, hero) => {
          const member = guide.comp.members.find(
            ({ hero: name }) => name === hero
          );
          const slots = skillAssignments.get(hero) ?? [null, null];
          if (!member) return count;
          return (
            count +
            member.skillSlots.filter(
              (alternatives, slotIndex) =>
                slots[slotIndex] !== null &&
                alternatives.includes(slots[slotIndex]!)
            ).length
          );
        }, 0)
      : 0;
    return {
      heroes: placements.map(({ name, slotIndex }) => {
        const skillSlots = skillAssignments.get(name) ?? [null, null];
        const assignedSkills = skillSlots.filter(
          (skill): skill is string => skill !== null
        );
        return {
          name,
          skills: assignedSkills,
          skillScore: displayScore(
            heroAssignedScore(name, assignedSkills, m)
          ),
          slotIndex,
          skillSlots: [...skillSlots],
        };
      }),
      strength: displayScore(scoreTeam(assignedHeroes, m, catalog)),
      evidence: buildConfidentTeamEvidence(assignedHeroes, m, catalog),
      ...(guide
        ? {
            formation: guide.comp.formation,
            knownTeam: {
              id: guide.comp.id,
              ranking: guide.comp.ranking,
              sources: [...guide.comp.sources],
              matchedHeroSlots: guide.matchedHeroes.length,
              totalHeroSlots: 3,
              matchedSkillSlots,
              totalSkillSlots: KNOWN_TEAM_SKILL_SLOTS,
            },
          }
        : {}),
    };
  });
  while (teams.length < 3) {
    teams.push({
      heroes: [],
      strength: 0,
      evidence: { heroSynergy: [], heroSkill: [], skillSynergy: [] },
    });
  }

  const debug: FormationDecisionDebug = {
    policy: 'evidence-only-team-builder',
    heroPoolCount: heroes.length,
    skillPoolCount: skills.length,
    heroPoolCap: FORMATION_HERO_POOL_CAP,
    boundedHeroCount: boundedHeroes.length,
    consideredHeroes: [...boundedHeroes],
    excludedHeroes,
    qualifiedHeroPairs: candidateGroups.filter(
      ({ group }) => group.heroes.length === 2
    ).length,
    qualifiedHeroTrios: candidateGroups.filter(
      ({ group }) => group.heroes.length === 3
    ).length,
    candidateSelectionsEvaluated: evaluated.length,
    prioritizedExactGuideCoreCount: candidateGroups.filter(
      ({ prioritizedExactGuide }) => prioritizedExactGuide
    ).length,
    rankingOrder: [
      'more usable exact 3/3 guide cores',
      'higher fully assigned total model gain',
      'more exact championship teams',
      'higher exact guide ranking score',
      'more heroes placed',
      'more complete trios',
      'higher hero evidence support',
      'stable canonical key',
    ],
    beamPruning: selectionSearch.beamPruning,
    heroSelectionReachability: selectionSearch.heroReachability,
    topCandidates: detailedCandidates.map((candidate, index) =>
      conservativeCandidateDebug(
        candidate,
        index + 1,
        teamComps,
        skillSet,
        catalog,
        m
      )
    ),
  };

  return { options: [{ teams }], incomplete: false, debug };
}

/**
 * Evidence-only Team Builder recommendation. Guide pairs/trios annotate
 * already-qualified model groups, preserve their canonical positions, and
 * reserve qualified skills for present guide heroes before model fallback;
 * unsupported positions stay blank.
 */
export function recommendHybridTeams(
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData,
  catalog: RecommendationCatalog,
  heroMeta: HeroMeta,
  teamComps: TeamComp[]
): FormationRecommendation {
  void heroMeta;
  return recommendConservativeHybridTeams(
    heroPool,
    skillPool,
    data,
    catalog,
    teamComps
  );
}

export interface CooperativeFormationOptions {
  batchSize?: number;
  shouldCancel?: () => boolean;
  yieldControl?: () => Promise<void>;
}

/**
 * Main-thread safety fallback for browsers where a module worker cannot start.
 * It evaluates the same deterministic hybrid search in small batches and
 * yields between them so loading UI and navigation remain responsive.
 */
export async function recommendHybridTeamsCooperatively(
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData,
  catalog: RecommendationCatalog,
  heroMeta: HeroMeta,
  teamComps: TeamComp[],
  options: CooperativeFormationOptions = {}
): Promise<FormationRecommendation> {
  void heroMeta;
  void options.batchSize;
  if (options.shouldCancel?.()) return incompleteFormationRecommendation();
  const yieldControl =
    options.yieldControl ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  await yieldControl();
  if (options.shouldCancel?.()) return incompleteFormationRecommendation();
  return recommendConservativeHybridTeams(
    heroPool,
    skillPool,
    data,
    catalog,
    teamComps
  );
}

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

export interface TopSynergy {
  label: string;
  family: string;
  weight: number;
  support: number;
}

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
  /** Strongest fitted hero-pair synergies. */
  top_hero_pairs: TopSynergy[];
  /** Strongest fitted hero-skill assignments. */
  top_hero_skills: TopSynergy[];
}

/**
 * Build the Analytics-page payload from the generated artifact. The `heroes` and
 * `skills` rankings are returned sorted by descending relative roster-strength
 * (`强度加成`), with deterministic tie-breakers (descending reference battles,
 * then name) so consumers can render them directly. The model column still exposes
 * each item's full-precision relative roster-strength
 * weight, and the smoothed-win-rate / reference-battle columns remain available.
 * Usage and synergy rankings keep their own orderings. Backtest metrics surface
 * model quality.
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

  // Rank both lists by 强度加成 (relative roster strength) descending, with
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

  const collectFamily = (prefix: string, limit: number): TopSynergy[] =>
    (Object.entries(m.weights) as [string, number][])
      .filter(([fid]) => fid.startsWith(prefix))
      .sort((x, y) => y[1] - x[1])
      .slice(0, limit)
      .map(([fid, w]) => {
        const { label, family } = labelFeature(fid);
        return { label, family, weight: roundTo(w, 4), support: supportOf(m, fid) };
      });

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
    top_hero_pairs: collectFamily('HP|', 40),
    top_hero_skills: collectFamily('HS|', 40),
  };
}
