import { z } from 'zod';

export const heroStatsSchema = z.object({
  wl: z.number(),
  zl: z.number(),
  ts: z.number(),
  xg: z.number(),
});

export const heroSchema = z.object({
  skill: z.string().min(1),
  camp: z.string().min(1),
  troop: z.string().min(1),
  stats: heroStatsSchema,
  season: z.number().int().min(1),
  ranking: z.enum(['S', 'A', 'B', 'C', 'D']),
});

export const skillSchema = z.object({
  color: z.enum(['orange', 'purple']),
  type: z.enum(['主动', '指挥', '被动', '追击']),
  prob: z.number(),
  desc: z.string(),
  season: z.number().int().min(1),
  shadow: z.boolean().optional(),
  damageEstimate: z.number().optional(),
  healingEstimate: z.number().optional(),
  attributeEstimate: z.number().optional(),
  damageBoostEstimate: z.number().optional(),
  damageReductionEstimate: z.number().optional(),
  damageDealtReductionEstimate: z.number().optional(),
  damageTakenIncreaseEstimate: z.number().optional(),
  evasionEstimate: z.number().optional(),
  lifestealEstimate: z.number().optional(),
  critEstimate: z.number().optional(),
  critDamageEstimate: z.number().optional(),
});

export const bondSchema = z.object({
  content: z.string(),
  condition: z.string().optional(),
  members: z.array(z.string()),
});

export const teamCompSchema = z.object({
  id: z.string(),
  ranking: z.enum(['S', 'A', 'B']),
  sources: z.array(z.enum(['strong', 'championship'])),
  section: z.string(),
  formation: z.string(),
  members: z
    .array(
      z.object({
        hero: z.string(),
        skillSlots: z.tuple([
          z.array(z.string()),
          z.array(z.string()),
        ]),
      })
    )
    .length(3),
});

export const gameDatabaseSchema = z.object({
  heroes: z.record(z.string(), heroSchema),
  skills: z.record(z.string(), skillSchema),
  bonds: z.record(z.string(), bondSchema),
  formations: z.record(z.string(), z.string()),
  team: z.array(teamCompSchema),
});

export const recommendationDataSchema = z.object({
  catalog: z.object({
    default_skill: z.record(z.string(), z.string()),
  }),
  model: z.object({
    min_support_single: z.number(),
    min_support_pair: z.number(),
    weights: z.record(z.string(), z.number()),
    support: z.record(z.string(), z.number()),
  }),
});

export type GameDatabase = z.infer<typeof gameDatabaseSchema>;
export type RecommendationData = z.infer<typeof recommendationDataSchema>;

export const teamSlotSchema = z.object({
  hero: z.string().min(1).nullable(),
  row: z.enum(['前排', '后排']),
  skills: z.tuple([z.string().min(1).nullable(), z.string().min(1).nullable()]),
});

export const partialTeamSchema = z.object({
  formation: z.string(),
  heroes: z.array(teamSlotSchema).length(3),
});

export const heroCompletionInputSchema = z
  .object({
    teams: z.array(partialTeamSchema).min(1).max(3),
    availableHeroes: z.array(z.string().min(1)).min(1),
    season: z.number().int().min(1).optional(),
  })
  .superRefine((input, context) => {
    const assigned = input.teams.flatMap((team) =>
      team.heroes.flatMap((slot) => (slot.hero === null ? [] : [slot.hero]))
    );
    if (new Set(assigned).size !== assigned.length) {
      context.addIssue({
        code: 'custom',
        message: 'A hero cannot occupy more than one filled slot',
        path: ['teams'],
      });
    }
    if (new Set(input.availableHeroes).size !== input.availableHeroes.length) {
      context.addIssue({
        code: 'custom',
        message: 'availableHeroes cannot contain duplicates',
        path: ['availableHeroes'],
      });
    }
  });

export type HeroCompletionInput = z.infer<typeof heroCompletionInputSchema>;
export type PartialTeam = z.infer<typeof partialTeamSchema>;

export const blankPositionSchema = z.object({
  teamIndex: z.number().int().min(0),
  slotIndex: z.number().int().min(0).max(2),
});

export type BlankPosition = z.infer<typeof blankPositionSchema>;

export const candidateEvidenceSchema = z.object({
  hero: z.string(),
  camp: z.string(),
  troop: z.string(),
  stats: heroStatsSchema,
  signatureSkill: z.object({
    name: z.string(),
    type: z.string(),
    probability: z.number(),
    description: z.string(),
    estimates: z.record(z.string(), z.number()),
  }),
  campBonusBefore: z.number(),
  campBonusAfter: z.number(),
  activatedBonds: z.array(
    z.object({
      name: z.string(),
      effect: z.string(),
      condition: z.string(),
    })
  ),
  knownTeams: z.array(
    z.object({
      id: z.string(),
      ranking: z.enum(['S', 'A', 'B']),
      championship: z.boolean(),
      formation: z.string(),
      heroes: z.array(z.string()),
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
  retrievalScore: z.number(),
});

export type CandidateEvidence = z.infer<typeof candidateEvidenceSchema>;

export const blankContextSchema = z.object({
  position: blankPositionSchema,
  row: z.enum(['前排', '后排']),
  formation: z.string(),
  formationEffect: z.string().nullable(),
  currentHeroes: z.array(
    z.object({
      name: z.string(),
      camp: z.string(),
      troop: z.string(),
      stats: heroStatsSchema,
      signatureSkill: z.object({
        name: z.string(),
        description: z.string(),
      }),
    })
  ),
  candidates: z.array(candidateEvidenceSchema).min(1),
});

export type BlankContext = z.infer<typeof blankContextSchema>;

export const heroAssignmentSchema = z.object({
  teamIndex: z.number().int().min(0),
  slotIndex: z.number().int().min(0).max(2),
  hero: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.array(z.string().min(1)).max(5),
});

export type HeroAssignment = z.infer<typeof heroAssignmentSchema>;

export const modelDecisionSchema = z
  .object({
    assignments: z.array(heroAssignmentSchema),
  })
  .strict();

export const heroCompletionResultSchema = z.object({
  teams: z.array(partialTeamSchema),
  assignments: z.array(heroAssignmentSchema),
  usedFallback: z.boolean(),
  warnings: z.array(z.string()),
});

export type HeroCompletionResult = z.infer<typeof heroCompletionResultSchema>;
