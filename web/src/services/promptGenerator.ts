/**
 * Generate a structured prompt for LLM analysis of the current game state.
 * The prompt is copied into ChatGPT-style LLMs for deeper reasoning about
 * hero/skill selection.
 *
 * Data comes from the offline paired model artifact (`recommendation_data.json`)
 * via `recommendationEngine`/`recommendationModel`: instead of the old Wilson
 * win-rate maps, the prompt surfaces the model's *relative roster-strength*
 * contributions (outcome-plus-appearance H/S/HP/HS weights and outcome-only
 * weights for other interactions) plus each item's evidence/support count.
 * Descriptive smoothed win rates are intentionally
 * omitted from copied prompts so LLMs do not mistake them for direct probabilities.
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
import {
  recommendHeroSet,
  recommendSkillSet,
  type Contribution,
  type OptionAnalysis,
} from './recommendationEngine';
import { getItemsPerSet, getRoundType } from './gameLogic';
import type {
  CurrentRoundInputs,
  GameState,
  RoundType,
} from '../types/game';
import type { TeamComp } from '../types/domain';
import type { AnalyticsRow } from '../types/recommendation';
import { gameDataUrl } from '../utils/gameDataUrl';
import { teamRankingRank } from '../utils/rankings';

const publicOrigin = (): string =>
  typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
const LOW_ITEM_EVIDENCE = 20;
const LOW_SYNERGY_EVIDENCE = 10;
const LATE_ROUND_INVENTORY_THRESHOLD = 7;
const MAX_RELEVANT_TIPS = 8;
const MAX_DIRECTLY_ADVANCED_TIPS = 5;
const MAX_BACKGROUND_TIPS = 3;
const SHARED_INITIAL_SKILL_COUNT = 8;
const HERO_VARIANT_INSTRUCTION =
  '名称说明：武将名末尾的数字是数据库中的正式后缀，代表不同武将条目，不要删除后缀或合并同名条目。';

const commonPromptInstructions = () => [
  HERO_VARIANT_INSTRUCTION,
  '模型说明：相对强度以成对（对手感知）逻辑回归为基础；武将/战法个体分还加入按赛季可用性校正的战报出场倾向，常用会加分、少用会减分；武将同队（HP）和武将携带战法（HS）组合分另加入按各赛季边际使用量校正的正向共现加分，仅高于预期时加分，其他组合分仍只来自胜负模型。它不是对特定对手的胜率；证据=该特征在历史对局中出现的场次。',
  `细节查询说明：如果需要完整武将/战法描述、buff/debuff、缘分或公式细节，请联网/读取公开静态文件 ${gameDataUrl(publicOrigin())}，并结合游戏规则核验。`,
];

const ROUND_DECISION_INSTRUCTION =
  '决策信号说明：提示中刻意不展示平滑胜率；不要把历史描述性胜率当作本轮选择概率，低证据数据只作弱参考。';

const sharedResourceInstruction =
  '双方共有资源说明：当前武将列表第1名武将和当前战法列表前8个战法为双方共有资源，提示中会用【初始】标注；它们不是本轮新增资源，也不代表相对对手的独占优势。';

const ROUND_FOUR_HERO_TIP = '第4轮选将提醒：第6轮后可补选1名支援武将及2个支援战法；下一次常规三组选将在第7轮。不要只为未来阵容画饼，本轮武将应优先评估能否立刻与已有武将或同组选项成队。';
const ROUND_SEVEN_HERO_TIP = '第7轮选将提醒：第9轮还有一次选将机会；本轮先补强能立即组成的队伍，再把最后缺口留给第9轮。';
const ROUND_TEAM_PLANNING_CONSTRAINT =
  '组队约束：武将不可重复；额外战法在三队中全局不可重复；不得把某武将自己的自带战法放入该武将的额外战法槽（其他武将的自带战法仅在资源池中已拥有时可合法携带）；只能使用当前已拥有资源及最终推荐组选中后加入的资源，不得虚构未拥有资源。';

const model = recommendationData.model;
const analytics = recommendationData.analytics;

const HERO_ANALYTICS: Record<string, AnalyticsRow> = Object.fromEntries(
  analytics.heroes.map((r) => [r.name, r])
);
const SKILL_ANALYTICS: Record<string, AnalyticsRow> = Object.fromEntries(
  analytics.skills.map((r) => [r.name, r])
);

const fmtSigned = (value: number): string => {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(1)}`;
};
const fmtWeight = (w: number): string => fmtSigned(w * 10);
const uniquePreserveOrder = (items: string[]): string[] => [...new Set(items)];

// --------------------------------------------------------------------------- #
// Guide-backed known-team tips (reads database.team)
// --------------------------------------------------------------------------- #

export interface TeamCompSelectionOptions {
  includeCandidateOnlyComps?: boolean;
  requireAllOwned?: boolean;
  selectedSkills?: string[];
  candidateSkills?: string[];
}

export interface RelevantTeamComp {
  comp: TeamComp;
  /** Backwards-compatible hero counts used by existing callers. */
  selectedCount: number;
  candidateCount: number;
  /** Satisfied or directly attainable recommended skill slots. */
  selectedSkillCount: number;
  candidateSkillCount: number;
}

