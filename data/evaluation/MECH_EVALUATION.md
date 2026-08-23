# Evaluation-only MECH feature decision (PR A)

This note records the evaluation decision for reviewed mechanic relationships.
The model remains the paired logistic / Bradley–Terry model. MECH is **not**
enabled in production by this change: no browser scoring, runtime schema,
telemetry label, production support floor, or production weight changed.

A positive MECH coefficient is an average residual association after the
existing identity features. It is observational, not causal proof and not a
hard recommendation rule.

## Feature contract

The evaluation-only family is `M`, with binary feature IDs:

```text
M|<exact-mechanic-id>|<consumer-relation>|<target-side>
```

PR A applies the following contract:

- The source relationship must be `provides`; consumer relationships are only
  `benefits_from`, `requires`, and `consumes`. `removes` and `prevents` are
  excluded.
- Mechanic IDs must be exactly equal. No registry-category ancestry is inferred.
- Active instances are each hero's canonical signature from `default_skill`
  plus every valid equipped tactic returned by the existing
  `_non_default_skills` logic. OCR slot zero is not semantic input.
- Signature tactics participate only in M. They remain excluded from `S`, `HS`,
  `SP`, `THS`, `TSP`, selection counts, and all other ordinary tactic families.
- Provider and consumer must be distinct skill instances. Distinct instances
  with the same skill name may interact, while diversity remains the ordered
  `(provider skill name, consumer skill name)` pair.
- Subjects are resolved relative to each carrier: `self` is the carrier,
  `ally` is the other two heroes, `team` is all three heroes, `enemy` is one
  abstract `ENEMY_TEAM`, `any` is all friendly heroes plus `ENEMY_TEAM`, and
  `unknown` has no targets. A pair matches only when its target sets intersect.
  An enemy intersection emits `enemy`, a friendly-hero intersection emits
  `friendly`, and both are emitted when both genuinely intersect.
- Features are presence encoded, so multiple witnesses do not increase feature
  magnitude.
- M is available only for one concrete team with exactly three distinct heroes.
  Partial teams, offered/support pools, flattened collections, and cross-team
  relationships cannot emit M.
- `explicit_only` requires both relationships to be explicit.
  `all_reviewed` admits explicit and inferred reviewed relationships.
- Support is the number of original training battles where a feature appears on
  either side, at most once per battle. Selection also requires at least two
  distinct ordered skill-name witness pairs. Development and locked-test rows
  are excluded from M support, pair diversity, feature selection, and witness
  ranking, including when final coefficients are refit on training plus
  development.

Evaluation loads `mech.json` through the canonical validator in
`manage_mech_catalog.py`, then applies a stricter zero-unresolved rule. Duplicate
JSON keys, unsupported schema, stale registry/source hashes, incomplete or
mismatched skill coverage, pending entries, unknown mechanics, invalid enums,
and any unresolved entry fail closed before fitting.

## Dataset and split protocol

The run used the existing season-independent grouped stable-hash protocol and
catalog/corpus state at this commit:

- Corpus: **7,836 battles**, **3,246 leakage groups**
- Training: **5,511 battles**, **2,584 groups**
- Development: **1,152 battles**, **646 groups**
- Locked pre-Yanwu test: **1,173 battles**, **16 persisted groups**
- Corpus version: `36563473f49bd020`
- Evaluation version: `c5560936635944bb`
- Catalog version: `ed3db0590240`
- MECH catalog SHA-256:
  `961dadb2ca09bd84b3f3c88fcbb0114c92e22a5804421ecb51672859ca1716de`

Capture/upload sessions and stable external report identities were merged
through exact/near-duplicate matchup clusters. Season, winner, and outcome did
not determine split membership. Configuration selection used development rows;
M support and diversity used only original training rows. The locked test was
scored only after all staged choices were complete.

## Candidate grid and development results

The M stage followed `THS`/`TSP` and `HC`/`B`, and preceded `HT` and `TS3`.
All candidates fixed minimum pair diversity at 2. The preceding `HC`/`B`
baseline had 8,078 features, accuracy **0.696181**, log loss **0.653495**, and
Brier **0.213965**.

