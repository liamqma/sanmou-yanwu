import type { UploadedBattle } from '../../types/battleUpload';
import type { RecommendationData } from '../../types/recommendation';
import {
  assignedTeamForScoring,
  compareBattleStrength,
} from '../battleStrength';

const battle = (winner: '1' | '2' = '1'): UploadedBattle => ({
  '1': [
    { name: '甲', skills: ['甲签', '火攻', '疾行'] },
    { name: '乙', skills: ['乙签', '坚守', '援军'] },
    { name: '丙', skills: ['丙签', '奇谋', '突袭'] },
  ],
  '2': [
    { name: '丁', skills: ['丁签', '水攻', '缓行'] },
    { name: '戊', skills: ['戊签', '固守', '伏兵'] },
    { name: '己', skills: ['己签', '正兵', '防御'] },
  ],
  winner,
});

const data = (
  weights: Record<string, number>,
  support: Record<string, number> = {}
): RecommendationData =>
  ({
    catalog: {
      default_skill: {
        甲: '甲签', 乙: '乙签', 丙: '丙签', 丁: '丁签', 戊: '戊签', 己: '己签',
      },
      mechanics_version: '123456789abc',
      mechanics: { certainty_mode: 'all_reviewed', mechanic_names: {}, skills: {} },
      relationships: { hero_camp: {}, bonds: [] },
    },
    model: {
      weights,
      support,
      intercept: 0,
      l2_C: 1,
      min_support_single: 5,
      min_support_pair: 8,
      min_support_team_context: 12,
      min_support_relationship: 12,
      min_support_high_order: 50,
      min_support_mechanic: 30,
      min_mechanic_pair_diversity: 2,
      team_context_shrinkage: 0.5,
      high_order_shrinkage: 0.35,
      mechanic_shrinkage: 0.25,
      mech_certainty_mode: 'all_reviewed',
      scoring_version: 'fedcbafedcba',
      enabled_families: ['H', 'S', 'HP', 'HS', 'SP'],
      n_features: Object.keys(weights).length,
    },
  }) as unknown as RecommendationData;

describe('battle strength comparison', () => {
  test('removes the trainer signature slot positionally', () => {
    expect(assignedTeamForScoring(battle()['1'])).toEqual([
      { name: '甲', skills: ['火攻', '疾行'] },
      { name: '乙', skills: ['坚守', '援军'] },
      { name: '丙', skills: ['奇谋', '突袭'] },
    ]);
  });

  test('uses sigmoid of the paired raw-score difference and complementary display shares', () => {
    const result = compareBattleStrength(
      battle(),
      data({ 'H|甲': 1 }, { 'H|甲': 20 })
    );

    expect(result.team1.rawScore).toBe(1);
    expect(result.team2.rawScore).toBe(0);
    expect(result.team1.share).toBeCloseTo(1 / (1 + Math.exp(-1)));
    expect(result.team1.displayPercent + result.team2.displayPercent).toBe(100);
    expect(result.team1.displayPercent).toBe(73);
  });

  test('includes canonical-signature MECH in uploaded battle strength', () => {
    const artifact = data(
      { 'M|debuff:huo_gong|benefits_from|enemy': 0.5 },
      { 'M|debuff:huo_gong|benefits_from|enemy': 30 }
    );
    artifact.model.enabled_families = ['M'];
    artifact.catalog.mechanics = {
      certainty_mode: 'all_reviewed',
      mechanic_names: { 'debuff:huo_gong': '火攻' },
      skills: {
        甲签: [
          { relation: 'benefits_from', mechanic: 'debuff:huo_gong', subject: 'enemy' },
        ],
        火攻: [
          { relation: 'provides', mechanic: 'debuff:huo_gong', subject: 'enemy' },
        ],
      },
    };

    const result = compareBattleStrength(battle(), artifact);

    expect(result.team1.rawScore).toBe(0.5);
    expect(result.team2.rawScore).toBe(0);
  });

  test('surfaces a lower-score winner as an upset without rejecting it', () => {
    const result = compareBattleStrength(
      battle('2'),
      data({ 'H|甲': 1 }, { 'H|甲': 20 })
    );

    expect(result.displayedTie).toBe(false);
    expect(result.upset).toBe(true);
  });

  test('does not call a displayed 50–50 tie an upset', () => {
    const result = compareBattleStrength(battle('2'), data({}));

    expect(result.displayedTie).toBe(true);
    expect(result.upset).toBe(false);
    expect(result.team1.lowEvidence).toBe(true);
    expect(result.team2.lowEvidence).toBe(true);
  });
});
