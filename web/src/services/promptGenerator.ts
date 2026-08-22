/**
 * Generate a structured prompt for LLM analysis of the current game state.
 * The prompt is copied into ChatGPT-style LLMs for deeper reasoning about
 * hero/skill selection.
 *
 * Data comes from the offline paired model artifact (`recommendation_data.json`)
 * via `recommendationEngine`/`recommendationModel`: instead of the old Wilson
 * win-rate maps, the prompt surfaces the model's *relative roster-strength*
 * contributions (outcome-plus-selection hero/skill weights and outcome-only
 * hero-pair/hero-skill synergies) plus each item's evidence/support count.
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
import { formulaUrl, gameDataUrl } from '../utils/gameDataUrl';
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
  '战法说明：伤害=直接输出；治疗=回复兵力；属性=属性增减幅度（点）；增伤=造成伤害提升%；减伤=受到伤害降低%；降伤=敌方造成伤害降低%；易伤=敌方受到伤害提升%；闪避=规避率%；攻心=按造成谋略伤害的比例回复自身兵力%；奇谋率=奇谋触发几率提升%；奇谋伤害=奇谋伤害提升%。',
  '模型说明：相对强度以成对（对手感知）逻辑回归为基础；武将/战法个体分还加入按赛季可用性校正的战报出场倾向，常用会加分、少用会减分，组合分仍只来自胜负模型。它不是对特定对手的胜率；证据=该特征在历史对局中出现的场次。',
  `细节查询说明：如果需要完整武将/战法描述、buff/debuff、缘分或公式细节，请联网/读取公开静态文件 ${gameDataUrl(publicOrigin())}；涉及增伤/减伤/易伤/降伤区间时再读取 ${formulaUrl(publicOrigin())}。`,
];

const ROUND_DECISION_INSTRUCTION =
  '决策信号说明：提示中刻意不展示平滑胜率；不要把历史描述性胜率当作本轮选择概率，低证据数据只作弱参考。';
const TEAM_DECISION_INSTRUCTION =
  '决策信号说明：提示中刻意不展示平滑胜率；不要把历史描述性胜率当作组队胜率，低证据数据只作弱参考。';

const sharedResourceInstruction =
  '双方共有资源说明：当前武将列表第1名武将和当前战法列表前8个战法为双方共有资源，提示中会用【初始】标注；它们不是本轮新增资源，也不代表相对对手的独占优势。';

const ROUND_FOUR_HERO_TIP = '第4轮选将提醒：第6轮后可补选1名支援武将及2个支援战法；下一次常规三组选将在第7轮。不要只为未来阵容画饼，本轮武将应优先评估能否立刻与已有武将或同组选项成队。';
const ROUND_SEVEN_HERO_TIP = '第7轮选将提醒：第9轮还有一次选将机会；本轮先补强能立即组成的队伍，再把最后缺口留给第9轮。';
const ROUND_TEAM_PLANNING_CONSTRAINT =
  '组队约束：武将不可重复；额外战法在三队中全局不可重复；不得把某武将自己的自带战法放入该武将的额外战法槽（其他武将的自带战法仅在资源池中已拥有时可合法携带）；只能使用当前已拥有资源及最终推荐组选中后加入的资源，不得虚构未拥有资源。';
const POOL_TEAM_PLANNING_CONSTRAINT =
  '组队约束：武将不可重复；额外战法在三队中全局不可重复；不得把某武将自己的自带战法放入该武将的额外战法槽（其他武将的自带战法仅在战法池中已拥有时可合法携带）；只能使用本提示中的武将池和战法池，不得虚构池外资源。';

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

/**
 * Minimal structural input for prompts built from the editable three-team
 * arrangement. Keep this DTO local to the prompt service so callers do not
 * need to depend on the arrangement UI's persistence/state types.
 */
