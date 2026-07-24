/**
 * Game-state, reducer-action, and context types.
 * Mirrors `context/GameContext` and `services/gameLogic`.
 */
import type { Dispatch } from 'react';

export type RoundType = 'hero' | 'skill';

/** The three option-set input slots for a round. */
export type SetName = 'set1' | 'set2' | 'set3';
export type CurrentRoundInputs = Record<SetName, string[]>;

export interface RoundHistory {
  round_number: number;
  round_type: RoundType;
  chosen_set: string[];
  set_index: number;
}

export interface GameState {
  current_heroes: string[];
  current_skills: string[];
  support_hero: string | null;
  support_skills: string[];
  round_number: number;
  round_history: RoundHistory[];
  /** Added by the DISMISS_ROUND7_INTERSTITIAL action; absent initially. */
  round7_interstitial_dismissed?: boolean;
}

/** Per-hero / per-skill display metadata derived from database.json. */
export interface HeroMeta {
  label?: string;
  rank?: number;
  season?: number;
}
export interface SkillMeta {
  tier?: string;
  note?: string;
  season?: number;
}

/** Database items loaded into state (also the shape api.getDatabaseItems returns). */
export interface DatabaseItems {
  heroes: string[];
  heroMetadata: Record<string, HeroMeta>;
  skillMetadata: Record<string, SkillMeta>;
  skills: string[];
  regularSkills: string[];
  orangeRegularSkills: string[];
  heroSkills: string[];
  /** Latest season represented by either the hero or skill catalog. */
  maxSeason: number;
}

/**
 * Formatted recommendation produced by `api.getRecommendation` and stored in
 * state. `analysis` is the per-option roster-strength analysis (see
 * `services/recommendationEngine` → `OptionAnalysis`); typed as `unknown[]` here
 * to avoid a cross-import cycle — `AnalysisGrid` narrows it.
 */
export interface Recommendation {
  recommended_set_index?: number;
  recommended_set?: string[];
  analysis?: unknown[];
  round_info?: { round_number: number; round_type: RoundType; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ReducerState {
  gameState: GameState | null;
  currentRoundInputs: CurrentRoundInputs;
  selectedOptionIndex: number | null;
  currentRecommendation: Recommendation | null;
  isLoading: boolean;
  error: string | null;
  availableHeroes: string[];
  heroMetadata: Record<string, HeroMeta>;
  skillMetadata: Record<string, SkillMeta>;
  availableSkills: string[];
  regularSkills: string[];
  orangeRegularSkills: string[];
  heroSkills: string[];
  maxSeason: number;
  selectedSeason: number;
  databaseLoaded: boolean;
  /** Set by RECORD_CHOICE; absent until the first choice is recorded. */
  gameComplete?: boolean;
}

export type GameAction =
  | { type: 'START_GAME'; heroes: string[]; skills: string[] }
  | { type: 'RESTORE_PROGRESS'; payload: { gameState: GameState; currentRoundInputs?: CurrentRoundInputs } }
  | { type: 'UPDATE_ROUND_INPUT'; setName: SetName; items: string[] }
  | { type: 'SET_RECOMMENDATION'; recommendation: Recommendation }
  | { type: 'SELECT_OPTION'; index: number }
  | { type: 'SET_SEASON'; season: number }
  | { type: 'RECORD_CHOICE'; roundType: RoundType; chosenSet: string[]; setIndex: number }
  | { type: 'RESET_GAME' }
  | { type: 'SET_ERROR'; error: string }
  | {
      type: 'LOAD_DATABASE';
      heroes: string[];
      skills: string[];
      heroMetadata?: Record<string, HeroMeta>;
      skillMetadata?: Record<string, SkillMeta>;
      regularSkills?: string[];
      orangeRegularSkills?: string[];
      heroSkills?: string[];
      maxSeason?: number;
      selectedSeason?: number;
    }
  | { type: 'DISMISS_ROUND7_INTERSTITIAL' }
  | { type: 'UPDATE_TEAM'; heroes: string[]; skills: string[] }
  | { type: 'SET_SUPPORT_HERO'; hero: string }
  | { type: 'SET_SUPPORT_SKILLS'; skills: string[] }
  | { type: 'REMOVE_SUPPORT_HERO' }
  | { type: 'REMOVE_SUPPORT_SKILL'; skill: string };

export interface GameContextValue {
  state: ReducerState;
  dispatch: Dispatch<GameAction>;
}
