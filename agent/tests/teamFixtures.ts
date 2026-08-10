import type { ChatCompletionRequest, ChatModel } from '../src/model.js';
import type { GameKnowledge } from '../src/team/gameData.js';
import type { HeroCompletionInput } from '../src/team/schemas.js';
import type { PartialTeam } from '../src/team/schemas.js';

const skill = (description: string) => ({
  color: 'orange' as const,
  type: '指挥' as const,
  prob: 100,
  desc: description,
  season: 1,
});

export const testKnowledge: GameKnowledge = {
  database: {
    heroes: {
      魏甲: {
        skill: '甲策',
        camp: '魏',
        troop: '骑',
        stats: { wl: 80, zl: 180, ts: 190, xg: 100 },
        season: 1,
        ranking: 'S',
      },
      魏乙: {
        skill: '乙守',
        camp: '魏',
        troop: '盾',
        stats: { wl: 70, zl: 140, ts: 210, xg: 80 },
        season: 1,
        ranking: 'A',
      },
      魏丙: {
        skill: '丙援',
        camp: '魏',
        troop: '弓',
        stats: { wl: 90, zl: 160, ts: 180, xg: 120 },
        season: 1,
        ranking: 'A',
      },
      蜀甲: {
        skill: '蜀攻',
        camp: '蜀',
        troop: '枪',
        stats: { wl: 210, zl: 80, ts: 150, xg: 150 },
        season: 1,
        ranking: 'S',
      },
    },
    skills: {
      甲策: skill('造成谋略伤害并提高友军造成伤害。'),
      乙守: skill('降低我军受到伤害。'),
      丙援: skill('治疗我军并提高统率。'),
      蜀攻: skill('造成高额兵刃伤害。'),
    },
    bonds: {
      魏援: {
        content: '缘分武将造成伤害提升7%',
        condition: '缘分关系2人在同一部队时激活效果',
        members: ['魏甲', '魏丙'],
      },
    },
    formations: { 雁形阵: '后排造成伤害提升，前排承伤。' },
    team: [
      {
        id: 'known-wei-team',
        ranking: 'S',
        sources: ['strong', 'championship'],
        section: '魏国',
        formation: '雁形阵',
        members: [
          { hero: '魏甲', skillSlots: [[], []] },
          { hero: '魏乙', skillSlots: [[], []] },
          { hero: '魏丙', skillSlots: [[], []] },
        ],
      },
    ],
  },
  recommendation: {
    catalog: {
      default_skill: {
        魏甲: '甲策',
        魏乙: '乙守',
        魏丙: '丙援',
        蜀甲: '蜀攻',
      },
    },
    model: {
      min_support_single: 5,
      min_support_pair: 8,
      weights: {
        'H|魏丙': 0.2,
        'HP|魏丙|魏甲': 0.3,
        'HP|魏丙|魏乙': 0.25,
        'H|蜀甲': 0.5,
        'HP|蜀甲|魏甲': -0.1,
        'HP|蜀甲|魏乙': -0.1,
      },
      support: {
        'H|魏丙': 30,
        'HP|魏丙|魏甲': 20,
        'HP|魏丙|魏乙': 18,
        'H|蜀甲': 40,
        'HP|蜀甲|魏甲': 15,
        'HP|蜀甲|魏乙': 15,
      },
    },
  },
};

const extraSkill = (description: string) => ({
  color: 'orange' as const,
  type: '主动' as const,
  prob: 50,
  desc: description,
  season: 1,
});

export const skillTestKnowledge: GameKnowledge = {
  database: {
    ...testKnowledge.database,
    skills: {
      ...testKnowledge.database.skills,
      甲技: extraSkill('造成兵刃伤害。'),
      乙技: extraSkill('提高队友造成的谋略伤害。'),
      丙技: extraSkill('降低敌军造成的伤害。'),
      丁技: extraSkill('造成谋略伤害。'),
      戊技: extraSkill('提高自身统率。'),
      治疗术: { ...extraSkill('治疗我军，并根据智力提高治疗量。'), healingEstimate: 0.6 },
    },
  },
  recommendation: {
    ...testKnowledge.recommendation,
    model: {
      ...testKnowledge.recommendation.model,
      weights: {
        ...testKnowledge.recommendation.model.weights,
        'S|治疗术': 0.2,
        'HS|魏甲|治疗术': 0.35,
        'SP|魏甲|治疗术|甲技': 0.15,
      },
      support: {
        ...testKnowledge.recommendation.model.support,
        'S|治疗术': 30,
        'HS|魏甲|治疗术': 20,
        'SP|魏甲|治疗术|甲技': 12,
      },
    },
  },
};

export const oneBlankInput: HeroCompletionInput = {
  season: 1,
  availableHeroes: ['魏甲', '魏乙', '魏丙', '蜀甲'],
  teams: [
    {
      formation: '雁形阵',
      heroes: [
        { hero: '魏甲', row: '后排', skills: [null, null] },
        { hero: '魏乙', row: '前排', skills: [null, null] },
        { hero: null, row: '前排', skills: [null, null] },
      ],
    },
  ],
};

export const completeReviewTeams: PartialTeam[] = [
  {
    formation: '雁形阵',
    heroes: [
      { hero: '魏甲', row: '后排', skills: ['甲技', '治疗术'] },
      { hero: '魏乙', row: '前排', skills: ['乙技', '丙技'] },
      { hero: '魏丙', row: '后排', skills: ['丁技', '戊技'] },
    ],
  },
];

export const validReviewDecision = JSON.stringify({
  teams: [
    {
      teamIndex: 0,
      strengths: [
        {
          category: 'formation',
          message: '前排承伤、后排输出与雁形阵效果一致。',
          evidence: [{ source: 'formation', id: '雁形阵' }],
        },
        {
          category: 'skill_synergy',
          message: '魏甲的治疗术有正向武将战法证据。',
          evidence: [{ source: 'learnedFeature', id: 'HS|魏甲|治疗术' }],
        },
      ],
      warnings: [],
    },
  ],
  crossTeamWarnings: [],
});

export class FakeChatModel implements ChatModel {
  readonly requests: ChatCompletionRequest[] = [];

  constructor(private readonly content: string | string[]) {}

  async complete(request: ChatCompletionRequest) {
    const responseIndex = this.requests.length;
    this.requests.push(request);
    const content = Array.isArray(this.content)
      ? this.content[responseIndex] ?? this.content.at(-1) ?? ''
      : this.content;
    return {
      id: 'fake-completion',
      model: 'fake-model',
      content,
      finishReason: 'stop',
      usage: null,
    };
  }
}