export interface TeamPromptInput {
  teams: Array<{
    formation: string;
    heroes: Array<{
      hero: string | null;
      row: string;
      skills: (string | null)[];
    }>;
  }>;
  availableHeroes?: string[];
  availableSkills?: string[];
}

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
  const estimates = SKILL_ESTIMATES
    .filter(([key]) => skill[key] !== undefined)
    .map(([key, label]) => `${label}:${skill[key]}`);
  if (estimates.length > 0) parts.push(estimates.join(' '));
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

function formatTeamPlanningFeasibility(
  heroes: string[],
  skills: string[]
): string[] {
  const feasibility = teamPlanningFeasibility(heroes, skills);
  const lines = [
    `  [组队可行性] 唯一武将${feasibility.uniqueHeroes.length}名（完整组队需9名）；资源池中可分配的唯一战法${feasibility.assignableSkills.length}个（填满战法位需18个）。`,
    '    同阵营组队仅作软性偏好。',
  ];
  return lines;
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
  lines.push(`${priority++}. 战法预估：结合上方字段判断输出、生存与辅助价值`);
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

// --------------------------------------------------------------------------- #
// Team-builder prompt
// --------------------------------------------------------------------------- #

export async function generateTeamBuilderPrompt(heroes: string[], skills: string[]): Promise<string> {
  const lines: string[] = [];
  const inputHeroCount = heroes.length;
  const inputSkillCount = skills.length;
  heroes = uniquePreserveOrder(heroes);
  skills = uniquePreserveOrder(skills);

  lines.push('=== 三国谋定天下 - 组队分析 ===');
  lines.push('');
  lines.push('【说明】');
  for (const instruction of commonPromptInstructions()) {
    lines.push(`- ${instruction}`);
  }
  lines.push(`- ${TEAM_DECISION_INSTRUCTION}`);
  lines.push('');

  lines.push('【任务】');
  lines.push(`请根据以下武将池(${heroes.length}名)和战法池(${skills.length}个)，帮我组建3支高质量可行队伍。`);
  if (heroes.length !== inputHeroCount || skills.length !== inputSkillCount) {
    lines.push(`注意：输入中存在重复名称，以下已按唯一武将/战法去重后分析（原始${inputHeroCount}名武将/${inputSkillCount}个战法 → 唯一${heroes.length}名武将/${skills.length}个战法）。`);
  }
  lines.push('每支队伍3名武将；每名武将保留固定自带战法，并最多分配2个额外战法。');
  lines.push(POOL_TEAM_PLANNING_CONSTRAINT);
  lines.push(...formatTeamPlanningFeasibility(heroes, skills).map((line) => line.trimStart()));
  lines.push('提示：若下方列出配对，它们只是正向解释线索，不是完整模型穷举；未列出的组合不能视为中性，也不能据此声称达到全局最优。');
  lines.push('团队级武将-战法、跨武将战法搭配、完整三人组、同阵营和缘分只可在你提出的同一支3人队内判断；不得跨3支队伍或对整个未分队池重复计分。');
  lines.push('');

  lines.push('【武将池】');
  for (const hero of heroes) {
    lines.push(`  ${formatHeroInfo(hero)}`);
    const s = heroStatLine(hero);
    if (s) lines.push(`    模型证据: ${s}`);
  }
  lines.push('');

  // Strongest hero pairs within the pool (by model weight).
  const pairLines: { text: string; w: number }[] = [];
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      const fid = heroPairId(heroes[i], heroes[j]);
      const w = weightOf(model, fid);
      if (w > 0) pairLines.push({ text: `  ${heroes[i]}+${heroes[j]}: 相对强度${fmtWeight(w)} (${synergyEvidenceLabel(supportOf(model, fid))})`, w });
    }
  }
  if (pairLines.length > 0) {
    pairLines.sort((x, y) => y.w - x.w);
    lines.push('【武将配对正向线索】（按相对强度排序）');
    for (const p of pairLines.slice(0, 40)) lines.push(p.text);
    lines.push('');
  }

  lines.push('【战法池】');
  for (const skill of skills) {
    lines.push(`  ${formatSkillInfo(skill)}`);
    const s = skillStatLine(skill);
    if (s) lines.push(`    模型证据: ${s}`);
  }
  lines.push('');

  // Strongest hero-skill assignments within the pool.
  const shLines: { text: string; w: number }[] = [];
  for (const hero of heroes) {
    for (const skill of skills) {
      const fid = heroSkillId(hero, skill);
      const w = weightOf(model, fid);
      if (w > 0) shLines.push({ text: `  ${hero}+${skill}: 相对强度${fmtWeight(w)} (${synergyEvidenceLabel(supportOf(model, fid))})`, w });
    }
  }
  if (shLines.length > 0) {
    shLines.sort((x, y) => y.w - x.w);
    lines.push('【武将-战法配对正向线索】（按相对强度排序，最多40条）');
    for (const p of shLines.slice(0, 40)) lines.push(p.text);
    lines.push('');
  }

  const teamTips = formatRelevantTips(heroes, [], {
    requireAllOwned: true,
    selectedSkills: skills,
  });
  lines.push(...teamTips);

  lines.push('【请你分析】');
  lines.push('请按以下优先级比较可行配置：');
  let tbPriority = 1;
  lines.push(`${tbPriority++}. 模型线索：综合武将/战法自身相对强度与所列正向配对，优先高证据项`);
  if (teamTips.length > 0) lines.push(`${tbPriority++}. 阵容参考：只作为成队方向参考，不要压过模型协同与战法适配`);
  lines.push(`${tbPriority++}. 战法预估：结合上方字段判断输出、生存与辅助价值`);
  lines.push(`${tbPriority++}. 阵营/兵种：作为队伍成型与同分加分项`);
  lines.push('');
  lines.push('可分配战法不足18个时，仅将缺少的额外战法位留空；武将不足9名时才留空武将位。');
  lines.push('');
  lines.push('【输出要求】回答务必简明扼要：1) 直接列出3支队伍的最终配置（武将+战法），用紧凑表格或列表形式；2) 每支队伍后用 2-3 条短要点说明定位与核心思路（每条不超过 40 字）；3) 若读取了公开细节文件，只补充影响决策的关键机制/公式，不要复述输入数据，不要罗列被淘汰的备选方案。');

  return lines.join('\n');
}

