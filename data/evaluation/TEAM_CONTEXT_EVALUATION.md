# Identity-only team-context evaluation (PR 1)

This note records the reviewed production decision for the recommendation-model
context expansion. The model remains the existing paired logistic /
Bradley–Terry model. All relationships are identity/catalog based; the results
are observational associations, not causal estimates.

## Policy evaluated

The grouped protocol selected features and settings from training/development
rows only. The locked pre-Yanwu test was scored after the final candidate had
been selected. Support retains its literal meaning: battles in which a feature
appears on either side, with a mirror occurrence counted once.

| Family class | Production floor | Treatment |
| --- | ---: | --- |
| `H`, `S` | 5 | existing L2 plus existing atomic selection prior |
| `HP`, `HS`, `SP` | 8 | existing L2 |
| `THS`, `TSP` | 20 | L2, then `0.5` coefficient multiplier |
| `HC`, `B` | 12 | L2 |
| `HT` | 50 | L2, then conservative `0.35` multiplier |
| `TS3` | 50 | implemented evaluation path, `0.35` multiplier, and every constituent `TSP` must clear 20; disabled in production |

The staged search was bounded: `THS`/`TSP` floors 8/12/20 and shrinkage
0.25/0.5/0.75/1.0 were compared first; `HC`/`B` floors 8/12/20 came next;
`HT` used disabled/20/50; `TS3` used disabled/50. The global logistic
regularization remained `C = 0.05`. The evaluator never writes these settings
back to production.

## Development ablation

All rows below use the same 1,152 development battles (646 leakage groups) and
99.91% feature coverage.

| Stage | Features | Accuracy | Log loss | Brier |
| --- | ---: | ---: | ---: | ---: |
| Pre-PR production baseline | 3,464 | 0.702257 | 0.666122 | 0.216125 |
| + `THS` / `TSP` (floor 20, shrink 0.5) | 8,044 | 0.692708 | 0.658752 | 0.215680 |
| + `HC` / `B` (floor 12) | 8,078 | 0.696181 | 0.653495 | 0.213965 |
| + `HT` (floor 50, shrink 0.35) | 8,095 | 0.696181 | 0.652592 | 0.213649 |
| + `TS3` candidate | 8,262 | 0.691840 | 0.652477 | 0.213755 |

The selected `THS`/`TSP` setting improved both development calibration metrics.
`HC`/`B` then improved log loss and Brier again. `HT` showed a small residual
calibration improvement beyond the lower-order features, so support-50 `HT` is
enabled. `TS3` slightly improved log loss but worsened Brier and did not improve
accuracy; the conservative high-order gate therefore kept it disabled.

Relative to the pre-PR baseline, the selected development candidate changed
accuracy by **-0.006076**, log loss by **-0.013530**, and Brier by
**-0.002476**. The production decision prioritizes the supported calibration
improvement and better attribution, while recording the development accuracy
trade-off rather than claiming a universal improvement.

## Locked-test comparison

The selected candidate and pre-PR configuration were refit on training plus
development and compared on the same 1,173 locked battles. The locked population
has only 16 leakage groups, so its intervals and deltas are exploratory.

| Configuration | Features | Accuracy | Log loss | Brier |
| --- | ---: | ---: | ---: | ---: |
| Pre-PR production | 4,064 | 0.7383 | 0.5912 | 0.1876 |
| Selected identity context | 9,412 | 0.7400 | 0.5743 | 0.1833 |
| Candidate minus baseline | +5,348 | +0.0017 | -0.0169 | -0.0043 |

The locked result was not used to choose families, floors, or shrinkage.

## 张昭 / 陆逊 / 烈火张天 diagnostic

Across the complete corpus:

- 张昭 carried 烈火张天 in **64** observed teams.
- All **64** teams also contained 陆逊.
- Another **19** 张昭+陆逊 teams carried 烈火张天 on a different hero.

Final training support (training plus development, excluding locked test) was:

- `HP|张昭|陆逊`: **202**
- `HS|张昭|烈火张天`: **54**
- `THS|张昭|烈火张天`: **73**
- `THS|陆逊|烈火张天`: **269**

