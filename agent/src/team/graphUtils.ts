import type { PartialTeam } from './schemas.js';

export function cloneTeams(teams: PartialTeam[]): PartialTeam[] {
  return teams.map((team) => ({
    formation: team.formation,
    heroes: team.heroes.map((slot) => ({
      hero: slot.hero,
      row: slot.row,
      skills: [...slot.skills],
    })) as PartialTeam['heroes'],
  }));
}

export function extractJson(content: string): unknown {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('Model response did not contain a JSON object');
  }
  return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
}

export function pairId(first: string, second: string): string {
  return first <= second
    ? `HP|${first}|${second}`
    : `HP|${second}|${first}`;
}

export function bondRequiredMembers(condition: string | undefined): number {
  if (condition === undefined) return 2;
  const matched = condition.match(/(\d+)人/);
  return matched === null ? 2 : Number(matched[1]);
}
