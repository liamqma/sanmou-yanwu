import { z } from 'zod';
import { heroStatsSchema, partialTeamSchema } from './schemas.js';

export const formationCompletionInputSchema = z
  .object({
    teams: z.array(partialTeamSchema).min(1).max(3),
  })
  .superRefine((input, context) => {
    const assignedHeroes: string[] = [];
    input.teams.forEach((team, teamIndex) => {
      team.heroes.forEach((slot, slotIndex) => {
        if (slot.hero === null) {
          context.addIssue({
            code: 'custom',
            message: 'Formation completion requires every hero position to be filled',
            path: ['teams', teamIndex, 'heroes', slotIndex, 'hero'],
          });
        } else {
          assignedHeroes.push(slot.hero);
        }
      });
    });
    if (new Set(assignedHeroes).size !== assignedHeroes.length) {
      context.addIssue({
        code: 'custom',
        message: 'A hero cannot occupy more than one team position',
        path: ['teams'],
      });
    }
  });

export type FormationCompletionInput = z.infer<typeof formationCompletionInputSchema>;

export const formationTeamContextSchema = z.object({
  teamIndex: z.number().int().min(0).max(2),
  currentFormation: z.string().nullable(),
  heroes: z.array(
    z.object({
      slotIndex: z.number().int().min(0).max(2),
      name: z.string(),
      currentRow: z.enum(['前排', '后排']).nullable(),
      camp: z.string(),
      troop: z.string(),
      stats: heroStatsSchema,
      signatureSkill: z.object({
        name: z.string(),
        type: z.string(),
        description: z.string(),
      }),
      extraSkills: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string(),
        })
      ),
    })
  ).length(3),
  activeBonds: z.array(
    z.object({
      name: z.string(),
      effect: z.string(),
      condition: z.string(),
    })
  ),
  knownTeamReferences: z.array(
    z.object({
      id: z.string(),
      ranking: z.enum(['S', 'A', 'B']),
      championship: z.boolean(),
      formation: z.string(),
    })
  ),
  learnedEvidence: z.object({
    contribution: z.number(),
    minimumSupport: z.number(),
    features: z.array(
      z.object({
        id: z.string(),
        weight: z.number(),
        support: z.number(),
      })
    ),
  }),
});

export const formationCompletionContextSchema = z.object({
  formationCatalog: z.record(z.string(), z.string()),
  teams: z.array(formationTeamContextSchema),
});

export type FormationCompletionContext = z.infer<
  typeof formationCompletionContextSchema
>;

export const formationRowDecisionSchema = z.object({
  slotIndex: z.number().int().min(0).max(2),
  row: z.enum(['前排', '后排']),
});

export const formationTeamDecisionSchema = z.object({
  teamIndex: z.number().int().min(0).max(2),
  formation: z.string().min(1),
  rows: z.array(formationRowDecisionSchema).length(3),
  reason: z.string().min(1),
  evidence: z.array(z.string().min(1)).max(5),
});

export type FormationTeamDecision = z.infer<typeof formationTeamDecisionSchema>;

export const formationModelDecisionSchema = z
  .object({
    decisions: z.array(formationTeamDecisionSchema),
  })
  .strict();

export const formationCompletionResultSchema = z.object({
  teams: z.array(partialTeamSchema),
  decisions: z.array(formationTeamDecisionSchema),
  status: z.enum(['complete', 'incomplete']),
  attempts: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type FormationCompletionResult = z.infer<typeof formationCompletionResultSchema>;
