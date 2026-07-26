import type { FormationOption } from './recommendationEngine';

export const TEAM_BUILDER_TEAM_COUNT = 3 as const;
export const TEAM_BUILDER_HERO_SLOTS_PER_TEAM = 3 as const;
export const TEAM_BUILDER_SKILL_SLOTS_PER_HERO = 2 as const;
export const TEAM_BUILDER_ROWS = ['前排', '后排'] as const;
export const TEAM_BUILDER_DEFAULT_ROW: TeamBuilderRow = '前排';
export const TEAM_BUILDER_STORAGE_VERSION = 2 as const;

export type TeamBuilderRow = (typeof TEAM_BUILDER_ROWS)[number];
export type TeamBuilderSkillSlots = [string | null, string | null];

export interface TeamBuilderHeroSlot {
  hero: string | null;
  row: TeamBuilderRow;
  skills: TeamBuilderSkillSlots;
}

export type TeamBuilderHeroSlots = [
  TeamBuilderHeroSlot,
  TeamBuilderHeroSlot,
  TeamBuilderHeroSlot,
];

export interface TeamBuilderTeam {
  formation: string;
  heroes: TeamBuilderHeroSlots;
}

export type TeamBuilderLayout = [
  TeamBuilderTeam,
  TeamBuilderTeam,
  TeamBuilderTeam,
];

export interface StoredTeamBuilderLayoutV2 {
  version: typeof TEAM_BUILDER_STORAGE_VERSION;
  poolKey: string;
  layout: TeamBuilderLayout;
}

export interface NormalizeTeamBuilderLayoutOptions {
  allowedHeroes: Iterable<string>;
  allowedSkills: Iterable<string>;
  formations: Iterable<string>;
}

export interface NormalizedTeamBuilderLayout {
  layout: TeamBuilderLayout;
  storedPoolKey: string | null;
  hasAssignments: boolean;
}

interface TeamBuilderHeroCoordinates {
  teamIndex: number;
  heroIndex: number;
}

interface TeamBuilderSkillCoordinates extends TeamBuilderHeroCoordinates {
  skillIndex: number;
}

export type TeamBuilderHeroMoveSource =
  | ({ kind: 'hero'; origin: 'pool'; hero: string })
  | ({ kind: 'hero'; origin: 'slot' } & TeamBuilderHeroCoordinates);

export type TeamBuilderSkillMoveSource =
  | ({ kind: 'skill'; origin: 'pool'; skill: string })
  | ({ kind: 'skill'; origin: 'slot' } & TeamBuilderSkillCoordinates);

export type TeamBuilderMoveSource =
  | TeamBuilderHeroMoveSource
  | TeamBuilderSkillMoveSource;

export type TeamBuilderHeroMoveTarget =
  | { kind: 'hero'; destination: 'pool' }
  | ({ kind: 'hero'; destination: 'slot' } & TeamBuilderHeroCoordinates);

export type TeamBuilderSkillMoveTarget =
  | { kind: 'skill'; destination: 'pool' }
  | ({ kind: 'skill'; destination: 'slot' } & TeamBuilderSkillCoordinates);

export type TeamBuilderMoveTarget =
  | TeamBuilderHeroMoveTarget
  | TeamBuilderSkillMoveTarget;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const createEmptyHeroSlot = (): TeamBuilderHeroSlot => ({
  hero: null,
  row: TEAM_BUILDER_DEFAULT_ROW,
  skills: [null, null],
});

const createEmptyTeam = (): TeamBuilderTeam => ({
  formation: '',
  heroes: [
    createEmptyHeroSlot(),
    createEmptyHeroSlot(),
    createEmptyHeroSlot(),
  ],
});

export const createEmptyTeamBuilderLayout = (): TeamBuilderLayout => [
  createEmptyTeam(),
  createEmptyTeam(),
  createEmptyTeam(),
];

