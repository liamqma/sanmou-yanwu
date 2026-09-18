# Local, colour-grounded battle-log OCR

This project reads the scrolling 战报详情 screenshots in `battles/<id>/images/`
and produces a text log plus inspectable per-name colour evidence. It is separate
from `image_extraction/`: that workspace continues to use PaddleOCR unchanged.

## Requirements and commands

Live recognition is free and local on an **Apple Silicon Mac** with Python 3.12.
GLM uses MLX/Metal; RapidOCR uses ONNX Runtime CPU. The first live run downloads
GLM weights from Hugging Face at a pinned revision (roughly 2.2 GB); subsequent
runs use the local cache without contacting the Hub when the pinned snapshot is
present. No screenshot is sent to an OCR API. Model code is loaded with
`trust_remote_code=False`, and Hugging Face telemetry is disabled by the adapter.

This directory is an **independent uv project**, with its own environment and
lockfile. Run these commands from the repository root:

```bash
uv sync --project study-battle-report --locked

uv run --project study-battle-report python study-battle-report/ocr_battle_log.py --list
uv run --project study-battle-report python study-battle-report/ocr_battle_log.py <id>
uv run --project study-battle-report python study-battle-report/ocr_battle_log.py --all

# Re-tag/restitch existing valid hybrid evidence; no model inference or downloads.
uv run --project study-battle-report python study-battle-report/ocr_battle_log.py <id> --use-cache

# Validate separately, preserving existing logs/caches beside the screenshots.
uv run --project study-battle-report python study-battle-report/ocr_battle_log.py --all \
  --output-dir extracted_results/hybrid-validation

# Reuse that isolated cache: keep the same output directory.
uv run --project study-battle-report python study-battle-report/ocr_battle_log.py --all \
  --use-cache --output-dir extracted_results/hybrid-validation

make test-battle-logs
```

Ordinary runs resume compatible cached frames. `--refresh` recomputes every
frame. `--use-cache` is strictly cached-only: missing/stale/invalid evidence is an
error, never an implicit model download or live inference. `--model-dir <path>`
can use already-downloaded GLM weights; all model/processor files are hashed into
a distinct cache identity. Use the same override when reusing that cache.

Legacy root-environment commands (`uv run python ...`) may lack these new
dependencies; use `--project study-battle-report`. `make sync` remains scoped to
the original root/image-extraction workspace.

## Recognition and side-tag contract

1. Validate each native **1080×2340** image and crop the log panel at
   `(x0, y0, x1, y1) = (195, 275, 1060, 2120)`. Other dimensions fail clearly
   rather than silently applying the wrong layout.
2. RapidOCR **PP-OCRv6 small** returns character boxes in the original crop's
   coordinate system. Document unwarping, orientation correction, and the old
   Paddle-specific vertical offset are not used.
3. GLM-OCR BF16 transcribes the full panel using `Text Recognition:` at temperature
   zero. This retains the full-panel recognition path evaluated during model
   selection. Empty or token-limited output fails before publishing a log.
4. Bind each bracketed hero name to Rapid's character boxes using exact event
   text, or an exact context around the complete name. Alignment ignores
   typography but preserves Chinese characters, digits, decimal points and signs.
   It never fuzzy-matches names. Explicit Rapid actor boundaries are retained
   alongside the normalized stream, including names wrapped across source rows
   and openers/closers detected as punctuation-only rows. Detector splitting
   must not erase a source actor boundary. Unit-icon filtering is disabled
   inside an open source actor: dropping an isolated `X` or punctuation there
   would silently repair its spelling. A candidate that overlaps an explicitly different actor or only part of one
   cannot authorize a side. An exact complete source-actor span is required;
   missing source delimiters produce `missing_source_actor_boundary` rather
   than assuming a substring is a whole name. Thus `[甫嵩]` must not borrow the final glyphs of Rapid's
   `[皇甫嵩]`. The GLM spelling remains pending with
   `source_actor_boundary_mismatch`, the conflicting `source_actors` (name,
   normalized raw bracket text, and half-open normalized-source span), and the
   candidate's geometry, scores and pixel counts. Surrounding whitespace,
   full-width brackets and side prefixes do not change the source name boundary.
   The shared source parser retains malformed spans instead of extracting a
   balanced inner name. Nested brackets taint the entire enclosing span until
   its outer closer, or through the remaining source stream if it never closes.
   For example, `[皇[甫嵩]` cannot supply a complete 甫嵩 actor. Affected candidates
   retain `source_actor_boundary_mismatch` with the original fragment, normalized
   span and source reason (`nested_source_actor`, `unclosed_source_actor`,
   `orphan_source_closer` or `unparseable_source_actor`). Neither side authorization
   nor warning hints can promote an inner substring of that malformed span.
   A later actor outside a closed malformed span remains independently eligible.
   This is occurrence-local, not a catalog veto on a shorter name independently
   recognized elsewhere. Repeated exact events are paired in reading
   order only when both transcripts contain the same number of occurrences.
   If Rapid has fewer matching source occurrences than GLM has targets, that
   anchor cannot authorize any of those targets: they remain pending with
   `insufficient_source_occurrences`, both counts, and candidate pixel evidence.
   One source region must not authorize multiple target occurrences. Before
   rendering any tags, a frame-wide check rejects shared source glyphs across
   different target tokens, even when their anchors differ or another claimant
   is already pending. Otherwise-authorized tokens become pending with
   `competing_source_assignments`; all claimants retain `source_conflicts`
   identifying shared row/glyph IDs and zero-based line/token references, plus
   their candidate geometry, scores and pixel counts. Physical character regions
   also determine independence: positive-area polygon intersections across
   distinct detector IDs are conflicts, including duplicate/reordered rows,
   equivalent vertex orderings and slightly jittered boxes. These diagnostics
   include `overlapping_character_regions`, both source IDs/boxes and their
   `overlap_area`. Mere edge contact is not a conflict; neither is an overlapping
   bounding rectangle without intersecting polygon interiors. Degenerate,
   non-finite or otherwise unusable quadrilaterals cannot authorize a side.
   Even partial glyph-span overlap is a conflict; disjoint, independently
   localized occurrences remain eligible. When Rapid has extra matches, all matching candidate regions must
   independently agree in colour and must not compete with another token's
   candidates; conflicting or insufficient evidence stays unresolved.
