/**
 * Client-side recommendation engine
 * Ported from Python ai_recommendation_system.py
 * Mini program version with async battle stats loading
 */

import { getBattleStats } from './dataStore';

/** Options for hero set recommendation (weights shown in UI) */
export const HERO_RECOMMEND_OPTIONS = {
  minGames: 2,
  weightSetCombination: 0.5,       // 本组武将平均个人评分
  weightFullTeamCombination: 0.3,  // 与已选武将组成队伍的评分
  weightPairStats: 0.1,            // 与已选武将配对的评分
  weightSkillHeroPairs: 0.1,       // 与已选战法的组合评分
};

/** Options for skill set recommendation (weights shown in UI) */
export const SKILL_RECOMMEND_OPTIONS = {
  minGames: 2,
  weightIndividualSkills: 0.7,     // 本组战法平均个人评分
  weightSkillHeroPairs: 0.3,       // 与已选武将/战法的组合评分
};

/**
 * Get a context-aware individual hero score that accounts for synergy dependencies.
 *
 * Uses precomputed hero_synergy_stats from battle_stats.json (built at export time)
 * so this function is pure lookups — no expensive scanning or wilson computation.
 *
 * Each hero may have up to 2 synergy partners (top-2 by boost). The function checks:
 *   Case 1 – Any synergy partner IS on the team → boost using the best matching one
 *   Case 2 – No synergy partner on team & combined game share is high → deflate score
 *   Case 3 – No significant synergy dependency → use raw wilson unchanged
 *
 * @param {string}   hero             – candidate hero to score
 * @param {string[]} currentTeam      – heroes already on the team
 * @param {Object}   heroStats        – battle_stats.hero_stats
 * @param {Object}   heroSynergyStats – battle_stats.hero_synergy_stats (precomputed)
 * @returns {{ score: number, adjusted: boolean, reason: string, rawWilson: number }}
 */
export function getConditionalHeroScore(
  hero,
  currentTeam,
  heroStats,
  heroSynergyStats,
) {
  const stats = heroStats[hero];
  if (!stats) return { score: 0, adjusted: false, reason: 'no_data', rawWilson: 0 };

  const rawWilson = stats.wilson ?? 0;
  const heroTotal = (stats.wins ?? 0) + (stats.losses ?? 0);
  if (heroTotal <= 0) return { score: 0, adjusted: false, reason: 'no_games', rawWilson: 0 };

  const synergy = (heroSynergyStats || {})[hero];
  if (!synergy || !synergy.has_significant_synergy) {
    return { score: rawWilson, adjusted: false, reason: 'no_synergy_dependency', rawWilson };
  }

  const partners = synergy.synergy_partners || [];
  if (partners.length === 0) {
    return { score: rawWilson, adjusted: false, reason: 'no_synergy_dependency', rawWilson };
  }

  const team = currentTeam || [];

  // Case 1: Check if any synergy partner is on the team (use best matching one)
  for (const p of partners) {
    if (team.includes(p.partner)) {
      const boostedScore = p.pair_wilson * 0.6 + rawWilson * 0.4;
      return {
        score: boostedScore,
        adjusted: true,
        reason: `synergy_boost_from_${p.partner}`,
        rawWilson,
        details: { partner: p.partner, pairWilson: p.pair_wilson, withoutWilson: p.without_wilson, boost: p.synergy_boost },
      };
    }
  }

  // Case 2: No synergy partner on team → check if we should deflate
  // Use the top partner's without_wilson and combined game share for deflation
  const topPartner = partners[0];
  const combinedGameShare = Math.min(1.0, partners.reduce((sum, p) => sum + p.game_share, 0));

  if (combinedGameShare >= 0.3) {
    const deflatedScore = rawWilson * (1 - combinedGameShare * 0.5) +
                          topPartner.without_wilson * (combinedGameShare * 0.5);
    const missingNames = partners.map(p => p.partner).join(',');
    return {
      score: deflatedScore,
      adjusted: true,
      reason: `missing_key_partners_${missingNames}`,
      rawWilson,
      details: { partners, combinedGameShare },
    };
  }

  // Synergy exists but combined game share too low to deflate → raw wilson
  return { score: rawWilson, adjusted: false, reason: 'no_synergy_dependency', rawWilson };
}

/**
 * Get a context-aware individual skill score that accounts for hero-dependency.
 *
 * Uses precomputed skill_synergy_stats from battle_stats.json (built at export time).
 * Mirrors getConditionalHeroScore but for the skill→hero relationship.
 *
 * Each skill may have up to 2 synergy heroes (top-2 by boost). The function checks:
 *   Case 1 – Any synergy hero IS on the team → boost using the best matching one
 *   Case 2 – No synergy hero on team & combined game share is high → deflate score
 *   Case 3 – No significant synergy dependency → use raw wilson unchanged
 *
 * @param {string}   skill             – candidate skill to score
 * @param {string[]} currentHeroes     – heroes already on the team
 * @param {Object}   skillStats        – battle_stats.skill_stats
 * @param {Object}   skillSynergyStats – battle_stats.skill_synergy_stats (precomputed)
 * @returns {{ score: number, adjusted: boolean, reason: string, rawWilson: number }}
 */
