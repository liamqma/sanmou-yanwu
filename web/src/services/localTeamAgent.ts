import {
  TEAM_BUILDER_DEFAULT_ROW,
  collectUsedTeamBuilderItems,
  createEmptyTeamBuilderLayout,
  type TeamBuilderLayout,
  type TeamBuilderRow,
} from './teamBuilderArrangement';

export const LOCAL_TEAM_AGENT_URL = 'http://127.0.0.1:8790';
export const LOCAL_TEAM_AGENT_EXPERIMENT_KEY =
  'sanmou.experimental.localAgent.v1';

export type TeamAgentStage = 'heroes' | 'formations' | 'skills';
export type TeamAgentVerdict = 'sound' | 'workable' | 'needs_changes';
export type TeamAgentReviewStatus = 'complete' | 'unavailable';

export interface TeamAgentSlot {
  hero: string | null;
  row: TeamBuilderRow | null;
  skills: [string | null, string | null];
}

export interface TeamAgentTeam {
  formation: string | null;
  heroes: [TeamAgentSlot, TeamAgentSlot, TeamAgentSlot];
}

export interface TeamAgentRequest {
  teams: TeamAgentTeam[];
  availableHeroes: string[];
  availableSkills: string[];
  season: number;
}

export interface TeamAgentEvidenceRef {
  source: string;
  id: string;
}

export interface TeamAgentReviewStrength {
  category: string;
  message: string;
  evidence: TeamAgentEvidenceRef[];
}

export interface TeamAgentReviewWarning {
  severity: 'warning' | 'critical';
  category: string;
  message: string;
  suggestedAction: string;
  evidence: TeamAgentEvidenceRef[];
  teamIndexes?: number[];
}

export interface TeamAgentReviewTeam {
  teamIndex: number;
  verdict: TeamAgentVerdict;
  strengths: TeamAgentReviewStrength[];
  warnings: TeamAgentReviewWarning[];
}

export interface TeamAgentReview {
  status: TeamAgentReviewStatus;
  verdict: TeamAgentVerdict | null;
  teams: TeamAgentReviewTeam[];
  crossTeamWarnings: TeamAgentReviewWarning[];
  deterministicRuleWarnings: TeamAgentReviewWarning[];
  attempts: number;
  warnings: string[];
}

export interface TeamAgentAssignment {
  teamIndex: number;
  reason: string;
  evidence: string[];
  slotIndex?: number;
  skillSlotIndex?: number;
  hero?: string;
  skill?: string;
  formation?: string;
}

export interface TeamAgentResult {
  teams: TeamAgentTeam[];
  status: 'complete' | 'incomplete';
  stoppedAt: TeamAgentStage | null;
  attempts: {
    heroes: number;
    formations: number;
    skills: number;
    review: number;
  };
  heroAssignments: TeamAgentAssignment[];
  formationDecisions: TeamAgentAssignment[];
  skillAssignments: TeamAgentAssignment[];
  review: TeamAgentReview | null;
  warnings: string[];
}

export type LocalTeamAgentErrorCode =
  | 'unavailable'
  | 'http'
  | 'invalid_response'
  | 'aborted';

export class LocalTeamAgentError extends Error {
  readonly code: LocalTeamAgentErrorCode;

