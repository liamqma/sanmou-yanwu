/**
 * Canonical ordering of skill/hero tiers, best first. Shared by every place
 * that sorts by tier (api.ts, Analytics, KnownStrongTeams) so the ordering
 * cannot drift between them.
 */
export const TIER_ORDER: Record<string, number> = {
  OP: 0,
  T0: 1,
  'T1+': 2,
  T1: 3,
  T2: 4,
  T3: 5,
  T4: 6,
};

/**
 * Rank for a tier string; unknown/missing tiers sort last.
 */
export const tierRank = (tier: string | undefined | null): number =>
  (tier != null ? TIER_ORDER[tier] : undefined) ?? Number.MAX_SAFE_INTEGER;
