/**
 * Client-side recommendation engine (opponent-aware paired model).
 *
 * Loads nothing itself — callers pass the generated artifact
 * (`recommendation_data.json`, see `data/build_recommendation_data.py`) plus the
 * catalog. All scoring is pure and local: a team's *relative roster strength* is
 * `w · features(team)` under the fitted paired logistic model.
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
import type { Database } from '../types/domain';
import {
  type AssignedHero,
  F_HERO_SKILL,
  scoreTeam,
  scoreHeroes,
  weightOf,
  supportOf,
  evidenceFor,
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
  /** Human-readable label, e.g. a hero pair "祝融 + 貂蝉" or a hero-skill pair. */
  label: string;
  /** Feature family (H/S/HP/HS/SP). */
  family: string;
  /** Fitted weight (roster-strength contribution). */
  weight: number;
  /** Support/evidence: battles this feature was observed in. */
  support: number;
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
  /** Notable negative contributions (tradeoffs) this option brings. */
  tradeoffs: Contribution[];
  /** Aggregate evidence behind the option's score. */
  evidence: { featureCount: number; totalSupport: number; minSupport: number };
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
function labelFeature(featureId: string): { label: string; family: string } {
  const parts = featureId.split('|');
  const family = parts[0];
  const names = parts.slice(1);
  if (family === F_HERO_SKILL) {
    return { label: `${names[0]} · ${names[1]}`, family };
  }
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
): { delta: number; contributions: Contribution[] } {
  const baseFeatures = teamFeatureIds(baseTeam);
  const combined = teamFeatureIds(combinedTeam);
  const contributions: Contribution[] = [];
  let delta = 0;
  for (const fid of combined) {
    if (baseFeatures.has(fid)) continue;
    const w = weightOf(m, fid);
    if (w === 0) continue;
    delta += w;
    const { label, family } = labelFeature(fid);
    contributions.push({ label, family, weight: w, support: supportOf(m, fid) });
  }
  contributions.sort((a, b) => b.weight - a.weight);
  return { delta, contributions };
}

