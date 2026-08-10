import { END, START, StateGraph, StateSchema, type GraphNode } from '@langchain/langgraph';
import type { ChatModel, ReasoningEffort } from '../model.js';
import {
  runFormationCompletion,
  type FormationCompletionSubgraphOptions,
} from './formationCompletionSubgraph.js';
import { formationCompletionResultSchema } from './formationSchemas.js';
import type { GameKnowledge } from './gameData.js';
import {
  runHeroCompletion,
  type HeroCompletionSubgraphOptions,
} from './heroCompletionSubgraph.js';
import { heroCompletionResultSchema } from './schemas.js';
import {
  runSkillCompletion,
  type SkillCompletionSubgraphOptions,
} from './skillCompletionSubgraph.js';
import { skillCompletionResultSchema } from './skillSchemas.js';
import {
  runTeamReview,
  type TeamReviewSubgraphOptions,
} from './teamReviewSubgraph.js';
import { teamReviewResultSchema } from './teamReviewSchemas.js';
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
  reviewResult: teamReviewResultSchema.optional(),
  result: teamRecommendationResultSchema.optional(),
});

export interface TeamRecommendationGraphOptions {
  model: ChatModel;
  knowledge: GameKnowledge;
  reasoningEffort?: ReasoningEffort;
  hero?: Pick<HeroCompletionSubgraphOptions, 'maxCompletionTokens'>;
  formation?: Pick<FormationCompletionSubgraphOptions, 'maxCompletionTokens'>;
  skill?: Pick<SkillCompletionSubgraphOptions, 'maxCompletionTokens'>;
  review?: Pick<
    TeamReviewSubgraphOptions,
    'maxCompletionTokens' | 'maxReviewAttempts' | 'onAttempt'
  >;
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
          attempts: { heroes: heroResult.attempts, formations: 0, skills: 0, review: 0 },
          heroAssignments: [],
          formationDecisions: [],
          skillAssignments: [],
          review: null,
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
            review: 0,
          },
          heroAssignments: state.heroResult.assignments,
          formationDecisions: [],
          skillAssignments: [],
          review: null,
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
    if (skillResult.status === 'complete') return { skillResult };
    return {
      skillResult,
      result: {
        teams: skillResult.teams,
        status: 'incomplete',
        stoppedAt: 'skills',
        attempts: {
          heroes: state.heroResult.attempts,
          formations: state.formationResult.attempts,
          skills: skillResult.attempts,
          review: 0,
        },
        heroAssignments: state.heroResult.assignments,
        formationDecisions: state.formationResult.decisions,
        skillAssignments: [],
        review: null,
        warnings: [
          ...state.heroResult.warnings,
          ...state.formationResult.warnings,
          ...skillResult.warnings,
        ],
      },
    };
  };

  const reviewTeamNode: GraphNode<typeof TeamRecommendationState> = async (state) => {
    const teams = state.skillResult?.teams ?? state.input.teams;
    const reviewResult = await runTeamReview(
      { teams },
      { ...sharedOptions(options), ...options.review }
    );
    return {
      reviewResult,
      result: {
        teams,
        status: 'complete',
        stoppedAt: null,
        attempts: {
          heroes: state.heroResult?.attempts ?? 0,
          formations: state.formationResult?.attempts ?? 0,
          skills: state.skillResult?.attempts ?? 0,
          review: reviewResult.attempts,
        },
        heroAssignments: state.heroResult?.assignments ?? [],
        formationDecisions: state.formationResult?.decisions ?? [],
        skillAssignments: state.skillResult?.assignments ?? [],
        review: reviewResult,
        warnings: [
          ...(state.heroResult?.warnings ?? []),
          ...(state.formationResult?.warnings ?? []),
          ...(state.skillResult?.warnings ?? []),
          ...reviewResult.warnings,
        ],
      },
    };
  };

  return new StateGraph(TeamRecommendationState)
    .addNode('complete_heroes', completeHeroesNode)
    .addNode('complete_formations', completeFormationsNode)
    .addNode('complete_skills', completeSkillsNode)
    .addNode('review_team', reviewTeamNode)
    .addConditionalEdges(START, (state) =>
      isLineupComplete(state.input.teams) ? 'review_team' : 'complete_heroes'
    )
    .addConditionalEdges('complete_heroes', (state) =>
      state.result === undefined ? 'complete_formations' : END
    )
    .addConditionalEdges('complete_formations', (state) =>
      state.result === undefined ? 'complete_skills' : END
    )
    .addConditionalEdges('complete_skills', (state) =>
      state.result === undefined ? 'review_team' : END
    )
    .addEdge('review_team', END)
    .compile();
}

export function isLineupComplete(teams: TeamRecommendationInput['teams']): boolean {
  return teams.every(
    (team) =>
      team.formation !== null &&
      team.heroes.every(
        (slot) =>
          slot.hero !== null &&
          slot.row !== null &&
          slot.skills.every((skill) => skill !== null)
      )
  );
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
