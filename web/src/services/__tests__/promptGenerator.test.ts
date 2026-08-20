/**
 * Behavior-focused tests for generateLLMPrompt / generateTeamBuilderPrompt.
 *
 * Uses the real merged database.json / recommendation_data.json that ship with
 * the app. The prompt is now backed by the paired model artifact, so it surfaces
 * relative-strength contributions rather than Wilson win rates.
 */
import { describe, test, expect } from 'vitest';
import {
  generateLLMPrompt,
  generateTeamBuilderPrompt,
  generateTeamShareText,
  generateTeamValidationPrompt,
  compareKnownTeamStrength,
  isChampionshipTeam,
  selectRelevantTeamComps,
  type TeamPromptInput,
  type RelevantTeamComp,
} from '../promptGenerator';
import {
  recommendHeroSet,
  recommendSkillSet,
} from '../recommendationEngine';
import {
  heroSkillId,
  supportOf,
  weightOf,
} from '../recommendationModel';
import { gameDataCacheVersion } from '../../utils/gameDataUrl';
import { database, recommendationData } from '../../data';
import type {
  CurrentRoundInputs,
  GameState,
  RoundType,
} from '../../types/game';
import type { TeamComp } from '../../types/domain';

const HERO_KEYS = Object.keys(database.heroes || {});
const HERO_SKILL_SET = new Set(
  Object.values(database.heroes || {}).map((h) => h.skill).filter(Boolean)
);
const SKILL_KEYS = Object.keys(database.skills || {}).filter(
  (name) => !HERO_SKILL_SET.has(name)
);
const ORANGE_SKILL_KEYS = SKILL_KEYS.filter(
  (name) => database.skills?.[name]?.color === 'orange'
);
const PURPLE_SKILL_KEY = SKILL_KEYS.find(
  (name) => database.skills?.[name]?.color === 'purple'
);

expect(HERO_KEYS.length).toBeGreaterThanOrEqual(13);
expect(SKILL_KEYS.length).toBeGreaterThanOrEqual(18);
expect(ORANGE_SKILL_KEYS.length).toBeGreaterThanOrEqual(9);
expect(PURPLE_SKILL_KEY).toBeDefined();

const [
  HERO_A,
  HERO_B,
  HERO_C,
  HERO_D,
  HERO_E,
  HERO_F,
  HERO_G,
  HERO_H,
  HERO_I,
  HERO_J,
  HERO_K,
  HERO_L,
  HERO_M,
] = HERO_KEYS;

const baseGameState: GameState = {
  round_number: 1,
  current_heroes: [HERO_A, HERO_B, HERO_C, HERO_D],
  current_skills: ORANGE_SKILL_KEYS.slice(0, 8),
  support_hero: null,
  support_skills: [],
  round_history: [],
};

const baseInputs: CurrentRoundInputs = {
  set1: [HERO_E, HERO_F, HERO_G],
  set2: [HERO_H, HERO_I, HERO_J],
  set3: [HERO_K, HERO_L, HERO_M],
};

const HERO_ROUND_FOUR_INITIAL_SKILLS = [
  '七进七出',
  ...SKILL_KEYS.filter(
    (skill) => skill !== '七进七出' && skill !== '洗筋伐髓'
  ),
].slice(0, 8);
expect(HERO_ROUND_FOUR_INITIAL_SKILLS).toHaveLength(8);

const HERO_ROUND_FOUR_STATE: GameState = {
  round_number: 4,
  current_heroes: ['木鹿大王', '诸葛亮2'],
  current_skills: [
    ...HERO_ROUND_FOUR_INITIAL_SKILLS,
    '洗筋伐髓',
  ],
  support_hero: null,
  support_skills: [],
  round_history: [],
};

const HERO_ROUND_FOUR_SETS: [string[], string[], string[]] = [
  ['孙权', '陆抗', '陆逊'],
  ['祝融', '孟获', '甘夫人'],
  ['张宁', '左慈', '孙坚'],
];

const SKILL_ROUND_FIVE_SETS: [string[], string[], string[]] = [
  ['神略制变', '明其虚实', '烈火焚营'],
  ['风助火势', '折冲御侮', '御敌临前'],
  ['指点乾坤', '战八方', '洗筋伐髓'],
];

const SKILL_ROUND_FIVE_OFFER_SET = new Set(
  SKILL_ROUND_FIVE_SETS.flat()
);
const SKILL_ROUND_FIVE_INITIAL_SKILLS = SKILL_KEYS.filter(
  (skill) => !SKILL_ROUND_FIVE_OFFER_SET.has(skill)
).slice(0, 8);
expect(SKILL_ROUND_FIVE_INITIAL_SKILLS).toHaveLength(8);

