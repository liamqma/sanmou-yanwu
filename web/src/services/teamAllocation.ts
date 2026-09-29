import type { RecommendationData } from '../types/recommendation';
import {
  heroPairId,
  heroSkillId,
  scoreTeam,
  skillId,
  skillPairId,
  thsId,
  tspId,
  type AssignedHero,
} from './recommendationModel';
import {
  cloneLayout,
  emptyLayout,
  placedItems,
  TEAM_COUNT,
  TEAM_SIZE,
  type TeamLayout,
} from './teamLayout';

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
  /** A hero may only be given a skill it has an `HS` weight with, and never its own skill. */
  canCarry: boolean[][];
  /** `S + HS` of a carried skill. */
  carry: number[][];
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
  const canCarry = heroes.map((hero) =>
    skills.map((skill) => skill !== catalog.default_skill[hero] && has(heroSkillId(hero, skill)))
  );
  const carry = heroes.map((hero) =>
    skills.map((skill) => weight(skillId(skill)) + weight(heroSkillId(hero, skill)))
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
  return { heroes, skills, pairOk, canCarry, carry, ths, tsp, sp, base };
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
      score += tables.carry[hero][a];
      used.push(a);
    }
    if (b >= 0) {
      score += tables.carry[hero][b];
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
  /** Slots the player filled; they are never changed. */
  locked: boolean[][];
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
  tables.canCarry[group[Math.floor(slot / 2)]][skill];

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
      if (current && assignment.locked[current[0]][current[1]]) continue;
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
  const { groups, slots, locked } = assignment;
  const bases = groups.map((group) => tables.base(group));
  const scores = groups.map((group, g) => bases[g] + skillScore(tables, group, slots[g]));
  const refresh = (g: number) => {
    scores[g] = bases[g] + skillScore(tables, groups[g], slots[g]);
  };
  const value = (): Value => (teamOnly ? [scores[0], 0] : valueOf(scores, data));
  const used = new Set(slots.flat().filter((skill) => skill >= 0));
  const positions: Array<[number, number]> = [];
  slots.forEach((teamSlots, g) =>
    teamSlots.forEach((_, s) => {
      if (!locked[g][s]) positions.push([g, s]);
    })
  );

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

/** Every group of 1 to 3 of `candidates` whose hero pairs all have `HP` weights, by size. */
function validGroups(tables: Tables, candidates: number[]): number[][][] {
  const bySize: number[][][] = [[], [], [], []];
  const n = candidates.length;
  for (let i = 0; i < n; i++) {
    const a = candidates[i];
    bySize[1].push([a]);
    for (let j = i + 1; j < n; j++) {
      const b = candidates[j];
      if (!tables.pairOk[a][b]) continue;
      bySize[2].push([a, b]);
      for (let k = j + 1; k < n; k++) {
        const c = candidates[k];
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

/** Visit every combination of disjoint groups of `bySize` matching `pattern`, avoiding `used`. */
function forEachCombination(
  bySize: number[][][],
  pattern: number[],
  used: Set<number>,
  visit: (groups: number[][]) => void
): void {
  const chosen: number[][] = [];
  const indices: number[] = [];
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

/** A team the player already started: its heroes, their slots, and their skills. */
interface StartedTeam {
  team: number;
  heroes: number[];
  heroSlots: number[];
  /** Two entries per hero, -1 for an empty skill slot. */
  skills: number[];
  /**
   * By number of joining heroes, each option's full hero group. Every `HP` pair
   * among the joiners and with `heroes` has a weight.
   */
  options: number[][][];
}

/** A team in a candidate split: a started team with its joiners, or a new team (`team` is null). */
interface Pick {
  team: number | null;
  group: number[];
}

/**
 * Fill the empty slots of `start` from the rest of the pool. Items already in
 * `start` stay where they are. It places as many heroes and skills as possible
 * without adding a hero pair or hero-skill carry that has no model weight, then
 * maximizes the chance of winning two of three battles.
 */
export function fillTeams(
  start: TeamLayout,
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData
): TeamLayout {
  const placed = placedItems(start);
  const heroes = [...new Set([...heroPool, ...placed.heroes])].sort();
  const skills = [...new Set([...skillPool, ...placed.skills])].sort();
  const layout = cloneLayout(start);
  if (heroes.length === 0) return layout;
  const tables = buildTables(heroes, skills, data);
  const heroIndex = new Map(heroes.map((hero, index) => [hero, index]));
  const skillIndex = new Map(skills.map((skill, index) => [skill, index]));
  const spare = heroes.flatMap((hero, index) => (placed.heroes.has(hero) ? [] : [index]));
  const newGroups = validGroups(tables, spare);

  const started: StartedTeam[] = [];
  const emptyTeams: number[] = [];
  start.forEach((team, t) => {
    const heroSlots = team.flatMap((slot, s) => (slot.hero ? [s] : []));
    if (heroSlots.length === 0) {
      emptyTeams.push(t);
      return;
    }
    const members = heroSlots.map((s) => heroIndex.get(team[s].hero as string) as number);
    const fits = (group: number[]) =>
      group.every((hero) => members.every((member) => tables.pairOk[hero][member]));
    const room = TEAM_SIZE - members.length;
    started.push({
      team: t,
      heroes: members,
      heroSlots,
      skills: heroSlots.flatMap((s) =>
        team[s].skills.map((skill) => (skill ? (skillIndex.get(skill) as number) : -1))
      ),
      options: newGroups.map((groups, size) =>
        size === 0
          ? [members]
          : size <= room
            ? groups.filter(fits).map((group) => [...members, ...group])
            : []
      ),
    });
  });

  const initial = (pick: Pick) => {
    const team = started.find((entry) => entry.team === pick.team);
    const lockedSkills = team?.skills ?? [];
    const slots = [...lockedSkills, ...pick.group.slice(team?.heroes.length ?? 0).flatMap(() => [-1, -1])];
    return { slots, locked: slots.map((skill) => skill >= 0) };
  };
  const assignmentOf = (picks: Pick[]): Assignment => {
    const starts = picks.map(initial);
    return {
      groups: picks.map((pick) => pick.group),
      slots: starts.map((entry) => entry.slots),
      locked: starts.map((entry) => entry.locked),
    };
  };

  const solo = new Map<number[], { score: number; skills: number }>();
  const soloOf = (pick: Pick) => {
    let result = solo.get(pick.group);
    if (!result) {
      const single = assignmentOf([pick]);
      const [score] = assignSkills(tables, single, data, true);
      result = { score, skills: placedCount(single) };
      solo.set(pick.group, result);
    }
    return result;
  };

  interface Candidate {
    picks: Pick[];
    skills: number;
    value: Value;
  }
  const outranks = (a: Candidate, b: Candidate) =>
    a.skills > b.skills || (a.skills === b.skills && better(a.value, b.value));
  const top: Candidate[] = [];
  const consider = (picks: Pick[]) => {
    const solos = picks.map(soloOf);
    const candidate: Candidate = {
      picks,
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
  };

  // New teams are interchangeable, so they are chosen as unordered patterns.
  const patterns = [[], ...sizePatterns().filter((pattern) => pattern.length <= emptyTeams.length)];
  const room = started.reduce((sum, team) => sum + TEAM_SIZE - team.heroes.length, 0);
  const maxHeroes = Math.min(spare.length, room + emptyTeams.length * TEAM_SIZE);
  const used = new Set<number>();
  for (let total = maxHeroes; total >= 0 && top.length === 0; total--) {
    const joinSizes = (i: number, left: number, sizes: number[]): void => {
      if (i === started.length) {
        for (const pattern of patterns) {
          if (pattern.reduce((sum, size) => sum + size, 0) === left) chooseJoiners(0, sizes, pattern, []);
        }
        return;
      }
      const limit = Math.min(left, TEAM_SIZE - started[i].heroes.length);
      for (let size = limit; size >= 0; size--) joinSizes(i + 1, left - size, [...sizes, size]);
    };
    const chooseJoiners = (i: number, sizes: number[], pattern: number[], picks: Pick[]): void => {
      if (i === started.length) {
        forEachCombination(newGroups, pattern, used, (groups) =>
          consider([...picks, ...groups.map((group) => ({ team: null, group }))])
        );
        return;
      }
      const team = started[i];
      for (const group of team.options[sizes[i]]) {
        const joiners = group.slice(team.heroes.length);
        if (joiners.some((hero) => used.has(hero))) continue;
        joiners.forEach((hero) => used.add(hero));
        chooseJoiners(i + 1, sizes, pattern, [...picks, { team: team.team, group }]);
        joiners.forEach((hero) => used.delete(hero));
      }
    };
    joinSizes(0, total, []);
  }

  let best: { assignment: Assignment; picks: Pick[]; scores: number[]; skills: number; value: Value } | null =
    null;
  for (const candidate of top) {
    const assignment = assignmentOf(candidate.picks);
    const scores = assignSkills(tables, assignment, data);
    const count = placedCount(assignment);
    const value = valueOf(scores, data);
    if (!best || count > best.skills || (count === best.skills && better(value, best.value))) {
      best = { assignment, picks: candidate.picks, scores, skills: count, value };
    }
  }
  if (!best) return layout;

  const { assignment, picks, scores } = best;
  const write = (team: number, heroSlots: number[], g: number, from: number) => {
    const group = assignment.groups[g];
    for (let i = from; i < group.length; i++) {
      const carried = [assignment.slots[g][2 * i], assignment.slots[g][2 * i + 1]]
        .filter((skill) => skill >= 0)
        .map((skill) => skills[skill])
        .sort();
      layout[team][heroSlots[i]] = { hero: heroes[group[i]], skills: [carried[0] ?? null, carried[1] ?? null] };
    }
  };
  picks.forEach((pick, g) => {
    if (pick.team === null) return;
    const team = started.find((entry) => entry.team === pick.team) as StartedTeam;
    team.heroes.forEach((_, i) => {
      const slot = layout[pick.team as number][team.heroSlots[i]];
      slot.skills = [0, 1].map((k) => {
        const skill = assignment.slots[g][2 * i + k];
        return skill >= 0 ? skills[skill] : null;
      }) as [string | null, string | null];
    });
    const open = [0, 1, 2].filter((s) => !team.heroSlots.includes(s));
    write(pick.team, [...team.heroSlots, ...open], g, team.heroes.length);
  });
  const newTeams = picks
    .map((pick, g) => ({ pick, g }))
    .filter(({ pick }) => pick.team === null)
    .sort((a, b) => scores[b.g] - scores[a.g]);
  newTeams.forEach(({ g }, i) => write(emptyTeams[i], [0, 1, 2], g, 0));
  return layout;
}

/** Allocate a pool into up to three teams from scratch. */
export function allocateTeams(
  heroPool: string[],
  skillPool: string[],
  data: RecommendationData
): TeamLayout {
  return fillTeams(emptyLayout(), heroPool, skillPool, data);
}
