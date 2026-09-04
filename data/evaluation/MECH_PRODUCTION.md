# Production MECH promotion (PR B)

This record promotes the reviewed `M` feature family after the historical PR-A
evaluation in [MECH_EVALUATION.md](MECH_EVALUATION.md). The PR-A development
and locked-test numbers remain historical evidence; they are not rewritten as
though M was already production at that time.

## Reviewed production configuration

Production now fits M jointly with every other enabled paired-logistic /
Bradley–Terry feature family using the configuration that passed PR A:

- certainty: `all_reviewed`
- literal training-battle support floor: 30
- minimum ordered `(provider skill, consumer skill)` diversity: 2
- post-fit M multiplier: 0.25
- exact feature IDs: `M|<mechanic>|<consumer relation>|<friendly|enemy>`
- provider relation: `provides`
- consumer relations: `benefits_from`, `requires`, or `consumes`
- `removes`, `prevents`, hierarchy inference, descriptions, and NLP are excluded
- `TS3` remains disabled

Production coefficients are a joint refit. No PR-A coefficient was copied or
appended to the model.

## Runtime contract

The production builder strictly validates the reviewed raw `mech.json` through
`manage_mech_catalog.py` and additionally requires zero unresolved entries. A
stale, pending, partial, duplicate, or otherwise invalid mechanics catalog
aborts before replacing the recommendation artifact or publishing an imported
web-battle batch.

The browser does **not** fetch raw `mech.json`. Schema-v7
`recommendation_data.json` embeds only:

- the selected certainty mode
- referenced mechanic ID → Chinese display name
- scoring relationships, after certainty/relation filtering, sorted by relation
  (`provides`, `benefits_from`, `requires`, `consumes`), lexical mechanic ID,
  then subject (`self`, `ally`, `enemy`, `any`, `team`, `unknown`)
- deterministic `mechanics_version` and overall `model.scoring_version`

Evidence excerpts, reasons, descriptions, source hashes, unresolved entries,
and excluded `removes`/`prevents` relationships are absent. Canonicalization
precedes browser serialization and version hashing, so source-array reordering
does not change the emitted contract, `mechanics_version`, or `scoring_version`.

M runs only for one exact concrete three-hero team. It participates in the
dormant formation services (formerly exposed by Team Builder), including guide
alternatives, model fallback, bounded assignment, manual team-score, evidence,
and debug scoring, as well as uploaded battle-strength scoring. Hero offer
rounds and optional support picks remain unpartitioned pools and therefore
do not activate M. Every concrete team is scored separately; teams are never
flattened.

## Versioning and compatibility

- Recommendation artifact schema: 7
- Telemetry label: `<schema>:<16-hex corpus>:<12-hex scoring_version>`
- Historical two-part and three-part telemetry labels remain accepted; no fourth
  segment was introduced.
- `relationship_version` remains available for HC/B diagnostics.
- `mechanics_version` identifies distilled M semantics.
- `scoring_version` identifies all browser-visible scoring inputs and is part of
  the dormant formation service's cache identity.

## Artifact impact

Against merged PR A, the formatted artifact changed from 1,024,145 bytes to
1,072,339 bytes (**+48,194**, about **+4.7%**). Deterministic gzip-9 (`-n`)
changed from 157,707 to 161,917 bytes (**+4,210**, about **+2.7%**). The
production model emits 17 M
weights on the full corpus. Existing search caps and counters are unchanged:
partition evaluation 1,920; scored guide matching 512; joint guide variants
512; known-team partitions 640; large-pool team pairs 160.

## Interpretation

M coefficients are average residual observational associations after the
existing identity features, with attribution overlap especially around
`TSP`, `THS`, and `HT`. They are not causal effects, parsed rules, or hard
recommendations. The model remains the same regularized paired logistic /
Bradley–Terry estimator.
