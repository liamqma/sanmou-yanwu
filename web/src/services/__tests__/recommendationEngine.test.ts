import { recommendHeroSet } from '../recommendationEngine';
import { battleStats } from '../../data';

describe('recommendHeroSet', () => {
  test('individual conditional hero scores consider peers from the same candidate set', () => {
    const result = recommendHeroSet(
      [
        ['孙权', '陆抗', '陆逊'],
        ['祝融', '孟获', '甘夫人'],
        ['张宁', '左慈', '孙坚'],
      ],
      ['木鹿大王', '诸葛亮2'],
      battleStats,
      []
    );

    const sunQuanSet = result.analysis.find(r => r.heroes.includes('孙权'));
    expect(sunQuanSet).toBeTruthy();

    const sunQuan = sunQuanSet.individual_scores.details.hero_details.find((d: any) => d.hero === '孙权');
    expect(sunQuan).toBeTruthy();
    expect(sunQuan.conditionalAdjusted).toBe(true);
    expect(sunQuan.conditionalReason).toMatch(/^synergy_boost_from_(陆抗|陆逊)$/);
    expect(sunQuan.conditionalWinRate).toBeGreaterThan(sunQuan.adjustedWinRate);
  });
});
