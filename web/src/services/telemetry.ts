import { CATALOG_VERSION } from '../data';
import type { RoundTelemetryEvent, RoundTelemetryInput } from '../types/telemetry';
import {
  getItemsPerSet,
  getRoundType,
  TOTAL_ROUNDS,
} from './gameLogic';
import {
  enqueueTelemetryEvent,
  getOrCreateTelemetrySession,
  loadTelemetryQueue,
  removeTelemetryEvents,
  startTelemetrySession,
} from '../utils/telemetryStorage';

const ENDPOINT = '/api/telemetry/rounds';
const MAX_UPLOAD_BATCH = 8;
// The weekly telemetry builder rejects any other shape.
const MODEL_VERSION_RE = /^[1-9]\d*:[0-9a-f]{16}$/;

let flushInFlight: Promise<void> | null = null;
let initialized = false;

const isValidInput = (input: RoundTelemetryInput): boolean => {
  if (
    !Number.isInteger(input.roundNumber) ||
    input.roundNumber < 1 ||
    input.roundNumber > TOTAL_ROUNDS
  ) {
    return false;
  }
  const roundType = getRoundType(input.roundNumber);
  const itemsPerSet = getItemsPerSet(input.roundNumber);
  const offeredItems = input.offeredSets.flat();
  const occupiedItems =
    input.roundType === 'hero'
      ? [
          ...input.poolBefore.heroes,
          ...(input.poolBefore.heroSupport ? [input.poolBefore.heroSupport] : []),
        ]
      : [
          ...input.poolBefore.skills,
          ...(input.poolBefore.skillsSupport || []),
      ];

  return (
    MODEL_VERSION_RE.test(input.modelVersion) &&
    roundType === input.roundType &&
    input.offeredSets.length === 3 &&
    input.offeredSets.every(
      (offeredSet) => offeredSet.length === itemsPerSet
    ) &&
    new Set(offeredItems).size === offeredItems.length &&
    !offeredItems.some((item) => occupiedItems.includes(item)) &&
    input.scores.length === 3 &&
    input.scores.every(Number.isFinite) &&
    Number.isInteger(input.recommendedIndex) &&
    input.recommendedIndex >= 0 &&
    input.recommendedIndex <= 2 &&
    !input.scores.some((score) => score > input.scores[input.recommendedIndex] + 1e-9) &&
    Number.isInteger(input.chosenIndex) &&
    input.chosenIndex >= 0 &&
    input.chosenIndex <= 2
  );
};

export const createRoundTelemetryEvent = (
  input: RoundTelemetryInput
): RoundTelemetryEvent | null => {
  if (!isValidInput(input)) return null;

  return {
    event_id: crypto.randomUUID(),
    session_id: getOrCreateTelemetrySession(),
    client_ts: new Date().toISOString(),
    round_number: input.roundNumber,
    round_type: input.roundType,
    schema_version: 1,
    model_version: input.modelVersion,
    catalog_version: CATALOG_VERSION,
    pool_before: {
      heroes: [...input.poolBefore.heroes],
      skills: [...input.poolBefore.skills],
      ...(input.poolBefore.heroSupport
        ? { hero_support: input.poolBefore.heroSupport }
        : {}),
      ...(input.poolBefore.skillsSupport?.length
        ? { skills_support: [...input.poolBefore.skillsSupport] }
        : {}),
    },
    offered_sets: input.offeredSets.map((set) => [...set]),
    paired_scores: [...input.scores],
    recommended_index: input.recommendedIndex,
    chosen_index: input.chosenIndex,
    preference_model_version: null,
    preference_probabilities: null,
  };
};

export const beginTelemetrySession = (): void => {
  try {
    startTelemetrySession();
  } catch {
    // Best effort only: the first recorded round will retry session creation.
  }
};

export const flushTelemetryQueue = async (
  fetcher: typeof fetch = fetch
): Promise<void> => {
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    while (true) {
      const batch = loadTelemetryQueue().slice(0, MAX_UPLOAD_BATCH);
      if (batch.length === 0) return;

      try {
        const response = await fetcher(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
          keepalive: true,
        });

        let result: { ok?: boolean } | null = null;
        try {
          result = (await response.json()) as { ok?: boolean };
        } catch {
          // A local static dev server may answer this path with HTML. Retain the
          // queue rather than treating that as a successful telemetry upload.
        }

        if (response.ok && result?.ok === true) {
          removeTelemetryEvents(batch.map((event) => event.event_id));
          continue;
        }
        if ([400, 413, 422].includes(response.status)) {
          // Validation failures are permanent for this schema. Drop only that
          // poison batch, then allow later events to make progress.
          removeTelemetryEvents(batch.map((event) => event.event_id));
          continue;
        }
        return;
      } catch {
        // Offline/network/D1 failures retain the queue for a later retry.
        return;
      }
    }
  })();

  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }
};

export const recordRoundTelemetry = (input: RoundTelemetryInput): void => {
  try {
    const event = createRoundTelemetryEvent(input);
    if (!event) return;
    enqueueTelemetryEvent(event);
    void flushTelemetryQueue();
  } catch {
    // Telemetry is deliberately unable to block a confirmed game choice.
  }
};

export const initializeTelemetry = (): void => {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('online', () => {
    void flushTelemetryQueue();
  });
  void flushTelemetryQueue();
};