| Certainty | Support | Shrink | Features | Accuracy | Log loss | Brier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `all_reviewed` | 12 | 0.25 | 8,097 | 0.696181 | 0.651304 | 0.213343 |
| `all_reviewed` | 12 | 0.50 | 8,097 | 0.694444 | 0.651911 | 0.213483 |
| `all_reviewed` | 12 | 0.75 | 8,097 | 0.696181 | 0.652624 | 0.213652 |
| `all_reviewed` | 20 | 0.25 | 8,095 | 0.696181 | 0.651296 | 0.213335 |
| `all_reviewed` | 20 | 0.50 | 8,095 | 0.694444 | 0.651910 | 0.213474 |
| `all_reviewed` | 20 | 0.75 | 8,095 | 0.696181 | 0.652628 | 0.213642 |
| `all_reviewed` | 30 | 0.25 | 8,094 | 0.696181 | 0.651289 | 0.213346 |
| `all_reviewed` | 30 | 0.50 | 8,094 | 0.694444 | 0.651861 | 0.213490 |
| `all_reviewed` | 30 | 0.75 | 8,094 | 0.696181 | 0.652537 | 0.213662 |
| `explicit_only` | 12 | 0.25 | 8,096 | 0.696181 | 0.652832 | 0.213573 |
| `explicit_only` | 12 | 0.50 | 8,096 | 0.696181 | 0.653026 | 0.213708 |
| `explicit_only` | 12 | 0.75 | 8,096 | 0.697917 | 0.653263 | 0.213854 |
| `explicit_only` | 20 | 0.25 | 8,094 | 0.696181 | 0.652824 | 0.213566 |
| `explicit_only` | 20 | 0.50 | 8,094 | 0.696181 | 0.653025 | 0.213699 |
| `explicit_only` | 20 | 0.75 | 8,094 | 0.697917 | 0.653268 | 0.213844 |
| `explicit_only` | 30 | 0.25 | 8,093 | 0.697917 | 0.652816 | 0.213577 |
| `explicit_only` | 30 | 0.50 | 8,093 | 0.696181 | 0.652976 | 0.213715 |
| `explicit_only` | 30 | 0.75 | 8,093 | 0.697917 | 0.653177 | 0.213864 |

The deterministic ordering selected **`all_reviewed`, support 30, shrinkage
0.25, pair diversity 2**. Relative to the disabled M baseline, development
accuracy was unchanged, log loss improved by approximately **-0.0022**, and
Brier improved by approximately **-0.0006**. It therefore cleared the
conservative requirement that both calibration metrics improve.

After M selection, support-50 `HT` also cleared its existing gate. `TS3`
remained disabled. The final development configuration had 8,111 features,
accuracy **0.693576**, log loss **0.650631**, and Brier **0.213092**.

## Coverage, support, and witness diversity

On original training rows, both certainty modes emitted 25 feature IDs.
`explicit_only` activated 3,399 battles / 4,270 teams; `all_reviewed` activated
4,285 battles / 5,979 teams. Under the selected support-30/diversity-2 policy:

- emitted M features: **25**
- support-qualified M features: **16**
- diversity-qualified M features: **20**
- selected M features: **16**
- selected-feature support range: **40–1,556** training battles
- selected-feature pair-diversity range: **4–41** ordered skill-name pairs

Final-refit coefficients below include the selected 0.25 M shrinkage. Support
and pair diversity remain frozen to original training rows.

| Feature | Train support | Ordered pairs | Weight |
| --- | ---: | ---: | ---: |
| `M|buff:di_yu|benefits_from|friendly` | 340 | 9 | -0.003248936 |
| `M|buff:di_yu|requires|friendly` | 292 | 10 | +0.007664798 |
| `M|buff:gong_neng_xing_zeng_yi_zhuang_tai|benefits_from|friendly` | 427 | 16 | +0.011844788 |
| `M|buff:gui_bi|benefits_from|friendly` | 140 | 4 | +0.032656845 |
| `M|buff:gui_bi|requires|friendly` | 211 | 4 | +0.021339818 |
| `M|buff:hui_xin|requires|friendly` | 344 | 6 | -0.001077420 |
| `M|buff:qi_mou|benefits_from|friendly` | 59 | 6 | +0.028877811 |
| `M|debuff:duan_liang|benefits_from|enemy` | 162 | 13 | +0.013622592 |
| `M|debuff:duan_liang|requires|enemy` | 84 | 5 | -0.003765911 |
| `M|debuff:feng_bao|benefits_from|enemy` | 420 | 9 | -0.042910738 |
| `M|debuff:hong_shui|benefits_from|enemy` | 100 | 10 | +0.009486343 |
| `M|debuff:hun_luan|benefits_from|enemy` | 40 | 6 | -0.021573505 |
| `M|debuff:huo_gong|benefits_from|enemy` | 903 | 18 | +0.020666341 |
| `M|debuff:shu_xing_jiang_di_zhuang_tai|benefits_from|enemy` | 1,556 | 41 | +0.067865599 |
| `M|debuff:wei_ju|benefits_from|enemy` | 967 | 32 | -0.020040603 |
| `M|debuff:yao_shu|benefits_from|enemy` | 756 | 8 | +0.016144639 |

