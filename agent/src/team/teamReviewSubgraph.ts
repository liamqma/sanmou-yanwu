import { END, START, StateGraph, StateSchema, type GraphNode } from '@langchain/langgraph';
import { z } from 'zod';
import type { ChatModel, ReasoningEffort } from '../model.js';
import { extractJson } from './graphUtils.js';
import type { GameKnowledge } from './gameData.js';
import type { PartialTeam } from './schemas.js';
import { buildTeamReviewContext } from './teamReviewContext.js';
import {
  teamReviewContextSchema,
  teamReviewInputSchema,
  teamReviewModelDecisionSchema,
  teamReviewResultSchema,
  type TeamReviewContext,
  type TeamReviewInput,
  type TeamReviewModelDecision,
  type TeamReviewResult,
} from './teamReviewSchemas.js';

const DEFAULT_MAX_REVIEW_ATTEMPTS = 3;

const TeamReviewState = new StateSchema({
  input: teamReviewInputSchema,
  context: teamReviewContextSchema.optional(),
  proposedReview: teamReviewModelDecisionSchema.optional(),
  modelFailure: z.string().nullable().default(null),
  validationErrors: z.array(z.string()).default(() => []),
  attemptCount: z.number().int().nonnegative().default(0),
  result: teamReviewResultSchema.optional(),
});

export interface TeamReviewSubgraphOptions {
  model: ChatModel;
  knowledge: GameKnowledge;
  reasoningEffort?: ReasoningEffort;
  maxCompletionTokens?: number;
  maxReviewAttempts?: number;
}

export function buildTeamReviewPrompt(
  context: TeamReviewContext,
  previousReview: TeamReviewModelDecision | undefined,
  validationErrors: string[]
): string {
  const retryFeedback =
    validationErrors.length === 0
      ? []
      : [
          '',
          'Previous response was rejected. Correct every error and return a complete replacement response:',
          JSON.stringify({ previousReview, validationErrors }),
        ];
  return [
    'Review every completed Sanmou team. Report strengths and warnings only; never change the lineup.',
    '',
    'Hard rules:',
    '- Return exactly one review for every teamIndex.',
    '- Keep team warnings inside that team; use crossTeamWarnings only for interactions across teams.',
    '- Cite only exact IDs present in the supplied context, using the matching source.',
    '- Use critical only for a material incompatibility; use warning for a meaningful improvement opportunity.',
    '- Do not repeat deterministicRuleWarnings in the model-generated warnings.',
    '- Reason about 兵刃伤害 versus 谋略伤害, hero stats, signature and extra-skill mechanics, formation and row effects, camps, bonds, sustain, control, and team balance.',
    '- Learned features are relative roster-strength evidence, not win probabilities. Missing estimates or features mean unknown, not zero.',
    '- Known teams are references, not mandatory builds. Do not invent restrictions absent from formation effects or skill descriptions.',
    '- Write concise Chinese messages and suggested actions. Do not output hidden chain-of-thought.',
    '',
    'Return JSON only in this shape:',
    '{"teams":[{"teamIndex":0,"strengths":[{"category":"formation","message":"...","evidence":[{"source":"formation","id":"雁形阵"}]}],"warnings":[{"severity":"warning","category":"damage_type","message":"...","suggestedAction":"...","evidence":[{"source":"hero","id":"武将名"},{"source":"skill","id":"战法名"}]}]}],"crossTeamWarnings":[]}',
    ...retryFeedback,
    '',
    'Team-review context:',
    JSON.stringify(context),
  ].join('\n');
}

function evidenceKey(source: string, id: string): string {
  return `${source}:${id}`;
}