const SKILL_ROUND_FIVE_STATE: GameState = {
  round_number: 5,
  current_heroes: ['孙权', '陆抗', '陆逊'],
  current_skills: SKILL_ROUND_FIVE_INITIAL_SKILLS,
  support_hero: null,
  support_skills: [],
  round_history: [],
};

const asInputs = (
  sets: [string[], string[], string[]]
): CurrentRoundInputs => ({
  set1: sets[0],
  set2: sets[1],
  set3: sets[2],
});

const buildSkillSets = (
  ownedSkills: string[]
): [string[], string[], string[]] => {
  const available = ORANGE_SKILL_KEYS.filter(
    (skill) => !ownedSkills.includes(skill)
  ).slice(0, 9);
  expect(available).toHaveLength(9);
  return [
    available.slice(0, 3),
    available.slice(3, 6),
    available.slice(6, 9),
  ];
};

describe('known team relevance', () => {
  const team = (
    id: string,
    ranking: TeamComp['ranking'],
    sources: TeamComp['sources']
  ): TeamComp => ({
    id,
    ranking,
    sources,
    section: sources.includes('championship') ? '夺冠御三家' : '魏国',
    formation: '雁形阵',
    members: [
      { hero: `${id}-甲`, skillSlots: [['战法甲'], ['战法乙']] },
      { hero: `${id}-乙`, skillSlots: [['战法丙'], ['战法丁']] },
      { hero: `${id}-丙`, skillSlots: [['战法戊'], ['战法己']] },
    ],
  });
  const relevant = (comp: TeamComp): RelevantTeamComp => ({
    comp,
    selectedCount: 3,
    candidateCount: 0,
    selectedSkillCount: 0,
    candidateSkillCount: 0,
  });

  test('sorts championship S before ordinary S without inventing another rank', () => {
    const ordinaryS = relevant(team('ordinary-s', 'S', ['strong']));
    const championshipS = relevant(
      team('championship-s', 'S', ['championship'])
    );
    const ordinaryA = relevant(team('ordinary-a', 'A', ['strong']));

    const sorted = [ordinaryA, ordinaryS, championshipS].sort(
      compareKnownTeamStrength
    );

    expect(sorted.map(({ comp }) => comp.id)).toEqual([
      'championship-s',
      'ordinary-s',
      'ordinary-a',
    ]);
    expect(sorted[0].comp.ranking).toBe('S');
    expect(isChampionshipTeam(sorted[0].comp)).toBe(true);
  });

  test('counts acquired and offered skills by recommended slot while keeping hero counts', () => {
    const comp = database.team[0];
    const heroes = comp.members.map(({ hero }) => hero);
    const acquiredSkill = comp.members[0].skillSlots[0][0];
    const offeredSkill = comp.members[0].skillSlots[1][0];
    const selected = selectRelevantTeamComps(heroes, [], {
      selectedSkills: [acquiredSkill],
      candidateSkills: [offeredSkill],
    }).find(({ comp: candidate }) => candidate.id === comp.id);

    expect(selected).toMatchObject({
      selectedCount: 3,
      candidateCount: 0,
      selectedSkillCount: 1,
      candidateSkillCount: 1,
    });
  });

  test('allows offered-only hero matches but keeps skill-only matches hero-anchored', () => {
    const comp = database.team[0];
    const offeredHero = comp.members[0].hero;
    const offeredSkill = comp.members[0].skillSlots[0][0];

    expect(
      selectRelevantTeamComps([], [offeredHero], {
        includeCandidateOnlyComps: true,
      }).some(({ comp: candidate }) => candidate.id === comp.id)
    ).toBe(true);

    expect(
      selectRelevantTeamComps([], [], {
        includeCandidateOnlyComps: false,
        candidateSkills: [offeredSkill],
      })
    ).toHaveLength(0);
  });
});

