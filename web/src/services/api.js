import {
  recommendHeroSet,
  recommendSkillSet,
  getAnalytics,
} from './recommendationEngine';

// Lazy-loaded data
let databaseData = null;
let battleStatsData = null;

/**
 * Load database.json from public folder
 */
async function loadDatabase() {
  if (databaseData) return databaseData;
  const response = await fetch('/database.json');
  databaseData = await response.json();
  return databaseData;
}

/**
 * Load battle_stats.json from public folder
 */
async function loadBattleStats() {
  if (battleStatsData) return battleStatsData;
  const response = await fetch('/battle_stats.json');
  battleStatsData = await response.json();
  return battleStatsData;
}

export const api = {
  /**
   * Get all available heroes and skills from database
   * @returns {Promise<{heroes: string[], skills: string[]}>}
   */
  getDatabaseItems: async () => {
    const database = await loadDatabase();
    // Get all heroes from skill_hero_map
    const allHeroes = [...new Set(Object.values(database.skill_hero_map))];
    allHeroes.sort();
    
    // Combine skill and skill_hero_map keys to get all skills
    const allSkills = [...new Set([
      ...(database.skill || []),
      ...Object.keys(database.skill_hero_map || {})
    ])];
    allSkills.sort();
    
    return {
      heroes: allHeroes,
      skills: allSkills,
    };
  },
  
  /**
   * Get AI recommendation for current round
   * @param {string} roundType - 'hero' or 'skill'
   * @param {Array<Array<string>>} availableSets - 3 sets of options
   * @param {Object} gameState - Current game state
   * @returns {Promise<Object>} Recommendation with analysis
   */
  getRecommendation: async (roundType, availableSets, gameState) => {
    const battleStats = await loadBattleStats();
    const currentHeroes = gameState.current_heroes || [];
    const currentSkills = gameState.current_skills || [];
    
    let recommendation;
    if (roundType === 'hero') {
      recommendation = recommendHeroSet(
        availableSets,
        currentHeroes,
        battleStats,
        {
          minWilson: 0.50,
          minGames: 2,
          includeIntraSet: true,
          weightCurrentPair: 20.0,
          weightIntraPair: 15.0,
          weightFullCombo: 30.0,
          normalize: true,
          unknownPairPenalty: 2.0,
          lowCountPenalty: 0.5,
        }
      );
    } else {
      recommendation = recommendSkillSet(
        availableSets,
        currentHeroes,
        currentSkills,
        battleStats,
        {
          minWilson: 0.50,
          minGames: 2,
          includeIntraSet: true,
          weightCurrentSkillPair: 15.0,
          weightIntraSkillPair: 12.0,
          weightSkillHeroPair: 8.0,
          normalize: true,
          unknownPairPenalty: 1.5,
          lowCountPenalty: 0.4,
        }
      );
    }
    
    // Format to match backend response structure
    const formattedRec = {
      recommended_set_index: recommendation.recommended_set,
      recommended_set: availableSets[recommendation.recommended_set],
      reasoning: recommendation.reasoning,
      analysis: recommendation.analysis.map((analysis, i) => {
        const formatted = {
          set_index: analysis.set_index,
          items: roundType === 'hero' ? analysis.heroes : analysis.skills,
          total_score: Math.round(analysis.total_score * 10) / 10,
          rank: i + 1,
          individual_scores: Object.fromEntries(
            Object.entries(analysis.individual_scores).map(([k, v]) => [k, Math.round(v * 10) / 10])
          ),
        };
        
        if (roundType === 'hero') {
          formatted.synergy_bonus = Math.round(analysis.synergy_total * 10) / 10;
        } else {
          formatted.hero_synergy = Math.round(analysis.skill_hero_synergy * 10) / 10;
          formatted.skill_synergy = Math.round(
            (analysis.skill_skill_synergy_current + analysis.skill_skill_synergy_intra) * 10
          ) / 10;
        }
        
        return formatted;
      }),
    };
    
    return {
      success: true,
      recommendation: formattedRec,
      round_info: {
        round_number: gameState.round_number || 1,
        round_type: roundType,
        current_heroes: currentHeroes,
        current_skills: currentSkills,
      },
    };
  },
  
  /**
   * Get analytics data for dashboard
   * @returns {Promise<Object>} Analytics data
   */
  getAnalytics: async () => {
    const battleStats = await loadBattleStats();
    const database = await loadDatabase();
    return getAnalytics(battleStats, database);
  },
};
