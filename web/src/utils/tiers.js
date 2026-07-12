/**
 * Canonical ordering of skill/hero tiers, best first. Shared by every place
 * that sorts by tier (api.js, Analytics, KnownStrongTeams) so the ordering
 * cannot drift between them.
 */
export const TIER_ORDER = { OP: 0, T0: 1, 'T1+': 2, T1: 3, T2: 4, T3: 5, T4: 6 };

/**
 * Rank for a tier string; unknown/missing tiers sort last.
 */
export const tierRank = (tier) => TIER_ORDER[tier] ?? Number.MAX_SAFE_INTEGER;