describe('generateLLMPrompt - return shape', () => {
  test('returns a non-empty prompt string', async () => {
    const result = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('generateLLMPrompt - framing', () => {
  test('uses one model-first priority order and no opponent win-rate framing', async () => {
    const prompt = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(prompt).toContain('【说明】');
    expect(prompt).toContain('- 双方共有资源说明：');
    expect(prompt).not.toContain('战法强度说明：');
    expect(prompt).not.toContain('武将评级说明：');
    expect(prompt).toContain('相对强度');
    expect(prompt).toContain('刻意不展示平滑胜率');
    expect(prompt).toContain(`/game-data/database.json?v=${gameDataCacheVersion()}`);
    expect(prompt).toContain('/game-data/formula.md');
    expect(prompt).toContain('你只能从三组中选择一组');
    expect(prompt).toContain('请根据以上信息，分析三组选项各自的优劣');
    // No opponent-specific win-probability framing.
    expect(prompt).not.toContain('对手胜率');
    // Old Wilson-era wording is gone.
    expect(prompt).not.toContain('调整后胜率');
    expect(prompt).not.toMatch(/平滑胜率\d/);
    expect(prompt).toContain('[整组摘要]');
    expect(prompt).toContain('本轮边际相对强度');
    expect(prompt).not.toContain('单体相对强度合计');
    expect(prompt).not.toContain('正向协同合计');
    expect(prompt).not.toContain('战法心得:');
    expect(prompt).not.toContain('武将心得:');
    expect(prompt).not.toContain('- 相对强度：模型拟合');
    expect(prompt).not.toContain('优先级统一为：');
    expect(prompt).not.toContain('-0.0');
    expect(prompt).not.toContain('战绩:');
    expect(prompt).toContain('模型证据:');
    expect(prompt).toContain('名称说明：武将名末尾的数字');
    expect(prompt).toContain('证据概览（合并现有武将后）');
    expect(prompt).not.toContain('计分特征');
    expect(prompt).toContain('本体证据');
    expect(
      prompt.match(/单项边际与关键组合可能重叠/g)
    ).toHaveLength(1);

    const modelPriority = prompt.indexOf('1. 本轮边际相对强度');
    expect(modelPriority).toBeGreaterThan(-1);
    expect(prompt).not.toContain('排名：定位');
    expect(prompt).not.toContain('武将评级:');
  });

  test('marks the first current hero and first eight current skills as shared', async () => {
    const prompt = await generateLLMPrompt({
      gameState: HERO_ROUND_FOUR_STATE,
      currentRoundInputs: asInputs(HERO_ROUND_FOUR_SETS),
      roundType: 'hero',
    });
    const muluLine = prompt.split('\n').find((line) => line.includes('木鹿大王 |'));
    const zhugeLine = prompt.split('\n').find((line) => line.includes('诸葛亮2 |'));
    const promptLines = prompt.split('\n');
    const laterSkillLine = promptLines.find((line) =>
      line.includes('洗筋伐髓')
    );

    expect(muluLine).toContain('阵营:');
    expect(muluLine).toContain('【初始】');
    expect(zhugeLine).not.toContain('【初始】');
    for (const skill of HERO_ROUND_FOUR_INITIAL_SKILLS) {
      expect(
        promptLines.find((line) => line.includes(skill))
      ).toContain('【初始】');
    }
    expect(laterSkillLine).not.toContain('【初始】');
    expect(prompt).toContain('当前武将列表第1名武将');
    expect(prompt).toContain('当前战法列表前8个战法');
  });
});

describe('generateLLMPrompt - model context', () => {
  test('skill rows omit retired guide tier and note fields', async () => {
    const prompt = await generateLLMPrompt({
      gameState: HERO_ROUND_FOUR_STATE,
      currentRoundInputs: asInputs(HERO_ROUND_FOUR_SETS),
      roundType: 'hero',
    });
    expect(prompt).toContain('七进七出');
    expect(prompt).not.toContain('备注:');
    expect(prompt).not.toContain('战法强度等级');
    expect(prompt).not.toContain('战法心得:');
  });

  test('known-team tips use exact resource markers without source attribution', async () => {
    const prompt = await generateLLMPrompt({
      gameState: HERO_ROUND_FOUR_STATE,
      currentRoundInputs: asInputs(HERO_ROUND_FOUR_SETS),
      roundType: 'hero',
    });
    if (prompt.includes('【已知强力阵容】')) {
      expect(prompt).toContain('标记: ✓=已获得, ◇=本轮可获得, 无标记=尚未获得');
      expect(prompt).toContain('阵型:');
      expect(prompt).toContain('战法位1:');
      expect(prompt).toContain('战法位2:');
      expect(prompt).not.toContain('飞将吕布');
    }
  });

  test('skill rounds include known-team assignments when the owned heroes are relevant', async () => {
    const comp = database.team.find(({ sources }) =>
      sources.includes('championship')
    );
    if (!comp) throw new Error('测试数据库缺少夺冠御三家阵容');
    const compSkills = new Set(
      comp.members.flatMap(({ skillSlots }) => skillSlots.flat())
    );
    const offeredCompSkill = [...compSkills].find((skill) =>
      ORANGE_SKILL_KEYS.includes(skill)
    );
    if (!offeredCompSkill) {
      throw new Error('夺冠御三家阵容缺少可在演武中选择的橙色战法');
    }
    const ownedSkills = ORANGE_SKILL_KEYS.filter(
      (skill) => !compSkills.has(skill)
    ).slice(0, 8);
    expect(ownedSkills).toHaveLength(8);
    const offeredSkills = [
      offeredCompSkill,
      ...ORANGE_SKILL_KEYS.filter(
        (skill) =>
          skill !== offeredCompSkill && !ownedSkills.includes(skill)
      ),
    ].slice(0, 9);
    expect(offeredSkills).toHaveLength(9);
    const ownedHeroes = [
      comp.members[0].hero,
      ...HERO_KEYS.filter(
        (hero) => !comp.members.some((member) => member.hero === hero)
      ).slice(0, 3),
    ];
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 2,
        current_heroes: ownedHeroes,
        current_skills: ownedSkills,
        support_hero: null,
        support_skills: [],
        round_history: [],
      },
      currentRoundInputs: asInputs([
        offeredSkills.slice(0, 3),
        offeredSkills.slice(3, 6),
        offeredSkills.slice(6, 9),
      ]),
      roundType: 'skill',
    });
    expect(prompt).toContain('【已知强力阵容】');
    expect(prompt).toContain('夺冠御三家｜冠军参考｜S');
    expect(prompt).toContain(`阵型:${comp.formation}`);
    for (const { hero, skillSlots } of comp.members) {
      expect(prompt).toContain(hero);
      expect(prompt).toContain(`战法位1:${skillSlots[0][0]}`);
      expect(prompt).toContain('战法位2:');
    }
    expect(prompt).toContain(`${offeredCompSkill}◇`);
    expect(prompt).toContain('战法位1:');
    expect(prompt).toContain('战法位2:');
    expect(prompt).not.toContain('【玩家心得】');
    expect(prompt).not.toContain('战法强度说明：');
    expect(prompt).toContain('证据概览（本组选项贡献）');
    expect(prompt).not.toContain('飞将吕布');
    expect(prompt).not.toContain('S+');
  });

  test('round-group summaries exactly match the live hero recommender', async () => {
    const expected = recommendHeroSet(
      HERO_ROUND_FOUR_SETS,
      HERO_ROUND_FOUR_STATE.current_heroes,
      recommendationData,
      HERO_ROUND_FOUR_STATE.current_skills
    );
    const prompt = await generateLLMPrompt({
      gameState: HERO_ROUND_FOUR_STATE,
      currentRoundInputs: asInputs(HERO_ROUND_FOUR_SETS),
      roundType: 'hero',
    });

    for (const option of expected.analysis) {
      const score = `${option.final_score >= 0 ? '+' : ''}${option.final_score.toFixed(1)}`;
      expect(prompt).toContain(
        `[整组摘要] 本轮边际相对强度:${score}；页面推荐排名:${option.rank}/3`
      );
    }
    const firstGroup = prompt
      .split('--- 第1组 ---')[1]
      .split('--- 第2组 ---')[0];
    const pairContribution = expected.analysis[0].combo_synergies.find(
      (contribution) => contribution.label === '陆抗 + 陆逊'
    );
    const pairScore = pairContribution
      ? `${pairContribution.weight >= 0 ? '+' : ''}${(
          pairContribution.weight * 10
        ).toFixed(1)}`
      : null;
    const planningWeight = weightOf(
      recommendationData.model,
      heroSkillId('陆逊', '洗筋伐髓')
    );
    const planningScore = `${planningWeight >= 0 ? '+' : ''}${(
      planningWeight * 10
    ).toFixed(1)}`;
    const planningSupport = supportOf(
      recommendationData.model,
      heroSkillId('陆逊', '洗筋伐髓')
    );
    const planningEvidence =
      planningSupport < 10
        ? `证据${planningSupport}场，低证据`
        : `证据${planningSupport}场`;

    expect(firstGroup).toContain('关键组合协同');
    if (pairScore !== null) {
      expect(firstGroup).toContain(
        `武将配合 陆抗 + 陆逊: ${pairScore}`
      );
      expect(
        firstGroup.split('武将配合 陆抗 + 陆逊').length - 1
      ).toBe(1);
    }
    expect(firstGroup).not.toContain('主要正向贡献');
    expect(firstGroup).not.toContain('主要负向权衡');
    expect(firstGroup).not.toContain('关键组合协同: 无');
    expect(firstGroup).not.toContain('关键组合权衡: 无');
    expect(firstGroup).toContain(
      `陆逊携带洗筋伐髓: 相对强度${planningScore} (${planningEvidence})`
    );
    expect(firstGroup.indexOf('[补充规划线索]')).toBeLessThan(
      firstGroup.indexOf('陆逊携带洗筋伐髓')
    );
  });

  test('skill summaries use only the live best hero route for each offered skill', async () => {
    const expected = recommendSkillSet(
      SKILL_ROUND_FIVE_SETS,
      SKILL_ROUND_FIVE_STATE.current_heroes,
      SKILL_ROUND_FIVE_STATE.current_skills,
      recommendationData
    );
    const prompt = await generateLLMPrompt({
      gameState: SKILL_ROUND_FIVE_STATE,
      currentRoundInputs: asInputs(SKILL_ROUND_FIVE_SETS),
      roundType: 'skill',
    });

    const firstOption = expected.analysis[0];
    const fireItem = firstOption.item_scores.find(
      (item) => item.item === '烈火焚营'
    );
    const fireRoute = [
      ...firstOption.combo_synergies,
      ...firstOption.tradeoffs,
    ].find(
      (contribution) =>
        contribution.family === 'HS' &&
        contribution.label.endsWith(' · 烈火焚营')
    );
    expect(fireItem).toBeDefined();
    const itemScore = `${fireItem!.score >= 0 ? '+' : ''}${fireItem!.score.toFixed(1)}`;
    expect(prompt).toContain(`烈火焚营 ${itemScore}`);
    if (fireRoute) {
      const routeScore = `${fireRoute.weight >= 0 ? '+' : ''}${(
        fireRoute.weight * 10
      ).toFixed(1)}`;
      const routedHero = fireRoute.label.split(' · ')[0];
      expect(prompt).toContain(
        `武将-战法 ${fireRoute.label}: ${routeScore}`
      );
      for (const hero of SKILL_ROUND_FIVE_STATE.current_heroes) {
        if (hero !== routedHero) {
          expect(prompt).not.toContain(`武将-战法 ${hero} · 烈火焚营`);
        }
      }
    }
    for (const option of expected.analysis) {
      const score = `${option.final_score >= 0 ? '+' : ''}${option.final_score.toFixed(1)}`;
      expect(prompt).toContain(
        `[整组摘要] 本轮边际相对强度:${score}；页面推荐排名:${option.rank}/3`
      );
    }
  });
});

describe('generateLLMPrompt - round planning', () => {
  test('round 4 accounts for the support pick after round 6', async () => {
    const prompt = await generateLLMPrompt({
      gameState: HERO_ROUND_FOUR_STATE,
      currentRoundInputs: asInputs(HERO_ROUND_FOUR_SETS),
      roundType: 'hero',
    });

    expect(prompt).toContain('第6轮后可补选1名支援武将及2个支援战法');
    expect(prompt).toContain('下一次常规三组选将在第7轮');
  });

  test('round 7 prompt accounts for the final hero choice in round 9', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 7,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: ['七进七出'],
        support_hero: null,
        support_skills: [],
      } as unknown as GameState,
      currentRoundInputs: {
        set1: ['祝融', '孟获'],
        set2: ['孙权', '陆抗'],
        set3: ['张宁', '左慈'],
      },
      roundType: 'hero',
    });

    expect(prompt).toContain('第9轮还有一次选将机会');
    expect(
      prompt.split('现有资源适配线索').length - 1
    ).toBe(0);
    const expectedPositiveRoute =
      weightOf(
        recommendationData.model,
        heroSkillId('祝融', '七进七出')
      ) > 0
        ? 1
        : 0;
    expect(
      prompt.split('祝融携带七进七出').length - 1
    ).toBe(expectedPositiveRoute);
  });

  test('round 4+ adds globally legal team constraints; round 1 does not', async () => {
    const round4 = await generateLLMPrompt({
      gameState: HERO_ROUND_FOUR_STATE,
      currentRoundInputs: asInputs(HERO_ROUND_FOUR_SETS),
      roundType: 'hero',
    });
    expect(round4).toContain('从第4轮开始，请同时给出当前可组成的3队规划');
    expect(round4).toContain('缺少的战法位留空');
    expect(round4).toContain('额外战法在三队中全局不可重复');
    expect(round4).toContain('不得把某武将自己的自带战法');
    expect(round4).toContain('其他武将的自带战法仅在资源池中已拥有时可合法携带');
    expect(round4).toContain('最终推荐组选中后加入的资源');
    expect(round4).toContain('任一组选中后：唯一武将5名');
    expect(round4).not.toContain('暂不能三队各配1名');
    expect(round4).not.toContain('输出核心');
    expect(round4).not.toContain('体系核心');
    expect(
      round4.match(/【本轮组选中后的组队可行性】/g)
    ).toHaveLength(1);
    expect(round4).not.toContain('[组队可行性]');

    const round1 = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(round1).not.toContain('从第4轮开始');
    expect(round1).not.toContain('组队约束：');
    expect(round1).not.toContain('组队可行性');
    expect(round1).not.toContain('[成队影响]');
    expect(round1).toContain('不要求现在凑齐三队');
  });

  test('rounds 2 and 3 omit premature team-feasibility guidance', async () => {
    const round2State: GameState = {
      ...baseGameState,
      round_number: 2,
      current_heroes: [
        ...baseGameState.current_heroes,
        ...baseInputs.set1,
      ],
    };
    const round2Sets = buildSkillSets(round2State.current_skills);
    const round3State: GameState = {
      ...round2State,
      round_number: 3,
      current_skills: [
        ...round2State.current_skills,
        ...round2Sets[0],
      ],
    };
    const round3Sets = buildSkillSets(round3State.current_skills);

    for (const [gameState, sets] of [
      [round2State, round2Sets],
      [round3State, round3Sets],
    ] as const) {
      const prompt = await generateLLMPrompt({
        gameState,
        currentRoundInputs: asInputs(sets),
        roundType: 'skill',
      });
      expect(prompt).not.toContain('组队可行性');
      expect(prompt).not.toContain('[成队影响]');
      expect(prompt).toContain('不要求现在凑齐三队');
    }
  });

  test('guide hero rankings do not create option-specific recommendation impact', async () => {
    const owned = new Set(HERO_ROUND_FOUR_STATE.current_heroes);
    const rankedHeroes = HERO_KEYS.filter(
      (hero) =>
        !owned.has(hero) &&
        database.heroes?.[hero]?.ranking === 'S'
    ).slice(0, 3);
    const otherHeroes = HERO_KEYS.filter(
      (hero) =>
        !owned.has(hero) &&
        !rankedHeroes.includes(hero)
    ).slice(0, 6);
    expect(rankedHeroes).toHaveLength(3);
    expect(otherHeroes).toHaveLength(6);
    const sets: [string[], string[], string[]] = rankedHeroes.map(
      (hero, index) => [
        hero,
        otherHeroes[index * 2],
        otherHeroes[index * 2 + 1],
      ]
    ) as [string[], string[], string[]];

    const prompt = await generateLLMPrompt({
      gameState: HERO_ROUND_FOUR_STATE,
      currentRoundInputs: asInputs(sets),
      roundType: 'hero',
    });

    expect(prompt).not.toContain('[成队影响]');
    expect(prompt).not.toContain('武将评级:');
    expect(prompt).not.toContain('S级武将');
  });

  test('skill rounds show one shared feasibility block and no repeated option impact', async () => {
    const prompt = await generateLLMPrompt({
      gameState: SKILL_ROUND_FIVE_STATE,
      currentRoundInputs: asInputs(SKILL_ROUND_FIVE_SETS),
      roundType: 'skill',
    });

    expect(
      prompt.match(/【本轮组选中后的组队可行性】/g)
    ).toHaveLength(1);
    expect(prompt).not.toContain('[成队影响]');
  });

  test('prompt omits bonds and manual detail-lookup instructions', async () => {
    const prompt = await generateLLMPrompt({
      gameState: HERO_ROUND_FOUR_STATE,
      currentRoundInputs: asInputs(HERO_ROUND_FOUR_SETS),
      roundType: 'hero',
    });
    expect(prompt).not.toContain('可触发缘分');
    expect(prompt).not.toContain('羁绊');
  });
});

