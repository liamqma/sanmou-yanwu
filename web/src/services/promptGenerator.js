/**
 * Generate a structured prompt for LLM analysis of the current game state.
 * The prompt is designed to be copied into ChatGPT or similar LLMs for
 * deeper reasoning about hero/skill selection.
 *
 * Focus priority: battle_stats > 阵营 > 兵种
 */
import database from '../database.json';
import database2 from '../database2.json';
import battleStatsData from '../battle_stats.json';
import tips from '../tips.json';


/**
 * Format relevant tips for a list of heroes and skills.
 * Returns lines to include in the prompt, or empty array if no tips match.
 */
function formatRelevantTips(heroes, skills) {
  const lines = [];
  const heroTips = tips.heroes || {};
  const skillTips = tips.skills || {};

  const heroLines = [];
  for (const hero of heroes) {
    if (heroTips[hero]) {
      heroLines.push(`  ${hero}: ${heroTips[hero]}`);
    }
  }

  const skillLines = [];
  for (const skill of skills) {
    if (skillTips[skill]) {
      skillLines.push(`  ${skill}: ${skillTips[skill]}`);
    }
  }

  if (heroLines.length > 0 || skillLines.length > 0) {
    lines.push('【玩家心得（最高优先级，优先于战绩数据）】');
    if (heroLines.length > 0) {
      lines.push('  武将心得:');
      lines.push(...heroLines);
    }
    if (skillLines.length > 0) {
      lines.push('  战法心得:');
      lines.push(...skillLines);
    }
    lines.push('');
  }

  return lines;
}


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
const TROOP_EMOJI_MAP = { '🛡️': '盾', '🏹️': '弓', '↖️': '枪', '🐎': '骑' };