  constructor(code: LocalTeamAgentErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type StorageSubset = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStorage = (): StorageSubset | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Enables the private experiment with ?local-agent=1 and persists that choice.
 * ?local-agent=0 disables it. Merely enabling the flag never contacts localhost.
 */
export function syncLocalTeamAgentExperiment(
  search = typeof window === 'undefined' ? '' : window.location.search,
  storage: StorageSubset | null = browserStorage()
): boolean {
  const setting = new URLSearchParams(search).get('local-agent');
  try {
    if (setting === '1') {
      storage?.setItem(LOCAL_TEAM_AGENT_EXPERIMENT_KEY, 'enabled');
      return true;
    }
    if (setting === '0') {
      storage?.removeItem(LOCAL_TEAM_AGENT_EXPERIMENT_KEY);
      return false;
    }
    return storage?.getItem(LOCAL_TEAM_AGENT_EXPERIMENT_KEY) === 'enabled';
  } catch {
    return setting === '1';
  }
}

export function isTeamBuilderLayoutComplete(
  layout: TeamBuilderLayout
): boolean {
  return layout.every(
    (team) =>
      team.formation !== '' &&
      team.heroes.every(
        (slot) =>
          slot.hero !== null && slot.skills.every((skill) => skill !== null)
      )
  );
}

export function createTeamAgentRequest(input: {
  layout: TeamBuilderLayout;
  heroes: readonly string[];
  skills: readonly string[];
  season: number;
}): TeamAgentRequest {
  const used = collectUsedTeamBuilderItems(input.layout);
  return {
    teams: input.layout.map((team) => ({
      formation: team.formation || null,
      heroes: team.heroes.map((slot) => ({
        hero: slot.hero,
        // Rows are only meaningful once a formation exists. Empty slots also
        // carry a visual UI default that must not constrain Agent reasoning.
        row:
          slot.hero === null || team.formation === '' ? null : slot.row,
        skills: [...slot.skills] as [string | null, string | null],
      })) as [TeamAgentSlot, TeamAgentSlot, TeamAgentSlot],
    })),
    availableHeroes: input.heroes.filter((hero) => !used.heroes.has(hero)),
    availableSkills: input.skills.filter((skill) => !used.skills.has(skill)),
    season: input.season,
  };
}

export function layoutFromTeamAgentTeams(
  teams: readonly TeamAgentTeam[]
): TeamBuilderLayout {
  if (teams.length !== 3) {
    throw new LocalTeamAgentError(
      'invalid_response',
      'Agent response must contain exactly three teams'
    );
  }
  const layout = createEmptyTeamBuilderLayout();
  teams.forEach((team, teamIndex) => {
    layout[teamIndex].formation = team.formation ?? '';
    team.heroes.forEach((slot, slotIndex) => {
      layout[teamIndex].heroes[slotIndex] = {
        hero: slot.hero,
        row: slot.row ?? TEAM_BUILDER_DEFAULT_ROW,
        skills: [...slot.skills],
      };
    });
  });
  return layout;
}

export const teamBuilderLayoutFingerprint = (
  layout: TeamBuilderLayout
): string => JSON.stringify(layout);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const stringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;

const parseEvidence = (value: unknown): TeamAgentEvidenceRef[] | null => {
  if (!Array.isArray(value)) return null;
  const evidence: TeamAgentEvidenceRef[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.source !== 'string' || typeof item.id !== 'string') {
      return null;
    }
    evidence.push({ source: item.source, id: item.id });
  }
  return evidence;
};

const parseStrengths = (value: unknown): TeamAgentReviewStrength[] | null => {
  if (!Array.isArray(value)) return null;
  const strengths: TeamAgentReviewStrength[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.category !== 'string' || typeof item.message !== 'string') {
      return null;
    }
    const evidence = parseEvidence(item.evidence);
    if (evidence === null) return null;
    strengths.push({ category: item.category, message: item.message, evidence });
  }
  return strengths;
};

const parseReviewWarnings = (
  value: unknown,
  crossTeam = false
): TeamAgentReviewWarning[] | null => {
  if (!Array.isArray(value)) return null;
  const warnings: TeamAgentReviewWarning[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      (item.severity !== 'warning' && item.severity !== 'critical') ||
      typeof item.category !== 'string' ||
      typeof item.message !== 'string' ||
      typeof item.suggestedAction !== 'string'
    ) {
      return null;
    }
    const evidence = parseEvidence(item.evidence);
    const teamIndexes = crossTeam
      ? Array.isArray(item.teamIndexes) && item.teamIndexes.every(isNonNegativeInteger)
        ? item.teamIndexes
        : null
      : undefined;
    if (evidence === null || (crossTeam && teamIndexes === null)) return null;
    warnings.push({
      severity: item.severity,
      category: item.category,
      message: item.message,
      suggestedAction: item.suggestedAction,
      evidence,
      ...(Array.isArray(teamIndexes) ? { teamIndexes } : {}),
    });
  }
  return warnings;
};

const parseReview = (value: unknown): TeamAgentReview | null | undefined => {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    (value.status !== 'complete' && value.status !== 'unavailable') ||
    (value.verdict !== null &&
      value.verdict !== 'sound' &&
      value.verdict !== 'workable' &&
      value.verdict !== 'needs_changes') ||
    !isNonNegativeInteger(value.attempts)
  ) {
    return undefined;
  }
  if (!Array.isArray(value.teams)) return undefined;
  const teams: TeamAgentReviewTeam[] = [];
  for (const item of value.teams) {
    if (
      !isRecord(item) ||
      !isNonNegativeInteger(item.teamIndex) ||
      (item.verdict !== 'sound' &&
        item.verdict !== 'workable' &&
        item.verdict !== 'needs_changes')
    ) {
      return undefined;
    }
    const strengths = parseStrengths(item.strengths);
    const warnings = parseReviewWarnings(item.warnings);
    if (strengths === null || warnings === null) return undefined;
    teams.push({
      teamIndex: item.teamIndex,
      verdict: item.verdict,
      strengths,
      warnings,
    });
  }
  const crossTeamWarnings = parseReviewWarnings(value.crossTeamWarnings, true);
  const deterministicRuleWarnings = parseReviewWarnings(
    value.deterministicRuleWarnings,
    true
  );
  const warnings = stringArray(value.warnings);
  if (
    crossTeamWarnings === null ||
    deterministicRuleWarnings === null ||
    warnings === null
  ) {
    return undefined;
  }
  return {
    status: value.status,
    verdict: value.verdict,
    teams,
    crossTeamWarnings,
    deterministicRuleWarnings,
    attempts: value.attempts,
    warnings,
  };
};

