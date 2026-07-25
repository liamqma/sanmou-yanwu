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
    model: {
      weights,
      support,
      intercept: 0,
      l2_C: 1,
      min_support_single: 5,
      min_support_pair: 8,
      n_features: Object.keys(weights).length,
    },
  }) as RecommendationData;

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
