# Battle-damage research pipeline

This directory is a standalone, deterministic research pipeline for stitched
battle-detail logs. It is deliberately separate from the production
recommendation builder: no output here is read by `data/` or `web/`, and a
research run never changes recommendation weights or artifacts.

## Scope and non-claims

The pipeline:

1. verifies the configured log, cache, and provenance-sidecar hashes and, for
   exact v2 lineage, binds every current screenshot filename and SHA-256 to the
   v2 cache/sidecar frame metadata;
2. aligns every final log line to possible OCR-cache observations without
   claiming provenance that OCR v1 did not retain;
3. emits exactly one event row per final log line, including `unknown` rows;
4. preserves each entity occurrence as direct token-colour evidence, inferred,
   unavailable, or missing and replays only directly observed identities;
5. records proven lethal damage as right-censored, exact damage only with a known
   positive post-hit troop value, and all other missing-post-hit relations as unknown;
6. checks game-displayed percentage accumulation separately from final damage,
   carrying each subject/metric latent interval through its ordered transitions
   under shared clipping bounds without reporting an unidentified numeric witness;
7. registers a finite set of damage candidates; and
8. refuses final-formula selection when independent groups are insufficient.

It does **not** claim that the current battle identifies the final damage
formula. The OCR v1 cache contains corrected/side-tagged text and recognition
scores, but not raw OCR text, token-level colour, boxes, or exact stitch
lineage. Those missing fields remain null/uncertain. Complete v2 lineage is
trusted only when the sidecar is pinned by the configured manifest, its
declared log and cache hashes match the actual input bytes, and its frame names
and hashes match both the cache and current screenshots. Every embedded source
observation must exactly match the cache, and the referenced transformation
graph must connect the exact source set to the final lineage node. The effective
lineage status is the more conservative of the graph-derived and declared
statuses. A supplied per-occurrence side map must match the map reconstructed
from source evidence. When an older v2 sidecar lacks occurrence indices,
conflicting side-backfill source candidates fail closed rather than guessing. Canonical OCR repairs, side backfills,
near-duplicate OCR reuse, fuzzy stitching, unresolved sides, and other heuristic
lineage remain non-exact evidence. Inferred, reused, legacy, or otherwise
unverified side tags remain unresolved during state replay.

LLM or custom-gateway annotations, if collected outside this pipeline, are not
inputs to deterministic analysis. They must not alter original text, register
formula candidates, choose a model, or enter a primary fit.

## Inputs

Each local battle remains under the existing ignored layout:

```text
study-battle-report/battles/<id>/
  images/battle_detail_*.png
  .ocr_cache.json
  battle_log.txt
  battle_log.provenance.json
```

A tracked manifest under `manifests/<id>.json` records expected hashes, expected
counts, experiment-session identity, known metadata, explicit unknowns, and
mirror names. Every hero known to occur in both team lists must be in
`mirror_names`; additional reviewed ambiguity names remain allowed. Metadata-gap
reporting checks every source manifest and lists only absent game/build/capture,
level, equipment/strategy, pre-battle attribute, supply, hero, formation, row,
and loadout fields. Nulls, blank strings, and empty collections count as absent;
the gap is omitted when every required value is present. A pinned log, cache,
or sidecar change fails closed until reviewed and deliberately updated in the
manifest. Exact v2 lineage additionally requires
`expected_sources.battle_log_provenance_sha256`; the cache and sidecar frame
metadata must then match every current screenshot filename and SHA-256. The
generated source manifest pins `battle_log.provenance.json` alongside the log
and cache. A legacy run without a complete sidecar remains usable through
conservative cache-candidate alignment and does not claim exact lineage.

## Outputs

Generated artifacts are ignored under `research/results/<id>/`:

- `source_manifest.json` — source and pipeline hashes;
- `line_observations.jsonl` — exact final text, line number, possible cache
  observations, OCR scores, per-entity side provenance, anomalies, and
  uncertainties;
- `events.jsonl` — one parsed/partial/unknown row per final line;
- `state_snapshots.jsonl` — auditable state transitions and skipped ambiguous
  identities;
- `formula_registry.json` — fixed formula candidates;
- `quality_report.json` — provenance, parser, replay, and exclusion counts;
- `model_comparison.json` — UI compatibility plus final-damage sufficiency;
- `report.md` — human-readable limits and collection gaps; and
- `artifact_manifest.json` — hashes of all generated artifacts.

JSON object keys are sorted, and JSONL rows retain deterministic source order.
No generated wall-clock timestamp or absolute output path enters the artifacts;
source metadata such as `captured_at` is retained when supplied. Equal
source/code inputs are therefore byte-reproducible.

Output publication is fail-closed. The CLI rejects repository/source ancestors
and any in-repository destination outside `research/results/<id>/`. An existing
directory is replaceable only when its artifact manifest proves the same schema
and battle and its entries are exactly the known pipeline artifacts. Builds are
written and validated in a temporary sibling directory, then only the known
artifact files are replaced. Unowned files and directories are never recursively
deleted.

## Run

From the repository root:

```bash
make research-battle BATTLE=1788649256069
make test-battle-research
```

Equivalent direct commands:

```bash
uv run python study-battle-report/research/cli.py build \
  --battle 1788649256069 \
  --output study-battle-report/research/results/1788649256069

uv run python study-battle-report/research/cli.py validate \
  study-battle-report/research/results/1788649256069
```

Determinism check:

```bash
uv run python study-battle-report/research/cli.py build \
  --battle 1788649256069 \
  --output /tmp/sanmou-battle-research-repeat

diff -ru study-battle-report/research/results/1788649256069 \
  /tmp/sanmou-battle-research-repeat
```

## Interpretation rules

- `ui_accumulator` results concern only the percentages displayed by the game.
  The hidden-precision candidate carries one latent state per subject/metric and
  requires shared `L/U` bounds across all checked transitions. It reports whether
  a common feasible region exists, but never presents one arbitrary grid witness
  as identified bounds; clipping counterexamples cannot each select their own cap.
- `final_damage.status=insufficient_independent_groups` means no damage formula
  or parameter may be selected.
- `mirror_ambiguous` and `inferred` preserve any displayed side tag but keep
  `resolved_side` null and skip identity state mutation.
- A post-hit troop value is accepted only as a fully closed integer
  parenthetical immediately after the logged damage amount. Other or incomplete
  parentheses do not fill it. Percentage and stat totals likewise require a
  complete matching full-width or ASCII parenthetical; malformed totals remain
  null with explicit uncertainty.
- A lethal event with post-hit troops zero stores the logged loss as a lower
  bound (`censoring.kind=right`). Missing post-hit troops are never exact; they
  become right-censored only when an adjacent exact death transition identifies
  the same resolved target, and otherwise retain `true_damage_relation=unknown`.
  Right-censoring may remain descriptive, but `censored_likelihood_only` is
  granted only after the same complete-cause, direct non-mirror side, anomaly,
  and exact-v2 provenance gates used for numerical evidence.
- OCR score is a recognition score, not a statistical variance weight.
- Unknown and anomalous events remain in the audit corpus even when excluded
  from primary numerical analysis.
