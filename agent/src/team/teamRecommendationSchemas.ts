import { z } from 'zod';
import { formationTeamDecisionSchema } from './formationSchemas.js';
import { heroAssignmentSchema, heroCompletionInputSchema, partialTeamSchema } from './schemas.js';
import { skillAssignmentSchema } from './skillSchemas.js';
import { teamReviewResultSchema } from './teamReviewSchemas.js';

export const teamRecommendationInputSchema = heroCompletionInputSchema.safeExtend({
  availableSkills: z.array(z.string().min(1)),
});

export type TeamRecommendationInput = z.infer<typeof teamRecommendationInputSchema>;

export const teamRecommendationResultSchema = z.object({
  teams: z.array(partialTeamSchema),
  status: z.enum(['complete', 'incomplete']),
  stoppedAt: z.enum(['heroes', 'formations', 'skills']).nullable(),
  attempts: z.object({
    heroes: z.number().int().nonnegative(),
    formations: z.number().int().nonnegative(),
    skills: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
  }),
  heroAssignments: z.array(heroAssignmentSchema),
  formationDecisions: z.array(formationTeamDecisionSchema),
  skillAssignments: z.array(skillAssignmentSchema),
  review: teamReviewResultSchema.nullable(),
  warnings: z.array(z.string()),
});

export type TeamRecommendationResult = z.infer<typeof teamRecommendationResultSchema>;
