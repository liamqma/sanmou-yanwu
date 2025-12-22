/**
 * Client-side recommendation engine
 * Ported from Python ai_recommendation_system.py
 */

/**
 * Bayesian Average: Shrinks win rate towards a prior
 * @param {number} wins - Number of wins
 * @param {number} total - Total games (wins + losses)
 * @param {number} priorWinRate - Prior win rate (e.g., overall average, default 0.5)
 * @param {number} priorWeight - Weight of prior (number of pseudo-observations, default 10)
 * @returns {number} Adjusted win rate between 0 and 1
 */
export function bayesianAverage(wins, total, priorWinRate = 0.5, priorWeight = 10) {
  if (total === 0) return priorWinRate;
  const observedRate = wins / total;
  return (priorWeight * priorWinRate + total * observedRate) / (priorWeight + total);
}

/**
 * Calculate overall win rate from stats object (for Empirical Bayes prior)
 * @param {Object} stats - Stats object with wins/losses (e.g., hero_stats, hero_pair_stats)
 * @returns {number} Overall win rate between 0 and 1
 */
function calculateOverallWinRate(stats) {
  let totalWins = 0;
  let totalGames = 0;
  for (const stat of Object.values(stats)) {
    if (stat && typeof stat.wins === 'number' && typeof stat.losses === 'number') {
      totalWins += stat.wins;
      totalGames += stat.wins + stat.losses;
    }
  }
  return totalGames > 0 ? totalWins / totalGames : 0.5;
}

/**
 * Empirical Bayes: Estimates prior from all stats, then applies Bayesian average
 * @param {number} wins - Number of wins for this item
 * @param {number} total - Total games for this item
 * @param {Object} allStats - All stats to compute overall average (e.g., all hero_stats)
 * @param {number} priorWeight - Weight of prior (default 10)
 * @returns {number} Adjusted win rate between 0 and 1
 */
export function empiricalBayes(wins, total, allStats, priorWeight = 10) {
  const priorWinRate = calculateOverallWinRate(allStats);
  return bayesianAverage(wins, total, priorWinRate, priorWeight);
}

/**
 * Get hero pair adjusted win rate using Empirical Bayes
 */
function getHeroPairBayesian(h1, h2, heroPairStats, allHeroPairStats, minGames = 1, priorWeight = 10) {
  if (!h1 || !h2) return { adjusted: 0.0, total: 0 };
  const key = [h1, h2].sort().join(',');
  const stats = heroPairStats[key];
  if (!stats) return { adjusted: 0.0, total: 0 };
  const total = stats.wins + stats.losses;
  if (total <= 0) return { adjusted: 0.0, total: 0 };
  const adjusted = empiricalBayes(stats.wins, total, allHeroPairStats, priorWeight);
  return { adjusted, total };
}

/**
 * Get skill-hero pair adjusted win rate using Empirical Bayes
 */
function getSkillHeroPairBayesian(hero, skill, skillHeroPairStats, allSkillHeroPairStats, minGames = 1, priorWeight = 10) {
  if (!hero || !skill) return { adjusted: 0.0, total: 0 };
  const key = `${hero},${skill}`;
  const stats = skillHeroPairStats[key];
  if (!stats) return { adjusted: 0.0, total: 0 };
  const total = stats.wins + stats.losses;
  if (total <= 0) return { adjusted: 0.0, total: 0 };
  const adjusted = empiricalBayes(stats.wins, total, allSkillHeroPairStats, priorWeight);
  return { adjusted, total };
}

/**
 * Recommend hero set
 */
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