export const cloneTeamBuilderLayout = (
  layout: TeamBuilderLayout
): TeamBuilderLayout => [
  {
    formation: layout[0].formation,
    heroes: layout[0].heroes.map((slot) => ({
      hero: slot.hero,
      row: slot.row,
      skills: [...slot.skills] as TeamBuilderSkillSlots,
    })) as TeamBuilderHeroSlots,
  },
  {
    formation: layout[1].formation,
    heroes: layout[1].heroes.map((slot) => ({
      hero: slot.hero,
      row: slot.row,
      skills: [...slot.skills] as TeamBuilderSkillSlots,
    })) as TeamBuilderHeroSlots,
  },
  {
    formation: layout[2].formation,
    heroes: layout[2].heroes.map((slot) => ({
      hero: slot.hero,
      row: slot.row,
      skills: [...slot.skills] as TeamBuilderSkillSlots,
    })) as TeamBuilderHeroSlots,
  },
];

/**
 * Stable identity for an owned hero/skill pool. Ordering and repeated values do
 * not affect the result.
 */
export function teamBuilderPoolKey(
  heroes: Iterable<string>,
  skills: Iterable<string>
): string {
  return JSON.stringify({
    heroes: [...new Set(heroes)].sort(),
    skills: [...new Set(skills)].sort(),
  });
}

export function createStoredTeamBuilderLayout(
  poolKey: string,
  layout: TeamBuilderLayout
): StoredTeamBuilderLayoutV2 {
  return {
    version: TEAM_BUILDER_STORAGE_VERSION,
    poolKey,
    layout: cloneTeamBuilderLayout(layout),
  };
}

const rawLayoutAndPoolKey = (
  raw: unknown
): { rawLayout: unknown; storedPoolKey: string | null } => {
  if (Array.isArray(raw)) {
    return { rawLayout: raw, storedPoolKey: null };
  }
  if (isRecord(raw) && raw.version === TEAM_BUILDER_STORAGE_VERSION) {
    return {
      rawLayout: raw.layout,
      storedPoolKey: typeof raw.poolKey === 'string' ? raw.poolKey : null,
    };
  }
  return { rawLayout: null, storedPoolKey: null };
};

/**
 * Migrate legacy arrays and validate schema-v2 data into one canonical layout.
 * The first row-major occurrence of a valid hero or skill wins; stale and
 * duplicate assignments are returned to the implicit unused pool.
 */
export function normalizeTeamBuilderLayout(
  raw: unknown,
  options: NormalizeTeamBuilderLayoutOptions
): NormalizedTeamBuilderLayout {
  const allowedHeroes = new Set(options.allowedHeroes);
  const allowedSkills = new Set(options.allowedSkills);
  const formations = new Set(options.formations);
  const seenHeroes = new Set<string>();
  const seenSkills = new Set<string>();
  const layout = createEmptyTeamBuilderLayout();
  const { rawLayout, storedPoolKey } = rawLayoutAndPoolKey(raw);

  if (Array.isArray(rawLayout)) {
    for (
      let teamIndex = 0;
      teamIndex < TEAM_BUILDER_TEAM_COUNT;
      teamIndex += 1
    ) {
      const rawTeam = rawLayout[teamIndex];
      if (!isRecord(rawTeam)) continue;

      if (
        typeof rawTeam.formation === 'string' &&
        formations.has(rawTeam.formation)
      ) {
        layout[teamIndex].formation = rawTeam.formation;
      }

      if (!Array.isArray(rawTeam.heroes)) continue;
      for (
        let heroIndex = 0;
        heroIndex < TEAM_BUILDER_HERO_SLOTS_PER_TEAM;
        heroIndex += 1
      ) {
        const rawSlot = rawTeam.heroes[heroIndex];
        if (!isRecord(rawSlot)) continue;

        const hero =
          typeof rawSlot.hero === 'string' &&
          allowedHeroes.has(rawSlot.hero) &&
          !seenHeroes.has(rawSlot.hero)
            ? rawSlot.hero
            : null;
        if (typeof rawSlot.hero === 'string' && hero === null) continue;

        const slot = layout[teamIndex].heroes[heroIndex];
        if (hero !== null) {
          seenHeroes.add(hero);
          slot.hero = hero;
        }
        if (
          rawSlot.row === TEAM_BUILDER_ROWS[0] ||
          rawSlot.row === TEAM_BUILDER_ROWS[1]
        ) {
          slot.row = rawSlot.row;
        }

        if (!Array.isArray(rawSlot.skills)) continue;
        for (
          let skillIndex = 0;
          skillIndex < TEAM_BUILDER_SKILL_SLOTS_PER_HERO;
          skillIndex += 1
        ) {
          const skill = rawSlot.skills[skillIndex];
          if (
            typeof skill === 'string' &&
            allowedSkills.has(skill) &&
            !seenSkills.has(skill)
          ) {
            seenSkills.add(skill);
            slot.skills[skillIndex] = skill;
          }
        }
      }
    }
  }

  return {
    layout,
    storedPoolKey,
    hasAssignments: seenHeroes.size > 0 || seenSkills.size > 0,
  };
}