const roundTo = (x: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** Scale a raw roster-strength delta to a friendlier 0-ish..N display number. */
const displayScore = (x: number): number => roundTo(x * 10, 1);

/**
 * Route a non-default skill to the current hero that maximises its
 * hero-skill weight (this is how the final formation will assign it). Returns
 * the best AssignedHero-style contribution for scoring a not-yet-assigned skill.
 */
function bestHeroForSkill(
  skill: string,
  heroes: string[],
  m: PairedModel
): { hero: string | null; weight: number } {
  let best: string | null = null;
  let bestW = -Infinity;
  for (const hero of heroes) {
    const w = weightOf(m, heroSkillId(hero, skill));
    if (w > bestW) {
      bestW = w;
      best = hero;
    }
  }
  return { hero: best, weight: best === null ? 0 : bestW };
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
    const { delta, contributions } = marginalContributions(baseTeam, combined, m);

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

    const combinedTeamForEvidence = combined;
    const ev = evidenceFor(combinedTeamForEvidence, m);
    return {
      set_index: setIndex,
      items: heroes,
      final_score: displayScore(delta),
      rank: 0,
      item_scores,
      synergies: contributions.filter((c) => c.weight > 0).slice(0, 5),
      tradeoffs: contributions.filter((c) => c.weight < 0).slice(0, 3),
      evidence: ev,
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
    const item_scores = skills.map((skill) => {
      const standalone = weightOf(m, skillId(skill));
      const { hero, weight } = bestHeroForSkill(skill, currentHeroes, m);
      const total = standalone + weight;
      delta += total;
      if (standalone !== 0) {
        contributions.push({ label: skill, family: 'S', weight: standalone, support: supportOf(m, skillId(skill)) });
      }
      if (hero && weight !== 0) {
        contributions.push({
          label: `${hero} · ${skill}`,
          family: 'HS',
          weight,
          support: supportOf(m, heroSkillId(hero, skill)),
        });
      }
      return { item: skill, score: displayScore(total), support: supportOf(m, skillId(skill)) };
    });

    contributions.sort((a, b) => b.weight - a.weight);
    return {
      set_index: setIndex,
      items: skills,
      final_score: displayScore(delta),
      rank: 0,
      item_scores,
      synergies: contributions.filter((c) => c.weight > 0).slice(0, 5),
      tradeoffs: contributions.filter((c) => c.weight < 0).slice(0, 3),
      evidence: {
        featureCount: contributions.length,
        totalSupport: contributions.reduce((a, c) => a + c.support, 0),
        minSupport: contributions.length ? Math.min(...contributions.map((c) => c.support)) : 0,
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
}
export interface ProjectedTeam {
  heroes: ProjectedHero[];
  /** Relative roster strength of the fully-assigned team. */
  strength: number;
}
export interface FormationRecommendation {
  teams: ProjectedTeam[];
  /** Aggregate objective actually optimised (sum − weakest-team penalty). */
  objective: number;
  aggregateStrength: number;
  weakestTeamStrength: number;
  /** How balanced the three teams are (0 = identical strength). */
  balanceSpread: number;
  /** True when the pool wasn't large enough for a full 3×3 formation. */
  incomplete: boolean;
}

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

/**
 * Globally assign exactly 18 unique skills across the three teams (2 per hero),
 * never a hero's own signature skill. A deterministic greedy affinity build is
 * followed by bounded swaps evaluated with the same balance-aware formation
 * objective used to choose the winning partition. Returns null if the supplied
 * pool has no valid signature-safe assignment.
 */
function assignSkills(
  trios: string[][],
  skillPool: string[],
  m: PairedModel,
  catalog: RecommendationCatalog
): Map<string, { skills: string[]; score: number }> | null {
  const heroes = trios.flat();
  const need = heroes.length * 2;
  // Deterministic candidate order (skills fixed length; keep the strongest by
  // best-possible hero-skill weight first, then name) and take exactly `need`.
  const bestHsWeight = (skill: string): number => {
    let w = -Infinity;
    for (const hero of heroes) {
      if (skill === catalog.default_skill[hero]) continue;
      const hw = weightOf(m, heroSkillId(hero, skill));
      if (hw > w) w = hw;
    }
    return w === -Infinity ? 0 : w;
  };
  const orderedSkills = [...new Set(skillPool)].sort((a, b) => {
    // S| is constant only after the 18 skills have been chosen. Include it when
    // selecting which 18 to use from a manually-expanded pool.
    const wa = weightOf(m, skillId(a)) + bestHsWeight(a);
    const wb = weightOf(m, skillId(b)) + bestHsWeight(b);
    if (wb !== wa) return wb - wa;
    return a.localeCompare(b);
  });

  const assign = new Map<string, string[]>();
  heroes.forEach((h) => assign.set(h, []));
  const capacity = new Map<string, number>();
  heroes.forEach((h) => capacity.set(h, 2));

  const remaining = orderedSkills.slice(0, need);

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
        if (otherSkills[i] === catalog.default_skill[hero]) continue;
        [ownSkills[badIndex], otherSkills[i]] = [otherSkills[i], ownSkills[badIndex]];
        repaired = true;
        break;
      }
      if (repaired) break;
    }
    if (!repaired) return null;
  }

  const assignmentObjective = (): number =>
    formationObjective(
      trios.map((trio) =>
        scoreTeam(
          trio.map((name) => ({ name, skills: assign.get(name) ?? [] })),
          m
        )
      )
    );

  // Bounded local improvement: swap two assigned skills when it raises the
  // actual fully-scored, balance-aware three-team objective.
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
    const skills = (assign.get(hero) ?? []).slice().sort();
    result.set(hero, { skills, score: heroAssignedScore(hero, skills, m) });
  }
  return result;
}

const BALANCE_PENALTY = 0.5;

