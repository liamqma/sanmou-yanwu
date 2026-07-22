import type { RoundTelemetryEvent } from '../types/telemetry';

const QUEUE_KEY = 'sanmouTelemetryQueueV1';
const SESSION_KEY = 'sanmouTelemetrySessionV1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_TELEMETRY_QUEUE_SIZE = 50;

let memorySessionId: string | null = null;

const canUseStorage = (): boolean => typeof localStorage !== 'undefined';

const isStoredEvent = (value: unknown): value is RoundTelemetryEvent => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RoundTelemetryEvent>;
  return typeof candidate.event_id === 'string' && typeof candidate.session_id === 'string';
};

export const loadTelemetryQueue = (): RoundTelemetryEvent[] => {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredEvent).slice(-MAX_TELEMETRY_QUEUE_SIZE);
  } catch {
    return [];
  }
};

const saveTelemetryQueue = (events: RoundTelemetryEvent[]): void => {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-MAX_TELEMETRY_QUEUE_SIZE)));
  } catch {
    // Storage may be disabled or full. Telemetry is best-effort and must not
    // interfere with the game.
  }
};

export const enqueueTelemetryEvent = (event: RoundTelemetryEvent): void => {
  const queue = loadTelemetryQueue();
  if (queue.some((queued) => queued.event_id === event.event_id)) return;
  saveTelemetryQueue([...queue, event]);
};

export const removeTelemetryEvents = (eventIds: readonly string[]): void => {
  const removed = new Set(eventIds);
  saveTelemetryQueue(loadTelemetryQueue().filter((event) => !removed.has(event.event_id)));
};

export const startTelemetrySession = (): string => {
  const sessionId = crypto.randomUUID();
  memorySessionId = sessionId;
  if (canUseStorage()) {
    try {
      localStorage.setItem(SESSION_KEY, sessionId);
    } catch {
      // The caller can still use this in-memory value for the current event.
    }
  }
  return sessionId;
};

export const getOrCreateTelemetrySession = (): string => {
  if (canUseStorage()) {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored && UUID_RE.test(stored)) {
        memorySessionId = stored;
        return stored;
      }
    } catch {
      // Fall through to a fresh anonymous session.
    }
  }
  if (memorySessionId) return memorySessionId;
  return startTelemetrySession();
};

export const clearTelemetryStorageForTests = (): void => {
  memorySessionId = null;
  if (!canUseStorage()) return;
  localStorage.removeItem(QUEUE_KEY);
  localStorage.removeItem(SESSION_KEY);
};
