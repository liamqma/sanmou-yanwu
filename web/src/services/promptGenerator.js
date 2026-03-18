/**
 * Generate a structured prompt for LLM analysis of the current game state.
 * The prompt is designed to be copied into ChatGPT or similar LLMs for
 * deeper reasoning about hero/skill selection.
 *
 * Focus priority: battle_stats > 阵营 > 兵种
 */
import database2 from '../database2.json';
import battleStats from '../battle_stats.json';


/**
 * Format a hero's info from database2 into a readable string.
 */
function formatHeroInfo(heroName) {
  const hero = database2.wj?.[heroName];
  if (!hero) return heroName;

  const parts = [
    `${hero.name}`,
    `阵营:${hero.zy}`,
    `兵种:${hero.bz}`,
    `武力:${Math.floor(parseFloat(hero.wl) + parseFloat(hero.wl_incr) * 45)}`,
    `智力:${Math.floor(parseFloat(hero.zl) + parseFloat(hero.zl_incr) * 45)}`,
    `统帅:${Math.floor(parseFloat(hero.ts) + parseFloat(hero.ts_incr) * 45)}`,
    `先攻:${Math.floor(parseFloat(hero.xg) + parseFloat(hero.xg_incr) * 45)}`,
  ];

  // 自带战法 with description from wj_zf
  const skillData = database2.wj_zf?.[hero.skill];
  if (skillData) {
    const skillDesc = skillData.mj_desc || skillData.desc;
    const glRaw = skillData.mj_gl || skillData.gl;
    let glStr = '';
    if (glRaw) {
      const gl = glRaw.includes('>') ? glRaw.split('>').pop().trim() : glRaw;
      glStr = ` (${gl})`;
    }
    parts.push(`自带战法:${hero.skill}${glStr} - ${skillDesc}`);
  } else {
    parts.push(`自带战法:${hero.skill}`);
  }

  return parts.join(' | ');
}

/**
 * Format a skill's info from database2 into a readable string.
 */
function formatSkillInfo(skillName) {
  const skill = database2.zf?.[skillName] || database2.wj_zf?.[skillName];
  if (!skill) return skillName;

  const parts = [
    `${skill.name}`,
    `类型:${skill.ty}`,
  ];

  if (skill.tx) parts.push(`伤害类型:${skill.tx}`);

  const glRaw = skill.mj_gl || skill.gl;
  if (glRaw) {
    const gl = glRaw.includes('>') ? glRaw.split('>').pop().trim() : glRaw;
    parts.push(`发动概率:${gl}`);
  }

  const desc = skill.mj_desc || skill.desc;
  if (desc) parts.push(`效果:${desc}`);

  return parts.join(' | ');
}

/**
 * Get battle stats summary for a hero.
 */
function getHeroBattleStats(heroName) {
  const stats = battleStats.hero_stats?.[heroName];
  if (!stats) return null;
  return { wins: stats.wins, losses: stats.losses, total: stats.total, winRate: stats.wilson };
}

/**
 * Get battle stats summary for a skill.
 */
function getSkillBattleStats(skillName) {
  const stats = battleStats.skill_stats?.[skillName];
  if (!stats) return null;
  return { wins: stats.wins, losses: stats.losses, total: stats.total, winRate: stats.wilson };
}

/**
 * Get relevant hero pair stats for a hero with existing team heroes.
 */
function getHeroPairStats(heroName, existingHeroes) {
  const pairs = [];
  for (const existing of existingHeroes) {
    const key1 = `${heroName},${existing}`;
    const key2 = `${existing},${heroName}`;
    const stats = battleStats.hero_pair_stats?.[key1] || battleStats.hero_pair_stats?.[key2];
    if (stats) {
      pairs.push({ partner: existing, wins: stats.wins, losses: stats.losses, winRate: stats.wilson });
    }
  }
  return pairs;
}

/**
 * Get relevant skill-hero pair stats for a skill with existing team heroes.
 */
function getSkillHeroPairStats(skillName, existingHeroes) {
  const pairs = [];
  for (const hero of existingHeroes) {
    const key1 = `${hero},${skillName}`;
    const key2 = `${skillName},${hero}`;
    const stats = battleStats.skill_hero_pair_stats?.[key1] || battleStats.skill_hero_pair_stats?.[key2];
    if (stats) {
      pairs.push({ hero, wins: stats.wins, losses: stats.losses, winRate: stats.wilson });
    }
  }
  return pairs;
}

/**
 * Get relevant skill pair stats for a skill with existing team skills.
 */
