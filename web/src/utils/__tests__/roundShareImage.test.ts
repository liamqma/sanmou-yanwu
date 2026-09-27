import {
  getRoundShareGroupTitle,
  getRoundShareImageLayout,
  getRoundShareTeamTitle,
  renderRoundShareImage,
} from '../roundShareImage';

describe('getRoundShareImageLayout', () => {
  test('has no leftover row when everything is allocated', () => {
    const layout = getRoundShareImageLayout({ unallocatedHeroes: [], unallocatedSkills: [] });
    expect(layout.leftoverRows).toBe(0);
    expect(layout.height).toBeGreaterThan(1000);
  });

  test('grows with the unallocated items and de-duplicates them', () => {
    const full = getRoundShareImageLayout({ unallocatedHeroes: [], unallocatedSkills: [] });
    const leftovers = getRoundShareImageLayout({
      unallocatedHeroes: ['武将1', '武将1', '武将2'],
      unallocatedSkills: Array.from({ length: 9 }, (_, index) => `战法${index}`),
    });
    expect(leftovers.leftoverRows).toBe(2);
    expect(leftovers.height).toBeGreaterThan(full.height);
  });

  test('labels only the recommended candidate group without completion counts', () => {
    expect(getRoundShareGroupTitle(0, 1)).toBe('第 1 组');
    expect(getRoundShareGroupTitle(1, 1)).toBe('第 2 组 · AI 推荐');
    expect(getRoundShareGroupTitle(2, 1)).toBe('第 3 组');
  });

  test('titles each team with its score and win chance', () => {
    const slots = [{ hero: '刘备', skills: [null, null] as [null, null] }];
    expect(getRoundShareTeamTitle(0, { slots, score: 0.456, winChance: 0.62 })).toBe(
      '队伍一 · 评分 4.6 · 胜率 62%'
    );
    expect(getRoundShareTeamTitle(2, { slots: [], score: null, winChance: 0 })).toBe('队伍三');
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
        twoOfThree: 0,
        unallocatedHeroes: [],
        unallocatedSkills: [],
      })
    ).rejects.toThrow('AI 推荐组无效');
  });
});
