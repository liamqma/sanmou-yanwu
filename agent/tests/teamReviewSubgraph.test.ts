import { describe, expect, it } from 'vitest';
import { buildTeamReviewContext } from '../src/team/teamReviewContext.js';
import { runTeamReview } from '../src/team/teamReviewSubgraph.js';
import {
  completeReviewTeams,
  FakeChatModel,
  skillTestKnowledge,
  validReviewDecision,
} from './teamFixtures.js';

describe('team review context', () => {
  it('retrieves normalized semantics, team relationships, and relevant learned evidence', () => {
    const context = buildTeamReviewContext(
      { teams: completeReviewTeams },
      skillTestKnowledge
    );

    expect(context.heroCatalog['魏甲']).toMatchObject({
      camp: '魏',
      signatureSkill: '甲策',
    });
    expect(context.skillCatalog['治疗术']).toMatchObject({
      description: '治疗我军，并根据智力提高治疗量。',
      generalEvidence: { id: 'S|治疗术' },
    });
    expect(context.teams[0]).toMatchObject({
      campBonus: { id: 'team:0', bonus: 0.1, camps: ['魏', '魏', '魏'] },
      activeBonds: [{ name: '魏援' }],
      knownTeamReferences: [{ id: 'known-wei-team', matchCount: 3 }],
    });
    expect(context.teams[0]?.heroes[0]?.skillEvidence.map(({ id }) => id)).toEqual([
      'HS|魏甲|治疗术',
      'SP|魏甲|治疗术|甲技',
    ]);
    expect(context.deterministicRuleWarnings).toEqual([]);
  });
});

describe('TeamReviewSubgraph', () => {
  it('returns a grounded advisory review without changing the lineup', async () => {
    const model = new FakeChatModel(validReviewDecision);
    const input = { teams: structuredClone(completeReviewTeams) };
    const result = await runTeamReview(input, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({
      status: 'complete',
      verdict: 'sound',
      attempts: 1,
      teams: [{ teamIndex: 0, verdict: 'sound' }],
    });
    expect(input.teams).toEqual(completeReviewTeams);
    expect(model.requests[0]).toMatchObject({
      reasoningEffort: 'high',
      maxCompletionTokens: 8192,
    });
  });

  it('retries an invented evidence citation and accepts a grounded replacement', async () => {
    const inventedEvidence = JSON.stringify({
      teams: [
        {
          teamIndex: 0,
          strengths: [
            {
              category: 'formation',
              message: 'invalid',
              evidence: [{ source: 'formation', id: '不存在阵' }],
            },
          ],
          warnings: [],
        },
      ],
      crossTeamWarnings: [],
    });
    const model = new FakeChatModel([inventedEvidence, validReviewDecision]);

    const result = await runTeamReview(
      { teams: completeReviewTeams },
      { model, knowledge: skillTestKnowledge }
    );

    expect(result).toMatchObject({ status: 'complete', attempts: 2 });
    expect(model.requests[1]?.messages[1]?.content).toContain(
      'cites unavailable evidence formation:不存在阵'
    );
  });

  it('rejects a cross-team warning that targets only one team', async () => {
    const invalidCrossTeamWarning = JSON.stringify({
      teams: [{ teamIndex: 0, strengths: [], warnings: [] }],
      crossTeamWarnings: [
        {
          teamIndexes: [0],
          severity: 'warning',
          category: 'team_balance',
          message: 'not cross-team',
          suggestedAction: 'move this warning into the team review',
          evidence: [{ source: 'hero', id: '魏甲' }],
        },
      ],
    });
    const model = new FakeChatModel([invalidCrossTeamWarning, validReviewDecision]);

    const result = await runTeamReview(
      { teams: completeReviewTeams },
      { model, knowledge: skillTestKnowledge }
    );

    expect(result).toMatchObject({ status: 'complete', attempts: 2 });
    expect(model.requests[1]?.messages[1]?.content).toContain(
      'must target at least two teams'
    );
  });

  it('returns unavailable after three invalid responses without changing the lineup', async () => {
    const model = new FakeChatModel('invalid output');
    const input = { teams: structuredClone(completeReviewTeams) };

    const result = await runTeamReview(input, {
      model,
      knowledge: skillTestKnowledge,
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      verdict: null,
      attempts: 3,
      teams: [],
    });
    expect(result.warnings.join(' ')).toContain('Team review was unavailable');
    expect(input.teams).toEqual(completeReviewTeams);
    expect(model.requests).toHaveLength(3);
  });

  it('always reports deterministic duplicate and signature-skill warnings', async () => {
    const model = new FakeChatModel(validReviewDecision);
    const teams = structuredClone(completeReviewTeams);
    teams[0]!.heroes[0]!.skills = ['甲策', '治疗术'];
    teams[0]!.heroes[1]!.skills = ['治疗术', '丙技'];

    const result = await runTeamReview(
      { teams },
      { model, knowledge: skillTestKnowledge }
    );

    expect(result.verdict).toBe('needs_changes');
    expect(result.teams[0]?.verdict).toBe('needs_changes');
    expect(result.deterministicRuleWarnings).toHaveLength(2);
    expect(result.deterministicRuleWarnings.map(({ category }) => category)).toEqual([
      'resource_rule',
      'resource_rule',
    ]);
  });

  it('rejects an incomplete lineup before calling the model', async () => {
    const model = new FakeChatModel(validReviewDecision);
    const teams = structuredClone(completeReviewTeams);
    teams[0]!.heroes[0]!.skills[1] = null;

    await expect(
      runTeamReview(
        { teams },
        { model, knowledge: skillTestKnowledge }
      )
    ).rejects.toThrow('Team review requires every extra-skill slot to be filled');
    expect(model.requests).toEqual([]);
  });
});