describe('generateLLMPrompt - validation', () => {
  const attempt = (
    gameState: GameState,
    currentRoundInputs: CurrentRoundInputs,
    roundType: RoundType
  ) => generateLLMPrompt({ gameState, currentRoundInputs, roundType });

  test('rejects a round-type mismatch and malformed set sizes', async () => {
    await expect(
      attempt(baseGameState, baseInputs, 'skill')
    ).rejects.toThrow('提示词类型不一致');
    await expect(
      attempt(
        baseGameState,
        { ...baseInputs, set1: [HERO_E, HERO_F] },
        'hero'
      )
    ).rejects.toThrow('每组必须恰好有3项');
  });

  test('rejects duplicate, already-owned, and unknown hero offers', async () => {
    await expect(
      attempt(
        baseGameState,
        { ...baseInputs, set2: [HERO_H, HERO_I, HERO_E] },
        'hero'
      )
    ).rejects.toThrow('重复名称');
    await expect(
      attempt(
        baseGameState,
        { ...baseInputs, set2: [HERO_H, HERO_I, HERO_A] },
        'hero'
      )
    ).rejects.toThrow('已在当前资源池');
    await expect(
      attempt(
        baseGameState,
        { ...baseInputs, set2: [HERO_H, HERO_I, '不存在的武将'] },
        'hero'
      )
    ).rejects.toThrow('不是数据库中的武将');
  });

  test('rejects non-orange or signature skill offers', async () => {
    const signature = database.heroes[HERO_A].skill;
    for (const invalidSkill of [signature, PURPLE_SKILL_KEY!]) {
      const invalidSets = asInputs([
        [
          invalidSkill,
          SKILL_ROUND_FIVE_SETS[0][1],
          SKILL_ROUND_FIVE_SETS[0][2],
        ],
        SKILL_ROUND_FIVE_SETS[1],
        SKILL_ROUND_FIVE_SETS[2],
      ]);
      await expect(
        attempt(SKILL_ROUND_FIVE_STATE, invalidSets, 'skill')
      ).rejects.toThrow('不是可选的橙色非自带战法');
    }
  });
});

