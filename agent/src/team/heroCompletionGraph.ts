import { END, START, StateGraph, StateSchema, type GraphNode } from '@langchain/langgraph';
import { z } from 'zod';
import type { ChatModel, ReasoningEffort } from '../model.js';
import { buildBlankContexts, candidateEvidence, findBlankPositions } from './candidates.js';
import type { GameKnowledge } from './gameData.js';
import {
  blankContextSchema,
  heroAssignmentSchema,
  heroCompletionInputSchema,
  heroCompletionResultSchema,
  modelDecisionSchema,
  type BlankContext,
  type CandidateEvidence,
  type HeroAssignment,
  type HeroCompletionInput,
  type HeroCompletionResult,
  type PartialTeam,
} from './schemas.js';

const HeroCompletionState = new StateSchema({
  input: heroCompletionInputSchema,
  contexts: z.array(blankContextSchema).default(() => []),
  proposedAssignments: z.array(heroAssignmentSchema).default(() => []),
  modelFailure: z.string().nullable().default(null),
  validationErrors: z.array(z.string()).default(() => []),
  result: heroCompletionResultSchema.optional(),
});

export interface HeroCompletionGraphOptions {
  model: ChatModel;
  knowledge: GameKnowledge;
  reasoningEffort?: ReasoningEffort;
  maxCompletionTokens?: number;
}

function positionKey(teamIndex: number, slotIndex: number): string {
  return `${teamIndex}:${slotIndex}`;
}

function cloneTeams(teams: PartialTeam[]): PartialTeam[] {
  return teams.map((team) => ({
    formation: team.formation,
    heroes: team.heroes.map((slot) => ({
      hero: slot.hero,
      row: slot.row,
      skills: [...slot.skills],
    })) as PartialTeam['heroes'],
  }));
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

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Model response did not contain a JSON object');
  return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
}

function promptFor(contexts: BlankContext[]): string {
  return [
    'Fill every blank hero position using only the candidates provided for that position.',
    '',
    'Hard rules:',
    '- Preserve every already-filled hero, row, formation, and skill slot exactly.',
    '- Assign exactly one different hero to every blank; never reuse a hero across teams.',
    '- Two heroes from the same camp give all three team members a 5% attribute boost.',
    '- Three heroes from the same camp give all three team members a 10% attribute boost.',
    '- Prefer same-camp completion, but weigh it against signature-skill mechanics, bonds, formation fit, known teams, and learned battle evidence.',
    '- Missing numeric skill estimates mean unknown, not zero.',
    '- learnedEvidence is relative roster-strength evidence, not a win probability.',
    '- retrievalScore only selected a focused candidate shortlist; do not present it as game strength.',
    '',
    'Return JSON only in this shape:',
    '{"assignments":[{"teamIndex":0,"slotIndex":2,"hero":"武将名","reason":"concise grounded reason","evidence":["specific fact"]}]}',
    '',
    'Blank-position context:',
    JSON.stringify(contexts, null, 2),
  ].join('\n');
}

function validateAssignments(
  input: HeroCompletionInput,
  contexts: BlankContext[],
  assignments: HeroAssignment[]
): string[] {
  const errors: string[] = [];
  const requiredPositions = new Set(
    contexts.map(({ position }) => positionKey(position.teamIndex, position.slotIndex))
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
    const context = contexts.find(
      ({ position }) =>
        position.teamIndex === assignment.teamIndex &&
        position.slotIndex === assignment.slotIndex
    );
    if (context === undefined || !context.candidates.some(({ hero }) => hero === assignment.hero)) {
      errors.push(`Hero ${assignment.hero} is not a retrieved legal candidate for ${key}`);
    }
  }
  for (const required of requiredPositions) {
    if (!seenPositions.has(required)) errors.push(`Blank position ${required} was not filled`);
  }
  return errors;
}

function fallbackEvidence(candidate: CandidateEvidence): string[] {
  const evidence: string[] = [];
  if (candidate.campBonusAfter > candidate.campBonusBefore) {
    evidence.push(`阵营属性加成提升至${candidate.campBonusAfter * 100}%`);
  }
  if (candidate.activatedBonds[0] !== undefined) {
    evidence.push(`激活缘分：${candidate.activatedBonds[0].name}`);
  }
  if (candidate.knownTeams[0] !== undefined) {
    evidence.push(`参考${candidate.knownTeams[0].ranking}级已知阵容`);
  }
  if (candidate.learnedEvidence.features.length > 0) {
    evidence.push(
      `历史模型贡献${candidate.learnedEvidence.contribution.toFixed(3)}，最低证据${candidate.learnedEvidence.minimumSupport}场`
    );
  }
  return evidence.length === 0 ? ['deterministic legal fallback'] : evidence.slice(0, 5);
}

interface FallbackBeam {
  assignments: HeroAssignment[];
  teamHeroes: string[][];
  used: Set<string>;
  score: number;
  key: string;
}

