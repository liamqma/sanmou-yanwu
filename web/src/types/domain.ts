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

export type HeroRanking = 'S' | 'A' | 'B' | 'C' | 'D';

export interface Hero {
  skill: string;
  camp: string;
  troop: string;
  stats: HeroStats;
  /** First season in which the hero is available. */
  season: number;
  /** Presentation tier from the source guide; never used as a model score. */
  ranking: HeroRanking;
}

export type SkillColor = 'orange' | 'purple';
export type SkillType = '主动' | '指挥' | '被动' | '追击';

export interface Skill {
  color: SkillColor;
  type: SkillType;
  prob: number;
  desc: string;
  /** First season in which the skill is available. */
  season: number;
  /** A transferred/split hero skill that follows hero-skill draft rules. */
  shadow?: boolean;
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

export type TeamRanking = 'S' | 'A' | 'B';
export type TeamSource = 'strong' | 'championship';

export interface TeamMember {
  hero: string;
  /** Each inner array lists the interchangeable choices for one skill slot. */
  skillSlots: [string[], string[]];
}

/** One guide-backed known team (an entry in `database.json` → `team`). */
export interface TeamComp {
  id: string;
  ranking: TeamRanking;
  sources: TeamSource[];
  section: string;
  formation: string;
  members: [TeamMember, TeamMember, TeamMember];
}

export type MatchupOutcome =
  | 'largeAdvantage'
  | 'smallAdvantage'
  | 'even'
  | 'smallDisadvantage'
  | 'largeDisadvantage'
  | 'self';

export interface YanwuGuideSource {
  provider: '三谋吕布';
  workbook: '三谋吕布-演武.xlsx';
  updatedAt: string;
  attribution: '攻略数据由三谋吕布提供';
}

export interface YanwuGuideMatchups {
  orientation: 'column-build-vs-row-build';
  buildIds: string[];
  outcomes: MatchupOutcome[][];
}

export interface YanwuChampionshipGroup {
  id: string;
  teamIds: string[];
}

export interface YanwuAnalysisSection {
  section: string;
  subject: string;
  points: string[];
}

export interface YanwuGuide {
  schemaVersion: number;
  source: YanwuGuideSource;
  matchups: YanwuGuideMatchups;
  championshipGroups: YanwuChampionshipGroup[];
  analysisSections: YanwuAnalysisSection[];
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
  yanwuGuide: YanwuGuide;
}

/** Eager client payload; the full guide is loaded only on its dedicated route. */
export type GameplayDatabase = Omit<Database, 'yanwuGuide'>;