export const isChampionshipTeam = (comp: TeamComp): boolean =>
  comp.sources.includes('championship');

export const compareKnownTeamStrength = (
  a: RelevantTeamComp,
  b: RelevantTeamComp
): number => {
  const championshipDelta =
    Number(isChampionshipTeam(b.comp)) - Number(isChampionshipTeam(a.comp));
  if (championshipDelta !== 0) return championshipDelta;

  const rankingDelta =
    teamRankingRank(a.comp.ranking) - teamRankingRank(b.comp.ranking);
  if (rankingDelta !== 0) return rankingDelta;

  const selectedHeroDelta = b.selectedCount - a.selectedCount;
  if (selectedHeroDelta !== 0) return selectedHeroDelta;
  const selectedSkillDelta = b.selectedSkillCount - a.selectedSkillCount;
  if (selectedSkillDelta !== 0) return selectedSkillDelta;
  const candidateHeroDelta = b.candidateCount - a.candidateCount;
  if (candidateHeroDelta !== 0) return candidateHeroDelta;
  const candidateSkillDelta = b.candidateSkillCount - a.candidateSkillCount;
  if (candidateSkillDelta !== 0) return candidateSkillDelta;
  return a.comp.id < b.comp.id ? -1 : a.comp.id > b.comp.id ? 1 : 0;
};

function countKnownTeamSkillSlots(
  comp: TeamComp,
  selectedSkills: Set<string>,
  candidateSkills: Set<string>
): { selectedSkillCount: number; candidateSkillCount: number } {
  let selectedSkillCount = 0;
  let candidateSkillCount = 0;
  for (const member of comp.members) {
    for (const slot of member.skillSlots) {
      if (slot.some((skill) => selectedSkills.has(skill))) {
        selectedSkillCount += 1;
      } else if (slot.some((skill) => candidateSkills.has(skill))) {
        candidateSkillCount += 1;
      }
    }
  }
  return { selectedSkillCount, candidateSkillCount };
}

export function selectRelevantTeamComps(
  selectedHeroes: string[],
  candidateHeroes: string[] = [],
  options: TeamCompSelectionOptions = {}
): RelevantTeamComp[] {
  const {
    includeCandidateOnlyComps = false,
    requireAllOwned = false,
    selectedSkills = [],
    candidateSkills = [],
  } = options;
  const teamComps = database.team || [];

  const selectedSet = new Set(selectedHeroes);
  const candidateSet = new Set(candidateHeroes);
  const selectedSkillSet = new Set(selectedSkills);
  const candidateSkillSet = new Set(
    candidateSkills.filter((skill) => !selectedSkillSet.has(skill))
  );

  const result: RelevantTeamComp[] = [];
  for (const comp of teamComps) {
    const selectedCount = comp.members.filter((member) =>
      selectedSet.has(member.hero)
    ).length;
    const candidateCount = comp.members.filter(
      (member) =>
        candidateSet.has(member.hero) && !selectedSet.has(member.hero)
    ).length;
    const { selectedSkillCount, candidateSkillCount } = countKnownTeamSkillSlots(
      comp,
      selectedSkillSet,
      candidateSkillSet,
    );

    if (requireAllOwned) {
      if (selectedCount !== comp.members.length) continue;
    } else if (includeCandidateOnlyComps) {
      if (selectedCount + candidateCount < 1) continue;
    } else {
      if (selectedCount < 1) continue;
    }
    result.push({
      comp,
      selectedCount,
      candidateCount,
      selectedSkillCount,
      candidateSkillCount,
    });
  }
  result.sort(compareKnownTeamStrength);
  return result;
}