/** Final objective for a set of team strengths: aggregate − balance-spread penalty. */
function formationObjective(strengths: number[]): number {
  const aggregate = strengths.reduce((a, b) => a + b, 0);
  const spread = Math.max(...strengths) - Math.min(...strengths);
  return aggregate - BALANCE_PENALTY * spread;
}

/** Assemble fully-assigned projected teams + their real `scoreTeam` strengths. */
function projectFormation(
  trios: string[][],
  skillPool: string[],
  m: PairedModel,
  catalog: RecommendationCatalog
): { teams: ProjectedTeam[]; strengths: number[] } | null {
  const allHeroes = trios.flat();
  const assignment = assignSkills(trios, skillPool, m, catalog);
  if (!assignment) return null;
  const teams: ProjectedTeam[] = trios.map((trio) => {
    const projected: ProjectedHero[] = trio.map((name) => {
      const a = assignment.get(name)!;
      return { name, skills: a.skills, skillScore: displayScore(a.score) };
    });
    const strength = scoreTeam(
      projected.map((p) => ({ name: p.name, skills: p.skills })),
      m
    );
    return { heroes: projected, strength };
  });
  return { teams, strengths: teams.map((t) => t.strength) };
}

/**
 * Optimise all three disjoint 3-hero teams together with their unique 18-skill
 * assignment.
 *
 * The candidate *selection* is driven by the true final objective computed from
 * *fully skill-assigned* teams — not by a hero-only proxy. Concretely:
 *
 *  1. Enumerate a bounded, deterministic beam of disjoint 3×3 hero partitions
 *     (hero-only strength is used only to *prune* the beam, never to pick the
 *     winner).
 *  2. For every retained partition, run the global 18-skill assignment and score
 *     each team with the full model (`scoreTeam`: hero + hero-pair + skill +
 *     hero-skill + within-hero skill-pair features).
 *  3. Keep the partition whose fully-assigned objective (aggregate roster
 *     strength minus a weakest-team balance penalty) is highest. The returned
 *     `objective` is exactly that selector value.
 *
 * Deterministic and bounded for pools of 9–12 heroes (larger pools are trimmed
 * to the 12 strongest heroes by individual weight before enumeration).
 */
