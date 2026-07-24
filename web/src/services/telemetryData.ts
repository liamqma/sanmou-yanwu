import { recommendationData } from '../data';
import type { TelemetryData } from '../types/telemetryData';

const ENDPOINT = '/game-data/telemetry_data.json';
const STATIC_FETCH_TIMEOUT_MS = 5_000;

const MIN_RATE_SUPPORT = 10;
const MIN_MODEL_EVENTS = 240;
const MIN_MODEL_SESSIONS = 40;
const MIN_MODEL_DISAGREEMENTS = 30;
const MIN_HOLDOUT_EVENTS = 36;
const MIN_EVALUATION_EVENTS = 36;
const MIN_FEATURE_SUPPORT = 10;
const MAX_MODEL_VERSIONS = 32;
const MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS = 32;
const MAX_PREFERENCE_FEATURES = 5_000;
const MEANINGFUL_PREFERENCE_MARGIN = 0.1;
const PREFERENCE_L2 = 0.05;
const ONLINE_MODEL_SEMANTICS_VERSION = 2;
const ONLINE_MODEL_ALGORITHM = 'ftrl-proximal';
const MIN_PERSISTED_EVENT_SUPPORT = 10;
const MIN_HELD_OUT_LOG_LOSS_IMPROVEMENT = 0.01;
const UNIFORM_LOG_LOSS = 1.098612288668;
const MODEL_VERSION_OTHER_BUCKET = 'other';
const PREFERENCE_VERSION_OTHER_BUCKET = 'other';

const ROUND_TYPES = [
  'hero',
  'skill',
  'skill',
  'hero',
  'skill',
  'skill',
  'hero',
  'skill',
] as const;
const SCORE_MARGIN_KEYS = ['tie', '0_to_1', '1_to_3', 'over_3'] as const;
const SCORE_MARGIN_LABELS = [
  '并列',
  '0–1 分',
  '1–3 分',
  '超过 3 分',
] as const;
const MODEL_VERSION_RE = /^[1-9]\d*:[0-9a-f]{16}$/;
const PREFERENCE_MODEL_VERSION_RE =
  /^preference-v[1-9]\d*:[0-9a-f]{16}$/;
const READY_PREFERENCE_MODEL_VERSION_RE =
  /^preference-v1:[0-9a-f]{16}$/;
const READY_INCREMENTAL_PREFERENCE_MODEL_VERSION_RE =
  /^preference-v2:[0-9a-f]{16}$/;

