import type { RoundType } from './game';

export interface RoundTelemetryEvent {
  event_id: string;
  session_id: string;
  client_ts: string;
  round_number: number;
  round_type: RoundType;
  schema_version: 1;
  model_version: string;
  catalog_version: string;
  pool_before: {
    heroes: string[];
    skills: string[];
    hero_support?: string;
    skills_support?: string[];
  };
  offered_sets: string[][];
  /** The model's lineup score for each offered set. */
  paired_scores: number[];
  recommended_index: number;
  chosen_index: number;
  /** Kept for the stored schema; the app no longer predicts player preference. */
  preference_model_version: null;
  preference_probabilities: null;
}

export interface RoundTelemetryInput {
  roundNumber: number;
  roundType: RoundType;
  modelVersion: string;
  poolBefore: {
    heroes: string[];
    skills: string[];
    heroSupport?: string;
    skillsSupport?: string[];
  };
  offeredSets: string[][];
  scores: number[];
  recommendedIndex: number;
  chosenIndex: number;
}
