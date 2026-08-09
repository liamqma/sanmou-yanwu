import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildBlankContexts, findBlankPositions } from '../src/team/candidates.js';
import { loadGameKnowledge } from '../src/team/gameData.js';
import { runHeroCompletion } from '../src/team/heroCompletionGraph.js';
import { heroCompletionInputSchema } from '../src/team/schemas.js';
import { FakeChatModel } from './teamFixtures.js';

describe('loadGameKnowledge', () => {
  it('loads the checked-in semantic and learned evidence artifacts', async () => {
    const knowledge = await loadGameKnowledge();

    expect(Object.keys(knowledge.database.heroes).length).toBeGreaterThan(90);
    expect(Object.keys(knowledge.database.skills).length).toBeGreaterThan(200);
    expect(knowledge.database.team.length).toBeGreaterThan(50);
    expect(Object.keys(knowledge.recommendation.model.weights).length).toBeGreaterThan(1000);
  });

  it('loads the real edited-lineup fixture with six completable hero blanks', async () => {
    const [knowledge, fixtureText] = await Promise.all([
      loadGameKnowledge(),
      readFile(new URL('../fixtures/partial-teams.json', import.meta.url), 'utf8'),
    ]);
    const fixture = heroCompletionInputSchema.parse(JSON.parse(fixtureText) as unknown);
    const contexts = buildBlankContexts(fixture, knowledge);

    expect(fixture.teams[0]?.heroes.map(({ hero }) => hero)).toEqual([
      '司马懿',
      '郝昭',
      '曹丕',
    ]);
    expect(fixture.availableSkills).toHaveLength(20);
    expect(findBlankPositions(fixture)).toHaveLength(6);
    expect(contexts).toHaveLength(6);
    expect(contexts.every(({ candidates }) => candidates.length === 10)).toBe(true);
    expect(contexts.every(({ formation }) => formation === null)).toBe(true);

    const result = await runHeroCompletion(fixture, {
      knowledge,
      model: new FakeChatModel('invalid model output'),
    });
    const assignedHeroes = result.assignments.map(({ hero }) => hero);

    expect(result.usedFallback).toBe(true);
    expect(result.assignments).toHaveLength(6);
    expect(new Set(assignedHeroes).size).toBe(6);
    expect(result.teams[0]).toEqual(fixture.teams[0]);
    expect(result.teams.slice(1).every(({ formation }) => formation === null)).toBe(true);
    expect(
      result.teams.slice(1).every((team) => team.heroes.every(({ row }) => row === null))
    ).toBe(true);
  });
});