export function getConditionalSkillScore(
  skill,
  currentHeroes,
  skillStats,
  skillSynergyStats,
) {
  const stats = skillStats[skill];
  if (!stats) return { score: 0, adjusted: false, reason: 'no_data', rawWilson: 0 };

  const rawWilson = stats.wilson ?? 0;
  const skillTotal = (stats.wins ?? 0) + (stats.losses ?? 0);
  if (skillTotal <= 0) return { score: 0, adjusted: false, reason: 'no_games', rawWilson: 0 };

  const synergy = (skillSynergyStats || {})[skill];
  if (!synergy || !synergy.has_significant_synergy) {
    return { score: rawWilson, adjusted: false, reason: 'no_synergy_dependency', rawWilson };
  }

  const heroes = synergy.synergy_heroes || [];
  if (heroes.length === 0) {
    return { score: rawWilson, adjusted: false, reason: 'no_synergy_dependency', rawWilson };
  }

  const team = currentHeroes || [];

  // Case 1: Check if any synergy hero is on the team (use best matching one)
  for (const h of heroes) {
    if (team.includes(h.hero)) {
      const boostedScore = h.pair_wilson * 0.6 + rawWilson * 0.4;
      return {
        score: boostedScore,
        adjusted: true,
        reason: `synergy_boost_from_${h.hero}`,
        rawWilson,
        details: { hero: h.hero, pairWilson: h.pair_wilson, withoutWilson: h.without_wilson, boost: h.synergy_boost },
      };
    }
  }

  // Case 2: No synergy hero on team → check if we should deflate
  const topHero = heroes[0];
  const combinedGameShare = Math.min(1.0, heroes.reduce((sum, h) => sum + h.game_share, 0));

  if (combinedGameShare >= 0.3) {
    const deflatedScore = rawWilson * (1 - combinedGameShare * 0.5) +
                          topHero.without_wilson * (combinedGameShare * 0.5);
    const missingNames = heroes.map(h => h.hero).join(',');
    return {
      score: deflatedScore,
      adjusted: true,
      reason: `missing_key_heroes_${missingNames}`,
      rawWilson,
      details: { heroes, combinedGameShare },
    };
  }

  // Synergy exists but combined game share too low to deflate → raw wilson
  return { score: rawWilson, adjusted: false, reason: 'no_synergy_dependency', rawWilson };
}

/**
 * Get hero pair win rate using precomputed Wilson from battle_stats
 */
function getHeroPairWinRate(h1, h2, heroPairStats) {
  if (!h1 || !h2) return { adjusted: 0.0, total: 0 };
  const key = [h1, h2].sort().join(',');
  const stats = heroPairStats[key];
  if (!stats) return { adjusted: 0.0, total: 0 };
  const total = stats.wins + stats.losses;
  if (total <= 0) return { adjusted: 0.0, total: 0 };
  const adjusted = stats.wilson ?? 0;
  return { adjusted, total };
}

/**
 * Get skill-hero pair win rate using precomputed Wilson from battle_stats
 */
function getSkillHeroPairWinRate(hero, skill, skillHeroPairStats, minGames = 1) {
  if (!hero || !skill) return { adjusted: 0.0, total: 0 };
  const key = `${hero},${skill}`;
  const stats = skillHeroPairStats[key];
  if (!stats) return { adjusted: 0.0, total: 0 };
  const total = stats.wins + stats.losses;
  if (total <= 0) return { adjusted: 0.0, total: 0 };
  const adjusted = stats.wilson ?? 0;
  return { adjusted, total };
}

/**
 * Generate all possible 3-hero combinations from a team
 */
function generate3HeroCombinations(team) {
  const combinations = [];
  const n = team.length;
  if (n < 3) return combinations;
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        combinations.push([team[i], team[j], team[k]].sort());
      }
    }
  }
  return combinations;
}

/**
 * Internal synchronous hero recommendation implementation
 */
