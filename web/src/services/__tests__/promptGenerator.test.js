/**
 * Integration tests for generateLLMPrompt covering the new
 * incremental-mode behavior.
 *
 * Uses the real database2.json / battle_stats.json that ship with the app.
 */
import { generateLLMPrompt } from '../promptGenerator';
import database2 from '../../database2.json';

// Pick three real heroes that exist in database2 so formatHeroInfo produces
// the expected structured output (阵营/兵种/...).
const HERO_KEYS = Object.keys(database2.wj || {});
const SKILL_KEYS = Object.keys(database2.zf || {});
// Guard the tests from breaking if the database shape changes drastically.
expect(HERO_KEYS.length).toBeGreaterThanOrEqual(6);
expect(SKILL_KEYS.length).toBeGreaterThanOrEqual(3);

const HERO_A = HERO_KEYS[0];
const HERO_B = HERO_KEYS[1];
const HERO_C = HERO_KEYS[2];
const HERO_D = HERO_KEYS[3];
const HERO_E = HERO_KEYS[4];
const HERO_F = HERO_KEYS[5];
const SKILL_A = SKILL_KEYS[0];

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
  test('returns an object with prompt and newlySeen', async () => {
    const result = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(typeof result.prompt).toBe('string');
    expect(result.newlySeen).toBeDefined();
    expect(Array.isArray(result.newlySeen.heroes)).toBe(true);
    expect(Array.isArray(result.newlySeen.skills)).toBe(true);
    expect(Array.isArray(result.newlySeen.bondIds)).toBe(true);
  });

  test('newlySeen.heroes contains every hero present in the prompt', async () => {
    const { newlySeen } = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    const expected = new Set([
      ...baseGameState.current_heroes,
      ...baseInputs.set1,
      ...baseInputs.set2,
      ...baseInputs.set3,
    ]);
    for (const h of expected) {
      expect(newlySeen.heroes).toContain(h);
    }
  });
});

