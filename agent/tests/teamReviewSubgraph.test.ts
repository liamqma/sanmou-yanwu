import { describe, expect, it } from 'vitest';
import { buildTeamReviewContext } from '../src/team/teamReviewContext.js';
import {
  runTeamReview,
  type TeamReviewAttemptDiagnostic,
} from '../src/team/teamReviewSubgraph.js';
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
      reasoningEffort: 'xhigh',
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

  it('turns schema violations into compact actionable retry feedback', async () => {
    const strengths = Array.from({ length: 7 }, (_, index) => ({
      category: index === 0 ? 'damage' : 'formation',
      message: `strength ${index}`,
      evidence:
        index === 1
          ? Array.from({ length: 6 }, () => ({
              source: 'formation',
              id: '雁形阵',
            }))
          : [{ source: 'formation', id: '雁形阵' }],
    }));
    const invalidReview = JSON.stringify({
      teams: [{ teamIndex: 0, strengths, warnings: [] }],
      crossTeamWarnings: [],
    });
    const model = new FakeChatModel([invalidReview, validReviewDecision], {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    const diagnostics: TeamReviewAttemptDiagnostic[] = [];

    const result = await runTeamReview(
      { teams: completeReviewTeams },
      {
        model,
        knowledge: skillTestKnowledge,
        onAttempt: (diagnostic) => diagnostics.push(diagnostic),
      }
    );

    expect(result).toMatchObject({ status: 'complete', attempts: 2 });
    const initialPrompt = model.requests[0]?.messages[1]?.content ?? '';
    const retryPrompt = model.requests[1]?.messages[1]?.content ?? '';
    expect(retryPrompt).toContain(
      'teams[0].strengths[0].category: use one of camp, bond, formation'
    );
    expect(retryPrompt).toContain(
      'teams[0].strengths[1].evidence: return at most 5 items'
    );
    expect(retryPrompt).toContain(
      'teams[0].strengths: return at most 6 items'
    );
    expect(retryPrompt).not.toContain('invalid_value');
    expect(retryPrompt).not.toContain('too_big');
    expect(retryPrompt.length - initialPrompt.length).toBeLessThan(2_000);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      attempt: 1,
      outcome: 'rejected',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    expect(diagnostics[0]?.promptCharacters).toBe(initialPrompt.length);
    expect(diagnostics[0]?.promptBytes).toBeGreaterThan(initialPrompt.length);
    expect(diagnostics[1]).toMatchObject({
      attempt: 2,
      outcome: 'accepted',
      validationErrors: [],
    });
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
    expect(result.warnings.join(' ')).not.toContain('invalid_value');
    expect(result.warnings.join(' ')).not.toContain('"code"');
    expect(result.warnings.join(' ').length).toBeLessThan(1_000);
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
