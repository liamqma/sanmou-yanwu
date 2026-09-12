# Hybrid OCR validation

Local development validation on an Apple M4 Pro / 48 GB, using the four existing
1080×2340 battle fixtures. This is a small, correlated screenshot corpus, not a
claim of general OCR accuracy.

## Full live run

All **112 screenshots** were processed with actual GLM-OCR BF16 and RapidOCR
PP-OCRv6-small character localization. The GLM model revision and decoding
settings are pinned in `backends.py`. Outputs were written separately with
`--output-dir extracted_results/hybrid-validation`; the pre-existing battle logs
and caches were checksum-verified unchanged.

After re-tagging with the final alignment/colour policy:

| Battle | Frames | Bracketed name occurrences | Pixel-tagged | Pending | Unparsed catalog-name mentions | Unverified boundaries |
|---|---:|---:|---:|---:|---:|---:|
| 1782469166479 | 34 | 1317 | 1308 | 9 | 2 | 13 |
| 1788649256069 | 25 | 943 | 927 | 16 | 17 | 7 |
| 1788672758108 | 41 | 1608 | 1552 | 56 | 1 | 21 |
| 1788761976188 | 12 | 444 | 437 | 7 | 0 | 5 |
| **Total** | **112** | **4312** | **4224** | **88** | **20** | **46** |

These are **coverage/uncertainty counts**, not correctness scores. They include
repeated source occurrences in overlapping frames. Non-catalog NPCs such as
刘表 and 陈琳 are eligible for tags based on exact recognizer agreement and their
own pixels. The catalog is not an ownership or recognition-authority gate.

Unverified boundaries are retained in the review reports. They can indicate a
real lack of screenshot overlap, recognition differences, or uncertain
alignment; both sides of the boundary remain in the text rather than being
silently deleted. Therefore the logs still require review and may contain
boundary duplicates. A stronger complete-event gold corpus would be needed to
score whole-battle deduplication.

## Visually checked sample

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

The live hybrid run preserved **53/53 sampled passages**, and the **60 name
occurrences** in those passages all received the visually expected sides.
Whitespace and punctuation typography were normalized for content matching;
numbers, decimal points and signs remained exact. This does not establish that
all other names, values or events in the corpus are correct.

Two small source crops and recorded character-localization outputs are committed
under `fixtures/` for deterministic regression tests:

- `[我方:皇甫嵩]对[敌方:刘表]发动普通攻击`;
- `[敌方:乐进]对[我方:乐进]发动普通攻击`.

## Cache and automated validation

- Repeated `--use-cache` runs produced byte-identical logs and review JSON for
  all four fixtures. Cached-only processing makes no model inference calls.
- The battle-log unit suite covers pixel evidence, mirror matches, repeated
  event alignment, explicit uncertainty, source/config cache invalidation,
  malformed evidence, failed inference, and generation truncation.
- Workflow tests execute the real path-classification shell step against
  temporary Git histories and verify the new required CI dependency.
- Because CI orchestration changed, local validation also ran image extraction,
  offline data-builder tests, web type-check/unit/e2e/build checks, and local
  agent type-check/unit/build checks. These passed without modifying those
  workspaces' source code.

Full screenshots and diagnostic artifacts remain local/Git-ignored. The
integration command and the precise evidence/uncertainty contract are in
[README.md](README.md).
