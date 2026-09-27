export const TEAM_COUNT = 3;
export const TEAM_SIZE = 3;
export const TEAM_BUILDER_STORAGE_VERSION = 3;

export interface TeamSlot {
  hero: string | null;
  skills: [string | null, string | null];
}

export type TeamLayout = TeamSlot[][];

export type TeamBuilderMode = 'auto' | 'manual';

export interface LayoutPosition {
  team: number;
  slot: number;
  /** `'hero'` or the skill slot index. */
  field: 'hero' | 0 | 1;
}

export interface MoveSource {
  kind: 'hero' | 'skill';
  name: string;
  /** `null` when the item comes from 当前阵容. */
  from: LayoutPosition | null;
}

/** `null` returns the item to 当前阵容. */
export type MoveTarget = LayoutPosition | null;

export interface StoredTeamBuilder {
  version: typeof TEAM_BUILDER_STORAGE_VERSION;
  mode: TeamBuilderMode;
  poolKey: string;
  layout: TeamLayout;
}

const emptySlot = (): TeamSlot => ({ hero: null, skills: [null, null] });

export const emptyLayout = (): TeamLayout =>
  Array.from({ length: TEAM_COUNT }, () =>
    Array.from({ length: TEAM_SIZE }, emptySlot)
  );

export const cloneLayout = (layout: TeamLayout): TeamLayout =>
  layout.map((team) =>
    team.map((slot) => ({ hero: slot.hero, skills: [slot.skills[0], slot.skills[1]] }))
  );

export const layoutPoolKey = (heroes: string[], skills: string[]): string =>
  JSON.stringify([[...new Set(heroes)].sort(), [...new Set(skills)].sort()]);

export const sameLayout = (a: TeamLayout, b: TeamLayout): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function placedItems(layout: TeamLayout): { heroes: Set<string>; skills: Set<string> } {
  const heroes = new Set<string>();
  const skills = new Set<string>();
  for (const team of layout) {
    for (const slot of team) {
      if (slot.hero) heroes.add(slot.hero);
      for (const skill of slot.skills) if (skill) skills.add(skill);
    }
  }
  return { heroes, skills };
}

/**
 * Keep only pool items, each at most once, never a skill without a hero, and
 * never a hero's own signature skill.
 */
export function normalizeLayout(
  layout: unknown,
  heroes: string[],
  skills: string[],
  defaultSkill: Record<string, string>
): TeamLayout {
  const result = emptyLayout();
  if (!Array.isArray(layout)) return result;
  const heroPool = new Set(heroes);
  const skillPool = new Set(skills);
  const usedHeroes = new Set<string>();
  const usedSkills = new Set<string>();
  for (let t = 0; t < TEAM_COUNT; t++) {
    const team = layout[t];
    if (!Array.isArray(team)) continue;
    for (let s = 0; s < TEAM_SIZE; s++) {
      const slot = team[s] as Partial<TeamSlot> | undefined;
      const hero = typeof slot?.hero === 'string' ? slot.hero : null;
      if (!hero || !heroPool.has(hero) || usedHeroes.has(hero)) continue;
      usedHeroes.add(hero);
      result[t][s].hero = hero;
      const slotSkills = Array.isArray(slot?.skills) ? slot.skills : [];
      for (const k of [0, 1] as const) {
        const skill = slotSkills[k];
        if (
          typeof skill === 'string' &&
          skillPool.has(skill) &&
          !usedSkills.has(skill) &&
          skill !== defaultSkill[hero]
        ) {
          usedSkills.add(skill);
          result[t][s].skills[k] = skill;
        }
      }
    }
  }
  return result;
}

function findItem(layout: TeamLayout, kind: MoveSource['kind'], name: string): LayoutPosition | null {
  for (let t = 0; t < layout.length; t++) {
    for (let s = 0; s < layout[t].length; s++) {
      const slot = layout[t][s];
      if (kind === 'hero' && slot.hero === name) return { team: t, slot: s, field: 'hero' };
      if (kind === 'skill') {
        const k = slot.skills.indexOf(name);
        if (k === 0 || k === 1) return { team: t, slot: s, field: k };
      }
    }
  }
  return null;
}

const samePosition = (a: LayoutPosition, b: LayoutPosition) =>
  a.team === b.team && a.slot === b.slot && a.field === b.field;

/**
 * Apply one move. A hero carries its skills; moving onto an occupied slot swaps
 * the two slots. Invalid moves return the layout unchanged.
 */
export function applyMove(
  layout: TeamLayout,
  source: MoveSource,
  target: MoveTarget,
  defaultSkill: Record<string, string>
): TeamLayout {
  const from = source.from ?? findItem(layout, source.kind, source.name);
  const next = cloneLayout(layout);

  if (target === null) {
    if (!from) return layout;
    if (source.kind === 'hero') next[from.team][from.slot] = emptySlot();
    else if (from.field !== 'hero') next[from.team][from.slot].skills[from.field] = null;
    return next;
  }

  if (from && samePosition(from, target)) return layout;
  const targetSlot = next[target.team]?.[target.slot];
  if (!targetSlot) return layout;

  if (source.kind === 'hero') {
    if (target.field !== 'hero') return layout;
    if (from) {
      next[target.team][target.slot] = layout[from.team][from.slot];
      next[from.team][from.slot] = layout[target.team][target.slot];
      return cloneLayout(next);
    }
    const signature = defaultSkill[source.name];
    targetSlot.hero = source.name;
    targetSlot.skills = [
      targetSlot.skills[0] === signature ? null : targetSlot.skills[0],
      targetSlot.skills[1] === signature ? null : targetSlot.skills[1],
    ];
    return next;
  }

  if (target.field === 'hero' || !targetSlot.hero) return layout;
  if (defaultSkill[targetSlot.hero] === source.name) return layout;
  const displaced = targetSlot.skills[target.field];
  if (from && from.field !== 'hero') {
    const fromSlot = next[from.team][from.slot];
    if (displaced && fromSlot.hero && defaultSkill[fromSlot.hero] === displaced) return layout;
    fromSlot.skills[from.field] = displaced;
  }
  next[target.team][target.slot].skills[target.field] = source.name;
  return next;
}

export function parseStoredTeamBuilder(raw: unknown): StoredTeamBuilder | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<StoredTeamBuilder>;
  if (
    value.version !== TEAM_BUILDER_STORAGE_VERSION ||
    (value.mode !== 'auto' && value.mode !== 'manual') ||
    typeof value.poolKey !== 'string' ||
    !Array.isArray(value.layout)
  ) {
    return null;
  }
  return value as StoredTeamBuilder;
}
