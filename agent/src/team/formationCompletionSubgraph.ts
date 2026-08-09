import { END, START, StateGraph, StateSchema, type GraphNode } from '@langchain/langgraph';
import { z } from 'zod';
import type { ChatModel, ReasoningEffort } from '../model.js';
import {
  buildFormationCompletionContext,
  findFormationTargets,
} from './formationContext.js';
import { cloneTeams, extractJson } from './graphUtils.js';
import type { GameKnowledge } from './gameData.js';
import {
  formationCompletionInputSchema,
  formationCompletionContextSchema,
  formationCompletionResultSchema,
  formationModelDecisionSchema,
  formationTeamDecisionSchema,
  type FormationCompletionInput,
  type FormationCompletionResult,
  type FormationCompletionContext,
  type FormationTeamDecision,
} from './formationSchemas.js';
import type { PartialTeam } from './schemas.js';

const MAX_FORMATION_REASONING_ATTEMPTS = 3;

const FormationCompletionState = new StateSchema({
  input: formationCompletionInputSchema,
  context: formationCompletionContextSchema.optional(),
  proposedDecisions: z.array(formationTeamDecisionSchema).default(() => []),
  modelFailure: z.string().nullable().default(null),
  validationErrors: z.array(z.string()).default(() => []),
  attemptCount: z.number().int().nonnegative().default(0),
  result: formationCompletionResultSchema.optional(),
});

export interface FormationCompletionSubgraphOptions {
  model: ChatModel;
  knowledge: GameKnowledge;
  reasoningEffort?: ReasoningEffort;
  maxCompletionTokens?: number;
}

function assertCatalogBackedInput(
  input: FormationCompletionInput,
  knowledge: GameKnowledge
): void {
  input.teams.forEach((team, teamIndex) => {
    if (
      team.formation !== null &&
      knowledge.database.formations[team.formation] === undefined
    ) {
      throw new Error(`Unknown formation on team ${teamIndex}: ${team.formation}`);
    }
    team.heroes.forEach((slot, slotIndex) => {
      if (slot.hero === null) return;
      const hero = knowledge.database.heroes[slot.hero];
      if (hero === undefined) throw new Error(`Unknown filled hero: ${slot.hero}`);
      if (knowledge.database.skills[hero.skill] === undefined) {
        throw new Error(`Missing signature skill ${hero.skill} for ${slot.hero}`);
      }
      slot.skills.forEach((skillName) => {
        if (skillName !== null && knowledge.database.skills[skillName] === undefined) {
          throw new Error(
            `Unknown assigned skill on team ${teamIndex} slot ${slotIndex}: ${skillName}`
          );
        }
      });
    });
  });
}

export function buildFormationCompletionPrompt(
  context: FormationCompletionContext,
  previousDecisions: FormationTeamDecision[],
  validationErrors: string[]
): string {
  const retryFeedback =
    validationErrors.length === 0
      ? []
      : [
          '',
          'Previous attempt was rejected. Correct every error and return a complete replacement response:',
          JSON.stringify({ previousDecisions, validationErrors }),
        ];
  return [
    'Choose a formation and front/back row for every team context.',
    '',
    'Hard rules:',
    '- Preserve every hero and extra skill exactly.',
    '- Preserve any existing non-null formation or row exactly; fill only null values.',
    '- Choose formations only from formationCatalog and use its supplied effects as ground truth.',
    '- Return all three slot rows for each target team, including preserved rows.',
    '- Use hero stats and skill mechanics to decide damage, support, and durability roles.',
    '- Consider active bonds, exact known-team references, and learned evidence when relevant.',
    '- Do not invent formation restrictions that are absent from the supplied effects.',
    '- learnedEvidence is relative roster-strength evidence, not a win probability.',
    '',
    'Return JSON only in this shape:',
    '{"decisions":[{"teamIndex":1,"formation":"雁形阵","rows":[{"slotIndex":0,"row":"前排"},{"slotIndex":1,"row":"后排"},{"slotIndex":2,"row":"后排"}],"reason":"concise grounded reason","evidence":["specific fact"]}]}',
    ...retryFeedback,
    '',
    'Formation-completion context:',
    JSON.stringify(context),
  ].join('\n');
}

