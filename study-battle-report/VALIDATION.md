# Hybrid OCR validation

Local development validation on an Apple M4 Pro / 48 GB, using the four existing
1080×2340 battle fixtures. This is a small, correlated screenshot corpus, not a
claim of general OCR accuracy.

## Historical full live run (before review fixes)

All **112 screenshots** were processed with actual GLM-OCR BF16 and RapidOCR
PP-OCRv6-small character localization. The GLM model revision and decoding
settings are pinned in `backends.py`. Outputs were written separately with
`--output-dir extracted_results/hybrid-validation`; the pre-existing battle logs
and caches were checksum-verified unchanged.

The following counts were recorded with the pre-review
`original-character-pixels-v1` policy. They are **historical, not final results
for the corrected policy**: count-deficient anchors, malformed actors, and
competing overlap lengths were not yet handled conservatively. This review fix
round has not rerun the full-fixture caches or the visual audit.

| Battle | Frames | Bracketed name occurrences | Pixel-tagged | Pending | Unparsed catalog-name mentions | Unverified boundaries |
|---|---:|---:|---:|---:|---:|---:|
| 1782469166479 | 34 | 1317 | 1308 | 9 | 2 | 13 |
| 1788649256069 | 25 | 943 | 927 | 16 | 17 | 7 |
| 1788672758108 | 41 | 1608 | 1552 | 56 | 1 | 21 |
| 1788761976188 | 12 | 444 | 437 | 7 | 0 | 5 |
| **Total** | **112** | **4312** | **4224** | **88** | **20** | **46** |

These historical values are **coverage/uncertainty counts**, not correctness
scores or current coverage claims. They include
repeated source occurrences in overlapping frames. Non-catalog NPCs such as
刘表 and 陈琳 are eligible for tags based on exact recognizer agreement and their
own pixels. The catalog is not an ownership or recognition-authority gate.

Unverified boundaries are retained in the review reports. They can indicate a
real lack of screenshot overlap, recognition differences, or uncertain
alignment; both sides of the boundary remain in the text rather than being
silently deleted. Therefore the logs still require review and may contain
boundary duplicates. A stronger complete-event gold corpus would be needed to
score whole-battle deduplication.

## Historical visually checked sample

The prior model-comparison experiment selected **53 fully visible passages**
from the y=600:1000 strips of these cropped panels:

- 1782469166479: frames 0 and 17;
- 1788649256069: frames 0 and 12;
- 1788672758108: frames 0 and 20;
- 1788761976188: frames 0 and 6.

References were transcribed by the assistant from the screenshots, before
reading the new full-fixture recognizer outputs. Colours were then checked
against those same source strips. They were **not independently human-reviewed**.
For repeated identical text, the audited occurrence was identified by its source
character positions inside that strip, not by its desired side label.

The pre-review live hybrid run preserved **53/53 sampled passages**, and the
**60 name occurrences** in those passages all received the visually expected
sides. These are historical sample results, not a rerun of the corrected policy.
Whitespace and punctuation typography were normalized for content matching;
numbers, decimal points and signs remained exact. This does not establish that
all other names, values or events in the corpus are correct.

Two small source crops and recorded character-localization outputs are committed
under `fixtures/` for deterministic regression tests:

- `[我方:皇甫嵩]对[敌方:刘表]发动普通攻击`;
- `[敌方:乐进]对[我方:乐进]发动普通攻击`.

## Corrected evidence policy and regression coverage

The review fixes use `original-character-pixels-v2`. Raw schema-v3 caches remain
compatible because they store recognizer output, not trusted side decisions.
Retagging does not require new GLM or Rapid inference.

Model-free behavioral regressions exercise:

- Count-deficient full-event and local-context anchors: one matching blue source
  occurrence cannot authorize two GLM targets, even when the other source event
  contains only a one-character recognition difference. Both targets remain
  pending with source/target counts and candidate geometry/pixels.
- Competing overlap lengths, including one-line alternatives and periodic
  multi-event blocks: both frames and their pending tags remain unchanged, and
  all compatible lengths are reported as `candidate_overlaps`. A unique
  multi-line overlap still merges and may backfill only its aligned occurrences.
- Model-supplied side-prefix typography and malformed actors: NPC labels require
  their own source pixels; corrupt names are preserved as pending, with explicit
  `unparseable_actor` evidence. Serialized reports cannot claim `complete` for
  unparsed actors or unmatched NPCs.
- Low-confidence localization: valid geometry retains recognition scores and
  diagnostic blue/red counts, including in serialized review JSON, without
  authorizing a side below the confidence threshold.

A refreshed whole-fixture report must rerun tagging/stitching from raw caches
into a separate ignored output directory before replacing the historical counts
above. The 53-passage/60-name audit must again distinguish repeated text by
character geometry inside its source strip, not by a matching side label.
Neither new coverage totals nor whole-corpus accuracy are asserted here.

## Historical cache and automated validation

- Before these review fixes, repeated `--use-cache` runs produced byte-identical
  logs and review JSON for all four fixtures. Cached-only processing makes no
  model inference calls.
- The original battle-log unit suite covered pixel evidence, mirror matches,
  repeated event alignment, explicit uncertainty, source/config cache
  invalidation, malformed evidence, failed inference, and generation truncation.
- Workflow tests execute the real path-classification shell step against
  temporary Git histories and verify the new required CI dependency.
- Before these review fixes, because CI orchestration changed, local validation
  also ran image extraction,
  offline data-builder tests, web type-check/unit/e2e/build checks, and local
  agent type-check/unit/build checks. These passed without modifying those
  workspaces' source code.

Full screenshots and diagnostic artifacts remain local/Git-ignored. The
integration command and the precise evidence/uncertainty contract are in
[README.md](README.md).