function formatRelevantTips(
  selectedHeroes: string[],
  candidateHeroes: string[] = [],
  options: TeamCompSelectionOptions = {}
) {
  const {
    requireAllOwned = false,
    selectedSkills = [],
    candidateSkills = [],
  } = options;
  const lines: string[] = [];
  const selectedSet = new Set(selectedHeroes);
  const candidateSet = new Set(candidateHeroes);
  const selectedSkillSet = new Set(selectedSkills);
  const candidateSkillSet = new Set(candidateSkills);

  const relevant = selectRelevantTeamComps(selectedHeroes, candidateHeroes, options);
  const markResource = (
    value: string,
    selected: Set<string>,
    candidate: Set<string>
  ): string =>
    selected.has(value)
      ? `${value}✓`
      : candidate.has(value)
        ? `${value}◇`
        : value;
  const formatComp = ({ comp }: RelevantTeamComp): string[] => {
    const strengthLabel = isChampionshipTeam(comp)
      ? `夺冠御三家｜冠军参考｜${comp.ranking}`
      : comp.ranking;
    const header =
      `  [${strengthLabel}] 阵型:${comp.formation}` +
      (comp.section && comp.section !== '夺冠御三家'
        ? `｜分区:${comp.section}`
        : '');
    const members = comp.members.map((member) => {
      const hero = markResource(member.hero, selectedSet, candidateSet);
      const skillSlots = member.skillSlots
        .slice(0, 2)
        .map(
          (alternatives, index) =>
            `战法位${index + 1}:` +
            alternatives
              .map((skill) =>
                markResource(skill, selectedSkillSet, candidateSkillSet)
              )
              .join('/')
        )
        .join('；');
      return `    ${hero}｜${skillSlots}`;
    });
    return [header, ...members];
  };

  if (relevant.length === 0) return lines;

  lines.push('【已知强力阵容】');
  lines.push('  标记: ✓=已获得, ◇=本轮可获得, 无标记=尚未获得。');
  if (relevant.some(({ comp }) => isChampionshipTeam(comp))) {
    lines.push('  参考排序说明: “夺冠御三家 / 冠军参考”优先于常规S阵容；数据库排名仍标为S，不另造等级；此顺序不改变模型评分。');
  }
  if (!requireAllOwned) {
    const directlyAdvanced = relevant
      .filter(
        ({ candidateCount, candidateSkillCount }) =>
          candidateCount + candidateSkillCount > 0
      )
      .slice(0, MAX_DIRECTLY_ADVANCED_TIPS);
    const background = relevant
      .filter(
        ({ candidateCount, candidateSkillCount }) =>
          candidateCount + candidateSkillCount === 0
      )
      .slice(0, MAX_BACKGROUND_TIPS);

    if (directlyAdvanced.length > 0) {
      lines.push('  本轮选中即可推进的阵容:');
      lines.push(...directlyAdvanced.flatMap(formatComp));
    }
    if (background.length > 0) {
      lines.push('  与已有武将相关、但本轮不直接推进的参考阵容:');
      lines.push(...background.flatMap(formatComp));
    }
  } else {
    lines.push('  已拥有完整武将阵容参考:');
    lines.push(...relevant.slice(0, MAX_RELEVANT_TIPS).flatMap(formatComp));
  }
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
  ];
  parts.push(`自带战法:${hero.skill}`);
  return parts.join(' | ');
}

const HERO_OF_SKILL = (() => {
  const map: Record<string, string> = {};
  for (const [hname, h] of Object.entries(database.heroes || {})) {
    if (h && h.skill) map[h.skill] = hname;
  }
  return map;
})();

function formatSkillInfo(skillName: string) {
  if (!database.skills?.[skillName]) return skillName;
  const parts = [`${skillName}`];
  const owner = HERO_OF_SKILL[skillName];
  if (owner) parts.push(`自带战法:${owner}`);
  return parts.join(' | ');
}

// --------------------------------------------------------------------------- #
// Model-derived accessors (replace the old Wilson maps)
// --------------------------------------------------------------------------- #

function evidenceLabel(total: number, threshold = LOW_ITEM_EVIDENCE): string {
  return total < threshold ? `证据${total}场（低样本，仅弱参考）` : `证据${total}场`;
}

