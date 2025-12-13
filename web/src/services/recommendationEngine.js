/**
 * Client-side recommendation engine
 * Ported from Python ai_recommendation_system.py
 */

/**
 * Wilson score interval lower bound for a Bernoulli parameter (95% default)
 */
function wilsonLowerBound(wins, total, z = 1.96) {
  if (total === 0) return 0.0;
  const phat = wins / total;
  const denom = 1 + (z * z) / total;
  const centre = phat + (z * z) / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return Math.max(0.0, (centre - margin) / denom);
}

/**
 * Get hero confidence score using Wilson lower bound
 */
function getHeroConfidenceScore(heroName, heroStats, scale = 100.0) {
  const stats = heroStats[heroName];
  if (!stats) return 0.0;
  const wins = stats.wins;
  const total = stats.wins + stats.losses;
  if (total <= 0) return 0.0;
  return scale * wilsonLowerBound(wins, total);
}

/**
 * Get skill confidence score using Wilson lower bound
 */
function getSkillConfidenceScore(skillName, skillStats, scale = 100.0) {
  const stats = skillStats[skillName];
  if (!stats) return 0.0;
  const wins = stats.wins;
  const total = stats.wins + stats.losses;
  if (total <= 0) return 0.0;
  return scale * wilsonLowerBound(wins, total);
}

/**
 * Get hero pair Wilson score
 */
function getHeroPairWilson(h1, h2, heroPairStats, minGames = 1) {
  if (!h1 || !h2) return { wilson: 0.0, total: 0 };
  const key = [h1, h2].sort().join(',');
  const stats = heroPairStats[key];
  if (!stats) return { wilson: 0.0, total: 0 };
  const total = stats.wins + stats.losses;
  if (total <= 0) return { wilson: 0.0, total: 0 };
  return { wilson: wilsonLowerBound(stats.wins, total), total };
}

/**
 * Get skill pair Wilson score
 */
function getSkillPairWilson(s1, s2, skillPairStats, minGames = 1) {
  if (!s1 || !s2) return { wilson: 0.0, total: 0 };
  const key = [s1, s2].sort().join(',');
  const stats = skillPairStats[key];
  if (!stats) return { wilson: 0.0, total: 0 };
  const total = stats.wins + stats.losses;
  if (total <= 0) return { wilson: 0.0, total: 0 };
  return { wilson: wilsonLowerBound(stats.wins, total), total };
}

/**
 * Get skill-hero pair Wilson score
 */
