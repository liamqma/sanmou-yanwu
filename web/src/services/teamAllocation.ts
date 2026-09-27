import type { RecommendationData } from '../types/recommendation';
import {
  heroPairId,
  heroSkillId,
  scoreTeam,
  skillPairId,
  thsId,
  tspId,
  type AssignedHero,
} from './recommendationModel';
import { emptyLayout, TEAM_COUNT, TEAM_SIZE, type TeamLayout } from './teamLayout';

const TOP_SPLITS = 64;
const MAX_IMPROVEMENT_PASSES = 20;
const EPSILON = 1e-9;

export const teamWinChance = (score: number, data: RecommendationData): number =>
  1 / (1 + Math.exp(-(score - data.model.reference_team_score)));

/** Chance of winning at least two of three independent battles. */
export const twoOfThreeChance = (chances: number[]): number => {
  const [a = 0, b = 0, c = 0] = chances;
  return a * b + a * c + b * c - 2 * a * b * c;
};

export interface TeamEvaluation {
  /** `null` for a team without heroes. */
  score: number | null;
  winChance: number;
}

export interface LayoutEvaluation {
  teams: TeamEvaluation[];
  twoOfThree: number;
  /** Heroes placed next to a teammate they have no `HP` weight with. */
  unseenHeroes: Set<string>;
  /** Skills carried by a hero they have no `HS` weight with. */
  unseenSkills: Set<string>;
}

export function evaluateLayout(layout: TeamLayout, data: RecommendationData): LayoutEvaluation {
  const { model, catalog } = data;
  const unseenHeroes = new Set<string>();
  const unseenSkills = new Set<string>();
  const teams = layout.map((team): TeamEvaluation => {
    const assigned: AssignedHero[] = team
      .filter((slot) => slot.hero)
      .map((slot) => ({
        name: slot.hero as string,
        skills: slot.skills.filter((skill): skill is string => Boolean(skill)),
      }));
    for (const hero of assigned) {
      for (const other of assigned) {
        if (other.name !== hero.name && !(heroPairId(hero.name, other.name) in model.weights)) {
          unseenHeroes.add(hero.name);
        }
      }
      for (const skill of hero.skills) {
        if (!(heroSkillId(hero.name, skill) in model.weights)) unseenSkills.add(skill);
      }
    }
    if (assigned.length === 0) return { score: null, winChance: 0 };
    const score = scoreTeam(assigned, model, catalog);
    return { score, winChance: teamWinChance(score, data) };
  });
  return {
    teams,
    twoOfThree: twoOfThreeChance(teams.map((team) => team.winChance)),
    unseenHeroes,
    unseenSkills,
  };
}

interface Tables {
  heroes: string[];
  skills: string[];
  pairOk: boolean[][];
  /** `S + HS` for an allowed carry, `null` when the carry is not allowed. */
  carry: (number | null)[][];
  ths: number[][];
  tsp: number[][];
  sp: (hero: number, a: number, b: number) => number;
  base: (group: number[]) => number;
}

function buildTables(heroes: string[], skills: string[], data: RecommendationData): Tables {
  const { model, catalog } = data;
  const enabled = new Set(model.enabled_families);
  const weight = (id: string) => model.weights[id] ?? 0;
  const has = (id: string) => Object.hasOwn(model.weights, id);
  const pairOk = heroes.map((a, i) => heroes.map((b, j) => i === j || has(heroPairId(a, b))));
  const carry = heroes.map((hero) =>
    skills.map((skill) =>
      skill !== catalog.default_skill[hero] && has(heroSkillId(hero, skill))
        ? weight(`S|${skill}`) + weight(heroSkillId(hero, skill))
        : null
    )
  );
  const ths = heroes.map((hero) =>
    skills.map((skill) => (enabled.has('THS') ? weight(thsId(hero, skill)) : 0))
  );
  const tsp = skills.map((a) =>
    skills.map((b) => (a !== b && enabled.has('TSP') ? weight(tspId(a, b)) : 0))
  );
  const spCache = new Map<number, number>();
  const sp = (hero: number, a: number, b: number) => {
    if (!enabled.has('SP')) return 0;
    const key = (hero * skills.length + Math.min(a, b)) * skills.length + Math.max(a, b);
    let value = spCache.get(key);
    if (value === undefined) {
      value = weight(skillPairId(heroes[hero], skills[a], skills[b]));
      spCache.set(key, value);
    }
    return value;
  };
  const baseCache = new Map<number[], number>();
  const base = (group: number[]) => {
    let value = baseCache.get(group);
    if (value === undefined) {
      value = scoreTeam(
        group.map((index) => ({ name: heroes[index], skills: [] })),
        model,
        catalog
      );
      baseCache.set(group, value);
    }
    return value;
  };
  return { heroes, skills, pairOk, carry, ths, tsp, sp, base };
}