5. Sample **each character's original pixels**, using explicit blue/red HSV
   masks. A name is tagged only when its characters have sufficiently strong,
   consistent evidence. Damage-number colours and a neighbouring hero's colour
   are not evidence for that name. Character-confidence association is checked
   independently: the pinned RapidOCR 3.9.2 decoder can drop recognized spaces
   from glyph content without dropping their confidence entries. Rows whose
   text no longer matches their one-character-per-entry glyph sequence cannot
   authorize a side using those shifted scores. This guard also runs on old
   caches, regardless of any cached alignment annotation.

Example, including a mirror match:

```text
[我方:皇甫嵩]对[敌方:刘表]发动普通攻击
[敌方:乐进]对[我方:乐进]发动普通攻击
```

The same hero can appear on both teams. There is **no name-wide majority vote,
opening-window ownership assumption, skill-ownership inference, or line-wide
side assignment**. Any side label supplied by GLM itself is discarded and
recomputed from pixels, including whitespace/full-width prefix variants such as
`[敌方 :陈琳]` and `［敌 方 ：陈琳］`.

Unmatched text or weak/ambiguous colour produces `[待核:名字]`. A non-catalog
NPC name (such as 刘表 or 陈琳) can still be tagged when both recognizers agree
on its exact context and its own pixels provide the colour; catalog membership
is recorded, not used as a veto. Square-bracket actor parsing fails closed:
malformed names such as `[张?]` become `[待核:张?]`, without guessing a corrected
name, and are recorded in both `tokens` and `unparsed_names` with reason
`unparseable_actor`. Empty or unclosed actor brackets also require review; an
unclosed actor retains the remaining text rather than inventing a name/event
split. A closing-only fragment such as `陈琳]` is also pending, even if the name
is absent from the catalog; its `raw_actor` preserves the normalized source
fragment. If a missing opener makes the name boundary unclear (for example
`对陈琳]`), that whole fragment is preserved inside the pending token rather than
inventing a split. These tokens cannot authorize sides even if normalized text
or pixels happen to match. Hero mentions outside actor brackets are kept
verbatim and reported as `unparsed_names` when named by the catalog **or the
localized source transcript**. Warning hints come from the same complete source
actors used for boundary checks, so `[陈` and `琳]开始行动` still identify a
warning-only 陈琳 hint. They accept the same surrounding whitespace, full-width
typography and side-prefix normalization, but do not repair corrupt names or
incomplete or nested brackets. They authorize
warnings only, never side tags; an unbracketed NPC cannot silently produce a
complete report merely because it is absent from the catalog. The catalog's
`祝融` is recognized under its observed in-game display name `祝融夫人`.
Other names/skills are not snapped to
plausible dictionary values, and numeric values are never corrected by heuristics.

## Stitching and uncertainty

Only literal, unmistakable visual continuations are joined (for example an open
parenthesized number followed by its remaining digits, or a wrapped trailing
`效果`). No missing verbs or event content are synthesized.

