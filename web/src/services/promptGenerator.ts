/**
 * Generate a structured prompt for LLM analysis of the current game state.
 * The prompt is designed to be copied into ChatGPT or similar LLMs for
 * deeper reasoning about hero/skill selection.
 *
 * Focus priority: battle_stats > 阵营 > 兵种
 */
import { database, battleStats as battleStatsData } from '../data';
import {
  getConditionalHeroScore,
  getConditionalSkillScore,
} from './recommendationEngine';
import { heroPairKey, skillPairKey, skillHeroPairKey, heroComboKey } from './statKeys';
import type { GameState, RoundType } from '../types/game';
import type { BattleStats } from '../types/battleStats';

const PROMPT_INSTRUCTIONS = [
  '初始资源说明：初始1个武将和8个战法双方相同，提示中会用【初始】标注；评估时也要考虑对手可能拥有同样资源。',
  '战法强度说明：OP > T0 > T1+ > T1 > T2 > T3 > T4',
  '战法说明：伤害=直接输出；治疗=回复兵力；属性=属性增减幅度（点）；增伤=造成伤害提升%；减伤=受到伤害降低%；降伤=敌方造成伤害降低%；易伤=敌方受到伤害提升%；闪避=规避率%；攻心=按造成谋略伤害的比例回复自身兵力%；奇谋率=奇谋触发几率提升%；奇谋伤害=奇谋伤害提升%。',
  '胜率：经样本量置信修正，共N场为样本量。',
];

const ROUND_FOUR_HERO_TIP = '第4轮选将提醒：下一次选将要等到第7轮，不要只为未来阵容画饼；本轮武将应优先评估能否立刻与已有武将或同组选项成队。';


/**
 * Format relevant tips for a list of heroes and skills.
 * Returns lines to include in the prompt, or empty array if no tips match.
 */
function formatRelevantTips(selectedHeroes: string[], candidateHeroes: string[] = [], options: any = {}) {
  // Render the 【玩家心得】 block: known strong team compositions that overlap the
  // heroes currently in play.
  //
  // Heroes are split into two buckets so the LLM can tell apart what it already
  // owns vs. what is merely available to pick this round:
  //   - `selectedHeroes`  → already on the team, marked ✓
  //   - `candidateHeroes` → only available if the matching option set is chosen,
  //                         marked ◇
  //
  // Options:
  //   - `includeCandidateOnlyComps` (default false): when true, a comp is shown if
  //     it overlaps the selected OR candidate heroes (used at round 1, where almost
  //     nothing is selected yet). When false, a comp must overlap at least one
  //     SELECTED hero to be shown (focused, actionable — used at later rounds).
  //   - `requireAllOwned` (default false): when true, only show comps whose three
  //     heroes are ALL selected, and render with no ✓/◇ markers (used by the
  //     team-builder prompt, which has no notion of round candidates).
  const { requireAllOwned = false } = options;
  const lines: string[] = [];

  const selectedSet = new Set(selectedHeroes);
  const candidateSet = new Set(candidateHeroes);

  // Single source of truth for which comps are relevant + their ordering.
  const relevant = selectRelevantTeamComps(selectedHeroes, candidateHeroes, options);
  const compLines = relevant.map(({ comp }: any) => {
    const note = comp.note ? `（${comp.note}）` : '';
    const metaStr = comp.strengthRange ? ` — 强度范围:${comp.strengthRange}` : '';
    const heroStr = requireAllOwned
      ? comp.heroes.join(' + ')
      : comp.heroes
          .map((h: string) => (selectedSet.has(h) ? `${h}✓` : candidateSet.has(h) ? `${h}◇` : h))
          .join(' + ');
    return `  [${comp.tier}] ${heroStr}${note}${metaStr}`;
  });

  if (compLines.length === 0) return lines;

  lines.push('【玩家心得】');
  lines.push('  已知强力阵容:');
  if (!requireAllOwned) {
    lines.push('  标记: ✓=已选, ◇=本轮候选(选中该组才获得), 无标记=未拥有；强度范围=该队伍下限→上限战力。');
  } else {
    lines.push('  字段说明: 强度范围=该队伍下限→上限战力。');
  }
  lines.push(...compLines);
  lines.push('');

  return lines;
}

