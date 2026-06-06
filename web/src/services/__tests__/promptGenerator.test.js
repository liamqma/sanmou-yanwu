/**
 * Integration tests for generateLLMPrompt.
 *
 * Uses the real merged database.json / battle_stats.json that ship with the app.
 */
import { generateLLMPrompt } from '../promptGenerator';
import database from '../../database.json';

// Pick real heroes that exist in the merged database so formatHeroInfo
// produces the expected structured output (阵营/兵种/...).
const HERO_KEYS = Object.keys(database.heroes || {});
// Normal (non-hero-exclusive) skills: in the new schema, hero-exclusive
// skills are the ones referenced by heroes[*].skill. Everything else is normal.
const HERO_SKILL_SET = new Set(
  Object.values(database.heroes || {}).map(h => h.skill).filter(Boolean)
);
const SKILL_KEYS = Object.keys(database.skills || {}).filter(n => !HERO_SKILL_SET.has(n));
// Guard the tests from breaking if the database shape changes drastically.
expect(HERO_KEYS.length).toBeGreaterThanOrEqual(6);
expect(SKILL_KEYS.length).toBeGreaterThanOrEqual(3);

const HERO_A = HERO_KEYS[0];
const HERO_B = HERO_KEYS[1];
const HERO_C = HERO_KEYS[2];
const HERO_D = HERO_KEYS[3];
const HERO_E = HERO_KEYS[4];
const HERO_F = HERO_KEYS[5];

const baseGameState = {
  round_number: 2,
  current_heroes: [HERO_A],
  current_skills: [],
  support_hero: null,
  support_skills: [],
};

const baseInputs = {
  set1: [HERO_B, HERO_C, HERO_D],
  set2: [HERO_E, HERO_F, HERO_A], // intentionally include HERO_A to exercise overlap
  set3: [HERO_B, HERO_E, HERO_C],
};

describe('generateLLMPrompt - return shape', () => {
  test('returns the prompt string directly', async () => {
    const result = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('generateLLMPrompt - prompt content', () => {
  test('uses compact prompt framing without verbose reference sections', async () => {
    const prompt = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(prompt).toContain('【说明】');
    expect(prompt).toContain('- 初始资源说明：');
    expect(prompt).toContain('- 战法强度说明：');
    expect(prompt).toContain('- 胜率指数：');
    expect(prompt).toContain('重要规则');
    expect(prompt).toContain('请根据以上信息，分析三组选项各自的优劣');
    expect(prompt).not.toContain('战法心得:');
    expect(prompt).not.toContain('通用心得:');
    expect(prompt).not.toContain('阵型参考');
    expect(prompt).not.toContain('效果:');
    expect(prompt).not.toContain('武力:');
    expect(prompt).not.toContain('武将心得:');
    expect(prompt).not.toContain('战法心得:');
  });

  test('emits structured info (阵营/兵种) for selected and candidate heroes', async () => {
    const prompt = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    // Selected hero block
    expect(prompt).toMatch(new RegExp(`${HERO_A}[^\n]*阵营:[^\n]*【初始】`));
    expect(prompt).toMatch(new RegExp(`${HERO_B}[^\n]*阵营:[^\n]*(?!【初始】)`));
    // Candidate set hero
    expect(prompt).toMatch(new RegExp(`${HERO_B}[^\n]*兵种:`));
  });

  test('only the first selected hero is marked initial', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
      },
      currentRoundInputs: {
        set1: ['祝融', '孟获', '甘夫人'],
        set2: ['孙权', '陆抗', '陆逊'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });

    const muluLine = prompt.split('\n').find(line => line.includes('木鹿大王 |'));
    const zhugeLine = prompt.split('\n').find(line => line.includes('诸葛亮2 |'));
    expect(muluLine).toContain('【初始】');
    expect(zhugeLine).not.toContain('【初始】');
  });

  test('skill notes are shown inline in skill rows, not duplicated in tips', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: ['七进七出', '洗筋伐髓'],
        support_hero: null,
        support_skills: [],
      },
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

  test('hero candidates consider peers from the same candidate set for pair context', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
      },
      currentRoundInputs: {
        set1: ['孙权', '陆抗', '陆逊'],
        set2: ['祝融', '孟获', '甘夫人'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });

    expect(prompt).toContain('孙权:');
    expect(prompt).toContain('与陆抗配对');
    expect(prompt).toContain('与陆逊配对');
    expect(prompt).toContain('与陆抗协同加成');
    expect(prompt).toContain('与陆逊协同加成');
    expect(prompt).toContain('三人组合[孙权,陆抗,陆逊]');
  });

  test('hero candidates use canonical same-set peers after rename', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
      },
      currentRoundInputs: {
        set1: ['祝融', '孟获', '甘夫人'],
        set2: ['孙权', '陆抗', '陆逊'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });

    expect(prompt).toContain('孟获:');
    expect(prompt).toContain('队内已有协同搭档【祝融】');
    expect(prompt).toContain('与祝融配对');
    expect(prompt).not.toContain('缺少关键搭档【祝融,貂蝉】');
  });

  test('round 4+ prompts ask for tentative three-team planning with blank skill slots', async () => {
    const round4Prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: ['七进七出'],
        support_hero: null,
        support_skills: [],
      },
      currentRoundInputs: {
        set1: ['祝融', '孟获', '甘夫人'],
        set2: ['孙权', '陆抗', '陆逊'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });
    expect(round4Prompt).toContain('从第4轮开始，请同时给出当前可组成的3队规划');
    expect(round4Prompt).toContain('缺少的战法位留空');

    const round3Prompt = await generateLLMPrompt({
      gameState: {
        round_number: 3,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: ['七进七出'],
        support_hero: null,
        support_skills: [],
      },
      currentRoundInputs: {
        set1: ['祝融', '孟获', '甘夫人'],
        set2: ['孙权', '陆抗', '陆逊'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });
    expect(round3Prompt).not.toContain('从第4轮开始');
    expect(round3Prompt).not.toContain('缺少的战法位留空');
  });

  test('prompt omits bonds and manual detail-lookup instructions', async () => {
    const prompt = await generateLLMPrompt({
      gameState: {
        round_number: 4,
        current_heroes: ['木鹿大王', '诸葛亮2'],
        current_skills: [],
        support_hero: null,
        support_skills: [],
      },
      currentRoundInputs: {
        set1: ['孙权', '陆抗', '陆逊'],
        set2: ['祝融', '孟获', '甘夫人'],
        set3: ['张宁', '左慈', '孙坚'],
      },
      roundType: 'hero',
    });

    expect(prompt).not.toContain('可触发缘分');
    expect(prompt).not.toContain('羁绊');
    expect(prompt).not.toContain('查询数据库描述');
    expect(prompt).not.toContain('机制细节');
  });
});