/** Skill part of one team's score. `slots[2 * i + k]` is hero `group[i]`'s skill `k`, or -1. */
function skillScore(tables: Tables, group: number[], slots: number[]): number {
  let score = 0;
  const used: number[] = [];
  for (let i = 0; i < group.length; i++) {
    const hero = group[i];
    const a = slots[2 * i];
    const b = slots[2 * i + 1];
    if (a >= 0) {
      score += tables.carry[hero][a] ?? 0;
      used.push(a);
    }
    if (b >= 0) {
      score += tables.carry[hero][b] ?? 0;
      used.push(b);
    }
    if (a >= 0 && b >= 0) score += tables.sp(hero, a, b);
  }
  if (group.length === TEAM_SIZE) {
    for (const hero of group) for (const skill of used) score += tables.ths[hero][skill];
    for (let i = 0; i < used.length; i++) {
      for (let j = i + 1; j < used.length; j++) score += tables.tsp[used[i]][used[j]];
    }
  }
  return score;
}

interface Assignment {
  groups: number[][];
  /** One slot array per group. */
  slots: number[][];
}

/** `[chance of winning 2 of 3, total score]`, compared in that order. */
type Value = [number, number];

const better = (a: Value, b: Value): boolean =>
  a[0] > b[0] + EPSILON || (Math.abs(a[0] - b[0]) <= EPSILON && a[1] > b[1] + EPSILON);

const valueOf = (scores: number[], data: RecommendationData): Value => [
  twoOfThreeChance(scores.map((score) => teamWinChance(score, data))),
  scores.reduce((sum, score) => sum + score, 0),
];

const allowed = (tables: Tables, group: number[], slot: number, skill: number) =>
  tables.carry[group[Math.floor(slot / 2)]][skill] !== null;

const placedCount = (assignment: Assignment) =>
  assignment.slots.reduce((count, slots) => count + slots.filter((skill) => skill >= 0).length, 0);

/** Kuhn augmenting paths: add skills to empty slots, reshuffling others, without removing any. */
function augment(tables: Tables, assignment: Assignment): void {
  const owner = new Map<number, [number, number]>();
  assignment.slots.forEach((slots, g) =>
    slots.forEach((skill, s) => {
      if (skill >= 0) owner.set(skill, [g, s]);
    })
  );
  const tryAssign = (g: number, s: number, seen: Set<number>): boolean => {
    for (let skill = 0; skill < tables.skills.length; skill++) {
      if (seen.has(skill) || !allowed(tables, assignment.groups[g], s, skill)) continue;
      seen.add(skill);
      const current = owner.get(skill);
      if (!current || tryAssign(current[0], current[1], seen)) {
        assignment.slots[g][s] = skill;
        owner.set(skill, [g, s]);
        return true;
      }
    }
    return false;
  };
  assignment.slots.forEach((slots, g) =>
    slots.forEach((skill, s) => {
      if (skill < 0) tryAssign(g, s, new Set());
    })
  );
}

/**
 * Fill empty slots greedily, reach the maximum number of placed skills, then
 * improve with count-preserving replacements and swaps. `teamOnly` scores a
 * single team by its own score instead of the two-of-three objective.
 */
