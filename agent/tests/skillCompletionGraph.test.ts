import { describe, expect, it } from 'vitest';
import { buildSkillCompletionContext } from '../src/team/skillContext.js';
import { runSkillCompletion } from '../src/team/skillCompletionGraph.js';
import type { SkillCompletionInput } from '../src/team/skillSchemas.js';
import { FakeChatModel, skillTestKnowledge } from './teamFixtures.js';

export const oneSkillBlankInput: SkillCompletionInput = {
  season: 1,
  availableSkills: ['治疗术'],
  teams: [
    {
      formation: '雁形阵',
      heroes: [
        { hero: '魏甲', row: '后排', skills: ['甲技', null] },
        { hero: '魏乙', row: '前排', skills: ['乙技', '丙技'] },
        { hero: '魏丙', row: '后排', skills: ['丁技', '戊技'] },
      ],
    },
  ],
};

const validAssignment = JSON.stringify({
  assignments: [
    {
      teamIndex: 0,
      slotIndex: 0,
      skillSlotIndex: 1,
      skill: '治疗术',
      reason: '魏甲智力较高，治疗补足队伍续航且不改变其后排谋略定位。',
      evidence: ['治疗量受智力影响', 'HS|魏甲|治疗术 为正向证据'],
    },
  ],
});

describe('skill completion context', () => {
  it('retrieves skill semantics, estimates, formation, teammates, bonds, and learned evidence', () => {
    const context = buildSkillCompletionContext(oneSkillBlankInput, skillTestKnowledge);

    expect(context.availableSkills[0]).toMatchObject({
      name: '治疗术',
      description: '治疗我军，并根据智力提高治疗量。',
      estimates: { healingEstimate: 0.6 },
      generalEvidence: { id: 'S|治疗术', weight: 0.2 },
    });
    expect(context.heroes[0]).toMatchObject({
      hero: '魏甲',
      formation: '雁形阵',
      formationEffect: '后排造成伤害提升，前排承伤。',
      emptySkillSlots: [1],
      activeBonds: [{ name: '魏援' }],
    });
    expect(context.heroes[0]?.teammates.map(({ name }) => name)).toEqual(['魏乙', '魏丙']);
    expect(context.heroes[0]?.candidateEvidence[0]?.features.map(({ id }) => id)).toEqual([
      'S|治疗术',
      'HS|魏甲|治疗术',
      'SP|魏甲|治疗术|甲技',
    ]);
  });
});

describe('skill completion LangGraph', () => {
  it('fills every empty skill slot with high reasoning effort', async () => {
    const model = new FakeChatModel(validAssignment);
    const result = await runSkillCompletion(oneSkillBlankInput, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({ status: 'complete', attempts: 1 });
    expect(result.teams[0]?.heroes[0]?.skills).toEqual(['甲技', '治疗术']);
    expect(result.teams[0]?.heroes[1]).toEqual(oneSkillBlankInput.teams[0]?.heroes[1]);
    expect(model.requests[0]).toMatchObject({
      reasoningEffort: 'high',
      maxCompletionTokens: 8192,
    });
    expect(model.requests[0]?.messages[1]?.content).toContain('兵刃伤害 versus 谋略伤害');
  });

  it('retries with validation feedback and accepts a correction', async () => {
    const invalid = JSON.stringify({
      assignments: [
        {
          teamIndex: 0,
          slotIndex: 0,
          skillSlotIndex: 1,
          skill: '不存在',
          reason: 'invalid',
          evidence: [],
        },
      ],
    });
    const model = new FakeChatModel([invalid, validAssignment]);

    const result = await runSkillCompletion(oneSkillBlankInput, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({ status: 'complete', attempts: 2 });
    expect(model.requests[1]?.messages[1]?.content).toContain(
      'Skill 不存在 is not a legal available skill'
    );
  });

  it('leaves empty skill slots unchanged after three invalid attempts', async () => {
    const model = new FakeChatModel('invalid output');
    const result = await runSkillCompletion(oneSkillBlankInput, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result.status).toBe('incomplete');
    expect(result.attempts).toBe(3);
    expect(result.assignments).toEqual([]);
    expect(result.teams).toEqual(oneSkillBlankInput.teams);
    expect(result.warnings.join(' ')).toContain('empty skill slots remain blank');
    expect(model.requests).toHaveLength(3);
  });

  it('rejects assigning a hero its own signature skill', async () => {
    const model = new FakeChatModel(
      JSON.stringify({
        assignments: [
          {
            teamIndex: 0,
            slotIndex: 0,
            skillSlotIndex: 1,
            skill: '甲策',
            reason: 'invalid',
            evidence: [],
          },
        ],
      })
    );
    const result = await runSkillCompletion(
      { ...oneSkillBlankInput, availableSkills: ['甲策'] },
      { model, knowledge: skillTestKnowledge }
    );

    expect(result.status).toBe('incomplete');
    expect(result.warnings.join(' ')).toContain(
      'Hero 魏甲 cannot equip its own signature skill 甲策'
    );
  });

  it('skips the model when no skill slot is empty', async () => {
    const model = new FakeChatModel('not used');
    const completed: SkillCompletionInput = {
      ...oneSkillBlankInput,
      availableSkills: [],
      teams: [
        {
          ...oneSkillBlankInput.teams[0]!,
          heroes: [
            { ...oneSkillBlankInput.teams[0]!.heroes[0]!, skills: ['甲技', '治疗术'] },
            oneSkillBlankInput.teams[0]!.heroes[1]!,
            oneSkillBlankInput.teams[0]!.heroes[2]!,
          ],
        },
      ],
    };

    const result = await runSkillCompletion(completed, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({ status: 'complete', attempts: 0, assignments: [] });
    expect(model.requests).toEqual([]);
  });

  it('returns an incomplete result for an insufficient legal skill pool without calling the model', async () => {
    const model = new FakeChatModel('not used');
    const result = await runSkillCompletion(
      { ...oneSkillBlankInput, availableSkills: [] },
      { model, knowledge: skillTestKnowledge }
    );

    expect(result.status).toBe('incomplete');
    expect(result.attempts).toBe(0);
    expect(result.assignments).toEqual([]);
    expect(result.teams).toEqual(oneSkillBlankInput.teams);
    expect(result.warnings.join(' ')).toContain('empty skill slots remain blank');
    expect(model.requests).toEqual([]);
  });

  it('does not re-filter availableSkills by season', () => {
    const laterSeasonKnowledge: typeof skillTestKnowledge = {
      ...skillTestKnowledge,
      database: {
        ...skillTestKnowledge.database,
        skills: {
          ...skillTestKnowledge.database.skills,
          治疗术: { ...skillTestKnowledge.database.skills['治疗术']!, season: 9 },
        },
      },
    };

    const context = buildSkillCompletionContext(
      { ...oneSkillBlankInput, season: 1 },
      laterSeasonKnowledge
    );

    expect(context.availableSkills.map(({ name }) => name)).toContain('治疗术');
  });
});