const V2_TOP_LEVEL_KEYS = [
  'schema',
  'catalog_version',
  'summary',
  'rounds',
  'preference_model',
] as const;
const V3_TOP_LEVEL_KEYS = [...V2_TOP_LEVEL_KEYS, 'analytics'] as const;
const SCHEMA_KEYS = ['version', 'source_event_schema_version'] as const;
const V2_SUMMARY_KEYS = [
  'event_count',
  'invalid_event_count',
  'session_count',
  'preference_event_count',
  'model_versions',
  'preference_model_versions',
] as const;
const V3_SUMMARY_KEYS = [
  'event_count',
  'invalid_event_count',
  'session_count',
  'recommendation_accepted_count',
  'preference_event_count',
  'model_versions',
  'preference_model_versions',
] as const;
const V4_SUMMARY_KEYS = [
  'event_count',
  'invalid_event_count',
  'estimated_session_count',
  'recommendation_accepted_count',
  'preference_event_count',
  'model_versions',
  'preference_model_versions',
] as const;
const V2_ROUND_KEYS = [
  'round_number',
  'round_type',
  'event_count',
  'recommendation_accepted_count',
  'chosen_position_counts',
  'recommended_position_counts',
] as const;
const V3_ROUND_KEYS = [
  ...V2_ROUND_KEYS,
  'rate_suppressed',
  'preference_top_disagreement_count',
  'meaningful_preference_disagreement_count',
  'player_preference_agreement_count',
  'average_meaningful_preference_disagreement_margin',
] as const;
const VERSION_COUNT_KEYS = ['version', 'event_count'] as const;
const V3_PREFERENCE_MODEL_KEYS = [
  'model_type',
  'feature_schema_version',
  'meaningful_probability_margin',
  'l2',
  'evidence',
  'status',
  'version',
  'held_out',
  'weights',
  'support',
] as const;
const V4_PREFERENCE_MODEL_KEYS = [
  'model_type',
  'feature_schema_version',
  'semantics_version',
  'algorithm',
  'meaningful_probability_margin',
  'l2',
  'minimum_persisted_event_support',
  'evidence',
  'status',
  'version',
  'evaluation',
  'weights',
  'support',
] as const;
const V3_EVIDENCE_KEYS = [
  'event_count',
  'session_count',
  'recommendation_disagreement_count',
  'minimum_event_count',
  'minimum_session_count',
  'minimum_recommendation_disagreement_count',
  'holdout_event_count',
  'minimum_holdout_event_count',
] as const;
const V4_EVIDENCE_KEYS = [
  'event_count',
  'estimated_session_count',
  'recommendation_disagreement_count',
  'minimum_event_count',
  'minimum_estimated_session_count',
  'minimum_recommendation_disagreement_count',
  'evaluation_event_count',
  'minimum_evaluation_event_count',
] as const;
const V3_HELD_OUT_KEYS = [
  'event_count',
  'accuracy',
  'log_loss',
  'brier',
  'calibration_error',
  'train_event_count',
  'paired_accuracy',
  'uniform_log_loss',
] as const;
const V4_EVALUATION_KEYS = [
  'method',
  'event_count',
  'calibration_event_count',
  'accuracy',
  'log_loss',
  'brier',
  'calibration_error',
  'paired_accuracy',
  'uniform_log_loss',
] as const;
const ANALYTICS_KEYS = [
  'minimum_rate_support',
  'items',
  'score_margins',
] as const;
const ITEM_FAMILY_KEYS = ['heroes', 'skills'] as const;
const ITEM_KEYS = [
  'name',
  'offer_count',
  'opportunity_count',
  'picked_count',
  'rate_suppressed',
] as const;
const SCORE_MARGIN_KEYS_REQUIRED = [
  'key',
  'label',
  'event_count',
  'recommendation_accepted_count',
  'rate_suppressed',
] as const;

