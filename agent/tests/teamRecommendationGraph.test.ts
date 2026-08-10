import { describe, expect, it } from 'vitest';
import { runTeamRecommendation } from '../src/team/teamRecommendationGraph.js';
import type { TeamRecommendationInput } from '../src/team/teamRecommendationSchemas.js';
import {
  completeReviewTeams,
  FakeChatModel,
  skillTestKnowledge,
  validReviewDecision,
} from './teamFixtures.js';

const input: TeamRecommendationInput = {
  season: 1,
  availableHeroes: ['魏甲', '魏乙', '魏丙', '蜀甲'],
  availableSkills: ['治疗术'],
  teams: [
    {
      formation: null,
      heroes: [
        { hero: '魏甲', row: null, skills: ['甲技', null] },
        { hero: '魏乙', row: '前排', skills: ['乙技', '丙技'] },
        { hero: null, row: null, skills: ['丁技', '戊技'] },
      ],
    },
  ],
};

const heroDecision = JSON.stringify({
  assignments: [
    {
      teamIndex: 0,
      slotIndex: 2,
      hero: '魏丙',
      reason: '三魏触发10%属性加成。',
      evidence: ['同阵营三人'],
    },
  ],
});

const formationDecision = JSON.stringify({
  decisions: [
    {
      teamIndex: 0,
      formation: '雁形阵',
      rows: [
        { slotIndex: 0, row: '后排' },
        { slotIndex: 1, row: '前排' },
        { slotIndex: 2, row: '后排' },
      ],
      reason: '乙在前排承伤，甲与丙在后排发挥。',
      evidence: ['雁形阵后排增伤'],
    },
  ],
});

const skillDecision = JSON.stringify({
  assignments: [
    {
      teamIndex: 0,
      slotIndex: 0,
      skillSlotIndex: 1,
      skill: '治疗术',
      reason: '利用智力补充团队治疗。',
      evidence: ['治疗受智力影响'],
    },
  ],
});

describe('unified team recommendation LangGraph', () => {
  it('recommends heroes, formations, rows, and skills in one invocation', async () => {
    const model = new FakeChatModel([
      heroDecision,
      formationDecision,
      skillDecision,
      validReviewDecision,
    ]);
    const result = await runTeamRecommendation(input, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({
      status: 'complete',
      stoppedAt: null,
      attempts: { heroes: 1, formations: 1, skills: 1, review: 1 },
    });
    expect(result.teams[0]).toMatchObject({
      formation: '雁形阵',
      heroes: [
        { hero: '魏甲', row: '后排', skills: ['甲技', '治疗术'] },
        { hero: '魏乙', row: '前排', skills: ['乙技', '丙技'] },
        { hero: '魏丙', row: '后排', skills: ['丁技', '戊技'] },
      ],
    });
    expect(result.heroAssignments).toHaveLength(1);
    expect(result.formationDecisions).toHaveLength(1);
    expect(result.skillAssignments).toHaveLength(1);
    expect(result.review).toMatchObject({ status: 'complete', verdict: 'sound' });
    expect(model.requests).toHaveLength(4);
  });

  it('routes an already complete lineup directly to review', async () => {
    const model = new FakeChatModel(validReviewDecision);
    const completeInput: TeamRecommendationInput = {
      season: 1,
      availableHeroes: [],
      availableSkills: [],
      teams: completeReviewTeams,
    };

    const result = await runTeamRecommendation(completeInput, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({
      status: 'complete',
      stoppedAt: null,
      attempts: { heroes: 0, formations: 0, skills: 0, review: 1 },
      heroAssignments: [],
      formationDecisions: [],
      skillAssignments: [],
      review: { status: 'complete', verdict: 'sound' },
    });
    expect(result.teams).toEqual(completeReviewTeams);
    expect(model.requests).toHaveLength(1);
  });

  it('keeps a complete lineup usable when advisory review is unavailable', async () => {
    const model = new FakeChatModel('invalid output');
    const result = await runTeamRecommendation(
      {
        season: 1,
        availableHeroes: [],
        availableSkills: [],
        teams: completeReviewTeams,
      },
      {
        model,
        knowledge: skillTestKnowledge,
      }
    );

    expect(result).toMatchObject({
      status: 'complete',
      stoppedAt: null,
      attempts: { heroes: 0, formations: 0, skills: 0, review: 3 },
      review: { status: 'unavailable', verdict: null },
    });
    expect(result.teams).toEqual(completeReviewTeams);
    expect(result.warnings.join(' ')).toContain('Team review was unavailable');
    expect(model.requests).toHaveLength(3);
  });

  it('stops before formation and skills when hero completion remains invalid', async () => {
    const model = new FakeChatModel('invalid output');
    const result = await runTeamRecommendation(input, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({
      status: 'incomplete',
      stoppedAt: 'heroes',
      attempts: { heroes: 3, formations: 0, skills: 0 },
    });
    expect(result.teams).toEqual(input.teams);
    expect(model.requests).toHaveLength(3);
  });

  it('keeps validated heroes but stops before skills when formation remains invalid', async () => {
    const model = new FakeChatModel([heroDecision, 'invalid output']);
    const result = await runTeamRecommendation(input, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({
      status: 'incomplete',
      stoppedAt: 'formations',
      attempts: { heroes: 1, formations: 3, skills: 0 },
    });
    expect(result.teams[0]?.heroes[2]?.hero).toBe('魏丙');
    expect(result.teams[0]?.formation).toBeNull();
    expect(result.teams[0]?.heroes[0]?.skills[1]).toBeNull();
    expect(model.requests).toHaveLength(4);
  });

  it('keeps validated heroes and layout but leaves skills blank after skill failure', async () => {
    const model = new FakeChatModel([heroDecision, formationDecision, 'invalid output']);
    const result = await runTeamRecommendation(input, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({
      status: 'incomplete',
      stoppedAt: 'skills',
      attempts: { heroes: 1, formations: 1, skills: 3 },
    });
    expect(result.teams[0]?.heroes[2]?.hero).toBe('魏丙');
    expect(result.teams[0]?.formation).toBe('雁形阵');
    expect(result.teams[0]?.heroes[0]?.skills[1]).toBeNull();
    expect(result.skillAssignments).toEqual([]);
    expect(model.requests).toHaveLength(5);
  });

  it('keeps validated heroes and layout when the skill pool cannot fill every slot', async () => {
    const model = new FakeChatModel([heroDecision, formationDecision]);
    const result = await runTeamRecommendation(
      { ...input, availableSkills: [] },
      { model, knowledge: skillTestKnowledge }
    );

    expect(result).toMatchObject({
      status: 'incomplete',
      stoppedAt: 'skills',
      attempts: { heroes: 1, formations: 1, skills: 0 },
    });
    expect(result.heroAssignments).toHaveLength(1);
    expect(result.formationDecisions).toHaveLength(1);
    expect(result.teams[0]?.heroes[2]?.hero).toBe('魏丙');
    expect(result.teams[0]?.formation).toBe('雁形阵');
    expect(result.teams[0]?.heroes[0]?.skills[1]).toBeNull();
    expect(result.skillAssignments).toEqual([]);
    expect(result.warnings.join(' ')).toContain('empty skill slots remain blank');
    expect(model.requests).toHaveLength(2);
  });
});
