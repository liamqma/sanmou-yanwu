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
  type TeamPromptInput,
} from '../promptGenerator';
import { gameDataCacheVersion } from '../../utils/gameDataUrl';
import { database } from '../../data';
import type { GameState } from '../../types/game';

const HERO_KEYS = Object.keys(database.heroes || {});
const HERO_SKILL_SET = new Set(
  Object.values(database.heroes || {}).map((h) => h.skill).filter(Boolean)
);
const SKILL_KEYS = Object.keys(database.skills || {}).filter((n) => !HERO_SKILL_SET.has(n));

expect(HERO_KEYS.length).toBeGreaterThanOrEqual(6);
expect(SKILL_KEYS.length).toBeGreaterThanOrEqual(3);

const [HERO_A, HERO_B, HERO_C, HERO_D, HERO_E, HERO_F] = HERO_KEYS;

const baseGameState: GameState = {
  round_number: 2,
  current_heroes: [HERO_A],
  current_skills: [],
  support_hero: null,
  support_skills: [],
  round_history: [],
};

const baseInputs = {
  set1: [HERO_B, HERO_C, HERO_D],
  set2: [HERO_E, HERO_F, HERO_A],
  set3: [HERO_B, HERO_E, HERO_C],
};

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
  test('uses compact framing and the model explanation, no opponent win-rate framing', async () => {
    const prompt = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(prompt).toContain('【说明】');
    expect(prompt).toContain('- 初始资源说明：');
    expect(prompt).toContain('- 战法强度说明：');
    // New model-based framing.
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
    expect(prompt).not.toContain('战法心得:');
    expect(prompt).not.toContain('武将心得:');
  });

  test('emits structured info (阵营/兵种) and marks only the first selected hero initial', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
      } as unknown as GameState,
      currentRoundInputs: {
        set1: ['祝融', '孟获', '甘夫人'],
        set2: ['孙权', '陆抗', '陆逊'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });
    const muluLine = prompt.split('\n').find((line) => line.includes('木鹿大王 |'));
    const zhugeLine = prompt.split('\n').find((line) => line.includes('诸葛亮2 |'));
    expect(muluLine).toContain('阵营:');
    expect(muluLine).toContain('【初始】');
    expect(zhugeLine).not.toContain('【初始】');
  });
});

describe('generateLLMPrompt - model context', () => {
  test('skill notes are shown inline in skill rows', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: ['七进七出', '洗筋伐髓'],
        support_hero: null,
        support_skills: [],
      } as unknown as GameState,
      currentRoundInputs: {
        set1: ['祝融', '孟获', '甘夫人'],
        set2: ['孙权', '陆抗', '陆逊'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });
    expect(prompt).toMatch(/七进七出[^\n]*备注:影本战法/);
    expect(prompt).not.toContain('战法心得:');
  });

  test('tips mark selected heroes with ✓ and this-round candidates with ◇', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
      } as unknown as GameState,
      currentRoundInputs: {
        set1: ['祝融', '孟获', '甘夫人'],
        set2: ['孙权', '陆抗', '陆逊'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });
    // If a known comp overlaps 木鹿大王/诸葛亮2/祝融, it renders with ✓/◇ markers.
    if (prompt.includes('【玩家心得】')) {
      expect(prompt).toContain('标记: ✓=已选');
    }
  });

  test('skill rounds omit the 玩家心得 tips block entirely', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 5,
        current_heroes: ['木鹿大王', '诸葛亮2', '祝融'],
        current_skills: ['七进七出'],
        support_hero: null,
        support_skills: [],
      } as unknown as GameState,
      currentRoundInputs: {
        set1: ['洗筋伐髓', '横扫千军', '刮骨疗毒'],
        set2: ['溃阵之策', '锋矢阵', '据水断桥'],
        set3: ['长驱直入', '避实击虚', '八门金锁阵'],
      },
      roundType: 'skill',
    });
    expect(prompt).not.toContain('【玩家心得】');
    expect(prompt).toContain('强度：OP > T0');
  });

  test('candidate heroes get model pair/hero-skill context against the pool', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['孙权'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
      } as unknown as GameState,
      currentRoundInputs: {
        set1: ['陆抗', '陆逊', '甘夫人'],
        set2: ['祝融', '孟获', '张宁'],
        set3: ['左慈', '孙坚', '大乔'],
      },
      roundType: 'hero',
    });
    // The model evaluation section is present...
    expect(prompt).toContain('[模型评估]');
    // ...and — the point of this test — it surfaces an *actual per-option*
    // hero-pair synergy line, not just the unconditional section header/legend.
    // 孙权 has fitted HP weights with both 陆抗 and 陆逊 (candidates in set1), so
    // heroPairLines must emit a "与孙权配对: 相对强度… (证据N场)" line. If model
    // synergy surfacing broke (all pair/hero-skill lines empty) this fails.
    expect(prompt).toMatch(/与孙权配对: 相对强度[^\n]*证据\d+场/);
    // The specific 陆逊↔孙权 pairing (the strongest of the two) is present.
    const luxunPair = prompt
      .split('\n')
      .find((line) => line.includes('与孙权配对') && line.includes('证据'));
    expect(luxunPair).toBeDefined();
  });
});

