import {
  recommendHeroSet,
  recommendSkillSet,
  recommendSingleHero,
  recommendTwoSkills,
  recommendTeams,
} from '../recommendationEngine';
import { battleStats } from '../../data';

/**
 * Characterization (golden) tests for the recommendation engine against the real
 * battle_stats.json. They pin the outputs of every public recommender so the
 * pair-key unification (shared statKeys helpers) can be proven to change nothing.
 */
const HERO_POOL = ['祝融', '司马懿', '姜维', '诸葛亮2', '张宁', '孟获', '皇甫嵩2', '左慈', '袁术'];
const SKILL_POOL = [
  '折冲御侮', '胜敌益强', '避其锐气', '明其虚实', '锐不可当', '料事如神',
  '铸甲销戈', '运筹帷幄', '战八方', '知人善任', '指点乾坤', '惩前毖后',
  '黄天惑心', '步步为营', '洗筋伐髓', '忘私相助', '横征暴敛', '清风驱疾',
];

test('recommendHeroSet is stable', () => {
  const result = recommendHeroSet(
    [['祝融', '孟获'], ['司马懿', '姜维'], ['诸葛亮2', '张宁']],
    ['皇甫嵩2'],
    battleStats,
    []
  );
  expect(result.analysis.map(a => ({ heroes: a.heroes, score: a.final_score }))).toMatchSnapshot();
});

test('recommendSkillSet is stable', () => {
  // Signature: (availableSets, currentHeroes, currentSkills, battleStats).
  const result = recommendSkillSet(
    [['折冲御侮', '胜敌益强'], ['避其锐气', '明其虚实'], ['锐不可当', '料事如神']],
    ['皇甫嵩2', '袁术'],
    [],
    battleStats
  );
  expect(result.analysis.map((a: any) => ({ skills: a.skills, score: a.final_score }))).toMatchSnapshot();
});

test('recommendSingleHero is stable', () => {
  const result = recommendSingleHero(['祝融', '司马懿', '姜维'], ['皇甫嵩2', '袁术'], SKILL_POOL.slice(0, 4), battleStats) as any;
  expect({ hero: result.hero, score: result.score }).toMatchSnapshot();
});

test('recommendTwoSkills is stable', () => {
  const result = recommendTwoSkills(SKILL_POOL.slice(0, 6), ['皇甫嵩2', '袁术'], SKILL_POOL.slice(6, 10), battleStats) as any;
  expect({ skills: result.skills, score: result.score }).toMatchSnapshot();
});

test('recommendTeams is stable', () => {
  const result = recommendTeams(HERO_POOL, SKILL_POOL, battleStats);
  const teams = (result?.teams || []).map(t => ({ heroes: t.heroes }));
  expect(teams).toMatchSnapshot();
});
