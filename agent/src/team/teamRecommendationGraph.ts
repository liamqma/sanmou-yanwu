import { END, START, StateGraph, StateSchema, type GraphNode } from '@langchain/langgraph';
import type { ChatModel, ReasoningEffort } from '../model.js';
import {
  runFormationCompletion,
  type FormationCompletionGraphOptions,
} from './formationCompletionGraph.js';
import { formationCompletionResultSchema } from './formationSchemas.js';
import type { GameKnowledge } from './gameData.js';
import {
  runHeroCompletion,
  type HeroCompletionGraphOptions,
} from './heroCompletionGraph.js';
import { heroCompletionResultSchema } from './schemas.js';
import {
  runSkillCompletion,
  type SkillCompletionGraphOptions,
} from './skillCompletionGraph.js';
import { skillCompletionResultSchema } from './skillSchemas.js';
import {
  teamRecommendationInputSchema,
  teamRecommendationResultSchema,
  type TeamRecommendationInput,
  type TeamRecommendationResult,
} from './teamRecommendationSchemas.js';

const TeamRecommendationState = new StateSchema({
  input: teamRecommendationInputSchema,
  heroResult: heroCompletionResultSchema.optional(),
  formationResult: formationCompletionResultSchema.optional(),
  skillResult: skillCompletionResultSchema.optional(),
  result: teamRecommendationResultSchema.optional(),
});

export interface TeamRecommendationGraphOptions {
  model: ChatModel;
  knowledge: GameKnowledge;
  reasoningEffort?: ReasoningEffort;
  hero?: Pick<HeroCompletionGraphOptions, 'maxCompletionTokens'>;
  formation?: Pick<FormationCompletionGraphOptions, 'maxCompletionTokens'>;
  skill?: Pick<SkillCompletionGraphOptions, 'maxCompletionTokens'>;
}

function sharedOptions(options: TeamRecommendationGraphOptions) {
  return {
    model: options.model,
    knowledge: options.knowledge,
    ...(options.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: options.reasoningEffort }),
  };
}

export function createTeamRecommendationGraph(options: TeamRecommendationGraphOptions) {
  const completeHeroesNode: GraphNode<typeof TeamRecommendationState> = async (state) => {
    const heroResult = await runHeroCompletion(state.input, {
      ...sharedOptions(options),
      ...options.hero,
    });
    if (heroResult.status === 'incomplete') {
      return {
        heroResult,
        result: {
          teams: heroResult.teams,
          status: 'incomplete',
          stoppedAt: 'heroes',
          attempts: { heroes: heroResult.attempts, formations: 0, skills: 0 },
          heroAssignments: [],
          formationDecisions: [],
          skillAssignments: [],
          warnings: heroResult.warnings,
        },
      };
    }
    return { heroResult };
  };

  const completeFormationsNode: GraphNode<typeof TeamRecommendationState> = async (state) => {
    if (state.heroResult === undefined) throw new Error('Hero stage did not produce a result');
    const formationResult = await runFormationCompletion(
      { teams: state.heroResult.teams },
      { ...sharedOptions(options), ...options.formation }
    );
    if (formationResult.status === 'incomplete') {
      return {
        formationResult,
        result: {
          teams: formationResult.teams,
          status: 'incomplete',
          stoppedAt: 'formations',
          attempts: {
            heroes: state.heroResult.attempts,
            formations: formationResult.attempts,
            skills: 0,
          },
          heroAssignments: state.heroResult.assignments,
          formationDecisions: [],
          skillAssignments: [],
          warnings: [...state.heroResult.warnings, ...formationResult.warnings],
        },
      };
    }
    return { formationResult };
  };

  const completeSkillsNode: GraphNode<typeof TeamRecommendationState> = async (state) => {
    if (state.heroResult === undefined || state.formationResult === undefined) {
      throw new Error('Earlier recommendation stages did not produce results');
    }
    const skillResult = await runSkillCompletion(
      {
        teams: state.formationResult.teams,
        availableSkills: state.input.availableSkills,
        season: state.input.season,
      },
      { ...sharedOptions(options), ...options.skill }
    );
    const complete = skillResult.status === 'complete';
    return {
      skillResult,
      result: {
        teams: skillResult.teams,
        status: skillResult.status,
        stoppedAt: complete ? null : 'skills',
        attempts: {
          heroes: state.heroResult.attempts,
          formations: state.formationResult.attempts,
          skills: skillResult.attempts,
        },
        heroAssignments: state.heroResult.assignments,
        formationDecisions: state.formationResult.decisions,
        skillAssignments: complete ? skillResult.assignments : [],
        warnings: [
          ...state.heroResult.warnings,
          ...state.formationResult.warnings,
          ...skillResult.warnings,
        ],
      },
    };
  };

  return new StateGraph(TeamRecommendationState)
    .addNode('complete_heroes', completeHeroesNode)
    .addNode('complete_formations', completeFormationsNode)
    .addNode('complete_skills', completeSkillsNode)
    .addEdge(START, 'complete_heroes')
    .addConditionalEdges('complete_heroes', (state) =>
      state.result === undefined ? 'complete_formations' : END
    )
    .addConditionalEdges('complete_formations', (state) =>
      state.result === undefined ? 'complete_skills' : END
    )
    .addEdge('complete_skills', END)
    .compile();
}

export async function runTeamRecommendation(
  input: TeamRecommendationInput,
  options: TeamRecommendationGraphOptions
): Promise<TeamRecommendationResult> {
  const parsed = teamRecommendationInputSchema.parse(input);
  const state = await createTeamRecommendationGraph(options).invoke({ input: parsed });
  if (state.result === undefined) {
    throw new Error('Team recommendation graph ended without a result');
  }
  return state.result;
}
