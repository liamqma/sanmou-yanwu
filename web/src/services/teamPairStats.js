/**
 * Pure helpers for turning the exported pair statistics into per-hero
 * "best partner" / "best skill" rankings for the Team Builder page.
 *
 * Kept free of React / router / MUI imports so they can be unit-tested in
 * isolation (importing the TeamBuilder component pulls in react-router-dom,
 * which the CRA jest environment cannot resolve).
 */

/**
 * Index hero_pair_stats by hero once, so per-hero lookups are O(1) instead of
 * a full scan of every pair. Maps hero -> [{ partner, stats }].
 */
export function buildHeroPairIndex(heroPairStats) {
  const index = new Map();
  const add = (hero, partner, stats) => {
    if (!index.has(hero)) index.set(hero, []);
    index.get(hero).push({ partner, stats });
  };
  for (const [pairKey, stats] of Object.entries(heroPairStats)) {
    const [hero1, hero2] = pairKey.split(',');
    add(hero1, hero2, stats);
    add(hero2, hero1, stats);
  }
  return index;
}

/**
 * Index skill_hero_pair_stats by hero once. Maps hero -> [{ skill, stats }].
 */
export function buildSkillHeroIndex(skillHeroPairStats) {
  const index = new Map();
  for (const [pairKey, stats] of Object.entries(skillHeroPairStats)) {
    const [heroName, skill] = pairKey.split(',');
    if (!index.has(heroName)) index.set(heroName, []);
    index.get(heroName).push({ skill, stats });
  }
  return index;
}

/**
 * Find best hero pairs for a hero, from its pre-indexed partner entries.
 */
export function findBestHeroPair(entries, availableHeroes) {
  if (!entries) return null;
  const availableSet = new Set(availableHeroes);
  const pairs = [];

  for (const { partner, stats } of entries) {
    if (!availableSet.has(partner)) continue;
    const totalGames = stats.wins + stats.losses;
    if (totalGames >= 1) {
      const winRate = stats.wins / totalGames;
      const wilson = stats.wilson ?? 0;
      pairs.push({
        partner,
        wins: stats.wins,
        losses: stats.losses,
        total: totalGames,
        winRate: winRate * 100,
        wilson: wilson * 100,
      });
    }
  }

  if (pairs.length === 0) return null;

  // Sort by win rate, then by total games
  pairs.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.total - a.total;
  });

  return pairs;
}

/**
 * Find best skill pairs for a hero, from its pre-indexed skill entries.
 */
export function findBestSkillPair(entries, availableSkills) {
  if (!entries) return null;
  const availableSet = new Set(availableSkills);
  const skills = [];

  for (const { skill, stats } of entries) {
    if (!availableSet.has(skill)) continue;
    const totalGames = stats.wins + stats.losses;
    if (totalGames >= 1) {
      const winRate = stats.wins / totalGames;
      const wilson = stats.wilson ?? 0;
      skills.push({
        skill,
        wins: stats.wins,
        losses: stats.losses,
        total: totalGames,
        winRate: winRate * 100,
        wilson: wilson * 100,
      });
    }
  }

  if (skills.length === 0) return null;

  // Sort by win rate, then by total games
  skills.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.total - a.total;
  });

  return skills;
}