function itemEvidenceLabel(total: number): string {
  return total < LOW_ITEM_EVIDENCE
    ? `本体证据${total}场（低样本，仅弱参考）`
    : `本体证据${total}场`;
}

function synergyEvidenceLabel(total: number): string {
  return total < LOW_SYNERGY_EVIDENCE ? `证据${total}场，低证据` : `证据${total}场`;
}

/** Prompt stat line for a hero: evidence + model weight. Smoothed win rate is omitted. */
function heroStatLine(hero: string): string | null {
  const row = HERO_ANALYTICS[hero];
  const w = weightOf(model, heroId(hero));
  if (!row && w === 0) return null;
  const bits: string[] = [];
  if (row) bits.push(evidenceLabel(row.total));
  bits.push(`相对强度${fmtWeight(w)}`);
  return bits.join(', ');
}

function skillStatLine(skill: string): string | null {
  const row = SKILL_ANALYTICS[skill];
  const w = weightOf(model, skillId(skill));
  if (!row && w === 0) return null;
  const bits: string[] = [];
  if (row) bits.push(evidenceLabel(row.total));
  bits.push(`相对强度${fmtWeight(w)}`);
  return bits.join(', ');
}

/** Positive planning leads for a candidate hero over already-owned skills. */
function heroSkillLines(hero: string, skills: string[], indent: string): string[] {
  const lines: string[] = [];
  for (const skill of skills) {
    const fid = heroSkillId(hero, skill);
    const w = weightOf(model, fid);
    if (w > 0) {
      lines.push(`${indent}${hero}携带${skill}: 相对强度${fmtWeight(w)} (${synergyEvidenceLabel(supportOf(model, fid))})`);
    }
  }
  return lines;
}

const fmtDisplayScore = (score: number): string => fmtSigned(score);

const CONTRIBUTION_LABELS: Record<string, string> = {
  H: '武将',
  S: '战法',
  HP: '武将配合',
  HS: '武将-战法',
  SP: '战法搭配',
};

function formatContribution(contribution: Contribution): string {
  const kind = CONTRIBUTION_LABELS[contribution.family] || contribution.family;
  return `${kind} ${contribution.label}: ${fmtWeight(contribution.weight)} (${synergyEvidenceLabel(contribution.support)})`;
}

function formatLiveOptionAnalysis(
  option: OptionAnalysis,
  roundType: RoundType
): string[] {
  const comboTradeoffs = option.tradeoffs.filter(
    (contribution) =>
      contribution.family !== 'H' && contribution.family !== 'S'
  );
  const evidenceScope =
    roundType === 'hero' ? '合并现有武将后' : '本组选项贡献';
  const lines = [
    `  [整组摘要] 本轮边际相对强度:${fmtDisplayScore(option.final_score)}；页面推荐排名:${option.rank}/3；证据概览（${evidenceScope}）：模型特征${option.evidence.featureCount}个；各特征支持度之和:${option.evidence.totalSupport}；最低特征支持:${option.evidence.minSupport}场`,
    '  [模型评估]',
    `    单项边际: ${option.item_scores.map((item) => `${item.item} ${fmtDisplayScore(item.score)} (${itemEvidenceLabel(item.support)})`).join('；')}`,
  ];
  if (option.combo_synergies.length > 0) {
    lines.push(
      `    关键组合协同: ${option.combo_synergies.map(formatContribution).join('；')}`
    );
  }
  if (comboTradeoffs.length > 0) {
    lines.push(
      `    关键组合权衡: ${comboTradeoffs.map(formatContribution).join('；')}`
    );
  }
  if (option.combo_synergies.length === 0 && comboTradeoffs.length === 0) {
    lines.push('    关键组合: 无');
  }
  return lines;
}

interface TeamPlanningFeasibility {
  uniqueHeroes: string[];
  assignableSkills: string[];
}

function teamPlanningFeasibility(
  heroes: string[],
  skills: string[]
): TeamPlanningFeasibility {
  const uniqueHeroes = uniquePreserveOrder(heroes);
  return {
    uniqueHeroes,
    assignableSkills: uniquePreserveOrder(skills).filter(
      (skill) => database.skills?.[skill]
    ),
  };
}

interface RoundTeamPlanningOverview {
  lines: string[];
}