function deterministicFallback(
  input: HeroCompletionInput,
  contexts: BlankContext[],
  knowledge: GameKnowledge
): HeroAssignment[] {
  const initialTeamHeroes = input.teams.map((team) =>
    team.heroes.flatMap(({ hero }) => (hero === null ? [] : [hero]))
  );
  let beam: FallbackBeam[] = [
    {
      assignments: [],
      teamHeroes: initialTeamHeroes,
      used: new Set(initialTeamHeroes.flat()),
      score: 0,
      key: '',
    },
  ];

  for (const context of contexts) {
    const expanded: FallbackBeam[] = [];
    for (const option of beam) {
      for (const candidate of context.candidates) {
        if (option.used.has(candidate.hero)) continue;
        const currentTeam = option.teamHeroes[context.position.teamIndex] ?? [];
        const dynamicEvidence = candidateEvidence(candidate.hero, currentTeam, knowledge);
        const assignment: HeroAssignment = {
          teamIndex: context.position.teamIndex,
          slotIndex: context.position.slotIndex,
          hero: candidate.hero,
          reason: '模型结果无效或不可用，采用确定性候选证据完成空位。',
          evidence: fallbackEvidence(dynamicEvidence),
        };
        const teamHeroes = option.teamHeroes.map((heroes) => [...heroes]);
        teamHeroes[context.position.teamIndex]?.push(candidate.hero);
        const used = new Set(option.used);
        used.add(candidate.hero);
        expanded.push({
          assignments: [...option.assignments, assignment],
          teamHeroes,
          used,
          score: option.score + dynamicEvidence.retrievalScore,
          key: `${option.key}|${candidate.hero}`,
        });
      }
    }
    expanded.sort((left, right) =>
      right.score !== left.score ? right.score - left.score : left.key.localeCompare(right.key)
    );
    beam = expanded.slice(0, 128);
    if (beam.length === 0) throw new Error('No globally unique fallback assignment exists');
  }
  return beam[0]?.assignments ?? [];
}

export function createHeroCompletionGraph(options: HeroCompletionGraphOptions) {
  const reasoningEffort = options.reasoningEffort ?? 'high';

  const prepareNode: GraphNode<typeof HeroCompletionState> = (state) => {
    const contexts = buildBlankContexts(state.input, options.knowledge);
    if (contexts.length === 0) {
      return {
        contexts,
        result: {
          teams: cloneTeams(state.input.teams),
          assignments: [],
          usedFallback: false,
          warnings: [],
        },
      };
    }
    return { contexts };
  };

  const reasonNode: GraphNode<typeof HeroCompletionState> = async (state) => {
    try {
      const maxCompletionTokens =
        options.maxCompletionTokens ?? Math.min(8192, Math.max(2048, state.contexts.length * 768));
      const completion = await options.model.complete({
        messages: [
          {
            role: 'developer',
            content:
              'You are a Sanmou team-completion reasoner. Follow the supplied candidate boundary and return strict JSON.',
          },
          { role: 'user', content: promptFor(state.contexts) },
        ],
        reasoningEffort,
        maxCompletionTokens,
      });
      const decision = modelDecisionSchema.parse(extractJson(completion.content));
      return {
        proposedAssignments: decision.assignments,
        modelFailure: null,
      };
    } catch (error) {
      return {
        proposedAssignments: [],
        modelFailure: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const validateNode: GraphNode<typeof HeroCompletionState> = (state) => {
    const validationErrors = validateAssignments(
      state.input,
      state.contexts,
      state.proposedAssignments
    );
    if (state.modelFailure !== null) validationErrors.unshift(state.modelFailure);
    if (validationErrors.length > 0) return { validationErrors };
    return {
      validationErrors: [],
      result: {
        teams: applyAssignments(state.input, state.proposedAssignments),
        assignments: state.proposedAssignments,
        usedFallback: false,
        warnings: [],
      },
    };
  };

  const fallbackNode: GraphNode<typeof HeroCompletionState> = (state) => {
    const assignments = deterministicFallback(state.input, state.contexts, options.knowledge);
    return {
      result: {
        teams: applyAssignments(state.input, assignments),
        assignments,
        usedFallback: true,
        warnings: state.validationErrors,
      },
    };
  };

  return new StateGraph(HeroCompletionState)
    .addNode('prepare_context', prepareNode)
    .addNode('reason_about_heroes', reasonNode)
    .addNode('validate_decision', validateNode)
    .addNode('deterministic_fallback', fallbackNode)
    .addEdge(START, 'prepare_context')
    .addConditionalEdges('prepare_context', (state) =>
      state.result === undefined ? 'reason_about_heroes' : END
    )
    .addEdge('reason_about_heroes', 'validate_decision')
    .addConditionalEdges('validate_decision', (state) =>
      state.result === undefined ? 'deterministic_fallback' : END
    )
    .addEdge('deterministic_fallback', END)
    .compile();
}

export async function runHeroCompletion(
  input: HeroCompletionInput,
  options: HeroCompletionGraphOptions
): Promise<HeroCompletionResult> {
  const parsed = heroCompletionInputSchema.parse(input);
  const expectedBlanks = findBlankPositions(parsed).length;
  const state = await createHeroCompletionGraph(options).invoke({ input: parsed });
  if (state.result === undefined) throw new Error('Hero completion graph ended without a result');
  if (state.result.assignments.length !== expectedBlanks) {
    throw new Error('Hero completion graph did not fill every blank position');
  }
  return state.result;
}
