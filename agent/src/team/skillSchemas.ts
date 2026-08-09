import { z } from 'zod';
import { heroStatsSchema, partialTeamSchema } from './schemas.js';

export const skillCompletionInputSchema = z
  .object({
    teams: z.array(partialTeamSchema).min(1).max(3),
    availableSkills: z.array(z.string().min(1)),
    season: z.number().int().min(1).optional(),
  })
  .superRefine((input, context) => {
    const heroes: string[] = [];
    input.teams.forEach((team, teamIndex) => {
      if (team.formation === null) {
        context.addIssue({
          code: 'custom',
          message: 'Skill completion requires every team formation to be filled',
          path: ['teams', teamIndex, 'formation'],
        });
      }
      team.heroes.forEach((slot, slotIndex) => {
        if (slot.hero === null) {
          context.addIssue({
            code: 'custom',
            message: 'Skill completion requires every hero position to be filled',
            path: ['teams', teamIndex, 'heroes', slotIndex, 'hero'],
          });
        } else {
          heroes.push(slot.hero);
        }
        if (slot.row === null) {
          context.addIssue({
            code: 'custom',
            message: 'Skill completion requires every hero row to be filled',
            path: ['teams', teamIndex, 'heroes', slotIndex, 'row'],
          });
        }
      });
    });
    if (new Set(heroes).size !== heroes.length) {
      context.addIssue({
        code: 'custom',
        message: 'A hero cannot occupy more than one team position',
        path: ['teams'],
      });
    }
    if (new Set(input.availableSkills).size !== input.availableSkills.length) {
      context.addIssue({
        code: 'custom',
        message: 'availableSkills cannot contain duplicates',
        path: ['availableSkills'],
      });
    }
  });

export type SkillCompletionInput = z.infer<typeof skillCompletionInputSchema>;

const learnedFeatureSchema = z.object({
  id: z.string(),
  weight: z.number(),
  support: z.number(),
});

export const skillCatalogEntrySchema = z.object({
  name: z.string(),
  type: z.string(),
  probability: z.number(),
  description: z.string(),
  estimates: z.record(z.string(), z.number()),
  generalEvidence: learnedFeatureSchema.nullable(),
});

export const skillHeroContextSchema = z.object({
  teamIndex: z.number().int().min(0).max(2),
  slotIndex: z.number().int().min(0).max(2),
  hero: z.string(),
  row: z.enum(['前排', '后排']),
  formation: z.string(),
  formationEffect: z.string(),
  stats: heroStatsSchema,
  signatureSkill: z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
  }),
  currentExtraSkills: z.array(z.string()),
  emptySkillSlots: z.array(z.number().int().min(0).max(1)).min(1),
  teammates: z.array(
    z.object({
      name: z.string(),
      row: z.enum(['前排', '后排']),
      signatureSkill: z.object({
        name: z.string(),
        description: z.string(),
      }),
    })
  ).length(2),
  activeBonds: z.array(
    z.object({
      name: z.string(),
      effect: z.string(),
    })
  ),
  candidateEvidence: z.array(
    z.object({
      skill: z.string(),
      contribution: z.number(),
      minimumSupport: z.number(),
      features: z.array(learnedFeatureSchema),
    })
  ),
  pairEvidence: z.array(
    z.object({
      first: z.string(),
      second: z.string(),
      weight: z.number(),
      support: z.number(),
    })
  ),
});

export const skillCompletionContextSchema = z.object({
  availableSkills: z.array(skillCatalogEntrySchema).min(1),
  heroes: z.array(skillHeroContextSchema).min(1),
});

export type SkillCompletionContext = z.infer<typeof skillCompletionContextSchema>;

export const skillAssignmentSchema = z.object({
  teamIndex: z.number().int().min(0).max(2),
  slotIndex: z.number().int().min(0).max(2),
  skillSlotIndex: z.number().int().min(0).max(1),
  skill: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.array(z.string().min(1)).max(5),
});

export type SkillAssignment = z.infer<typeof skillAssignmentSchema>;

export const skillModelDecisionSchema = z
  .object({
    assignments: z.array(skillAssignmentSchema),
  })
  .strict();

export const skillCompletionResultSchema = z.object({
  teams: z.array(partialTeamSchema),
  assignments: z.array(skillAssignmentSchema),
  status: z.enum(['complete', 'incomplete']),
  attempts: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type SkillCompletionResult = z.infer<typeof skillCompletionResultSchema>;
