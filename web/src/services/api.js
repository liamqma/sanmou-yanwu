import {
  recommendHeroSet,
  recommendSkillSet,
  getAnalytics,
} from './recommendationEngine';
import databaseData from '../database.json';
import battleStatsData from '../battle_stats.json';

export const api = {
  /**
   * Get all available heroes and skills from database
   * @returns {Promise<{heroes: string[], skills: string[]}>}
   */
  getDatabaseItems: async () => {
    const database = databaseData;
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
    const battleStats = battleStatsData;
    const currentHeroes = gameState.current_heroes || [];
    const currentSkills = gameState.current_skills || [];
    
    let recommendation;
    if (roundType === 'hero') {
      recommendation = recommendHeroSet(
        availableSets,
        currentHeroes,
        battleStats,
        currentSkills,
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
      analysis: recommendation.analysis.map((analysis, i) => {
        const formatted = {
          set_index: analysis.set_index,
          items: roundType === 'hero' ? analysis.heroes : analysis.skills,
          final_score: Math.round(analysis.final_score * 10) / 10,
          rank: i + 1,
        };
        
        if (roundType === 'hero') {
          formatted.individual_scores = Math.round(analysis.individual_scores.score * 10) / 10;
          formatted.score_full_team_combination = Math.round(analysis.score_full_team_combination.score * 10) / 10;
          formatted.score_pair_stats = Math.round(analysis.score_pair_stats.score * 10) / 10;
          formatted.score_skill_hero_pairs = Math.round(analysis.score_skill_hero_pairs.score * 10) / 10;
          // Include hero details for individual scores
          if (analysis.individual_scores.details?.hero_details) {
            formatted.hero_details = analysis.individual_scores.details.hero_details.map(hero => ({
              hero: hero.hero,
              score: Math.round(hero.score * 10) / 10,
              wins: hero.wins,
              losses: hero.losses,
              total: hero.total,
              rawWinRate: Math.round(hero.rawWinRate * 10) / 10,
              adjustedWinRate: Math.round(hero.adjustedWinRate * 10) / 10,
            }));
          }
          // Include top 3 full team combinations
          if (analysis.score_full_team_combination.details?.length > 0) {
            const sortedCombos = [...analysis.score_full_team_combination.details]
              .sort((a, b) => b.score - a.score)
              .slice(0, 3);
            formatted.top_combinations = sortedCombos.map(combo => ({
              heroes: combo.heroes,
              score: Math.round(combo.score * 10) / 10,
              wins: combo.wins,
              losses: combo.losses,
              total: combo.total,
              rawWinRate: Math.round(combo.rawWinRate * 10) / 10,
              adjustedWinRate: Math.round(combo.adjustedWinRate * 10) / 10,
            }));
          }
          // Include top 5 hero pairs
          if (analysis.score_pair_stats.details?.length > 0) {
            const sortedPairs = [...analysis.score_pair_stats.details]
              .sort((a, b) => b.score - a.score)
              .slice(0, 5);
            formatted.top_pairs = sortedPairs.map(pair => ({
              hero1: pair.hero1,
              hero2: pair.hero2,
              score: Math.round(pair.score * 10) / 10,
              wins: pair.wins,
              total: pair.total,
              adjustedWinRate: Math.round(pair.adjustedWinRate * 10) / 10,
            }));
          }
          // Include top 5 skill-hero pairs
          if (analysis.score_skill_hero_pairs.details?.length > 0) {
            const sortedSkillHeroPairs = [...analysis.score_skill_hero_pairs.details]
              .sort((a, b) => b.score - a.score)
              .slice(0, 5);
            formatted.top_skill_hero_pairs = sortedSkillHeroPairs.map(pair => ({
              hero: pair.hero,
              skill: pair.skill,
              score: Math.round(pair.score * 10) / 10,
              wins: pair.wins,
              total: pair.total,
              adjustedWinRate: Math.round(pair.adjustedWinRate * 10) / 10,
            }));
          }
        } else {
          formatted.individual_scores = Math.round(analysis.individual_scores.score * 10) / 10;
          formatted.score_skill_hero_pairs = Math.round(analysis.score_skill_hero_pairs.score * 10) / 10;
          // Include skill details for individual scores
          if (analysis.individual_scores.details?.skill_details) {
            formatted.skill_details = analysis.individual_scores.details.skill_details.map(skill => ({
              skill: skill.skill,
              score: Math.round(skill.score * 10) / 10,
              wins: skill.wins,
              losses: skill.losses,
              total: skill.total,
              rawWinRate: Math.round(skill.rawWinRate * 10) / 10,
              adjustedWinRate: Math.round(skill.adjustedWinRate * 10) / 10,
            }));
          }
          // Include top 5 skill-hero pairs for skill rounds
          if (analysis.score_skill_hero_pairs.details?.length > 0) {
            const sortedSkillHeroPairs = [...analysis.score_skill_hero_pairs.details]
              .sort((a, b) => b.score - a.score)
              .slice(0, 5);
            formatted.top_skill_hero_pairs = sortedSkillHeroPairs.map(pair => ({
              hero: pair.hero,
              skill: pair.skill,
              score: Math.round(pair.score * 10) / 10,
              wins: pair.wins,
              total: pair.total,
              adjustedWinRate: Math.round(pair.adjustedWinRate * 10) / 10,
            }));
          }
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
    return getAnalytics(battleStatsData, databaseData);
  },
};
