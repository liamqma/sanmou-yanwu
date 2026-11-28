import type { CardKind, LineupView, RankedCards } from './lineupSearch';

/** Cards of a request the model has never seen; they are scored as one generic unknown card. */
export interface UnknownCards {
  heroes: string[];
  skills: string[];
}

/** What the team builder shows about a layout as it stands. */
export interface LayoutEvaluation {
  /** Per team: mean predicted win rate against common teams, null for an empty team. */
  strengths: (number | null)[];
  unknown: UnknownCards;
}

export interface PickResult {
  /** Version of the model that produced the scores. */
  version: string;
  recommended: number;
  /** One best lineup per offered set, in the order the sets were given. */
  options: LineupView[];
  unknown: UnknownCards;
}

export interface SupportRanking {
  /** Lineup score of the pool before the support cards. */
  base: number;
  recommended: string[];
  /** Single cards, best first. */
  single: RankedCards[];
  /** Pairs of the leading cards, best first; empty when one card was asked for. */
  pairs: RankedCards[];
}

/** A layout as the model sees it: 9 hero slots and 18 skill slots, '' for empty. */
export interface LayoutCards {
  layoutHeroes: string[];
  layoutSkills: string[];
}

interface Pool {
  heroes: string[];
  skills: string[];
}

export interface LineupTasks {
  lineup: { input: Pool; output: LineupView };
  fill: { input: Pool & LayoutCards; output: LineupView };
  evaluate: { input: LayoutCards; output: LayoutEvaluation };
  pick: { input: Pool & { options: string[][]; kind: CardKind }; output: PickResult };
  support: {
    input: Pool & { kind: CardKind; count: number; candidates: string[] };
    output: SupportRanking;
  };
}

export type LineupTask = keyof LineupTasks;

export type LineupRequest = {
  [Task in LineupTask]: { id: number; task: Task; input: LineupTasks[Task]['input'] };
}[LineupTask];

export type LineupResponse =
  | { id: number; progress: number }
  | { id: number; output: unknown }
  | { id: number; error: string }
  /** A newer request of the same task arrived before this one started. */
  | { id: number; superseded: true };