/**
 * Select the known strong team comps relevant to the heroes currently in play,
 * sorted most-actionable first (more already-selected heroes ⇒ higher).
 *
 * Shared by the LLM prompt (【玩家心得】) and the in-game 已知强力阵容 panel so the
 * two never diverge. See {@link formatRelevantTips} for the marker semantics.
 *
 * @returns {Array<{comp: Object, selectedCount: number, candidateCount: number}>}
 */
export function selectRelevantTeamComps(selectedHeroes: string[], candidateHeroes: string[] = [], options: any = {}) {
  const { includeCandidateOnlyComps = false, requireAllOwned = false } = options;
  const teamComps = database.team || [];

  const selectedSet = new Set(selectedHeroes);
  const candidateSet = new Set(candidateHeroes);

  const result = [];
  for (const comp of teamComps) {
    const selectedCount = comp.heroes.filter(h => selectedSet.has(h)).length;
    const candidateCount = comp.heroes.filter(h => candidateSet.has(h) && !selectedSet.has(h)).length;

    if (requireAllOwned) {
      // Team-builder: every hero must be owned.
      if (selectedCount !== comp.heroes.length) continue;
    } else if (includeCandidateOnlyComps) {
      // Round 1: at least one selected-or-candidate hero.
      if (selectedCount + candidateCount < 1) continue;
    } else {
      // Later rounds: at least one selected hero.
      if (selectedCount < 1) continue;
    }

    result.push({ comp, selectedCount, candidateCount });
  }

  // Surface the comps closest to completion first (more owned heroes = more actionable).
  result.sort((a, b) => b.selectedCount - a.selectedCount);
  return result;
}


/**
 * Format a hero's info from the merged database into a readable string.
 *
 * New schema (per hero):
 *   { skill, camp, troop, stats: {wl,zl,ts,xg}, bonds: [] }
 *
 * `stats` are already the level-50 max attributes (materialised at merge time).
 */
function formatHeroInfo(heroName: string) {
  const hero = database.heroes?.[heroName];
  if (!hero) return heroName;

  const parts = [
    `${heroName}`,
    `阵营:${hero.camp}`,
    `兵种:${hero.troop}`,
    ...(hero.label && typeof hero.rank === 'number' ? [`定位:${hero.label}排名第${hero.rank}`] : []),
  ];

  // 自带战法 - signature skill. Reuse formatSkillInfo so estimate fields render
  // consistently with non-signature skills (类型/发动概率 are intentionally omitted).
  const skillData = database.skills?.[hero.skill];
  if (skillData) {
    parts.push(`自带战法:${formatSkillInfoEstimates(hero.skill)}`);
  } else {
    parts.push(`自带战法:${hero.skill}`);
  }

  return parts.join(' | ');
}

/**
 * Format a skill's info from the merged database into a readable string.
 *
 * New schema (per skill): `{ color, type, prob, desc }`. Hero-exclusivity is
 * derived from the inverse index `heroes[*].skill` — built once below.
 */
const HERO_OF_SKILL = (() => {
  const map: Record<string, string> = {};
  for (const [hname, h] of Object.entries(database.heroes || {})) {
    if (h && h.skill) map[h.skill] = hname;
  }
  return map;
})();

const SKILL_ESTIMATES = [
  ['damageEstimate', '伤害'],
  ['healingEstimate', '治疗'],
  ['attributeEstimate', '属性'],
  ['damageBoostEstimate', '增伤'],
  ['damageReductionEstimate', '减伤'],
  ['damageDealtReductionEstimate', '降伤'],
  ['damageTakenIncreaseEstimate', '易伤'],
  ['evasionEstimate', '闪避'],
  ['lifestealEstimate', '攻心'],
  ['critEstimate', '奇谋率'],
  ['critDamageEstimate', '奇谋伤害'],
];

/**
 * Render a skill's name followed by its estimate fields (伤害/治疗/...).
 * Shared by formatSkillInfo and the signature-skill rendering in formatHeroInfo.
 */
function formatSkillInfoEstimates(skillName: string) {
  const skill: any = database.skills?.[skillName];
  if (!skill) return skillName;
  const parts = [`${skillName}`];
  for (const [key, label] of SKILL_ESTIMATES) {
    if (skill[key] !== undefined) parts.push(`${label}:${skill[key]}`);
  }
  return parts.join(' ');
}