Stitching requires a unique ordered suffix/prefix overlap of at least two lines.
Only the preceding physical frame's suffix is eligible, retaining side evidence
already verified for its aligned events. Text accumulated across an uncertain
boundary is not source history and cannot authorize a later overlap. An empty
frame breaks overlap evidence; a later unique overlap with the new preceding
frame may still merge without crossing that gap.
It keeps numbers exact and refuses to merge conflicting known sides. Pending
tags can be filled only from the **same aligned event** at an unambiguous
boundary. Identical events within a frame remain, rather than being removed by a
rolling membership filter.

All compatible overlap lengths are considered, including a single-line match
as a competing hypothesis (never as sufficient evidence by itself). Multiple
lengths produce `ambiguous_overlap` with `candidate_overlaps` in the review
report. For example, three repeated events at both edges might overlap by one,
two, or three events; the longest match is not proof that all three are old.
**Both frames are preserved**, with no side backfill across that boundary.
Identical transcripts with competing overlaps also remain duplicated because
text equality alone does not establish that the screenshots show the same events.

When no unique multi-line overlap can be verified, the boundary is reported as
`unverified_overlap` or `ambiguous_overlap`. This favours retaining evidence over
deleting real repeated events, but the resulting log may contain duplicates at
those boundaries. It is not a claim of perfect OCR or perfectly deduplicated
event history. Review pending tags, unparsed names, and unverified boundaries
before using a log as battle evidence.

## Outputs and cache safety

Each battle writes:

- `battle_log.txt`: readable tagged text;
- `battle_log.review.json`: per-frame raw-image hashes, logical lines, candidate
  character polygons, effective recognition `score`, preserved upstream
  `raw_score`, `score_alignment` and blue/red pixel counts, occurrence counts,
  source-actor boundary mismatches, cross-token source conflicts,
  unresolved/unparseable reasons, boundary hypotheses, and a SHA-256 binding to
  the text log. Valid in-image geometry
  retains diagnostic colour
  counts even below the 0.80 localization-confidence threshold, but that
  character's side remains `null`. Unverifiable character/score association sets
  the effective score to `null` and records `unverified_character_confidence`;
  `raw_score` remains only an upstream observation, not a trusted character
  confidence. Unmatched/unparseable actors have no candidate
  geometry rather than fabricated coordinates. Any pending token, unparsed
  mention, or uncertain boundary sets the report status to `needs_review`;
- `.ocr_cache.json`: schema-v3 raw GLM text plus Rapid character localization.

Raw cache glyph scores are upstream observations; the live adapter annotates
alignment status, but the tagging stage recomputes the correspondence guard for
both new and legacy hybrid rows. A cached `score_alignment: aligned` assertion
cannot override mismatching content. This does not require rerunning either
model.

These generated artifacts are Git-ignored. The cache fingerprints image bytes,
crop settings, model revision (or local model bytes), runtime package versions,
and recognition options. It intentionally stores raw evidence, not trusted
precomputed tags: `--use-cache` always re-samples the source screenshot pixels.
Legacy Paddle caches (including schema-v2 caches from earlier experiments) are
not interchangeable. A normal run rebuilds them; cached-only mode refuses them.

Complete frames are cached atomically for resumability. A recognition failure
leaves the previously published log intact. The text and review files each use
atomic replacement; the review's `log_sha256` detects a mismatch if a process or
filesystem failure interrupts publication between those two files.

## Testing

`make test-battle-logs` runs deterministic tests without downloading or executing
models. Tests cover mixed-colour names, the same hero on opposing sides,
count-deficient full-event/context anchors, partial-name source-boundary
mismatches, nested/malformed source spans, frame-wide shared-glyph and physical
polygon conflicts (including duplicate/jittered/reordered detector geometry),
independent and edge-touching actors, competing repeated-event overlaps,
isolation of uncertain boundary history,
whitespace-normalized NPC warnings, untrusted side-prefix typography, malformed
actors, low-confidence pixel/score diagnostics, original-image character geometry,
cache invalidation/corruption,
failure-before-publication, literal wrapping, RGB conversion, generation
truncation, and unambiguous ordered overlaps. The localization safety tests
execute the pinned CTC decoder and character-box consumer without model
inference to reproduce the whitespace/confidence shift. A CLI-level regression
uses real mixed-colour and mirror-match pixels with all model calls forbidden,
checks deterministic cached replay and serialized physical-region/source-parser
conflict diagnostics, and verifies stale/legacy cache failures leave prior
outputs intact.

Two small committed crops under `fixtures/` contain visually verified opposite
sides, with recorded Rapid character geometry. These test the colour/alignment
contract through real pixels; model transcription quality remains a **manual
local integration check**, not a CI assertion that requires an Apple GPU.

For changes to models or alignment, run the full pipeline over the four local
battle folders into a separate output directory and inspect the review reports.
The full screenshots are local/Git-ignored, not available on a clean CI runner.