function getSkillHeroPairWilson(hero, skill, skillHeroPairStats, minGames = 1) {
  if (!hero || !skill) return { wilson: 0.0, total: 0 };
  const key = `${hero},${skill}`;
  const stats = skillHeroPairStats[key];
  if (!stats) return { wilson: 0.0, total: 0 };
  const total = stats.wins + stats.losses;
  if (total <= 0) return { wilson: 0.0, total: 0 };
  return { wilson: wilsonLowerBound(stats.wins, total), total };
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
  options = {}
) {
  const {
    minWilson = 0.50,
    minGames = 2,
    includeIntraSet = true,
    weightCurrentPair = 100.0,
    weightIntraPair = 75.0,
    weightFullCombo = 150.0,
    normalize = true,
    unknownPairPenalty = 2.0,
    lowCountPenalty = 0.5,
  } = options;

  if (!currentTeam) {
    throw new Error('current_team is required');
  }

  const heroStats = battleStats.hero_stats || {};
  const heroPairStats = battleStats.hero_pair_stats || {};
  const heroCombinations = battleStats.hero_combinations || {};
  const recommendations = [];

  for (let i = 0; i < availableSets.length; i++) {
    const heroSet = availableSets[i];
    let score = 0.0;
    const analysis = {
      set_index: i,
      heroes: heroSet,
      individual_scores: {},
      individual_raw_winrates: {},
      current_team_synergy: 0.0,
      intra_set_synergy: 0.0,
      current_pairs: 0,
      intra_pairs: 0,
      unknown_current_pairs: 0,
      lowcount_current_pairs: 0,
      unknown_intra_pairs: 0,
      lowcount_intra_pairs: 0,
      synergy_total: 0.0,
      total_score: 0.0,
      current_team_pairs_detail: [],
      intra_pairs_detail: [],
      full_combos_detail: [],
    };

    // Individual hero scores
    // Use a smaller scale to better match synergy scores (which are normalized by more pairs)
    const individualScale = 50.0; // Reduced from 100.0 to better balance with synergy
    for (const hero of heroSet) {
      const heroScore = getHeroConfidenceScore(hero, heroStats, individualScale);
      analysis.individual_scores[hero] = heroScore;
      // Store raw win rate (still use 100 scale for display)
      const stats = heroStats[hero];
      if (stats) {
        const total = stats.wins + stats.losses;
        const rawWinRate = total > 0 ? (stats.wins / total) * 100 : 0;
        const wilsonForDisplay = getHeroConfidenceScore(hero, heroStats, 100.0); // Use 100 scale for display
        analysis.individual_raw_winrates[hero] = {
          raw: rawWinRate,
          wilson: wilsonForDisplay, // Display uses 100 scale
          wins: stats.wins,
          total: total,
        };
      } else {
        analysis.individual_raw_winrates[hero] = {
          raw: 0,
          wilson: 0,
          wins: 0,
          total: 0,
        };
      }
      score += heroScore;
    }
    
    // Normalize individual scores by number of heroes to match synergy normalization
    if (normalize && heroSet.length > 0) {
      score = score / heroSet.length;
    }

    // Synergy with current team
    let currentSum = 0.0;
    let currentPairs = 0;
    let unknownCurrent = 0;
    let lowcountCurrent = 0;
    for (const currentHero of currentTeam) {
      for (const newHero of heroSet) {
        const { wilson, total } = getHeroPairWilson(currentHero, newHero, heroPairStats, minGames);
        currentPairs++;
        const pairKey = [currentHero, newHero].sort().join(',');
        const pairStats = heroPairStats[pairKey];
        let pairDetail = {
          hero1: currentHero,
          hero2: newHero,
          wilson: wilson,
          total: total,
          rawWinRate: 0,
          wins: 0,
          score: 0,
          status: 'unknown',
        };
        
        if (total === 0) {
          unknownCurrent++;
          currentSum -= unknownPairPenalty;
          pairDetail.status = 'unknown';
          pairDetail.score = -unknownPairPenalty;
        } else {
          pairDetail.wins = pairStats.wins;
          pairDetail.rawWinRate = (pairStats.wins / total) * 100;
        if (total < minGames) {
          lowcountCurrent++;
          currentSum -= lowCountPenalty;
            pairDetail.status = 'low_count';
            pairDetail.score = -lowCountPenalty;
          } else if (wilson >= minWilson) {
            const pairScore = wilson * weightCurrentPair;
            currentSum += pairScore;
            pairDetail.status = 'good';
            pairDetail.score = pairScore; // Store raw contribution
          } else {
            pairDetail.status = 'below_threshold';
            pairDetail.score = 0;
          }
        }
        analysis.current_team_pairs_detail.push(pairDetail);
      }
    }
    if (normalize && currentPairs > 0) {
      currentSum /= currentPairs;
    }
    analysis.current_team_synergy = currentSum;
    analysis.current_pairs = currentPairs;
    analysis.unknown_current_pairs = unknownCurrent;
    analysis.lowcount_current_pairs = lowcountCurrent;

    // Intra-set synergy
    let intraSum = 0.0;
    let intraPairs = 0;
    let unknownIntra = 0;
    let lowcountIntra = 0;
    if (includeIntraSet) {
      const n = heroSet.length;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const h1 = heroSet[a];
          const h2 = heroSet[b];
          const { wilson, total } = getHeroPairWilson(h1, h2, heroPairStats, minGames);
          intraPairs++;
          const pairKey = [h1, h2].sort().join(',');
          const pairStats = heroPairStats[pairKey];
          let pairDetail = {
            hero1: h1,
            hero2: h2,
            wilson: wilson,
            total: total,
            rawWinRate: 0,
            wins: 0,
            score: 0,
            status: 'unknown',
          };
          
          if (total === 0) {
            unknownIntra++;
            intraSum -= unknownPairPenalty;
            pairDetail.status = 'unknown';
            pairDetail.score = -unknownPairPenalty;
          } else {
            pairDetail.wins = pairStats.wins;
            pairDetail.rawWinRate = (pairStats.wins / total) * 100;
          if (total < minGames) {
            lowcountIntra++;
            intraSum -= lowCountPenalty;
              pairDetail.status = 'low_count';
              pairDetail.score = -lowCountPenalty;
            } else if (wilson >= minWilson) {
              const pairScore = wilson * weightIntraPair;
              intraSum += pairScore;
              pairDetail.status = 'good';
              pairDetail.score = pairScore; // Store raw contribution
            } else {
              pairDetail.status = 'below_threshold';
              pairDetail.score = 0;
            }
          }
          analysis.intra_pairs_detail.push(pairDetail);
        }
      }
      if (normalize && intraPairs > 0) {
        intraSum /= intraPairs;
      }
    }
    analysis.intra_set_synergy = intraSum;
    analysis.intra_pairs = intraPairs;
    analysis.unknown_intra_pairs = unknownIntra;
    analysis.lowcount_intra_pairs = lowcountIntra;

    // Check for full 3-hero combinations in hero_combinations
    // Combine currentTeam + heroSet and check all 3-hero subsets
    const fullTeam = [...currentTeam, ...heroSet];
    const threeHeroCombos = generate3HeroCombinations(fullTeam);
    let fullComboSum = 0.0;
    let matchingCombos = 0;
    
    for (const combo of threeHeroCombos) {
      const comboKey = combo.join(',');
      const comboStats = heroCombinations[comboKey];
      if (comboStats) {
        const totalGames = comboStats.wins + comboStats.losses;
        const rawWinRate = (comboStats.wins / totalGames) * 100;
          const wilson = wilsonLowerBound(comboStats.wins, totalGames);
        const comboDetail = {
          heroes: combo,
          rawWinRate: rawWinRate,
          wilson: wilson,
          wins: comboStats.wins,
          total: totalGames,
          score: 0,
          status: 'unknown',
        };
        
        if (totalGames >= minGames) {
          if (wilson >= minWilson) {
            const comboScore = wilson * weightFullCombo;
            fullComboSum += comboScore;
            matchingCombos++;
            comboDetail.status = 'good';
            comboDetail.score = comboScore; // Store raw contribution
          } else {
            comboDetail.status = 'below_threshold';
          }
        } else {
          comboDetail.status = 'low_count';
        }
        analysis.full_combos_detail.push(comboDetail);
      }
    }
    
    // Normalize by number of matching combos if there are any
    if (normalize && matchingCombos > 0) {
      fullComboSum /= matchingCombos;
    }
    
    analysis.full_combo_synergy = fullComboSum;
    analysis.matching_combos = matchingCombos;
    analysis.total_3hero_combos_checked = threeHeroCombos.length;

    const synergyTotal = currentSum + intraSum + fullComboSum;
    analysis.synergy_total = synergyTotal;
    analysis.total_score = score + synergyTotal;
    recommendations.push(analysis);
  }

  recommendations.sort((a, b) => b.total_score - a.total_score);

  return {
    recommended_set: recommendations[0].set_index,
    analysis: recommendations,
    reasoning: generateHeroReasoning(recommendations, battleStats, currentTeam),
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
    minWilson = 0.50,
    minGames = 2,
    includeIntraSet = true,
    weightCurrentSkillPair = 100.0,
    weightIntraSkillPair = 75.0,
    weightSkillHeroPair = 80.0,
    normalize = true,
    unknownPairPenalty = 1.5,
    lowCountPenalty = 0.4,
  } = options;

  if (!currentHeroes || !currentSkills) {
    throw new Error('current_heroes and current_skills are required');
  }

  const skillStats = battleStats.skill_stats || {};
  const skillPairStats = battleStats.skill_pair_stats || {};
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
  const recommendations = [];

  for (let i = 0; i < availableSets.length; i++) {
    const skillSet = availableSets[i];
    let score = 0.0;
    const analysis = {
      set_index: i,
      skills: skillSet,
      individual_scores: {},
      individual_raw_winrates: {},
      skill_skill_synergy_current: 0.0,
      skill_skill_synergy_intra: 0.0,
      skill_hero_synergy: 0.0,
      current_skill_pairs: 0,
      intra_skill_pairs: 0,
      skill_hero_pairs: 0,
      unknown_current_skill_pairs: 0,
      lowcount_current_skill_pairs: 0,
      unknown_intra_skill_pairs: 0,
      lowcount_intra_skill_pairs: 0,
      unknown_skill_hero_pairs: 0,
      lowcount_skill_hero_pairs: 0,
      synergy_total: 0.0,
      total_score: 0.0,
      current_skill_pairs_detail: [],
      intra_skill_pairs_detail: [],
      skill_hero_pairs_detail: [],
    };

    // Individual skill scores
    // Use a smaller scale to better match synergy scores (which are normalized by more pairs)
    const individualScale = 50.0; // Reduced from 100.0 to better balance with synergy
    for (const skill of skillSet) {
      const skillScore = getSkillConfidenceScore(skill, skillStats, individualScale);
      analysis.individual_scores[skill] = skillScore;
      // Store raw win rate
      const stats = skillStats[skill];
      if (stats) {
        const total = stats.wins + stats.losses;
        const rawWinRate = total > 0 ? (stats.wins / total) * 100 : 0;
        const wilsonForDisplay = getSkillConfidenceScore(skill, skillStats, 100.0); // Use 100 scale for display
        analysis.individual_raw_winrates[skill] = {
          raw: rawWinRate,
          wilson: wilsonForDisplay, // Display uses 100 scale
          wins: stats.wins,
          total: total,
        };
      } else {
        analysis.individual_raw_winrates[skill] = {
          raw: 0,
          wilson: 0,
          wins: 0,
          total: 0,
        };
      }
      score += skillScore;
    }
    
    // Normalize individual scores by number of skills to match synergy normalization
    if (normalize && skillSet.length > 0) {
      score = score / skillSet.length;
    }

    // Skill-skill synergy with current skills
    let curSum = 0.0;
    let curPairs = 0;
    let unknownCur = 0;
    let lowcountCur = 0;
    for (const curSkill of currentSkills) {
      for (const newSkill of skillSet) {
        const { wilson, total } = getSkillPairWilson(curSkill, newSkill, skillPairStats, minGames);
        curPairs++;
        const pairKey = [curSkill, newSkill].sort().join(',');
        const pairStats = skillPairStats[pairKey];
        let pairDetail = {
          skill1: curSkill,
          skill2: newSkill,
          wilson: wilson,
          total: total,
          rawWinRate: 0,
          wins: 0,
          score: 0,
          status: 'unknown',
        };
        
        if (total === 0) {
          unknownCur++;
          curSum -= unknownPairPenalty;
          pairDetail.status = 'unknown';
          pairDetail.score = -unknownPairPenalty;
        } else {
          pairDetail.wins = pairStats.wins;
          pairDetail.rawWinRate = (pairStats.wins / total) * 100;
          if (total < minGames) {
            lowcountCur++;
            curSum -= lowCountPenalty;
            pairDetail.status = 'low_count';
            pairDetail.score = -lowCountPenalty;
          } else if (wilson >= minWilson) {
            const pairScore = wilson * weightCurrentSkillPair;
            curSum += pairScore;
            pairDetail.status = 'good';
            pairDetail.score = pairScore; // Store raw contribution
          } else {
            pairDetail.status = 'below_threshold';
            pairDetail.score = 0;
          }
        }
        analysis.current_skill_pairs_detail.push(pairDetail);
      }
    }
    if (normalize && curPairs > 0) {
      curSum /= curPairs;
    }
    analysis.skill_skill_synergy_current = curSum;
    analysis.current_skill_pairs = curPairs;
    analysis.unknown_current_skill_pairs = unknownCur;
    analysis.lowcount_current_skill_pairs = lowcountCur;

    // Intra-set skill-skill synergy
    let intraSum = 0.0;
    let intraPairs = 0;
    let unknownIntra = 0;
    let lowcountIntra = 0;
    if (includeIntraSet) {
      const n = skillSet.length;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const s1 = skillSet[a];
          const s2 = skillSet[b];
          const { wilson, total } = getSkillPairWilson(s1, s2, skillPairStats, minGames);
          intraPairs++;
          const pairKey = [s1, s2].sort().join(',');
          const pairStats = skillPairStats[pairKey];
          let pairDetail = {
            skill1: s1,
            skill2: s2,
            wilson: wilson,
            total: total,
            rawWinRate: 0,
            wins: 0,
            score: 0,
            status: 'unknown',
          };
          
          if (total === 0) {
            unknownIntra++;
            intraSum -= unknownPairPenalty;
            pairDetail.status = 'unknown';
            pairDetail.score = -unknownPairPenalty;
          } else {
            pairDetail.wins = pairStats.wins;
            pairDetail.rawWinRate = (pairStats.wins / total) * 100;
            if (total < minGames) {
              lowcountIntra++;
              intraSum -= lowCountPenalty;
              pairDetail.status = 'low_count';
              pairDetail.score = -lowCountPenalty;
            } else if (wilson >= minWilson) {
              const pairScore = wilson * weightIntraSkillPair;
              intraSum += pairScore;
              pairDetail.status = 'good';
              pairDetail.score = pairScore; // Store raw contribution
            } else {
              pairDetail.status = 'below_threshold';
              pairDetail.score = 0;
            }
          }
          analysis.intra_skill_pairs_detail.push(pairDetail);
        }
      }
      if (normalize && intraPairs > 0) {
        intraSum /= intraPairs;
      }
    }
    analysis.skill_skill_synergy_intra = intraSum;
    analysis.intra_skill_pairs = intraPairs;
    analysis.unknown_intra_skill_pairs = unknownIntra;
    analysis.lowcount_intra_skill_pairs = lowcountIntra;

    // Cross synergy: candidate skills with current team heroes
    let crossSum = 0.0;
    let crossPairs = 0;
    let unknownCross = 0;
    let lowcountCross = 0;
    for (const hero of currentHeroes) {
      for (const skill of skillSet) {
        const { wilson, total } = getSkillHeroPairWilson(hero, skill, skillHeroPairStats, minGames);
        crossPairs++;
        const pairKey = `${hero},${skill}`;
        const pairStats = skillHeroPairStats[pairKey];
        let pairDetail = {
          hero: hero,
          skill: skill,
          wilson: wilson,
          total: total,
          rawWinRate: 0,
          wins: 0,
          score: 0,
          status: 'unknown',
        };
        
        if (total === 0) {
          unknownCross++;
          crossSum -= unknownPairPenalty;
          pairDetail.status = 'unknown';
          pairDetail.score = -unknownPairPenalty;
        } else {
          pairDetail.wins = pairStats.wins;
          pairDetail.rawWinRate = (pairStats.wins / total) * 100;
          if (total < minGames) {
            lowcountCross++;
            crossSum -= lowCountPenalty;
            pairDetail.status = 'low_count';
            pairDetail.score = -lowCountPenalty;
          } else if (wilson >= minWilson) {
            const pairScore = wilson * weightSkillHeroPair;
            crossSum += pairScore;
            pairDetail.status = 'good';
            pairDetail.score = pairScore; // Store raw contribution
          } else {
            pairDetail.status = 'below_threshold';
            pairDetail.score = 0;
          }
        }
        analysis.skill_hero_pairs_detail.push(pairDetail);
      }
    }
    if (normalize && crossPairs > 0) {
      crossSum /= crossPairs;
    }
    analysis.skill_hero_synergy = crossSum;
    analysis.skill_hero_pairs = crossPairs;
    analysis.unknown_skill_hero_pairs = unknownCross;
    analysis.lowcount_skill_hero_pairs = lowcountCross;

    const synergyTotal = curSum + intraSum + crossSum;
    analysis.synergy_total = synergyTotal;
    analysis.total_score = score + synergyTotal;
    recommendations.push(analysis);
  }

  recommendations.sort((a, b) => b.total_score - a.total_score);

  return {
    recommended_set: recommendations[0].set_index,
    analysis: recommendations,
    reasoning: generateSkillReasoning(recommendations, battleStats, currentHeroes, currentSkills),
  };
}

