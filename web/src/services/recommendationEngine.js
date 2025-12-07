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

  // Helper function to describe score quality
  const getScoreDescription = (score) => {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'very good';
    if (score >= 40) return 'good';
    if (score >= 20) return 'decent';
    return 'below average';
  };

  const synergyItems = [];
  if (currentSynergy !== 0) {
    const currentPairs = analysis.current_pairs || 0;
    const unknownPairs = analysis.unknown_current_pairs || 0;
    const lowCountPairs = analysis.lowcount_current_pairs || 0;
    let detail = `analyzed ${currentPairs} hero pair combinations`;
    if (unknownPairs > 0 || lowCountPairs > 0) {
      const issues = [];
      if (unknownPairs > 0) issues.push(`${unknownPairs} with no historical data`);
      if (lowCountPairs > 0) issues.push(`${lowCountPairs} with limited data`);
      detail += ` (${issues.join(', ')})`;
    }
    synergyItems.push({
      label: 'How well these heroes work with your current team',
      value: currentSynergy.toFixed(1),
      unit: 'points',
      detail: detail,
      explanation: currentSynergy > 0 
        ? 'These heroes have a proven track record of winning when paired with your current team members.'
        : 'Limited historical data on how these heroes perform together with your current team.',
    });
  }
  if (intraSynergy !== 0) {
    const intraPairs = analysis.intra_pairs || 0;
    const unknownPairs = analysis.unknown_intra_pairs || 0;
    const lowCountPairs = analysis.lowcount_intra_pairs || 0;
    let detail = `analyzed ${intraPairs} pairs within this set`;
    if (unknownPairs > 0 || lowCountPairs > 0) {
      const issues = [];
      if (unknownPairs > 0) issues.push(`${unknownPairs} with no historical data`);
      if (lowCountPairs > 0) issues.push(`${lowCountPairs} with limited data`);
      detail += ` (${issues.join(', ')})`;
    }
    synergyItems.push({
      label: 'How well these heroes work together as a set',
      value: intraSynergy.toFixed(1),
      unit: 'points',
      detail: detail,
      explanation: intraSynergy > 0
        ? 'These heroes complement each other well based on past battle results.'
        : 'Limited data on how these heroes perform together as a group.',
    });
  }
  if (fullComboSynergy !== 0) {
    synergyItems.push({
      label: 'Bonus for proven 3-hero winning combinations',
      value: fullComboSynergy.toFixed(1),
      unit: 'points',
      detail: `found ${matchingCombos} known successful 3-hero team combinations`,
      explanation: 'This set creates powerful 3-hero combinations that have consistently won battles in the past.',
    });
  }

  return {
    type: 'detailed',
    sections: [
      {
        title: 'Why This Set Was Recommended',
        content: [
          {
            type: 'text',
            text: `This hero set scored highest out of all available options. The recommendation is based on analyzing `,
          },
          {
            type: 'bold',
            text: `${analysis.total_3hero_combos_checked || 0}`,
          },
          {
            type: 'text',
            text: ` possible team combinations using historical battle data. The system looks at both individual hero performance and how well heroes work together.`,
          },
        ],
      },
      {
        title: 'Individual Hero Performance',
        content: [
          {
            type: 'text',
            text: `Each hero's score is based on their historical win rate, adjusted for how many battles they've been in (more battles = more reliable data). The set includes `,
          },
          {
            type: 'bold',
            text: bestHero,
          },
          {
            type: 'text',
            text: `, who has the strongest individual performance with a `,
          },
          {
            type: 'bold',
            text: `${getScoreDescription(bestScore)}`,
          },
          {
            type: 'text',
            text: ` win rate of `,
          },
          {
            type: 'bold',
            text: `${bestScore.toFixed(1)}%`,
          },
          {
            type: 'text',
            text: `.`,
          },
          ...(heroScores.length > 1 ? [
            {
              type: 'text',
              text: ` The average performance across all heroes in this set is `,
            },
            {
              type: 'bold',
              text: `${avgScore.toFixed(1)}%`,
            },
            {
              type: 'text',
              text: ` (ranging from ${minScore.toFixed(1)}% to ${bestScore.toFixed(1)}%).`,
            },
          ] : []),
          {
            type: 'text',
            text: ` Combined, these heroes contribute `,
          },
          {
            type: 'bold',
            text: `${individualTotal.toFixed(1)} points`,
          },
          {
            type: 'text',
            text: ` to the total score based on their individual strengths.`,
          },
        ],
      },
      {
        title: 'How the Score is Calculated',
        content: [
          {
            type: 'text',
            text: `The final score has two main parts:`,
          },
          {
            type: 'list',
            items: [
              {
                label: 'Individual Performance',
                value: individualTotal.toFixed(1),
                unit: 'points',
                explanation: `Sum of each hero's win rate score (${heroNames.length} heroes × their individual scores)`,
              },
              {
                label: 'Team Synergy Bonus',
                value: synergyTotal.toFixed(1),
                unit: 'points',
                explanation: 'Points added for how well heroes work together (see details below)',
              },
            ],
          },
          {
            type: 'text',
            text: `\nFinal Score = Individual Performance + Team Synergy = `,
          },
          {
            type: 'bold',
            text: `${individualTotal.toFixed(1)} + ${synergyTotal.toFixed(1)} = ${analysis.total_score.toFixed(1)} points`,
          },
        ],
      },
      {
        title: 'Team Synergy Breakdown',
        content: synergyTotal !== 0 ? [
          {
            type: 'text',
            text: `Team synergy adds `,
          },
          {
            type: 'bold',
            text: `${synergyTotal.toFixed(1)} points`,
          },
          {
            type: 'text',
            text: ` to the score. This measures how well heroes work together based on past battles:`,
          },
          {
            type: 'list',
            items: synergyItems,
          },
          {
            type: 'text',
            text: `\nThe synergy score rewards proven hero combinations and penalizes pairs with no historical data or very limited battle history.`,
          },
        ] : [
          {
            type: 'text',
            text: `Limited synergy data is available for this combination. The system found `,
          },
          {
            type: 'bold',
            text: `${analysis.unknown_current_pairs || 0} hero pairs`,
          },
          {
            type: 'text',
            text: ` with no historical battle data and `,
          },
          {
            type: 'bold',
            text: `${analysis.lowcount_current_pairs || 0} pairs`,
          },
          {
            type: 'text',
            text: ` with very limited data. This means the recommendation is based primarily on individual hero performance rather than proven team combinations.`,
          },
        ],
      },
      {
        title: 'Final Recommendation Score',
        content: [
          {
            type: 'text',
            text: `This set received a total score of `,
          },
          {
            type: 'bold',
            text: `${analysis.total_score.toFixed(1)} points`,
          },
          {
            type: 'text',
            text: `, which is `,
          },
          {
            type: 'bold',
            text: getScoreDescription(analysis.total_score),
          },
          {
            type: 'text',
            text: `. This score combines:`,
          },
          {
            type: 'list',
            items: [
              {
                label: 'Individual hero strengths',
                value: individualTotal.toFixed(1),
                unit: 'points',
                explanation: 'How well each hero performs on their own',
              },
              {
                label: 'Team synergy bonuses',
                value: synergyTotal.toFixed(1),
                unit: 'points',
                explanation: 'How well heroes work together based on past battles',
              },
              {
                label: 'Total recommendation score',
                value: analysis.total_score.toFixed(1),
                unit: 'points',
                highlight: true,
                explanation: 'The higher the score, the better the recommendation',
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

  // Helper function to describe score quality
  const getScoreDescription = (score) => {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'very good';
    if (score >= 40) return 'good';
    if (score >= 20) return 'decent';
    return 'below average';
  };

  const synergyItems = [];
  if (cur !== 0) {
    const curPairs = analysis.current_skill_pairs || 0;
    const unknownPairs = analysis.unknown_current_skill_pairs || 0;
    const lowCountPairs = analysis.lowcount_current_skill_pairs || 0;
    let detail = `analyzed ${curPairs} skill pair combinations`;
    if (unknownPairs > 0 || lowCountPairs > 0) {
      const issues = [];
      if (unknownPairs > 0) issues.push(`${unknownPairs} with no historical data`);
      if (lowCountPairs > 0) issues.push(`${lowCountPairs} with limited data`);
      detail += ` (${issues.join(', ')})`;
    }
    synergyItems.push({
      label: 'How well these skills work with your current skills',
      value: cur.toFixed(1),
      unit: 'points',
      detail: detail,
      explanation: cur > 0
        ? 'These skills have a proven track record of winning when used together with your current skills.'
        : 'Limited historical data on how these skills perform together with your current skills.',
    });
  }
  if (intra !== 0) {
    const intraPairs = analysis.intra_skill_pairs || 0;
    const unknownPairs = analysis.unknown_intra_skill_pairs || 0;
    const lowCountPairs = analysis.lowcount_intra_skill_pairs || 0;
    let detail = `analyzed ${intraPairs} pairs within this set`;
    if (unknownPairs > 0 || lowCountPairs > 0) {
      const issues = [];
      if (unknownPairs > 0) issues.push(`${unknownPairs} with no historical data`);
      if (lowCountPairs > 0) issues.push(`${lowCountPairs} with limited data`);
      detail += ` (${issues.join(', ')})`;
    }
    synergyItems.push({
      label: 'How well these skills work together as a set',
      value: intra.toFixed(1),
      unit: 'points',
      detail: detail,
      explanation: intra > 0
        ? 'These skills complement each other well based on past battle results.'
        : 'Limited data on how these skills perform together as a group.',
    });
  }
  if (cross !== 0) {
    const crossPairs = analysis.skill_hero_pairs || 0;
    const unknownPairs = analysis.unknown_skill_hero_pairs || 0;
    const lowCountPairs = analysis.lowcount_skill_hero_pairs || 0;
    let detail = `analyzed ${crossPairs} skill-hero combinations`;
    if (unknownPairs > 0 || lowCountPairs > 0) {
      const issues = [];
      if (unknownPairs > 0) issues.push(`${unknownPairs} with no historical data`);
      if (lowCountPairs > 0) issues.push(`${lowCountPairs} with limited data`);
      detail += ` (${issues.join(', ')})`;
    }
    synergyItems.push({
      label: 'How well these skills work with your current heroes',
      value: cross.toFixed(1),
      unit: 'points',
      detail: detail,
      explanation: cross > 0
        ? 'These skills are particularly effective when used by your current team heroes.'
        : 'Limited data on how these skills perform with your current heroes.',
    });
  }

  const unknownCur = analysis.unknown_current_skill_pairs || 0;
  const unknownIntra = analysis.unknown_intra_skill_pairs || 0;
  const unknownCross = analysis.unknown_skill_hero_pairs || 0;

  return {
    type: 'detailed',
    sections: [
      {
        title: 'Why This Skill Set Was Recommended',
        content: [
          {
            type: 'text',
            text: `This skill set scored highest out of all available options. The recommendation is based on analyzing how well each skill performs individually, how skills work together, and how well they complement your current team heroes. The system uses historical battle data to identify proven skill combinations.`,
          },
        ],
      },
      {
        title: 'Individual Skill Performance',
        content: [
          {
            type: 'text',
            text: `Each skill's score is based on its historical win rate, adjusted for how many battles it's been used in (more battles = more reliable data). The set includes `,
          },
          {
            type: 'bold',
            text: bestSkill,
          },
          {
            type: 'text',
            text: `, which has the strongest individual performance with a `,
          },
          {
            type: 'bold',
            text: `${getScoreDescription(bestScore)}`,
          },
          {
            type: 'text',
            text: ` win rate of `,
          },
          {
            type: 'bold',
            text: `${bestScore.toFixed(1)}%`,
          },
          {
            type: 'text',
            text: `.`,
          },
          ...(skillScores.length > 1 ? [
            {
              type: 'text',
              text: ` The average performance across all skills in this set is `,
            },
            {
              type: 'bold',
              text: `${avgScore.toFixed(1)}%`,
            },
            {
              type: 'text',
              text: ` (ranging from ${minScore.toFixed(1)}% to ${bestScore.toFixed(1)}%).`,
            },
          ] : []),
          {
            type: 'text',
            text: ` Combined, these skills contribute `,
          },
          {
            type: 'bold',
            text: `${individualTotal.toFixed(1)} points`,
          },
          {
            type: 'text',
            text: ` to the total score based on their individual strengths.`,
          },
        ],
      },
      {
        title: 'How the Score is Calculated',
        content: [
          {
            type: 'text',
            text: `The final score has two main parts:`,
          },
          {
            type: 'list',
            items: [
              {
                label: 'Individual Performance',
                value: individualTotal.toFixed(1),
                unit: 'points',
                explanation: `Sum of each skill's win rate score (${skillNames.length} skills × their individual scores)`,
              },
              {
                label: 'Team Synergy Bonus',
                value: synergyTotal.toFixed(1),
                unit: 'points',
                explanation: 'Points added for how well skills work together and with your heroes (see details below)',
              },
            ],
          },
          {
            type: 'text',
            text: `\nFinal Score = Individual Performance + Team Synergy = `,
          },
          {
            type: 'bold',
            text: `${individualTotal.toFixed(1)} + ${synergyTotal.toFixed(1)} = ${analysis.total_score.toFixed(1)} points`,
          },
        ],
      },
      {
        title: 'Team Synergy Breakdown',
        content: synergyTotal !== 0 ? [
          {
            type: 'text',
            text: `Team synergy adds `,
          },
          {
            type: 'bold',
            text: `${synergyTotal.toFixed(1)} points`,
          },
          {
            type: 'text',
            text: ` to the score. This measures three types of synergy based on past battles:`,
          },
          {
            type: 'list',
            items: synergyItems,
          },
          {
            type: 'text',
            text: `\nThe synergy score rewards proven skill combinations and penalizes pairs with no historical data or very limited battle history.`,
          },
        ] : [
          {
            type: 'text',
            text: `Limited synergy data is available for this combination. The system found `,
          },
          {
            type: 'bold',
            text: `${unknownCur + unknownIntra + unknownCross} skill combinations`,
          },
          {
            type: 'text',
            text: ` with no historical battle data. This means the recommendation is based primarily on individual skill performance rather than proven combinations.`,
          },
        ],
      },
      {
        title: 'Final Recommendation Score',
        content: [
          {
            type: 'text',
            text: `This skill set received a total score of `,
          },
          {
            type: 'bold',
            text: `${analysis.total_score.toFixed(1)} points`,
          },
          {
            type: 'text',
            text: `, which is `,
          },
          {
            type: 'bold',
            text: getScoreDescription(analysis.total_score),
          },
          {
            type: 'text',
            text: `. This score combines:`,
          },
          {
            type: 'list',
            items: [
              {
                label: 'Individual skill strengths',
                value: individualTotal.toFixed(1),
                unit: 'points',
                explanation: 'How well each skill performs on its own',
              },
              {
                label: 'Team synergy bonuses',
                value: synergyTotal.toFixed(1),
                unit: 'points',
                explanation: 'How well skills work together and with your heroes based on past battles',
              },
              {
                label: 'Total recommendation score',
                value: analysis.total_score.toFixed(1),
                unit: 'points',
                highlight: true,
                explanation: 'The higher the score, the better the recommendation',
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