function formatSkillInfo(skillName, database2) {
  const skill = database2.zf?.[skillName] || database2.wj_zf?.[skillName];
  if (!skill) return skillName;

  const parts = [
    `${skill.name}`,
    `类型:${skill.ty}`,
  ];

  if (skill.tx) parts.push(`伤害类型:${skill.tx}`);

  // Troop compatibility
  if (skill.bz && Array.isArray(skill.bz)) {
    const troopNames = skill.bz.map(e => TROOP_EMOJI_MAP[e] || e);
    if (troopNames.length < 4) {
      parts.push(`适用兵种:${troopNames.join('/')}`);
    }
  }

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
function getSkillHeroPairStats(skillName, existingHeroes, battleStats) {
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
 */
function getHeroCombinationStats(heroes, battleStats) {
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
function getHeroSynergyPartners(heroName, battleStats) {
  const synergy = battleStats.hero_synergy_stats?.[heroName];
  if (!synergy?.synergy_partners?.length) return [];
  return synergy.synergy_partners.slice(0, 5);
}

/**
 * Find active/potential bonds among a set of heroes.
 * Returns bonds where at least 2 members are present in the hero list.
 */
function findRelevantBonds(heroes, database2) {
  const bonds = database2.bond || {};
  const heroSet = new Set(heroes);
  const results = [];

  // Strategy 1: Check bonds that have explicit member lists
  for (const [bondName, bond] of Object.entries(bonds)) {
    if (bond.member && bond.member.length > 0) {
      const matched = bond.member.filter(m => heroSet.has(m));
      if (matched.length >= 2) {
        results.push({
          name: bondName,
          title: bond.title || bondName,
          content: bond.content,
          condition: bond.condition,
          matchedMembers: matched,
          totalMembers: bond.member.length,
        });
      }
    }
  }

  // Strategy 2: Check hero jb fields for shared bonds (for bonds without member lists)
  const bondToHeroes = {};
  for (const heroName of heroes) {
    const hero = database2.wj?.[heroName];
    if (!hero?.jb) continue;
    for (const jb of hero.jb) {
      if (!bondToHeroes[jb.name]) bondToHeroes[jb.name] = [];
      bondToHeroes[jb.name].push(heroName);
    }
  }
  for (const [bondName, heroList] of Object.entries(bondToHeroes)) {
    if (heroList.length >= 2 && !results.find(r => r.name === bondName)) {
      const bond = bonds[bondName];
      if (bond) {
        results.push({
          name: bondName,
          title: bond.title || bondName,
          content: bond.content,
          condition: bond.condition,
          matchedMembers: heroList,
          totalMembers: bond.member?.length || heroList.length,
        });
      }
    }
  }

  return results;
}

/**
 * Format buff/debuff mechanics reference section.
 */
function formatBuffDebuffReference(database2) {
  const lines = [];
  const buffs = database2.buff || {};
  const debuffs = database2.debuff || {};

  lines.push('【增益/负面状态参考】');
  lines.push('  增益状态:');
  for (const [, buff] of Object.entries(buffs)) {
    if (buff.name && buff.effect && !buff.name.includes('特殊') && !buff.name.includes('布局') && !buff.name.includes('棋局')) {
      lines.push(`    ${buff.name}: ${buff.effect}`);
    }
  }
  lines.push('  负面状态:');
  for (const [, debuff] of Object.entries(debuffs)) {
    if (debuff.name && debuff.effect && !debuff.name.includes('常规') && !debuff.name.includes('传递') && !debuff.name.includes('控制状态') && !debuff.name.includes('属性降低')) {
      lines.push(`    ${debuff.name}${debuff.controlling ? '(控制)' : ''}: ${debuff.effect}`);
    }
  }
  return lines;
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
        lines.push(`      与战法${p.hero}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
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
  const battleStats = battleStatsData;
  const lines = [];

  // ── Header ──
  lines.push('=== 三国谋定天下 - 战报选将分析 ===');
  lines.push('');
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

  // ── Bonds (缘分) for current team + candidates ──
  const allCandidateHeroes = roundType === 'hero'
    ? [...new Set([...existingHeroes, ...sets.flat()])]
    : existingHeroes;
  if (allCandidateHeroes.length >= 2) {
    const bonds = findRelevantBonds(allCandidateHeroes, database2);
    if (bonds.length > 0) {
      lines.push('【可触发缘分(羁绊)】');
      for (const bond of bonds) {
        const condStr = bond.condition ? ` (${bond.condition})` : '';
        lines.push(`  ${bond.title}: ${bond.content}${condStr}`);
        lines.push(`    涉及武将: ${bond.matchedMembers.join(', ')}${bond.matchedMembers.length < bond.totalMembers ? ` (需${bond.totalMembers}人中至少满足条件)` : ''}`);
      }
      lines.push('');
    }
  }

  // ── Buff/Debuff reference ──
  lines.push(...formatBuffDebuffReference(database2));
  lines.push('');

  // ── Player tips (highest priority) ──
  const allLLMHeroes = [...new Set([...(gameState.current_heroes || []), ...sets.flat()])];
  const allLLMSkills = [...new Set([...(gameState.current_skills || []), ...sets.flat()])];
  const llmTips = formatRelevantTips(allLLMHeroes, allLLMSkills);
  lines.push(...llmTips);

  // ── Instruction to LLM ──
  lines.push('【请你分析】');
  lines.push('请根据以上信息，分析三组选项各自的优劣，按以下优先级考虑：');
  let priority = 1;
  if (llmTips.length > 0) {
    lines.push(`${priority++}. 玩家心得：如有相关心得，必须最优先参考`);
  }
  lines.push(`${priority++}. 战绩数据：各武将/战法的胜率，配对胜率，三人组合胜率`);
  lines.push(`${priority++}. 阵营配合：同一阵营有属性加成`);
  lines.push(`${priority++}. 兵种配合：同一兵种有增减伤的加成`);
  lines.push(`${priority++}. 增益/负面状态配合：战法之间的buff/debuff联动`);
  lines.push(`${priority++}. 缘分(羁绊)：能触发缘分加成的武将组合优先`);
  lines.push('');
  lines.push('最终目的是组3个队伍，每个队伍3个武将，每个武将1个自带战法（固定）+ 2个战法。请给出你推荐选择哪一组，并详细说明理由。');

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
  const battleStats = battleStatsData;
  const lines = [];

  // ── Header ──
  lines.push('=== 三国谋定天下 - 组队分析 ===');
  lines.push('');
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

  // ── Bonds (缘分) among all heroes in pool ──
  if (heroes.length >= 2) {
    const bonds = findRelevantBonds(heroes, database2);
    if (bonds.length > 0) {
      lines.push('【可触发缘分(羁绊)】');
      for (const bond of bonds) {
        const condStr = bond.condition ? ` (${bond.condition})` : '';
        lines.push(`  ${bond.title}: ${bond.content}${condStr}`);
        lines.push(`    涉及武将: ${bond.matchedMembers.join(', ')}${bond.matchedMembers.length < bond.totalMembers ? ` (需${bond.totalMembers}人中至少满足条件)` : ''}`);
      }
      lines.push('');
    }
  }

  // ── Buff/Debuff reference ──
  lines.push(...formatBuffDebuffReference(database2));
  lines.push('');

  // ── Player tips (highest priority) ──
  const teamTips = formatRelevantTips(heroes, skills);
  lines.push(...teamTips);

  // ── Instructions ──
  lines.push('【请你分析】');
  lines.push('请根据以上数据，组建3支最优队伍，按以下优先级考虑：');
  let tbPriority = 1;
  if (teamTips.length > 0) {
    lines.push(`${tbPriority++}. 玩家心得：如有相关心得，必须最优先参考`);
  }
  lines.push(`${tbPriority++}. 三武将组合战绩：优先选择历史胜率高的三人组合`);
  lines.push(`${tbPriority++}. 阵营配合：同一阵营有属性加成`);
  lines.push(`${tbPriority++}. 武将配对战绩：队内武将之间的配对胜率`);
  lines.push(`${tbPriority++}. 兵种配合：同一兵种有增减伤的加成`);
  lines.push(`${tbPriority++}. 武将-战法配对：为每位武将分配与其配对胜率最高的战法`);
  lines.push(`${tbPriority++}. 协同加成：利用武将和战法之间的协同效应`);
  lines.push(`${tbPriority++}. 增益/负面状态配合：战法之间的buff/debuff联动`);
  lines.push(`${tbPriority++}. 缘分(羁绊)：能触发缘分加成的武将组合优先，尽量将有缘分的武将放在同一队`);
  lines.push('');
  lines.push('最终目的是组3个队伍，每个队伍3个武将，每个武将1个自带战法（固定）+ 2个战法。请给出3支队伍的具体配置（每队3武将+每人2战法），并详细说明理由。');

  return lines.join('\n');
}

/**
 * Generate a prompt for LLM to help choose 1 support hero + 2 support skills
 * to add to the current team.
 *
 * @param {string[]} currentHeroes - Heroes already on the team
 * @param {string[]} currentSkills - Skills already on the team
 * @returns {Promise<string>} The prompt text
 */
export async function generateSupportPrompt(currentHeroes, currentSkills) {
  const battleStats = battleStatsData;
  const lines = [];

  // ── Header ──
  lines.push('=== 三国谋定天下 - 支援武将和战法分析 ===');
  lines.push('');
  lines.push('胜率指数说明: 使用Wilson置信区间下界，样本越少越保守，范围0-100%');
  lines.push('');

  // ── Task description ──
  lines.push('【任务】');
  lines.push('请根据以下当前队伍和所有可选橙色武将/战法，帮我选择 1 名支援武将和 2 个支援战法。');
  lines.push('');

  // ── Current team heroes ──
  lines.push('【当前队伍武将】');
  if (currentHeroes.length > 0) {
    currentHeroes.forEach((hero, i) => {
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

  // ── Current team skills ──
  lines.push('【当前队伍战法】');
  if (currentSkills.length > 0) {
    currentSkills.forEach((skill, i) => {
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

  // ── Build candidate hero list (all orange heroes not already on the team) ──
  const currentHeroSet = new Set(currentHeroes);
  const currentSkillSet = new Set(currentSkills);
  const allHeroes = [...new Set(Object.values(database.skill_hero_map))];
  const orangeHeroes = allHeroes.filter(h => {
    const heroData = database2.wj?.[h];
    return !heroData || heroData.color === 'orange';
  });
  const candidateHeroes = orangeHeroes.filter(h => !currentHeroSet.has(h));

  // ── Candidate heroes with battle context ──
  lines.push('【可选橙色武将】');
  for (const hero of candidateHeroes) {
    const stats = getHeroBattleStats(hero, battleStats);
    const heroPairs = getHeroPairStats(hero, currentHeroes, battleStats);
    const synergy = getHeroSynergyPartners(hero, battleStats);
    const relevantSynergy = synergy.filter(s => currentHeroSet.has(s.partner));

    // 3-hero combos with pairs of current heroes
    const combos = [];
    if (currentHeroes.length >= 2) {
      for (let i = 0; i < currentHeroes.length; i++) {
        for (let j = i + 1; j < currentHeroes.length; j++) {
          const combo = getHeroCombinationStats([hero, currentHeroes[i], currentHeroes[j]], battleStats);
          if (combo) combos.push({ heroes: [hero, currentHeroes[i], currentHeroes[j]], combo });
        }
      }
    }

    // Skill-hero pair stats with current skills
    const skillPairs = [];
    for (const skill of currentSkills) {
      const key1 = `${hero},${skill}`;
      const key2 = `${skill},${hero}`;
      const pairStats = battleStats.skill_hero_pair_stats?.[key1] || battleStats.skill_hero_pair_stats?.[key2];
      if (pairStats) {
        skillPairs.push({ skill, wins: pairStats.wins, losses: pairStats.losses, winRate: pairStats.wilson });
      }
    }

    const hasData = stats || heroPairs.length > 0 || relevantSynergy.length > 0 || combos.length > 0 || skillPairs.length > 0;
    if (!hasData) continue;

    lines.push(`  ${formatHeroInfo(hero, database2)}`);
    if (stats) {
      lines.push(`    战绩: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
    }
    for (const p of heroPairs) {
      lines.push(`    与${p.partner}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
    }
    for (const sp of skillPairs) {
      lines.push(`    与战法${sp.skill}配对: 胜${sp.wins}/负${sp.losses} (胜率指数${(sp.winRate * 100).toFixed(1)}%)`);
    }
    for (const s of relevantSynergy) {
      lines.push(`    与${s.partner}协同加成: +${(s.synergy_boost * 100).toFixed(1)}%`);
    }
    for (const c of combos) {
      lines.push(`    三人组合[${c.heroes.join(',')}]: 胜${c.combo.wins}/负${c.combo.losses} (胜率指数${(c.combo.wilson * 100).toFixed(1)}%)`);
    }
  }
  lines.push('');

  // ── Build candidate skill list (all orange skills not already on the team) ──
  const regularOrangeSkills = Object.values(database.skill).filter(s => database2.zf?.[s]?.color === 'orange');
  const heroSkills = Object.keys(database.skill_hero_map);
  const allOrangeSkills = [...new Set([...regularOrangeSkills, ...heroSkills])];
  const candidateSkills = allOrangeSkills.filter(s => !currentSkillSet.has(s));

  // ── Candidate skills with battle context ──
  lines.push('【可选橙色战法】');
  for (const skill of candidateSkills) {
    const stats = getSkillBattleStats(skill, battleStats);
    const heroPairs = getSkillHeroPairStats(skill, currentHeroes, battleStats);
    const synergyHeroes = getSkillSynergyHeroes(skill, battleStats);
    const relevantSynergy = synergyHeroes.filter(s => currentHeroSet.has(s.hero));

    const hasData = stats || heroPairs.length > 0 || relevantSynergy.length > 0;
    if (!hasData) continue;

    lines.push(`  ${formatSkillInfo(skill, database2)}`);
    if (stats) {
      lines.push(`    战绩: 胜${stats.wins}/负${stats.losses} (共${stats.total}场, 胜率指数${(stats.winRate * 100).toFixed(1)}%)`);
    }
    for (const p of heroPairs) {
      lines.push(`    与武将${p.hero}配对: 胜${p.wins}/负${p.losses} (胜率指数${(p.winRate * 100).toFixed(1)}%)`);
    }
    for (const s of relevantSynergy) {
      lines.push(`    与武将${s.hero}协同加成: +${(s.synergy_boost * 100).toFixed(1)}%`);
    }
  }
  lines.push('');

  // ── Bonds (缘分) for current heroes ──
  if (currentHeroes.length >= 2) {
    const bonds = findRelevantBonds(currentHeroes, database2);
    if (bonds.length > 0) {
      lines.push('【可触发缘分(羁绊)】');
      for (const bond of bonds) {
        const condStr = bond.condition ? ` (${bond.condition})` : '';
        lines.push(`  ${bond.title}: ${bond.content}${condStr}`);
        lines.push(`    涉及武将: ${bond.matchedMembers.join(', ')}${bond.matchedMembers.length < bond.totalMembers ? ` (需${bond.totalMembers}人中至少满足条件)` : ''}`);
      }
      lines.push('');
    }
  }

  // ── Buff/Debuff reference ──
  lines.push(...formatBuffDebuffReference(database2));
  lines.push('');

  // ── Player tips (highest priority) ──
  const allSupportHeroes = [...currentHeroes, ...candidateHeroes];
  const allSupportSkills = [...currentSkills, ...candidateSkills];
  const supportTips = formatRelevantTips(allSupportHeroes, allSupportSkills);
  lines.push(...supportTips);

  // ── Analysis instructions ──
  lines.push('【请你分析】');
  lines.push('请根据以上数据，为我的队伍选择 1 名支援武将和 2 个支援战法，按以下优先级考虑：');
  let spPriority = 1;
  if (supportTips.length > 0) {
    lines.push(`${spPriority++}. 玩家心得：如有相关心得，必须最优先参考`);
  }
  lines.push(`${spPriority++}. 战绩数据：武将/战法的个人胜率和与现有队伍的配对胜率`);
  lines.push(`${spPriority++}. 三武将组合战绩：与现有武将组成高胜率三人组`);
  lines.push(`${spPriority++}. 阵营配合：同一阵营有属性加成`);
  lines.push(`${spPriority++}. 兵种配合：同一兵种有增减伤的加成`);
  lines.push(`${spPriority++}. 武将-战法配对：选择与现有武将配对胜率高的战法`);
  lines.push(`${spPriority++}. 协同加成：利用武将和战法之间的协同效应`);
  lines.push(`${spPriority++}. 增益/负面状态配合：战法之间的buff/debuff联动`);
  lines.push(`${spPriority++}. 缘分(羁绊)：能触发缘分加成的武将优先`);
  lines.push('');
  lines.push('请给出你推荐的 1 名武将和 2 个战法，并详细说明理由。');

  return lines.join('\n');
}