function assignSkills(
  tables: Tables,
  assignment: Assignment,
  data: RecommendationData,
  teamOnly = false
): number[] {
  const { groups, slots } = assignment;
  const bases = groups.map((group) => tables.base(group));
  const scores = groups.map((group, g) => bases[g] + skillScore(tables, group, slots[g]));
  const refresh = (g: number) => {
    scores[g] = bases[g] + skillScore(tables, groups[g], slots[g]);
  };
  const value = (): Value => (teamOnly ? [scores[0], 0] : valueOf(scores, data));
  const used = new Set(slots.flat().filter((skill) => skill >= 0));
  const positions: Array<[number, number]> = [];
  slots.forEach((teamSlots, g) => teamSlots.forEach((_, s) => positions.push([g, s])));

  for (;;) {
    let best: { g: number; s: number; skill: number; value: Value } | null = null;
    for (const [g, s] of positions) {
      if (slots[g][s] >= 0) continue;
      for (let skill = 0; skill < tables.skills.length; skill++) {
        if (used.has(skill) || !allowed(tables, groups[g], s, skill)) continue;
        slots[g][s] = skill;
        refresh(g);
        const candidate = value();
        slots[g][s] = -1;
        refresh(g);
        if (!best || better(candidate, best.value)) best = { g, s, skill, value: candidate };
      }
    }
    if (!best) break;
    slots[best.g][best.s] = best.skill;
    used.add(best.skill);
    refresh(best.g);
  }

  augment(tables, assignment);
  groups.forEach((_, g) => refresh(g));

  for (let pass = 0; pass < MAX_IMPROVEMENT_PASSES; pass++) {
    let current = value();
    let improved = false;
    const inUse = new Set(slots.flat().filter((skill) => skill >= 0));
    for (const [g, s] of positions) {
      const before = slots[g][s];
      if (before < 0) continue;
      for (let skill = 0; skill < tables.skills.length; skill++) {
        if (inUse.has(skill) || !allowed(tables, groups[g], s, skill)) continue;
        slots[g][s] = skill;
        refresh(g);
        const candidate = value();
        if (better(candidate, current)) {
          inUse.delete(before);
          inUse.add(skill);
          current = candidate;
          improved = true;
          break;
        }
        slots[g][s] = before;
        refresh(g);
      }
    }
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const [g1, s1] = positions[i];
        const [g2, s2] = positions[j];
        const a = slots[g1][s1];
        const b = slots[g2][s2];
        if (a < 0 || b < 0 || a === b) continue;
        if (!allowed(tables, groups[g1], s1, b) || !allowed(tables, groups[g2], s2, a)) continue;
        slots[g1][s1] = b;
        slots[g2][s2] = a;
        refresh(g1);
        refresh(g2);
        const candidate = value();
        if (better(candidate, current)) {
          current = candidate;
          improved = true;
        } else {
          slots[g1][s1] = a;
          slots[g2][s2] = b;
          refresh(g1);
          refresh(g2);
        }
      }
    }
    if (!improved) break;
  }
  return scores;
}

/** Every hero group of size 1 to 3 whose hero pairs all have `HP` weights, by size. */
function validGroups(tables: Tables): number[][][] {
  const n = tables.heroes.length;
  const bySize: number[][][] = [[], [], [], []];
  for (let a = 0; a < n; a++) {
    bySize[1].push([a]);
    for (let b = a + 1; b < n; b++) {
      if (!tables.pairOk[a][b]) continue;
      bySize[2].push([a, b]);
      for (let c = b + 1; c < n; c++) {
        if (tables.pairOk[a][c] && tables.pairOk[b][c]) bySize[3].push([a, b, c]);
      }
    }
  }
  return bySize;
}

/** Team-size patterns for up to three teams, most heroes first. */
function sizePatterns(): number[][] {
  const patterns: number[][] = [];
  for (let a = 1; a <= TEAM_SIZE; a++) {
    patterns.push([a]);
    for (let b = 1; b <= a; b++) {
      patterns.push([a, b]);
      for (let c = 1; c <= b && TEAM_COUNT >= 3; c++) patterns.push([a, b, c]);
    }
  }
  const total = (pattern: number[]) => pattern.reduce((sum, size) => sum + size, 0);
  return patterns.sort((x, y) => total(y) - total(x) || y.length - x.length);
}