function validateDecisions(
  input: FormationCompletionInput,
  context: FormationCompletionContext,
  decisions: FormationTeamDecision[],
  knowledge: GameKnowledge
): string[] {
  const errors: string[] = [];
  const requiredTeams = new Set(context.teams.map(({ teamIndex }) => teamIndex));
  const seenTeams = new Set<number>();

  if (decisions.length !== requiredTeams.size) {
    errors.push(`Expected ${requiredTeams.size} team decisions but received ${decisions.length}`);
  }

  for (const decision of decisions) {
    if (!requiredTeams.has(decision.teamIndex)) {
      errors.push(`Decision targets team ${decision.teamIndex}, which has no missing layout value`);
    }
    if (seenTeams.has(decision.teamIndex)) {
      errors.push(`Team ${decision.teamIndex} was decided more than once`);
    }
    seenTeams.add(decision.teamIndex);

    const team = input.teams[decision.teamIndex];
    if (team === undefined) {
      errors.push(`Decision targets unknown team ${decision.teamIndex}`);
      continue;
    }
    if (knowledge.database.formations[decision.formation] === undefined) {
      errors.push(`Formation ${decision.formation} is not a legal catalog formation`);
    }
    if (team.formation !== null && decision.formation !== team.formation) {
      errors.push(`Team ${decision.teamIndex} formation ${team.formation} must be preserved`);
    }

    const seenSlots = new Set<number>();
    for (const rowDecision of decision.rows) {
      if (seenSlots.has(rowDecision.slotIndex)) {
        errors.push(
          `Team ${decision.teamIndex} slot ${rowDecision.slotIndex} row was decided more than once`
        );
      }
      seenSlots.add(rowDecision.slotIndex);
      const slot = team.heroes[rowDecision.slotIndex];
      if (slot === undefined) {
        errors.push(`Team ${decision.teamIndex} has no slot ${rowDecision.slotIndex}`);
      } else if (slot.row !== null && rowDecision.row !== slot.row) {
        errors.push(
          `Team ${decision.teamIndex} slot ${rowDecision.slotIndex} row ${slot.row} must be preserved`
        );
      }
    }
    for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
      if (!seenSlots.has(slotIndex)) {
        errors.push(`Team ${decision.teamIndex} slot ${slotIndex} row was not decided`);
      }
    }
  }

  for (const teamIndex of requiredTeams) {
    if (!seenTeams.has(teamIndex)) errors.push(`Team ${teamIndex} layout was not decided`);
  }
  return errors;
}

function applyDecisions(
  input: FormationCompletionInput,
  decisions: FormationTeamDecision[]
): PartialTeam[] {
  const teams = cloneTeams(input.teams);
  for (const decision of decisions) {
    const team = teams[decision.teamIndex];
    if (team === undefined) throw new Error('Validated decision references an unknown team');
    team.formation = decision.formation;
    for (const rowDecision of decision.rows) {
      const slot = team.heroes[rowDecision.slotIndex];
      if (slot === undefined) throw new Error('Validated decision references an unknown slot');
      slot.row = rowDecision.row;
    }
  }
  return teams;
}

