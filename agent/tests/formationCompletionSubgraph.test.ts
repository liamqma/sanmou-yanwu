import { describe, expect, it } from 'vitest';
import { buildFormationContexts } from '../src/team/formationContext.js';
import { runFormationCompletion } from '../src/team/formationCompletionSubgraph.js';
import type { FormationCompletionInput } from '../src/team/formationSchemas.js';
import { FakeChatModel, testKnowledge } from './teamFixtures.js';

const incompleteLayout: FormationCompletionInput = {
  teams: [
    {
      formation: null,
      heroes: [
        { hero: '魏甲', row: null, skills: [null, null] },
        { hero: '魏乙', row: '前排', skills: [null, null] },
        { hero: '魏丙', row: null, skills: [null, null] },
      ],
    },
  ],
};

const validDecision = JSON.stringify({
  decisions: [
    {
      teamIndex: 0,
      formation: '雁形阵',
      rows: [
        { slotIndex: 0, row: '后排' },
        { slotIndex: 1, row: '前排' },
        { slotIndex: 2, row: '后排' },
      ],
      reason: '前排承担伤害，两个后排利用雁形阵增伤。',
      evidence: ['雁形阵后排造成伤害提升', '魏援缘分已激活'],
    },
  ],
});

describe('formation completion context', () => {
  it('retrieves formations, hero mechanics, bonds, guide references, and learned evidence', () => {
    const contexts = buildFormationContexts(incompleteLayout, testKnowledge);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      teamIndex: 0,
      currentFormation: null,
      activeBonds: [{ name: '魏援' }],
      knownTeamReferences: [
        {
          id: 'known-wei-team',
          formation: '雁形阵',
          championship: true,
        },
      ],
    });
    expect(contexts[0]?.heroes[0]?.signatureSkill.description).toContain('谋略伤害');
    expect(contexts[0]?.learnedEvidence.features.map(({ id }) => id)).toContain(
      'HP|魏丙|魏乙'
    );
    expect(contexts[0]?.formationCandidates).toEqual([
      { name: '雁形阵', effect: '后排造成伤害提升，前排承伤。' },
    ]);
  });
});

describe('formation completion LangGraph subgraph', () => {
  it('fills only missing layout values with high reasoning effort', async () => {
    const model = new FakeChatModel(validDecision);
    const result = await runFormationCompletion(incompleteLayout, {
      model,
      knowledge: testKnowledge,
    });

    expect(result.status).toBe('complete');
    expect(result.attempts).toBe(1);
    expect(result.teams[0]?.formation).toBe('雁形阵');
    expect(result.teams[0]?.heroes.map(({ row }) => row)).toEqual([
      '后排',
      '前排',
      '后排',
    ]);
    expect(result.teams[0]?.heroes.map(({ hero }) => hero)).toEqual([
      '魏甲',
      '魏乙',
      '魏丙',
    ]);
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]).toMatchObject({
      reasoningEffort: 'high',
      maxCompletionTokens: 4096,
    });
  });

  it('retries with exact validation feedback and accepts a correction', async () => {
    const invalidDecision = JSON.stringify({
      decisions: [
        {
          teamIndex: 0,
          formation: '不存在阵',
          rows: [
            { slotIndex: 0, row: '后排' },
            { slotIndex: 1, row: '后排' },
            { slotIndex: 2, row: '前排' },
          ],
          reason: 'invalid',
          evidence: [],
        },
      ],
    });
    const model = new FakeChatModel([invalidDecision, validDecision]);

    const result = await runFormationCompletion(incompleteLayout, {
      model,
      knowledge: testKnowledge,
    });

    expect(result.status).toBe('complete');
    expect(result.attempts).toBe(2);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages[1]?.content).toContain(
      'Formation 不存在阵 is not a legal catalog formation'
    );
    expect(model.requests[1]?.messages[1]?.content).toContain(
      'slot 1 row 前排 must be preserved'
    );
  });

  it('leaves all missing layout values unchanged after three invalid attempts', async () => {
    const model = new FakeChatModel('invalid model output');

    const result = await runFormationCompletion(incompleteLayout, {
      model,
      knowledge: testKnowledge,
    });

    expect(result.status).toBe('incomplete');
    expect(result.attempts).toBe(3);
    expect(result.decisions).toEqual([]);
    expect(result.teams).toEqual(incompleteLayout.teams);
    expect(result.warnings.join(' ')).toContain(
      'missing formations and rows remain blank'
    );
    expect(model.requests).toHaveLength(3);
  });

  it('skips the model when every formation and row is already filled', async () => {
    const model = new FakeChatModel('not used');
    const completedInput: FormationCompletionInput = {
      teams: [
        {
          formation: '雁形阵',
          heroes: incompleteLayout.teams[0]!.heroes.map((slot, slotIndex) => ({
            ...slot,
            row: slotIndex === 1 ? ('前排' as const) : ('后排' as const),
          })) as FormationCompletionInput['teams'][number]['heroes'],
        },
      ],
    };

    const result = await runFormationCompletion(completedInput, {
      model,
      knowledge: testKnowledge,
    });

    expect(result).toMatchObject({ status: 'complete', attempts: 0, decisions: [] });
    expect(result.teams).toEqual(completedInput.teams);
    expect(model.requests).toEqual([]);
  });

  it('honors an explicit completion-token override', async () => {
    const model = new FakeChatModel(validDecision);

    await runFormationCompletion(incompleteLayout, {
      model,
      knowledge: testKnowledge,
      maxCompletionTokens: 1234,
    });

    expect(model.requests[0]).toMatchObject({ maxCompletionTokens: 1234 });
  });

  it('rejects an unknown existing formation even when no layout value is missing', async () => {
    const model = new FakeChatModel('not used');
    const completedWithUnknownFormation: FormationCompletionInput = {
      teams: [
        {
          formation: '不存在阵',
          heroes: incompleteLayout.teams[0]!.heroes.map((slot) => ({
            ...slot,
            row: '前排' as const,
          })) as FormationCompletionInput['teams'][number]['heroes'],
        },
      ],
    };

    await expect(
      runFormationCompletion(completedWithUnknownFormation, {
        model,
        knowledge: testKnowledge,
      })
    ).rejects.toThrow('Unknown formation on team 0: 不存在阵');
    expect(model.requests).toEqual([]);
  });

  it('rejects formation reasoning while a hero position remains blank', async () => {
    const model = new FakeChatModel('not used');
    const inputWithBlankHero = {
      teams: [
        {
          ...incompleteLayout.teams[0]!,
          heroes: [
            { hero: null, row: null, skills: [null, null] as [null, null] },
            ...incompleteLayout.teams[0]!.heroes.slice(1),
          ],
        },
      ],
    };

    await expect(
      runFormationCompletion(inputWithBlankHero, {
        model,
        knowledge: testKnowledge,
      })
    ).rejects.toThrow('Formation completion requires every hero position to be filled');
    expect(model.requests).toEqual([]);
  });
});