describe('generateLLMPrompt - full mode (default)', () => {
  test('includes Wilson explanation, 阵型 reference, 重要规则 and full priority list', async () => {
    const { prompt } = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    expect(prompt).toContain('胜率指数说明');
    expect(prompt).toContain('阵型参考');
    expect(prompt).toContain('重要规则');
    expect(prompt).toContain('请根据以上信息，分析三组选项各自的优劣');
    expect(prompt).not.toContain('增量模式');
  });

  test('emits structured info (阵营/兵种) for selected and candidate heroes', async () => {
    const { prompt } = await generateLLMPrompt({
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

describe('generateLLMPrompt - incremental mode without prior state', () => {
  test('behaves like full mode when staticShown is false (no prior context)', async () => {
    const { prompt } = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
      incremental: true,
      seenContext: { seenHeroes: [], seenSkills: [], seenBondIds: [], staticShown: false },
    });
    expect(prompt).toContain('胜率指数说明');
    expect(prompt).toContain('阵型参考');
    expect(prompt).not.toContain('增量模式');
  });
});

describe('generateLLMPrompt - incremental mode with prior state', () => {
  const seenContext = {
    seenHeroes: [HERO_A, HERO_B],
    seenSkills: [],
    seenBondIds: [],
    staticShown: true,
  };

  test('omits static reference sections and long priority list', async () => {
    const { prompt } = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    expect(prompt).toContain('增量模式');
    expect(prompt).not.toContain('胜率指数说明');
    expect(prompt).not.toContain('阵型参考');
    expect(prompt).not.toContain('重要规则');
    expect(prompt).not.toContain('请根据以上信息，分析三组选项各自的优劣');
    expect(prompt).toContain('评估优先级和选择规则同前轮');
  });

  test('does not re-emit full description for already-seen heroes', async () => {
    const { prompt } = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    // HERO_A is in seenHeroes; the line where it appears (already-selected slot or
    // candidate set entry) should NOT include "阵营:" tag for that hero.
    const aLine = prompt.split('\n').find(l => l.includes(`. ${HERO_A}`) && !l.includes('阵营:'));
    expect(aLine).toBeDefined();
    // HERO_C is NOT in seenHeroes; it should still get the full description.
    expect(prompt).toMatch(new RegExp(`${HERO_C}[^\n]*阵营:`));
  });

  test('newlySeen.heroes still tracks every hero present (including seen ones)', async () => {
    const { newlySeen } = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    expect(newlySeen.heroes).toEqual(expect.arrayContaining([HERO_A, HERO_B, HERO_C, HERO_D, HERO_E, HERO_F]));
  });

  test('produces a strictly shorter prompt than full mode for the same input', async () => {
    const fullRes = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
    });
    const incRes = await generateLLMPrompt({
      gameState: baseGameState,
      currentRoundInputs: baseInputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    expect(incRes.prompt.length).toBeLessThan(fullRes.prompt.length);
  });
});

describe('generateLLMPrompt - incremental mode handles team/support changes', () => {
  test('a freshly-added support hero (not previously seen) still gets full description', async () => {
    const newSupportHero = HERO_F; // never appeared before in this scenario
    const seenContext = {
      seenHeroes: [HERO_A, HERO_B, HERO_C],
      seenSkills: [],
      seenBondIds: [],
      staticShown: true,
    };
    const gameState = {
      ...baseGameState,
      round_number: 4,
      current_heroes: [HERO_A, HERO_B],
      support_hero: newSupportHero,
    };
    const inputs = {
      set1: [HERO_A, HERO_B, HERO_C],
      set2: [HERO_A, HERO_C, HERO_D],
      set3: [HERO_B, HERO_C, HERO_D],
    };
    const { prompt, newlySeen } = await generateLLMPrompt({
      gameState,
      currentRoundInputs: inputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    // Newly added support hero should have full structured info (阵营:).
    expect(prompt).toMatch(new RegExp(`${newSupportHero}[^\n]*阵营:`));
    // And it must be tracked in newlySeen so the next round skips its description.
    expect(newlySeen.heroes).toContain(newSupportHero);
  });

  test('a freshly-added support skill (not previously seen) still gets full description', async () => {
    const newSupportSkill = SKILL_KEYS[2];
    const seenContext = {
      seenHeroes: [HERO_A],
      seenSkills: [SKILL_A, SKILL_KEYS[1]],
      seenBondIds: [],
      staticShown: true,
    };
    const gameState = {
      ...baseGameState,
      round_number: 5,
      current_heroes: [HERO_A],
      current_skills: [SKILL_A, SKILL_KEYS[1]],
      support_skills: [newSupportSkill],
    };
    const inputs = { set1: [HERO_B, HERO_C, HERO_D], set2: [], set3: [] };
    const { prompt, newlySeen } = await generateLLMPrompt({
      gameState,
      currentRoundInputs: inputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    // The newly added support skill must appear with structured info (类型:).
    expect(prompt).toMatch(new RegExp(`${newSupportSkill}[^\n]*类型:`));
    expect(newlySeen.skills).toContain(newSupportSkill);
  });

  test('replacing an already-chosen team hero with a brand-new hero re-emits full description', async () => {
    // Simulate: round N+1 after the user UPDATE_TEAM-swapped HERO_A for HERO_F.
    // HERO_F was never offered in any earlier round, so it is NOT in seenHeroes.
    const seenContext = {
      seenHeroes: [HERO_A, HERO_B, HERO_C, HERO_D, HERO_E],
      seenSkills: [],
      seenBondIds: [],
      staticShown: true,
    };
    const gameState = {
      ...baseGameState,
      round_number: 6,
      // HERO_A was swapped out; HERO_F is the new pick
      current_heroes: [HERO_F, HERO_B],
    };
    const inputs = {
      set1: [HERO_C, HERO_D, HERO_E],
      set2: [HERO_C, HERO_D, HERO_E],
      set3: [HERO_C, HERO_D, HERO_E],
    };
    const { prompt } = await generateLLMPrompt({
      gameState,
      currentRoundInputs: inputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    // HERO_F is brand new → full description (阵营:).
    expect(prompt).toMatch(new RegExp(`${HERO_F}[^\n]*阵营:`));
    // HERO_B was previously seen → just its name on the rendering line.
    const bLine = prompt.split('\n').find(l => l.includes(`. ${HERO_B}`) && !l.includes('阵营:'));
    expect(bLine).toBeDefined();
  });

  test('swapping support hero to a previously-seen entity does NOT re-emit description (already shown to AI)', async () => {
    // HERO_E was an offered candidate in an earlier round (so AI has seen its full info).
    // The user now picks HERO_E as support hero. Skipping its description is correct
    // and the desired token-efficient behavior.
    const seenContext = {
      seenHeroes: [HERO_A, HERO_B, HERO_E],
      seenSkills: [],
      seenBondIds: [],
      staticShown: true,
    };
    const gameState = {
      ...baseGameState,
      round_number: 7,
      current_heroes: [HERO_A, HERO_B],
      support_hero: HERO_E,
    };
    const inputs = { set1: [HERO_C, HERO_D, HERO_F], set2: [], set3: [] };
    const { prompt } = await generateLLMPrompt({
      gameState,
      currentRoundInputs: inputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    // HERO_E (now the support) must appear without 阵营: on its rendering line,
    // because the AI already received its full description in a prior round.
    const eLine = prompt.split('\n').find(l => l.includes(`. ${HERO_E}`) && !l.includes('阵营:'));
    expect(eLine).toBeDefined();
    // Brand-new HERO_F (candidate) still gets full info.
    expect(prompt).toMatch(new RegExp(`${HERO_F}[^\n]*阵营:`));
  });

  test('adding both a brand-new support hero AND a brand-new support skill emits full info for both', async () => {
    const newSupportHero = HERO_F;
    const newSupportSkill = SKILL_KEYS[2];
    const seenContext = {
      seenHeroes: [HERO_A, HERO_B],
      seenSkills: [SKILL_A],
      seenBondIds: [],
      staticShown: true,
    };
    const gameState = {
      ...baseGameState,
      round_number: 8,
      current_heroes: [HERO_A, HERO_B],
      current_skills: [SKILL_A],
      support_hero: newSupportHero,
      support_skills: [newSupportSkill],
    };
    const inputs = { set1: [HERO_C, HERO_D, HERO_E], set2: [], set3: [] };
    const { prompt, newlySeen } = await generateLLMPrompt({
      gameState,
      currentRoundInputs: inputs,
      roundType: 'hero',
      incremental: true,
      seenContext,
    });
    expect(prompt).toMatch(new RegExp(`${newSupportHero}[^\n]*阵营:`));
    expect(prompt).toMatch(new RegExp(`${newSupportSkill}[^\n]*类型:`));
    expect(newlySeen.heroes).toContain(newSupportHero);
    expect(newlySeen.skills).toContain(newSupportSkill);
  });
});

describe('generateLLMPrompt - incremental mode for skill rounds', () => {
  test('does not re-emit full description for seen skills', async () => {
    const skillRoundInputs = {
      set1: [SKILL_A, SKILL_KEYS[1], SKILL_KEYS[2]],
      set2: [SKILL_KEYS[1], SKILL_KEYS[2], SKILL_A],
      set3: [SKILL_KEYS[2], SKILL_A, SKILL_KEYS[1]],
    };
    const skillState = {
      ...baseGameState,
      round_number: 3,
      current_heroes: [HERO_A],
      current_skills: [SKILL_A],
    };
    const { prompt, newlySeen } = await generateLLMPrompt({
      gameState: skillState,
      currentRoundInputs: skillRoundInputs,
      roundType: 'skill',
      incremental: true,
      seenContext: { seenHeroes: [HERO_A], seenSkills: [SKILL_A], seenBondIds: [], staticShown: true },
    });
    // SKILL_A should appear without "类型:" descriptor on its rendering line.
    const skillALine = prompt.split('\n').find(l => l.includes(`. ${SKILL_A}`) && !l.includes('类型:'));
    expect(skillALine).toBeDefined();
    expect(newlySeen.skills).toContain(SKILL_A);
  });
});
