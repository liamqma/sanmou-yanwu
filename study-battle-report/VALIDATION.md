# Hybrid OCR validation

Validation used an Apple M4 Pro / 48 GB and the four existing 1080×2340 battle
fixtures. This is a small, correlated screenshot corpus, not a claim of general
OCR accuracy. The current evidence policy is **`original-character-pixels-v6`**;
previous policy results in Git history are not current coverage claims.

## Live recognition and current cached replay

All **112 screenshots** were originally processed with actual GLM-OCR BF16 and
RapidOCR PP-OCRv6-small character localization. Model/decoding settings are pinned
in `backends.py`. That live run wrote separately under
`extracted_results/hybrid-validation`, preserving the original logs and caches.

After the review fixes, all 112 raw-cache entries were re-tagged and re-stitched
with v6 into `extracted_results/hybrid-reviewed-v6`. No model inference was
repeated: caches contain raw recognizer output, not trusted side decisions.
Source image hashes were rechecked, and the original battle logs/caches remained
checksum-identical. Two cached-only runs produced byte-identical text and review
JSON for all four fixtures.

| Battle | Frames | Actor tokens | Pixel-tagged | Pending | Unparsed mentions/fragments | Unverified boundaries |
|---|---:|---:|---:|---:|---:|---:|
| 1782469166479 | 34 | 1318 | 1304 | 14 | 2 | 12 |
| 1788649256069 | 25 | 956 | 903 | 53 | 17 | 5 |
| 1788672758108 | 41 | 1608 | 1520 | 88 | 1 | 21 |
| 1788761976188 | 12 | 444 | 437 | 7 | 0 | 5 |
| **Total** | **112** | **4326** | **4164** | **162** | **20** | **43** |

These are **coverage and uncertainty counts, not correctness scores**. Actor
tokens include malformed bracket fragments and repeated occurrences in
screenshot overlaps. Non-catalog NPCs such as 刘表 and 陈琳 remain eligible when
exact recognition and their own pixels support a tag. Ambiguous, conflicting,
partial-name, or unverifiable-confidence evidence remains pending.

An unverified boundary may indicate no screenshot overlap, recognition
differences, or ambiguous alignment. Both sides are retained rather than
silently deleting events. The resulting logs can therefore contain boundary
duplicates and still require review. A complete event-level gold corpus would
be needed to score whole-battle stitching accuracy.

## Visually checked sample

The model-comparison experiment selected **53 fully visible passages** from the
y=600:1000 strips of these standard cropped panels:

- 1782469166479: frames 0 and 17;
- 1788649256069: frames 0 and 12;
- 1788672758108: frames 0 and 20;
- 1788761976188: frames 0 and 6.

The assistant transcribed these references from the screenshots before reading
the full-fixture recognizer outputs, and checked name colours against those
same strips. The references were **not independently human-reviewed**. Repeated
identical text was disambiguated using its source character positions inside
the strip, not by choosing the desired side label.

The v6 replay preserves **53/53 sampled passages**, and all **60 expected
name-side labels** match the visual reference. Content matching normalizes
whitespace and punctuation typography while retaining Chinese characters,
digits, decimal points, and signs. This sample does not prove every other name,
value, event, or side tag in the corpus correct.

## Executable regression evidence

The current model-free suite passed **134 tests**. It includes:

- Real mixed-colour and mirror-match crops under `fixtures/`, producing
  `[我方:皇甫嵩]对[敌方:刘表]发动普通攻击` and
  `[敌方:乐进]对[我方:乐进]发动普通攻击`.
- Regressions for insufficient source occurrences, cross-anchor/shared-glyph
  claims, partial source-name matches, isolated actor delimiters, malformed and
  closing-only actors, and warning-only NPC hints split across detector rows.
- Repeated-event overlap ambiguity and isolation of unverified frame history.
- Execution of the pinned RapidOCR 3.9.2 CTC decoder and character-box consumer
  without neural inference, reproducing its whitespace/confidence shift. The
  adapter and cached reader reject unverifiable associations, retaining
  `raw_score` and pixel diagnostics while the effective `score` stays null.
  Seven regressions failed against the pre-v6 implementation before passing
  with the fixes.
- A real-pixel CLI regression covering `--list`, cached-only publication,
  deterministic replay, untrusted cached confidence annotations, stale/legacy
  cache rejection, and preservation of original/prior output files. Model calls
  are forbidden throughout; the test emits inspectable PNG/JSON/text artifacts
  when run with `pytest -s`.
- Cache/config invalidation, malformed raw data, byte-snapshot hashing, RGB
  conversion, failed inference, and empty/truncated output rejection.
- Execution of the actual workflow path-classifier shell against temporary Git
  histories, plus the required CI dependency contract.

No external OCR API or live model inference is used by these tests. The full
screenshots and diagnostic artifacts remain local/Git-ignored; only the two
small real-pixel regressions and their recorded geometry are committed.

Because CI orchestration changed, local development validation also ran image
extraction, offline data-builder tests, web type-check/unit/e2e/build checks,
and agent type-check/unit/build checks. Those passed without source changes to
those workspaces. Remote PR checks remain an independent delivery requirement.

Future policy changes must replay the raw caches and repeat the source-strip
audit before publishing updated counts. Commands and the authoritative evidence
contract are in [README.md](README.md).
