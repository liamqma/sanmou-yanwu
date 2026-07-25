import type {
  BattleUploadRequest,
  BattleUploadSuccess,
  UploadedBattle,
} from '../types/battleUpload';

const ENDPOINT = '/api/battles';
const SUBMISSION_STORAGE_KEY = 'battleUploadSubmission';
const MAX_IN_MEMORY_SUBMISSION_IDS = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inMemorySubmissionIds = new Map<string, string>();

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredSubmission {
  requestIdentity: string;
  submissionId: string;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export class BattleUploadApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = 'BattleUploadApiError';
    this.status = status;
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const CJK_PATTERN = /[㐀-鿿]/;

const canonicalBattle = (battle: UploadedBattle): string => JSON.stringify(battle);

const rememberSubmissionId = (
  requestIdentity: string,
  submissionId: string
): void => {
  // Refresh insertion order so the bounded map retains recently retried ids.
  inMemorySubmissionIds.delete(requestIdentity);
  inMemorySubmissionIds.set(requestIdentity, submissionId);
  if (inMemorySubmissionIds.size > MAX_IN_MEMORY_SUBMISSION_IDS) {
    const oldestIdentity = inMemorySubmissionIds.keys().next().value;
    if (oldestIdentity !== undefined) inMemorySubmissionIds.delete(oldestIdentity);
  }
};

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return sessionStorage;
  } catch {
    // Referencing sessionStorage can throw in sandboxed/privacy contexts;
    // fall back to the in-memory map below.
    return null;
  }
}

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function createSubmissionUuid(): string {
  return crypto.randomUUID?.() ?? fallbackUuid();
}

/**
 * Reuse the UUID when the same season + parsed battle + exact uploader string
 * is retried in the current tab, including after a refresh. The retry identity
 * stays in sessionStorage rather than long-lived localStorage, and JSON
 * whitespace changes do not create a second ID.
 */
export function getPersistentSubmissionId(
  battle: UploadedBattle,
  uploaderName: string,
  season: number,
  storage?: StorageLike,
  createUuid: () => string = createSubmissionUuid
): string {
  const requestIdentity = JSON.stringify({
    uploader_name: uploaderName,
    season,
    battle: canonicalBattle(battle),
  });
  const store = resolveStorage(storage);
  try {
    const stored = JSON.parse(
      store?.getItem(SUBMISSION_STORAGE_KEY) ?? 'null'
    ) as StoredSubmission | null;
    if (
      stored !== null &&
      stored.requestIdentity === requestIdentity &&
      UUID_PATTERN.test(stored.submissionId)
    ) {
      rememberSubmissionId(requestIdentity, stored.submissionId);
      return stored.submissionId;
    }
  } catch {
    // Fall through to the page-session memory fallback below.
  }

  const inMemoryId = inMemorySubmissionIds.get(requestIdentity);
  if (inMemoryId !== undefined && UUID_PATTERN.test(inMemoryId)) {
    try {
      store?.setItem(
        SUBMISSION_STORAGE_KEY,
        JSON.stringify({ requestIdentity, submissionId: inMemoryId })
      );
    } catch {
      // The bounded page-session map still keeps this page's retries idempotent.
    }
    return inMemoryId;
  }

  const submissionId = createUuid();
  if (!UUID_PATTERN.test(submissionId)) {
    throw new Error('Could not create a valid submission UUID.');
  }
  rememberSubmissionId(requestIdentity, submissionId);
  try {
    store?.setItem(
      SUBMISSION_STORAGE_KEY,
      JSON.stringify({ requestIdentity, submissionId })
    );
  } catch {
    // The bounded page-session map still keeps retries idempotent.
  }
  return submissionId;
}

const safeString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 300
    ? value
    : null;

function serverErrorDetails(payload: unknown): {
  code: string | null;
  message: string | null;
} {
  if (!isRecord(payload)) return { code: null, message: null };
  const nested = isRecord(payload.error) ? payload.error : null;
  return {
    code:
      safeString(nested?.code) ??
      safeString(payload.code),
    message:
      safeString(nested?.message) ??
      safeString(payload.message) ??
      (typeof payload.error === 'string' ? safeString(payload.error) : null),
  };
}

export async function submitBattle(
  request: BattleUploadRequest,
  fetchImpl: FetchLike = fetch
): Promise<BattleUploadSuccess> {
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    throw new BattleUploadApiError(
      '网络连接失败，请稍后重试。相同战报会沿用本次提交编号。',
      null,
      null
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON response is handled as an invalid success/error below.
  }

  if (response.ok && isRecord(payload) && payload.ok === true) {
    return payload as unknown as BattleUploadSuccess;
  }

  const details = serverErrorDetails(payload);
  const status = response.status || null;
  // Only surface server messages that are already player-facing Chinese; map
  // technical or non-Chinese details to a generic Chinese error so catalog
  // drift or unexpected paths never leak English internals to a player.
  const hasChineseMessage =
    details.message !== null && CJK_PATTERN.test(details.message);
  const codeSuffix = hasChineseMessage && details.code ? `（${details.code}）` : '';
  const message = hasChineseMessage
    ? (details.message as string)
    : response.ok
      ? '服务器返回了无法识别的结果，请重试。'
      : `提交失败${status ? `（HTTP ${status}）` : ''}，请稍后重试。`;
  throw new BattleUploadApiError(`${message}${codeSuffix}`, status, details.code);
}