const parseTeamSlot = (value: unknown): TeamAgentSlot | null => {
  if (
    !isRecord(value) ||
    (value.hero !== null && typeof value.hero !== 'string') ||
    (value.row !== null && value.row !== '前排' && value.row !== '后排') ||
    !Array.isArray(value.skills) ||
    value.skills.length !== 2 ||
    !value.skills.every((skill) => skill === null || typeof skill === 'string')
  ) {
    return null;
  }
  return {
    hero: value.hero,
    row: value.row,
    skills: [value.skills[0], value.skills[1]],
  };
};

const parseTeams = (value: unknown): TeamAgentTeam[] | null => {
  if (!Array.isArray(value)) return null;
  const teams: TeamAgentTeam[] = [];
  for (const team of value) {
    if (
      !isRecord(team) ||
      (team.formation !== null && typeof team.formation !== 'string') ||
      !Array.isArray(team.heroes) ||
      team.heroes.length !== 3
    ) {
      return null;
    }
    const parsedSlots = team.heroes.map(parseTeamSlot);
    if (parsedSlots.some((slot) => slot === null)) return null;
    teams.push({
      formation: team.formation,
      heroes: parsedSlots as [TeamAgentSlot, TeamAgentSlot, TeamAgentSlot],
    });
  }
  return teams;
};

const parseAssignments = (value: unknown): TeamAgentAssignment[] | null => {
  if (!Array.isArray(value)) return null;
  const assignments: TeamAgentAssignment[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonNegativeInteger(item.teamIndex) ||
      typeof item.reason !== 'string'
    ) {
      return null;
    }
    const evidence = stringArray(item.evidence);
    if (evidence === null) return null;
    const assignment: TeamAgentAssignment = {
      teamIndex: item.teamIndex,
      reason: item.reason,
      evidence,
    };
    for (const key of ['slotIndex', 'skillSlotIndex'] as const) {
      if (isNonNegativeInteger(item[key])) assignment[key] = item[key];
    }
    for (const key of ['hero', 'skill', 'formation'] as const) {
      if (typeof item[key] === 'string') assignment[key] = item[key];
    }
    assignments.push(assignment);
  }
  return assignments;
};

export function parseTeamAgentResult(value: unknown): TeamAgentResult {
  if (
    !isRecord(value) ||
    (value.status !== 'complete' && value.status !== 'incomplete') ||
    (value.stoppedAt !== null &&
      value.stoppedAt !== 'heroes' &&
      value.stoppedAt !== 'formations' &&
      value.stoppedAt !== 'skills') ||
    !isRecord(value.attempts)
  ) {
    throw new LocalTeamAgentError('invalid_response', 'Agent returned an invalid response');
  }
  const teams = parseTeams(value.teams);
  const heroAssignments = parseAssignments(value.heroAssignments);
  const formationDecisions = parseAssignments(value.formationDecisions);
  const skillAssignments = parseAssignments(value.skillAssignments);
  const review = parseReview(value.review);
  const warnings = stringArray(value.warnings);
  const attempts = value.attempts;
  if (
    teams === null ||
    teams.length !== 3 ||
    heroAssignments === null ||
    formationDecisions === null ||
    skillAssignments === null ||
    review === undefined ||
    warnings === null ||
    !isNonNegativeInteger(attempts.heroes) ||
    !isNonNegativeInteger(attempts.formations) ||
    !isNonNegativeInteger(attempts.skills) ||
    !isNonNegativeInteger(attempts.review)
  ) {
    throw new LocalTeamAgentError('invalid_response', 'Agent returned an invalid response');
  }
  return {
    teams,
    status: value.status,
    stoppedAt: value.stoppedAt,
    attempts: {
      heroes: attempts.heroes,
      formations: attempts.formations,
      skills: attempts.skills,
      review: attempts.review,
    },
    heroAssignments,
    formationDecisions,
    skillAssignments,
    review,
    warnings,
  };
}

const responseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json();
    if (
      isRecord(body) &&
      isRecord(body.error) &&
      typeof body.error.message === 'string'
    ) {
      return body.error.message;
    }
  } catch {
    // The status text below is enough when an error response is not JSON.
  }
  return response.statusText || `HTTP ${response.status}`;
};

export async function requestLocalTeamRecommendation(
  input: TeamAgentRequest,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<TeamAgentResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const ready = await fetchImpl(`${LOCAL_TEAM_AGENT_URL}/health/ready`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
    if (!ready.ok) {
      throw new LocalTeamAgentError('http', await responseErrorMessage(ready));
    }
    const response = await fetchImpl(
      `${LOCAL_TEAM_AGENT_URL}/v1/team-recommendations`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: options.signal,
      }
    );
    if (!response.ok) {
      throw new LocalTeamAgentError(
        'http',
        await responseErrorMessage(response)
      );
    }
    return parseTeamAgentResult(await response.json());
  } catch (error) {
    if (error instanceof LocalTeamAgentError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new LocalTeamAgentError('aborted', 'Agent request was cancelled');
    }
    throw new LocalTeamAgentError(
      'unavailable',
      error instanceof Error ? error.message : 'Local Agent is unavailable'
    );
  }
}
