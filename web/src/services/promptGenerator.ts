/**
 * Generate a structured prompt for LLM analysis of the current game state.
 * The prompt is copied into ChatGPT-style LLMs for deeper reasoning about
 * hero/skill selection.
 *
 * Data comes from the offline paired model artifact (`recommendation_data.json`)
 * via `recommendationEngine`/`recommendationModel`: instead of the old Wilson
 * win-rate maps, the prompt surfaces the model's *relative roster-strength*
 * contributions (hero/skill weights, hero-pair and hero-skill synergies) plus
 * the descriptive smoothed win rates and each item's evidence (support count).
 * A weight is a relative strength contribution, NOT an opponent win probability.
 */
import { database, recommendationData } from '../data';
import {
  weightOf,
  supportOf,
  heroId,
  skillId,
  heroPairId,
  heroSkillId,
} from './recommendationModel';
import type { GameState, RoundType } from '../types/game';
import type { AnalyticsRow } from '../types/recommendation';

const PROMPT_INSTRUCTIONS = [
  '初始资源说明：初始1个武将和8个战法双方相同，提示中会用【初始】标注；评估时也要考虑对手可能拥有同样资源。',
  '战法强度说明：OP > T0 > T1+ > T1 > T2 > T3 > T4',
  '战法说明：伤害=直接输出；治疗=回复兵力；属性=属性增减幅度（点）；增伤=造成伤害提升%；减伤=受到伤害降低%；降伤=敌方造成伤害降低%；易伤=敌方受到伤害提升%；闪避=规避率%；攻心=按造成谋略伤害的比例回复自身兵力%；奇谋率=奇谋触发几率提升%；奇谋伤害=奇谋伤害提升%。',
  '模型说明：相对强度=成对（对手感知）逻辑回归拟合的权重，越高代表该单位/组合让阵容相对更强，非对特定对手的胜率；证据=该特征在历史对局中出现的场次。',
];

const ROUND_FOUR_HERO_TIP = '第4轮选将提醒：下一次选将要等到第7轮，不要只为未来阵容画饼；本轮武将应优先评估能否立刻与已有武将或同组选项成队。';

const model = recommendationData.model;
const analytics = recommendationData.analytics;

const HERO_ANALYTICS: Record<string, AnalyticsRow> = Object.fromEntries(
  analytics.heroes.map((r) => [r.name, r])
);
const SKILL_ANALYTICS: Record<string, AnalyticsRow> = Object.fromEntries(
  analytics.skills.map((r) => [r.name, r])
);

const fmtWeight = (w: number): string => (w >= 0 ? '+' : '') + (w * 10).toFixed(1);

// --------------------------------------------------------------------------- #
// Team-composition tips (unchanged: reads database.team)
// --------------------------------------------------------------------------- #

export function selectRelevantTeamComps(selectedHeroes: string[], candidateHeroes: string[] = [], options: any = {}) {
  const { includeCandidateOnlyComps = false, requireAllOwned = false } = options;
  const teamComps = database.team || [];

  const selectedSet = new Set(selectedHeroes);
  const candidateSet = new Set(candidateHeroes);

  const result = [];
  for (const comp of teamComps) {
    const selectedCount = comp.heroes.filter((h) => selectedSet.has(h)).length;
    const candidateCount = comp.heroes.filter((h) => candidateSet.has(h) && !selectedSet.has(h)).length;

    if (requireAllOwned) {
      if (selectedCount !== comp.heroes.length) continue;
    } else if (includeCandidateOnlyComps) {
      if (selectedCount + candidateCount < 1) continue;
    } else {
      if (selectedCount < 1) continue;
    }
    result.push({ comp, selectedCount, candidateCount });
  }
  result.sort((a, b) => b.selectedCount - a.selectedCount);
  return result;
}

