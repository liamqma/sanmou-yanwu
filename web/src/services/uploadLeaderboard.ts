import {
  isNamedUploaderName,
  validateUploaderName,
} from '../utils/uploaderName';
import type { UploadLeaderboardData } from '../types/battleUpload';

const ENDPOINT = '/game-data/web_upload_data.json';
const TOP_LEVEL_KEYS = [
  'schema_version',
  'updated_date',
  'updated_through_id',
  'summary',
  'contributors',
] as const;
const SUMMARY_KEYS = [
  'processed_reports',
  'accepted_reports',
  'rejected_reports',
] as const;
const CONTRIBUTOR_KEYS = ['name', 'accepted_reports'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;
const hasExactKeys = (
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const isDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Python's artifact builder sorts Unicode strings by code point, not UTF-16. */
const compareCodePoints = (left: string, right: string): number => {
  const leftCharacters = [...left];
  const rightCharacters = [...right];
  const length = Math.min(leftCharacters.length, rightCharacters.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      leftCharacters[index].codePointAt(0)! -
      rightCharacters[index].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftCharacters.length - rightCharacters.length;
};

export function parseUploadLeaderboard(
  value: unknown
): UploadLeaderboardData | null {
  if (
    !hasExactKeys(value, TOP_LEVEL_KEYS) ||
    value.schema_version !== 1 ||
    !isCount(value.updated_through_id) ||
    (value.updated_date !== null && !isDate(value.updated_date)) ||
    !hasExactKeys(value.summary, SUMMARY_KEYS) ||
    !isCount(value.summary.processed_reports) ||
    !isCount(value.summary.accepted_reports) ||
    !isCount(value.summary.rejected_reports) ||
    value.summary.processed_reports !==
      value.summary.accepted_reports + value.summary.rejected_reports ||
    !Array.isArray(value.contributors)
  ) {
    return null;
  }

  const names = new Set<string>();
  let previous: { name: string; accepted: number } | null = null;
  let namedAcceptedReports = 0;
  for (const contributor of value.contributors) {
    if (
      !hasExactKeys(contributor, CONTRIBUTOR_KEYS) ||
      typeof contributor.name !== 'string' ||
      !isNamedUploaderName(contributor.name) ||
      !validateUploaderName(contributor.name).valid ||
      !isCount(contributor.accepted_reports) ||
      contributor.accepted_reports === 0 ||
      names.has(contributor.name)
    ) {
      return null;
    }
    if (
      previous !== null &&
      (contributor.accepted_reports > previous.accepted ||
        (contributor.accepted_reports === previous.accepted &&
          compareCodePoints(contributor.name, previous.name) < 0))
    ) {
      return null;
    }
    names.add(contributor.name);
    namedAcceptedReports += contributor.accepted_reports;
    previous = {
      name: contributor.name,
      accepted: contributor.accepted_reports,
    };
  }
  if (namedAcceptedReports > value.summary.accepted_reports) return null;

  return value as unknown as UploadLeaderboardData;
}

/** Daily cache key matches the leaderboard's daily publication cadence. */
export function uploadLeaderboardUrl(date = new Date()): string {
  return `${ENDPOINT}?v=${date.toISOString().slice(0, 10)}`;
}

export async function fetchUploadLeaderboard(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<UploadLeaderboardData> {
  const response = await fetchImpl(uploadLeaderboardUrl(), {
    cache: 'no-cache',
    signal,
  });
  if (!response.ok) throw new Error(`Leaderboard HTTP ${response.status}`);
  const parsed = parseUploadLeaderboard(await response.json());
  if (parsed === null) throw new Error('Invalid leaderboard artifact');
  return parsed;
}