The ignored JSON report retains deterministic per-feature support, pair counts,
post-shrink weights, and up to five top ordered witness pairs for review.

## 火攻 audit

The contract and observed teams demonstrate the intended indirect relationship:

1. `default_skill[陆逊]` is the signature **火烧连营**.
2. **烈火张天** explicitly `provides debuff:huo_gong` to `enemy`.
3. **火烧连营** explicitly `benefits_from debuff:huo_gong` on `enemy`.
4. Distinct instances therefore activate
   `M|debuff:huo_gong|benefits_from|enemy`.

The first deterministic observed witness in the report is battle
`2025-09-06-055203.json`, team 1: 小乔 carries equipped 烈火张天 and 陆逊
contributes signature 火烧连营.

Across the complete observational corpus:

- **333 / 333** teams containing 陆逊 plus an equipped 烈火张天 activated the
  feature. 烈火张天 appeared on 35 different carriers; every carrier's observed
  teams activated it. This included 张昭 (64/64), 孙权 (43/43), 步练师
  (42/42), 陆逊 himself (5/5), and many lower-count carriers.
- **0 / 4** teams containing 张昭 plus 烈火张天 but neither 陆逊 nor another
  火攻 consumer activated it.
- **0 / 52** teams containing 陆逊 without a distinct 火攻 provider activated
  it, confirming that 火烧连营 does not satisfy its own provider/consumer loop.
- The selected 火攻 feature had training support **903**, **18** distinct
  ordered witness pairs, and final-refit weight **+0.020666341**. The specific
  `(烈火张天, 火烧连营)` witness occurred in **214** training battles.

MECH explains why a team containing 张昭, 陆逊, and 烈火张天 can have an
indirect tactic relationship through 陆逊's signature. It does **not** claim
that 张昭 personally requires 烈火张天.

## Locked-test reporting

After all stages were selected, the final candidate and current production
configuration were refit and scored on the same locked population. The locked
population has only 16 leakage groups, so this comparison is exploratory.

| Configuration | Features | Accuracy | Log loss | Brier |
| --- | ---: | ---: | ---: | ---: |
| Current production (M disabled) | 9,412 | 0.7400 | 0.5743 | 0.1833 |
| Final selected evaluation candidate | 9,428 | 0.7417 | 0.5694 | 0.1820 |
| Candidate minus current | +16 | +0.0017 | -0.0049 | -0.0013 |

Locked results were not used for configuration, support, diversity, feature, or
witness selection.

## Decision

**MECH passed the development calibration gate** at `all_reviewed`, support 30,
post-fit shrinkage 0.25, and minimum ordered-pair diversity 2. It is a candidate
for a separate, explicitly reviewed production PR B.

This PR remains evaluation-only even though the gate passed. A production PR
would separately need runtime TypeScript extraction/scoring, artifact/schema
review, browser cost and size analysis, model-version/cache implications, and
product review. Nothing here automatically modifies production settings.

## Limitations

- Coefficients are observational residual associations and overlap in
  attribution with `TSP`, `THS`, and `HT`; they are not causal effects.
- PR A matches exact mechanic IDs only. It does not infer hierarchy such as
  火攻 → 异常状态 → 负面状态 or 抵御 → 功能性增益状态.
- `removes` and `prevents` are excluded because defensive counters and
  self-inflicted statuses need a more careful model.
- Certainty is a bounded evaluation configuration, not part of feature IDs.
- Reviewed semantics remain dependent on catalog quality even though freshness,
  completeness, and resolution fail closed.
- No TypeScript/runtime support exists. The browser does not load `mech.json`,
  and production model weights and behavior remain unchanged.