/** Visit every disjoint combination of groups matching `pattern`. */
function forEachCombination(
  bySize: number[][][],
  pattern: number[],
  visit: (groups: number[][]) => void
): void {
  const chosen: number[][] = [];
  const indices: number[] = [];
  const used = new Set<number>();
  const walk = (depth: number) => {
    if (depth === pattern.length) {
      visit([...chosen]);
      return;
    }
    const list = bySize[pattern[depth]];
    // Equal sizes are taken in increasing order so each combination appears once.
    const start = depth > 0 && pattern[depth - 1] === pattern[depth] ? indices[depth - 1] + 1 : 0;
    for (let i = start; i < list.length; i++) {
      const group = list[i];
      if (group.some((hero) => used.has(hero))) continue;
      chosen.push(group);
      indices[depth] = i;
      group.forEach((hero) => used.add(hero));
      walk(depth + 1);
      group.forEach((hero) => used.delete(hero));
      chosen.pop();
    }
  };
  walk(0);
}

/**
 * Allocate a pool into up to three teams. It places as many heroes and skills
 * as possible without using a hero pair or hero-skill carry that has no model
 * weight, then maximizes the chance of winning two of three battles.
 */
export function allocateTeams(
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData
): TeamLayout {
  const heroes = [...new Set(heroPool)].sort();
  const skills = [...new Set(skillPool)].sort();
  const layout = emptyLayout();
  if (heroes.length === 0) return layout;
  const tables = buildTables(heroes, skills, data);
  const bySize = validGroups(tables);

  const solo = new Map<number[], { score: number; skills: number }>();
  const soloOf = (group: number[]) => {
    let result = solo.get(group);
    if (!result) {
      const single: Assignment = { groups: [group], slots: [group.flatMap(() => [-1, -1])] };
      const [score] = assignSkills(tables, single, data, true);
      result = { score, skills: placedCount(single) };
      solo.set(group, result);
    }
    return result;
  };

  interface Candidate {
    groups: number[][];
    skills: number;
    value: Value;
  }
  const outranks = (a: Candidate, b: Candidate) =>
    a.skills > b.skills || (a.skills === b.skills && better(a.value, b.value));
  const top: Candidate[] = [];
  let bestTotal = -1;
  for (const pattern of sizePatterns()) {
    const total = pattern.reduce((sum, size) => sum + size, 0);
    if (bestTotal >= 0 && total < bestTotal) break;
    forEachCombination(bySize, pattern, (groups) => {
      bestTotal = total;
      const solos = groups.map(soloOf);
      const candidate: Candidate = {
        groups,
        skills: solos.reduce((count, entry) => count + entry.skills, 0),
        value: valueOf(
          solos.map((entry) => entry.score),
          data
        ),
      };
      if (top.length === TOP_SPLITS && !outranks(candidate, top[top.length - 1])) return;
      let index = top.length;
      while (index > 0 && outranks(candidate, top[index - 1])) index--;
      top.splice(index, 0, candidate);
      if (top.length > TOP_SPLITS) top.pop();
    });
  }

  let best: { assignment: Assignment; scores: number[]; skills: number; value: Value } | null =
    null;
  for (const candidate of top) {
    const assignment: Assignment = {
      groups: candidate.groups,
      slots: candidate.groups.map((group) => group.flatMap(() => [-1, -1])),
    };
    const scores = assignSkills(tables, assignment, data);
    const placed = placedCount(assignment);
    const value = valueOf(scores, data);
    if (!best || placed > best.skills || (placed === best.skills && better(value, best.value))) {
      best = { assignment, scores, skills: placed, value };
    }
  }
  if (!best) return layout;

  const { assignment, scores } = best;
  const order = assignment.groups.map((_, g) => g).sort((a, b) => scores[b] - scores[a]);
  order.forEach((g, teamIndex) => {
    assignment.groups[g].forEach((hero, i) => {
      const carried = [assignment.slots[g][2 * i], assignment.slots[g][2 * i + 1]]
        .filter((skill) => skill >= 0)
        .map((skill) => skills[skill])
        .sort();
      layout[teamIndex][i] = { hero: heroes[hero], skills: [carried[0] ?? null, carried[1] ?? null] };
    });
  });
  return layout;
}
