import { END, START, StateGraph, StateSchema, type GraphNode } from '@langchain/langgraph';
import { z } from 'zod';
import type { ChatModel, ReasoningEffort } from '../model.js';
import { buildHeroCompletionContext, findBlankPositions } from './candidates.js';
import type { GameKnowledge } from './gameData.js';
import { cloneTeams, extractJson } from './graphUtils.js';
import {
  heroCompletionContextSchema,
  heroAssignmentSchema,
  heroCompletionInputSchema,
  heroCompletionResultSchema,
  modelDecisionSchema,
  type HeroCompletionContext,
  type HeroAssignment,
  type HeroCompletionInput,
  type HeroCompletionResult,
  type PartialTeam,
} from './schemas.js';

const HeroCompletionState = new StateSchema({
  input: heroCompletionInputSchema,
  context: heroCompletionContextSchema.optional(),
  proposedAssignments: z.array(heroAssignmentSchema).default(() => []),
  modelFailure: z.string().nullable().default(null),
  validationErrors: z.array(z.string()).default(() => []),
  attemptCount: z.number().int().nonnegative().default(0),
  result: heroCompletionResultSchema.optional(),
});

export const DEFAULT_MAX_REASONING_ATTEMPTS = 3;

export interface HeroCompletionSubgraphOptions {
  model: ChatModel;
  knowledge: GameKnowledge;
  reasoningEffort?: ReasoningEffort;
  maxCompletionTokens?: number;
  maxReasoningAttempts?: number;
}

function positionKey(teamIndex: number, slotIndex: number): string {
  return `${teamIndex}:${slotIndex}`;
}

function applyAssignments(
  input: HeroCompletionInput,
  assignments: HeroAssignment[]
): PartialTeam[] {
  const teams = cloneTeams(input.teams);
  for (const assignment of assignments) {
    const slot = teams[assignment.teamIndex]?.heroes[assignment.slotIndex];
    if (slot === undefined) throw new Error('Validated assignment references an unknown slot');
    slot.hero = assignment.hero;
  }
  return teams;
}

export function buildHeroCompletionPrompt(
  context: HeroCompletionContext,
  previousAssignments: HeroAssignment[],
  validationErrors: string[]
): string {
  const retryFeedback =
    validationErrors.length === 0
      ? []
      : [
          '',
          'Previous attempt was rejected. Correct every error and return a complete replacement response:',
          JSON.stringify({ previousAssignments, validationErrors }),
        ];
  return [
    'Fill every blank hero position using only its team candidateSet.',
    '',
    'Hard rules:',
    '- Preserve every already-filled hero, row, formation, and skill slot exactly.',
    '- Assign exactly one different hero to every blank; never reuse a hero across teams.',
    '- Two heroes from the same camp give all three team members a 5% attribute boost.',
    '- Three heroes from the same camp give all three team members a 10% attribute boost.',
    '- Prefer same-camp completion, but weigh it against signature-skill mechanics, bonds, formation fit, known teams, and learned battle evidence.',
    '- Missing numeric skill estimates mean unknown, not zero.',
    '- learnedEvidence is relative roster-strength evidence, not a win probability.',
    '- heroCatalog contains shared hero facts; candidateSets contain team-specific evidence.',
    '',
    'Return JSON only in this shape:',
    '{"assignments":[{"teamIndex":0,"slotIndex":2,"hero":"武将名","reason":"concise grounded reason","evidence":["specific fact"]}]}',
    ...retryFeedback,
    '',
    'Hero-completion context:',
    JSON.stringify(context),
  ].join('\n');
}

function validateAssignments(
  input: HeroCompletionInput,
  context: HeroCompletionContext,
  assignments: HeroAssignment[]
): string[] {
  const errors: string[] = [];
  const requiredPositions = new Set(
    context.teams.flatMap(({ teamIndex, blankSlots }) =>
      blankSlots.map(({ slotIndex }) => positionKey(teamIndex, slotIndex))
    )
  );
  const seenPositions = new Set<string>();
  const originalHeroes = new Set(
    input.teams.flatMap((team) =>
      team.heroes.flatMap(({ hero }) => (hero === null ? [] : [hero]))
    )
  );
  const assignedHeroes = new Set<string>();

  if (assignments.length !== requiredPositions.size) {
    errors.push(
      `Expected ${requiredPositions.size} assignments but received ${assignments.length}`
    );
  }
  for (const assignment of assignments) {
    const key = positionKey(assignment.teamIndex, assignment.slotIndex);
    if (!requiredPositions.has(key)) errors.push(`Assignment targets non-blank position ${key}`);
    if (seenPositions.has(key)) errors.push(`Position ${key} was assigned more than once`);
    seenPositions.add(key);
    if (originalHeroes.has(assignment.hero) || assignedHeroes.has(assignment.hero)) {
      errors.push(`Hero ${assignment.hero} would be used more than once`);
    }
    assignedHeroes.add(assignment.hero);
    const teamContext = context.teams.find(({ teamIndex }) => teamIndex === assignment.teamIndex);
    const candidates =
      teamContext === undefined ? undefined : context.candidateSets[teamContext.candidateSet];
    if (candidates === undefined || !candidates.some(({ hero }) => hero === assignment.hero)) {
      errors.push(`Hero ${assignment.hero} is not a retrieved legal candidate for ${key}`);
    }
  }
  for (const required of requiredPositions) {
    if (!seenPositions.has(required)) errors.push(`Blank position ${required} was not filled`);
  }
  return errors;
}

