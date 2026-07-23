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
  paired_scores: number[];
  recommended_index: number;
  chosen_index: number;
  preference_model_version: string | null;
  preference_probabilities: number[] | null;
}

export interface RoundTelemetryInput {
  roundNumber: number;
  roundType: RoundType;
  poolBefore: {
    heroes: string[];
    skills: string[];
    heroSupport?: string;
    skillsSupport?: string[];
  };
  offeredSets: string[][];
  pairedScores: number[];
  recommendedIndex: number;
  chosenIndex: number;
  preferenceModelVersion?: string | null;
  preferenceProbabilities?: number[] | null;
}