export function createFormationCompletionSubgraph(
  options: FormationCompletionSubgraphOptions
) {
  const reasoningEffort = options.reasoningEffort ?? 'high';

  const prepareNode: GraphNode<typeof FormationCompletionState> = (state) => {
    assertCatalogBackedInput(state.input, options.knowledge);
    const context = buildFormationCompletionContext(state.input, options.knowledge);
    if (context.teams.length === 0) {
      return {
        context,
        result: {
          teams: cloneTeams(state.input.teams),
          decisions: [],
          status: 'complete',
          attempts: 0,
          warnings: [],
        },
      };
    }
    return { context };
  };

  const reasonNode: GraphNode<typeof FormationCompletionState> = async (state) => {
    if (state.context === undefined) throw new Error('Formation context was not prepared');
    try {
      const maxCompletionTokens =
        options.maxCompletionTokens ??
        Math.min(8192, Math.max(4096, state.context.teams.length * 2048));
      const completion = await options.model.complete({
        messages: [
          {
            role: 'developer',
            content:
              'You are a Sanmou formation-and-position reasoner. Follow the supplied catalog boundary and return strict JSON.',
          },
          {
            role: 'user',
            content: buildFormationCompletionPrompt(
              state.context,
              state.proposedDecisions,
              state.validationErrors
            ),
          },
        ],
        reasoningEffort,
        maxCompletionTokens,
      });
      const decision = formationModelDecisionSchema.parse(extractJson(completion.content));
      return {
        proposedDecisions: decision.decisions,
        modelFailure: null,
        attemptCount: state.attemptCount + 1,
      };
    } catch (error) {
      return {
        proposedDecisions: [],
        modelFailure: error instanceof Error ? error.message : String(error),
        attemptCount: state.attemptCount + 1,
      };
    }
  };

  const validateNode: GraphNode<typeof FormationCompletionState> = (state) => {
    if (state.context === undefined) throw new Error('Formation context was not prepared');
    const validationErrors = validateDecisions(
      state.input,
      state.context,
      state.proposedDecisions,
      options.knowledge
    );
    if (state.modelFailure !== null) validationErrors.unshift(state.modelFailure);
    if (validationErrors.length > 0) {
      if (state.attemptCount < MAX_FORMATION_REASONING_ATTEMPTS) {
        return { validationErrors };
      }
      return {
        validationErrors,
        result: {
          teams: cloneTeams(state.input.teams),
          decisions: [],
          status: 'incomplete',
          attempts: state.attemptCount,
          warnings: [
            `Model did not produce a valid complete formation assignment after ${state.attemptCount} attempts; missing formations and rows remain blank.`,
            ...validationErrors,
          ],
        },
      };
    }
    return {
      validationErrors: [],
      result: {
        teams: applyDecisions(state.input, state.proposedDecisions),
        decisions: state.proposedDecisions,
        status: 'complete',
        attempts: state.attemptCount,
        warnings: [],
      },
    };
  };

  return new StateGraph(FormationCompletionState)
    .addNode('prepare_formation_context', prepareNode)
    .addNode('reason_about_formations', reasonNode)
    .addNode('validate_formations', validateNode)
    .addEdge(START, 'prepare_formation_context')
    .addConditionalEdges('prepare_formation_context', (state) =>
      state.result === undefined ? 'reason_about_formations' : END
    )
    .addEdge('reason_about_formations', 'validate_formations')
    .addConditionalEdges('validate_formations', (state) =>
      state.result === undefined ? 'reason_about_formations' : END
    )
    .compile();
}

export async function runFormationCompletion(
  input: FormationCompletionInput,
  options: FormationCompletionSubgraphOptions
): Promise<FormationCompletionResult> {
  const parsed = formationCompletionInputSchema.parse(input);
  const expectedTargets = findFormationTargets(parsed).length;
  const state = await createFormationCompletionSubgraph(options).invoke({ input: parsed });
  if (state.result === undefined) {
    throw new Error('Formation completion graph ended without a result');
  }
  if (
    state.result.status === 'complete' &&
    state.result.decisions.length !== expectedTargets
  ) {
    throw new Error('Formation completion graph did not complete every target team');
  }
  if (state.result.status === 'incomplete' && state.result.decisions.length !== 0) {
    throw new Error('Incomplete formation result must not apply partial decisions');
  }
  return state.result;
}
