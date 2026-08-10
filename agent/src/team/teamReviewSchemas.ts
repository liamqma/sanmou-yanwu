import { z } from 'zod';
import { heroStatsSchema, partialTeamSchema } from './schemas.js';

export const teamReviewInputSchema = z
  .object({
    teams: z.array(partialTeamSchema).min(1).max(3),
  })
  .superRefine((input, context) => {
    input.teams.forEach((team, teamIndex) => {
      if (team.formation === null) {
        context.addIssue({
          code: 'custom',
          message: 'Team review requires every formation to be filled',
          path: ['teams', teamIndex, 'formation'],
        });
      }
      team.heroes.forEach((slot, slotIndex) => {
        if (slot.hero === null) {
          context.addIssue({
            code: 'custom',
            message: 'Team review requires every hero slot to be filled',
            path: ['teams', teamIndex, 'heroes', slotIndex, 'hero'],
          });
        }
        if (slot.row === null) {
          context.addIssue({
            code: 'custom',
            message: 'Team review requires every row to be filled',
            path: ['teams', teamIndex, 'heroes', slotIndex, 'row'],
          });
        }
        slot.skills.forEach((skill, skillSlotIndex) => {
          if (skill === null) {
            context.addIssue({
              code: 'custom',
              message: 'Team review requires every extra-skill slot to be filled',
              path: ['teams', teamIndex, 'heroes', slotIndex, 'skills', skillSlotIndex],
            });
          }
        });
      });
    });
  });

export type TeamReviewInput = z.infer<typeof teamReviewInputSchema>;

const learnedFeatureSchema = z.object({
  id: z.string(),
  weight: z.number(),
  support: z.number(),
});

export const REVIEW_EVIDENCE_SOURCES = [
  'hero',
  'skill',
  'formation',
  'bond',
  'knownTeam',
  'learnedFeature',
  'campBonus',
] as const;

export const REVIEW_CATEGORIES = [
  'camp',
  'bond',
  'formation',
  'position',
  'damage_type',
  'skill_synergy',
  'sustain',
  'control',
  'team_balance',
  'learned_evidence',
  'resource_rule',
] as const;

export const REVIEW_OUTPUT_LIMITS = {
  targetStrengthsPerTeam: 4,
  targetWarningsPerTeam: 3,
  targetEvidencePerItem: 3,
  targetCrossTeamWarnings: 3,
  maxStrengthsPerTeam: 6,
  maxWarningsPerTeam: 6,
  maxEvidencePerItem: 5,
  maxCrossTeamWarnings: 6,
} as const;

export const reviewEvidenceRefSchema = z.object({
  source: z.enum(REVIEW_EVIDENCE_SOURCES),
  id: z.string().min(1),
});

export const reviewCategorySchema = z.enum(REVIEW_CATEGORIES);

export const reviewStrengthSchema = z.object({
  category: reviewCategorySchema,
  message: z.string().min(1),
  evidence: z
    .array(reviewEvidenceRefSchema)
    .min(1)
    .max(REVIEW_OUTPUT_LIMITS.maxEvidencePerItem),
});

export const reviewWarningSchema = z.object({
  severity: z.enum(['warning', 'critical']),
  category: reviewCategorySchema,
  message: z.string().min(1),
  suggestedAction: z.string().min(1),
  evidence: z
    .array(reviewEvidenceRefSchema)
    .min(1)
    .max(REVIEW_OUTPUT_LIMITS.maxEvidencePerItem),
});

export const crossTeamReviewWarningSchema = reviewWarningSchema.extend({
  teamIndexes: z.array(z.number().int().min(0).max(2)).min(1).max(3),
});

export const reviewHeroCatalogEntrySchema = z.object({
  camp: z.string(),
  troop: z.string(),
  stats: heroStatsSchema,
  signatureSkill: z.string(),
  generalEvidence: learnedFeatureSchema.nullable(),
});

export const reviewSkillCatalogEntrySchema = z.object({
  type: z.string(),
  probability: z.number(),
  description: z.string(),
  estimates: z.record(z.string(), z.number()),
  generalEvidence: learnedFeatureSchema.nullable(),
});

export const teamReviewContextSchema = z.object({
  heroCatalog: z.record(z.string(), reviewHeroCatalogEntrySchema),
  skillCatalog: z.record(z.string(), reviewSkillCatalogEntrySchema),
  teams: z.array(
    z.object({
      teamIndex: z.number().int().min(0).max(2),
      formation: z.object({
        name: z.string(),
        effect: z.string(),
      }),
      campBonus: z.object({
        id: z.string(),
        bonus: z.number(),
        camps: z.array(z.string()).length(3),
      }),
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
          matchCount: z.number().int().min(2).max(3),
          members: z.array(
            z.object({
              hero: z.string(),
              skillSlots: z.tuple([z.array(z.string()), z.array(z.string())]),
            })
          ).length(3),
        })
      ),
      heroes: z.array(
        z.object({
          slotIndex: z.number().int().min(0).max(2),
          hero: z.string(),
          row: z.enum(['前排', '后排']),
          extraSkills: z.tuple([z.string(), z.string()]),
          skillEvidence: z.array(learnedFeatureSchema),
        })
      ).length(3),
      pairEvidence: z.array(learnedFeatureSchema),
    })
  ).min(1).max(3),
  deterministicRuleWarnings: z.array(crossTeamReviewWarningSchema),
});

export type TeamReviewContext = z.infer<typeof teamReviewContextSchema>;

export const teamReviewModelDecisionSchema = z
  .object({
    teams: z.array(
      z.object({
        teamIndex: z.number().int().min(0).max(2),
        strengths: z
          .array(reviewStrengthSchema)
          .max(REVIEW_OUTPUT_LIMITS.maxStrengthsPerTeam),
        warnings: z
          .array(reviewWarningSchema)
          .max(REVIEW_OUTPUT_LIMITS.maxWarningsPerTeam),
      })
    ),
    crossTeamWarnings: z
      .array(crossTeamReviewWarningSchema)
      .max(REVIEW_OUTPUT_LIMITS.maxCrossTeamWarnings),
  })
  .strict();

export type TeamReviewModelDecision = z.infer<typeof teamReviewModelDecisionSchema>;

export const reviewVerdictSchema = z.enum(['sound', 'workable', 'needs_changes']);

export const teamReviewResultSchema = z.object({
  status: z.enum(['complete', 'unavailable']),
  verdict: reviewVerdictSchema.nullable(),
  teams: z.array(
    z.object({
      teamIndex: z.number().int().min(0).max(2),
      verdict: reviewVerdictSchema,
      strengths: z.array(reviewStrengthSchema),
      warnings: z.array(reviewWarningSchema),
    })
  ),
  crossTeamWarnings: z.array(crossTeamReviewWarningSchema),
  deterministicRuleWarnings: z.array(crossTeamReviewWarningSchema),
  attempts: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type TeamReviewResult = z.infer<typeof teamReviewResultSchema>;
