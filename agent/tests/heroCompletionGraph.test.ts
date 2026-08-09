import { describe, expect, it } from 'vitest';
import { runHeroCompletion } from '../src/team/heroCompletionGraph.js';
import { FakeChatModel, oneBlankInput, testKnowledge } from './teamFixtures.js';

describe('hero completion LangGraph', () => {
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

    expect(result.usedFallback).toBe(false);
    expect(result.teams[0]?.heroes.map(({ hero }) => hero)).toEqual([
      '魏甲',
      '魏乙',
      '魏丙',
    ]);
    expect(result.teams[0]?.heroes[0]).toEqual(oneBlankInput.teams[0]?.heroes[0]);
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]).toMatchObject({
      reasoningEffort: 'high',
      maxCompletionTokens: 512,
    });
    expect(model.requests[0]?.messages[1]?.content).toContain(
      'Three heroes from the same camp'
    );
  });

  it('falls back deterministically when the model breaks the candidate boundary', async () => {
    const model = new FakeChatModel(
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
      })
    );

    const result = await runHeroCompletion(oneBlankInput, {
      model,
      knowledge: testKnowledge,
    });

    expect(result.usedFallback).toBe(true);
    expect(result.teams[0]?.heroes[2]?.hero).toBe('魏丙');
    expect(result.warnings.join(' ')).toContain('not a retrieved legal candidate');
  });

  it('fills multiple blanks globally without reusing a hero', async () => {
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
    const filled = result.teams[0]!.heroes.map(({ hero }) => hero);

    expect(result.usedFallback).toBe(true);
    expect(new Set(filled).size).toBe(3);
    expect(new Set(filled)).toEqual(new Set(['魏甲', '魏乙', '魏丙']));
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
    expect(result.usedFallback).toBe(false);
    expect(model.requests).toEqual([]);
  });
});