export function recommendTeams(
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData,
  catalog: RecommendationCatalog
): FormationRecommendation {
  const m = model(data);
  const heroes = [...new Set(heroPool)];
  const skills = [...new Set(skillPool)];

  const incompleteResult: FormationRecommendation = {
    teams: [],
    objective: 0,
    aggregateStrength: 0,
    weakestTeamStrength: 0,
    balanceSpread: 0,
    incomplete: true,
  };
  if (heroes.length < 9 || skills.length < 18) return incompleteResult;

  // Trim large pools to a bounded set of the strongest heroes (keeps the beam
  // enumeration tractable); exactly-9 pools use all 9.
  const rankedHeroes = [...heroes].sort((a, b) => {
    const wa = weightOf(m, heroId(a));
    const wb = weightOf(m, heroId(b));
    if (wb !== wa) return wb - wa;
    return a.localeCompare(b);
  });
  const pool = rankedHeroes.slice(0, Math.min(12, rankedHeroes.length));

  // Build a bounded, deterministic beam of disjoint partitions. Hero-only
  // strength prunes the branching factor only; the winner is chosen later by the
  // fully-assigned objective.
  const partitions: [string[], string[], string[]][] = [];
  const seen = new Set<string>();
  const firstTrios = combinations3(pool)
    .map((t) => ({ trio: t, s: trioHeroStrength(t, m) }))
    .sort((x, y) => (y.s !== x.s ? y.s - x.s : x.trio.join(',').localeCompare(y.trio.join(','))))
    .slice(0, 40);
  for (const { trio: t1 } of firstTrios) {
    const used1 = new Set(t1);
    const rest1 = pool.filter((h) => !used1.has(h));
    const secondTrios = combinations3(rest1)
      .map((t) => ({ trio: t, s: trioHeroStrength(t, m) }))
      .sort((x, y) => (y.s !== x.s ? y.s - x.s : x.trio.join(',').localeCompare(y.trio.join(','))))
      .slice(0, 12);
    for (const { trio: t2 } of secondTrios) {
      const used2 = new Set([...t1, ...t2]);
      const rest2 = pool.filter((h) => !used2.has(h));
      const thirdTrios = combinations3(rest2)
        .map((t) => ({ trio: t, s: trioHeroStrength(t, m) }))
        .sort((x, y) => (y.s !== x.s ? y.s - x.s : x.trio.join(',').localeCompare(y.trio.join(','))))
        .slice(0, 4);
      for (const { trio: t3 } of thirdTrios) {
        // Canonicalise the partition (order trios, order heroes) to dedupe.
        const canon = [t1, t2, t3]
          .map((t) => [...t].sort().join('|'))
          .sort()
          .join('||');
        if (seen.has(canon)) continue;
        seen.add(canon);
        partitions.push([t1, t2, t3]);
      }
    }
  }

  // Choose by the true fully-assigned objective. Deterministic tie-break by the
  // canonical hero ordering.
  let best: {
    teams: ProjectedTeam[];
    strengths: number[];
    objective: number;
    key: string;
  } | null = null;
  for (const trios of partitions) {
    const projected = projectFormation(trios, skills, m, catalog);
    if (!projected) continue;
    const { teams, strengths } = projected;
    const objective = formationObjective(strengths);
    const key = trios
      .map((t) => t.map((p) => p).sort().join('|'))
      .sort()
      .join('||');
    if (
      best === null ||
      objective > best.objective + 1e-9 ||
      (Math.abs(objective - best.objective) <= 1e-9 && key < best.key)
    ) {
      best = { teams, strengths, objective, key };
    }
  }

  if (!best) return incompleteResult;

  // Order the displayed teams strongest-first for a stable, readable result.
  const ordered = [...best.teams].sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return a.heroes.map((h) => h.name).join(',').localeCompare(b.heroes.map((h) => h.name).join(','));
  });

  const teams: ProjectedTeam[] = ordered.map((t) => ({
    heroes: t.heroes,
    strength: displayScore(t.strength),
  }));
  const strengths = teams.map((t) => t.strength);
  const aggregate = strengths.reduce((a, b) => a + b, 0);
  const weakest = Math.min(...strengths);
  const spread = Math.max(...strengths) - weakest;

  return {
    teams,
    // Return the exact selector value in display units. It may differ by 0.1
    // from recomputing the formula over individually-rounded team labels.
    objective: displayScore(best.objective),
    aggregateStrength: roundTo(aggregate, 1),
    weakestTeamStrength: weakest,
    balanceSpread: roundTo(spread, 1),
    incomplete: false,
  };
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
  /** Relative roster-strength weight from the paired model (0 if unfitted). */
  strength: number;
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
 * Build the Analytics-page payload from the generated artifact. Rankings use the
 * builder's smoothed win rates; the model column exposes each item's relative
 * roster-strength weight. Backtest metrics surface model quality.
 */
export function getAnalytics(data: RecommendationData, database: Database): AnalyticsResult {
  const m = model(data);
  const a = data.analytics;

  const toEntity = (row: { name: string; wins: number; losses: number; total: number; win_rate: number; smoothed_win_rate: number }, family: 'H' | 'S'): AnalyticsEntity => ({
    name: row.name,
    wins: row.wins,
    losses: row.losses,
    total: row.total,
    winRate: row.win_rate,
    smoothedWinRate: row.smoothed_win_rate,
    strength: roundTo(weightOf(m, `${family}|${row.name}`), 4),
  });

  const heroes = a.heroes.map((r) => toEntity(r, 'H'));
  const skills = a.skills.map((r) => toEntity(r, 'S'));

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
