import { describe, expect, it } from 'vitest';
import { runHeroCompletion } from '../src/team/heroCompletionSubgraph.js';
import { FakeChatModel, oneBlankInput, testKnowledge } from './teamFixtures.js';

describe('hero completion LangGraph subgraph', () => {
  it('uses high reasoning effort and preserves every filled position', async () => {
    const model = new FakeChatModel(
      JSON.stringify({
        assignments: [
          {
            teamIndex: 0,
            slotIndex: 2,
            hero: '魏丙',
            reason: '三魏触发10%属性加成，并补充治疗和统率。',
            evidence: ['阵营加成从5%提升到10%', '激活魏援缘分'],
          },
        ],
      })
    );

    const result = await runHeroCompletion(oneBlankInput, {
      model,
      knowledge: testKnowledge,
      reasoningEffort: 'high',
    });

    expect(result.status).toBe('complete');
    expect(result.attempts).toBe(1);
    expect(result.teams[0]?.heroes.map(({ hero }) => hero)).toEqual([
      '魏甲',
      '魏乙',
      '魏丙',
    ]);
    expect(result.teams[0]?.heroes[0]).toEqual(oneBlankInput.teams[0]?.heroes[0]);
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]).toMatchObject({
      reasoningEffort: 'high',
      maxCompletionTokens: 2048,
    });
    expect(model.requests[0]?.messages[1]?.content).toContain(
      'Three heroes from the same camp'
    );
  });

  it('retries with validation feedback and accepts a corrected assignment', async () => {
    const model = new FakeChatModel(
      [
        JSON.stringify({
          assignments: [
            {
              teamIndex: 0,
              slotIndex: 2,
              hero: '不存在',
              reason: 'invalid',
              evidence: [],
            },
          ],
        }),
        JSON.stringify({
          assignments: [
            {
              teamIndex: 0,
              slotIndex: 2,
              hero: '魏丙',
              reason: '三魏触发10%属性加成。',
              evidence: ['阵营属性加成提升至10%'],
            },
          ],
        }),
      ]
    );

    const result = await runHeroCompletion(oneBlankInput, {
      model,
      knowledge: testKnowledge,
    });

    expect(result.status).toBe('complete');
    expect(result.attempts).toBe(2);
    expect(result.teams[0]?.heroes[2]?.hero).toBe('魏丙');
    expect(result.warnings).toEqual([]);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages[1]?.content).toContain(
      'Previous attempt was rejected'
    );
    expect(model.requests[1]?.messages[1]?.content).toContain(
      'not a retrieved legal candidate'
    );
  });

  it('leaves every blank unchanged after three invalid attempts', async () => {
    const model = new FakeChatModel(
      JSON.stringify({
        assignments: [
          {
            teamIndex: 0,
            slotIndex: 1,
            hero: '魏丙',
            reason: 'duplicate attempt',
            evidence: [],
          },
          {
            teamIndex: 0,
            slotIndex: 2,
            hero: '魏丙',
            reason: 'duplicate attempt',
            evidence: [],
          },
        ],
      })
    );
    const input = {
      ...oneBlankInput,
      teams: [
        {
          ...oneBlankInput.teams[0]!,
          heroes: [
            oneBlankInput.teams[0]!.heroes[0]!,
            { hero: null, row: '前排' as const, skills: [null, null] as [null, null] },
            { hero: null, row: '前排' as const, skills: [null, null] as [null, null] },
          ],
        },
      ],
    };

    const result = await runHeroCompletion(input, {
      model,
      knowledge: testKnowledge,
    });
    expect(result.status).toBe('incomplete');
    expect(result.attempts).toBe(3);
    expect(result.assignments).toEqual([]);
    expect(result.teams).toEqual(input.teams);
    expect(result.warnings.join(' ')).toContain('hero slots remain blank');
    expect(result.warnings.join(' ')).toContain('would be used more than once');
    expect(model.requests).toHaveLength(3);
  });

  it('skips the model entirely when there are no hero blanks', async () => {
    const model = new FakeChatModel('not used');
    const filledInput = {
      ...oneBlankInput,
      teams: [
        {
          ...oneBlankInput.teams[0]!,
          heroes: oneBlankInput.teams[0]!.heroes.map((slot, index) =>
            index === 2 ? { ...slot, hero: '魏丙' } : slot
          ) as typeof oneBlankInput.teams[0]['heroes'],
        },
      ],
    };

    const result = await runHeroCompletion(filledInput, {
      model,
      knowledge: testKnowledge,
    });

    expect(result.assignments).toEqual([]);
    expect(result.status).toBe('complete');
    expect(result.attempts).toBe(0);
    expect(model.requests).toEqual([]);
  });

  it('rejects a non-positive retry limit', async () => {
    const model = new FakeChatModel('not used');

    await expect(
      runHeroCompletion(oneBlankInput, {
        model,
        knowledge: testKnowledge,
        maxReasoningAttempts: 0,
      })
    ).rejects.toThrow('maxReasoningAttempts must be a positive integer');
    expect(model.requests).toEqual([]);
  });
});