function _recommendHeroSetSync(
  availableSets,
  currentTeam,
  battleStats,
  currentSkills = []
) {
  const {
    minGames = 1,
    weightSetCombination,
    weightFullTeamCombination,
    weightPairStats,
    weightSkillHeroPairs,
  } = HERO_RECOMMEND_OPTIONS;

  if (!currentTeam) {
    throw new Error('current_team is required');
  }

  const heroStats = battleStats.hero_stats || {};
  const heroPairStats = battleStats.hero_pair_stats || {};
  const heroCombinations = battleStats.hero_combinations || {};
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
  const heroSynergyStats = battleStats.hero_synergy_stats || {};
  
  const recommendations = [];

  for (let i = 0; i < availableSets.length; i++) {
    const heroSet = availableSets[i];
    const analysis = {
      set_index: i,
      heroes: heroSet,
      individual_scores: {        // Score 1: Average adjusted win rate of individual heroes in set (using hero_stats)
        score: 0.0,
        details: null,
      },
      score_full_team_combination: {  // Score 2: Existing heroes + set using hero_combinations
        score: 0.0,
        details: [],
      },
      score_pair_stats: {              // Score 3: Existing heroes + set using hero_pair_stats
        score: 0.0,
        details: [],
      },
      score_skill_hero_pairs: {        // Score 4: Existing skills + set heroes using skill_hero_pair_stats
        score: 0.0,
        details: [],
      },
      final_score: 0.0,                   // Final weighted score out of 100
    };

    // Score 1: Context-aware adjusted win rate of individual heroes in set
    // Uses getConditionalHeroScore to account for synergy dependencies
    // Include heroes from the candidate set in the team context so that
    // synergy partners within the same set are recognised (not flagged as missing).
    const teamWithSet = [...currentTeam, ...heroSet];
    let heroWinRateTotal = 0.0;
    let heroCount = 0;
    const heroDetails = [];

    for (const hero of heroSet) {
      const stats = heroStats[hero];
      if (stats) {
        const total = stats.wins + stats.losses;
        if (total >= minGames) {
          const conditional = getConditionalHeroScore(hero, teamWithSet, heroStats, heroSynergyStats);
          const score = conditional.score * 100; // Score out of 100
          heroWinRateTotal += score;
          heroCount++;
          heroDetails.push({
            hero: hero,
            wins: stats.wins,
            losses: stats.losses,
            total: total,
            rawWinRate: (stats.wins / total) * 100,
            adjustedWinRate: (stats.wilson ?? 0) * 100,
            conditionalWinRate: conditional.score * 100,
            conditionalAdjusted: conditional.adjusted,
            conditionalReason: conditional.reason,
            score: score,
          });
        }
      }
    }

    // Average the context-aware win rates
    if (heroCount > 0) {
      analysis.individual_scores.score = heroWinRateTotal / heroCount;
      analysis.individual_scores.details = {
        heroes: heroSet,
        hero_details: heroDetails,
        average_adjusted_winrate: analysis.individual_scores.score,
      };
    }

    // Score 2: Adjusted win rate of existing heroes + potential set using hero_combinations
    // Check all 3-hero combinations that include at least one hero from currentTeam and at least one from heroSet
    const fullTeam = [...currentTeam, ...heroSet];
    const threeHeroCombos = generate3HeroCombinations(fullTeam);
    let fullTeamComboScores = [];
    let fullTeamComboTotal = 0.0;
    let fullTeamComboCount = 0;

    for (const combo of threeHeroCombos) {
      // Only consider combos that mix currentTeam and heroSet
      const hasCurrentTeamHero = combo.some(h => currentTeam.includes(h));
      const hasSetHero = combo.some(h => heroSet.includes(h));
      
      if (hasCurrentTeamHero && hasSetHero) {
        const comboKey = combo.join(',');
        const comboStats = heroCombinations[comboKey];
        if (comboStats) {
          const total = comboStats.wins + comboStats.losses;
          if (total >= minGames) {
            const adjustedWinRate = comboStats.wilson ?? 0;
            const score = adjustedWinRate * 100; // Score out of 100
            fullTeamComboScores.push(score);
            fullTeamComboTotal += score;
            fullTeamComboCount++;
            analysis.score_full_team_combination.details.push({
              heroes: combo,
              wins: comboStats.wins,
              losses: comboStats.losses,
              total: total,
              rawWinRate: (comboStats.wins / total) * 100,
              adjustedWinRate: adjustedWinRate * 100,
              score: score,
            });
          }
        }
      }
    }
    
    // Average score for full team combinations
    if (fullTeamComboCount > 0) {
      analysis.score_full_team_combination.score = fullTeamComboTotal / fullTeamComboCount;
    }

    // Score 3: Adjusted win rate of existing heroes + potential set using hero_pair_stats
    // Check all pairs between currentTeam and heroSet, plus pairs within heroSet
    let pairScores = [];
    let pairTotal = 0.0;
    let pairCount = 0;

    // Pairs between currentTeam and heroSet
    for (const currentHero of currentTeam) {
      for (const setHero of heroSet) {
        const { adjusted, total } = getHeroPairWinRate(currentHero, setHero, heroPairStats);
        if (total >= minGames) {
          const score = adjusted * 100; // Score out of 100
          pairScores.push(score);
          pairTotal += score;
          pairCount++;
          const pairKey = [currentHero, setHero].sort().join(',');
          analysis.score_pair_stats.details.push({
            hero1: currentHero,
            hero2: setHero,
            wins: heroPairStats[pairKey]?.wins || 0,
            total: total,
            adjustedWinRate: adjusted * 100,
            score: score,
          });
        }
      }
    }

    // Pairs within heroSet (intra-set synergy)
    for (let a = 0; a < heroSet.length; a++) {
      for (let b = a + 1; b < heroSet.length; b++) {
        const { adjusted, total } = getHeroPairWinRate(heroSet[a], heroSet[b], heroPairStats);
        if (total >= minGames) {
          const score = adjusted * 100;
          pairScores.push(score);
          pairTotal += score;
          pairCount++;
          const pairKey = [heroSet[a], heroSet[b]].sort().join(',');
          analysis.score_pair_stats.details.push({
            hero1: heroSet[a],
            hero2: heroSet[b],
            wins: heroPairStats[pairKey]?.wins || 0,
            total: total,
            adjustedWinRate: adjusted * 100,
            score: score,
          });
        }
      }
    }

    // Average score for pair stats
    if (pairCount > 0) {
      analysis.score_pair_stats.score = pairTotal / pairCount;
    }

    // Score 4: Adjusted win rate using skill_hero_pair_stats (existing skills + set heroes)
    let skillHeroScores = [];
    let skillHeroTotal = 0.0;
    let skillHeroCount = 0;

    for (const skill of currentSkills) {
      for (const setHero of heroSet) {
        const { adjusted, total } = getSkillHeroPairWinRate(setHero, skill, skillHeroPairStats);
        if (total >= minGames) {
          const score = adjusted * 100; // Score out of 100
          skillHeroScores.push(score);
          skillHeroTotal += score;
          skillHeroCount++;
          analysis.score_skill_hero_pairs.details.push({
            hero: setHero,
            skill: skill,
            wins: skillHeroPairStats[`${setHero},${skill}`]?.wins || 0,
            total: total,
            adjustedWinRate: adjusted * 100,
            score: score,
          });
        }
      }
    }

    // Average score for skill-hero pairs
    if (skillHeroCount > 0) {
      analysis.score_skill_hero_pairs.score = skillHeroTotal / skillHeroCount;
    }

    // Calculate final weighted score out of 100
    const weights = {
      set_combination: weightSetCombination,
      full_team_combination: weightFullTeamCombination,
      pair_stats: weightPairStats,
      skill_hero_pairs: weightSkillHeroPairs,
    };

    // Normalize weights to sum to 1.0
    const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weightSum > 0 ? {
      set_combination: weights.set_combination / weightSum,
      full_team_combination: weights.full_team_combination / weightSum,
      pair_stats: weights.pair_stats / weightSum,
      skill_hero_pairs: weights.skill_hero_pairs / weightSum,
    } : {
      set_combination: 0.25,
      full_team_combination: 0.25,
      pair_stats: 0.25,
      skill_hero_pairs: 0.25,
    };

    analysis.final_score = 
      analysis.individual_scores.score * normalizedWeights.set_combination +
      analysis.score_full_team_combination.score * normalizedWeights.full_team_combination +
      analysis.score_pair_stats.score * normalizedWeights.pair_stats +
      analysis.score_skill_hero_pairs.score * normalizedWeights.skill_hero_pairs;

    recommendations.push(analysis);
  }

  // Find the recommendation with the highest final_score
  const bestRecommendation = recommendations.length > 0 
    ? recommendations.reduce((best, current) => 
        current.final_score > best.final_score ? current : best
      )
    : null;

  return {
    recommended_set: bestRecommendation?.set_index ?? null,
    analysis: recommendations,
  };
}