function formatRoundTeamPlanningOverview(
  options: TeamPlanningFeasibility[]
): RoundTeamPlanningOverview {
  const first = options[0];
  const lines = [
    '【本轮组选中后的组队可行性】',
    `  任一组选中后：唯一武将${first.uniqueHeroes.length}名（完整组队需9名）；唯一可分配战法${first.assignableSkills.length}个（填满额外战法位需18个）。`,
  ];
  lines.push('  同阵营组队仅作软性偏好。');
  return { lines };
}

function formatOwnedSkillSummary(skills: string[], relevantHeroes: string[], roleTag: (skill: string) => string): string[] {
  const lines: string[] = [];
  lines.push('【已选战法摘要】');
  if (skills.length > 0) {
    lines.push(`  ${skills.map((skill) => `${skill}${roleTag(skill)}`).join('、')}`);
  }

  const relevant: { text: string; w: number }[] = [];
  for (const hero of relevantHeroes) {
    for (const skill of skills) {
      const fid = heroSkillId(hero, skill);
      const w = weightOf(model, fid);
      if (w > 0) {
        relevant.push({ text: `  ${hero}+${skill}: 相对强度${fmtWeight(w)} (${synergyEvidenceLabel(supportOf(model, fid))})`, w });
      }
    }
  }
  relevant.sort((a, b) => b.w - a.w);
  if (relevant.length > 0) {
    lines.push('  现有资源适配线索（不计入本轮边际；同一战法的多条携带方案互斥）:');
    lines.push(...relevant.slice(0, 12).map((r) => r.text));
  }
  lines.push('');
  return lines;
}

const ROUND_SET_NAMES = ['set1', 'set2', 'set3'] as const;

function validateAndGetRoundSets(
  gameState: GameState,
  currentRoundInputs: CurrentRoundInputs,
  roundType: RoundType
): [string[], string[], string[]] {
  const canonicalType = getRoundType(gameState.round_number);
  if (canonicalType !== roundType) {
    throw new Error(
      `第${gameState.round_number}轮应选择${canonicalType === 'hero' ? '武将' : '战法'}，收到的提示词类型不一致`
    );
  }

  const itemsPerSet = getItemsPerSet(gameState.round_number);
  const sets = ROUND_SET_NAMES.map((name) => currentRoundInputs?.[name]);
  if (
    sets.some(
      (set) =>
        !Array.isArray(set) ||
        set.length !== itemsPerSet ||
        set.some((item) => typeof item !== 'string')
    )
  ) {
    throw new Error(`第${gameState.round_number}轮三组选项每组必须恰好有${itemsPerSet}项`);
  }

  const typedSets = sets as [string[], string[], string[]];
  const offered = typedSets.flat();
  if (new Set(offered).size !== offered.length) {
    throw new Error('本轮三组选项中存在重复名称');
  }

  const owned = new Set(
    roundType === 'hero'
      ? [
          ...(gameState.current_heroes || []),
          ...(gameState.support_hero ? [gameState.support_hero] : []),
        ]
      : [
          ...(gameState.current_skills || []),
          ...(gameState.support_skills || []),
        ]
  );
  for (const item of offered) {
    if (owned.has(item)) {
      throw new Error(`本轮选项“${item}”已在当前资源池中`);
    }
    if (roundType === 'hero') {
      if (!database.heroes?.[item]) {
        throw new Error(`本轮选项“${item}”不是数据库中的武将`);
      }
    } else {
      const skill = database.skills?.[item];
      if (!skill || skill.color !== 'orange' || HERO_OF_SKILL[item]) {
        throw new Error(`本轮选项“${item}”不是可选的橙色非自带战法`);
      }
    }
  }
  return typedSets;
}

// --------------------------------------------------------------------------- #
// Round prompt
// --------------------------------------------------------------------------- #

