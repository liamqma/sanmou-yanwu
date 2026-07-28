import {
  formatHeroRanking,
  formatHeroSearchText,
  formatSkillSearchText,
} from '../itemMetadata';

describe('item metadata', () => {
  test('formats and searches the compact hero guide ranking', () => {
    expect(formatHeroRanking({ ranking: 'S' })).toBe('S档');
    expect(formatHeroSearchText('吕布', { 吕布: { ranking: 'S' } }))
      .toBe('吕布 S S档');
  });

  test('keeps skill search text free of removed tier and note metadata', () => {
    expect(formatSkillSearchText('辕门射戟', { 辕门射戟: { season: 1 } }))
      .toBe('辕门射戟');
  });
});
