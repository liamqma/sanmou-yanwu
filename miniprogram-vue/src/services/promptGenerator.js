/**
 * Generate a structured prompt for LLM analysis of the current game state.
 * The prompt is designed to be copied into ChatGPT or similar LLMs for
 * deeper reasoning about hero/skill selection.
 *
 * Focus priority: battle_stats > 阵营 > 兵种
 */
import { getDatabase2, getBattleStats } from './dataStore';


/**
 * Format a hero's info from database2 into a readable string.
 */
function formatHeroInfo(heroName, database2) {
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
function formatSkillInfo(skillName, database2) {
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
function getHeroBattleStats(heroName, battleStats) {
  const stats = battleStats.hero_stats?.[heroName];
  if (!stats) return null;
  return { wins: stats.wins, losses: stats.losses, total: stats.total, winRate: stats.wilson };
}

/**
 * Get battle stats summary for a skill.
 */
function getSkillBattleStats(skillName, battleStats) {
  const stats = battleStats.skill_stats?.[skillName];
  if (!stats) return null;
  return { wins: stats.wins, losses: stats.losses, total: stats.total, winRate: stats.wilson };
}

/**
 * Get relevant hero pair stats for a hero with existing team heroes.
 */
function getHeroPairStats(heroName, existingHeroes, battleStats) {
  const pairs = [];
  for (const existing of existingHeroes) {
    // Keys are always stored sorted
    const key = [heroName, existing].sort().join(',');
    const stats = battleStats.hero_pair_stats?.[key];
    if (stats) {
      pairs.push({ partner: existing, wins: stats.wins, losses: stats.losses, winRate: stats.wilson });
    }
  }
  return pairs;
}

/**
 * Get relevant skill-hero pair stats for a skill with existing team heroes.
 * Keys in skill_hero_pair_stats are stored as "hero,skill".
 * Returns objects with both `skill` (the skill name) and `hero` fields.
 */
function getSkillHeroPairStats(skillName, existingHeroes, battleStats) {
  const pairs = [];
  for (const hero of existingHeroes) {
    // Keys are stored as "hero,skill"
    const key = `${hero},${skillName}`;
    const stats = battleStats.skill_hero_pair_stats?.[key];
    if (stats) {
      pairs.push({ skill: skillName, hero, wins: stats.wins, losses: stats.losses, winRate: stats.wilson });
    }
  }
  return pairs;
}

/**
 * Get relevant skill pair stats for a skill with existing team skills.
 */
function getSkillPairStats(skillName, existingSkills, battleStats) {
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
 * Keys in hero_combinations are always stored sorted.
 */
function getHeroCombinationStats(heroes, battleStats) {
  if (heroes.length < 3) return null;
  const key = heroes.slice().sort().join(',');
  const stats = battleStats.hero_combinations?.[key];
  return stats ? { key, ...stats } : null;
}

/**
 * Get synergy data for a hero.
 */
function getHeroSynergyPartners(heroName, battleStats) {
  const synergy = battleStats.hero_synergy_stats?.[heroName];
  if (!synergy?.synergy_partners?.length) return [];
  return synergy.synergy_partners.slice(0, 5);
}

/**
 * Get synergy data for a skill (which heroes it synergizes with).
 */
function getSkillSynergyHeroes(skillName, battleStats) {
  const synergy = battleStats.skill_synergy_stats?.[skillName];
  if (!synergy?.has_significant_synergy || !synergy?.synergy_heroes?.length) return [];
  return synergy.synergy_heroes.slice(0, 5);
}

/**
 * Format battle stats context for a set of heroes.
 */
function formatHeroSetBattleContext(heroes, existingHeroes, existingSkills, database2, battleStats) {
  const lines = [];
  for (const heroName of heroes) {
    const stats = getHeroBattleStats(heroName, battleStats);
    if (stats) {
      lines.push(`    ${heroName}: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
    }

    // Pair stats with existing heroes
    const pairs = getHeroPairStats(heroName, existingHeroes, battleStats);
    if (pairs.length > 0) {
      for (const p of pairs) {
        lines.push(`      与${p.partner}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
      }
    }

    // Pair stats with existing skills (how this candidate hero performs with already-selected skills)
    const skillPairs = getSkillHeroPairStats(heroName, existingSkills, battleStats);
    if (skillPairs.length > 0) {
      for (const p of skillPairs) {
        lines.push(`      与战法${p.skill}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
      }
    }

    // Check synergy with existing heroes
    const synergy = getHeroSynergyPartners(heroName, battleStats);
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
          const combo = getHeroCombinationStats([heroName, existingHeroes[i], existingHeroes[j]], battleStats);
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
function formatSkillSetBattleContext(skills, existingHeroes, existingSkills, database2, battleStats) {
  const lines = [];
  for (const skillName of skills) {
    const stats = getSkillBattleStats(skillName, battleStats);
    if (stats) {
      lines.push(`    ${skillName}: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
    }

    // Skill-hero pair stats with existing heroes
    const heroPairs = getSkillHeroPairStats(skillName, existingHeroes, battleStats);
    if (heroPairs.length > 0) {
      for (const p of heroPairs) {
        lines.push(`      与武将${p.hero}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
      }
    }

    // Skill pair stats with existing skills
    const skillPairs = getSkillPairStats(skillName, existingSkills, battleStats);
    if (skillPairs.length > 0) {
      for (const p of skillPairs) {
        lines.push(`      与战法${p.partner}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
      }
    }

    // Skill synergy with existing heroes (which existing heroes this skill boosts)
    const synergyHeroes = getSkillSynergyHeroes(skillName, battleStats);
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
  const [database2, battleStats] = await Promise.all([getDatabase2(), getBattleStats()]);
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
      lines.push(`  ${i + 1}. ${formatHeroInfo(hero, database2)}`);
      const stats = getHeroBattleStats(hero, battleStats);
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
      lines.push(`  ${i + 1}. ${formatSkillInfo(skill, database2)}`);
      const stats = getSkillBattleStats(skill, battleStats);
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
          lines.push(`  ${j + 1}. ${formatHeroInfo(item, database2)}`);
        } else {
          lines.push(`  ${j + 1}. ${formatSkillInfo(item, database2)}`);
        }
      });

      // Show battle stats context
      lines.push('  [战绩数据]');
      let battleLines;
      if (roundType === 'hero') {
        battleLines = formatHeroSetBattleContext(set, existingHeroes, existingSkills, database2, battleStats);
      } else {
        battleLines = formatSkillSetBattleContext(set, existingHeroes, existingSkills, database2, battleStats);
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

/**
 * Generate a prompt for LLM to help compose 3 teams from the hero/skill pool.
 * Includes battle stats for all heroes and skills in the pool.
 *
 * @param {string[]} heroes - All available heroes
 * @param {string[]} skills - All available skills
 * @returns {Promise<string>} The prompt text
 */
export async function generateTeamBuilderPrompt(heroes, skills) {
  const [database2, battleStats] = await Promise.all([getDatabase2(), getBattleStats()]);
  const lines = [];

  // ── Header ──
  lines.push('=== 三国谋定天下 - 组队分析 ===');
  lines.push('');
  lines.push(`数据来源: ${battleStats.total_battles}场战斗统计`);
  lines.push('胜率指数说明: 使用Wilson置信区间下界，样本越少越保守，范围0-100%');
  lines.push('');

  // ── Task description ──
  lines.push('【任务】');
  lines.push(`请根据以下武将池(${heroes.length}名)和战法池(${skills.length}个)，帮我组建3支最优队伍。`);
  lines.push('每支队伍3名武将，每名武将分配2个战法（不含自带战法）。');
  lines.push('每个武将和战法只能使用一次。');
  lines.push('');

  // ── Hero pool with stats ──
  lines.push('【武将池】');
  for (const hero of heroes) {
    lines.push(`  ${formatHeroInfo(hero, database2)}`);
    const stats = getHeroBattleStats(hero, battleStats);
    if (stats) {
      lines.push(`    战绩: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
    }
    // Show synergy partners that are also in the pool
    const synergy = getHeroSynergyPartners(hero, battleStats);
    const relevantSynergy = synergy.filter(s => heroes.includes(s.partner));
    if (relevantSynergy.length > 0) {
      for (const s of relevantSynergy) {
        lines.push(`    协同: 与${s.partner}配对胜率指数${(s.pair_wilson * 100).toFixed(1)}%, 加成+${(s.synergy_boost * 100).toFixed(1)}%`);
      }
    }
  }
  lines.push('');

  // ── Hero pair stats (only pairs within the pool) ──
  const heroPairStats = battleStats.hero_pair_stats || {};
  const pairLines = [];
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      const key1 = `${heroes[i]},${heroes[j]}`;
      const key2 = `${heroes[j]},${heroes[i]}`;
      const stats = heroPairStats[key1] || heroPairStats[key2];
      if (stats) {
        const total = stats.wins + stats.losses;
        if (total >= 3) {
          pairLines.push(`  ${heroes[i]}+${heroes[j]}: 胜${stats.wins}/负${stats.losses} (胜率指数${(stats.wilson * 100).toFixed(1)}%)`);
        }
      }
    }
  }
  if (pairLines.length > 0) {
    lines.push('【武将配对战绩】(样本≥3)');
    lines.push(...pairLines);
    lines.push('');
  }

  // ── 3-hero combination stats (only combos within the pool) ──
  const heroCombinations = battleStats.hero_combinations || {};
  const comboLines = [];
  const n = heroes.length;
  if (n >= 3) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          const trio = [heroes[i], heroes[j], heroes[k]].sort();
          const key = trio.join(',');
          const stats = heroCombinations[key];
          if (stats) {
            const total = stats.wins + stats.losses;
            if (total >= 2) {
              comboLines.push({
                text: `  ${trio.join('+')}:  胜${stats.wins}/负${stats.losses} (胜率指数${(stats.wilson * 100).toFixed(1)}%)`,
                wilson: stats.wilson ?? 0,
              });
            }
          }
        }
      }
    }
  }
  if (comboLines.length > 0) {
    // Sort by wilson descending, show top combos
    comboLines.sort((a, b) => b.wilson - a.wilson);
    lines.push('【三武将组合战绩】(样本≥2, 按胜率指数排序)');
    for (const c of comboLines.slice(0, 30)) {
      lines.push(c.text);
    }
    lines.push('');
  }

  // ── Skill pool with stats ──
  lines.push('【战法池】');
  for (const skill of skills) {
    lines.push(`  ${formatSkillInfo(skill, database2)}`);
    const stats = getSkillBattleStats(skill, battleStats);
    if (stats) {
      lines.push(`    战绩: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
    }
    // Show synergy with heroes in the pool
    const synergyHeroes = getSkillSynergyHeroes(skill, battleStats);
    const relevantSynergy = synergyHeroes.filter(s => heroes.includes(s.hero));
    if (relevantSynergy.length > 0) {
      for (const s of relevantSynergy) {
        lines.push(`    协同: 与${s.hero}配对胜率指数${(s.pair_wilson * 100).toFixed(1)}%, 加成+${(s.synergy_boost * 100).toFixed(1)}%`);
      }
    }
  }
  lines.push('');

  // ── Skill-hero pair stats (top pairs within the pool) ──
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
  const shPairLines = [];
  for (const hero of heroes) {
    for (const skill of skills) {
      const key = `${hero},${skill}`;
      const stats = skillHeroPairStats[key];
      if (stats) {
        const total = stats.wins + stats.losses;
        if (total >= 3) {
          shPairLines.push({
            text: `  ${hero}+${skill}: 胜${stats.wins}/负${stats.losses} (胜率指数${(stats.wilson * 100).toFixed(1)}%)`,
            wilson: stats.wilson ?? 0,
          });
        }
      }
    }
  }
  if (shPairLines.length > 0) {
    shPairLines.sort((a, b) => b.wilson - a.wilson);
    lines.push('【武将-战法配对战绩】(样本≥3, 按胜率指数排序, 前40)');
    for (const p of shPairLines.slice(0, 40)) {
      lines.push(p.text);
    }
    lines.push('');
  }

  // ── Instructions ──
  lines.push('【请你分析】');
  lines.push('请根据以上数据，组建3支最优队伍，按以下优先级考虑：');
  lines.push('1. 三武将组合战绩：优先选择历史胜率高的三人组合');
  lines.push('2. 阵营配合：同一阵营有属性加成');
  lines.push('3. 武将配对战绩：队内武将之间的配对胜率');
  lines.push('4. 武将-战法配对：为每位武将分配与其配对胜率最高的战法');
  lines.push('5. 协同加成：利用武将和战法之间的协同效应');
  lines.push('6. 兵种配合：同一兵种有增减伤的加成');
  lines.push('');
  lines.push('请给出3支队伍的具体配置（每队3武将+每人2战法），并详细说明理由。');

  return lines.join('\n');
}
