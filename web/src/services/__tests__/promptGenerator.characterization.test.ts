import { generateTeamBuilderPrompt } from '../promptGenerator';

/**
 * Characterization (golden) test for generateTeamBuilderPrompt against the real
 * battle_stats.json. It pins the FULL prompt output so the pair-key unification
 * (sorted hero/skill pair keys, fixed hero,skill keys, single hero-combo key)
 * can be proven behavior-preserving: the snapshot must not change.
 *
 * The hero/skill pools below were chosen because they have dense pair + combo
 * coverage in the data, so the pair/combo/skill-hero sections are populated.
 */
const HEROES = ['祝融', '司马懿', '姜维', '诸葛亮2', '张宁', '孟获', '皇甫嵩2', '左慈', '袁术'];
const SKILLS = [
  '折冲御侮', '胜敌益强', '避其锐气', '明其虚实', '锐不可当', '料事如神',
  '铸甲销戈', '运筹帷幄', '战八方', '知人善任', '指点乾坤', '惩前毖后',
  '黄天惑心', '步步为营', '洗筋伐髓', '忘私相助', '横征暴敛', '清风驱疾',
];

test('generateTeamBuilderPrompt output is stable (golden snapshot)', async () => {
  const prompt = await generateTeamBuilderPrompt(HEROES, SKILLS);
  expect(typeof prompt).toBe('string');
  expect(prompt.length).toBeGreaterThan(200);
  // Sanity: the sections that exercise the pair/combo key lookups are present.
  expect(prompt).toContain('【武将配对战绩】');
  expect(prompt).toMatchSnapshot();
});