export function createHeroCompletionSubgraph(options: HeroCompletionSubgraphOptions) {
  const reasoningEffort = options.reasoningEffort ?? 'high';
  const maxReasoningAttempts =
    options.maxReasoningAttempts ?? DEFAULT_MAX_REASONING_ATTEMPTS;
  if (!Number.isInteger(maxReasoningAttempts) || maxReasoningAttempts < 1) {
    throw new Error('maxReasoningAttempts must be a positive integer');
  }

  const prepareNode: GraphNode<typeof HeroCompletionState> = (state) => {
    const context = buildHeroCompletionContext(state.input, options.knowledge);
    if (context.teams.length === 0) {
      return {
        context,
        result: {
          teams: cloneTeams(state.input.teams),
          assignments: [],
          status: 'complete',
          attempts: 0,
          warnings: [],
        },
      };
    }
    return { context };
  };

  const reasonNode: GraphNode<typeof HeroCompletionState> = async (state) => {
    if (state.context === undefined) throw new Error('Hero context was not prepared');
    try {
      const blankCount = state.context.teams.reduce(
        (total, team) => total + team.blankSlots.length,
        0
      );
      const maxCompletionTokens =
        options.maxCompletionTokens ?? Math.min(8192, Math.max(2048, blankCount * 768));
      const completion = await options.model.complete({
        messages: [
          {
            role: 'developer',
            content:
              'You are a Sanmou team-completion reasoner. Follow the supplied candidate boundary and return strict JSON.',
          },
          {
            role: 'user',
            content: buildHeroCompletionPrompt(
              state.context,
              state.proposedAssignments,
              state.validationErrors
            ),
          },
        ],
        reasoningEffort,
        maxCompletionTokens,
      });
      const decision = modelDecisionSchema.parse(extractJson(completion.content));
      return {
        proposedAssignments: decision.assignments,
        modelFailure: null,
        attemptCount: state.attemptCount + 1,
      };
    } catch (error) {
      return {
        proposedAssignments: [],
        modelFailure: error instanceof Error ? error.message : String(error),
        attemptCount: state.attemptCount + 1,
      };
    }
  };

  const validateNode: GraphNode<typeof HeroCompletionState> = (state) => {
    if (state.context === undefined) throw new Error('Hero context was not prepared');
    const validationErrors = validateAssignments(
      state.input,
      state.context,
      state.proposedAssignments
    );
    if (state.modelFailure !== null) validationErrors.unshift(state.modelFailure);
    if (validationErrors.length > 0) {
      if (state.attemptCount < maxReasoningAttempts) return { validationErrors };
      return {
        validationErrors,
        result: {
          teams: cloneTeams(state.input.teams),
          assignments: [],
          status: 'incomplete',
          attempts: state.attemptCount,
          warnings: [
            `Model did not produce a valid complete assignment after ${state.attemptCount} attempts; hero slots remain blank.`,
            ...validationErrors,
          ],
        },
      };
    }
    return {
      validationErrors: [],
      result: {
        teams: applyAssignments(state.input, state.proposedAssignments),
        assignments: state.proposedAssignments,
        status: 'complete',
        attempts: state.attemptCount,
        warnings: [],
      },
    };
  };

  return new StateGraph(HeroCompletionState)
    .addNode('prepare_context', prepareNode)
    .addNode('reason_about_heroes', reasonNode)
    .addNode('validate_decision', validateNode)
    .addEdge(START, 'prepare_context')
    .addConditionalEdges('prepare_context', (state) =>
      state.result === undefined ? 'reason_about_heroes' : END
    )
    .addEdge('reason_about_heroes', 'validate_decision')
    .addConditionalEdges('validate_decision', (state) =>
      state.result === undefined ? 'reason_about_heroes' : END
    )
    .compile();
}

export async function runHeroCompletion(
  input: HeroCompletionInput,
  options: HeroCompletionSubgraphOptions
): Promise<HeroCompletionResult> {
  const parsed = heroCompletionInputSchema.parse(input);
  const expectedBlanks = findBlankPositions(parsed).length;
  const state = await createHeroCompletionSubgraph(options).invoke({ input: parsed });
  if (state.result === undefined) throw new Error('Hero completion graph ended without a result');
  if (
    state.result.status === 'complete' &&
    state.result.assignments.length !== expectedBlanks
  ) {
    throw new Error('Hero completion graph did not fill every blank position');
  }
  if (state.result.status === 'incomplete' && state.result.assignments.length !== 0) {
    throw new Error('Incomplete hero completion result must not apply partial assignments');
  }
  return state.result;
}
