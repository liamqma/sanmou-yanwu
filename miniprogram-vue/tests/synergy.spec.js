const { test, expect } = require('playwright/test');

test.describe('Synergy Partner Detection', () => {

  test('should not report missing partner when partner is in the same candidate set', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.wd-select-picker', { timeout: 10000 });

    const result = await page.evaluate(async () => {
      const battleStats = await fetch('/data/battle_stats.json').then(r => r.json());
      const { getConditionalHeroScore, recommendHeroSet } = await import('/src/services/recommendationEngine.js');

      const heroSynergyStats = battleStats.hero_synergy_stats || {};

      // Find a hero that has a synergy partner
      let testHero = null;
      let testPartner = null;
      for (const [hero, synergy] of Object.entries(heroSynergyStats)) {
        if (synergy.has_significant_synergy && synergy.synergy_partners?.length > 0) {
          testHero = hero;
          testPartner = synergy.synergy_partners[0].partner;
          break;
        }
      }

      if (!testHero || !testPartner) {
        return { skip: true, reason: 'No synergy pairs found in data' };
      }

      // Test 1: Partner NOT on team and NOT in candidate set → should report missing
      const resultWithout = getConditionalHeroScore(
        testHero,
        ['SomeOtherHero1', 'SomeOtherHero2'], // currentTeam without partner
        battleStats.hero_stats || {},
        heroSynergyStats
      );

      // Test 2: Partner IS in currentTeam → should detect synergy boost
      const resultWithPartnerOnTeam = getConditionalHeroScore(
        testHero,
        [testPartner, 'SomeOtherHero2'], // currentTeam with partner
        battleStats.hero_stats || {},
        heroSynergyStats
      );

      // Test 3: Use recommendHeroSet where partner is in the SAME candidate set
      // The hero and its partner are in the same set — should NOT report "missing_key_partners"
      const recommendation = await recommendHeroSet(
        [[testHero, testPartner, 'SomeOtherHero3']], // set contains both hero and partner
        ['SomeOtherHero4', 'SomeOtherHero5', 'SomeOtherHero6'], // currentTeam without partner
        battleStats,
        []
      );

      const analysis = recommendation.analysis[0];
      const heroDetail = analysis.individual_scores?.details?.hero_details?.find(
        d => d.hero === testHero
      );

      return {
        skip: false,
        testHero,
        testPartner,
        withoutPartner: {
          adjusted: resultWithout.adjusted,
          reason: resultWithout.reason,
        },
        withPartnerOnTeam: {
          adjusted: resultWithPartnerOnTeam.adjusted,
          reason: resultWithPartnerOnTeam.reason,
        },
        withPartnerInSameSet: {
          conditionalReason: heroDetail?.conditionalReason || 'not_found',
          conditionalAdjusted: heroDetail?.conditionalAdjusted,
        },
      };
    });

    if (result.skip) {
      test.skip(true, result.reason);
      return;
    }

    // Without partner: should report missing
    expect(result.withoutPartner.reason).toContain('missing_key_partners');

    // With partner on team: should detect synergy boost
    expect(result.withPartnerOnTeam.reason).toContain('synergy_boost_from');

    // With partner in same candidate set: should NOT report missing partners
    // This is the bug — currently it wrongly reports "missing_key_partners" because
    // it only checks currentTeam, not the candidate set
    expect(result.withPartnerInSameSet.conditionalReason).not.toContain('missing_key_partners');
  });
});