/**
 * Generate human-readable reasoning for hero recommendation
 */
function generateHeroReasoning(allAnalyses, battleStats, currentTeam) {
  // If single analysis passed (backward compatibility)
  const analyses = Array.isArray(allAnalyses) ? allAnalyses : [allAnalyses];
  const topAnalysis = analyses[0];
  
  if (!topAnalysis || !topAnalysis.individual_scores || Object.keys(topAnalysis.individual_scores).length === 0) {
    return {
      type: 'simple',
      text: `Recommended set with total score: ${topAnalysis?.total_score?.toFixed(1) || 0}`,
    };
  }
  const sections = [];
  
  // Section 1: Overview
  sections.push({
    title: 'Recommendation Overview',
        content: [
          {
            type: 'text',
        text: `Analyzed ${analyses.length} available hero sets. The top recommendation scored `,
          },
          {
            type: 'bold',
        text: `${topAnalysis.total_score.toFixed(1)} points`,
          },
          {
            type: 'text',
        text: ` based on individual hero performance and team synergy analysis.`,
      },
    ],
  });

  // Section 2: Individual Hero Win Rates for All Sets
  const individualHeroSection = {
    title: '1. Individual Hero Win Rates',
    content: [],
  };
  
  analyses.forEach((analysis, setIdx) => {
    const individualScores = Object.values(analysis.individual_scores || {});
    const avgIndividualScore = individualScores.length > 0 
      ? individualScores.reduce((sum, s) => sum + s, 0) / individualScores.length
      : 0;
    individualHeroSection.content.push({
      type: 'text',
      text: `\nSet ${setIdx + 1} (Average Individual Score: ${avgIndividualScore.toFixed(1)} points):`,
    });
    
    const heroDetails = [];
    for (const hero of analysis.heroes || []) {
      const heroData = analysis.individual_raw_winrates?.[hero] || {
        raw: 0,
        wilson: analysis.individual_scores?.[hero] || 0,
        wins: 0,
        total: 0,
      };
      heroDetails.push({
        label: hero,
        value: `${heroData.raw.toFixed(1)}%`,
        unit: `win rate → ${heroData.wilson.toFixed(1)}% confidence-adjusted`,
        detail: `${heroData.wins} Wins / ${heroData.total} Games`,
      });
    }
    
    if (heroDetails.length > 0) {
      individualHeroSection.content.push({
        type: 'list',
        items: heroDetails,
      });
    }
  });
  
  sections.push(individualHeroSection);

  // Section 3: Synergy with Current Team for All Sets
  const currentTeamSynergySection = {
    title: '2. Synergy with Current Team',
    content: [],
  };
  
  const currentTeamSynergyItems = analyses.map((analysis, setIdx) => ({
    label: `Set ${setIdx + 1}`,
    value: (analysis.current_team_synergy || 0).toFixed(1),
    unit: 'points',
  }));
  
  currentTeamSynergySection.content.push({
    type: 'list',
    items: currentTeamSynergyItems,
  });
  
  sections.push(currentTeamSynergySection);

  // Section 4: Intra-Set Synergy for All Sets
  const intraSynergySection = {
    title: '3. Intra-Set Synergy',
    content: [],
  };
  
  const intraSynergyItems = analyses.map((analysis, setIdx) => ({
    label: `Set ${setIdx + 1}`,
    value: (analysis.intra_set_synergy || 0).toFixed(1),
    unit: 'points',
  }));
  
  intraSynergySection.content.push({
    type: 'list',
    items: intraSynergyItems,
  });
  
  sections.push(intraSynergySection);

  // Section 5: Full 3-Hero Combination Bonuses for All Sets
  const fullComboSection = {
    title: '4. Full 3-Hero Combination Bonuses',
    content: [],
  };
  
  const fullComboItems = analyses.map((analysis, setIdx) => ({
    label: `Set ${setIdx + 1}`,
    value: (analysis.full_combo_synergy || 0).toFixed(1),
    unit: 'points',
    detail: `Found ${analysis.matching_combos || 0} matching combinations`,
  }));
  
  fullComboSection.content.push({
    type: 'list',
    items: fullComboItems,
  });
  
  sections.push(fullComboSection);

  // Section 6: Final Scores Summary
  const summarySection = {
    title: 'Final Scores Summary',
        content: [
          {
        type: 'text',
        text: 'Complete score breakdown for all sets:',
              },
    ],
  };
  
  const summaryItems = analyses.map((analysis, idx) => {
    const individualScores = Object.values(analysis.individual_scores || {});
    const avgIndividualScore = individualScores.length > 0 
      ? individualScores.reduce((sum, s) => sum + s, 0) / individualScores.length
      : 0;
    return {
      label: `Set ${idx + 1}${idx === 0 ? ' (Recommended)' : ''}`,
      value: analysis.total_score.toFixed(1),
      unit: 'points',
      detail: `Individual: ${avgIndividualScore.toFixed(1)}, Synergy: ${(analysis.synergy_total || 0).toFixed(1)}`,
      highlight: idx === 0,
    };
  });
  
  summarySection.content.push({
    type: 'list',
    items: summaryItems,
  });
  
  sections.push(summarySection);

  return {
    type: 'detailed',
    sections: sections,
  };
}