function formatSkillInfo(skillName: string) {
  const skill: any = database.skills?.[skillName];
  if (!skill) return skillName;

  const parts = [`${skillName}`];
  const owner = HERO_OF_SKILL[skillName];
  if (owner) parts.push(`自带战法:${owner}`);
  if (skill.tier) parts.push(`强度:${skill.tier}`);
  if (skill.note) parts.push(`备注:${skill.note}`);
  const estimates = SKILL_ESTIMATES
    .filter(([key]) => skill[key] !== undefined)
    .map(([key, label]) => `${label}:${skill[key]}`);
  if (estimates.length > 0) parts.push(estimates.join(' '));
  return parts.join(' | ');
}

/**
 * Get battle stats summary for a hero.
 */
function getHeroBattleStats(heroName: string, battleStats: BattleStats) {
  const stats = battleStats.hero_stats?.[heroName];
  if (!stats) return null;
  return { wins: stats.wins, losses: stats.losses, total: stats.total, winRate: stats.wilson };
}

/**
 * Get battle stats summary for a skill.
 */
function getSkillBattleStats(skillName: string, battleStats: BattleStats) {
  const stats = battleStats.skill_stats?.[skillName];
  if (!stats) return null;
  return { wins: stats.wins, losses: stats.losses, total: stats.total, winRate: stats.wilson };
}

/**
 * Get relevant hero pair stats for a hero with existing team heroes.
 */
function getHeroPairStats(heroName: string, existingHeroes: string[], battleStats: BattleStats) {
  const pairs: any[] = [];
  for (const existing of existingHeroes) {
    const stats = battleStats.hero_pair_stats?.[heroPairKey(heroName, existing)];
    if (stats) {
      pairs.push({ partner: existing, wins: stats.wins, losses: stats.losses, winRate: stats.wilson });
    }
  }
  return pairs;
}

/**
 * Get relevant skill-hero pair stats for a skill with existing team heroes.
 */
function getSkillHeroPairStats(skillName: string, existingHeroes: string[], battleStats: BattleStats) {
  const pairs: any[] = [];
  for (const hero of existingHeroes) {
    const stats = battleStats.skill_hero_pair_stats?.[skillHeroPairKey(hero, skillName)];
    if (stats) {
      pairs.push({ hero, wins: stats.wins, losses: stats.losses, winRate: stats.wilson });
    }
  }
  return pairs;
}

/**
 * Get relevant skill pair stats for a skill with existing team skills.
 */
function getSkillPairStats(skillName: string, existingSkills: string[], battleStats: BattleStats) {
  const pairs: any[] = [];
  for (const existing of existingSkills) {
    const stats = battleStats.skill_pair_stats?.[skillPairKey(skillName, existing)];
    if (stats) {
      pairs.push({ partner: existing, wins: stats.wins, losses: stats.losses, winRate: stats.wilson });
    }
  }
  return pairs;
}

/**
 * Get hero combination stats (3-hero team) if it exists.
 */
function getHeroCombinationStats(heroes: string[], battleStats: BattleStats) {
  if (heroes.length < 3) return null;
  // hero_combinations keys are stored sorted (see statKeys), so one lookup suffices.
  const key = heroComboKey(heroes);
  const stats = battleStats.hero_combinations?.[key];
  return stats ? { key, ...stats } : null;
}

/**
 * Get synergy data for a hero.
 */
function getHeroSynergyPartners(heroName: string, battleStats: BattleStats) {
  const synergy = battleStats.hero_synergy_stats?.[heroName];
  if (!synergy?.synergy_partners?.length) return [];
  return synergy.synergy_partners.slice(0, 5);
}

/**
 * Get synergy data for a skill (which heroes it synergizes with).
 */
function getSkillSynergyHeroes(skillName: string, battleStats: BattleStats) {
  const synergy = battleStats.skill_synergy_stats?.[skillName];
  if (!synergy?.has_significant_synergy || !synergy?.synergy_heroes?.length) return [];
  return synergy.synergy_heroes.slice(0, 5);
}