/**
 * Seed the editable layout from the recommendation engine's best formation
 * option. The engine normally supplies an exact, globally-unique 3x3x2 result;
 * defensive duplicate filtering keeps that state invariant for synthetic or
 * future callers too.
 */
export function layoutFromFormation(option: FormationOption): TeamBuilderLayout {
  const layout = createEmptyTeamBuilderLayout();
  const seenHeroes = new Set<string>();
  const seenSkills = new Set<string>();

  for (
    let teamIndex = 0;
    teamIndex < TEAM_BUILDER_TEAM_COUNT;
    teamIndex += 1
  ) {
    const projectedTeam = option.teams[teamIndex];
    if (!projectedTeam) continue;

    for (
      let heroIndex = 0;
      heroIndex < TEAM_BUILDER_HERO_SLOTS_PER_TEAM;
      heroIndex += 1
    ) {
      const projectedHero = projectedTeam.heroes[heroIndex];
      if (
        !projectedHero ||
        !projectedHero.name ||
        seenHeroes.has(projectedHero.name)
      ) {
        continue;
      }

      seenHeroes.add(projectedHero.name);
      const slot = layout[teamIndex].heroes[heroIndex];
      slot.hero = projectedHero.name;

      for (
        let skillIndex = 0;
        skillIndex < TEAM_BUILDER_SKILL_SLOTS_PER_HERO;
        skillIndex += 1
      ) {
        const skill = projectedHero.skills[skillIndex];
        if (skill && !seenSkills.has(skill)) {
          seenSkills.add(skill);
          slot.skills[skillIndex] = skill;
        }
      }
    }
  }

  return layout;
}

export function collectUsedTeamBuilderHeroes(
  layout: TeamBuilderLayout
): Set<string> {
  const heroes = new Set<string>();
  for (const team of layout) {
    for (const slot of team.heroes) {
      if (slot.hero) heroes.add(slot.hero);
    }
  }
  return heroes;
}

export function collectUsedTeamBuilderSkills(
  layout: TeamBuilderLayout
): Set<string> {
  const skills = new Set<string>();
  for (const team of layout) {
    for (const slot of team.heroes) {
      for (const skill of slot.skills) {
        if (skill) skills.add(skill);
      }
    }
  }
  return skills;
}

export function collectUsedTeamBuilderItems(
  layout: TeamBuilderLayout
): { heroes: Set<string>; skills: Set<string> } {
  return {
    heroes: collectUsedTeamBuilderHeroes(layout),
    skills: collectUsedTeamBuilderSkills(layout),
  };
}

export function teamBuilderLayoutHasHero(layout: TeamBuilderLayout): boolean {
  return layout.some((team) => team.heroes.some((slot) => slot.hero !== null));
}

const isIndex = (value: number, length: number): boolean =>
  Number.isInteger(value) && value >= 0 && value < length;

const hasHeroCoordinates = (
  coordinates: TeamBuilderHeroCoordinates
): boolean =>
  isIndex(coordinates.teamIndex, TEAM_BUILDER_TEAM_COUNT) &&
  isIndex(coordinates.heroIndex, TEAM_BUILDER_HERO_SLOTS_PER_TEAM);

const hasSkillCoordinates = (
  coordinates: TeamBuilderSkillCoordinates
): boolean =>
  hasHeroCoordinates(coordinates) &&
  isIndex(coordinates.skillIndex, TEAM_BUILDER_SKILL_SLOTS_PER_HERO);