function allowedEvidenceForTeam(
  context: TeamReviewContext,
  teamIndex: number
): Set<string> {
  const team = context.teams.find((candidate) => candidate.teamIndex === teamIndex);
  if (team === undefined) return new Set();
  const allowed = new Set<string>();
  allowed.add(evidenceKey('formation', team.formation.name));
  allowed.add(evidenceKey('campBonus', team.campBonus.id));
  for (const bond of team.activeBonds) allowed.add(evidenceKey('bond', bond.name));
  for (const knownTeam of team.knownTeamReferences) {
    allowed.add(evidenceKey('knownTeam', knownTeam.id));
  }
  for (const hero of team.heroes) {
    allowed.add(evidenceKey('hero', hero.hero));
    const catalogHero = context.heroCatalog[hero.hero];
    if (catalogHero?.generalEvidence !== null && catalogHero?.generalEvidence !== undefined) {
      allowed.add(evidenceKey('learnedFeature', catalogHero.generalEvidence.id));
    }
    const relevantSkills = [catalogHero?.signatureSkill, ...hero.extraSkills].filter(
      (skill): skill is string => skill !== undefined
    );
    for (const skill of relevantSkills) {
      allowed.add(evidenceKey('skill', skill));
      const catalogSkill = context.skillCatalog[skill];
      if (catalogSkill?.generalEvidence !== null && catalogSkill?.generalEvidence !== undefined) {
        allowed.add(evidenceKey('learnedFeature', catalogSkill.generalEvidence.id));
      }
    }
    for (const feature of hero.skillEvidence) {
      allowed.add(evidenceKey('learnedFeature', feature.id));
    }
  }
  for (const feature of team.pairEvidence) {
    allowed.add(evidenceKey('learnedFeature', feature.id));
  }
  return allowed;
}

function validateEvidence(
  label: string,
  evidence: Array<{ source: string; id: string }>,
  allowed: Set<string>,
  errors: string[]
): void {
  for (const reference of evidence) {
    if (!allowed.has(evidenceKey(reference.source, reference.id))) {
      errors.push(`${label} cites unavailable evidence ${reference.source}:${reference.id}`);
    }
  }
}

function validateReview(
  context: TeamReviewContext,
  review: TeamReviewModelDecision | undefined
): string[] {
  if (review === undefined) return ['Model did not return a structured team review'];
  const errors: string[] = [];
  const requiredTeams = new Set(context.teams.map(({ teamIndex }) => teamIndex));
  const seenTeams = new Set<number>();
  if (review.teams.length !== requiredTeams.size) {
    errors.push(`Expected ${requiredTeams.size} team reviews but received ${review.teams.length}`);
  }
  for (const teamReview of review.teams) {
    if (!requiredTeams.has(teamReview.teamIndex)) {
      errors.push(`Review targets unknown team ${teamReview.teamIndex}`);
    }
    if (seenTeams.has(teamReview.teamIndex)) {
      errors.push(`Team ${teamReview.teamIndex} was reviewed more than once`);
    }
    seenTeams.add(teamReview.teamIndex);
    const allowed = allowedEvidenceForTeam(context, teamReview.teamIndex);
    teamReview.strengths.forEach((strength, index) =>
      validateEvidence(
        `Team ${teamReview.teamIndex} strength ${index}`,
        strength.evidence,
        allowed,
        errors
      )
    );
    teamReview.warnings.forEach((warning, index) =>
      validateEvidence(
        `Team ${teamReview.teamIndex} warning ${index}`,
        warning.evidence,
        allowed,
        errors
      )
    );
  }
  for (const teamIndex of requiredTeams) {
    if (!seenTeams.has(teamIndex)) errors.push(`Team ${teamIndex} was not reviewed`);
  }

  const globalAllowed = new Set(
    context.teams.flatMap((team) => [...allowedEvidenceForTeam(context, team.teamIndex)])
  );
  review.crossTeamWarnings.forEach((warning, index) => {
    if (warning.teamIndexes.length < 2) {
      errors.push(`Cross-team warning ${index} must target at least two teams`);
    }
    if (new Set(warning.teamIndexes).size !== warning.teamIndexes.length) {
      errors.push(`Cross-team warning ${index} repeats a teamIndex`);
    }
    for (const teamIndex of warning.teamIndexes) {
      if (!requiredTeams.has(teamIndex)) {
        errors.push(`Cross-team warning ${index} targets unknown team ${teamIndex}`);
      }
    }
    validateEvidence(`Cross-team warning ${index}`, warning.evidence, globalAllowed, errors);
  });
  return errors;
}

function verdictForWarnings(
  warnings: Array<{ severity: 'warning' | 'critical' }>
): 'sound' | 'workable' | 'needs_changes' {
  if (warnings.some(({ severity }) => severity === 'critical')) return 'needs_changes';
  return warnings.length > 0 ? 'workable' : 'sound';
}