/**
 * Render an adjustment annotation derived from the recommendation engine's
 * context-aware conditional score. Returns a short Chinese label or '' when
 * no meaningful adjustment was applied.
 *
 * The conditional score may either:
 *   - Boost when a known synergy partner is on the team (Case 1)
 *   - Deflate when key partners are MISSING and combined game share ≥ 0.3 (Case 2)
 *   - Leave raw wilson untouched otherwise
 */
function formatAdjustmentAnnotation(result: any) {
  if (!result || !result.adjusted) return '';
  const rawPct = (result.rawWilson * 100).toFixed(1);
  const adjPct = (result.score * 100).toFixed(1);
  const delta = (result.score - result.rawWilson) * 100;
  const sign = delta >= 0 ? '+' : '';
  const reason = result.reason || '';

  if (reason.startsWith('synergy_boost_from_')) {
    const partner = reason.replace('synergy_boost_from_', '');
    const d = result.details || {};
    const pairPct = d.pairWilson != null ? (d.pairWilson * 100).toFixed(1) : '?';
    return `调整后胜率${adjPct}% (原${rawPct}%, ${sign}${delta.toFixed(1)}%) — 队内已有协同搭档【${partner}】(配对胜率${pairPct}%)`;
  }
  if (reason.startsWith('missing_key_partners_')) {
    const missing = reason.replace('missing_key_partners_', '');
    const share = result.details?.combinedGameShare != null
      ? (result.details.combinedGameShare * 100).toFixed(0) + '%'
      : '?';
    return `调整后胜率${adjPct}% (原${rawPct}%, ${sign}${delta.toFixed(1)}%) — 缺少关键搭档【${missing}】(关键搭档历史出场占比${share}, 单飞胜率会下滑)`;
  }
  if (reason.startsWith('missing_key_heroes_')) {
    const missing = reason.replace('missing_key_heroes_', '');
    const share = result.details?.combinedGameShare != null
      ? (result.details.combinedGameShare * 100).toFixed(0) + '%'
      : '?';
    return `调整后胜率${adjPct}% (原${rawPct}%, ${sign}${delta.toFixed(1)}%) — 缺少关键带战法武将【${missing}】(关键武将历史出场占比${share})`;
  }
  return `调整后胜率${adjPct}% (原${rawPct}%, ${sign}${delta.toFixed(1)}%)`;
}

/**
 * Format battle stats context for a set of heroes.
 */
