const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUND_TYPES = Object.freeze({
  1: 'hero',
  2: 'skill',
  3: 'skill',
  4: 'hero',
  5: 'skill',
  6: 'skill',
  7: 'hero',
  8: 'skill',
});
const EVENT_KEYS = new Set([
  'event_id',
  'session_id',
  'client_ts',
  'round_number',
  'round_type',
  'schema_version',
  'model_version',
  'catalog_version',
  'pool_before',
  'offered_sets',
  'paired_scores',
  'recommended_index',
  'chosen_index',
  'preference_model_version',
  'preference_probabilities',
]);
const INSERT_SQL = `
  INSERT OR IGNORE INTO round_telemetry (
    event_id,
    session_id,
    client_ts,
    round_number,
    round_type,
    schema_version,
    model_version,
    catalog_version,
    pool_before_json,
    offered_sets_json,
    paired_scores_json,
    recommended_index,
    chosen_index,
    preference_model_version,
    preference_probs_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const responseJson = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isShortString = (value, max = 128) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const isIndex = (value) => Number.isInteger(value) && value >= 0 && value <= 2;
const isFiniteScore = (value) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;

const validateItemList = (value, maxItems) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => isShortString(item, 64));

const readBodyWithLimit = async (request) => {
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};

/**
 * Validate one schema-v1 event. Returns a short client-safe error or null.
 * Exported for deterministic unit tests; the Pages handler is the only runtime
 * consumer.
 */
export function validateRoundEvent(event) {
  if (!isRecord(event)) return 'event must be an object';
  if (Object.keys(event).some((key) => !EVENT_KEYS.has(key))) return 'event has unexpected fields';
  if (Object.keys(event).length !== EVENT_KEYS.size) return 'event is missing required fields';

  if (!UUID_RE.test(event.event_id)) return 'event_id must be a UUID';
  if (!UUID_RE.test(event.session_id)) return 'session_id must be a UUID';
  if (!isShortString(event.client_ts, 40) || Number.isNaN(Date.parse(event.client_ts))) {
    return 'client_ts must be an ISO timestamp';
  }
  if (!Number.isInteger(event.round_number) || event.round_number < 1 || event.round_number > 8) {
    return 'round_number must be between 1 and 8';
  }
  if (event.round_type !== ROUND_TYPES[event.round_number]) {
    return 'round_type does not match round_number';
  }
  if (event.schema_version !== 1) return 'unsupported schema_version';
  if (!isShortString(event.model_version) || !isShortString(event.catalog_version)) {
    return 'model_version and catalog_version are required';
  }

  if (!isRecord(event.pool_before)) return 'pool_before must contain heroes and skills';
  const poolKeys = Object.keys(event.pool_before);
  const allowedPoolKeys = new Set(['heroes', 'skills', 'hero_support', 'skills_support']);
  if (poolKeys.some((key) => !allowedPoolKeys.has(key))) {
    return 'pool_before has unexpected fields';
  }
  if (!Object.hasOwn(event.pool_before, 'heroes') || !Object.hasOwn(event.pool_before, 'skills')) {
    return 'pool_before must contain heroes and skills';
  }
  if (!validateItemList(event.pool_before.heroes, 20) || !validateItemList(event.pool_before.skills, 32)) {
    return 'pool_before contains invalid items';
  }
  if (
    (Object.hasOwn(event.pool_before, 'hero_support') &&
      !isShortString(event.pool_before.hero_support, 64)) ||
    (Object.hasOwn(event.pool_before, 'skills_support') &&
      (!validateItemList(event.pool_before.skills_support, 2) ||
        event.pool_before.skills_support.length === 0))
  ) {
    return 'pool_before contains invalid support items';
  }

  const itemsPerSet = event.round_number === 7 ? 2 : 3;
  if (
    !Array.isArray(event.offered_sets) ||
    event.offered_sets.length !== 3 ||
    !event.offered_sets.every(
      (set) => validateItemList(set, itemsPerSet) && set.length === itemsPerSet
    )
  ) {
    return `offered_sets must contain three sets of ${itemsPerSet}`;
  }
  if (
    !Array.isArray(event.paired_scores) ||
    event.paired_scores.length !== 3 ||
    !event.paired_scores.every(isFiniteScore)
  ) {
    return 'paired_scores must contain three finite numbers';
  }
  if (!isIndex(event.recommended_index) || !isIndex(event.chosen_index)) {
    return 'choice indices must be between 0 and 2';
  }
  const recommendedScore = event.paired_scores[event.recommended_index];
  if (event.paired_scores.some((score) => score > recommendedScore + 1e-9)) {
    return 'recommended_index must identify a highest paired score';
  }

  const noPreference =
    event.preference_model_version === null && event.preference_probabilities === null;
  const hasPreference =
    isShortString(event.preference_model_version) &&
    Array.isArray(event.preference_probabilities) &&
    event.preference_probabilities.length === 3 &&
    event.preference_probabilities.every(
      (probability) =>
        typeof probability === 'number' &&
        Number.isFinite(probability) &&
        probability >= 0 &&
        probability <= 1
    ) &&
    Math.abs(event.preference_probabilities.reduce((sum, probability) => sum + probability, 0) - 1) <= 1e-6;
  if (!noPreference && !hasPreference) {
    return 'preference version and probabilities must both be null or valid';
  }

  return null;
}

const bindEvent = (database, event) =>
  database.prepare(INSERT_SQL).bind(
    event.event_id,
    event.session_id,
    event.client_ts,
    event.round_number,
    event.round_type,
    event.schema_version,
    event.model_version,
    event.catalog_version,
    JSON.stringify(event.pool_before),
    JSON.stringify(event.offered_sets),
    JSON.stringify(event.paired_scores),
    event.recommended_index,
    event.chosen_index,
    event.preference_model_version,
    event.preference_probabilities === null
      ? null
      : JSON.stringify(event.preference_probabilities)
  );

export async function onRequestPost({ request, env }) {
  if (!env?.TELEMETRY_DB) {
    return responseJson({ ok: false, error: 'telemetry storage unavailable' }, 503);
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return responseJson({ ok: false, error: 'request body is too large' }, 413);
  }

  const rawBody = await readBodyWithLimit(request);
  if (rawBody === null) {
    return responseJson({ ok: false, error: 'request body is too large' }, 413);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return responseJson({ ok: false, error: 'request body must be valid JSON' }, 400);
  }

  if (!isRecord(body) || Object.keys(body).length !== 1 || !Array.isArray(body.events)) {
    return responseJson({ ok: false, error: 'request body must contain only an events array' }, 400);
  }
  if (body.events.length < 1 || body.events.length > MAX_BATCH_SIZE) {
    return responseJson({ ok: false, error: `events must contain 1-${MAX_BATCH_SIZE} items` }, 400);
  }

  for (let index = 0; index < body.events.length; index += 1) {
    const error = validateRoundEvent(body.events[index]);
    if (error) {
      return responseJson({ ok: false, error: `events[${index}]: ${error}` }, 400);
    }
  }

  try {
    const results = await env.TELEMETRY_DB.batch(
      body.events.map((event) => bindEvent(env.TELEMETRY_DB, event))
    );
    const accepted = results.reduce(
      (count, result) => count + (Number(result?.meta?.changes) > 0 ? 1 : 0),
      0
    );
    return responseJson({
      ok: true,
      accepted,
      duplicates: body.events.length - accepted,
    });
  } catch (error) {
    console.error('Failed to store round telemetry', error);
    return responseJson({ ok: false, error: 'telemetry storage unavailable' }, 503);
  }
}
