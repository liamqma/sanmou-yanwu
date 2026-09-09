import {
  simulateDamageReduction,
  type DamageReductionEffect,
} from '../damageReduction';

const DISPLAY_TOLERANCE_PERCENTAGE_POINTS = 0.011;

const expectDisplayedPercent = (
  actualRatio: number,
  displayedPercentagePoints: number
): void => {
  expect(
    Math.abs(actualRatio * 100 - displayedPercentagePoints)
  ).toBeLessThanOrEqual(DISPLAY_TOLERANCE_PERCENTAGE_POINTS);
};

interface BattleReportObservation {
  battleId: string;
  description: string;
  effects: DamageReductionEffect[];
  observedEffectiveRate: number;
  observedTotalReduction: number;
}

/**
 * Checked-in transcriptions of the four local battle reports. The ignored OCR
 * artifacts cannot be CI inputs, so each case records its battle ID and the
 * smallest independently useful transition. A 0.011 percentage-point display
 * tolerance covers the game's hidden precision before its two-decimal UI.
 *
 * The 1788649256069 raw rate is calibrated from 折冲御侮's simultaneous
 * 糜夫人 target, then used to predict 夏侯渊. The newest report's 7% and 21.2%
 * rates are compatibility witnesses inferred from their named effects; they
 * show that report does not contradict the formula, rather than independently
 * identifying those raw rates.
 */
const battleReportObservations: BattleReportObservation[] = [
  {
    battleId: '1782469166479',
    description: '周泰已有6%时获得同场可见的3.5%兵种减伤',
    effects: [
      { id: '箕形阵', rate: 0.06 },
      { id: '兵种加成-盾兵', rate: 0.035 },
    ],
    observedEffectiveRate: 3.29,
    observedTotalReduction: 9.29,
  },
  {
    battleId: '1782469166479',
    description: '周泰在9.29%基础上获得26%避其锐气',
    effects: [
      { id: '已有减伤', rate: 0.0929 },
      { id: '避其锐气', rate: 0.26 },
    ],
    observedEffectiveRate: 23.58,
    observedTotalReduction: 32.87,
  },
  {
    battleId: '1782469166479',
    description: '陆逊在3.5%基础上获得26%避其锐气',
    effects: [
      { id: '已有减伤', rate: 0.035 },
      { id: '避其锐气', rate: 0.26 },
    ],
    observedEffectiveRate: 25.09,
    observedTotalReduction: 28.59,
  },
  {
    battleId: '1788649256069',
    description: '折冲御侮同次施放对夏侯渊的交叉目标预测',
    effects: [
      { id: '已有减伤', rate: 0.2719 },
      { id: '折冲御侮', rate: 0.2765 / (1 - 0.05) },
    ],
    observedEffectiveRate: 21.19,
    observedTotalReduction: 48.39,
  },
  {
    battleId: '1788672758108',
    description: '皇甫嵩在31.01%基础上获得20%洗筋伐髓',
    effects: [
      { id: '已有减伤', rate: 0.3101 },
      { id: '洗筋伐髓', rate: 0.2 },
    ],
    observedEffectiveRate: 13.79,
    observedTotalReduction: 44.81,
  },
  {
    battleId: '1788761976188',
    description: '皇甫嵩在33.62%基础上获得约7%科技-御盾',
    effects: [
      { id: '已有减伤', rate: 0.3362 },
      { id: '科技-御盾', rate: 0.07 },
    ],
    observedEffectiveRate: 4.64,
    observedTotalReduction: 38.27,
  },
  {
    battleId: '1788761976188',
    description: '皇甫嵩在33.62%基础上获得实战值约21.2%洗筋伐髓',
    effects: [
      { id: '已有减伤', rate: 0.3362 },
      { id: '洗筋伐髓', rate: 0.212 },
    ],
    observedEffectiveRate: 14.07,
    observedTotalReduction: 47.69,
  },
];

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

  test('retains full precision while reproducing the clearest report sequence', () => {
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
    '$battleId: $description',
    ({ effects, observedEffectiveRate, observedTotalReduction }) => {
      const result = simulateDamageReduction(100, effects);
      const lastStep = result.steps.at(-1);

      expect(lastStep).toBeDefined();
      expectDisplayedPercent(
        lastStep?.effectiveRate ?? Number.NaN,
        observedEffectiveRate
      );
      expectDisplayedPercent(result.totalReduction, observedTotalReduction);
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
