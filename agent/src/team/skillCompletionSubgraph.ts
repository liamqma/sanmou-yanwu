import { END, START, StateGraph, StateSchema, type GraphNode } from '@langchain/langgraph';
import { z } from 'zod';
import type { ChatModel, ReasoningEffort } from '../model.js';
import { cloneTeams, extractJson } from './graphUtils.js';
import type { GameKnowledge } from './gameData.js';
import {
  buildSkillCompletionContext,
  findEmptySkillPositions,
  legalAvailableSkills,
} from './skillContext.js';
import {
  skillAssignmentSchema,
  skillCompletionContextSchema,
  skillCompletionInputSchema,
  skillCompletionResultSchema,
  skillModelDecisionSchema,
  type SkillAssignment,
  type SkillCompletionContext,
  type SkillCompletionInput,
  type SkillCompletionResult,
} from './skillSchemas.js';
import type { PartialTeam } from './schemas.js';

const MAX_SKILL_REASONING_ATTEMPTS = 3;

const SkillCompletionState = new StateSchema({
  input: skillCompletionInputSchema,
  context: skillCompletionContextSchema.optional(),
  proposedAssignments: z.array(skillAssignmentSchema).default(() => []),
  modelFailure: z.string().nullable().default(null),
  validationErrors: z.array(z.string()).default(() => []),
  attemptCount: z.number().int().nonnegative().default(0),
  result: skillCompletionResultSchema.optional(),
});

export interface SkillCompletionSubgraphOptions {
  model: ChatModel;
  knowledge: GameKnowledge;
  reasoningEffort?: ReasoningEffort;
  maxCompletionTokens?: number;
}

function positionKey(
  teamIndex: number,
  slotIndex: number,
  skillSlotIndex: number
): string {
  return `${teamIndex}:${slotIndex}:${skillSlotIndex}`;
}

export function buildSkillCompletionPrompt(
  context: SkillCompletionContext,
  previousAssignments: SkillAssignment[],
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
    'Assign one skill to every empty extra-skill slot as a joint team-building decision.',
    '',
    'Hard rules:',
    '- Preserve every hero, formation, row, and existing non-null skill exactly.',
    '- Use only skills named in skillCatalog and use each catalog skill at most once.',
    '- Return exactly one assignment for every emptySkillSlots entry in every team hero context.',
    '- Reason about 兵刃伤害 versus 谋略伤害, hero stats, signature mechanics, formation and row effects, the other heroes in each team, active bonds, and team balance.',
    '- Use S, HS, and SP learned evidence when present. Treat it as relative roster-strength evidence, not a win probability.',
    '- Missing numeric estimates and missing learned features mean unknown, not zero.',
    '',
    'Return JSON only in this shape:',
    '{"assignments":[{"teamIndex":0,"slotIndex":1,"skillSlotIndex":1,"skill":"战法名","reason":"concise grounded reason","evidence":["specific fact"]}]}',
    ...retryFeedback,
    '',
    'Skill-completion context:',
    JSON.stringify(context),
  ].join('\n');
}

function validateAssignments(
  input: SkillCompletionInput,
  assignments: SkillAssignment[],
  legalSkills: string[],
  knowledge: GameKnowledge
): string[] {
  const errors: string[] = [];
  const requiredPositions = new Set(
    findEmptySkillPositions(input).map(({ teamIndex, slotIndex, skillSlotIndex }) =>
      positionKey(teamIndex, slotIndex, skillSlotIndex)
    )
  );
  const legalSkillSet = new Set(legalSkills);
  const existingSkills = new Set(
    input.teams.flatMap((team) =>
      team.heroes.flatMap((slot) =>
        slot.skills.flatMap((skill) => (skill === null ? [] : [skill]))
      )
    )
  );
  const seenPositions = new Set<string>();
  const assignedSkills = new Set<string>();

  if (assignments.length !== requiredPositions.size) {
    errors.push(
      `Expected ${requiredPositions.size} skill assignments but received ${assignments.length}`
    );
  }
  for (const assignment of assignments) {
    const key = positionKey(
      assignment.teamIndex,
      assignment.slotIndex,
      assignment.skillSlotIndex
    );
    if (!requiredPositions.has(key)) {
      errors.push(`Skill assignment targets non-blank position ${key}`);
    }
    if (seenPositions.has(key)) errors.push(`Skill position ${key} was assigned more than once`);
    seenPositions.add(key);

    if (!legalSkillSet.has(assignment.skill)) {
      errors.push(`Skill ${assignment.skill} is not a legal available skill`);
    }
    if (existingSkills.has(assignment.skill) || assignedSkills.has(assignment.skill)) {
      errors.push(`Skill ${assignment.skill} would be used more than once`);
    }
    assignedSkills.add(assignment.skill);

    const heroName = input.teams[assignment.teamIndex]?.heroes[assignment.slotIndex]?.hero;
    if (heroName !== null && heroName !== undefined) {
      const signature = knowledge.database.heroes[heroName]?.skill;
      if (signature === assignment.skill) {
        errors.push(`Hero ${heroName} cannot equip its own signature skill ${assignment.skill}`);
      }
    }
  }
  for (const required of requiredPositions) {
    if (!seenPositions.has(required)) errors.push(`Empty skill position ${required} was not filled`);
  }
  return errors;
}

