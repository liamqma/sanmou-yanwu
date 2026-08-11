import {
  formatHeroRanking,
  formatHeroSearchText,
  formatSkillRanking,
  formatSkillSearchText,
} from '../itemMetadata';

describe('item metadata', () => {
  test('formats and searches the compact hero guide ranking', () => {
    expect(formatHeroRanking({ ranking: 'S' })).toBe('S档');
    expect(formatHeroSearchText('吕布', { 吕布: { ranking: 'S' } }))
      .toBe('吕布 S S档');
  });

  test('formats and searches skill guide ranking and category metadata', () => {
    const metadata = { 辕门射戟: { ranking: 'D' as const, category: '兵刃' as const } };
    expect(formatSkillRanking(metadata.辕门射戟)).toBe('D档');
    expect(formatSkillSearchText('辕门射戟', metadata))
      .toBe('辕门射戟 兵刃 D D档');
    expect(formatSkillSearchText('未排名战法', { 未排名战法: { season: 1 } }))
      .toBe('未排名战法');
  });
});
