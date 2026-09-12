"""Bind GLM text to original-image character geometry; never infer a hero's side.

A frame may contain the same hero on both teams. Only per-occurrence pixels are
side evidence. GLM supplies the transcript, not coordinates or confidence.
"""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

import cv2
import numpy as np

SIDE_POLICY = "original-character-pixels-v1"
NAME_RE = re.compile(r"\[([\u3400-\u9fff]{2,5})\]")
KNOWN_SIDES = {"我方", "敌方"}
MIN_PIXELS = 8
MIN_DOMINANCE = 0.85
MIN_CHAR_CONFIDENCE = 0.80
MAX_CANDIDATES = 16


def normalize(text: str) -> str:
    """Alignment only: ignore typography, never numbers or Chinese characters."""
    text = unicodedata.normalize("NFKC", text).replace("−", "-")
    return "".join(c for c in text if c.isalnum() or c in ".%+-")


def classify_character(image: np.ndarray, glyph: dict) -> dict:
    """Inspect a polygon in the *original crop*. No vertical-offset heuristics."""
    box = np.asarray(glyph.get("box"), dtype=float)
    if box.shape != (4, 2) or not np.isfinite(box).all():
        return {"side": None, "reason": "invalid_geometry"}
    score = glyph.get("score")
    if not isinstance(score, (int, float)) or not math.isfinite(score) or score < MIN_CHAR_CONFIDENCE:
        return {"side": None, "reason": "low_localization_confidence"}
    height, width = image.shape[:2]
    x0, y0 = np.floor(box.min(axis=0)).astype(int)
    x1, y1 = np.ceil(box.max(axis=0)).astype(int)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(width, x1), min(height, y1)
    if x1 <= x0 or y1 <= y0:
        return {"side": None, "reason": "outside_image"}
    region = image[y0:y1, x0:x1]
    polygon = np.rint(box - [x0, y0]).astype(np.int32)
    mask = np.zeros(region.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(mask, polygon, 1)
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    ink = (mask != 0) & (s > 80) & (v > 120)
    blue = int(np.count_nonzero(ink & (h > 95) & (h < 130)))
    red = int(np.count_nonzero(ink & ((h < 10) | (h > 170))))
    total = blue + red
    evidence: dict[str, Any] = {"blue_pixels": blue, "red_pixels": red, "side": None}
    if total < MIN_PIXELS:
        evidence["reason"] = "insufficient_colour"
    elif max(blue, red) / total < MIN_DOMINANCE:
        evidence["reason"] = "mixed_colour"
    else:
        evidence.update(side="我方" if blue > red else "敌方", reason="pixel_evidence")
    return evidence


def _occurrences(text: str, query: str) -> list[int]:
    result, start = [], 0
    while query and (position := text.find(query, start)) >= 0:
        result.append(position)
        if len(result) > MAX_CANDIDATES:
            break
        start = position + 1
    return result


def _source_stream(localization: list[dict]) -> tuple[str, list[dict]]:
    """Retain a source glyph for each normalized character, including wraps."""
    chars, sources = [], []
    for row_index, row in enumerate(localization):
        raw = row["text"]
        # Archer/unit icons often become isolated X/N. Numeric continuations
        # must survive: e.g. a running total wrapped as "321)".
        if not any("\u3400" <= c <= "\u9fff" or c.isdigit() for c in raw):
            continue
        for glyph_index, glyph in enumerate(row["glyphs"]):
            for char in normalize(glyph["text"]):
                chars.append(char)
                sources.append({**glyph, "row": row_index, "glyph": glyph_index})
    return "".join(chars), sources


def _name_evidence(line: str, match: re.Match, stream: str, sources: list[dict],
                   image: np.ndarray, names: set[str], frame_text: str, frame_offset: int) -> dict:
    name = match.group(1)
    evidence: dict[str, Any] = {"name": name, "span": list(match.span()), "side": None,
                                "policy": SIDE_POLICY, "in_catalog": name in names, "candidates": []}
    # NPC/non-draft heroes (e.g. 刘表 and 陈琳) may be absent from the catalog.
    # Exact agreement between recognizers plus each glyph's pixels is the
    # authority, not catalog membership. Unknown text is never fuzzy-corrected.
    normalized = normalize(line)
    start = len(normalize(line[:match.start(1)]))
    end = start + len(normalize(name))
    # Prefer the complete logical event. If another part of the event differs
    # between recognizers, require an exact context around the entire name.
    # Never fuzzy-match names or search for a hero in isolation.
    anchors = [(0, len(normalized)), (max(0, start - 12), min(len(normalized), end + 12))]
    for a, b in dict.fromkeys(anchors):
        query = normalized[a:b]
        minimum_context = 4 if (a, b) == (0, len(normalized)) else 8
        if len(query) - (end - start) < minimum_context:
            continue
        positions = _occurrences(stream, query)
        if not positions:
            continue
        evidence["anchor"] = query
        if len(positions) > MAX_CANDIDATES:
            return {**evidence, "reason": "too_many_matching_regions"}
        targets = _occurrences(frame_text, query)
        # Reading order resolves repeated exact events only when both complete
        # transcripts contain the same number. If one recognizer omitted an
        # occurrence, do not shift every later name onto another hero's pixels.
        if len(positions) == len(targets) and frame_offset + a in targets:
            evidence["alignment"] = "ordered_equal_count"
            evidence["matching_occurrences"] = len(positions)
            positions = [positions[targets.index(frame_offset + a)]]
        else:
            evidence["alignment"] = "all_matching_regions"
        for position in positions:
            glyphs = sources[position + start - a:position + end - a]
            decisions = [classify_character(image, g) for g in glyphs]
            sides = {d["side"] for d in decisions}
            candidate_side = next(iter(sides)) if len(sides) == 1 and None not in sides else None
            evidence["candidates"].append({
                "side": candidate_side,
                "characters": [{"text": g["text"], "box": g["box"],
                                "row": g["row"], "glyph": g["glyph"], **d}
                               for g, d in zip(glyphs, decisions)],
            })
        sides = {c["side"] for c in evidence["candidates"]}
        # Repeated exact events are safe only if *every* matching occurrence's
        # pixels agree. A mirror match is unresolved, not a name-wide vote.
        if len(sides) == 1 and None not in sides:
            return {**evidence, "side": next(iter(sides)), "reason": "pixel_evidence"}
        return {**evidence, "reason": "ambiguous_or_insufficient_pixel_evidence"}
    return {**evidence, "reason": "unmatched_text_context"}


def _logical_lines(text: str) -> list[str]:
    """Join only literal, unmistakable visual continuations; invent no words."""
    result: list[str] = []
    for line in text.splitlines():
        line = unicodedata.normalize("NFKC", line).strip()
        line = re.sub(r"\[(?:我方|敌方|待核):", "[", line)
        if not line:
            continue
        if result:
            previous = result[-1]
            numeric_tail = (previous.count("(") > previous.count(")")
                            and re.fullmatch(r"[\d.%()+\-]+", line))
            damage_tail = (previous.endswith(("损失了", "恢复了", "损失了兵", "恢复了兵"))
                           and re.match(r"^(?:兵力|力)\d", line))
            effect_tail = line == "效果" and previous.endswith("」") and "执行来自" in previous
            if numeric_tail or damage_tail or effect_tail:
                result[-1] += line
                continue
        result.append(line)
    return result


def tag_transcript(text: str, localization: list[dict], image: np.ndarray,
                   names: set[str]) -> list[dict]:
    """Return tagged logical lines plus inspectable per-token source evidence."""
    stream, sources = _source_stream(localization)
    output = []
    logical_lines = _logical_lines(text)
    frame_text = "".join(normalize(line) for line in logical_lines)
    frame_offset = 0
    name_pattern = re.compile("|".join(map(re.escape, sorted(names, key=lambda n: (-len(n), n))))) if names else None
    for line in logical_lines:
        tokens = [_name_evidence(line, m, stream, sources, image, names, frame_text, frame_offset)
                  for m in NAME_RE.finditer(line)]
        frame_offset += len(normalize(line))
        unparsed = [{"name": m[0], "span": list(m.span())}
                    for m in name_pattern.finditer(line)
                    if not any(t["span"][0] <= m.start() and m.end() <= t["span"][1] for t in tokens)] if name_pattern else []
        tagged, cursor = [], 0
        for token in tokens:
            start, end = token["span"]
            tagged.extend([line[cursor:start], f"[{token['side'] or '待核'}:{token['name']}]"])
            cursor = end
        tagged.append(line[cursor:])
        output.append({"untagged_text": line, "text": "".join(tagged), "tokens": tokens,
                       "unparsed_names": unparsed})
    return output


def line_key(line: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", line))


def _compatible(a: str, b: str) -> bool:
    """Same event text and no conflicting known-side tags. Numbers stay exact."""
    pattern = r"\[(我方|敌方|待核):"
    if re.sub(pattern, "[", line_key(a)) != re.sub(pattern, "[", line_key(b)):
        return False
    left, right = re.findall(pattern, a), re.findall(pattern, b)
    return len(left) == len(right) and all(x == y or "待核" in (x, y) for x, y in zip(left, right))


def _merge_evidence(a: str, b: str) -> str:
    """Backfill only the *same aligned event*, not every mention of a name."""
    sides = iter(re.findall(r"\[(我方|敌方|待核):", b))

    def replace(match: re.Match) -> str:
        other = next(sides)
        return f"[{other if match[1] == '待核' else match[1]}:"

    return re.sub(r"\[(我方|敌方|待核):", replace, a)


def stitch_frames(frames: list[list[str]]) -> tuple[list[str], list[dict]]:
    """Conservative ordered suffix/prefix overlap, never rolling membership.

    Identical consecutive screenshots collapse, but real repeated events within
    a frame remain. When no multi-line overlap is verified, preserve both frames
    and report the boundary instead of deleting plausible events.
    """
    result: list[str] = []
    boundaries = []
    for index, incoming in enumerate(frames):
        if not incoming:
            boundaries.append({"frame_index": index, "reason": "empty_frame"})
            continue
        if not result:
            result = list(incoming)
            continue
        overlap = 0
        for size in range(min(len(result), len(incoming)), 1, -1):
            if all(_compatible(a, b) for a, b in zip(result[-size:], incoming[:size])):
                overlap = size
                break
        if overlap:
            result[-overlap:] = [_merge_evidence(a, b) for a, b in zip(result[-overlap:], incoming[:overlap])]
            result.extend(incoming[overlap:])
        else:
            boundaries.append({"frame_index": index, "reason": "unverified_overlap"})
            result.extend(incoming)
    return result, boundaries
