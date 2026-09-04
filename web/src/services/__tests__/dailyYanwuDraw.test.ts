import {
  dailyYanwuFixtureFromSearch,
  drawDailyYanwuHeroes,
} from '../dailyYanwuDraw';

describe('dailyYanwuDraw', () => {
  test('draws three unique heroes and excludes the shared starter', () => {
    const heroes = ['孙坚', '黄盖', '张宝', '李儒', '华佗', '吕布'];
    const values = [0, 0.4, 0.9];
    const result = drawDailyYanwuHeroes({
      heroes,
      excludedHero: '孙坚',
      rng: () => values.shift() ?? 0,
    });

    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
    expect(result).not.toContain('孙坚');
    expect(result.every((hero) => heroes.includes(hero))).toBe(true);
  });

  test('deduplicates the input pool before drawing', () => {
    const result = drawDailyYanwuHeroes({
      heroes: ['孙坚', '黄盖', '黄盖', '张宝', '李儒'],
      excludedHero: '孙坚',
      rng: () => 0,
    });

    expect(result).toEqual(['黄盖', '张宝', '李儒']);
  });

  test('fails clearly for a short pool or invalid injected randomness', () => {
    expect(() =>
      drawDailyYanwuHeroes({
        heroes: ['孙坚', '黄盖', '张宝'],
        excludedHero: '孙坚',
      })
    ).toThrow(/至少需要三名/);
    expect(() =>
      drawDailyYanwuHeroes({
        heroes: ['孙坚', '黄盖', '张宝', '李儒'],
        excludedHero: '孙坚',
        rng: () => 1,
      })
    ).toThrow(/RNG/);
  });

  test('exposes the reference trio only through the explicit URL fixture', () => {
    expect(
      dailyYanwuFixtureFromSearch('?dailyYanwuFixture=reference')
    ).toEqual(['黄盖', '张宝', '李儒']);
    expect(dailyYanwuFixtureFromSearch('')).toBeNull();
    expect(
      dailyYanwuFixtureFromSearch('?dailyYanwuFixture=other')
    ).toBeNull();
  });
});