/**
 * Recommend hero set (async version - loads battle stats if needed)
 */
export async function recommendHeroSet(
  availableSets,
  currentTeam,
  battleStatsOrUndefined = undefined,
  currentSkills = []
) {
  let battleStats = battleStatsOrUndefined;
  if (!battleStats) {
    battleStats = await getBattleStats();
  }
  return _recommendHeroSetSync(availableSets, currentTeam, battleStats, currentSkills);
}

/**
 * Internal synchronous skill recommendation implementation
 */
function _recommendSkillSetSync(
  availableSets,
  currentHeroes,
  currentSkills,
  battleStats
) {
  const {
    minGames = 1,
    weightIndividualSkills,
    weightSkillHeroPairs,
  } = SKILL_RECOMMEND_OPTIONS;

  if (!currentHeroes || !currentSkills) {
    throw new Error('current_heroes and current_skills are required');
  }

  const skillStats = battleStats.skill_stats || {};
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
  const skillSynergyStats = battleStats.skill_synergy_stats || {};
  
  const recommendations = [];

  for (let i = 0; i < availableSets.length; i++) {
    const skillSet = availableSets[i];
    const analysis = {
      set_index: i,
      skills: skillSet,
      individual_scores: {        // Score 1: Average adjusted win rate of individual skills in set (using skill_stats)
        score: 0.0,
        details: null,
      },
      score_skill_hero_pairs: {    // Score 2: Existing heroes + set skills using skill_hero_pair_stats
        score: 0.0,
        details: [],
      },
      final_score: 0.0,                // Final weighted score out of 100
    };

    // Score 1: Context-aware adjusted win rate of individual skills in set
    // Uses getConditionalSkillScore to account for hero-dependency
    let skillWinRateTotal = 0.0;
    let skillCount = 0;
    const skillDetails = [];

    for (const skill of skillSet) {
      const stats = skillStats[skill];
      if (stats) {
        const total = stats.wins + stats.losses;
        if (total >= minGames) {
          const conditional = getConditionalSkillScore(skill, currentHeroes, skillStats, skillSynergyStats);
          const score = conditional.score * 100; // Score out of 100
          skillWinRateTotal += score;
          skillCount++;
          skillDetails.push({
            skill: skill,
            wins: stats.wins,
            losses: stats.losses,
            total: total,
            rawWinRate: (stats.wins / total) * 100,
            adjustedWinRate: (stats.wilson ?? 0) * 100,
            conditionalWinRate: conditional.score * 100,
            conditionalAdjusted: conditional.adjusted,
            conditionalReason: conditional.reason,
            score: score,
          });
        }
      }
    }

    // Average the context-aware win rates
    if (skillCount > 0) {
      analysis.individual_scores.score = skillWinRateTotal / skillCount;
      analysis.individual_scores.details = {
        skills: skillSet,
        skill_details: skillDetails,
        average_adjusted_winrate: analysis.individual_scores.score,
      };
    }

    // Score 2: Adjusted win rate using skill_hero_pair_stats (existing heroes + set skills)
    let skillHeroScores = [];
    let skillHeroTotal = 0.0;
    let skillHeroCount = 0;

    for (const hero of currentHeroes) {
      for (const skill of skillSet) {
        const { adjusted, total } = getSkillHeroPairWinRate(hero, skill, skillHeroPairStats);
        if (total >= minGames) {
          const score = adjusted * 100; // Score out of 100
          skillHeroScores.push(score);
          skillHeroTotal += score;
          skillHeroCount++;
          analysis.score_skill_hero_pairs.details.push({
          hero: hero,
          skill: skill,
            wins: skillHeroPairStats[`${hero},${skill}`]?.wins || 0,
          total: total,
            adjustedWinRate: adjusted * 100,
            score: score,
          });
        }
      }
    }

    // Average score for skill-hero pairs
    if (skillHeroCount > 0) {
      analysis.score_skill_hero_pairs.score = skillHeroTotal / skillHeroCount;
    }

    // Calculate final weighted score out of 100
    const weights = {
      individual_skills: weightIndividualSkills,
      skill_hero_pairs: weightSkillHeroPairs,
    };

    // Normalize weights to sum to 1.0
    const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weightSum > 0 ? {
      individual_skills: weights.individual_skills / weightSum,
      skill_hero_pairs: weights.skill_hero_pairs / weightSum,
    } : {
      individual_skills: 0.5,
      skill_hero_pairs: 0.5,
    };

    analysis.final_score = 
      analysis.individual_scores.score * normalizedWeights.individual_skills +
      analysis.score_skill_hero_pairs.score * normalizedWeights.skill_hero_pairs;

    recommendations.push(analysis);
  }

  // Find the recommendation with the highest final_score
  const bestRecommendation = recommendations.length > 0 
    ? recommendations.reduce((best, current) => 
        current.final_score > best.final_score ? current : best
      )
    : null;

    return {
    recommended_set: bestRecommendation?.set_index ?? null,
    analysis: recommendations,
  };
}

