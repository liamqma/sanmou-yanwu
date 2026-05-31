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
  test('includes Wilson explanation, 阵型 reference, 重要规则 and full priority list', async () => {
    const prompt = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(prompt).toContain('胜率指数说明');
    expect(prompt).toContain('阵型参考');
    expect(prompt).toContain('重要规则');
    expect(prompt).toContain('请根据以上信息，分析三组选项各自的优劣');
  });

  test('emits structured info (阵营/兵种) for selected and candidate heroes', async () => {
    const prompt = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    // Selected hero block
    expect(prompt).toMatch(new RegExp(`${HERO_A}[^\n]*阵营:`));
    // Candidate set hero
    expect(prompt).toMatch(new RegExp(`${HERO_B}[^\n]*兵种:`));
  });
});