The highest-support final-training `TSP` rows involving 烈火张天 included
`TSP|明其虚实|烈火张天` (149), `TSP|烈火张天|韬光养晦` (138),
`TSP|料事如神|烈火张天` (119), `TSP|折冲御侮|烈火张天` (113), and
`TSP|清风驱疾|烈火张天` (102).

Relevant `HT` rows included `HT|张昭|步练师|陆逊` (37),
`HT|左慈|张昭|陆逊` (32), `HT|孙权|张昭|陆逊` (25),
`HT|张昭|陆抗|陆逊` (24), and `HT|张昭|陆逊|黄盖` (21).

These co-occurrences support team-context modeling. They do **not** establish
that 张昭, 陆逊, a particular carrier, or the tactic causes the observed result.

## Artifact and runtime impact

The all-corpus production artifact grew from 4,469 to 10,454 emitted features.
Its formatted JSON grew from 492,229 to 1,024,145 bytes; gzip-9 size grew from
82,308 to 157,732 bytes. Most growth is the support-gated `THS`/`TSP` identity
maps. Disabled `TS3` emits no production weight. The bounded
15-hero/28-tactic formation benchmark remains covered by its 5-second regression
gate, and worker/fallback parity continues to use the same pure scorer.

## Catalog relationship contract

The generated schema-v6 artifact contains hero→camp and 57 identity-only bond
contracts (name, required count, sorted members) plus a 12-character
`relationship_version` hash over exactly those scoring inputs. Bond content and
Chinese conditions are not serialized. Content receives only NFKC/whitespace
normalization for offline duplicate detection—no tokenization, semantic
interpretation, or MECH extraction. Offline loading requires non-empty name
and content, an exact reviewed 2/3-member condition, enough unique known
members, and no duplicate normalized `(content, required count, member set)`
contract. The explicit list of known but currently unavailable bond members is
kept separate from selectable heroes so typos still fail closed.

The catalog fix from PR #96 was limited to bond data: the duplicate typo
`魏阙疑妆` was removed in favor of `魏阙凝妆`; six missing three-member
conditions and eighteen missing two-member conditions were added. No mechanics
implementation from that PR was ported.

## Runtime scope and exclusions

- Offered-set ranking and support picks retain the existing bounded `HS`/`SP`
  routing. Exact-team context is deferred because those pools are not yet a
  feasible partition.
- Concrete team scoring activates all enabled context families. Guide matching
  first maximizes global cardinality and substantive slot priority/provenance;
  stable IDs are considered only after canonical per-team score and support.
  Joint variants are expanded one team at a time, retaining at most 512 states
  per depth. A bounded coordinate pass first improves one complete,
  conflict-aware fallback and reserves its prefix inside the same cap, so beam
  pruning cannot reduce that known attainable global cardinality. For team
  depth `d`, work is at most `512 × variants(d)` state extensions (the first
  depth starts from one),
  rather than the full Cartesian product. Retained memory is `O(512)`, and the
  final depth evaluates at most `512 × variants(last)` extensions. A separate
  claim/assignment beam examines at most
  `512 × (alternatives + skip)` extensions per slot while retaining only 512.
  Debug output records the theoretical population, examined/retained/pruned
  states, and unknown beam-pruned alternatives without fabricating scores.
- Final formation search scores each of the three teams independently. Bonds,
  tactic pairs/triples, and hero trios never cross team boundaries, and a tactic
  is never credited to multiple hypothetical teams.
- `TS3` remains implemented only for evaluation. `TS4`, `TS5`, and `TS6` do not
  exist.
- HPS/carrier-skill-teammate triples are excluded.
- MECH is deferred to PR 2. That PR will use an LLM-powered periodic
  catalog-maintenance skill to infer reviewed status relationships. This PR has
  no semantic description parsing, description tokenization, Chinese NLP,
  mechanics registry, `provides`/`benefitsFrom` relationships,
  status/damage/healing extraction,
  embeddings, or neural model.
