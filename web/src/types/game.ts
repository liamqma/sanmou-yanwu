/**
 * Game-state, reducer-action, and context types.
 * Mirrors `context/GameContext` and `services/gameLogic`.
 */
import type { Dispatch } from 'react';
import type { HeroRanking, SkillCategory, SkillRanking } from './domain';
import type { UnknownCards } from '../services/lineupProtocol';
import type { TeamView } from '../services/lineupSearch';

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
  /** Absent until the player wins the qualification between rounds 6 and 7. */
  round7_interstitial_dismissed?: boolean;
  /** Absent until the player wins the qualification between rounds 8 and 9. */
  round9_interstitial_dismissed?: boolean;
}

/** Per-hero / per-skill display metadata derived from database.json. */
export interface HeroMeta {
  ranking?: HeroRanking;
  season?: number;
}
export interface SkillMeta {
  ranking?: SkillRanking;
  category?: SkillCategory;
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

/** The best lineup the model finds when one offered set joins the pool. */
export interface OptionAnalysis {
  set_index: number;
  /** Lineup score; only differences between options are meaningful. */
  score: number;
  /** `score` minus the best option's score: 0 for the recommended set. */
  gap: number;
  teams: TeamView[];
}

/** Recommendation produced by `api.getRecommendation` and stored in state. */
export interface Recommendation {
  recommended_set_index: number;
  recommended_set: string[];
  analysis: OptionAnalysis[];
  model_version: string;
  unknown: UnknownCards;
  round_info: { round_number: number; round_type: RoundType };
}

export interface ReducerState {
  gameState: GameState | null;
  currentRoundInputs: CurrentRoundInputs;
  selectedOptionIndex: number | null;
  currentRecommendation: Recommendation | null;
  rosterRevision: number;
  recommendationRosterRevision: number | null;
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
  | { type: 'SET_RECOMMENDATION'; recommendation: Recommendation; rosterRevision: number }
  | { type: 'RESCORE_RECOMMENDATION'; recommendation: Recommendation; rosterRevision: number }
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
  | { type: 'DISMISS_ROUND_INTERSTITIAL'; roundNumber: 7 | 9 }
  | { type: 'UPDATE_TEAM'; heroes: string[]; skills: string[] }
  | { type: 'SET_SUPPORT_HERO'; hero: string }
  | { type: 'SET_SUPPORT_SKILLS'; skills: string[] }
  | { type: 'REMOVE_SUPPORT_HERO' }
  | { type: 'REMOVE_SUPPORT_SKILL'; skill: string };

export interface GameContextValue {
  state: ReducerState;
  dispatch: Dispatch<GameAction>;
}