describe('generateTeamBuilderPrompt', () => {
  test('lists the pool and model relative-strength sections', async () => {
    const heroes = ['孙权', '陆抗', '陆逊', '祝融', '孟获', '甘夫人', '张宁', '左慈', '孙坚'];
    const skills = SKILL_KEYS.slice(0, 18);
    const prompt = await generateTeamBuilderPrompt(heroes, skills);
    expect(prompt).toContain('【武将池】');
    expect(prompt).toContain('【战法池】');
    expect(prompt).toContain('相对强度');
    expect(prompt).toContain(`/game-data/database.json?v=${gameDataCacheVersion()}`);
    expect(prompt).not.toContain('调整后胜率');
    expect(prompt).not.toMatch(/平滑胜率\d/);
    expect(prompt).not.toContain('提示中会用【初始】标注');
    expect(prompt).not.toContain('输出核心');
    expect(prompt).not.toContain('体系核心');
    expect(prompt).toContain('软性偏好');
    expect(prompt).toContain('最多分配2个额外战法');
    expect(prompt).not.toContain('每名武将分配2个战法');
    expect(prompt).toContain('额外战法在三队中全局不可重复');
    expect(prompt).toContain('只能使用本提示中的武将池和战法池');
    expect(prompt.match(/game-data\/database\.json/g)).toHaveLength(1);
    expect(prompt.match(/game-data\/formula\.md/g)).toHaveLength(1);
    expect(
      prompt.match(/额外战法在三队中全局不可重复/g)
    ).toHaveLength(1);
    expect(prompt.match(/\[组队可行性\]/g)).toHaveLength(1);
    expect(prompt).toContain('固定自带战法');
    expect(prompt).toContain('同阵营组队仅作软性偏好');
    expect(prompt).toContain('只是正向解释线索，不是完整模型穷举');
    expect(prompt).not.toContain('3支最优队伍');
    expect(prompt).not.toContain('战绩:');
    expect(prompt).toContain('可分配战法不足18个时，仅将缺少的额外战法位留空');
    expect(prompt).toContain('武将不足9名时才留空武将位');

    const modelPriority = prompt.indexOf('1. 模型线索');
    expect(modelPriority).toBeGreaterThan(-1);
    expect(prompt).not.toContain('排名：定位');
  });

  test('deduplicates pools and reports infeasible unique resource counts', async () => {
    const heroes = ['孙权', '陆抗', '陆逊', '祝融', '孟获', '甘夫人', '张宁', '左慈', '孙坚'];
    const duplicatedSkills = Array.from({ length: 18 }, (_, i) => SKILL_KEYS[i % 6]);
    const prompt = await generateTeamBuilderPrompt(heroes, duplicatedSkills);
    expect(prompt).toContain('存在重复名称');
    expect(prompt).toContain('唯一9名武将/6个战法');
    expect(prompt).toContain('资源池中可分配的唯一战法6个（填满战法位需18个）');
    const firstSkill = duplicatedSkills[0];
    const occurrences = prompt.split('\n').filter((line) => line.startsWith(`  ${firstSkill}`)).length;
    expect(occurrences).toBe(1);
  });

  test('allows an owned signature skill on a different hero while forbidding an owner duplicate', async () => {
    const heroes = ['孙权', '陆抗', '陆逊', '祝融', '孟获', '甘夫人', '张宁', '左慈', '孙坚'];
    const ownedSignature = database.heroes[HERO_A].skill;
    const skills = [ownedSignature, ...SKILL_KEYS.slice(0, 17)];
    const prompt = await generateTeamBuilderPrompt(heroes, skills);

    expect(prompt).toContain('资源池中可分配的唯一战法18个（填满战法位需18个）');
    expect(prompt).toContain('不得把某武将自己的自带战法放入该武将的额外战法槽');
    expect(prompt).toContain('其他武将的自带战法仅在战法池中已拥有时可合法携带');
  });
});

