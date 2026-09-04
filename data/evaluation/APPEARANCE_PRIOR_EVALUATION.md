# HP/HS appearance-prior decision

## Decision

Production keeps the existing symmetric atomic `H` / `S` selection-count prior
unchanged and adds a positive-only appearance lift to **`HP` and `HS` only**.
`SP`, `THS`, `TSP`, `HT`, `HC`, `B`, `M`, and `TS3` remain outcome-only in this
change.

The reviewed production settings are:

| Parameter | Value |
|---|---:|
| H strength (unchanged) | 0.4 |
| S strength (unchanged) | 0.3 |
| HP strength | 0.1 |
| HS strength | 0.05 |
| smoothing | 20.0 |
| log-ratio clip | 2.0 |

The HP/HS strengths are deliberately conservative and balance the families at
the roster level rather than awarding equal unbounded credit to every edge. A
three-hero team has three HP edges and six assigned HS edges. At the shared clip
of 2, the maximum appearance contribution is therefore `3 * 0.1 * 2 = 0.6` for
HP and `6 * 0.05 * 2 = 0.6` for HS.

These constants are an explicit player-selection domain assumption. The
evaluation harness reports candidates but never rewrites production settings.

## Feature and counting contract

Counts use known-season **concrete teams**, not battles. A relationship that
appears on both teams in a mirror battle contributes two appearances. Unknown-
season battles continue to fit the unchanged paired logistic outcome model but
are excluded from all appearance counts and expectations.

For each season:

- `N` is the number of concrete teams;
- `hA` and `hB` are observed hero team-appearance marginals;
- `sSkill` is the observed assigned-tactic appearance marginal.

Expected counts are:

```text
HP_expected(A, B) = 2 * hA * hB / (3 * N)
HS_expected(H, S) = hHero * sSkill / (3 * N)
```

Expected and observed counts are summed across known seasons. The relationship
adjustment is:

```text
strength * max(0, clip(log((observed + 20) / (expected + 20)), -2, 2))
```

Below-expected co-selection therefore contributes exactly zero, never a
penalty. The final weight is the fitted paired-outcome coefficient plus this
adjustment; it is not clamped, so a negative outcome coefficient may remain
negative.

`model.support` remains literal per-battle evidence and is not reused for this
calculation. Schema v8 adds `model.relationship_components` for emitted HP/HS
weights with `outcome_weight`, `count_adjustment`, `final_weight`,
`appearance_count`, `expected_count`, and `usage_ratio`.
`model.atomic_components` remains the backward-compatible H/S decomposition.
Deterministic strengths, formulas, smoothing, clipping, and the strict family
boundary are recorded in `model.selection_prior` and included in
`model.scoring_version` inputs.

## Evaluation protocol and result

`make evaluate-recommendation` was run after implementation. It used the
existing grouped stable-hash protocol:

- 8,021 battles / 3,263 groups total;
- training: 5,683 battles / 2,598 groups;
- development: 1,165 battles / 649 groups;
- locked test: 1,173 battles / 16 groups;
- 0 unknown-season battles in this corpus.

The HP/HS strength grid held the existing production H/S prior fixed. Candidate
selection used development data only. Lower log loss is the primary selection
metric, followed by Brier score, accuracy, and deterministic simplicity.

| HP | HS | Development accuracy | Log loss | Brier |
|---:|---:|---:|---:|---:|
| 0.00 | 0.00 (atomic-only baseline) | 0.695279 | 0.656980 | 0.214760 |
| 0.10 | 0.00 | 0.696137 | 0.660577 | 0.214644 |
| 0.00 | 0.05 | 0.698712 | 0.661830 | 0.215053 |
| **0.10** | **0.05 (production)** | **0.695279** | **0.666133** | **0.215115** |
| 0.20 | 0.00 | 0.696996 | 0.668386 | 0.215556 |
| 0.20 | 0.15 | 0.696996 | 0.691103 | 0.218173 |
| 0.30 | 0.25 | 0.690129 | 0.726299 | 0.222817 |

Relative to the atomic-only production baseline, the selected conservative
balanced lift changed development accuracy by `0.0000`, log loss by `+0.0092`,
and Brier by `+0.0004`. The grouped 95% intervals were `[-0.0099, 0.0100]` for
accuracy, `[0.0023, 0.0162]` for log loss, and `[-0.0019, 0.0026]` for Brier.
The calibration-first grid therefore preferred zero relationship strength. The
non-zero production choice is not presented as a probability-calibration win;
it implements the approved player-selection assumption with the smallest
jointly tested HP/HS strengths and equal bounded family-level capacity.

The locked test was scored only after configuration work. The current production
configuration reported accuracy `0.7434`, log loss `0.5732`, and Brier `0.1804`.
Those figures did not select HP/HS settings and are exploratory because the
locked population has only 16 leakage groups. The controlled Yanwu comparison
remained `inconclusive_no_improvement_claim`.

The complete ignored report is `results_recommendation_evaluation.json`; rerun
the command to reproduce the candidate table, grouped intervals, diagnostics,
and locked-test report.
