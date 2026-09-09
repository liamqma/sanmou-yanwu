// @vitest-environment node
import {
  simulateDamageReduction,
  type DamageReductionEffect,
} from '../damageReduction';
import {
  displayedReduction,
  loadBattleReportSamples,
  loadReductionReviews,
  resolveReductionEffects,
} from './battleReportSamples';

const samples = loadBattleReportSamples();
const reviews = loadReductionReviews(samples);

// A little over one 0.01 percentage-point display tick allows for printed
// inputs losing hidden precision as well as the final two-decimal display.
// This checks compatibility, not an assumed rounding/truncation policy;
// exact full-precision arithmetic is asserted separately below.
const DISPLAY_TOLERANCE_PERCENTAGE_POINTS = 0.011;

const expectDisplayedPercent = (
  actualRatio: number,
  displayedPercentagePoints: number
): void => {
  expect(
    Math.abs(actualRatio * 100 - displayedPercentagePoints)
  ).toBeLessThanOrEqual(DISPLAY_TOLERANCE_PERCENTAGE_POINTS);
};

// Every corpus report must be reviewed, even when it cannot support a formula
// comparison. Display expectations are parsed from full checked-in logs.
const battleReportObservations = reviews.flatMap((review) =>
  review.observations.map((observation) => ({
    battleId: review.battleId,
    status: review.status,
    review,
    ...observation,
  }))
);

for (const review of reviews.filter((entry) => entry.status === 'insufficient-evidence')) {
  test.skip(`${review.battleId}: insufficient evidence — ${review.reason}`, () => {});
}

describe('simulateDamageReduction', () => {
  test('returns unchanged damage for an empty reduction slot', () => {
    expect(simulateDamageReduction(1000, [])).toEqual({
      incomingDamage: 1000,
      remainingDamage: 1000,
      damageMultiplier: 1,
      totalReduction: 0,
      steps: [],
    });
  });

  test('retains full precision for a three-component arithmetic example', () => {
    const result = simulateDamageReduction(1000, [
      { id: '箕形阵', rate: 0.06 },
      { id: '兵种加成-盾兵', rate: 0.035 },
      { id: '避其锐气', rate: 0.26 },
    ]);

    expect(result.damageMultiplier).toBeCloseTo(0.671254, 12);
    expect(result.totalReduction).toBeCloseTo(0.328746, 12);
    expect(result.remainingDamage).toBeCloseTo(671.254, 9);
    expect(result.steps.map(({ id, rawRate }) => ({ id, rawRate }))).toEqual([
      { id: '箕形阵', rawRate: 0.06 },
      { id: '兵种加成-盾兵', rawRate: 0.035 },
      { id: '避其锐气', rawRate: 0.26 },
    ]);
    expect(result.steps[0]?.effectiveRate).toBeCloseTo(0.06, 12);
    expect(result.steps[0]?.cumulativeReduction).toBeCloseTo(0.06, 12);
    expect(result.steps[1]?.effectiveRate).toBeCloseTo(0.0329, 12);
    expect(result.steps[1]?.cumulativeReduction).toBeCloseTo(0.0929, 12);
    expect(result.steps[2]?.effectiveRate).toBeCloseTo(0.235846, 12);
    expect(result.steps[2]?.cumulativeReduction).toBeCloseTo(0.328746, 12);
  });

  test.each(battleReportObservations)(
    '$battleId [$status] L$observedLine: $description',
    ({ battleId, review, effects, observedLine }) => {
      const sample = samples.get(battleId)!;
      const display = displayedReduction(sample, observedLine);
      const result = simulateDamageReduction(100, resolveReductionEffects(sample, review, effects));
      const lastStep = result.steps.at(-1);

      expect(display.direction).toBe('降低');
      expect(lastStep).toBeDefined();
      expectDisplayedPercent(
        lastStep?.effectiveRate ?? Number.NaN,
        display.effectivePercentagePoints
      );
      expectDisplayedPercent(
        lastStep?.cumulativeReduction ?? Number.NaN,
        display.totalPercentagePoints
      );
      expectDisplayedPercent(result.totalReduction, display.totalPercentagePoints);
    }
  );

  test('has an order-independent total while preserving application-order trace', () => {
    const first = simulateDamageReduction(1000, [
      { id: '甲', rate: 0.1 },
      { id: '乙', rate: 0.2 },
    ]);
    const reversed = simulateDamageReduction(1000, [
      { id: '乙', rate: 0.2 },
      { id: '甲', rate: 0.1 },
    ]);

    expect(first.totalReduction).toBeCloseTo(reversed.totalReduction, 12);
    expect(first.remainingDamage).toBeCloseTo(reversed.remainingDamage, 12);
    expect(first.steps.map((step) => step.id)).toEqual(['甲', '乙']);
    expect(reversed.steps.map((step) => step.id)).toEqual(['乙', '甲']);
    expect(first.steps[1]?.effectiveRate).not.toBe(
      reversed.steps[0]?.effectiveRate
    );
  });

  test('handles zero incoming damage and a complete reduction component', () => {
    const zeroDamage = simulateDamageReduction(0, [
      { id: '减伤', rate: 0.2 },
    ]);
    const completeReduction = simulateDamageReduction(1000, [
      { id: '完全减伤', rate: 1 },
      { id: '后续效果', rate: 0.5 },
    ]);

    expect(zeroDamage.remainingDamage).toBe(0);
    expect(zeroDamage.totalReduction).toBeCloseTo(0.2, 12);
    expect(completeReduction.remainingDamage).toBe(0);
    expect(completeReduction.totalReduction).toBe(1);
    expect(completeReduction.steps[1]?.effectiveRate).toBe(0);
  });

  test.each([
    [-1, []],
    [Number.NaN, []],
    [Number.POSITIVE_INFINITY, []],
  ])('rejects invalid incoming damage %s', (incomingDamage, effects) => {
    expect(() => simulateDamageReduction(incomingDamage, effects)).toThrow(
      RangeError
    );
  });

  test.each([
    { effects: [{ id: '负减伤', rate: -0.01 }] },
    { effects: [{ id: '超过100%', rate: 1.01 }] },
    { effects: [{ id: '非数字', rate: Number.NaN }] },
    { effects: [{ id: '无穷值', rate: Number.POSITIVE_INFINITY }] },
  ])('rejects an invalid reduction rate', ({ effects }) => {
    expect(() => simulateDamageReduction(1000, effects)).toThrow(RangeError);
  });

  test('rejects missing effects in sparse arrays instead of silently skipping them', () => {
    const effects = new Array<DamageReductionEffect>(2);
    effects[1] = { id: '避其锐气', rate: 0.26 };

    expect(() => simulateDamageReduction(1000, effects)).toThrow(TypeError);
  });

  test('rejects an empty effect id and a non-array runtime input', () => {
    expect(() =>
      simulateDamageReduction(1000, [{ id: '  ', rate: 0.1 }])
    ).toThrow(TypeError);
    expect(() =>
      simulateDamageReduction(
        1000,
        null as unknown as readonly DamageReductionEffect[]
      )
    ).toThrow(TypeError);
  });
});
