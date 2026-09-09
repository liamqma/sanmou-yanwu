import {
  simulateDamageReduction,
  type DamageReductionEffect,
} from '../damageReduction';
import {
  battleReportEvidence,
  type OcrBattleReportEvidence,
} from './fixtures/damageReductionOcrEvidence';

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

// Parse the owned OCR-evidence data contract, not implementation source.
// Display expectations are never duplicated as handwritten numeric values.
const displayedReduction = (report: OcrBattleReportEvidence, line: number) => {
  const text = report.excerpts.find((excerpt) => excerpt.line === line)?.text;
  const match = text?.match(
    /^\[[^\]]+\]的【受到伤害】(降低|提升)(\d+\.\d{2})%\(-(\d+\.\d{2})%\)$/u
  );
  if (!match) {
    throw new Error(`${report.battle_id}:${line}: missing generic reduction display`);
  }
  return {
    direction: match[1],
    effectivePercentagePoints: Number(match[2]),
    totalPercentagePoints: Number(match[3]),
  };
};

const reportEffects = (
  report: OcrBattleReportEvidence,
  ids: string[]
): DamageReductionEffect[] => ids.map((id) => {
  const evidence = report.raw_rates[id];
  if (!evidence) throw new Error(`${report.battle_id}: missing raw-rate evidence for ${id}`);

  switch (evidence.status) {
    case 'catalog-described':
    case 'inferred-compatibility-witness':
      return { id, rate: evidence.value };
    case 'observed-total':
      return { id, rate: displayedReduction(report, evidence.line).totalPercentagePoints / 100 };
    case 'observed-unstacked': {
      const display = displayedReduction(report, evidence.line);
      expect(display.direction).toBe('降低');
      expect(display.effectivePercentagePoints).toBe(display.totalPercentagePoints);
      return { id, rate: display.effectivePercentagePoints / 100 };
    }
    case 'cross-target-calibrated': {
      const display = displayedReduction(report, evidence.line);
      expect(display.direction).toBe('降低');
      const prior = (display.totalPercentagePoints - display.effectivePercentagePoints) / 100;
      return { id, rate: display.effectivePercentagePoints / 100 / (1 - prior) };
    }
  }
});

const battleReportObservations = battleReportEvidence.flatMap((report) =>
  report.observations.map((observation) => ({
    battleId: report.battle_id,
    report,
    ...observation,
  }))
);

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
    const result = simulateDamageReduction(1000, reportEffects(
      battleReportEvidence[0],
      ['箕形阵', '兵种加成-盾兵', '避其锐气']
    ));

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
    ({ report, effects, observed_line }) => {
      const display = displayedReduction(report, observed_line);
      const result = simulateDamageReduction(100, reportEffects(report, effects));
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