/**
 * Recommend skill set (async version - loads battle stats if needed)
 */
export async function recommendSkillSet(
  availableSets,
  currentHeroes,
  currentSkills,
  battleStatsOrUndefined = undefined
) {
  let battleStats = battleStatsOrUndefined;
  if (!battleStats) {
    battleStats = await getBattleStats();
  }
  return _recommendSkillSetSync(availableSets, currentHeroes, currentSkills, battleStats);
}

/**
 * Get top heroes by performance
 */
export async function getTopHeroes(battleStatsOrUndefined, limit = 20, minGames = 1, useAdjusted = true) {
  let battleStats = battleStatsOrUndefined;
  if (!battleStats) {
    battleStats = await getBattleStats();
  }
  
  const heroStats = battleStats.hero_stats || {};
  const rankings = [];

  for (const [hero, stats] of Object.entries(heroStats)) {
    const games = stats.total;
    const totalWl = stats.wins + stats.losses;
    if (games < minGames || totalWl <= 0) continue;
    const raw = games > 0 ? stats.wins / games : 0.0;
    const wilson = stats.wilson ?? 0;
    const score = useAdjusted ? wilson : raw;
    rankings.push({ hero, raw, games, score, wilson });
  }

  rankings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.games - a.games;
  });

  return rankings.slice(0, limit).map(({ hero, raw, games, wilson }) => [hero, raw, games, wilson]);
}

/**
 * Get top skills by performance
 */
export async function getTopSkills(battleStatsOrUndefined, database, limit = 30, minGames = 1, useAdjusted = true) {
  let battleStats = battleStatsOrUndefined;
  if (!battleStats) {
    battleStats = await getBattleStats();
  }
  
  const skillStats = battleStats.skill_stats || {};
  const heroSkillMap = database?.skill_hero_map || {};
  const heroSkills = new Set(Object.keys(heroSkillMap));
  const rankings = [];

  for (const [skill, stats] of Object.entries(skillStats)) {
    // Exclude hero-specific skills
    if (heroSkills.has(skill)) continue;
    const games = stats.total;
    const totalWl = stats.wins + stats.losses;
    if (games < minGames || totalWl <= 0) continue;
    const raw = games > 0 ? stats.wins / games : 0.0;
    const wilson = stats.wilson ?? 0;
    const score = useAdjusted ? wilson : raw;
    rankings.push({ skill, raw, games, score, wilson });
  }

  rankings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.games - a.games;
  });

  return rankings.slice(0, limit).map(({ skill, raw, games, wilson }) => [skill, raw, games, wilson]);
}

/**
 * Recommend a single hero from unchosen heroes based on synergy with current team
 * @param {string[]} unchosenHeroes - Heroes not yet in the team
 * @param {string[]} currentHeroes - Heroes already in the team
 * @param {string[]} currentSkills - Skills already in the team
 * @param {Object} battleStatsOrUndefined - Battle statistics data (optional, will be loaded if not provided)
 * @returns {Object} Recommended hero with analysis
 */
