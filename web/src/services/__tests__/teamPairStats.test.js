import {
  buildHeroPairIndex,
  buildSkillHeroIndex,
  findBestHeroPair,
  findBestSkillPair,
} from '../teamPairStats';

/**
 * Acceptance tests for the hero/skill pair helpers. These lock in the behavior
 * of the O(n) index-based rewrite (indexes built once, looked up per hero)
 * so it stays equivalent to the previous full-scan implementation.
 */
describe('buildHeroPairIndex + findBestHeroPair', () => {
  const heroPairStats = {
    'A,B': { wins: 8, losses: 2, wilson: 0.5 },   // A-B: 80%
    'A,C': { wins: 6, losses: 4, wilson: 0.4 },   // A-C: 60%
    'A,D': { wins: 0, losses: 0, wilson: 0 },     // no games -> excluded
    'B,C': { wins: 3, losses: 1, wilson: 0.35 },
  };

  test('indexes both heroes of every pair', () => {
    const index = buildHeroPairIndex(heroPairStats);
    expect(index.get('A').map((e) => e.partner).sort()).toEqual(['B', 'C', 'D']);
    expect(index.get('B').map((e) => e.partner).sort()).toEqual(['A', 'C']);
  });

  test('returns partners sorted by win rate, filtered by availability and min games', () => {
    const index = buildHeroPairIndex(heroPairStats);
    const result = findBestHeroPair(index.get('A'), ['A', 'B', 'C', 'D']);

    // D excluded (0 games); B before C (80% > 60%)
    expect(result.map((r) => r.partner)).toEqual(['B', 'C']);
    expect(result[0].winRate).toBeCloseTo(80);
    expect(result[0].wilson).toBeCloseTo(50);
    expect(result[0].total).toBe(10);
  });

  test('respects the available-heroes filter', () => {
    const index = buildHeroPairIndex(heroPairStats);
    const result = findBestHeroPair(index.get('A'), ['A', 'C']); // B not available
    expect(result.map((r) => r.partner)).toEqual(['C']);
  });

  test('returns null when a hero has no qualifying partners', () => {
    const index = buildHeroPairIndex(heroPairStats);
    expect(findBestHeroPair(index.get('Z'), ['A', 'B'])).toBeNull(); // unknown hero
    expect(findBestHeroPair(undefined, ['A', 'B'])).toBeNull();
  });
});

describe('buildSkillHeroIndex + findBestSkillPair', () => {
  const skillHeroPairStats = {
    'HeroA,Skill1': { wins: 9, losses: 1, wilson: 0.6 },  // 90%
    'HeroA,Skill2': { wins: 5, losses: 5, wilson: 0.3 },  // 50%
    'HeroB,Skill1': { wins: 4, losses: 0, wilson: 0.4 },
  };

  test('groups skills under their hero', () => {
    const index = buildSkillHeroIndex(skillHeroPairStats);
    expect(index.get('HeroA').map((e) => e.skill).sort()).toEqual(['Skill1', 'Skill2']);
    expect(index.get('HeroB').map((e) => e.skill)).toEqual(['Skill1']);
  });

  test('returns skills sorted by win rate, filtered by availability', () => {
    const index = buildSkillHeroIndex(skillHeroPairStats);
    const result = findBestSkillPair(index.get('HeroA'), ['Skill1', 'Skill2']);
    expect(result.map((r) => r.skill)).toEqual(['Skill1', 'Skill2']);
    expect(result[0].winRate).toBeCloseTo(90);
  });

  test('excludes unavailable skills and returns null when none remain', () => {
    const index = buildSkillHeroIndex(skillHeroPairStats);
    expect(findBestSkillPair(index.get('HeroA'), ['SkillX'])).toBeNull();
    expect(findBestSkillPair(undefined, ['Skill1'])).toBeNull();
  });
});