function completeResult(
  context: TeamReviewContext,
  review: TeamReviewModelDecision,
  attempts: number
): TeamReviewResult {
  const teams = review.teams
    .map((team) => {
      const deterministicWarnings = context.deterministicRuleWarnings.filter(({ teamIndexes }) =>
        teamIndexes.includes(team.teamIndex)
      );
      return {
        ...team,
        verdict: verdictForWarnings([...team.warnings, ...deterministicWarnings]),
      };
    })
    .sort((left, right) => left.teamIndex - right.teamIndex);
  const allWarnings = [
    ...teams.flatMap(({ warnings }) => warnings),
    ...review.crossTeamWarnings,
    ...context.deterministicRuleWarnings,
  ];
  return {
    status: 'complete',
    verdict: verdictForWarnings(allWarnings),
    teams,
    crossTeamWarnings: review.crossTeamWarnings,
    deterministicRuleWarnings: context.deterministicRuleWarnings,
    attempts,
    warnings: [],
  };
}

export function createTeamReviewSubgraph(options: TeamReviewSubgraphOptions) {
  const reasoningEffort = options.reasoningEffort ?? 'high';
  const maxReviewAttempts = options.maxReviewAttempts ?? DEFAULT_MAX_REVIEW_ATTEMPTS;
  if (!Number.isInteger(maxReviewAttempts) || maxReviewAttempts < 1) {
    throw new Error('maxReviewAttempts must be a positive integer');
  }

  const prepareNode: GraphNode<typeof TeamReviewState> = (state) => ({
    context: buildTeamReviewContext(state.input, options.knowledge),
  });

  const reasonNode: GraphNode<typeof TeamReviewState> = async (state) => {
    if (state.context === undefined) throw new Error('Team review context was not prepared');
    try {
      const completion = await options.model.complete({
        messages: [
          {
            role: 'developer',
            content:
              'You are a Sanmou team reviewer. Assess the supplied completed lineup without modifying it and return strict grounded JSON.',
          },
          {
            role: 'user',
            content: buildTeamReviewPrompt(
              state.context,
              state.proposedReview,
              state.validationErrors
            ),
          },
        ],
        reasoningEffort,
        maxCompletionTokens: options.maxCompletionTokens ?? 8192,
      });
      return {
        proposedReview: teamReviewModelDecisionSchema.parse(extractJson(completion.content)),
        modelFailure: null,
        attemptCount: state.attemptCount + 1,
      };
    } catch (error) {
      return {
        proposedReview: undefined,
        modelFailure: error instanceof Error ? error.message : String(error),
        attemptCount: state.attemptCount + 1,
      };
    }
  };

  const validateNode: GraphNode<typeof TeamReviewState> = (state) => {
    if (state.context === undefined) throw new Error('Team review context was not prepared');
    const validationErrors = validateReview(state.context, state.proposedReview);
    if (state.modelFailure !== null) validationErrors.unshift(state.modelFailure);
    if (validationErrors.length > 0) {
      if (state.attemptCount < maxReviewAttempts) return { validationErrors };
      return {
        validationErrors,
        result: {
          status: 'unavailable',
          verdict: null,
          teams: [],
          crossTeamWarnings: [],
          deterministicRuleWarnings: state.context.deterministicRuleWarnings,
          attempts: state.attemptCount,
          warnings: [
            `Team review was unavailable after ${state.attemptCount} attempts.`,
            ...validationErrors,
          ],
        },
      };
    }
    if (state.proposedReview === undefined) {
      throw new Error('Validated team review is missing');
    }
    return {
      validationErrors: [],
      result: completeResult(state.context, state.proposedReview, state.attemptCount),
    };
  };

  return new StateGraph(TeamReviewState)
    .addNode('prepare_review_context', prepareNode)
    .addNode('reason_about_team', reasonNode)
    .addNode('validate_review', validateNode)
    .addEdge(START, 'prepare_review_context')
    .addEdge('prepare_review_context', 'reason_about_team')
    .addEdge('reason_about_team', 'validate_review')
    .addConditionalEdges('validate_review', (state) =>
      state.result === undefined ? 'reason_about_team' : END
    )
    .compile();
}

export async function runTeamReview(
  input: { teams: PartialTeam[] },
  options: TeamReviewSubgraphOptions
): Promise<TeamReviewResult> {
  const parsed: TeamReviewInput = teamReviewInputSchema.parse(input);
  const state = await createTeamReviewSubgraph(options).invoke({ input: parsed });
  if (state.result === undefined) throw new Error('Team review graph ended without a result');
  return state.result;
}
