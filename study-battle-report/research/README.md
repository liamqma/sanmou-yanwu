# Battle-damage research pipeline

This directory is a standalone, deterministic research pipeline for stitched
battle-detail logs. It is deliberately separate from the production
recommendation builder: no output here is read by `data/` or `web/`, and a
research run never changes recommendation weights or artifacts.

## Scope and non-claims

The pipeline:

1. verifies the configured source hashes and screenshot count;
2. aligns every final log line to possible OCR-cache observations without
   claiming provenance that OCR v1 did not retain;
3. emits exactly one event row per final log line, including `unknown` rows;
4. replays only identities whose side is not ambiguous;
5. records lethal damage as right-censored;
6. checks game-displayed percentage accumulation separately from final damage;
7. registers a finite set of damage candidates; and
8. refuses final-formula selection when independent groups are insufficient.

It does **not** claim that the current battle identifies the final damage
formula. The OCR v1 cache contains corrected/side-tagged text and recognition
scores, but not raw OCR text, token-level colour, boxes, or exact stitch
lineage. Those missing fields remain null/uncertain.

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
```

A tracked manifest under `manifests/<id>.json` records expected hashes, expected
counts, experiment-session identity, known metadata, explicit unknowns, and
mirror names. A source change fails closed until reviewed and deliberately
updated in the manifest.

## Outputs

Generated artifacts are ignored under `research/results/<id>/`:

- `source_manifest.json` — source and pipeline hashes;
- `line_observations.jsonl` — exact final text, line number, possible cache
  observations, OCR scores, anomalies, and uncertainties;
- `events.jsonl` — one parsed/partial/unknown row per final line;
- `state_snapshots.jsonl` — auditable state transitions and skipped ambiguous
  identities;
- `formula_registry.json` — fixed formula candidates;
- `quality_report.json` — provenance, parser, replay, and exclusion counts;
- `model_comparison.json` — UI compatibility plus final-damage sufficiency;
- `report.md` — human-readable limits and collection gaps; and
- `artifact_manifest.json` — hashes of all generated artifacts.

JSON object keys and JSONL rows are canonically ordered. No timestamps or
absolute output paths enter artifacts, so equal source/code inputs are
byte-reproducible.

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
- `final_damage.status=insufficient_independent_groups` means no damage formula
  or parameter may be selected.
- `mirror_ambiguous` preserves the observed side tag but keeps `resolved_side`
  null and skips identity state mutation.
- A lethal event with post-hit troops zero stores the logged loss as a lower
  bound (`censoring.kind=right`).
- OCR score is a recognition score, not a statistical variance weight.
- Unknown and anomalous events remain in the audit corpus even when excluded
  from primary numerical analysis.
