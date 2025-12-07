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
    weightCurrentPair = 20.0,
    weightIntraPair = 15.0,
    weightFullCombo = 30.0,
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
    };

    // Individual hero scores
    for (const hero of heroSet) {
      const heroScore = getHeroConfidenceScore(hero, heroStats);
      analysis.individual_scores[hero] = heroScore;
      score += heroScore;
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
        if (total === 0) {
          unknownCurrent++;
          currentSum -= unknownPairPenalty;
          continue;
        }
        if (total < minGames) {
          lowcountCurrent++;
          currentSum -= lowCountPenalty;
          continue;
        }
        if (wilson >= minWilson) {
          currentSum += wilson * weightCurrentPair;
        }
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
          if (total === 0) {
            unknownIntra++;
            intraSum -= unknownPairPenalty;
            continue;
          }
          if (total < minGames) {
            lowcountIntra++;
            intraSum -= lowCountPenalty;
            continue;
          }
          if (wilson >= minWilson) {
            intraSum += wilson * weightIntraPair;
          }
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
        if (totalGames >= minGames) {
          // Use Wilson lower bound for confidence, similar to pairwise stats
          const wilson = wilsonLowerBound(comboStats.wins, totalGames);
          if (wilson >= minWilson) {
            fullComboSum += wilson * weightFullCombo;
            matchingCombos++;
          }
        }
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
    reasoning: generateHeroReasoning(recommendations[0]),
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
    weightCurrentSkillPair = 15.0,
    weightIntraSkillPair = 12.0,
    weightSkillHeroPair = 8.0,
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
    };

    // Individual skill scores
    for (const skill of skillSet) {
      const skillScore = getSkillConfidenceScore(skill, skillStats);
      analysis.individual_scores[skill] = skillScore;
      score += skillScore;
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
        if (total === 0) {
          unknownCur++;
          curSum -= unknownPairPenalty;
          continue;
        }
        if (total < minGames) {
          lowcountCur++;
          curSum -= lowCountPenalty;
          continue;
        }
        if (wilson >= minWilson) {
          curSum += wilson * weightCurrentSkillPair;
        }
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
          if (total === 0) {
            unknownIntra++;
            intraSum -= unknownPairPenalty;
            continue;
          }
          if (total < minGames) {
            lowcountIntra++;
            intraSum -= lowCountPenalty;
            continue;
          }
          if (wilson >= minWilson) {
            intraSum += wilson * weightIntraSkillPair;
          }
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
        if (total === 0) {
          unknownCross++;
          crossSum -= unknownPairPenalty;
          continue;
        }
        if (total < minGames) {
          lowcountCross++;
          crossSum -= lowCountPenalty;
          continue;
        }
        if (wilson >= minWilson) {
          crossSum += wilson * weightSkillHeroPair;
        }
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
    reasoning: generateSkillReasoning(recommendations[0]),
  };
}

/**
 * Generate human-readable reasoning for hero recommendation
 */