export async function recommendSingleHero(unchosenHeroes, currentHeroes, currentSkills, battleStatsOrUndefined = undefined) {
  let battleStats = battleStatsOrUndefined;
  if (!battleStats) {
    battleStats = await getBattleStats();
  }
  
  if (!unchosenHeroes || unchosenHeroes.length === 0) {
    return { hero: null, analysis: [] };
  }

  const heroStats = battleStats.hero_stats || {};
  const heroPairStats = battleStats.hero_pair_stats || {};
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
  const heroSynergyStats = battleStats.hero_synergy_stats || {};
  const minGames = 1;

  const candidates = [];

  for (const hero of unchosenHeroes) {
    let totalScore = 0;
    let weightSum = 0;
    const details = {};

    // Factor 1: Context-aware individual hero win rate (weight 0.4)
    // Uses conditional scoring to account for synergy dependencies
    const stats = heroStats[hero];
    if (stats) {
      const total = stats.wins + stats.losses;
      if (total >= minGames) {
        const conditional = getConditionalHeroScore(hero, currentHeroes, heroStats, heroSynergyStats);
        details.individualScore = conditional.score * 100;
        details.rawWilson = (stats.wilson ?? 0) * 100;
        details.conditionalAdjusted = conditional.adjusted;
        details.conditionalReason = conditional.reason;
        details.wins = stats.wins;
        details.losses = stats.losses;
        details.total = total;
        totalScore += details.individualScore * 0.4;
        weightSum += 0.4;
      }
    }

    // Factor 2: Average pair synergy with current heroes (weight 0.3)
    if (currentHeroes.length > 0) {
      let pairTotal = 0;
      let pairCount = 0;
      for (const teammate of currentHeroes) {
        const key = [hero, teammate].sort().join(',');
        const pairStat = heroPairStats[key];
        if (pairStat) {
          const total = pairStat.wins + pairStat.losses;
          if (total >= minGames) {
            pairTotal += (pairStat.wilson ?? 0) * 100;
            pairCount++;
          }
        }
      }
      if (pairCount > 0) {
        details.pairScore = pairTotal / pairCount;
        totalScore += details.pairScore * 0.3;
        weightSum += 0.3;
      }
    }

    // Factor 3: Skill-hero pair synergy with current skills (weight 0.3)
    if (currentSkills.length > 0) {
      let skillTotal = 0;
      let skillCount = 0;
      for (const skill of currentSkills) {
        const key = `${hero},${skill}`;
        const shStat = skillHeroPairStats[key];
        if (shStat) {
          const total = shStat.wins + shStat.losses;
          if (total >= minGames) {
            skillTotal += (shStat.wilson ?? 0) * 100;
            skillCount++;
          }
        }
      }
      if (skillCount > 0) {
        details.skillHeroScore = skillTotal / skillCount;
        totalScore += details.skillHeroScore * 0.3;
        weightSum += 0.3;
      }
    }

    // Normalize score if not all weights contributed
    const finalScore = weightSum > 0 ? totalScore / weightSum : 0;

    candidates.push({
      hero,
      finalScore,
      details,
    });
  }

  // Sort by final score descending
  candidates.sort((a, b) => b.finalScore - a.finalScore);

  return {
    hero: candidates.length > 0 ? candidates[0].hero : null,
    analysis: candidates.slice(0, 10), // Return top 10 for display
  };
}

/**
 * Recommend two skills from unchosen skills based on synergy with current team
 * @param {string[]} unchosenSkills - Skills not yet in the team
 * @param {string[]} currentHeroes - Heroes already in the team
 * @param {string[]} currentSkills - Skills already in the team
 * @param {Object} battleStatsOrUndefined - Battle statistics data (optional, will be loaded if not provided)
 * @returns {Object} Recommended two skills with analysis
 */
export async function recommendTwoSkills(unchosenSkills, currentHeroes, currentSkills, battleStatsOrUndefined = undefined) {
  let battleStats = battleStatsOrUndefined;
  if (!battleStats) {
    battleStats = await getBattleStats();
  }
  
  if (!unchosenSkills || unchosenSkills.length < 2) {
    return { skills: [], analysis: [] };
  }

  const skillStats = battleStats.skill_stats || {};
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
  const skillSynergyStats = battleStats.skill_synergy_stats || {};
  const minGames = 1;

  const candidates = [];

  for (const skill of unchosenSkills) {
    let totalScore = 0;
    let weightSum = 0;
    const details = {};

    // Factor 1: Context-aware individual skill win rate (weight 0.5)
    // Uses conditional scoring to account for hero-dependency
    const stats = skillStats[skill];
    if (stats) {
      const total = stats.wins + stats.losses;
      if (total >= minGames) {
        const conditional = getConditionalSkillScore(skill, currentHeroes, skillStats, skillSynergyStats);
        details.individualScore = conditional.score * 100;
        details.rawWilson = (stats.wilson ?? 0) * 100;
        details.conditionalAdjusted = conditional.adjusted;
        details.conditionalReason = conditional.reason;
        details.wins = stats.wins;
        details.losses = stats.losses;
        details.total = total;
        totalScore += details.individualScore * 0.5;
        weightSum += 0.5;
      }
    }

    // Factor 2: Skill-hero pair synergy with current heroes (weight 0.5)
    if (currentHeroes.length > 0) {
      let heroTotal = 0;
      let heroCount = 0;
      for (const hero of currentHeroes) {
        const key = `${hero},${skill}`;
        const shStat = skillHeroPairStats[key];
        if (shStat) {
          const total = shStat.wins + shStat.losses;
          if (total >= minGames) {
            heroTotal += (shStat.wilson ?? 0) * 100;
            heroCount++;
          }
        }
      }
      if (heroCount > 0) {
        details.skillHeroScore = heroTotal / heroCount;
        totalScore += details.skillHeroScore * 0.5;
        weightSum += 0.5;
      }
    }

    // Normalize score if not all weights contributed
    const finalScore = weightSum > 0 ? totalScore / weightSum : 0;

    candidates.push({
      skill,
      finalScore,
      details,
    });
  }

  // Sort by final score descending
  candidates.sort((a, b) => b.finalScore - a.finalScore);

  // Return top 2 skills
  const topTwo = candidates.slice(0, 2).map(c => c.skill);

  return {
    skills: topTwo,
    analysis: candidates.slice(0, 10), // Return top 10 for display
  };
}

