import {
  getRoundShareGroupTitle,
  getRoundShareImageLayout,
  renderRoundShareImage,
} from '../roundShareImage';

describe('getRoundShareImageLayout', () => {
  test('keeps an early-round pool to one row per item type', () => {
    const layout = getRoundShareImageLayout({
      heroes: ['刘备', '关羽', '张飞', '赵云'],
      skills: Array.from({ length: 8 }, (_, index) => `战法${index}`),
      supportHero: null,
      supportSkills: [],
    });

    expect(layout.heroRows).toBe(1);
    expect(layout.skillRows).toBe(1);
    expect(layout.height).toBeGreaterThan(800);
    expect(layout.height).toBeLessThan(900);
  });

  test('labels only the recommended candidate group without completion counts', () => {
    expect(getRoundShareGroupTitle(0, 1)).toBe('第 1 组');
    expect(getRoundShareGroupTitle(1, 1)).toBe('第 2 组 · AI 推荐');
    expect(getRoundShareGroupTitle(2, 1)).toBe('第 3 组');
  });

  test('rejects an export without one valid AI recommendation', async () => {
    await expect(
      renderRoundShareImage({
        roundNumber: 1,
        roundType: 'hero',
        season: 1,
        sets: [['武将1'], ['武将2'], ['武将3']],
        recommendedSetIndex: 3,
        heroes: [],
        skills: [],
        rosterScore: 0,
      })
    ).rejects.toThrow('AI 推荐组无效');
  });

  test('grows for a complete late-round pool and de-duplicates support entries', () => {
    const early = getRoundShareImageLayout({
      heroes: Array.from({ length: 4 }, (_, index) => `武将${index}`),
      skills: Array.from({ length: 8 }, (_, index) => `战法${index}`),
    });
    const late = getRoundShareImageLayout({
      heroes: Array.from({ length: 15 }, (_, index) => `武将${index}`),
      skills: Array.from({ length: 28 }, (_, index) => `战法${index}`),
      supportHero: '武将0',
      supportSkills: ['战法0', '战法1'],
    });

    expect(late.heroRows).toBe(2);
    expect(late.skillRows).toBe(3);
    expect(late.height).toBeGreaterThan(early.height);
  });
});
