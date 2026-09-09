/**
 * One active, same-direction `受到伤害降低` effect.
 *
 * Rates are ratios in the inclusive range [0, 1], so 6% is represented as
 * `0.06`. IDs must be non-blank strings; uniqueness is not enforced. Callers
 * should give stacked instances distinct IDs when they need to remove or
 * explain one instance later.
 */
export interface DamageReductionEffect {
  id: string;
  rate: number;
}

/**
 * One application step in caller-supplied order. `rawRate` is the input ratio;
 * `effectiveRate` and `cumulativeReduction` are ratios of the original incoming
 * damage, not percentage points.
 */
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
 * Apply the single-slot rule and verification boundaries documented in
 * [the formula reference](../../../public/game-data/formula.md).
 *
 * Keep full JavaScript floating-point precision: neither intermediate values
 * nor returned damage are rounded to the game's display precision or integers.
 * This evaluates active effects only; it does not manage duration or removal.
 *
 * @param incomingDamage Finite, non-negative damage before this slot.
 * @param effects Active effects in application order; an empty list is valid.
 * @throws {RangeError} If incoming damage or a rate is outside its numeric domain.
 * @throws {TypeError} If effects is not an array or an entry lacks a valid ID.
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