/**
 * Recommend 3 teams, each with 3 heroes and 2 skills per hero,
 * from the available hero and skill pools.
 *
 * Algorithm:
 *  - Greedily pick the best 3-hero combo (by hero_combinations wilson score),
 *    then assign each hero its 2 best available skills (by skill_hero_pair wilson).
 *  - Remove used heroes/skills, repeat for the next team.
 *
 * @param {string[]} heroPool  – all available heroes
 * @param {string[]} skillPool – all available skills
 * @param {Object} battleStatsOrUndefined – battle stats (optional, will be loaded if not provided)
 * @returns {{ teams: Array<{heroes: Array<{name,skills:string[]}>, score:number}> }}
 */
export async function recommendTeams(heroPool, skillPool, battleStatsOrUndefined = undefined) {
  let battleStats = battleStatsOrUndefined;
  if (!battleStats) {
    battleStats = await getBattleStats();
  }
  
  const heroCombinations = battleStats.hero_combinations || {};
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
  const heroStats = battleStats.hero_stats || {};
  const heroSynergyStats = battleStats.hero_synergy_stats || {};

  let remainingHeroes = [...heroPool];
  let remainingSkills = [...skillPool];
  const teams = [];

  for (let t = 0; t < 3; t++) {
    // --- pick the best 3-hero combo from remaining heroes ---
    let bestCombo = null;
    let bestComboScore = -1;
    let bestComboStats = null;

    if (remainingHeroes.length >= 3) {
      const n = remainingHeroes.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          for (let k = j + 1; k < n; k++) {
            const trio = [remainingHeroes[i], remainingHeroes[j], remainingHeroes[k]].sort();
            const key = trio.join(',');
            const stats = heroCombinations[key];
            if (stats) {
              const total = stats.wins + stats.losses;
              if (total >= 1) {
                const wilson = stats.wilson ?? 0;
                if (wilson > bestComboScore) {
                  bestComboScore = wilson;
                  bestCombo = trio;
                  bestComboStats = { wins: stats.wins, losses: stats.losses, total, wilson };
                }
              }
            }
          }
        }
      }
    }

    // Fallback: if no combo found with stats, pick the 3 heroes with best
    // context-aware individual scores (accounts for synergy dependencies)
    if (!bestCombo && remainingHeroes.length >= 3) {
      const ranked = remainingHeroes
        .map(h => {
          // Use conditional scoring: heroes on the same team can boost each other
          // For fallback, use remaining heroes as loose context (no fixed team yet)
          const conditional = getConditionalHeroScore(h, [], heroStats, heroSynergyStats);
          return { hero: h, wilson: conditional.score };
        })
        .sort((a, b) => b.wilson - a.wilson);
      bestCombo = ranked.slice(0, 3).map(r => r.hero).sort();
      bestComboScore = ranked.slice(0, 3).reduce((s, r) => s + r.wilson, 0) / 3;
      bestComboStats = null;
    }

    if (!bestCombo) break; // not enough heroes left

    // --- assign 2 best skills to each hero ---
    const teamHeroes = [];
    const usedSkillsThisTeam = new Set();

    for (const hero of bestCombo) {
      // Score every remaining skill for this hero
      const scored = remainingSkills
        .filter(s => !usedSkillsThisTeam.has(s))
        .map(skill => {
          const key = `${hero},${skill}`;
          const pairStat = skillHeroPairStats[key];
          let score = 0;
          let pairInfo = null;
          if (pairStat) {
            const total = pairStat.wins + pairStat.losses;
            if (total >= 1) {
              score = pairStat.wilson ?? 0;
              pairInfo = { wins: pairStat.wins, losses: pairStat.losses, total, wilson: score };
            }
          }
          return { skill, score, pairInfo };
        })
        .sort((a, b) => b.score - a.score);

      const assignedSkills = scored.slice(0, 2).map(s => s.skill);
      const assignedDetails = scored.slice(0, 2);
      assignedSkills.forEach(s => usedSkillsThisTeam.add(s));

      teamHeroes.push({
        name: hero,
        skills: assignedSkills,
        skillDetails: assignedDetails,
      });
    }

    teams.push({
      heroes: teamHeroes,
      comboScore: bestComboScore,
      comboStats: bestComboStats,
    });

    // Remove used heroes and skills from pools
    const usedHeroSet = new Set(bestCombo);
    remainingHeroes = remainingHeroes.filter(h => !usedHeroSet.has(h));
    remainingSkills = remainingSkills.filter(s => !usedSkillsThisTeam.has(s));
  }

  return { teams };
}

/**
 * Get analytics data
 */