export function recommendHeroSet(
  availableSets,
  currentTeam,
  battleStats,
  currentSkills = [],
  options = {}
) {
  const {
    minGames = 1,
    // Weights for the 4 scoring categories (should sum to 1.0 for percentage, or use raw weights)
    weightSetCombination = 0.4,      // Weight for set's own 3-hero combination
    weightFullTeamCombination = 0.3, // Weight for existing heroes + set using hero_combinations
    weightPairStats = 0.2,            // Weight for existing heroes + set using hero_pair_stats
    weightSkillHeroPairs = 0.1,       // Weight for existing skills + set heroes using skill_hero_pair_stats
  } = options;

  if (!currentTeam) {
    throw new Error('current_team is required');
  }

  const heroStats = battleStats.hero_stats || {};
  const heroPairStats = battleStats.hero_pair_stats || {};
  const heroCombinations = battleStats.hero_combinations || {};
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
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

    // Score 1: Adjusted win rate of the set itself (3 heroes) using hero_stats
    // Get individual win rate for each hero in the set, then average them
    let heroWinRates = [];
    let heroWinRateTotal = 0.0;
    let heroCount = 0;
    const heroDetails = [];

    for (const hero of heroSet) {
      const stats = heroStats[hero];
      if (stats) {
        const total = stats.wins + stats.losses;
        if (total >= minGames) {
          const adjustedWinRate = empiricalBayes(stats.wins, total, heroStats);
          const score = adjustedWinRate * 100; // Score out of 100
          heroWinRates.push(score);
          heroWinRateTotal += score;
          heroCount++;
          heroDetails.push({
            hero: hero,
            wins: stats.wins,
            losses: stats.losses,
            total: total,
            rawWinRate: (stats.wins / total) * 100,
            adjustedWinRate: adjustedWinRate * 100,
            score: score,
          });
        }
      }
    }

    // Average the adjusted win rates
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
            const adjustedWinRate = empiricalBayes(comboStats.wins, total, heroCombinations);
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
    // Check all pairs between currentTeam and heroSet
    let pairScores = [];
    let pairTotal = 0.0;
    let pairCount = 0;

    for (const currentHero of currentTeam) {
      for (const setHero of heroSet) {
        const { adjusted, total } = getHeroPairBayesian(currentHero, setHero, heroPairStats, heroPairStats, minGames);
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
        const { adjusted, total } = getSkillHeroPairBayesian(setHero, skill, skillHeroPairStats, skillHeroPairStats, minGames);
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
 * Recommend skill set
 */
export function recommendSkillSet(
  availableSets,
  currentHeroes,
  currentSkills,
  battleStats,
  options = {}
) {
  const {
    minGames = 1,
    // Weights for the 2 scoring categories (should sum to 1.0 for percentage, or use raw weights)
    weightIndividualSkills = 0.5,      // Weight for individual skill scores (skill_stats)
    weightSkillHeroPairs = 0.5,         // Weight for skill-hero pair stats (skill_hero_pair_stats)
  } = options;

  if (!currentHeroes || !currentSkills) {
    throw new Error('current_heroes and current_skills are required');
  }

  const skillStats = battleStats.skill_stats || {};
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
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

    // Score 1: Adjusted win rate of individual skills using skill_stats
    // Get individual win rate for each skill in the set, then average them
    let skillWinRates = [];
    let skillWinRateTotal = 0.0;
    let skillCount = 0;
    const skillDetails = [];

    for (const skill of skillSet) {
      const stats = skillStats[skill];
      if (stats) {
        const total = stats.wins + stats.losses;
        if (total >= minGames) {
          const adjustedWinRate = empiricalBayes(stats.wins, total, skillStats);
          const score = adjustedWinRate * 100; // Score out of 100
          skillWinRates.push(score);
          skillWinRateTotal += score;
          skillCount++;
          skillDetails.push({
            skill: skill,
            wins: stats.wins,
            losses: stats.losses,
            total: total,
            rawWinRate: (stats.wins / total) * 100,
            adjustedWinRate: adjustedWinRate * 100,
            score: score,
          });
        }
      }
    }

    // Average the adjusted win rates
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
        const { adjusted, total } = getSkillHeroPairBayesian(hero, skill, skillHeroPairStats, skillHeroPairStats, minGames);
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
 * Get top heroes by performance
 */
export function getTopHeroes(battleStats, limit = 20, minGames = 1, useBayesian = true) {
  const heroStats = battleStats.hero_stats || {};
  const rankings = [];

  for (const [hero, stats] of Object.entries(heroStats)) {
    const games = stats.total;
    const totalWl = stats.wins + stats.losses;
    if (games < minGames || totalWl <= 0) continue;
    const raw = games > 0 ? stats.wins / games : 0.0;
    const score = useBayesian ? empiricalBayes(stats.wins, totalWl, heroStats) : raw;
    rankings.push({ hero, raw, games, score });
  }

  rankings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.games - a.games;
  });

  return rankings.slice(0, limit).map(({ hero, raw, games }) => [hero, raw, games]);
}

/**
 * Get top skills by performance
 */
export function getTopSkills(battleStats, database, limit = 30, minGames = 1, useBayesian = true) {
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
    const score = useBayesian ? empiricalBayes(stats.wins, totalWl, skillStats) : raw;
    rankings.push({ skill, raw, games, score });
  }

  rankings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.games - a.games;
  });

  return rankings.slice(0, limit).map(({ skill, raw, games }) => [skill, raw, games]);
}

/**
 * Get analytics data
 */
export function getAnalytics(battleStats, database) {
  const heroStats = battleStats.hero_stats || {};
  const skillStats = battleStats.skill_stats || {};
  const heroCombinations = battleStats.hero_combinations || {};
  const totalBattles = battleStats.total_battles || 0;

  // Basic stats
  const totalHeroes = Object.keys(heroStats).length;
  const totalSkills = Object.keys(skillStats).length;

  // Top performers
  const topHeroes = getTopHeroes(battleStats, 20);
  const topSkills = getTopSkills(battleStats, database, 30);

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
      winningCombos.push({
        heroes: comboKey.split(','),
        wins: stats.wins,
        losses: stats.losses,
        total_games: totalGames,
        win_rate: winRate,
      });
    }
  }

  winningCombos.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.win_rate - a.win_rate;
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

  return {
    summary: {
      total_battles: totalBattles,
      total_heroes: totalHeroes,
      total_skills: totalSkills,
      team1_wins: team1Wins,
      team2_wins: team2Wins,
      unknown_wins: unknownWins,
    },
    top_heroes: topHeroes.map(([hero, rate, games]) => [hero, `${(rate * 100).toFixed(1)}%`, games]),
    top_skills: topSkills.map(([skill, rate, games]) => [skill, `${(rate * 100).toFixed(1)}%`, games]),
    hero_usage: heroUsage.slice(0, 20),
    skill_usage: skillUsage.slice(0, 30),
    winning_combos: winningCombos.slice(0, 15),
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
  };
}

