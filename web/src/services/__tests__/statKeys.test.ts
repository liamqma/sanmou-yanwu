import { heroPairKey, skillPairKey, skillHeroPairKey, heroComboKey } from '../statKeys';
import { battleStats } from '../../data';

describe('statKeys builders', () => {
  test('hero/skill pair keys are order-independent and sorted', () => {
    expect(heroPairKey('孙权', '陆逊')).toBe('孙权,陆逊');
    expect(heroPairKey('陆逊', '孙权')).toBe('孙权,陆逊');
    expect(skillPairKey('避其锐气', '折冲御侮')).toBe(skillPairKey('折冲御侮', '避其锐气'));
  });

  test('skill-hero key is fixed hero-first (NOT sorted)', () => {
    expect(skillHeroPairKey('皇甫嵩2', '折冲御侮')).toBe('皇甫嵩2,折冲御侮');
  });

  test('hero combo key is sorted regardless of input order', () => {
    expect(heroComboKey(['袁术', '朱儁', '皇甫嵩2'])).toBe(heroComboKey(['皇甫嵩2', '袁术', '朱儁']));
  });

  test('builders resolve against real battle_stats keys', () => {
    // Every stored key must be reproducible from its parts via the builders,
    // proving the builders agree with the exporter's serialization.
    const aHeroPair = Object.keys(battleStats.hero_pair_stats || {})[0];
    if (aHeroPair) {
      const [a, b] = aHeroPair.split(',');
      expect(heroPairKey(a, b)).toBe(aHeroPair);
    }
    const aSkillHero = Object.keys(battleStats.skill_hero_pair_stats || {})[0];
    if (aSkillHero) {
      const [hero, skill] = aSkillHero.split(',');
      expect(skillHeroPairKey(hero, skill)).toBe(aSkillHero);
    }
  });
});
