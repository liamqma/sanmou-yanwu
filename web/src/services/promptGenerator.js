/**
 * Generate a structured prompt for LLM analysis of the current game state.
 * The prompt is designed to be copied into ChatGPT or similar LLMs for
 * deeper reasoning about hero/skill selection.
 *
 * Focus priority: battle_stats > 阵营 > 兵种
 */
import database2 from '../database2.json';
import database3 from '../database3.json';
import battleStatsData from '../battle_stats.json';
import tips from '../tips.json';


/**
 * Format relevant tips for a list of heroes and skills.
 * Returns lines to include in the prompt, or empty array if no tips match.
 */
function formatRelevantTips(heroes, skills, options = {}) {
  // `requiredHeroes` (optional) restricts team_composition reverse-lookup so only
  // comps containing at least one hero from this set are emitted. Useful for the
  // support prompt where `heroes` includes the entire candidate pool (≈50+ heroes)
  // and an unrestricted `matchCount >= 1` would dump nearly every comp into the
  // prompt as noise. When omitted, falls back to matching against `heroes`.
  const { requiredHeroes } = options;
  const lines = [];
  const generalTips = tips.general || [];
  const heroTips = tips.heroes || {};
  const skillTips = tips.skills || {};
  const teamComps = tips.team_compositions || [];

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

  // Find team compositions relevant to the current heroes.
  // Use `requiredHeroes` (a hero subset, e.g. main team) when caller wants to filter
  // out comps that only intersect via the candidate pool. Default: filter by all heroes.
  const heroSet = new Set(heroes);
  const requiredHeroSet = requiredHeroes ? new Set(requiredHeroes) : null;
  const compLines = [];
  for (const comp of teamComps) {
    if (requiredHeroSet) {
      const reqMatch = comp.heroes.some(h => requiredHeroSet.has(h));
      if (!reqMatch) continue;
    } else {
      const matchCount = comp.heroes.filter(h => heroSet.has(h)).length;
      if (matchCount < 1) continue;
    }
    const matched = comp.heroes.filter(h => heroSet.has(h)).join('、');
    const note = comp.note ? `（${comp.note}）` : '';
    const meta = [];
    if (comp.slot) meta.push(`经济定位:${comp.slot}`);
    if (comp.awakening_dependency) meta.push(`红度影响:${comp.awakening_dependency}`);
    const metaStr = meta.length > 0 ? ` — ${meta.join(' / ')}` : '';
    compLines.push(`  [${comp.tier}] ${comp.heroes.join(' + ')}${note} — 强度: ${comp.strength}${metaStr} (已有: ${matched})`);
  }

  const hasContent = generalTips.length > 0 || heroLines.length > 0 || skillLines.length > 0 || compLines.length > 0;

  if (hasContent) {
    lines.push('【玩家心得（最高优先级，优先于战绩数据）】');
    if (generalTips.length > 0) {
      lines.push('  通用心得:');
      for (const tip of generalTips) {
        lines.push(`  - ${tip}`);
      }
    }
    if (compLines.length > 0) {
      lines.push('  已知强力阵容（当前武将可组成）:');
      lines.push(...compLines);
    }
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
 * Format game mechanics reference from database3 (formations).
 */
function formatGameMechanicsReference() {
  const lines = [];

  // Formations
  const formations = database3['阵型'] || {};
  if (Object.keys(formations).length > 0) {
    lines.push('【阵型参考】');
    for (const [name, desc] of Object.entries(formations)) {
      lines.push(`  ${name}: ${desc}`);
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
export async function generateLLMPrompt({
  gameState,
  currentRoundInputs,
  roundType,
  incremental = false,
  seenContext = {},
}) {
  const battleStats = battleStatsData;
  const lines = [];

  const seenHeroSet = new Set(seenContext.seenHeroes || []);
  const seenSkillSet = new Set(seenContext.seenSkills || []);
  const seenBondIdSet = new Set(seenContext.seenBondIds || []);
  // Only treat as a follow-up incremental prompt when the static reference
  // section was emitted in a prior round.
  const isIncremental = !!incremental && !!seenContext.staticShown;

  // Track entities that appear in this prompt so the caller can mark them seen.
  const newlySeenHeroes = new Set();
  const newlySeenSkills = new Set();
  const newlySeenBondIds = new Set();

  const renderHero = (hero) => {
    if (isIncremental && seenHeroSet.has(hero)) {
      return hero;
    }
    return formatHeroInfo(hero, database2);
  };
  const renderSkill = (skill) => {
    if (isIncremental && seenSkillSet.has(skill)) {
      return skill;
    }
    return formatSkillInfo(skill, database2);
  };

  // Merge support hero/skills into the current team for analysis.
  // Track which entries are support so we can flag them in the prompt
  // (支援位 has independent 红度, see tips.json 红度影响说明).
  const mainHeroes = gameState.current_heroes || [];
  const supportHero = gameState.support_hero || null;
  const mainSkills = gameState.current_skills || [];
  const supportSkills = gameState.support_skills || [];
  const mergedHeroes = [...mainHeroes, ...(supportHero ? [supportHero] : [])];
  const mergedSkills = [...mainSkills, ...supportSkills];
  const supportHeroSet = new Set(supportHero ? [supportHero] : []);
  const supportSkillSet = new Set(supportSkills);
  const heroRoleTag = (h) => (supportHeroSet.has(h) ? ' 【支援武将｜红度可独立设定】' : '');
  const skillRoleTag = (s) => (supportSkillSet.has(s) ? ' 【支援战法｜红度可独立设定】' : '');

  // ── Header ──
  lines.push('=== 三国谋定天下 - 战报选将分析 ===');
  lines.push('');
  if (isIncremental) {
    lines.push('(增量模式：静态参考、已见武将/战法说明、玩家通用心得与评估规则均已在前轮提供，本轮不再重复)');
    lines.push('');
  } else {
    lines.push('胜率指数说明: 使用Wilson置信区间下界，样本越少越保守，范围0-100%');
    lines.push('');
  }

  // ── Game context ──
  const roundTypeText = roundType === 'hero' ? '武将' : '战法';
  lines.push(`【当前状态】`);
  lines.push(`第 ${gameState.round_number} 轮 | 选择类型: ${roundTypeText}`);
  lines.push('');

  // ── Current team heroes ──
  lines.push('【已选武将】');
  lines.push('  说明：主队3名武将共享统一红度档位；支援武将（标注【支援武将】）红度可独立设定。');
  if (mergedHeroes.length > 0) {
    mergedHeroes.forEach((hero, i) => {
      lines.push(`  ${i + 1}. ${renderHero(hero)}${heroRoleTag(hero)}`);
      newlySeenHeroes.add(hero);
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
  if (mergedHeroes.length >= 2) {
    lines.push('【已选武将配对战绩】');
    const heroes = mergedHeroes;
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
  lines.push('  说明：主队战法与所属武将共享统一红度档位；支援战法（标注【支援战法】）红度可独立设定。');
  if (mergedSkills.length > 0) {
    mergedSkills.forEach((skill, i) => {
      lines.push(`  ${i + 1}. ${renderSkill(skill)}${skillRoleTag(skill)}`);
      newlySeenSkills.add(skill);
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

  const existingHeroes = mergedHeroes;
  const existingSkills = mergedSkills;

  sets.forEach((set, i) => {
    lines.push(`--- 第${i + 1}组 ---`);
    if (set.length === 0) {
      lines.push('  （空）');
    } else {
      // Show basic info
      set.forEach((item, j) => {
        if (roundType === 'hero') {
          lines.push(`  ${j + 1}. ${renderHero(item)}`);
          newlySeenHeroes.add(item);
        } else {
          lines.push(`  ${j + 1}. ${renderSkill(item)}`);
          newlySeenSkills.add(item);
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
    const bondsToShow = isIncremental
      ? bonds.filter(b => !seenBondIdSet.has(b.title))
      : bonds;
    if (bondsToShow.length > 0) {
      lines.push('【可触发缘分(羁绊)】');
      for (const bond of bondsToShow) {
        const condStr = bond.condition ? ` (${bond.condition})` : '';
        lines.push(`  ${bond.title}: ${bond.content}${condStr}`);
        lines.push(`    涉及武将: ${bond.matchedMembers.join(', ')}${bond.matchedMembers.length < bond.totalMembers ? ` (需${bond.totalMembers}人中至少满足条件)` : ''}`);
      }
      lines.push('');
    }
    for (const bond of bonds) {
      if (bond.title) newlySeenBondIds.add(bond.title);
    }
  }

  // ── Game mechanics reference (omitted in incremental mode) ──
  if (!isIncremental) {
    lines.push(...formatGameMechanicsReference());

    // ── Buff/Debuff reference ──
    lines.push(...formatBuffDebuffReference(database2));
    lines.push('');
  }

  // ── Player tips (highest priority) ──
  const allLLMHeroes = [...new Set([...mergedHeroes, ...sets.flat()])];
  const allLLMSkills = [...new Set([...mergedSkills, ...sets.flat()])];
  const tipHeroes = isIncremental
    ? allLLMHeroes.filter(h => !seenHeroSet.has(h))
    : allLLMHeroes;
  const tipSkills = isIncremental
    ? allLLMSkills.filter(s => !seenSkillSet.has(s))
    : allLLMSkills;
  const llmTips = formatRelevantTips(tipHeroes, tipSkills);
  // In incremental mode, drop the generic 通用心得 lines (already shown).
  const filteredTips = isIncremental
    ? llmTips.filter((line, idx, arr) => {
        if (line === '  通用心得:') return false;
        // Drop bullet lines that immediately follow the dropped 通用心得 header.
        // They start with '  - ' and only appear in the 通用 section.
        const prev = arr[idx - 1];
        if (line.startsWith('  - ') && (prev === '  通用心得:' || (prev && prev.startsWith('  - ')))) {
          return false;
        }
        return true;
      })
    : llmTips;
  lines.push(...filteredTips);

  // ── Instruction to LLM ──
  if (isIncremental) {
    lines.push('【请你分析】评估优先级和选择规则同前轮，请基于上述新增信息给出本轮推荐组（整组选入）。');
    lines.push('【输出要求】回答务必简明扼要：1) 直接给出推荐组号；2) 用 2-4 条要点说明关键理由；不要重复前轮已说明的通用规则，不要复述输入数据。');
  } else {
    lines.push('【请你分析】');
    lines.push('重要规则：你只能从三组中选择一组，选中后该组内的所有' + roundTypeText + '都会加入你的阵容。你不能从不同组各挑一个，也不能只选组内的某一个。请整组评估优劣。');
    lines.push('');
    lines.push('请根据以上信息，分析三组选项各自的优劣，按以下优先级考虑：');
    let priority = 1;
    if (filteredTips.length > 0) {
      lines.push(`${priority++}. 玩家心得：如有相关心得，必须最优先参考`);
    }
    lines.push(`${priority++}. 战绩数据：各武将/战法的胜率，配对胜率，三人组合胜率`);
    lines.push(`${priority++}. 阵营配合：同一阵营有属性加成`);
    lines.push(`${priority++}. 兵种配合：同一兵种有增减伤的加成`);
    lines.push(`${priority++}. 增益/负面状态配合：战法之间的buff/debuff联动`);
    lines.push(`${priority++}. 缘分(羁绊)：能触发缘分加成的武将组合优先`);
    lines.push('');
    lines.push('最终目的是组3个队伍，每个队伍3个武将，每个武将1个自带战法（固定）+ 2个战法。请给出你推荐选择哪一组（整组选入）。');
    lines.push('');
    lines.push('【输出要求】回答务必简明扼要：1) 用一句话给出推荐组号与结论；2) 用 3-5 条短要点说明关键理由（每条不超过 30 字）；3) 不要复述输入数据，不要长篇分析另外两组——只在必要时一句话指出它们的劣势。');
  }

  return {
    prompt: lines.join('\n'),
    newlySeen: {
      heroes: Array.from(newlySeenHeroes),
      skills: Array.from(newlySeenSkills),
      bondIds: Array.from(newlySeenBondIds),
    },
  };
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

  // ── Game mechanics reference ──
  lines.push(...formatGameMechanicsReference());

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
  lines.push('最终目的是组3个队伍，每个队伍3个武将，每个武将1个自带战法（固定）+ 2个战法。请给出3支队伍的具体配置（每队3武将+每人2战法）。');
  lines.push('');
  lines.push('【输出要求】回答务必简明扼要：1) 直接列出3支队伍的最终配置（武将+战法），用紧凑表格或列表形式；2) 每支队伍后用 2-3 条短要点说明定位与核心思路（每条不超过 40 字）；3) 不要复述输入数据，不要罗列被淘汰的备选方案。');

  return lines.join('\n');
}