export async function getAnalytics(battleStatsOrUndefined, database) {
  let battleStats = battleStatsOrUndefined;
  if (!battleStats) {
    battleStats = await getBattleStats();
  }
  
  const heroStats = battleStats.hero_stats || {};
  const skillStats = battleStats.skill_stats || {};
  const heroCombinations = battleStats.hero_combinations || {};
  const heroSynergyStats = battleStats.hero_synergy_stats || {};
  const skillSynergyStats = battleStats.skill_synergy_stats || {};
  const totalBattles = battleStats.total_battles || 0;

  // Basic stats
  const totalHeroes = Object.keys(heroStats).length;
  const totalSkills = Object.keys(skillStats).length;

  // Top performers
  const topHeroes = await getTopHeroes(battleStats, 20);
  const topSkills = await getTopSkills(battleStats, database, 30);

  // Win rate distributions
  const heroWinRates = Object.entries(heroStats)
    .filter(([, stats]) => stats.total > 0)
    .map(([hero, stats]) => [hero, stats.wins / stats.total]);

  const skillWinRates = Object.entries(skillStats)
    .filter(([, stats]) => stats.total > 0)
    .map(([skill, stats]) => [skill, stats.wins / stats.total]);

  // Team compositions analysis
  const winningCombos = [];
  for (const [comboKey, stats] of Object.entries(heroCombinations)) {
    if (stats.wins > 0) {
      const totalGames = stats.wins + stats.losses;
      const winRate = stats.wins / totalGames;
      const wilson = stats.wilson ?? 0;
      winningCombos.push({
        heroes: comboKey.split(','),
        wins: stats.wins,
        losses: stats.losses,
        total_games: totalGames,
        win_rate: winRate,
        wilson,
      });
    }
  }

  winningCombos.sort((a, b) => {
    if (b.wilson !== a.wilson) return b.wilson - a.wilson;
    return b.wins - a.wins;
  });

  // Most used heroes/skills
  const heroUsage = Object.entries(heroStats)
    .map(([hero, stats]) => [hero, stats.total])
    .sort((a, b) => b[1] - a[1]);

  const skillUsage = Object.entries(skillStats)
    .map(([skill, stats]) => [skill, stats.total])
    .sort((a, b) => b[1] - a[1]);

  // Use team win data from exported stats
  const team1Wins = battleStats.team1_wins || 0;
  const team2Wins = battleStats.team2_wins || 0;
  const unknownWins = battleStats.unknown_wins || 0;

  // All heroes/skills with stats (no limit)
  const allHeroes = await getTopHeroes(battleStats, 999);
  const allSkillsData = await getTopSkills(battleStats, database, 999);
  const allHeroesFormatted = allHeroes.map(([hero, rate, games, wilson]) => [hero, `${(rate * 100).toFixed(1)}%`, games, wilson]);
  const allSkillsFormatted = allSkillsData.map(([skill, rate, games, wilson]) => [skill, `${(rate * 100).toFixed(1)}%`, games, wilson]);

  return {
    summary: {
      total_battles: totalBattles,
      total_heroes: totalHeroes,
      total_skills: totalSkills,
      team1_wins: team1Wins,
      team2_wins: team2Wins,
      unknown_wins: unknownWins,
    },
    top_heroes: topHeroes.map(([hero, rate, games, wilson]) => [hero, `${(rate * 100).toFixed(1)}%`, games, wilson]),
    all_heroes: allHeroesFormatted,
    top_skills: topSkills.map(([skill, rate, games, wilson]) => [skill, `${(rate * 100).toFixed(1)}%`, games, wilson]),
    all_skills: allSkillsFormatted,
    hero_usage: heroUsage.slice(0, 20),
    all_hero_usage: heroUsage,
    skill_usage: skillUsage.slice(0, 30),
    all_skill_usage: skillUsage,
    winning_combos: winningCombos.slice(0, 15),
    all_winning_combos: winningCombos,
    win_rate_stats: {
      hero_avg_winrate: heroWinRates.length > 0
        ? heroWinRates.reduce((sum, [, rate]) => sum + rate, 0) / heroWinRates.length
        : 0,
      skill_avg_winrate: skillWinRates.length > 0
        ? skillWinRates.reduce((sum, [, rate]) => sum + rate, 0) / skillWinRates.length
        : 0,
      heroes_above_50: heroWinRates.filter(([, rate]) => rate > 0.5).length,
      skills_above_50: skillWinRates.filter(([, rate]) => rate > 0.5).length,
    },
    // Hero synergy dependencies — precomputed at export time (top-2 partners per hero)
    hero_synergy: Object.entries(heroSynergyStats)
      .filter(([, v]) => v.has_significant_synergy && v.synergy_partners?.length > 0)
      .map(([hero, v]) => ({
        hero,
        hero_wilson: (heroStats[hero]?.wilson ?? 0),
        partners: v.synergy_partners,  // array of { partner, pair_wilson, without_wilson, synergy_boost, game_share }
      }))
      .sort((a, b) => b.partners[0].synergy_boost - a.partners[0].synergy_boost),
    // Skill synergy dependencies — precomputed at export time (top-2 heroes per skill)
    skill_synergy: Object.entries(skillSynergyStats)
      .filter(([, v]) => v.has_significant_synergy && v.synergy_heroes?.length > 0)
      .map(([skill, v]) => ({
        skill,
        skill_wilson: (skillStats[skill]?.wilson ?? 0),
        heroes: v.synergy_heroes,  // array of { hero, pair_wilson, without_wilson, synergy_boost, game_share }
      }))
      .sort((a, b) => b.heroes[0].synergy_boost - a.heroes[0].synergy_boost),
  };
}
