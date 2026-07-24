import type { RoundType } from './game';

export type PreferenceModelStatus =
  | 'insufficient_evidence'
  | 'quality_gate_failed'
  | 'ready';

export interface PreferenceEvidence {
  event_count: number;
  session_count: number;
  recommendation_disagreement_count: number;
  minimum_event_count: number;
  minimum_session_count: number;
  minimum_recommendation_disagreement_count: number;
  holdout_event_count: number;
  minimum_holdout_event_count: number;
}

export interface IncrementalPreferenceEvidence {
  event_count: number;
  estimated_session_count: number;
  recommendation_disagreement_count: number;
  minimum_event_count: number;
  minimum_estimated_session_count: number;
  minimum_recommendation_disagreement_count: number;
  evaluation_event_count: number;
  minimum_evaluation_event_count: number;
}

export interface PreferenceMetrics {
  event_count: number;
  accuracy: number | null;
  log_loss: number | null;
  brier: number | null;
  calibration_error: number | null;
}

export interface PreferenceHeldOutMetrics extends PreferenceMetrics {
  train_event_count: number;
  paired_accuracy: number;
  uniform_log_loss: number;
}

export interface PreferenceEvaluation extends PreferenceMetrics {
  method: 'prequential';
  calibration_event_count: number;
  paired_accuracy: number | null;
  uniform_log_loss: number;
}

interface PreferenceModelArtifactBase {
  model_type: 'conditional-choice-logit';
  meaningful_probability_margin: number;
  l2: number;
  status: PreferenceModelStatus;
  version: string | null;
  weights: Record<string, number>;
  support: Record<string, number>;
}

export interface PreferenceModelArtifactV3
  extends PreferenceModelArtifactBase {
  feature_schema_version: 1;
  evidence: PreferenceEvidence;
  held_out: PreferenceHeldOutMetrics | null;
}

export interface PreferenceModelArtifactV4
  extends PreferenceModelArtifactBase {
  feature_schema_version: 2;
  semantics_version: 2;
  algorithm: 'ftrl-proximal';
  minimum_persisted_event_support: 10;
  evidence: IncrementalPreferenceEvidence;
  evaluation: PreferenceEvaluation;
}

export type PreferenceModelArtifact =
  | PreferenceModelArtifactV3
  | PreferenceModelArtifactV4;

export interface TelemetryRoundAggregate {
  round_number: number;
  round_type: RoundType;
  event_count: number;
  recommendation_accepted_count: number;
  chosen_position_counts: [number, number, number];
  recommended_position_counts: [number, number, number];
  rate_suppressed?: boolean;
  preference_top_disagreement_count?: number | null;
  meaningful_preference_disagreement_count?: number | null;
  player_preference_agreement_count?: number | null;
  average_meaningful_preference_disagreement_margin?: number | null;
}

export interface TelemetryItemAggregate {
  name: string;
  offer_count: number;
  opportunity_count: number;
  picked_count: number;
  rate_suppressed: boolean;
}

export interface ScoreMarginAggregate {
  key: 'tie' | '0_to_1' | '1_to_3' | 'over_3';
  label: string;
  event_count: number;
  recommendation_accepted_count: number;
  rate_suppressed: boolean;
}

export interface TelemetryAnalytics {
  minimum_rate_support: number;
  items: {
    heroes: TelemetryItemAggregate[];
    skills: TelemetryItemAggregate[];
  };
  score_margins: ScoreMarginAggregate[];
}

export interface TelemetryData {
  schema: {
    version: 2 | 3 | 4;
    source_event_schema_version: number;
  };
  catalog_version: string;
  summary: {
    event_count: number;
    invalid_event_count: number;
    /** Exact count in the frozen schema-v2/v3 contracts. */
    session_count?: number;
    /** Aggregate-only estimate introduced by schema v4. */
    estimated_session_count?: number;
    recommendation_accepted_count?: number;
    preference_event_count: number;
    model_versions: { version: string; event_count: number }[];
    preference_model_versions: { version: string; event_count: number }[];
  };
  rounds: TelemetryRoundAggregate[];
  /** Schema v2 uses null; schema v3/v4 emit a status-bearing object. */
  preference_model: PreferenceModelArtifact | null;
  /** Added in schema v3; absent from the frozen schema-v2 hand-off. */
  analytics?: TelemetryAnalytics;
}

export interface PreferencePrediction {
  version: string;
  probabilities: [number, number, number];
  top_index: number;
  probability_margin: number;
  meaningful_margin: number;
  /**
   * Complete, non-causal sentence describing up to two readable model signals
   * for the preference-top option versus the paired-model top option.
   */
  explanation_driver: string;
}