export async function generateLLMPrompt({
  gameState,
  currentRoundInputs,
  roundType,
}: {
  gameState: GameState;
  currentRoundInputs: CurrentRoundInputs;
  roundType: RoundType;
}): Promise<string> {
  const lines: string[] = [];
  const sets = validateAndGetRoundSets(
    gameState,
    currentRoundInputs,
    roundType
  );

  const mainHeroes = gameState.current_heroes || [];
  const supportHero = gameState.support_hero || null;
  const mainSkills = gameState.current_skills || [];
  const supportSkills = gameState.support_skills || [];
  const mergedHeroes = [...mainHeroes, ...(supportHero ? [supportHero] : [])];
  const mergedSkills = [...mainSkills, ...supportSkills];
  const supportHeroSet = new Set(supportHero ? [supportHero] : []);
  const supportSkillSet = new Set(supportSkills);
  const initialHeroSet = new Set(mainHeroes.slice(0, 1));
  const initialSkillSet = new Set(
    mainSkills.slice(0, SHARED_INITIAL_SKILL_COUNT)
  );
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

  const roundTypeText = roundType === 'hero' ? '武将' : '战法';
  lines.push(`=== 三国谋定天下 - 本轮${roundTypeText}选择分析 ===`);
  lines.push('');
  lines.push('【说明】');
  lines.push(`- ${sharedResourceInstruction}`);
  for (const instruction of commonPromptInstructions()) {
    lines.push(`- ${instruction}`);
  }
  lines.push(`- ${ROUND_DECISION_INSTRUCTION}`);
  lines.push('');

  lines.push('【当前状态】');
  lines.push(`第 ${gameState.round_number} 轮 | 选择类型: ${roundTypeText}`);
  if (roundType === 'hero' && gameState.round_number === 4) {
    lines.push(`提示：${ROUND_FOUR_HERO_TIP}`);
  } else if (roundType === 'hero' && gameState.round_number === 7) {
    lines.push(`提示：${ROUND_SEVEN_HERO_TIP}`);
  }
  lines.push('');

  lines.push('【已选武将】');
  if (mergedHeroes.length > 0) {
    mergedHeroes.forEach((hero, i) => {
      lines.push(`  ${i + 1}. ${formatHeroInfo(hero)}${heroRoleTag(hero)}`);
      const s = heroStatLine(hero);
      if (s) lines.push(`     模型证据: ${s}`);
    });
  } else {
    lines.push('  （无）');
  }
  lines.push('');

  const ownedPairLines: string[] = [];
  if (mergedHeroes.length >= 2) {
    for (let i = 0; i < mergedHeroes.length; i++) {
      for (let j = i + 1; j < mergedHeroes.length; j++) {
        const fid = heroPairId(mergedHeroes[i], mergedHeroes[j]);
        const w = weightOf(model, fid);
        if (w !== 0) {
          ownedPairLines.push(`  ${mergedHeroes[i]}+${mergedHeroes[j]}: 相对强度${fmtWeight(w)} (证据${supportOf(model, fid)}场)`);
        }
      }
    }
  }
  if (ownedPairLines.length > 0) {
    lines.push('【已选武将配对】');
    lines.push(...ownedPairLines);
    lines.push('');
  }

  const relevantHeroesForOwnedSkills =
    roundType === 'skill' ? mergedHeroes : [];

  if (gameState.round_number >= LATE_ROUND_INVENTORY_THRESHOLD && mergedSkills.length > 0) {
    lines.push(...formatOwnedSkillSummary(mergedSkills, relevantHeroesForOwnedSkills, skillRoleTag));
  } else {
    lines.push('【已选战法】');
    if (mergedSkills.length > 0) {
      mergedSkills.forEach((skill, i) => {
        lines.push(`  ${i + 1}. ${formatSkillInfo(skill)}${skillRoleTag(skill)}`);
        const s = skillStatLine(skill);
        if (s) lines.push(`     模型证据: ${s}`);
      });
    } else {
      lines.push('  （无）');
    }
    lines.push('');
  }

  const shouldPlanTeams = gameState.round_number >= 4;
  const optionTeamFeasibilities = sets.map((set) =>
    teamPlanningFeasibility(
      roundType === 'hero'
        ? [...new Set([...mergedHeroes, ...set])]
        : mergedHeroes,
      roundType === 'skill'
        ? [...new Set([...mergedSkills, ...set])]
        : mergedSkills
    )
  );
  const roundPlanningOverview = shouldPlanTeams
    ? formatRoundTeamPlanningOverview(optionTeamFeasibilities)
    : null;
  if (roundPlanningOverview) {
    lines.push(...roundPlanningOverview.lines);
    lines.push('');
  }

  const heroPlanningLinesByOption =
    roundType === 'hero'
      ? sets.map((set) =>
          set.flatMap((item) =>
            heroSkillLines(item, mergedSkills, '    ')
          )
        )
      : sets.map(() => []);
  lines.push(`【本轮三组可选${roundTypeText}及模型评估】`);
  lines.push('  说明：单项边际与关键组合可能重叠，均为整组摘要的解释视角，不得相加；组选比较以整组摘要为准。');
  if (heroPlanningLinesByOption.some((planningLines) => planningLines.length > 0)) {
    lines.push('  说明：[补充规划线索]不计入本轮边际分数；同一战法的多条携带方案互斥。');
  }
  const liveRecommendation =
    roundType === 'hero'
      ? recommendHeroSet(
          sets,
          mergedHeroes,
          recommendationData,
          mergedSkills
        )
      : recommendSkillSet(
          sets,
          mergedHeroes,
          mergedSkills,
          recommendationData
        );

  sets.forEach((set: string[], i: number) => {
    lines.push(`--- 第${i + 1}组 ---`);
    set.forEach((item, j) => {
      lines.push(`  ${j + 1}. ${roundType === 'hero' ? formatHeroInfo(item) : formatSkillInfo(item)}`);
    });
    const option = liveRecommendation.analysis.find(
      (analysis) => analysis.set_index === i
    );
    if (!option) {
      throw new Error(`缺少第${i + 1}组的实时推荐分析`);
    }
    lines.push(...formatLiveOptionAnalysis(option, roundType));
    if (roundType === 'hero') {
      const planningLines = heroPlanningLinesByOption[i];
      if (planningLines.length > 0) {
        lines.push('  [补充规划线索]');
        lines.push(...planningLines);
      }
    }
    lines.push('');
  });

  const candidateHeroes = roundType === 'hero' ? [...new Set(sets.flat())] : [];
  const candidateSkills = roundType === 'skill' ? [...new Set(sets.flat())] : [];
  const llmTips = formatRelevantTips(mergedHeroes, candidateHeroes, {
    // Every hero round may offer the missing entry point into a known team.
    // Skill rounds remain hero-anchored; offered skills still rank and annotate
    // the already relevant team references.
    includeCandidateOnlyComps: candidateHeroes.length > 0,
    selectedSkills: mergedSkills,
    candidateSkills,
  });
  lines.push(...llmTips);

  lines.push('【请你分析】');
  lines.push('你只能从三组中选择一组，选中后该组内的所有' + roundTypeText + '都会加入你的阵容。');
  lines.push('');
  lines.push('请根据以上信息，分析三组选项各自的优劣，按以下优先级考虑：');
  let priority = 1;
  lines.push(`${priority++}. 本轮边际相对强度：优先看整组摘要、单项边际与关键组合`);
  if (llmTips.length > 0) {
    const hasDirectTeamTips = llmTips.some((line) =>
      line.includes('本轮选中即可推进的阵容')
    );
    lines.push(
      `${priority++}. 阵容参考：${
        hasDirectTeamTips
          ? '优先看“本轮选中即可推进”的阵容，背景参考不要压过模型协同'
          : '仅作背景参考，不要压过模型协同与战法适配'
      }`
    );
  }
  if (roundType === 'hero') {
    lines.push(`${priority++}. 阵营/兵种：可作为同分时的加分项`);
  }
  lines.push('');
  if (shouldPlanTeams) {
    lines.push('最终目标是组3个队伍，每队3个武将，每名武将使用固定自带战法和最多2个额外战法。请结合模型评估推荐一组，并在三队规划中遵守上方可行性。');
    lines.push('从第4轮开始，请同时给出当前可组成的3队规划。');
    lines.push(ROUND_TEAM_PLANNING_CONSTRAINT);
  } else {
    lines.push('最终目标是组3个队伍；当前只评估本轮选择对最终阵容的价值，不要求现在凑齐三队。请给出你推荐选择哪一组。');
  }
  lines.push('');
  if (shouldPlanTeams) {
    lines.push('【输出要求】1) 分析每一组（第1组、第2组、第3组）的优劣；2) 给出最终推荐；3) 给出推荐组加入后的3队暂定配置（每名武将列出自带战法和最多2个额外战法，缺少的战法位留空）。回答务必简明扼要。');
  } else {
    lines.push('【输出要求】分析每一组（第1组、第2组、第3组）的优劣，再给出最终推荐。回答务必简明扼要。');
  }

  return lines.join('\n');
}
