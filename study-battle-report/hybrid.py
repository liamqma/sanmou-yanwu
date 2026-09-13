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

from localization import character_score_alignment

SIDE_POLICY = "original-character-pixels-v6"
# Capture every square-bracket fragment, including a closing bracket with no
# opener. The latter's lexical boundary is unknown: preserve the whole fragment
# as pending rather than guessing which characters belong to an actor's name.
ACTOR_RE = re.compile(r"\[([^\[\]\n]*)(?:\]|(?=\[|$))|([^\[\]\n]*)\]")
SIDE_PREFIX = r"\s*(?:(?:我\s*方|敌\s*方|待\s*核)\s*[:∶]\s*)+"
NAME_RE = re.compile(r"[\u3400-\u9fff]{2,5}")
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
    if glyph.get("score_alignment", "aligned") != "aligned":
        evidence["reason"] = "unverified_character_confidence"
    elif not isinstance(score, (int, float)) or not math.isfinite(score) or score < MIN_CHAR_CONFIDENCE:
        evidence["reason"] = "low_localization_confidence"
    elif total < MIN_PIXELS:
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


def _source_stream(localization: list[dict]) -> tuple[str, list[dict], list[dict]]:
    """Retain normalized character geometry and explicit source actor spans."""
    chars, sources, raw_chars = [], [], []
    inside_actor = False
    for row_index, row in enumerate(localization):
        raw = "".join(unicodedata.normalize("NFKC", g["text"]) for g in row["glyphs"])
        # Unit-icon noise can be ignored, but a detector may put an actor's
        # opener or closer in its own row. Those delimiters must survive in
        # the shared boundary stream even though normalize() removes them.
        if not inside_actor and not any("\u3400" <= c <= "\u9fff" or c.isdigit() or c in "[]" for c in raw):
            continue
        # An isolated X or punctuation can be noise outside a name, but must
        # never be removed from an open actor (which would repair its spelling).
        for char in raw:
            if char in "[]":
                inside_actor = char == "["
        # Recompute this from the raw row even when a cache claims alignment.
        # Keep upstream values as raw_score; never publish a shifted value as
        # the confidence of a different character.
        alignment = character_score_alignment(row)
        for glyph_index, glyph in enumerate(row["glyphs"]):
            raw_chars.append(unicodedata.normalize("NFKC", glyph["text"]))
            for char in normalize(glyph["text"]):
                chars.append(char)
                sources.append({**glyph, "raw_score": glyph.get("score"),
                                "score": glyph.get("score") if alignment == "aligned" else None,
                                "score_alignment": alignment, "row": row_index, "glyph": glyph_index})
    raw_stream = "".join(raw_chars)
    actors = []
    for match in re.finditer(r"\[([^\[\]\n]*)\]", raw_stream):
        name = re.sub("^" + SIDE_PREFIX, "", match[1]).strip()
        end = len(normalize(raw_stream[:match.end(1)]))
        actors.append({"name": name, "span": [end - len(normalize(name)), end],
                       "raw_actor": match[0]})
    return "".join(chars), sources, actors


def _name_evidence(line: str, match: re.Match, stream: str, sources: list[dict],
                   source_actors: list[dict], image: np.ndarray, names: set[str],
                   frame_text: str, frame_offset: int) -> dict:
    raw_name = match.group(1) if match.group(1) is not None else match.group(2)
    name = re.sub("^" + SIDE_PREFIX, "", raw_name).strip()
    evidence: dict[str, Any] = {"name": name, "span": list(match.span()), "side": None,
                                "raw_actor": match.group(), "policy": SIDE_POLICY,
                                "in_catalog": name in names, "candidates": []}
    if (not NAME_RE.fullmatch(name) or not match.group().startswith("[")
            or not match.group().endswith("]")):
        return {**evidence, "reason": "unparseable_actor"}
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
        evidence["matching_occurrences"] = len(positions)
        evidence["target_occurrences"] = len(targets)
        # Reading order resolves repeated exact events only when both complete
        # transcripts contain the same number. If one recognizer omitted an
        # occurrence, do not shift every later name onto another hero's pixels.
        if len(positions) < len(targets):
            evidence["alignment"] = "count_deficient"
        elif len(positions) == len(targets) and frame_offset + a in targets:
            evidence["alignment"] = "ordered_equal_count"
            positions = [positions[targets.index(frame_offset + a)]]
        else:
            evidence["alignment"] = "all_matching_regions"
        for position in positions:
            source_start, source_end = position + start - a, position + end - a
            glyphs = sources[source_start:source_end]
            mismatches = [actor for actor in source_actors
                          if source_start < actor["span"][1] and actor["span"][0] < source_end
                          and (actor["span"] != [source_start, source_end] or actor["name"] != name)]
            decisions = [classify_character(image, g) for g in glyphs]
            sides = {d["side"] for d in decisions}
            candidate_side = next(iter(sides)) if len(sides) == 1 and None not in sides else None
            candidate = {
                "side": None if mismatches else candidate_side,
                "characters": [{"text": g["text"], "box": g["box"], "score": g.get("score"),
                                "raw_score": g.get("raw_score"), "score_alignment": g["score_alignment"],
                                "row": g["row"], "glyph": g["glyph"], **d}
                               for g, d in zip(glyphs, decisions)],
            }
            if mismatches:
                candidate.update(reason="source_actor_boundary_mismatch", source_actors=mismatches)
            evidence["candidates"].append(candidate)
        if evidence["alignment"] == "count_deficient":
            return {**evidence, "reason": "insufficient_source_occurrences"}
        if any(c.get("reason") == "source_actor_boundary_mismatch" for c in evidence["candidates"]):
            return {**evidence, "reason": "source_actor_boundary_mismatch"}
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
        line = re.sub(r"\[" + SIDE_PREFIX, "[", line)
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