function getSkillPairStats(skillName, existingSkills) {
  const pairs = [];
  for (const existing of existingSkills) {
    const key1 = `${skillName},${existing}`;
    const key2 = `${existing},${skillName}`;
    const stats = battleStats.skill_pair_stats?.[key1] || battleStats.skill_pair_stats?.[key2];
    if (stats) {
      pairs.push({ partner: existing, wins: stats.wins, losses: stats.losses, winRate: stats.wilson });
    }
  }
  return pairs;
}

/**
 * Get hero combination stats (3-hero team) if it exists.
 */
function getHeroCombinationStats(heroes) {
  if (heroes.length < 3) return null;
  // Try all permutations of the key
  // Check all orderings since keys might not be sorted
  for (const combo of getAllPermutationKeys(heroes)) {
    const stats = battleStats.hero_combinations?.[combo];
    if (stats) return { key: combo, ...stats };
  }
  return null;
}

function getAllPermutationKeys(arr) {
  if (arr.length <= 1) return [arr.join(',')];
  const results = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of getAllPermutationKeys(rest)) {
      results.push(`${arr[i]},${perm}`);
    }
  }
  return results;
}

/**
 * Get synergy data for a hero.
 */
function getHeroSynergyPartners(heroName) {
  const synergy = battleStats.hero_synergy_stats?.[heroName];
  if (!synergy?.synergy_partners?.length) return [];
  return synergy.synergy_partners.slice(0, 5);
}

/**
 * Get synergy data for a skill (which heroes it synergizes with).
 */
function getSkillSynergyHeroes(skillName) {
  const synergy = battleStats.skill_synergy_stats?.[skillName];
  if (!synergy?.has_significant_synergy || !synergy?.synergy_heroes?.length) return [];
  return synergy.synergy_heroes.slice(0, 5);
}

/**
 * Format battle stats context for a set of heroes.
 */