let cached: Promise<TelemetryData> | null = null;
let resolved: TelemetryData | null = null;
let cachedController: AbortController | null = null;
let cacheGeneration = 0;

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isShortString = (
  value: unknown,
  maximum = 128
): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum;
const hasExactKeys = (
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

const validPositionCounts = (value: unknown, expectedTotal: number): boolean =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(isCount) &&
  value.reduce((sum, count) => sum + count, 0) === expectedTotal;

const validVersionCounts = (
  value: unknown,
  expectedTotal: number,
  maximumEntries: number,
  validEntry: (version: string, eventCount: number) => boolean
): boolean => {
  if (!Array.isArray(value) || value.length > maximumEntries) return false;
  let total = 0;
  let previousVersion: string | null = null;
  for (const entry of value) {
    if (
      !hasExactKeys(entry, VERSION_COUNT_KEYS) ||
      !isShortString(entry.version) ||
      !isCount(entry.event_count) ||
      entry.event_count === 0 ||
      !validEntry(entry.version, entry.event_count) ||
      (previousVersion !== null && previousVersion >= entry.version)
    ) {
      return false;
    }
    previousVersion = entry.version;
    total += entry.event_count;
  }
  return total === expectedTotal;
};

const preferenceFeatureParts = (featureId: string): unknown[] | null => {
  if (!isShortString(featureId, 512)) return null;
  let parts: unknown;
  try {
    parts = JSON.parse(featureId);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    JSON.stringify(parts) !== featureId
  ) {
    return null;
  }
  const item = (value: unknown) => isShortString(value, 64);
  if (parts.length === 1 && parts[0] === 'score') return parts;
  if (
    parts.length === 2 &&
    parts[0] === 'round_score' &&
    Number.isInteger(parts[1]) &&
    (parts[1] as number) >= 1 &&
    (parts[1] as number) <= 8
  ) {
    return parts;
  }
  if (
    parts.length === 2 &&
    parts[0] === 'position' &&
    Number.isInteger(parts[1]) &&
    (parts[1] as number) >= 0 &&
    (parts[1] as number) <= 2
  ) {
    return parts;
  }
  if (
    parts.length === 3 &&
    parts[0] === 'item' &&
    (parts[1] === 'hero' || parts[1] === 'skill') &&
    item(parts[2])
  ) {
    return parts;
  }
  if (
    parts.length === 5 &&
    parts[0] === 'pool_item' &&
    (parts[1] === 'hero' || parts[1] === 'skill') &&
    item(parts[2]) &&
    (parts[3] === 'hero' || parts[3] === 'skill') &&
    item(parts[4])
  ) {
    return parts;
  }
  return null;
};

const validateRounds = (
  rounds: unknown,
  schemaVersion: 2 | 3 | 4
): { totalEvents: number; totalAccepted: number } => {
  if (!Array.isArray(rounds) || rounds.length !== 8) {
    throw new Error('Telemetry artifact contract is invalid');
  }

  let totalEvents = 0;
  let totalAccepted = 0;
  rounds.forEach((round, index) => {
    const expectedKeys = schemaVersion === 2 ? V2_ROUND_KEYS : V3_ROUND_KEYS;
    if (
      !hasExactKeys(round, expectedKeys) ||
      round.round_number !== index + 1 ||
      round.round_type !== ROUND_TYPES[index] ||
      !isCount(round.event_count) ||
      !isCount(round.recommendation_accepted_count) ||
      round.recommendation_accepted_count > round.event_count ||
      !validPositionCounts(round.chosen_position_counts, round.event_count) ||
      !validPositionCounts(round.recommended_position_counts, round.event_count) ||
      (schemaVersion !== 2 &&
        round.rate_suppressed !== (round.event_count < MIN_RATE_SUPPORT))
    ) {
      throw new Error(`Telemetry round ${index + 1} is invalid`);
    }
    totalEvents += round.event_count;
    totalAccepted += round.recommendation_accepted_count;
  });
  return { totalEvents, totalAccepted };
};

const validateSummary = (
  summary: unknown,
  schemaVersion: 2 | 3 | 4,
  totalEvents: number,
  totalAccepted: number
): Record<string, unknown> => {
  const expectedKeys =
    schemaVersion === 2
      ? V2_SUMMARY_KEYS
      : schemaVersion === 3
        ? V3_SUMMARY_KEYS
        : V4_SUMMARY_KEYS;
  const sessionCount =
    schemaVersion === 4
      ? isRecord(summary)
        ? summary.estimated_session_count
        : undefined
      : isRecord(summary)
        ? summary.session_count
        : undefined;
  if (
    !hasExactKeys(summary, expectedKeys) ||
    !isCount(summary.event_count) ||
    !isCount(summary.invalid_event_count) ||
    !isCount(sessionCount) ||
    sessionCount > totalEvents ||
    !isCount(summary.preference_event_count) ||
    summary.preference_event_count > totalEvents
  ) {
    throw new Error('Telemetry artifact contract is invalid');
  }
  if (summary.event_count !== totalEvents) {
    throw new Error('Telemetry event totals are inconsistent');
  }
  if (
    schemaVersion !== 2 &&
    (!isCount(summary.recommendation_accepted_count) ||
      summary.recommendation_accepted_count !== totalAccepted)
  ) {
    throw new Error('Telemetry summary totals are inconsistent');
  }
  if (
    !validVersionCounts(
      summary.model_versions,
      totalEvents,
      MAX_MODEL_VERSIONS,
      (version) =>
        (schemaVersion === 4 && version === MODEL_VERSION_OTHER_BUCKET) ||
        MODEL_VERSION_RE.test(version)
    ) ||
    !validVersionCounts(
      summary.preference_model_versions,
      summary.preference_event_count,
      MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS,
      (version, eventCount) =>
        version === PREFERENCE_VERSION_OTHER_BUCKET ||
        (PREFERENCE_MODEL_VERSION_RE.test(version) &&
          eventCount >= MIN_RATE_SUPPORT)
    )
  ) {
    throw new Error('Telemetry artifact version totals are inconsistent');
  }
  return summary;
};

const validHeldOutMetrics = (
  heldOut: unknown,
  totalEvents: number,
  holdoutEventCount: number
): heldOut is Record<string, unknown> => {
  if (
    !hasExactKeys(heldOut, V3_HELD_OUT_KEYS) ||
    !isCount(heldOut.event_count) ||
    heldOut.event_count !== holdoutEventCount ||
    !isCount(heldOut.train_event_count) ||
    heldOut.train_event_count === 0 ||
    heldOut.train_event_count + heldOut.event_count !== totalEvents
  ) {
    return false;
  }
  const finiteFields = [
    'accuracy',
    'log_loss',
    'brier',
    'calibration_error',
    'paired_accuracy',
    'uniform_log_loss',
  ] as const;
  if (!finiteFields.every((field) => isFiniteNumber(heldOut[field]))) {
    return false;
  }
  const unitIntervalFields = [
    'accuracy',
    'brier',
    'calibration_error',
    'paired_accuracy',
  ] as const;
  return (
    unitIntervalFields.every(
      (field) =>
        (heldOut[field] as number) >= 0 &&
        (heldOut[field] as number) <= 1
    ) &&
    (heldOut.log_loss as number) >= 0 &&
    heldOut.uniform_log_loss === UNIFORM_LOG_LOSS
  );
};

const validReadyCoefficients = (
  weights: Record<string, unknown>,
  support: Record<string, unknown>,
  featureSchemaVersion: 1 | 2
): boolean => {
  const featureIds = Object.keys(weights);
  const supportIds = Object.keys(support);
  if (
    featureIds.length === 0 ||
    featureIds.length > MAX_PREFERENCE_FEATURES ||
    featureIds.length !== supportIds.length ||
    featureIds.some((featureId) => !Object.hasOwn(support, featureId))
  ) {
    return false;
  }
  return featureIds.every((featureId) => {
    const parts = preferenceFeatureParts(featureId);
    const minimumSupport =
      parts?.[0] === 'round_score' ||
      (featureSchemaVersion === 2 && parts?.[0] === 'score')
        ? MIN_RATE_SUPPORT * 3
        : MIN_FEATURE_SUPPORT;
    return (
      parts !== null &&
      isFiniteNumber(weights[featureId]) &&
      isCount(support[featureId]) &&
      (support[featureId] as number) >= minimumSupport
    );
  });
};

const validateV3PreferenceModel = (
  value: unknown,
  summary: Record<string, unknown>,
  totalEvents: number
): 'insufficient_evidence' | 'quality_gate_failed' | 'ready' => {
  if (
    !hasExactKeys(value, V3_PREFERENCE_MODEL_KEYS) ||
    value.model_type !== 'conditional-choice-logit' ||
    value.feature_schema_version !== 1 ||
    value.meaningful_probability_margin !== MEANINGFUL_PREFERENCE_MARGIN ||
    value.l2 !== PREFERENCE_L2 ||
    (value.status !== 'insufficient_evidence' &&
      value.status !== 'quality_gate_failed' &&
      value.status !== 'ready') ||
    !hasExactKeys(value.evidence, V3_EVIDENCE_KEYS) ||
    !isRecord(value.weights) ||
    !isRecord(value.support)
  ) {
    throw new Error('Phase 3 telemetry preference model is invalid');
  }

  const evidence = value.evidence;
  const weights = value.weights;
  const support = value.support;
  if (
    !V3_EVIDENCE_KEYS.every((field) => isCount(evidence[field])) ||
    evidence.event_count !== totalEvents ||
    evidence.session_count !== summary.session_count ||
    !isCount(summary.recommendation_accepted_count) ||
    evidence.recommendation_disagreement_count !==
      totalEvents - summary.recommendation_accepted_count ||
    evidence.minimum_event_count !== MIN_MODEL_EVENTS ||
    evidence.minimum_session_count !== MIN_MODEL_SESSIONS ||
    evidence.minimum_recommendation_disagreement_count !==
      MIN_MODEL_DISAGREEMENTS ||
    evidence.minimum_holdout_event_count !== MIN_HOLDOUT_EVENTS ||
    (evidence.holdout_event_count as number) > totalEvents
  ) {
    throw new Error('Phase 3 telemetry preference evidence is inconsistent');
  }

  const evidenceSufficient =
    (evidence.event_count as number) >=
      (evidence.minimum_event_count as number) &&
    (evidence.session_count as number) >=
      (evidence.minimum_session_count as number) &&
    (evidence.recommendation_disagreement_count as number) >=
      (evidence.minimum_recommendation_disagreement_count as number) &&
    (evidence.holdout_event_count as number) >=
      (evidence.minimum_holdout_event_count as number);
  const status = value.status;

  if (status === 'insufficient_evidence') {
    if (
      value.version !== null ||
      value.held_out !== null ||
      Object.keys(weights).length !== 0 ||
      Object.keys(support).length !== 0 ||
      (evidenceSufficient && evidence.holdout_event_count !== totalEvents)
    ) {
      throw new Error('Phase 3 telemetry model status is inconsistent');
    }
    return status;
  }

  if (
    !evidenceSufficient ||
    !validHeldOutMetrics(
      value.held_out,
      totalEvents,
      evidence.holdout_event_count as number
    )
  ) {
    throw new Error('Phase 3 telemetry held-out metrics are inconsistent');
  }
  const qualityPassed =
    (value.held_out.uniform_log_loss as number) -
      (value.held_out.log_loss as number) >=
    MIN_HELD_OUT_LOG_LOSS_IMPROVEMENT;

  if (status === 'quality_gate_failed') {
    if (
      qualityPassed ||
      value.version !== null ||
      Object.keys(weights).length !== 0 ||
      Object.keys(support).length !== 0
    ) {
      throw new Error('Phase 3 telemetry model status is inconsistent');
    }
    return status;
  }

  if (
    !qualityPassed ||
    !isShortString(value.version) ||
    !READY_PREFERENCE_MODEL_VERSION_RE.test(value.version) ||
    !validReadyCoefficients(weights, support, 1)
  ) {
    throw new Error('Phase 3 telemetry ready model is invalid');
  }
  return status;
};

const validV4Evaluation = (
  evaluation: unknown,
  evaluationEventCount: number
): evaluation is Record<string, unknown> => {
  if (
    !hasExactKeys(evaluation, V4_EVALUATION_KEYS) ||
    evaluation.method !== 'prequential' ||
    !isCount(evaluation.event_count) ||
    evaluation.event_count !== evaluationEventCount ||
    !isCount(evaluation.calibration_event_count) ||
    evaluation.calibration_event_count > evaluation.event_count ||
    !isFiniteNumber(evaluation.uniform_log_loss) ||
    evaluation.uniform_log_loss !== UNIFORM_LOG_LOSS
  ) {
    return false;
  }

  if (evaluation.event_count === 0) {
    return (
      evaluation.calibration_event_count === 0 &&
      evaluation.accuracy === null &&
      evaluation.log_loss === null &&
      evaluation.brier === null &&
      evaluation.calibration_error === null &&
      evaluation.paired_accuracy === null
    );
  }

  if (
    !isFiniteNumber(evaluation.accuracy) ||
    !isFiniteNumber(evaluation.log_loss) ||
    !isFiniteNumber(evaluation.brier) ||
    !isFiniteNumber(evaluation.paired_accuracy) ||
    evaluation.accuracy < 0 ||
    evaluation.accuracy > 1 ||
    evaluation.log_loss < 0 ||
    evaluation.brier < 0 ||
    evaluation.brier > 1 ||
    evaluation.paired_accuracy < 0 ||
    evaluation.paired_accuracy > 1
  ) {
    return false;
  }

  return evaluation.calibration_event_count === 0
    ? evaluation.calibration_error === null
    : isFiniteNumber(evaluation.calibration_error) &&
        evaluation.calibration_error >= 0 &&
        evaluation.calibration_error <= 1;
};

const validateV4PreferenceModel = (
  value: unknown,
  summary: Record<string, unknown>,
  totalEvents: number
): 'insufficient_evidence' | 'quality_gate_failed' | 'ready' => {
  if (
    !hasExactKeys(value, V4_PREFERENCE_MODEL_KEYS) ||
    value.model_type !== 'conditional-choice-logit' ||
    value.feature_schema_version !== 2 ||
    value.semantics_version !== ONLINE_MODEL_SEMANTICS_VERSION ||
    value.algorithm !== ONLINE_MODEL_ALGORITHM ||
    value.meaningful_probability_margin !== MEANINGFUL_PREFERENCE_MARGIN ||
    value.l2 !== PREFERENCE_L2 ||
    value.minimum_persisted_event_support !== MIN_PERSISTED_EVENT_SUPPORT ||
    (value.status !== 'insufficient_evidence' &&
      value.status !== 'quality_gate_failed' &&
      value.status !== 'ready') ||
    !hasExactKeys(value.evidence, V4_EVIDENCE_KEYS) ||
    !isRecord(value.weights) ||
    !isRecord(value.support)
  ) {
    throw new Error('Schema-v4 telemetry preference model is invalid');
  }

  const evidence = value.evidence;
  const weights = value.weights;
  const support = value.support;
  if (
    !V4_EVIDENCE_KEYS.every((field) => isCount(evidence[field])) ||
    evidence.event_count !== totalEvents ||
    evidence.estimated_session_count !== summary.estimated_session_count ||
    !isCount(summary.recommendation_accepted_count) ||
    evidence.recommendation_disagreement_count !==
      totalEvents - summary.recommendation_accepted_count ||
    evidence.minimum_event_count !== MIN_MODEL_EVENTS ||
    evidence.minimum_estimated_session_count !== MIN_MODEL_SESSIONS ||
    evidence.minimum_recommendation_disagreement_count !==
      MIN_MODEL_DISAGREEMENTS ||
    evidence.minimum_evaluation_event_count !== MIN_EVALUATION_EVENTS ||
    (evidence.evaluation_event_count as number) > totalEvents ||
    !validV4Evaluation(
      value.evaluation,
      evidence.evaluation_event_count as number
    )
  ) {
    throw new Error('Schema-v4 telemetry preference evidence is inconsistent');
  }

  const evidenceSufficient =
    (evidence.event_count as number) >=
      (evidence.minimum_event_count as number) &&
    (evidence.estimated_session_count as number) >=
      (evidence.minimum_estimated_session_count as number) &&
    (evidence.recommendation_disagreement_count as number) >=
      (evidence.minimum_recommendation_disagreement_count as number) &&
    (evidence.evaluation_event_count as number) >=
      (evidence.minimum_evaluation_event_count as number);
  const evaluation = value.evaluation;
  const qualityPassed =
    evidenceSufficient &&
    isFiniteNumber(evaluation.log_loss) &&
    isFiniteNumber(evaluation.uniform_log_loss) &&
    evaluation.uniform_log_loss - evaluation.log_loss >=
      MIN_HELD_OUT_LOG_LOSS_IMPROVEMENT;
  const status = value.status;
  const isUnpublished =
    value.version === null &&
    Object.keys(weights).length === 0 &&
    Object.keys(support).length === 0;

  if (status === 'insufficient_evidence') {
    if (evidenceSufficient || !isUnpublished) {
      throw new Error('Schema-v4 telemetry model status is inconsistent');
    }
    return status;
  }

  if (status === 'quality_gate_failed') {
    if (!evidenceSufficient || !isUnpublished) {
      throw new Error('Schema-v4 telemetry model status is inconsistent');
    }
    return status;
  }

  if (
    !evidenceSufficient ||
    !qualityPassed ||
    !isShortString(value.version) ||
    !READY_INCREMENTAL_PREFERENCE_MODEL_VERSION_RE.test(value.version) ||
    !validReadyCoefficients(weights, support, 2)
  ) {
    throw new Error('Schema-v4 telemetry ready model is invalid');
  }
  return status;
};

const validatePreferenceRoundFields = (
  rounds: unknown,
  status: 'insufficient_evidence' | 'quality_gate_failed' | 'ready'
): void => {
  if (!Array.isArray(rounds)) {
    throw new Error('Phase 3 telemetry rounds are invalid');
  }
  for (const round of rounds) {
    if (!isRecord(round) || !isCount(round.event_count)) {
      throw new Error('Phase 3 telemetry rounds are invalid');
    }
    const preferenceCounts = [
      round.preference_top_disagreement_count,
      round.meaningful_preference_disagreement_count,
      round.player_preference_agreement_count,
    ];
    const eventCount = round.event_count;
    if (status !== 'ready') {
      if (
        preferenceCounts.some((count) => count !== null) ||
        round.average_meaningful_preference_disagreement_margin !== null
      ) {
        throw new Error(
          `Phase 3 telemetry round ${String(round.round_number)} is invalid`
        );
      }
      continue;
    }
    if (
      preferenceCounts.some(
        (count) => !isCount(count) || count > eventCount
      ) ||
      !isCount(round.preference_top_disagreement_count) ||
      !isCount(round.meaningful_preference_disagreement_count) ||
      round.meaningful_preference_disagreement_count >
        round.preference_top_disagreement_count
    ) {
      throw new Error(
        `Phase 3 telemetry round ${String(round.round_number)} is invalid`
      );
    }
    const meaningfulCount = round.meaningful_preference_disagreement_count;
    const averageMargin =
      round.average_meaningful_preference_disagreement_margin;
    if (
      (meaningfulCount >= MIN_RATE_SUPPORT &&
        (!isFiniteNumber(averageMargin) ||
          averageMargin < MEANINGFUL_PREFERENCE_MARGIN ||
          averageMargin > 1)) ||
      (meaningfulCount < MIN_RATE_SUPPORT && averageMargin !== null)
    ) {
      throw new Error(
        `Phase 3 telemetry round ${String(round.round_number)} is invalid`
      );
    }
  }
};

const validateItemRows = (
  value: unknown,
  expectedOpportunityCount: number
): { offerCount: number; pickedCount: number } | null => {
  if (!Array.isArray(value)) return null;
  let previousName: string | null = null;
  let offerCount = 0;
  let pickedCount = 0;
  for (const row of value) {
    if (
      !hasExactKeys(row, ITEM_KEYS) ||
      !isShortString(row.name, 64) ||
      (previousName !== null && previousName >= row.name) ||
      !isCount(row.offer_count) ||
      row.offer_count === 0 ||
      !isCount(row.opportunity_count) ||
      row.opportunity_count !== expectedOpportunityCount ||
      row.offer_count > row.opportunity_count ||
      !isCount(row.picked_count) ||
      row.picked_count > row.offer_count ||
      row.rate_suppressed !== (row.offer_count < MIN_RATE_SUPPORT)
    ) {
      return null;
    }
    previousName = row.name;
    offerCount += row.offer_count;
    pickedCount += row.picked_count;
  }
  return { offerCount, pickedCount };
};

const validateAnalytics = (
  value: unknown,
  rounds: unknown,
  totalEvents: number,
  totalAccepted: number,
  schemaVersion: 3 | 4
): void => {
  if (
    !hasExactKeys(value, ANALYTICS_KEYS) ||
    value.minimum_rate_support !== MIN_RATE_SUPPORT ||
    !hasExactKeys(value.items, ITEM_FAMILY_KEYS) ||
    !Array.isArray(rounds)
  ) {
    throw new Error('Phase 3 telemetry analytics are invalid');
  }
  const heroEvents = rounds.reduce(
    (total, round) =>
      total +
      (isRecord(round) && round.round_type === 'hero' && isCount(round.event_count)
        ? round.event_count
        : 0),
    0
  );
  const skillEvents = totalEvents - heroEvents;
  const heroTotals = validateItemRows(value.items.heroes, heroEvents);
  const skillTotals = validateItemRows(value.items.skills, skillEvents);
  if (
    !heroTotals ||
    !skillTotals ||
    !Array.isArray(value.score_margins) ||
    value.score_margins.length !== SCORE_MARGIN_KEYS.length
  ) {
    throw new Error('Phase 3 telemetry analytics are invalid');
  }
  if (schemaVersion === 4) {
    const expectedItemTotals = rounds.reduce(
      (totals, round) => {
        if (
          !isRecord(round) ||
          !isCount(round.round_number) ||
          !isCount(round.event_count) ||
          (round.round_type !== 'hero' && round.round_type !== 'skill')
        ) {
          return totals;
        }
        const family =
          round.round_type === 'hero' ? totals.heroes : totals.skills;
        const itemsPerOption = round.round_number === 7 ? 2 : 3;
        family.offerCount += round.event_count * itemsPerOption * 3;
        family.pickedCount += round.event_count * itemsPerOption;
        return totals;
      },
      {
        heroes: { offerCount: 0, pickedCount: 0 },
        skills: { offerCount: 0, pickedCount: 0 },
      }
    );
    if (
      heroTotals.offerCount !== expectedItemTotals.heroes.offerCount ||
      heroTotals.pickedCount !== expectedItemTotals.heroes.pickedCount ||
      skillTotals.offerCount !== expectedItemTotals.skills.offerCount ||
      skillTotals.pickedCount !== expectedItemTotals.skills.pickedCount
    ) {
      throw new Error('Schema-v4 telemetry item totals are inconsistent');
    }
  }

  let marginEvents = 0;
  let marginAccepted = 0;
  value.score_margins.forEach((row, index) => {
    if (
      !hasExactKeys(row, SCORE_MARGIN_KEYS_REQUIRED) ||
      row.key !== SCORE_MARGIN_KEYS[index] ||
      !isShortString(row.label) ||
      (schemaVersion === 4 && row.label !== SCORE_MARGIN_LABELS[index]) ||
      !isCount(row.event_count) ||
      !isCount(row.recommendation_accepted_count) ||
      row.recommendation_accepted_count > row.event_count ||
      row.rate_suppressed !== (row.event_count < MIN_RATE_SUPPORT)
    ) {
      throw new Error('Phase 3 telemetry score-margin analytics are invalid');
    }
    marginEvents += row.event_count;
    marginAccepted += row.recommendation_accepted_count;
  });
  if (marginEvents !== totalEvents || marginAccepted !== totalAccepted) {
    throw new Error('Phase 3 telemetry score-margin totals are inconsistent');
  }
};

export const parseTelemetryData = (value: unknown): TelemetryData => {
  if (!isRecord(value)) {
    throw new Error('Telemetry artifact must be an object');
  }
  if (
    !hasExactKeys(value.schema, SCHEMA_KEYS) ||
    (value.schema.version !== 2 &&
      value.schema.version !== 3 &&
      value.schema.version !== 4) ||
    value.schema.source_event_schema_version !== 1
  ) {
    throw new Error('Telemetry artifact contract is invalid');
  }
  const schemaVersion = value.schema.version;
  if (
    !hasExactKeys(
      value,
      schemaVersion === 2 ? V2_TOP_LEVEL_KEYS : V3_TOP_LEVEL_KEYS
    ) ||
    value.catalog_version !== recommendationData.catalog.catalog_version ||
    !isRecord(value.summary)
  ) {
    throw new Error('Telemetry artifact contract is invalid');
  }

  const { totalEvents, totalAccepted } = validateRounds(
    value.rounds,
    schemaVersion
  );
  if (
    isCount(value.summary.event_count) &&
    value.summary.event_count !== totalEvents
  ) {
    throw new Error('Telemetry event totals are inconsistent');
  }
  const summary = validateSummary(
    value.summary,
    schemaVersion,
    totalEvents,
    totalAccepted
  );

  if (schemaVersion === 2) {
    if (value.preference_model !== null) {
      throw new Error('Schema-v2 telemetry contract is invalid');
    }
    return value as unknown as TelemetryData;
  }

  const modelStatus =
    schemaVersion === 3
      ? validateV3PreferenceModel(
          value.preference_model,
          summary,
          totalEvents
        )
      : validateV4PreferenceModel(
          value.preference_model,
          summary,
          totalEvents
        );
  validatePreferenceRoundFields(value.rounds, modelStatus);
  validateAnalytics(
    value.analytics,
    value.rounds,
    totalEvents,
    totalAccepted,
    schemaVersion
  );
  return value as unknown as TelemetryData;
};

const fetchTelemetryData = async (
  fetcher: typeof fetch,
  signal?: AbortSignal
): Promise<TelemetryData> => {
  const response = await fetcher(ENDPOINT, {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Telemetry artifact request failed (${response.status})`);
  }
  return parseTelemetryData(await response.json());
};

const fetchDefaultTelemetryData = async (
  fetcher: typeof fetch,
  controller: AbortController
): Promise<TelemetryData> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Telemetry artifact request timed out'));
    }, STATIC_FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      fetchTelemetryData(fetcher, controller.signal),
      timedOut,
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
};

export const loadTelemetryData = (
  fetcher?: typeof fetch
): Promise<TelemetryData> => {
  if (fetcher) return fetchTelemetryData(fetcher);
  if (!cached) {
    const generation = cacheGeneration;
    const controller = new AbortController();
    let attempt: Promise<TelemetryData>;
    attempt = fetchDefaultTelemetryData(fetch, controller)
      .then((artifact) => {
        if (cacheGeneration === generation && cached === attempt) {
          resolved = artifact;
          cachedController = null;
        }
        return artifact;
      })
      .catch((error: unknown) => {
        if (cacheGeneration === generation && cached === attempt) {
          cached = null;
          cachedController = null;
        }
        throw error;
      });
    cachedController = controller;
    cached = attempt;
  }
  return cached;
};

/** Return only already-loaded data so local recommendation can never await I/O. */
export const getCachedTelemetryData = (): TelemetryData | null => resolved;

export const preloadTelemetryData = (): void => {
  void loadTelemetryData().catch(() => {
    // A missing or stalled static artifact must not affect local gameplay.
  });
};

export const clearTelemetryDataCacheForTests = (): void => {
  cacheGeneration += 1;
  const controller = cachedController;
  cached = null;
  resolved = null;
  cachedController = null;
  controller?.abort();
};