// --------------------------------------------------------------------------- #
// Editable team-arrangement prompts
// --------------------------------------------------------------------------- #

type PopulatedPromptTeam = TeamPromptInput['teams'][number] & { originalIndex: number };

function populatedPromptTeams(input: TeamPromptInput): PopulatedPromptTeam[] {
  return input.teams
    .map((team, originalIndex) => ({ ...team, originalIndex }))
    .filter((team) => team.heroes.some((slot) => slot.hero !== null));
}

function signatureSkillForPrompt(hero: string): string {
  return database.heroes?.[hero]?.skill || '（数据库中未找到，请核验武将名称）';
}

function assignedExtraSkills(skills: (string | null)[]): string[] {
  // Preserve order and duplicates: an LLM reviewer must see invalid repeated
  // assignments exactly as the player configured them.
  return skills.filter((skill): skill is string => skill !== null);
}

/**
 * Build an LLM prompt that validates and improves the exact arrangement the
 * player has edited. Unlike generateTeamBuilderPrompt, this is deliberately a
 * review prompt rather than a request to discard the lineup and start over.
 */
export function generateTeamValidationPrompt(input: TeamPromptInput): string {
  const teams = populatedPromptTeams(input);
  if (teams.length === 0) return '';

  const lines: string[] = [
    '=== 三国谋定天下 - 已编辑阵容校验与改进 ===',
    '',
    '【任务边界】',
    '- 请先逐队校验下面这份精确的已编辑阵容，再在保留合理配置的基础上提出改进；不要忽略现有编排而从零盲目重组。',
    `- ${HERO_VARIANT_INSTRUCTION}`,
    '- 本提示未提供对手阵容或胜率；不要虚构获胜概率。',
    '',
    '【公开数据】',
    `- 武将、自带战法、战法机制、缘分、阵型与 buff/debuff：${gameDataUrl(publicOrigin())}`,
    `- 增伤、减伤、易伤、降伤的公式与区间规则：${formulaUrl(publicOrigin())}`,
    '',
    '【当前已编辑阵容】',
  ];

  for (const team of teams) {
    lines.push(`队伍${team.originalIndex + 1}`);
    lines.push(`  阵型：${team.formation || '（未选择）'}`);
    const formationEffect = team.formation ? database.formations?.[team.formation] : undefined;
    if (formationEffect) lines.push(`  阵型效果：${formationEffect}`);

    for (const slot of team.heroes) {
      if (slot.hero === null) continue;
      const extras = assignedExtraSkills(slot.skills);
      lines.push(
        `  - ${slot.hero}｜站位：${slot.row || '（未设置）'}｜自带战法（固定）：${signatureSkillForPrompt(slot.hero)}｜额外战法：${extras.length > 0 ? extras.join('、') : '（未分配）'}`
      );
    }
    lines.push('');
  }

  const assignedHeroes = new Set<string>();
  const assignedSkills = new Set<string>();
  for (const team of teams) {
    for (const slot of team.heroes) {
      if (slot.hero === null) continue;
      assignedHeroes.add(slot.hero);
      for (const skill of assignedExtraSkills(slot.skills)) assignedSkills.add(skill);
    }
  }

  if (input.availableHeroes !== undefined || input.availableSkills !== undefined) {
    lines.push('【未使用资源池】');
    if (input.availableHeroes !== undefined) {
      const unusedHeroes = uniquePreserveOrder(input.availableHeroes)
        .filter((hero) => !assignedHeroes.has(hero));
      lines.push(`  武将：${unusedHeroes.length > 0 ? unusedHeroes.join('、') : '（无）'}`);
    }
    if (input.availableSkills !== undefined) {
      const unusedSkills = uniquePreserveOrder(input.availableSkills)
        .filter((skill) => !assignedSkills.has(skill));
      lines.push(`  战法：${unusedSkills.length > 0 ? unusedSkills.join('、') : '（无）'}`);
    }
    lines.push('');
  }

  lines.push('【校验与改进要求】');
  lines.push('1. 逐队验证强度与机制：说明核心联动、输出/生存/治疗/控制覆盖，以及阵型和前排/后排站位是否匹配。');
  lines.push('2. 校验时先保留输入原样，不要预先去重或改写；明确标出武将重复、额外战法重复，以及某武将把自己的自带战法重复放入其额外战法槽等非法分配；其他武将的自带战法若在资源池中则可合法携带。');
  lines.push('3. 解释每队的关键风险和触发条件，区分确定结论、合理推断与数据不足。');
  lines.push('4. 对有问题的队伍优先给出可执行的阵型或前排/后排调整，并说明调整解决什么风险。');
  lines.push('5. 给出具体替换时写清“谁/哪个战法 → 谁/哪个战法”；可在当前已分配资源之间重新分配或互换，如需引入新武将/战法则只能使用上方未使用资源池项目。某类资源池未提供或资源不足时，请明确说明而不要虚构候选。');
  lines.push('6. 最终按队输出：校验结论、非法项、主要风险、最小改动建议。');

  return lines.join('\n');
}

/**
 * Concise, human-readable text for sharing the current arrangement with
 * another player. It intentionally omits URLs, model weights, and analysis.
 */
export function generateTeamShareText(input: TeamPromptInput): string {
  const teams = populatedPromptTeams(input);
  if (teams.length === 0) return '';

  const lines = ['三国谋定天下三队阵容'];
  for (const team of teams) {
    lines.push(`队伍${team.originalIndex + 1}｜阵型：${team.formation || '未选择'}`);
    for (const slot of team.heroes) {
      if (slot.hero === null) continue;
      const extras = assignedExtraSkills(slot.skills);
      lines.push(
        `- ${slot.row || '未设置'}｜${slot.hero}｜自带：${signatureSkillForPrompt(slot.hero)}｜额外：${extras.length > 0 ? extras.join('、') : '未分配'}`
      );
    }
  }
  return lines.join('\n');
}