function formatHeroSetBattleContext(heroes, existingHeroes, existingSkills) {
  const lines = [];
  for (const heroName of heroes) {
    const stats = getHeroBattleStats(heroName);
    if (stats) {
      lines.push(`    ${heroName}: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
    }

    // Pair stats with existing heroes
    const pairs = getHeroPairStats(heroName, existingHeroes);
    if (pairs.length > 0) {
      for (const p of pairs) {
        lines.push(`      与${p.partner}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
      }
    }

    // Pair stats with existing skills (how this candidate hero performs with already-selected skills)
    const skillPairs = getSkillHeroPairStats(heroName, existingSkills);
    if (skillPairs.length > 0) {
      for (const p of skillPairs) {
        lines.push(`      与战法${p.hero}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
      }
    }

    // Check synergy with existing heroes
    const synergy = getHeroSynergyPartners(heroName);
    const relevantSynergy = synergy.filter(s => existingHeroes.includes(s.partner));
    if (relevantSynergy.length > 0) {
      for (const s of relevantSynergy) {
        lines.push(`      与${s.partner}协同加成: +${(s.synergy_boost * 100).toFixed(1)}%`);
      }
    }

    // Check potential 3-hero combinations
    if (existingHeroes.length >= 2) {
      for (let i = 0; i < existingHeroes.length; i++) {
        for (let j = i + 1; j < existingHeroes.length; j++) {
          const combo = getHeroCombinationStats([heroName, existingHeroes[i], existingHeroes[j]]);
          if (combo) {
            lines.push(`      三人组合[${heroName},${existingHeroes[i]},${existingHeroes[j]}]: 胜${combo.wins}/负${combo.losses} (胜率指数${(combo.wilson * 100).toFixed(1)}%)`);
          }
        }
      }
    }
  }
  return lines;
}

/**
 * Format battle stats context for a set of skills.
 */
function formatSkillSetBattleContext(skills, existingHeroes, existingSkills) {
  const lines = [];
  for (const skillName of skills) {
    const stats = getSkillBattleStats(skillName);
    if (stats) {
      lines.push(`    ${skillName}: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
    }

    // Skill-hero pair stats with existing heroes
    const heroPairs = getSkillHeroPairStats(skillName, existingHeroes);
    if (heroPairs.length > 0) {
      for (const p of heroPairs) {
        lines.push(`      与武将${p.hero}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
      }
    }

    // Skill pair stats with existing skills
    const skillPairs = getSkillPairStats(skillName, existingSkills);
    if (skillPairs.length > 0) {
      for (const p of skillPairs) {
        lines.push(`      与战法${p.partner}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
      }
    }

    // Skill synergy with existing heroes (which existing heroes this skill boosts)
    const synergyHeroes = getSkillSynergyHeroes(skillName);
    const relevantSynergy = synergyHeroes.filter(s => existingHeroes.includes(s.hero));
    if (relevantSynergy.length > 0) {
      for (const s of relevantSynergy) {
        lines.push(`      与武将${s.hero}协同加成: +${(s.synergy_boost * 100).toFixed(1)}%`);
      }
    }
  }
  return lines;
}

/**
 * Generate the full LLM prompt.
 */
export async function generateLLMPrompt({ gameState, currentRoundInputs, recommendation, roundType }) {
  const lines = [];

  // ── Header ──
  lines.push('=== 三国谋定天下 - 战报选将分析 ===');
  lines.push('');
  lines.push(`数据来源: ${battleStats.total_battles}场战斗统计`);
  lines.push('胜率指数说明: 使用Wilson置信区间下界，样本越少越保守，范围0-100%');
  lines.push('');

  // ── Game context ──
  const roundTypeText = roundType === 'hero' ? '武将' : '战法';
  lines.push(`【当前状态】`);
  lines.push(`第 ${gameState.round_number} 轮 | 选择类型: ${roundTypeText}`);
  lines.push('');

  // ── Current team heroes ──
  lines.push('【已选武将】');
  if (gameState.current_heroes?.length > 0) {
    gameState.current_heroes.forEach((hero, i) => {
      lines.push(`  ${i + 1}. ${formatHeroInfo(hero)}`);
      const stats = getHeroBattleStats(hero);
      if (stats) {
        lines.push(`     战绩: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
      }
    });
  } else {
    lines.push('  （无）');
  }
  lines.push('');

  // ── Current hero pair stats ──
  if (gameState.current_heroes?.length >= 2) {
    lines.push('【已选武将配对战绩】');
    const heroes = gameState.current_heroes;
    for (let i = 0; i < heroes.length; i++) {
      for (let j = i + 1; j < heroes.length; j++) {
        const key1 = `${heroes[i]},${heroes[j]}`;
        const key2 = `${heroes[j]},${heroes[i]}`;
        const stats = battleStats.hero_pair_stats?.[key1] || battleStats.hero_pair_stats?.[key2];
        if (stats) {
          lines.push(`  ${heroes[i]}+${heroes[j]}: 胜${stats.wins}/负${stats.losses} (胜率指数${(stats.wilson * 100).toFixed(1)}%)`);
        }
      }
    }
    lines.push('');
  }

  // ── Current team skills ──
  lines.push('【已选战法】');
  if (gameState.current_skills?.length > 0) {
    gameState.current_skills.forEach((skill, i) => {
      lines.push(`  ${i + 1}. ${formatSkillInfo(skill)}`);
      const stats = getSkillBattleStats(skill);
      if (stats) {
        lines.push(`     战绩: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
      }
    });
  } else {
    lines.push('  （无）');
  }
  lines.push('');

  // ── The 3 option sets with battle stats ──
  lines.push(`【本轮三组可选${roundTypeText}及战绩数据】`);
  const sets = [
    currentRoundInputs.set1 || [],
    currentRoundInputs.set2 || [],
    currentRoundInputs.set3 || [],
  ];

  const existingHeroes = gameState.current_heroes || [];
  const existingSkills = gameState.current_skills || [];

  sets.forEach((set, i) => {
    lines.push(`--- 第${i + 1}组 ---`);
    if (set.length === 0) {
      lines.push('  （空）');
    } else {
      // Show basic info
      set.forEach((item, j) => {
        if (roundType === 'hero') {
          lines.push(`  ${j + 1}. ${formatHeroInfo(item)}`);
        } else {
          lines.push(`  ${j + 1}. ${formatSkillInfo(item)}`);
        }
      });

      // Show battle stats context
      lines.push('  [战绩数据]');
      let battleLines;
      if (roundType === 'hero') {
        battleLines = formatHeroSetBattleContext(set, existingHeroes, existingSkills);
      } else {
        battleLines = formatSkillSetBattleContext(set, existingHeroes, existingSkills);
      }
      if (battleLines.length > 0) {
        lines.push(...battleLines);
      } else {
        lines.push('    （无相关战绩数据）');
      }
    }
    lines.push('');
  });

  // ── Instruction to LLM ──
  lines.push('【请你分析】');
  lines.push('请根据以上信息，分析三组选项各自的优劣，按以下优先级考虑：');
  lines.push('1. 战绩数据：各武将/战法的胜率，配对胜率，三人组合胜率');
  lines.push('2. 阵营配合：同一阵营有属性加成');
  lines.push('3. 兵种配合：同一兵种有增减伤的加成');
  lines.push('4. 最终目的是组3个队伍，每个队伍3个武将，每个武将1个自带战法（固定）+ 2个战法');
  lines.push('');
  lines.push('请给出你推荐选择哪一组，并详细说明理由。');

  return lines.join('\n');
}
