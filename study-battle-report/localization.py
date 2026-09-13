"""Validate the association of raw Rapid character content and confidence.

RapidOCR 3.9.2 removes recognized whitespace from word content but does not
remove its entries from WordInfo.confs before zipping character boxes. A row
whose glyph content omits recognized whitespace therefore cannot supply
trustworthy character confidence, even if its geometry looks convincing. This
guard also runs on older raw caches, not just in the live adapter. A genuinely
one-character-per-entry sequence that preserves all whitespace remains aligned.
"""
from __future__ import annotations


def character_score_alignment(row: dict) -> str:
    text = row["text"]
    glyphs = row["glyphs"]
    if any(len(glyph["text"]) != 1 for glyph in glyphs):
        return "non_character_glyph"
    if "".join(glyph["text"] for glyph in glyphs) != text:
        return "recognized_whitespace" if any(char.isspace() for char in text) else "text_glyph_mismatch"
    return "aligned"
