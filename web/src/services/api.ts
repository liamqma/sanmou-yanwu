import { database } from '../data';
import type { DatabaseItems, RoundType, GameState, Recommendation } from '../types/game';
import { heroRankingRank, skillRankingRank } from '../utils/rankings';
import { runLineup } from './lineupClient';

const compareChineseNames = (a: string, b: string): number =>
  a.localeCompare(b, 'zh-Hans-CN');

/** Nothing in this module is HTTP: the catalog is bundled and the lineup model runs in a worker. */
export const api = {
  /**
   * Get all available heroes and skills from the merged database.
   *
   * Schema reminder:
   *  - database.heroes: orange heroes only (filtered at merge time, no `color` field).
   *    Each hero has a `skill` field naming its signature (hero-exclusive) skill.
   *  - database.skills: ALL skill colors present (orange + purple). Entries are
   *    `{ color, desc, shadow? }`. Hero-skill draft rules apply when a skill is
   *    either referenced by `heroes[*].skill` or explicitly marked `shadow`.
   */
  getDatabaseItems: async (): Promise<DatabaseItems> => {
    const heroEntries = Object.entries(database.heroes || {});
    const allSkillEntries = Object.entries(database.skills || {});
    const compareHeroes = (
      [nameA, heroA]: (typeof heroEntries)[number],
      [nameB, heroB]: (typeof heroEntries)[number]
    ) => {
      const rankingA = heroRankingRank(heroA.ranking);
      const rankingB = heroRankingRank(heroB.ranking);
      return rankingA !== rankingB
        ? rankingA - rankingB
        : compareChineseNames(nameA, nameB);
    };
    const compareSkills = (
      [nameA, skillA]: (typeof allSkillEntries)[number],
      [nameB, skillB]: (typeof allSkillEntries)[number]
    ) => {
      const rankingA = skillRankingRank(skillA.ranking);
      const rankingB = skillRankingRank(skillB.ranking);
      return rankingA !== rankingB
        ? rankingA - rankingB
        : compareChineseNames(nameA, nameB);
    };
    const sortedHeroEntries = [...heroEntries].sort(compareHeroes);
    const heroes = sortedHeroEntries.map(([n]) => n);
    const heroMetadata = Object.fromEntries(
      heroEntries.map(([name, hero]) => [name, {
        ranking: hero.ranking,
        season: hero.season,
      }])
    );

    // Hero skills include catalog signatures plus explicitly marked 影 skills.
    const heroSkillSet = new Set([
      ...heroEntries.map(([, h]) => h.skill).filter(Boolean),
      ...allSkillEntries
        .filter(([, skill]) => skill.shadow === true)
        .map(([name]) => name),
    ]);
    const heroSkills = [...heroSkillSet].sort(compareChineseNames);

    const skillMetadata = Object.fromEntries(
      allSkillEntries.map(([name, skill]) => [name, {
        ranking: skill.ranking,
        category: skill.category,
        season: skill.season,
      }])
    );
    const regularSkills = allSkillEntries
      .filter(([name]) => !heroSkillSet.has(name))
      .sort(compareSkills)
      .map(([name]) => name);
    const orangeRegularSkills = allSkillEntries
      .filter(([name, s]) => !heroSkillSet.has(name) && s.color === 'orange')
      .sort(compareSkills)
      .map(([name]) => name);
    const skillByName = new Map(allSkillEntries);
    const allSkills = [...new Set([...regularSkills, ...heroSkills])].sort((nameA, nameB) => {
      const skillA = skillByName.get(nameA);
      const skillB = skillByName.get(nameB);
      const rankingA = skillRankingRank(skillA?.ranking);
      const rankingB = skillRankingRank(skillB?.ranking);
      return rankingA !== rankingB
        ? rankingA - rankingB
        : compareChineseNames(nameA, nameB);
    });
    const maxSeason = [...heroEntries, ...allSkillEntries].reduce(
      (latest, [, item]) =>
        Number.isInteger(item.season) && item.season >= 1
          ? Math.max(latest, item.season)
          : latest,
      1
    );

    return {
      heroes,
      heroMetadata,
      skillMetadata,
      skills: allSkills,
      regularSkills,
      orangeRegularSkills,
      heroSkills,
      maxSeason,
    };
  },

  /**
   * Recommend one of the three offered sets: the one whose cards give the pool
   * its best three-team lineup under the lineup model.
   */
  getRecommendation: async (
    roundType: RoundType,
    availableSets: string[][],
    gameState: GameState,
    onProgress?: (progress: number) => void
  ): Promise<Recommendation> => {
    const result = await runLineup(
      'pick',
      {
        heroes: [
          ...(gameState.current_heroes || []),
          ...(gameState.support_hero ? [gameState.support_hero] : []),
        ],
        skills: [...(gameState.current_skills || []), ...(gameState.support_skills || [])],
        options: availableSets,
        kind: roundType,
      },
      onProgress
    );
    const best = result.options[result.recommended].score;
    return {
      recommended_set_index: result.recommended,
      recommended_set: availableSets[result.recommended] || [],
      analysis: result.options.map(({ score, teams }, index) => ({
        set_index: index,
        score,
        gap: score - best,
        teams,
      })),
      model_version: result.version,
      unknown: result.unknown,
      round_info: { round_number: gameState.round_number || 1, round_type: roundType },
    };
  },
};