const arrangedTeams: TeamPromptInput = {
  teams: [
    {
      formation: '箕形阵',
      heroes: [
        { hero: HERO_A, row: '前排', skills: [SKILL_KEYS[0], SKILL_KEYS[1]] },
        { hero: HERO_B, row: '后排', skills: [SKILL_KEYS[0], null] },
        { hero: null, row: '前排', skills: [null, null] },
      ],
    },
    {
      formation: '鱼鳞阵',
      heroes: [
        { hero: null, row: '前排', skills: [null, null] },
      ],
    },
    {
      formation: '一字阵',
      heroes: [
        { hero: HERO_C, row: '后排', skills: [database.heroes[HERO_B].skill, null] },
      ],
    },
  ],
  availableHeroes: [HERO_A, HERO_B, HERO_C, HERO_D, HERO_D, HERO_E],
  availableSkills: [
    SKILL_KEYS[0],
    SKILL_KEYS[1],
    SKILL_KEYS[2],
    SKILL_KEYS[2],
    database.heroes[HERO_B].skill,
  ],
};

describe('generateTeamValidationPrompt', () => {
  test('serializes populated teams with formations, rows, signatures, extras, and public URLs', () => {
    const prompt = generateTeamValidationPrompt(arrangedTeams);

    expect(prompt).toContain('队伍1');
    expect(prompt).toContain('阵型：箕形阵');
    expect(prompt).toContain(`- ${HERO_A}｜站位：前排`);
    expect(prompt).toContain(`- ${HERO_B}｜站位：后排`);
    expect(prompt).toContain(`自带战法（固定）：${database.heroes[HERO_A].skill}`);
    expect(prompt).toContain(`额外战法：${SKILL_KEYS[0]}、${SKILL_KEYS[1]}`);
    expect(prompt).toContain('队伍3');
    expect(prompt).not.toContain('队伍2');
    expect(prompt).toContain(`/game-data/database.json?v=${gameDataCacheVersion()}`);
    expect(prompt).toContain('/game-data/formula.md');
  });

  test('asks for exact-lineup validation, risks, row/formation changes, and pool-feasible substitutions', () => {
    const prompt = generateTeamValidationPrompt(arrangedTeams);

    expect(prompt).toContain('精确的已编辑阵容');
    expect(prompt).toContain('不要忽略现有编排而从零盲目重组');
    expect(prompt).toContain('强度与机制');
    expect(prompt).toContain('关键风险');
    expect(prompt).toContain('阵型或前排/后排调整');
    expect(prompt).toContain('可在当前已分配资源之间重新分配或互换');
    expect(prompt).toContain('引入新武将/战法则只能使用上方未使用资源池项目');
    expect(prompt).toContain('本提示未提供对手阵容或胜率');
    expect(prompt).not.toContain('页面模型评分');
  });

  test('preserves invalid duplicates for review and deduplicates only unused-pool reporting', () => {
    const duplicatedHeroInput: TeamPromptInput = {
      ...arrangedTeams,
      teams: [
        arrangedTeams.teams[0],
        {
          formation: '一字阵',
          heroes: [
            { hero: HERO_A, row: '后排', skills: [SKILL_KEYS[0], null] },
          ],
        },
      ],
    };
    const prompt = generateTeamValidationPrompt(duplicatedHeroInput);
    const serializedHeroLines = prompt
      .split('\n')
      .filter((line) => line.startsWith(`  - ${HERO_A}｜`));
    const unusedHeroLine = prompt.split('\n').find((line) => line.startsWith('  武将：'));
    const unusedSkillLine = prompt.split('\n').find((line) => line.startsWith('  战法：'));

    expect(serializedHeroLines).toHaveLength(2);
    expect(prompt.split(SKILL_KEYS[0]).length - 1).toBeGreaterThanOrEqual(3);
    expect(unusedHeroLine?.split(HERO_D)).toHaveLength(2);
    expect(unusedSkillLine?.split(SKILL_KEYS[2])).toHaveLength(2);
    expect(prompt).toContain('武将重复');
    expect(prompt).toContain('额外战法重复');
    expect(prompt).toContain('某武将把自己的自带战法重复放入其额外战法槽');
    expect(prompt).toContain('其他武将的自带战法若在资源池中则可合法携带');
  });

  test('returns an empty string when no hero is assigned', () => {
    const emptyInput: TeamPromptInput = {
      teams: [
        {
          formation: '箕形阵',
          heroes: [{ hero: null, row: '前排', skills: [SKILL_KEYS[0], null] }],
        },
      ],
      availableHeroes: [HERO_A],
      availableSkills: [SKILL_KEYS[0]],
    };

    expect(generateTeamValidationPrompt(emptyInput)).toBe('');
  });
});

describe('generateTeamShareText', () => {
  test('creates concise player-facing lineup text with formations, rows, and skills only', () => {
    const text = generateTeamShareText(arrangedTeams);

    expect(text).toContain('三国谋定天下三队阵容');
    expect(text).toContain('队伍1｜阵型：箕形阵');
    expect(text).toContain(`前排｜${HERO_A}`);
    expect(text).toContain(`后排｜${HERO_B}`);
    expect(text).toContain(`自带：${database.heroes[HERO_A].skill}`);
    expect(text).toContain(`额外：${SKILL_KEYS[0]}、${SKILL_KEYS[1]}`);
    expect(text).toContain('队伍3｜阵型：一字阵');
    expect(text).not.toContain('队伍2');
    expect(text).not.toContain('/game-data/');
    expect(text).not.toContain('相对强度');
    expect(text.length).toBeLessThan(800);
  });

  test('returns an empty string for an empty layout', () => {
    expect(generateTeamShareText({ teams: [] })).toBe('');
    expect(generateTeamShareText({
      teams: [{
        formation: '',
        heroes: [{ hero: null, row: '后排', skills: [null, null] }],
      }],
    })).toBe('');
  });
});