const sameHeroCoordinates = (
  a: TeamBuilderHeroCoordinates,
  b: TeamBuilderHeroCoordinates
): boolean =>
  a.teamIndex === b.teamIndex && a.heroIndex === b.heroIndex;

const sameSkillCoordinates = (
  a: TeamBuilderSkillCoordinates,
  b: TeamBuilderSkillCoordinates
): boolean =>
  sameHeroCoordinates(a, b) && a.skillIndex === b.skillIndex;

const applyHeroMove = (
  layout: TeamBuilderLayout,
  source: TeamBuilderHeroMoveSource,
  target: TeamBuilderHeroMoveTarget
): TeamBuilderLayout => {
  if (source.origin === 'pool') {
    if (
      target.destination !== 'slot' ||
      !hasHeroCoordinates(target) ||
      !source.hero ||
      collectUsedTeamBuilderHeroes(layout).has(source.hero)
    ) {
      return layout;
    }

    const next = cloneTeamBuilderLayout(layout);
    next[target.teamIndex].heroes[target.heroIndex].hero = source.hero;
    return next;
  }

  if (!hasHeroCoordinates(source)) return layout;
  const sourceSlot = layout[source.teamIndex].heroes[source.heroIndex];
  if (sourceSlot.hero === null) return layout;

  if (target.destination === 'pool') {
    const next = cloneTeamBuilderLayout(layout);
    next[source.teamIndex].heroes[source.heroIndex] = createEmptyHeroSlot();
    return next;
  }

  if (
    !hasHeroCoordinates(target) ||
    sameHeroCoordinates(source, target)
  ) {
    return layout;
  }

  const next = cloneTeamBuilderLayout(layout);
  const fromHero = next[source.teamIndex].heroes[source.heroIndex].hero;
  next[source.teamIndex].heroes[source.heroIndex].hero =
    next[target.teamIndex].heroes[target.heroIndex].hero;
  next[target.teamIndex].heroes[target.heroIndex].hero = fromHero;
  return next;
};

const applySkillMove = (
  layout: TeamBuilderLayout,
  source: TeamBuilderSkillMoveSource,
  target: TeamBuilderSkillMoveTarget
): TeamBuilderLayout => {
  if (source.origin === 'pool') {
    if (
      target.destination !== 'slot' ||
      !hasSkillCoordinates(target) ||
      !source.skill ||
      collectUsedTeamBuilderSkills(layout).has(source.skill)
    ) {
      return layout;
    }

    const next = cloneTeamBuilderLayout(layout);
    next[target.teamIndex].heroes[target.heroIndex].skills[target.skillIndex] =
      source.skill;
    return next;
  }

  if (!hasSkillCoordinates(source)) return layout;
  const sourceSlot = layout[source.teamIndex].heroes[source.heroIndex];
  if (sourceSlot.skills[source.skillIndex] === null) return layout;

  if (target.destination === 'pool') {
    const next = cloneTeamBuilderLayout(layout);
    next[source.teamIndex].heroes[source.heroIndex].skills[source.skillIndex] =
      null;
    return next;
  }

  if (
    !hasSkillCoordinates(target) ||
    sameSkillCoordinates(source, target)
  ) {
    return layout;
  }

  const next = cloneTeamBuilderLayout(layout);
  const from =
    next[source.teamIndex].heroes[source.heroIndex].skills[source.skillIndex];
  next[source.teamIndex].heroes[source.heroIndex].skills[source.skillIndex] =
    next[target.teamIndex].heroes[target.heroIndex].skills[target.skillIndex];
  next[target.teamIndex].heroes[target.heroIndex].skills[target.skillIndex] =
    from;
  return next;
};

/**
 * Apply one drag/tap move. Invalid, cross-kind, duplicate, empty-source and
 * out-of-range operations are identity no-ops; accepted operations return a
 * fresh layout and never mutate the input.
 */
export function applyTeamBuilderMove(
  layout: TeamBuilderLayout,
  source: TeamBuilderMoveSource,
  target: TeamBuilderMoveTarget
): TeamBuilderLayout {
  if (source.kind === 'hero') {
    return target.kind === 'hero'
      ? applyHeroMove(layout, source, target)
      : layout;
  }
  return target.kind === 'skill'
    ? applySkillMove(layout, source, target)
    : layout;
}