function generateHeroReasoning(analysis) {
  const scores = analysis.individual_scores;

  if (!scores || Object.keys(scores).length === 0) {
    return {
      type: 'simple',
      text: `Recommended set with total score: ${analysis.total_score.toFixed(1)}`,
    };
  }

  // Find best and average hero scores
  const heroNames = Object.keys(scores);
  const heroScores = Object.values(scores);
  const bestHero = heroNames.reduce((a, b) => (scores[a] > scores[b] ? a : b));
  const bestScore = scores[bestHero];
  const avgScore = heroScores.reduce((sum, s) => sum + s, 0) / heroScores.length;
  const minScore = Math.min(...heroScores);

  const synergyTotal = analysis.synergy_total || 0.0;
  const currentSynergy = analysis.current_team_synergy || 0.0;
  const intraSynergy = analysis.intra_set_synergy || 0.0;
  const fullComboSynergy = analysis.full_combo_synergy || 0.0;
  const matchingCombos = analysis.matching_combos || 0;
  const individualTotal = heroScores.reduce((sum, s) => sum + s, 0);

  const synergyItems = [];
  if (currentSynergy !== 0) {
    const currentPairs = analysis.current_pairs || 0;
    synergyItems.push({
      label: 'Pairwise synergy with existing team',
      value: currentSynergy.toFixed(1),
      unit: 'points',
      detail: `from ${currentPairs} hero pairs`,
    });
  }
  if (intraSynergy !== 0) {
    const intraPairs = analysis.intra_pairs || 0;
    synergyItems.push({
      label: 'Internal synergy within this set',
      value: intraSynergy.toFixed(1),
      unit: 'points',
      detail: `from ${intraPairs} pairs`,
    });
  }
  if (fullComboSynergy !== 0) {
    synergyItems.push({
      label: 'Full 3-hero combination bonuses',
      value: fullComboSynergy.toFixed(1),
      unit: 'points',
      detail: `from ${matchingCombos} known winning combinations`,
    });
  }

  return {
    type: 'detailed',
    sections: [
      {
        title: 'Analysis Overview',
        content: [
          {
            type: 'text',
            text: `This hero set is recommended based on comprehensive analysis of `,
          },
          {
            type: 'bold',
            text: `${analysis.total_3hero_combos_checked || 0}`,
          },
          {
            type: 'text',
            text: ` possible team combinations.`,
          },
        ],
      },
      {
        title: 'Individual Hero Performance',
        content: [
          {
            type: 'text',
            text: `The set includes `,
          },
          {
            type: 'bold',
            text: bestHero,
          },
          {
            type: 'text',
            text: ` (top performer with `,
          },
          {
            type: 'bold',
            text: `${bestScore.toFixed(1)}%`,
          },
          {
            type: 'text',
            text: ` confidence-adjusted win rate).`,
          },
          ...(heroScores.length > 1 ? [
            {
              type: 'text',
              text: ` Average individual hero score: `,
            },
            {
              type: 'bold',
              text: `${avgScore.toFixed(1)}%`,
            },
            {
              type: 'text',
              text: ` (range: ${minScore.toFixed(1)}% - ${bestScore.toFixed(1)}%).`,
            },
          ] : []),
        ],
      },
      {
        title: 'Team Synergy Analysis',
        content: synergyTotal !== 0 ? [
          {
            type: 'text',
            text: `Team synergy contributes `,
          },
          {
            type: 'bold',
            text: `${synergyTotal.toFixed(1)} points`,
          },
          {
            type: 'text',
            text: `:`,
          },
          {
            type: 'list',
            items: synergyItems,
          },
        ] : [
          {
            type: 'text',
            text: `Limited synergy data available (${analysis.unknown_current_pairs || 0} unknown pairs, ${analysis.lowcount_current_pairs || 0} low-confidence pairs).`,
          },
        ],
      },
      {
        title: 'Final Score Breakdown',
        content: [
          {
            type: 'list',
            items: [
              {
                label: 'Combined individual performance',
                value: individualTotal.toFixed(1),
                unit: 'points',
              },
              {
                label: 'Total synergy contribution',
                value: synergyTotal.toFixed(1),
                unit: 'points',
              },
              {
                label: 'Final recommendation score',
                value: analysis.total_score.toFixed(1),
                unit: 'points',
                highlight: true,
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Generate human-readable reasoning for skill recommendation
 */
function generateSkillReasoning(analysis) {
  const scores = analysis.individual_scores;

  if (!scores || Object.keys(scores).length === 0) {
    return {
      type: 'simple',
      text: `Recommended set with total score: ${analysis.total_score.toFixed(1)}`,
    };
  }

  // Find best and average skill scores
  const skillNames = Object.keys(scores);
  const skillScores = Object.values(scores);
  const bestSkill = skillNames.reduce((a, b) => (scores[a] > scores[b] ? a : b));
  const bestScore = scores[bestSkill];
  const avgScore = skillScores.reduce((sum, s) => sum + s, 0) / skillScores.length;
  const minScore = Math.min(...skillScores);

  const synergyTotal = analysis.synergy_total || 0.0;
  const cur = analysis.skill_skill_synergy_current || 0.0;
  const intra = analysis.skill_skill_synergy_intra || 0.0;
  const cross = analysis.skill_hero_synergy || 0.0;
  const individualTotal = skillScores.reduce((sum, s) => sum + s, 0);

  const synergyItems = [];
  if (cur !== 0) {
    const curPairs = analysis.current_skill_pairs || 0;
    synergyItems.push({
      label: 'Synergy with existing skills',
      value: cur.toFixed(1),
      unit: 'points',
      detail: `from ${curPairs} skill pairs`,
    });
  }
  if (intra !== 0) {
    const intraPairs = analysis.intra_skill_pairs || 0;
    synergyItems.push({
      label: 'Internal synergy within this set',
      value: intra.toFixed(1),
      unit: 'points',
      detail: `from ${intraPairs} pairs`,
    });
  }
  if (cross !== 0) {
    const crossPairs = analysis.skill_hero_pairs || 0;
    synergyItems.push({
      label: 'Synergy with current heroes',
      value: cross.toFixed(1),
      unit: 'points',
      detail: `from ${crossPairs} skill-hero pairs`,
    });
  }

  const unknownCur = analysis.unknown_current_skill_pairs || 0;
  const unknownIntra = analysis.unknown_intra_skill_pairs || 0;
  const unknownCross = analysis.unknown_skill_hero_pairs || 0;

  return {
    type: 'detailed',
    sections: [
      {
        title: 'Analysis Overview',
        content: [
          {
            type: 'text',
            text: `This skill set is recommended based on comprehensive synergy analysis.`,
          },
        ],
      },
      {
        title: 'Individual Skill Performance',
        content: [
          {
            type: 'text',
            text: `The set includes `,
          },
          {
            type: 'bold',
            text: bestSkill,
          },
          {
            type: 'text',
            text: ` (top performer with `,
          },
          {
            type: 'bold',
            text: `${bestScore.toFixed(1)}%`,
          },
          {
            type: 'text',
            text: ` confidence-adjusted win rate).`,
          },
          ...(skillScores.length > 1 ? [
            {
              type: 'text',
              text: ` Average individual skill score: `,
            },
            {
              type: 'bold',
              text: `${avgScore.toFixed(1)}%`,
            },
            {
              type: 'text',
              text: ` (range: ${minScore.toFixed(1)}% - ${bestScore.toFixed(1)}%).`,
            },
          ] : []),
        ],
      },
      {
        title: 'Skill Synergy Analysis',
        content: synergyTotal !== 0 ? [
          {
            type: 'text',
            text: `Skill synergy contributes `,
          },
          {
            type: 'bold',
            text: `${synergyTotal.toFixed(1)} points`,
          },
          {
            type: 'text',
            text: `:`,
          },
          {
            type: 'list',
            items: synergyItems,
          },
        ] : [
          {
            type: 'text',
            text: `Limited synergy data available (${unknownCur + unknownIntra + unknownCross} unknown pairs).`,
          },
        ],
      },
      {
        title: 'Final Score Breakdown',
        content: [
          {
            type: 'list',
            items: [
              {
                label: 'Combined individual performance',
                value: individualTotal.toFixed(1),
                unit: 'points',
              },
              {
                label: 'Total synergy contribution',
                value: synergyTotal.toFixed(1),
                unit: 'points',
              },
              {
                label: 'Final recommendation score',
                value: analysis.total_score.toFixed(1),
                unit: 'points',
                highlight: true,
              },
            ],
          },
        ],
      },
    ],
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

