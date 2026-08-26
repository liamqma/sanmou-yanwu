import { describe, expect, test } from 'vitest';
import { filterRelationshipRankings } from '../RelationshipRankingPanel';
import type {
  AnalyticsRelationshipFamily,
  AnalyticsRelationshipRanking,
} from '../../../services/recommendationEngine';

const row = (
  family: AnalyticsRelationshipFamily,
  rank: number,
  heroes: string[] = [],
  skills: string[] = []
): AnalyticsRelationshipRanking => ({
  rank,
  featureId: `${family}|${rank}`,
  family,
  label: `${family}-${rank}`,
  weight: 1 / rank,
  support: rank * 10,
  heroes,
  skills,
});

describe('filterRelationshipRankings', () => {
  test('applies only meaningful identity filters across all six modes and preserves true ranks', () => {
    const hp = [row('HP', 3, ['甲', '乙']), row('HP', 9, ['丙', '丁'])];
    const ht = [row('HT', 4, ['甲', '乙', '丙']), row('HT', 11, ['丁', '戊', '己'])];
    const hs = [row('HS', 5, ['甲'], ['火攻']), row('HS', 12, ['乙'], ['治疗'])];
    const ths = [row('THS', 6, ['甲'], ['增益']), row('THS', 14, ['丙'], ['火攻'])];
    const bond = [row('B', 7, ['甲', '乙']), row('B', 16, ['丙', '丁'])];
    const mechanic = [row('M', 2), row('M', 8)];

    expect(filterRelationshipRankings(hp, 'HP', ['丙'], ['火攻']).map(({ rank }) => rank)).toEqual([9]);
    expect(filterRelationshipRankings(ht, 'HT', ['乙'], []).map(({ rank }) => rank)).toEqual([4]);
    expect(filterRelationshipRankings(hs, 'HS', ['乙'], ['火攻']).map(({ rank }) => rank)).toEqual([5, 12]);
    expect(filterRelationshipRankings(ths, 'THS', [], ['火攻']).map(({ rank }) => rank)).toEqual([14]);
    expect(filterRelationshipRankings(bond, 'B', ['丁'], ['治疗']).map(({ rank }) => rank)).toEqual([16]);
    expect(filterRelationshipRankings(mechanic, 'M', ['甲'], ['火攻'])).toEqual(mechanic);
  });

  test('does not treat an inapplicable skill filter as filtering hero or bond rows', () => {
    const hp = [row('HP', 2, ['甲', '乙']), row('HP', 17, ['丙', '丁'])];
    const bond = [row('B', 4, ['甲', '乙']), row('B', 19, ['丙', '丁'])];

    expect(filterRelationshipRankings(hp, 'HP', [], ['火攻'])).toEqual(hp);
    expect(filterRelationshipRankings(bond, 'B', [], ['火攻'])).toEqual(bond);
  });
});