function formatRelevantTips(selectedHeroes: string[], candidateHeroes: string[] = [], options: any = {}) {
  const { requireAllOwned = false } = options;
  const lines: string[] = [];
  const selectedSet = new Set(selectedHeroes);
  const candidateSet = new Set(candidateHeroes);

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

// --------------------------------------------------------------------------- #
// Database formatting (unchanged)
// --------------------------------------------------------------------------- #

function formatHeroInfo(heroName: string) {
  const hero = database.heroes?.[heroName];
  if (!hero) return heroName;
  const parts = [
    `${heroName}`,
    `阵营:${hero.camp}`,
    `兵种:${hero.troop}`,
    ...(hero.label && typeof hero.rank === 'number' ? [`定位:${hero.label}排名第${hero.rank}`] : []),
  ];
  const skillData = database.skills?.[hero.skill];
  if (skillData) {
    parts.push(`自带战法:${formatSkillInfoEstimates(hero.skill)}`);
  } else {
    parts.push(`自带战法:${hero.skill}`);
  }
  return parts.join(' | ');
}

const HERO_OF_SKILL = (() => {
  const map: Record<string, string> = {};
  for (const [hname, h] of Object.entries(database.heroes || {})) {
    if (h && h.skill) map[h.skill] = hname;
  }
  return map;
})();

const SKILL_ESTIMATES: [string, string][] = [
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

// --------------------------------------------------------------------------- #
// Model-derived accessors (replace the old Wilson maps)
// --------------------------------------------------------------------------- #

/** Descriptive usage line for a hero: games + smoothed win rate + model weight. */
function heroStatLine(hero: string): string | null {
  const row = HERO_ANALYTICS[hero];
  const w = weightOf(model, heroId(hero));
  if (!row && w === 0) return null;
  const bits: string[] = [];
  if (row) bits.push(`共${row.total}场, 平滑胜率${(row.smoothed_win_rate * 100).toFixed(1)}%`);
  bits.push(`相对强度${fmtWeight(w)}`);
  return bits.join(', ');
}

function skillStatLine(skill: string): string | null {
  const row = SKILL_ANALYTICS[skill];
  const w = weightOf(model, skillId(skill));
  if (!row && w === 0) return null;
  const bits: string[] = [];
  if (row) bits.push(`共${row.total}场, 平滑胜率${(row.smoothed_win_rate * 100).toFixed(1)}%`);
  bits.push(`相对强度${fmtWeight(w)}`);
  return bits.join(', ');
}

/** Hero-pair synergy lines (model HP weight) between hero and each existing hero. */
function heroPairLines(hero: string, existingHeroes: string[], indent: string): string[] {
  const lines: string[] = [];
  for (const other of existingHeroes) {
    if (other === hero) continue;
    const fid = heroPairId(hero, other);
    const w = weightOf(model, fid);
    if (w !== 0) {
      lines.push(`${indent}与${other}配对: 相对强度${fmtWeight(w)} (证据${supportOf(model, fid)}场)`);
    }
  }
  return lines;
}

/** Hero-skill synergy lines (model HS weight) between a skill and each hero. */
function skillHeroLines(skill: string, heroes: string[], indent: string): string[] {
  const lines: string[] = [];
  for (const hero of heroes) {
    const fid = heroSkillId(hero, skill);
    const w = weightOf(model, fid);
    if (w !== 0) {
      lines.push(`${indent}与武将${hero}配合: 相对强度${fmtWeight(w)} (证据${supportOf(model, fid)}场)`);
    }
  }
  return lines;
}

/** Best hero-skill lines for a candidate hero over already-owned skills. */
function heroSkillLines(hero: string, skills: string[], indent: string): string[] {
  const lines: string[] = [];
  for (const skill of skills) {
    const fid = heroSkillId(hero, skill);
    const w = weightOf(model, fid);
    if (w > 0) {
      lines.push(`${indent}携带${skill}: 相对强度${fmtWeight(w)} (证据${supportOf(model, fid)}场)`);
    }
  }
  return lines;
}

// --------------------------------------------------------------------------- #
// Round prompt
// --------------------------------------------------------------------------- #

export async function generateLLMPrompt({
  gameState,
  currentRoundInputs,
  roundType,
}: { gameState: GameState; currentRoundInputs: any; roundType: RoundType }): Promise<string> {
  const lines: string[] = [];

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
    const tags = [supportHeroSet.has(h) ? '支援' : null, initialHeroSet.has(h) ? '初始' : null]
      .filter(Boolean).map((t) => `【${t}】`).join('');
    return tags ? ` | ${tags}` : '';
  };
  const skillRoleTag = (s: string) => {
    const tags = [supportSkillSet.has(s) ? '支援' : null, initialSkillSet.has(s) ? '初始' : null]
      .filter(Boolean).map((t) => `【${t}】`).join('');
    return tags ? ` | ${tags}` : '';
  };

  lines.push('=== 三国谋定天下 - 战报选将分析 ===');
  lines.push('');
  lines.push('【说明】');
  for (const instruction of PROMPT_INSTRUCTIONS) lines.push(`- ${instruction}`);
  lines.push('- 相对强度：模型拟合的相对阵容强度贡献（非对特定对手的胜率）。');
  lines.push('');

  const roundTypeText = roundType === 'hero' ? '武将' : '战法';
  lines.push('【当前状态】');
  lines.push(`第 ${gameState.round_number} 轮 | 选择类型: ${roundTypeText}`);
  if (roundType === 'hero' && gameState.round_number === 4) {
    lines.push(`提示：${ROUND_FOUR_HERO_TIP}`);
  }
  lines.push('');

  lines.push('【已选武将】');
  if (mergedHeroes.length > 0) {
    mergedHeroes.forEach((hero, i) => {
      lines.push(`  ${i + 1}. ${formatHeroInfo(hero)}${heroRoleTag(hero)}`);
      const s = heroStatLine(hero);
      if (s) lines.push(`     战绩: ${s}`);
    });
  } else {
    lines.push('  （无）');
  }
  lines.push('');

  if (mergedHeroes.length >= 2) {
    lines.push('【已选武将配对】');
    for (let i = 0; i < mergedHeroes.length; i++) {
      for (let j = i + 1; j < mergedHeroes.length; j++) {
        const fid = heroPairId(mergedHeroes[i], mergedHeroes[j]);
        const w = weightOf(model, fid);
        if (w !== 0) {
          lines.push(`  ${mergedHeroes[i]}+${mergedHeroes[j]}: 相对强度${fmtWeight(w)} (证据${supportOf(model, fid)}场)`);
        }
      }
    }
    lines.push('');
  }

  lines.push('【已选战法】');
  if (mergedSkills.length > 0) {
    mergedSkills.forEach((skill, i) => {
      lines.push(`  ${i + 1}. ${formatSkillInfo(skill)}${skillRoleTag(skill)}`);
      const s = skillStatLine(skill);
      if (s) lines.push(`     战绩: ${s}`);
    });
  } else {
    lines.push('  （无）');
  }
  lines.push('');

  lines.push(`【本轮三组可选${roundTypeText}及模型评估】`);
  const sets = [
    currentRoundInputs.set1 || [],
    currentRoundInputs.set2 || [],
    currentRoundInputs.set3 || [],
  ];

  sets.forEach((set: string[], i: number) => {
    lines.push(`--- 第${i + 1}组 ---`);
    if (set.length === 0) {
      lines.push('  （空）');
    } else {
      set.forEach((item, j) => {
        lines.push(`  ${j + 1}. ${roundType === 'hero' ? formatHeroInfo(item) : formatSkillInfo(item)}`);
      });
      lines.push('  [模型评估]');
      const contextHeroes = roundType === 'hero'
        ? [...new Set([...mergedHeroes, ...set.filter((h) => !mergedHeroes.includes(h))])]
        : mergedHeroes;
      let any = false;
      for (const item of set) {
        if (roundType === 'hero') {
          const line = heroStatLine(item);
          if (line) { lines.push(`    ${item}: ${line}`); any = true; }
          for (const l of heroPairLines(item, contextHeroes, '      ')) { lines.push(l); any = true; }
          for (const l of heroSkillLines(item, mergedSkills, '      ')) { lines.push(l); any = true; }
        } else {
          const line = skillStatLine(item);
          if (line) { lines.push(`    ${item}: ${line}`); any = true; }
          for (const l of skillHeroLines(item, mergedHeroes, '      ')) { lines.push(l); any = true; }
        }
      }
      if (!any) lines.push('    （无相关模型数据）');
    }
    lines.push('');
  });

  const candidateHeroes = roundType === 'hero' ? [...new Set(sets.flat())] : [];
  const llmTips = roundType === 'hero'
    ? formatRelevantTips(mergedHeroes, candidateHeroes, { includeCandidateOnlyComps: gameState.round_number === 1 })
    : [];
  lines.push(...llmTips);

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
  lines.push(`${priority++}. 相对强度：各武将/战法的相对强度、配对与武将-战法配合，优先边际提升大的组合`);
  if (llmTips.length > 0) lines.push(`${priority++}. 玩家心得`);
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

// --------------------------------------------------------------------------- #
// Team-builder prompt
// --------------------------------------------------------------------------- #

export async function generateTeamBuilderPrompt(heroes: string[], skills: string[]): Promise<string> {
  const lines: string[] = [];

  lines.push('=== 三国谋定天下 - 组队分析 ===');
  lines.push('');
  lines.push('【说明】');
  for (const instruction of PROMPT_INSTRUCTIONS) lines.push(`- ${instruction}`);
  lines.push('');

  lines.push('【任务】');
  lines.push(`请根据以下武将池(${heroes.length}名)和战法池(${skills.length}个)，帮我组建3支最优队伍。`);
  lines.push('每支队伍3名武将，每名武将分配2个战法（不含自带战法）。');
  lines.push('每个武将和战法只能使用一次。');
  lines.push('');

  lines.push('【武将池】');
  for (const hero of heroes) {
    lines.push(`  ${formatHeroInfo(hero)}`);
    const s = heroStatLine(hero);
    if (s) lines.push(`    战绩: ${s}`);
  }
  lines.push('');

  // Strongest hero pairs within the pool (by model weight).
  const pairLines: { text: string; w: number }[] = [];
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      const fid = heroPairId(heroes[i], heroes[j]);
      const w = weightOf(model, fid);
      if (w > 0) pairLines.push({ text: `  ${heroes[i]}+${heroes[j]}: 相对强度${fmtWeight(w)} (证据${supportOf(model, fid)}场)`, w });
    }
  }
  if (pairLines.length > 0) {
    pairLines.sort((x, y) => y.w - x.w);
    lines.push('【武将配对相对强度】(仅正贡献, 按强度排序)');
    for (const p of pairLines.slice(0, 40)) lines.push(p.text);
    lines.push('');
  }

  lines.push('【战法池】');
  for (const skill of skills) {
    lines.push(`  ${formatSkillInfo(skill)}`);
    const s = skillStatLine(skill);
    if (s) lines.push(`    战绩: ${s}`);
  }
  lines.push('');

  // Strongest hero-skill assignments within the pool.
  const shLines: { text: string; w: number }[] = [];
  for (const hero of heroes) {
    for (const skill of skills) {
      const fid = heroSkillId(hero, skill);
      const w = weightOf(model, fid);
      if (w > 0) shLines.push({ text: `  ${hero}+${skill}: 相对强度${fmtWeight(w)} (证据${supportOf(model, fid)}场)`, w });
    }
  }
  if (shLines.length > 0) {
    shLines.sort((x, y) => y.w - x.w);
    lines.push('【武将-战法配对相对强度】(仅正贡献, 按强度排序, 前40)');
    for (const p of shLines.slice(0, 40)) lines.push(p.text);
    lines.push('');
  }

  const teamTips = formatRelevantTips(heroes, [], { requireAllOwned: true });
  lines.push(...teamTips);

  lines.push('【请你分析】');
  lines.push('请根据以上数据，组建3支最优队伍，按以下优先级考虑：');
  let tbPriority = 1;
  lines.push(`${tbPriority++}. 排名：定位(体系核心/输出核心/输出辅助/功能辅助)排名越靠前越强（同定位内比较）`);
  lines.push(`${tbPriority++}. 相对强度：武将配对/武将-战法配对的模型相对强度，优先边际提升大的组合`);
  if (teamTips.length > 0) lines.push(`${tbPriority++}. 玩家心得`);
  lines.push(`${tbPriority++}. 战法预估（伤害/治疗/属性/增伤/减伤/降伤/易伤/闪避/攻心/奇谋率/奇谋伤害）`);
  lines.push(`${tbPriority++}. 阵营/兵种：作为队伍成型与同分加分项`);
  lines.push('');
  lines.push('最终目的是组3个队伍，每个队伍3个武将（每队至少1个输出核心），每个武将1个自带战法（固定）+ 2个战法。请给出3支队伍的具体配置（每队3武将+每人2战法）。');
  lines.push('');
  lines.push('【输出要求】回答务必简明扼要：1) 直接列出3支队伍的最终配置（武将+战法），用紧凑表格或列表形式；2) 每支队伍后用 2-3 条短要点说明定位与核心思路（每条不超过 40 字）；3) 不要复述输入数据，不要罗列被淘汰的备选方案。');

  return lines.join('\n');
}