function applyAssignments(
  input: SkillCompletionInput,
  assignments: SkillAssignment[]
): PartialTeam[] {
  const teams = cloneTeams(input.teams);
  for (const assignment of assignments) {
    const slot = teams[assignment.teamIndex]?.heroes[assignment.slotIndex];
    if (slot === undefined) throw new Error('Validated skill assignment references an unknown slot');
    slot.skills[assignment.skillSlotIndex] = assignment.skill;
  }
  return teams;
}

export function createSkillCompletionSubgraph(options: SkillCompletionSubgraphOptions) {
  const reasoningEffort = options.reasoningEffort ?? 'high';

  const prepareNode: GraphNode<typeof SkillCompletionState> = (state) => {
    const targets = findEmptySkillPositions(state.input);
    if (targets.length === 0) {
      return {
        result: {
          teams: cloneTeams(state.input.teams),
          assignments: [],
          status: 'complete',
          attempts: 0,
          warnings: [],
        },
      };
    }
    const legalSkills = legalAvailableSkills(state.input, options.knowledge);
    if (legalSkills.length < targets.length) {
      return {
        result: {
          teams: cloneTeams(state.input.teams),
          assignments: [],
          status: 'incomplete',
          attempts: 0,
          warnings: [
            `Only ${legalSkills.length} legal unused skills are available for ${targets.length} empty skill slots; empty skill slots remain blank.`,
          ],
        },
      };
    }
    return { context: buildSkillCompletionContext(state.input, options.knowledge) };
  };

  const reasonNode: GraphNode<typeof SkillCompletionState> = async (state) => {
    if (state.context === undefined) throw new Error('Skill context was not prepared');
    try {
      const targetCount = findEmptySkillPositions(state.input).length;
      const maxCompletionTokens =
        options.maxCompletionTokens ??
        Math.min(16384, Math.max(8192, targetCount * 768));
      const completion = await options.model.complete({
        messages: [
          {
            role: 'developer',
            content:
              'You are a Sanmou skill-assignment reasoner. Follow the supplied catalog boundary and return strict JSON.',
          },
          {
            role: 'user',
            content: buildSkillCompletionPrompt(
              state.context,
              state.proposedAssignments,
              state.validationErrors
            ),
          },
        ],
        reasoningEffort,
        maxCompletionTokens,
      });
      const decision = skillModelDecisionSchema.parse(extractJson(completion.content));
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

  const validateNode: GraphNode<typeof SkillCompletionState> = (state) => {
    const validationErrors = validateAssignments(
      state.input,
      state.proposedAssignments,
      legalAvailableSkills(state.input, options.knowledge),
      options.knowledge
    );
    if (state.modelFailure !== null) validationErrors.unshift(state.modelFailure);
    if (validationErrors.length > 0) {
      if (state.attemptCount < MAX_SKILL_REASONING_ATTEMPTS) {
        return { validationErrors };
      }
      return {
        validationErrors,
        result: {
          teams: cloneTeams(state.input.teams),
          assignments: [],
          status: 'incomplete',
          attempts: state.attemptCount,
          warnings: [
            `Model did not produce a valid complete skill assignment after ${state.attemptCount} attempts; empty skill slots remain blank.`,
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

  return new StateGraph(SkillCompletionState)
    .addNode('prepare_skill_context', prepareNode)
    .addNode('reason_about_skills', reasonNode)
    .addNode('validate_skills', validateNode)
    .addEdge(START, 'prepare_skill_context')
    .addConditionalEdges('prepare_skill_context', (state) =>
      state.result === undefined ? 'reason_about_skills' : END
    )
    .addEdge('reason_about_skills', 'validate_skills')
    .addConditionalEdges('validate_skills', (state) =>
      state.result === undefined ? 'reason_about_skills' : END
    )
    .compile();
}

export async function runSkillCompletion(
  input: SkillCompletionInput,
  options: SkillCompletionSubgraphOptions
): Promise<SkillCompletionResult> {
  const parsed = skillCompletionInputSchema.parse(input);
  const expectedTargets = findEmptySkillPositions(parsed).length;
  const state = await createSkillCompletionSubgraph(options).invoke({ input: parsed });
  if (state.result === undefined) throw new Error('Skill completion graph ended without a result');
  if (
    state.result.status === 'complete' &&
    state.result.assignments.length !== expectedTargets
  ) {
    throw new Error('Skill completion graph did not fill every empty skill position');
  }
  if (state.result.status === 'incomplete' && state.result.assignments.length !== 0) {
    throw new Error('Incomplete skill result must not apply partial assignments');
  }
  return state.result;
}
