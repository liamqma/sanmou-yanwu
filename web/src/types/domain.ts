/**
 * Domain types for `database.json` — the source data for heroes, skills,
 * bonds, formations, buffs/debuffs, and known team compositions.
 */

/** Base attributes: 武力 / 智力 / 统率 / 先攻. */
export interface HeroStats {
  wl: number;
  zl: number;
  ts: number;
  xg: number;
}

export interface Hero {
  skill: string;
  camp: string;
  troop: string;
  stats: HeroStats;
  label?: string;
  rank?: number;
}

export type SkillColor = 'orange' | 'purple';
export type SkillType = '主动' | '指挥' | '被动' | '追击';

export interface Skill {
  color: SkillColor;
  type: SkillType;
  prob: number;
  desc: string;
  tier?: string;
  note?: string;
  /** Optional numeric estimate fields, e.g. `damageEstimate`, `critEstimate`. */
  [estimate: `${string}Estimate`]: number | undefined;
}

export interface Bond {
  content: string;
  condition: string;
  members: string[];
}

export interface Buff {
  name: string;
  effect: string;
  functional: boolean;
}

export interface Debuff {
  name: string;
  effect: string;
  negative: boolean;
  controlling: boolean;
}

/** A known team composition (the `team` array in database.json). */
export interface TeamComp {
  heroes: string[];
  tier: string;
  strengthRange?: string;
  note?: string;
}

export interface Database {
  heroes: Record<string, Hero>;
  skills: Record<string, Skill>;
  bonds: Record<string, Bond>;
  /** Formation name → description string. */
  formations: Record<string, string>;
  buffs: Record<string, Buff>;
  debuffs: Record<string, Debuff>;
  team: TeamComp[];
}