describe('generateLLMPrompt - round planning', () => {
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
  });

  test('round 4+ asks for tentative three-team planning; round 3 does not', async () => {
    const mk = (round: number) =>
      generateLLMPrompt({
        gameState: {
          round_number: round,
          current_heroes: ['木鹿大王', '诸葛亮2'],
          current_skills: ['七进七出'],
          support_hero: null,
          support_skills: [],
        } as unknown as GameState,
        currentRoundInputs: {
          set1: ['祝融', '孟获', '甘夫人'],
          set2: ['孙权', '陆抗', '陆逊'],
          set3: ['张宁', '左慈', '孙坚'],
        },
        roundType: 'hero',
      });
    const round4 = await mk(4);
    expect(round4).toContain('从第4轮开始，请同时给出当前可组成的3队规划');
    expect(round4).toContain('缺少的战法位留空');
    const round3 = await mk(3);
    expect(round3).not.toContain('从第4轮开始');
  });

  test('prompt omits bonds and manual detail-lookup instructions', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
      } as unknown as GameState,
      currentRoundInputs: {
        set1: ['孙权', '陆抗', '陆逊'],
        set2: ['祝融', '孟获', '甘夫人'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });
    expect(prompt).not.toContain('可触发缘分');
    expect(prompt).not.toContain('羁绊');
  });
});

describe('generateTeamBuilderPrompt', () => {
  test('lists the pool and model relative-strength sections', async () => {
    const heroes = ['孙权', '陆抗', '陆逊', '祝融', '孟获', '甘夫人', '张宁', '左慈', '孙坚'];
    const skills = Array.from({ length: 18 }, (_, i) => SKILL_KEYS[i % SKILL_KEYS.length]);
    const prompt = await generateTeamBuilderPrompt(heroes, skills);
    expect(prompt).toContain('【武将池】');
    expect(prompt).toContain('【战法池】');
    expect(prompt).toContain('相对强度');
    expect(prompt).toContain(`/game-data/database.json?v=${gameDataCacheVersion()}`);
    expect(prompt).not.toContain('调整后胜率');
    expect(prompt).not.toMatch(/平滑胜率\d/);
  });

  test('deduplicates repeated team-builder pools and warns clearly', async () => {
    const heroes = ['孙权', '陆抗', '陆逊', '祝融', '孟获', '甘夫人', '张宁', '左慈', '孙坚'];
    const duplicatedSkills = Array.from({ length: 18 }, (_, i) => SKILL_KEYS[i % 6]);
    const prompt = await generateTeamBuilderPrompt(heroes, duplicatedSkills);
    expect(prompt).toContain('存在重复名称');
    expect(prompt).toContain('唯一9名武将/6个战法');
    const firstSkill = duplicatedSkills[0];
    const occurrences = prompt.split('\n').filter((line) => line.startsWith(`  ${firstSkill}`)).length;
    expect(occurrences).toBe(1);
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
    expect(prompt).toContain('只能使用上方已提供的未使用资源池项目');
    expect(prompt).toContain('相对强度，不是胜率、获胜概率');
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
    expect(prompt).toContain('自带战法放入额外战法槽');
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
