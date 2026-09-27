import {
  getRoundShareGroupTitle,
  getRoundShareImageLayout,
  getRoundShareTeamScoreLines,
  renderRoundShareImage,
} from '../roundShareImage';

describe('getRoundShareImageLayout', () => {
  test('has no leftover rows when everything is allocated', () => {
    const layout = getRoundShareImageLayout({ unallocatedHeroes: [], unallocatedSkills: [] });
    expect(layout.heroRows).toBe(0);
    expect(layout.skillRows).toBe(0);
    expect(layout.height).toBeGreaterThan(1000);
  });

  test('gives unallocated heroes and skills separate rows and de-duplicates them', () => {
    const full = getRoundShareImageLayout({ unallocatedHeroes: [], unallocatedSkills: [] });
    const leftovers = getRoundShareImageLayout({
      unallocatedHeroes: ['武将1', '武将1', '武将2'],
      unallocatedSkills: Array.from({ length: 11 }, (_, index) => `战法${index}`),
    });
    expect(leftovers.heroRows).toBe(1);
    expect(leftovers.skillRows).toBe(2);
    expect(leftovers.height).toBeGreaterThan(full.height);
  });

  test('labels only the recommended candidate group without completion counts', () => {
    expect(getRoundShareGroupTitle(0, 1)).toBe('第 1 组');
    expect(getRoundShareGroupTitle(1, 1)).toBe('第 2 组 · AI 推荐');
    expect(getRoundShareGroupTitle(2, 1)).toBe('第 3 组');
  });

  test('labels each team with its score and win chance', () => {
    const slots = [{ hero: '刘备', skills: [null, null] as [null, null] }];
    expect(getRoundShareTeamScoreLines({ slots, score: 0.456, winChance: 0.62 })).toEqual([
      '评分 4.6',
      '胜率 62%',
    ]);
    expect(getRoundShareTeamScoreLines({ slots: [], score: null, winChance: 0 })).toEqual(['空']);
  });

  test('rejects an export without one valid AI recommendation', async () => {
    await expect(
      renderRoundShareImage({
        roundNumber: 1,
        roundType: 'hero',
        season: 1,
        sets: [['武将1'], ['武将2'], ['武将3']],
        recommendedSetIndex: 3,
        teams: [],
        unallocatedHeroes: [],
        unallocatedSkills: [],
      })
    ).rejects.toThrow('AI 推荐组无效');
  });
});
