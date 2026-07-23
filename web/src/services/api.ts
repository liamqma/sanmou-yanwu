import {
  recommendHeroSet,
  recommendSkillSet,
  getAnalytics,
  type OptionAnalysis,
} from './recommendationEngine';
import { database, recommendationData } from '../data';
import { tierRank } from '../utils/tiers';
import type { DatabaseItems, RoundType, GameState } from '../types/game';
import type { PreferencePrediction } from '../types/telemetryData';
import { getCachedTelemetryData, preloadTelemetryData } from './telemetryData';
import { predictPlayerPreference } from './preferenceModel';

/**
 * In-memory recommendation shim (nothing in this module is HTTP). All scoring
 * logic runs locally against the generated
 * `recommendation_data.json` artifact via `recommendationEngine`.
 */
export const api = {
  /**
   * Get all available heroes and skills from the merged database.
   *
   * Schema reminder:
   *  - database.heroes: orange heroes only (filtered at merge time, no `color` field).
   *    Each hero has a `skill` field naming its signature (hero-exclusive) skill.
   *  - database.skills: ALL skill colors present (orange + purple). Entries are
   *    `{ color, desc }`. A skill is hero-exclusive iff it appears as some
   *    `heroes[*].skill` — no field on the skill itself indicates this.
   */
  getDatabaseItems: async (): Promise<DatabaseItems> => {
    const heroEntries = Object.entries(database.heroes || {});
    const compareHeroes = ([nameA, heroA]: [string, any], [nameB, heroB]: [string, any]) => {
      const labelA = heroA.label || '未分类';
      const labelB = heroB.label || '未分类';
      if (labelA !== labelB) return labelA.localeCompare(labelB, 'zh-Hans-CN');

      const rankA = typeof heroA.rank === 'number' ? heroA.rank : Number.MAX_SAFE_INTEGER;
      const rankB = typeof heroB.rank === 'number' ? heroB.rank : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;

      return nameA.localeCompare(nameB, 'zh-Hans-CN');
    };
    const sortedHeroEntries = [...heroEntries].sort(compareHeroes);
    const heroes = sortedHeroEntries.map(([n]) => n);
    const heroMetadata = Object.fromEntries(
      heroEntries.map(([name, hero]) => [name, {
        label: hero.label,
        rank: hero.rank,
      }])
    );

    // Hero-exclusive skills = the set of signature skills referenced by heroes.
    const heroSkillSet = new Set(
      heroEntries.map(([, h]) => h.skill).filter(Boolean)
    );
    const heroSkills = [...heroSkillSet].sort();

    const allSkillEntries = Object.entries(database.skills || {});
    const compareSkills = ([nameA, skillA]: [string, any], [nameB, skillB]: [string, any]) => {
      const tierA = tierRank(skillA.tier);
      const tierB = tierRank(skillB.tier);
      if (tierA !== tierB) return tierA - tierB;
      return nameA.localeCompare(nameB, 'zh-Hans-CN');
    };
    const skillMetadata = Object.fromEntries(
      allSkillEntries.map(([name, skill]) => [name, {
        tier: skill.tier,
        note: skill.note,
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
    const allSkills = [...new Set([...regularSkills, ...heroSkills])].sort((a, b) => compareSkills([a, database.skills?.[a] || {}], [b, database.skills?.[b] || {}]));

    return {
      heroes,
      heroMetadata,
      skillMetadata,
      skills: allSkills,
      regularSkills,
      orangeRegularSkills,
      heroSkills,
    };
  },

  /**
   * Recommend one of the three offered option sets for the current round.
   *
   * The score of each option is the *marginal relative roster-strength gain* it
   * adds to the current pool under the learned paired model — there is no
   * opponent input, so this is not an opponent-specific win probability.
   */
  getRecommendation: async (
    roundType: RoundType,
    availableSets: string[][],
    gameState: GameState
  ): Promise<{
    success: boolean;
    recommendation: {
      recommended_set_index: number;
      recommended_set: string[];
      analysis: OptionAnalysis[];
      preference: PreferencePrediction | null;
    };
    round_info: {
      round_number: number;
      round_type: RoundType;
      current_heroes: string[];
      current_skills: string[];
    };
  }> => {
    const currentHeroes = [
      ...(gameState.current_heroes || []),
      ...(gameState.support_hero ? [gameState.support_hero] : []),
    ];
    const currentSkills = [
      ...(gameState.current_skills || []),
      ...(gameState.support_skills || []),
    ];

    const rec =
      roundType === 'hero'
        ? recommendHeroSet(availableSets, currentHeroes, recommendationData, currentSkills)
        : recommendSkillSet(availableSets, currentHeroes, currentSkills, recommendationData);
    const pairedScores = [0, 1, 2].map(
      (index) =>
        rec.analysis.find((option) => option.set_index === index)?.final_score ??
        0
    );
    const telemetryData = getCachedTelemetryData();
    if (!telemetryData) preloadTelemetryData();
    const preference = telemetryData
      ? predictPlayerPreference(telemetryData, {
          roundNumber: gameState.round_number || 1,
          roundType,
          poolBefore: {
            heroes: [...(gameState.current_heroes || [])],
            skills: [...(gameState.current_skills || [])],
            ...(gameState.support_hero
              ? { heroSupport: gameState.support_hero }
              : {}),
            ...(gameState.support_skills?.length
              ? { skillsSupport: [...gameState.support_skills] }
              : {}),
          },
          offeredSets: availableSets,
          pairedScores,
        })
      : null;

    return {
      success: true,
      recommendation: {
        recommended_set_index: rec.recommended_set,
        recommended_set: availableSets[rec.recommended_set] || [],
        analysis: rec.analysis,
        preference,
      },
      round_info: {
        round_number: gameState.round_number || 1,
        round_type: roundType,
        current_heroes: currentHeroes,
        current_skills: currentSkills,
      },
    };
  },

  /** Analytics-page payload derived from the generated artifact. */
  getAnalytics: async () => getAnalytics(recommendationData, database),
};
