import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildHeroCompletionContext, findBlankPositions } from '../src/team/candidates.js';
import { buildFormationCompletionContext } from '../src/team/formationContext.js';
import { formationCompletionInputSchema } from '../src/team/formationSchemas.js';
import { loadGameKnowledge } from '../src/team/gameData.js';
import { runHeroCompletion } from '../src/team/heroCompletionSubgraph.js';
import { gameDatabaseSchema, heroCompletionInputSchema } from '../src/team/schemas.js';
import { teamRecommendationInputSchema } from '../src/team/teamRecommendationSchemas.js';
import { FakeChatModel } from './teamFixtures.js';

describe('loadGameKnowledge', () => {
  it('loads the checked-in semantic and learned evidence artifacts', async () => {
    const knowledge = await loadGameKnowledge();

    expect(Object.keys(knowledge.database.heroes).length).toBeGreaterThan(90);
    expect(knowledge.database.heroes['小乔']?.ranking).toBeUndefined();
    expect(Object.keys(knowledge.database.skills).length).toBeGreaterThan(200);
    expect(knowledge.database.team.length).toBeGreaterThan(50);
    expect(Object.keys(knowledge.recommendation.model.weights).length).toBeGreaterThan(1000);

    const invalidDatabase = {
      ...knowledge.database,
      heroes: {
        ...knowledge.database.heroes,
        小乔: {
          ...knowledge.database.heroes['小乔']!,
          ranking: 'invalid',
        },
      },
    };
    const invalidResult = gameDatabaseSchema.safeParse(invalidDatabase);
    expect(invalidResult.success).toBe(false);
    if (!invalidResult.success) {
      expect(invalidResult.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['heroes', '小乔', 'ranking'] }),
        ])
      );
    }
  });

  it('loads the real edited-lineup fixture as a combined recommendation input', async () => {
    const [knowledge, fixtureText] = await Promise.all([
      loadGameKnowledge(),
      readFile(new URL('../fixtures/partial-teams.json', import.meta.url), 'utf8'),
    ]);
    const fixture = teamRecommendationInputSchema.parse(JSON.parse(fixtureText) as unknown);
    const context = buildHeroCompletionContext(fixture, knowledge);

    expect(fixture.teams[0]?.heroes.map(({ hero }) => hero)).toEqual([
      '司马懿',
      '郝昭',
      '曹丕',
    ]);
    expect(fixture.availableSkills).toHaveLength(20);
    expect(
      fixture.teams.flatMap((team) => team.heroes.flatMap((hero) => hero.skills))
        .filter((skill) => skill === null)
    ).toHaveLength(13);
    expect(findBlankPositions(fixture)).toHaveLength(6);
    expect(context.teams).toHaveLength(2);
    expect(context.teams.flatMap(({ blankSlots }) => blankSlots)).toHaveLength(6);
    expect(Object.values(context.candidateSets)).toHaveLength(1);
    expect(Object.values(context.candidateSets)[0]).toHaveLength(10);
    expect(context.teams.every(({ formation }) => formation === null)).toBe(true);

    const model = new FakeChatModel('invalid model output');
    const result = await runHeroCompletion(fixture, {
      knowledge,
      model,
    });

    expect(result.status).toBe('incomplete');
    expect(result.attempts).toBe(3);
    expect(result.assignments).toEqual([]);
    expect(result.teams).toEqual(fixture.teams);
    expect(result.warnings.join(' ')).toContain('hero slots remain blank');
    expect(model.requests).toHaveLength(3);
    expect(model.requests[0]).toMatchObject({ maxCompletionTokens: 4608 });
  });

  it('builds formation evidence from the real complete team', async () => {
    const [knowledge, fixtureText] = await Promise.all([
      loadGameKnowledge(),
      readFile(new URL('../fixtures/partial-teams.json', import.meta.url), 'utf8'),
    ]);
    const fixture = heroCompletionInputSchema.parse(JSON.parse(fixtureText) as unknown);
    const firstTeam = fixture.teams[0]!;
    const input = formationCompletionInputSchema.parse({
      teams: [
        {
          ...firstTeam,
          formation: null,
          heroes: firstTeam.heroes.map((slot) => ({ ...slot, row: null })),
        },
      ],
    });
    const context = buildFormationCompletionContext(input, knowledge);

    expect(context.teams).toHaveLength(1);
    expect(context.teams[0]?.heroes.map(({ name }) => name)).toEqual([
      '司马懿',
      '郝昭',
      '曹丕',
    ]);
    expect(context.teams[0]?.heroes[0]?.extraSkills.map(({ name }) => name)).toEqual([
      '未雨绸缪',
      '奇正相生',
    ]);
    expect(Object.keys(context.formationCatalog)).toHaveLength(8);
    expect(context.formationCatalog['雁形阵']).toBe(
      '前排统率提升20点，后排造成的伤害提升15%'
    );
  });
});
