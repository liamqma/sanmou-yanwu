/**
 * Canonical builders for the composite keys used in battle_stats.json.
 *
 * These MUST match how data/export_battle_stats.py serializes each dict, so the
 * whole app looks pairs/combos up the same way instead of each call site
 * re-deriving (and sometimes guessing) the key order:
 *
 *   hero_pair_stats        key = ','.join(sorted((h1, h2)))     -> sorted
 *   skill_pair_stats       key = ','.join(sorted((s1, s2)))     -> sorted
 *   hero_combinations      key = ','.join(sorted(heroes))       -> sorted
 *   skill_hero_pair_stats  key = f"{hero},{skill}"              -> fixed (hero first)
 *
 * JS String#sort compares by UTF-16 code unit, which equals Python's
 * code-point ordering for BMP characters (all CJK hero/skill names are BMP),
 * so [a, b].sort() here produces the same key Python's sorted() wrote.
 */

/** Sorted key for an unordered pair of heroes. */
export const heroPairKey = (a: string, b: string): string => [a, b].sort().join(',');

/** Sorted key for an unordered pair of skills. */
export const skillPairKey = (a: string, b: string): string => [a, b].sort().join(',');

/** Fixed hero-first key for a (hero, skill) association. */
export const skillHeroPairKey = (hero: string, skill: string): string => `${hero},${skill}`;

/** Sorted key for a hero combination (any size). */
export const heroComboKey = (heroes: readonly string[]): string =>
  [...heroes].sort().join(',');
