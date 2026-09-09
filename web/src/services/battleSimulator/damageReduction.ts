/**
 * One active, same-direction `受到伤害降低` effect.
 *
 * Rates are ratios in the inclusive range [0, 1], so 6% is represented as
 * `0.06`. Callers should give stacked instances distinct IDs when they need to
 * remove or explain one instance later.
 */
export interface DamageReductionEffect {
  id: string;
  rate: number;
}

/** One application step, expressed relative to the original incoming damage. */
export interface DamageReductionStep {
  id: string;
  rawRate: number;
  effectiveRate: number;
  cumulativeReduction: number;
}

export interface DamageReductionResult {
  incomingDamage: number;
  remainingDamage: number;
  damageMultiplier: number;
  totalReduction: number;
  steps: DamageReductionStep[];
}

const assertFiniteNonNegative = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number`);
  }
};

const assertReductionEffect = (
  effect: DamageReductionEffect,
  index: number
): void => {
  if (typeof effect.id !== 'string' || effect.id.trim().length === 0) {
    throw new TypeError(`effects[${index}].id must be a non-empty string`);
  }
  if (!Number.isFinite(effect.rate) || effect.rate < 0 || effect.rate > 1) {
    throw new RangeError(`effects[${index}].rate must be between 0 and 1`);
  }
};

/**
 * Apply one reduction slot to incoming damage using the observed game rule:
 *
 *   total reduction = 1 - product(1 - effect rate)
 *
 * Equivalently, a new raw rate `r` contributes `(1 - currentReduction) * r`
 * percentage points relative to the original incoming damage. The function
 * deliberately keeps full floating-point precision; damage integer rounding
 * and any additional near-cap rule have not yet been identified.
 *
 * This primitive covers only same-direction effects in one reduction slot. It
 * does not combine 易伤, 抵御, 规避, or generic and damage-type-specific slots.
 */
export const simulateDamageReduction = (
  incomingDamage: number,
  effects: readonly DamageReductionEffect[]
): DamageReductionResult => {
  assertFiniteNonNegative(incomingDamage, 'incomingDamage');
  if (!Array.isArray(effects)) {
    throw new TypeError('effects must be an array');
  }

  let damageMultiplier = 1;
  const steps: DamageReductionStep[] = [];

  for (const [index, effect] of effects.entries()) {
    assertReductionEffect(effect, index);

    const effectiveRate = damageMultiplier * effect.rate;
    damageMultiplier *= 1 - effect.rate;
    steps.push({
      id: effect.id,
      rawRate: effect.rate,
      effectiveRate,
      cumulativeReduction: 1 - damageMultiplier,
    });
  }

  return {
    incomingDamage,
    remainingDamage: incomingDamage * damageMultiplier,
    damageMultiplier,
    totalReduction: 1 - damageMultiplier,
    steps,
  };
};