def _reject_shared_sources(lines: list[dict]) -> None:
    claims: dict[tuple[int, int], set[tuple[int, int]]] = {}
    for line_index, line in enumerate(lines):
        for token_index, token in enumerate(line["tokens"]):
            for candidate in token["candidates"]:
                for char in candidate["characters"]:
                    claims.setdefault((char["row"], char["glyph"]), set()).add((line_index, token_index))
    for (row, glyph), targets in claims.items():
        if len(targets) < 2:
            continue
        conflict = {"row": row, "glyph": glyph,
                    "targets": [{"line_index": line, "token_index": token} for line, token in sorted(targets)]}
        for line_index, token_index in sorted(targets):
            token = lines[line_index]["tokens"][token_index]
            token.setdefault("source_conflicts", []).append(conflict)
            if token["side"] is not None:
                token.update(side=None, reason="competing_source_assignments")


def tag_transcript(text: str, localization: list[dict], image: np.ndarray,
                   names: set[str]) -> list[dict]:
    """Return tagged logical lines plus inspectable per-token source evidence."""
    stream, sources, source_actors = _source_stream(localization)
    output = []
    logical_lines = _logical_lines(text)
    frame_text = "".join(normalize(line) for line in logical_lines)
    frame_offset = 0
    # Localization supplies warning-only name hints for NPCs outside the
    # catalog. A bare GLM name still cannot receive a side without actor parsing.
    observed_names = {actor["name"] for actor in source_actors
                      if NAME_RE.fullmatch(actor["name"])}
    warning_names = names | observed_names
    name_pattern = re.compile("|".join(map(re.escape, sorted(warning_names, key=lambda n: (-len(n), n))))) if warning_names else None
    for line in logical_lines:
        tokens = [_name_evidence(line, m, stream, sources, source_actors, image, names, frame_text, frame_offset)
                  for m in ACTOR_RE.finditer(line)]
        frame_offset += len(normalize(line))
        unparsed = [{"name": t["name"], "span": t["span"], "reason": t["reason"]}
                    for t in tokens if t["reason"] == "unparseable_actor"]
        if name_pattern:
            unparsed.extend({"name": m[0], "span": list(m.span())}
                            for m in name_pattern.finditer(line)
                            if not any(t["span"][0] <= m.start() and m.end() <= t["span"][1] for t in tokens))
        output.append({"untagged_text": line, "tokens": tokens, "unparsed_names": unparsed})
    _reject_shared_sources(output)
    for record in output:
        line = record["untagged_text"]
        tagged, cursor = [], 0
        for token in record["tokens"]:
            start, end = token["span"]
            tagged.extend([line[cursor:start], f"[{token['side'] or '待核'}:{token['name']}]"])
            cursor = end
        tagged.append(line[cursor:])
        record["text"] = "".join(tagged)
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

    Unambiguous multi-line overlaps collapse, but real repeated events within
    a frame remain. When no unique multi-line overlap is verified, preserve both
    frames and report the boundary instead of deleting plausible events.
    """
    result: list[str] = []
    previous: list[str] = []
    boundaries = []
    for index, incoming in enumerate(frames):
        if not incoming:
            boundaries.append({"frame_index": index, "reason": "empty_frame"})
            previous = []
            continue
        if not result:
            result = list(incoming)
            previous = list(incoming)
            continue
        overlaps = [size for size in range(1, min(len(previous), len(incoming)) + 1)
                    if all(_compatible(a, b) for a, b in zip(previous[-size:], incoming[:size]))]
        if len(overlaps) == 1 and overlaps[0] >= 2:
            overlap = overlaps[0]
            result[-overlap:] = [_merge_evidence(a, b) for a, b in zip(result[-overlap:], incoming[:overlap])]
            result.extend(incoming[overlap:])
        else:
            boundaries.append({"frame_index": index,
                               "reason": "ambiguous_overlap" if len(overlaps) > 1 else "unverified_overlap",
                               "candidate_overlaps": overlaps})
            result.extend(incoming)
        previous = result[-len(incoming):]
    return result, boundaries