/**
 * Generate human-readable reasoning for skill recommendation
 */
function generateSkillReasoning(allAnalyses, battleStats, currentHeroes, currentSkills) {
  // If single analysis passed (backward compatibility)
  const analyses = Array.isArray(allAnalyses) ? allAnalyses : [allAnalyses];
  const topAnalysis = analyses[0];
  
  if (!topAnalysis || !topAnalysis.individual_scores || Object.keys(topAnalysis.individual_scores).length === 0) {
    return {
      type: 'simple',
      text: `Recommended set with total score: ${topAnalysis?.total_score?.toFixed(1) || 0}`,
    };
  }
  
  const sections = [];
  
  // Section 1: Overview
  sections.push({
    title: 'Recommendation Overview',
    content: [
      {
        type: 'text',
        text: `Analyzed ${analyses.length} available skill sets. The top recommendation scored `,
      },
      {
        type: 'bold',
        text: `${topAnalysis.total_score.toFixed(1)} points`,
      },
      {
        type: 'text',
        text: ` based on individual skill performance and team synergy analysis.`,
      },
    ],
  });

  // Section 2: Individual Skill Win Rates for All Sets
  const individualSkillSection = {
    title: '1. Individual Skill Win Rates',
    content: [],
  };
  
  analyses.forEach((analysis, setIdx) => {
    const individualScores = Object.values(analysis.individual_scores || {});
    const avgIndividualScore = individualScores.length > 0 
      ? individualScores.reduce((sum, s) => sum + s, 0) / individualScores.length
      : 0;
    individualSkillSection.content.push({
      type: 'text',
      text: `\nSet ${setIdx + 1} (Average Individual Score: ${avgIndividualScore.toFixed(1)} points):`,
    });
    
    const skillDetails = [];
    for (const skill of analysis.skills || []) {
      const skillData = analysis.individual_raw_winrates?.[skill] || {
        raw: 0,
        wilson: analysis.individual_scores?.[skill] || 0,
        wins: 0,
        total: 0,
      };
      skillDetails.push({
        label: skill,
        value: `${skillData.raw.toFixed(1)}%`,
        unit: `win rate → ${skillData.wilson.toFixed(1)}% confidence-adjusted`,
        detail: `${skillData.wins} Wins / ${skillData.total} Games`,
      });
    }
    
    if (skillDetails.length > 0) {
      individualSkillSection.content.push({
        type: 'list',
        items: skillDetails,
      });
    }
  });
  
  sections.push(individualSkillSection);

  // Section 3: Skill-Skill Synergy with Current Skills
  const currentSkillSynergySection = {
    title: '2. Synergy with Current Skills',
    content: [],
  };
  
  const currentSkillSynergyItems = analyses.map((analysis, setIdx) => ({
    label: `Set ${setIdx + 1}`,
    value: (analysis.skill_skill_synergy_current || 0).toFixed(1),
    unit: 'points',
  }));
  
  currentSkillSynergySection.content.push({
    type: 'list',
    items: currentSkillSynergyItems,
  });
  
  sections.push(currentSkillSynergySection);

  // Section 4: Intra-Set Skill-Skill Synergy
  const intraSkillSynergySection = {
    title: '3. Intra-Set Skill-Skill Synergy',
    content: [],
  };
  
  const intraSkillSynergyItems = analyses.map((analysis, setIdx) => ({
    label: `Set ${setIdx + 1}`,
    value: (analysis.skill_skill_synergy_intra || 0).toFixed(1),
    unit: 'points',
  }));
  
  intraSkillSynergySection.content.push({
    type: 'list',
    items: intraSkillSynergyItems,
  });
  
  sections.push(intraSkillSynergySection);

  // Section 5: Cross Synergy with Current Heroes
  const crossSynergySection = {
    title: '4. Synergy with Current Heroes',
    content: [],
  };
  
  const crossSynergyItems = analyses.map((analysis, setIdx) => ({
    label: `Set ${setIdx + 1}`,
    value: (analysis.skill_hero_synergy || 0).toFixed(1),
    unit: 'points',
  }));
  
  crossSynergySection.content.push({
    type: 'list',
    items: crossSynergyItems,
  });
  
  sections.push(crossSynergySection);

  // Section 6: Final Scores Summary
  const summarySection = {
    title: 'Final Scores Summary',
    content: [
      {
        type: 'text',
        text: 'Complete score breakdown for all sets:',
      },
    ],
  };
  
  const summaryItems = analyses.map((analysis, idx) => {
    const individualScores = Object.values(analysis.individual_scores || {});
    const avgIndividualScore = individualScores.length > 0 
      ? individualScores.reduce((sum, s) => sum + s, 0) / individualScores.length
      : 0;
    return {
      label: `Set ${idx + 1}${idx === 0 ? ' (Recommended)' : ''}`,
      value: analysis.total_score.toFixed(1),
      unit: 'points',
      detail: `Individual: ${avgIndividualScore.toFixed(1)}, Synergy: ${(analysis.synergy_total || 0).toFixed(1)}`,
      highlight: idx === 0,
    };
  });
  
  summarySection.content.push({
    type: 'list',
    items: summaryItems,
  });
  
  sections.push(summarySection);

  return {
    type: 'detailed',
    sections: sections,
  };
}

/**
 * Get top heroes by performance
 */
export function getTopHeroes(battleStats, limit = 20, minGames = 1, useWilson = true) {
  const heroStats = battleStats.hero_stats || {};
  const rankings = [];

  for (const [hero, stats] of Object.entries(heroStats)) {
    const games = stats.total;
    const totalWl = stats.wins + stats.losses;
    if (games < minGames || totalWl <= 0) continue;
    const raw = games > 0 ? stats.wins / games : 0.0;
    const score = useWilson ? wilsonLowerBound(stats.wins, totalWl) : raw;
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
export function getTopSkills(battleStats, database, limit = 30, minGames = 1, useWilson = true) {
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
    const score = useWilson ? wilsonLowerBound(stats.wins, totalWl) : raw;
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