function formatHeroSetBattleContext(heroes: string[], existingHeroes: string[], existingSkills: string[], battleStats: BattleStats) {
  const lines: string[] = [];
  for (const heroName of heroes) {
    const stats = getHeroBattleStats(heroName, battleStats);
    if (stats) {
      lines.push(`    ${heroName}: 共${stats.total}场, 胜率${(stats.winRate * 100).toFixed(1)}%`);
    }

    // Candidate groups are drafted as a whole, so evaluate each candidate with both
    // already-selected heroes and the other heroes from the same candidate set.
    const sameSetPeers = heroes.filter((h) => h !== heroName);
    const contextHeroes = [...new Set([...existingHeroes, ...sameSetPeers])];

    // Context-aware adjusted score (boost / deflation based on synergy partners)
    const condResult = getConditionalHeroScore(
      heroName,
      contextHeroes,
      battleStats.hero_stats || {},
      battleStats.hero_synergy_stats || {},
    );
    const annotation = formatAdjustmentAnnotation(condResult);
    if (annotation) {
      lines.push(`      ${annotation}`);
    }

    // Pair stats with already-selected heroes and same-set peers
    const pairs = getHeroPairStats(heroName, contextHeroes, battleStats);
    if (pairs.length > 0) {
      for (const p of pairs) {
        lines.push(`      与${p.partner}配对: 共${p.wins + p.losses}场, 胜率${(p.winRate * 100).toFixed(1)}%`);
      }
    }

    // Pair stats with existing skills (how this candidate hero performs with already-selected skills)
    const skillPairs = getSkillHeroPairStats(heroName, existingSkills, battleStats);
    if (skillPairs.length > 0) {
      for (const p of skillPairs) {
        lines.push(`      与战法${p.hero}配对: 共${p.wins + p.losses}场, 胜率${(p.winRate * 100).toFixed(1)}%`);
      }
    }

    // Check synergy with already-selected heroes and same-set peers
    const synergy = getHeroSynergyPartners(heroName, battleStats);
    const relevantSynergy = synergy.filter((s) => contextHeroes.includes(s.partner));
    if (relevantSynergy.length > 0) {
      for (const s of relevantSynergy) {
        lines.push(`      与${s.partner}协同加成: +${(s.synergy_boost * 100).toFixed(1)}%`);
      }
    }

    // Check potential 3-hero combinations with already-selected heroes and same-set peers
    if (contextHeroes.length >= 2) {
      for (let i = 0; i < contextHeroes.length; i++) {
        for (let j = i + 1; j < contextHeroes.length; j++) {
          const combo = getHeroCombinationStats([heroName, contextHeroes[i], contextHeroes[j]], battleStats);
          if (combo) {
            lines.push(`      三人组合[${heroName},${contextHeroes[i]},${contextHeroes[j]}]: 共${combo.wins + combo.losses}场, 胜率${(combo.wilson * 100).toFixed(1)}%`);
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
function formatSkillSetBattleContext(skills: string[], existingHeroes: string[], existingSkills: string[], battleStats: BattleStats) {
  const lines: string[] = [];
  for (const skillName of skills) {
    const stats = getSkillBattleStats(skillName, battleStats);
    if (stats) {
      lines.push(`    ${skillName}: 共${stats.total}场, 胜率${(stats.winRate * 100).toFixed(1)}%`);
    }

    // Context-aware adjusted score (boost / deflation based on hero dependency)
    const condResult = getConditionalSkillScore(
      skillName,
      existingHeroes,
      battleStats.skill_stats || {},
      battleStats.skill_synergy_stats || {},
    );
    const annotation = formatAdjustmentAnnotation(condResult);
    if (annotation) {
      lines.push(`      ${annotation}`);
    }

    // Skill-hero pair stats with existing heroes
    const heroPairs = getSkillHeroPairStats(skillName, existingHeroes, battleStats);
    if (heroPairs.length > 0) {
      for (const p of heroPairs) {
        lines.push(`      与武将${p.hero}配对: 共${p.wins + p.losses}场, 胜率${(p.winRate * 100).toFixed(1)}%`);
      }
    }

    // Skill pair stats with existing skills
    const skillPairs = getSkillPairStats(skillName, existingSkills, battleStats);
    if (skillPairs.length > 0) {
      for (const p of skillPairs) {
        lines.push(`      与战法${p.partner}配对: 共${p.wins + p.losses}场, 胜率${(p.winRate * 100).toFixed(1)}%`);
      }
    }

    // Skill synergy with existing heroes (which existing heroes this skill boosts)
    const synergyHeroes = getSkillSynergyHeroes(skillName, battleStats);
    const relevantSynergy = synergyHeroes.filter((s) => existingHeroes.includes(s.hero));
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
}: { gameState: GameState; currentRoundInputs: any; roundType: RoundType }): Promise<string> {
  const battleStats = battleStatsData;
  const lines: string[] = [];

  const renderHero = (hero: string) => formatHeroInfo(hero);
  const renderSkill = (skill: string) => formatSkillInfo(skill);

  // Merge support hero/skills into the current team for analysis.
  // Track which entries are support so we can flag them in the prompt
  // (支援位 has independent 红度).
  const mainHeroes = gameState.current_heroes || [];
  const supportHero = gameState.support_hero || null;
  const mainSkills = gameState.current_skills || [];
  const supportSkills = gameState.support_skills || [];
  const mergedHeroes = [...mainHeroes, ...(supportHero ? [supportHero] : [])];
  const mergedSkills = [...mainSkills, ...supportSkills];
  const supportHeroSet = new Set(supportHero ? [supportHero] : []);
  const supportSkillSet = new Set(supportSkills);
  const initialHeroSet = new Set(mainHeroes.slice(0, 1));
  const initialSkillSet = new Set(mainSkills.slice(0, 8));
  const heroRoleTag = (h: string) => {
    const tags = [
      supportHeroSet.has(h) ? '支援' : null,
      initialHeroSet.has(h) ? '初始' : null,
    ].filter(Boolean).map(tag => `【${tag}】`).join('');
    return tags ? ` | ${tags}` : '';
  };
  const skillRoleTag = (s: string) => {
    const tags = [
      supportSkillSet.has(s) ? '支援' : null,
      initialSkillSet.has(s) ? '初始' : null,
    ].filter(Boolean).map(tag => `【${tag}】`).join('');
    return tags ? ` | ${tags}` : '';
  };

  // ── Header ──
  lines.push('=== 三国谋定天下 - 战报选将分析 ===');
  lines.push('');
  lines.push('【说明】');
  for (const instruction of PROMPT_INSTRUCTIONS) {
    lines.push(`- ${instruction}`);
  }
  lines.push('- 调整后胜率：按当前队内关键协同搭档加权。');
  lines.push('');

  // ── Game context ──
  const roundTypeText = roundType === 'hero' ? '武将' : '战法';
  lines.push(`【当前状态】`);
  lines.push(`第 ${gameState.round_number} 轮 | 选择类型: ${roundTypeText}`);
  if (roundType === 'hero' && gameState.round_number === 4) {
    lines.push(`提示：${ROUND_FOUR_HERO_TIP}`);
  }
  lines.push('');

  // ── Current team heroes ──
  lines.push('【已选武将】');
  if (mergedHeroes.length > 0) {
    mergedHeroes.forEach((hero, i) => {
      lines.push(`  ${i + 1}. ${renderHero(hero)}${heroRoleTag(hero)}`);
      const stats = getHeroBattleStats(hero, battleStats);
      if (stats) {
        lines.push(`     战绩: 共${stats.total}场, 胜率${(stats.winRate * 100).toFixed(1)}%`);
      }
    });
  } else {
    lines.push('  （无）');
  }
  lines.push('');

  // ── Current hero pair stats ──
  if (mergedHeroes.length >= 2) {
    lines.push('【已选武将配对胜率】');
    const heroes = mergedHeroes;
    for (let i = 0; i < heroes.length; i++) {
      for (let j = i + 1; j < heroes.length; j++) {
        const stats = battleStats.hero_pair_stats?.[heroPairKey(heroes[i], heroes[j])];
        if (stats) {
          lines.push(`  ${heroes[i]}+${heroes[j]}: 共${stats.wins + stats.losses}场, 胜率${(stats.wilson * 100).toFixed(1)}%`);
        }
      }
    }
    lines.push('');
  }

  // ── Current team skills ──
  lines.push('【已选战法】');
  if (mergedSkills.length > 0) {
    mergedSkills.forEach((skill, i) => {
      lines.push(`  ${i + 1}. ${renderSkill(skill)}${skillRoleTag(skill)}`);
      const stats = getSkillBattleStats(skill, battleStats);
      if (stats) {
        lines.push(`     战绩: 共${stats.total}场, 胜率${(stats.winRate * 100).toFixed(1)}%`);
      }
    });
  } else {
    lines.push('  （无）');
  }
  lines.push('');

  // ── The 3 option sets with battle stats ──
  lines.push(`【本轮三组可选${roundTypeText}及胜率数据】`);
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
      set.forEach((item: string, j: number) => {
        if (roundType === 'hero') {
          lines.push(`  ${j + 1}. ${renderHero(item)}`);
        } else {
          lines.push(`  ${j + 1}. ${renderSkill(item)}`);
        }
      });

      // Show battle stats context
      lines.push('  [胜率数据]');
      let battleLines;
      if (roundType === 'hero') {
        battleLines = formatHeroSetBattleContext(set, existingHeroes, existingSkills, battleStats);
      } else {
        battleLines = formatSkillSetBattleContext(set, existingHeroes, existingSkills, battleStats);
      }
      if (battleLines.length > 0) {
        lines.push(...battleLines);
      } else {
        lines.push('    （无相关胜率数据）');
      }
    }
    lines.push('');
  });


  // ── Player tips ──
  // Tips are hero team-composition guidance, so they're only relevant when
  // choosing heroes. Skip them entirely in skill rounds (the empty list also
  // drops the 玩家心得 priority line below, keeping the two in sync).
  // Selected heroes are marked ✓ and this round's candidates ◇. At round 1 we
  // also surface comps reachable purely via candidates (nothing is selected yet);
  // from round 2 on we only show comps that already contain a selected hero.
  const candidateHeroes = roundType === 'hero' ? [...new Set(sets.flat())] : [];
  const llmTips = roundType === 'hero'
    ? formatRelevantTips(mergedHeroes, candidateHeroes, {
        includeCandidateOnlyComps: gameState.round_number === 1,
      })
    : [];
  lines.push(...llmTips);

  // ── Instruction to LLM ──
  lines.push('【请你分析】');
  lines.push('你只能从三组中选择一组，选中后该组内的所有' + roundTypeText + '都会加入你的阵容。');
  lines.push('');
  lines.push('请根据以上信息，分析三组选项各自的优劣，按以下优先级考虑：');
  let priority = 1;
  if (roundType === 'hero') {
    lines.push(`${priority++}. 排名：定位(体系核心/输出核心/输出辅助/功能辅助)排名越靠前越强（同定位内比较）`);
  } else {
    lines.push(`${priority++}. 强度：OP > T0 > T1+ > T1 > T2 > T3 > T4`);
  }
  lines.push(`${priority++}. 胜率：各武将/战法的胜率，配对胜率，三人组合胜率`);
  if (llmTips.length > 0) {
    lines.push(`${priority++}. 玩家心得`);
  }
  lines.push(`${priority++}. 战法预估（伤害/治疗/属性/增伤/减伤/降伤/易伤/闪避/攻心/奇谋率/奇谋伤害）`);
  if (roundType === 'hero') {
    lines.push(`${priority++}. 阵营/兵种：可作为同分时的加分项`);
  }
  lines.push('');
  const shouldPlanTeams = gameState.round_number >= 4;
  lines.push('最终目的是组3个队伍，每个队伍3个武将（每队至少1个输出核心），每个武将1个自带战法（固定）+ 2个战法。请给出你推荐选择哪一组。');
  if (shouldPlanTeams) {
    lines.push('从第4轮开始，请同时给出当前可组成的3队规划；如果战法数量不足，对应战法位留空即可。');
  }
  lines.push('');
  if (shouldPlanTeams) {
    lines.push('【输出要求】1) 分析每一组（第1组、第2组、第3组）的优劣；2) 给出最终推荐；3) 给出3个队伍的暂定配置（每队3武将，每名武将列出自带战法+最多2个已拥有战法，缺少的战法位留空）。回答务必简明扼要。');
  } else {
    lines.push('【输出要求】分析每一组（第1组、第2组、第3组）的优劣，再给出最终推荐。回答务必简明扼要。');
  }

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
export async function generateTeamBuilderPrompt(heroes: string[], skills: string[]): Promise<string> {
  const battleStats = battleStatsData;
  const lines: string[] = [];

  // ── Header ──
  lines.push('=== 三国谋定天下 - 组队分析 ===');
  lines.push('');
  lines.push('【说明】');
  for (const instruction of PROMPT_INSTRUCTIONS) {
    lines.push(`- ${instruction}`);
  }
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
    lines.push(`  ${formatHeroInfo(hero)}`);
    const stats = getHeroBattleStats(hero, battleStats);
    if (stats) {
      lines.push(`    战绩: 共${stats.total}场, 胜率${(stats.winRate * 100).toFixed(1)}%`);
    }
    // Show synergy partners that are also in the pool
    const synergy = getHeroSynergyPartners(hero, battleStats);
    const relevantSynergy = synergy.filter(s => heroes.includes(s.partner));
    if (relevantSynergy.length > 0) {
      for (const s of relevantSynergy) {
        lines.push(`    协同: 与${s.partner}配对胜率${(s.pair_wilson * 100).toFixed(1)}%, 加成+${(s.synergy_boost * 100).toFixed(1)}%`);
      }
    }
  }
  lines.push('');

  // ── Hero pair stats (only pairs within the pool) ──
  const heroPairStats = battleStats.hero_pair_stats || {};
  const pairLines = [];
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      const stats = heroPairStats[heroPairKey(heroes[i], heroes[j])];
      if (stats) {
        const total = stats.wins + stats.losses;
        if (total >= 3) {
          pairLines.push(`  ${heroes[i]}+${heroes[j]}: 共${stats.wins + stats.losses}场, 胜率${(stats.wilson * 100).toFixed(1)}%`);
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
          const stats = heroCombinations[heroComboKey(trio)];
          if (stats) {
            const total = stats.wins + stats.losses;
            if (total >= 2) {
              comboLines.push({
                text: `  ${trio.join('+')}:  共${stats.wins + stats.losses}场, 胜率${(stats.wilson * 100).toFixed(1)}%`,
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
    lines.push('【三武将组合战绩】(样本≥2, 按胜率排序)');
    for (const c of comboLines.slice(0, 30)) {
      lines.push(c.text);
    }
    lines.push('');
  }

  // ── Skill pool with stats ──
  lines.push('【战法池】');
  for (const skill of skills) {
    lines.push(`  ${formatSkillInfo(skill)}`);
    const stats = getSkillBattleStats(skill, battleStats);
    if (stats) {
      lines.push(`    战绩: 共${stats.total}场, 胜率${(stats.winRate * 100).toFixed(1)}%`);
    }
    // Show synergy with heroes in the pool
    const synergyHeroes = getSkillSynergyHeroes(skill, battleStats);
    const relevantSynergy = synergyHeroes.filter(s => heroes.includes(s.hero));
    if (relevantSynergy.length > 0) {
      for (const s of relevantSynergy) {
        lines.push(`    协同: 与${s.hero}配对胜率${(s.pair_wilson * 100).toFixed(1)}%, 加成+${(s.synergy_boost * 100).toFixed(1)}%`);
      }
    }
  }
  lines.push('');

  // ── Skill-hero pair stats (top pairs within the pool) ──
  const skillHeroPairStats = battleStats.skill_hero_pair_stats || {};
  const shPairLines = [];
  for (const hero of heroes) {
    for (const skill of skills) {
      const stats = skillHeroPairStats[skillHeroPairKey(hero, skill)];
      if (stats) {
        const total = stats.wins + stats.losses;
        if (total >= 3) {
          shPairLines.push({
            text: `  ${hero}+${skill}: 共${stats.wins + stats.losses}场, 胜率${(stats.wilson * 100).toFixed(1)}%`,
            wilson: stats.wilson ?? 0,
          });
        }
      }
    }
  }
  if (shPairLines.length > 0) {
    shPairLines.sort((a, b) => b.wilson - a.wilson);
    lines.push('【武将-战法配对战绩】(样本≥3, 按胜率排序, 前40)');
    for (const p of shPairLines.slice(0, 40)) {
      lines.push(p.text);
    }
    lines.push('');
  }


  // ── Player tips ──
  // The team-builder has no round/candidate concept: every pool hero is "owned".
  // Only surface comps whose three heroes are all in the pool, rendered without
  // ✓/◇ markers.
  const teamTips = formatRelevantTips(heroes, [], { requireAllOwned: true });
  lines.push(...teamTips);

  // ── Instructions ──
  lines.push('【请你分析】');
  lines.push('请根据以上数据，组建3支最优队伍，按以下优先级考虑：');
  let tbPriority = 1;
  lines.push(`${tbPriority++}. 排名：定位(体系核心/输出核心/输出辅助/功能辅助)排名越靠前越强（同定位内比较）`);
  lines.push(`${tbPriority++}. 胜率：三人组合战绩、武将配对/武将-战法配对，优先选择历史胜率高的组合`);
  if (teamTips.length > 0) {
    lines.push(`${tbPriority++}. 玩家心得`);
  }
  lines.push(`${tbPriority++}. 战法预估（伤害/治疗/属性/增伤/减伤/降伤/易伤/闪避/攻心/奇谋率/奇谋伤害）`);
  lines.push(`${tbPriority++}. 协同/阵营/兵种：作为队伍成型与同分加分项`);
  lines.push('');
  lines.push('最终目的是组3个队伍，每个队伍3个武将（每队至少1个输出核心），每个武将1个自带战法（固定）+ 2个战法。请给出3支队伍的具体配置（每队3武将+每人2战法）。');
  lines.push('');
  lines.push('【输出要求】回答务必简明扼要：1) 直接列出3支队伍的最终配置（武将+战法），用紧凑表格或列表形式；2) 每支队伍后用 2-3 条短要点说明定位与核心思路（每条不超过 40 字）；3) 不要复述输入数据，不要罗列被淘汰的备选方案。');

  return lines.join('\n');
}

