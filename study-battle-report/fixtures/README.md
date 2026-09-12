# Character-colour regression fixtures

These small, intentionally committed crops come from the local battle screenshot
fixtures. Each JSON records the original image path, crop transforms, visible
transcript, and RapidOCR PP-OCRv6-small character geometry. Tests do not execute
an OCR model: they combine the recorded localization with these real source
pixels and assert the resulting per-name tags.

- `mixed-names.png`: blue 皇甫嵩 attacks red 刘表.
- `mirror-names.png`: red 乐进 attacks blue 乐进 on the same line.

Expected colours were visually checked against the PNGs, independently of the
classifier. Both tests would fail if one side were assigned to the whole line or
if a hero name were treated as globally belonging to one team. Raw transcripts
are not treated as confidence-bearing GLM output; the model supplies text while
only original-image pixels authorize side labels.
