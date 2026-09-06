#!/usr/bin/env python3
"""OCR scrolling battle-log screenshots under battles/<id>/images.

The screenshots are a single battle's 战报详情 (detail) view, captured while
scrolling, so consecutive images overlap heavily. This script:

  1. Crops out the top nav (我方/敌方 tab) + left round-marker nav + bottom nav,
     keeping only the main log panel.
  2. Runs PaddleOCR (Chinese) on the panel and retains each raw line, score, and
     whole-line detection box in the v2 cache.
  3. Conservatively samples each bracketed name's approximate text region for
     blue (我方) or red (敌方) evidence, leaving weak or mixed evidence unknown.
  4. Cross-references hero / skill / formation / bond names against
     web/public/game-data/database.json and records any canonical correction.
  5. Stitches all images into one de-duplicated, ordered battle log while
     recording observation and transformation lineage in a provenance sidecar.

Run with (single battle, auto-detected):
    uv run python study-battle-report/ocr_battle_log.py
Or target a specific battle by id/label:
    uv run python study-battle-report/ocr_battle_log.py <battle_id_or_label>
List known battles:
    uv run python study-battle-report/ocr_battle_log.py --list

Multi-battle layout (each battle is self-contained):
    study-battle-report/battles/<id>/
        images/                        # battle_detail_*.png screenshots
        battle_log.txt                 # stitched, side-tagged log (output)
        .ocr_cache.json                # per-image OCR cache (regenerable)
        battle_log.provenance.json     # stitch/source lineage (regenerable)
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import glob
import json
import os
import re
import sys
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from paddleocr import PaddleOCR

# --------------------------------------------------------------------------- #
# Paths / config
# --------------------------------------------------------------------------- #
HERE = os.path.dirname(os.path.abspath(__file__))
BATTLES_DIR = os.path.join(HERE, "battles")
DATABASE_PATH = os.path.join(HERE, "..", "web", "public", "game-data", "database.json")

# Per-battle file names (under battles/<id>/).
IMAGES_SUBDIR = "images"
LOG_NAME = "battle_log.txt"
CACHE_NAME = ".ocr_cache.json"
PROVENANCE_NAME = "battle_log.provenance.json"
OCR_CACHE_SCHEMA_V2 = "sanmou-ocr-cache-v2"
PROVENANCE_SCHEMA_V2 = "sanmou-battle-log-provenance-v2"
TOKEN_COLOR_METHOD = "proportional-text-box-v1"
TOKEN_COLOR_MIN_PIXELS = 15
TOKEN_COLOR_MIN_MARGIN = 6
TOKEN_COLOR_DOMINANCE = 0.75


class BattlePaths:
    """Resolved filesystem paths for a single battle report."""

    def __init__(self, battle_id: str) -> None:
        self.id = battle_id
        self.root = os.path.join(BATTLES_DIR, battle_id)
        self.images_dir = os.path.join(self.root, IMAGES_SUBDIR)
        self.log = os.path.join(self.root, LOG_NAME)
        self.cache = os.path.join(self.root, CACHE_NAME)
        self.provenance = os.path.join(self.root, PROVENANCE_NAME)


def list_battles() -> List[str]:
    """Return battle ids (subdir names under battles/) that contain images."""
    if not os.path.isdir(BATTLES_DIR):
        return []
    out = []
    for name in sorted(os.listdir(BATTLES_DIR)):
        img_dir = os.path.join(BATTLES_DIR, name, IMAGES_SUBDIR)
        if os.path.isdir(img_dir) and glob.glob(
                os.path.join(img_dir, "battle_detail_*.png")):
            out.append(name)
    return out


def resolve_battle(arg: Optional[str]) -> BattlePaths:
    """Resolve a battle id/label to BattlePaths.

    - If `arg` is given, it must name an existing battles/<arg>/ dir.
    - If omitted and exactly one battle exists, use it.
    - If omitted and several exist, error and list them.
    """
    battles = list_battles()
    if arg:
        if arg not in battles and not os.path.isdir(
                os.path.join(BATTLES_DIR, arg, IMAGES_SUBDIR)):
            raise SystemExit(
                f"No battle '{arg}' under {BATTLES_DIR}. "
                f"Known: {battles or '(none)'}")
        return BattlePaths(arg)
    if len(battles) == 1:
        return BattlePaths(battles[0])
    if not battles:
        raise SystemExit(
            f"No battles found under {BATTLES_DIR}. Create "
            f"battles/<id>/images/ and add battle_detail_*.png screenshots.")
    raise SystemExit(
        "Multiple battles found; specify one by id/label.\n  "
        + "\n  ".join(battles))

# Main-area crop (validated against the 1080x2340 screenshots).
#   - top tab 我方/敌方 occupies y ~179-261
#   - left round-marker nav is x < ~190
#   - bottom nav (战果/统计/详情/图表 + 返回) is y > ~2120
CROP_TOP = 275
CROP_BOTTOM = 2120
CROP_LEFT = 195
CROP_RIGHT = 1060

# Fuzzy-match threshold for snapping OCR tokens to DB canonical names.
NAME_MATCH_THRESHOLD = 0.6

# Bracket pairs used in the game log.
BRACKET_PAIRS = [("[", "]"), ("【", "】"), ("「", "」")]


# --------------------------------------------------------------------------- #
# Database (for cross-reference / OCR correction)
# --------------------------------------------------------------------------- #
def load_database(path: str) -> Dict[str, List[str]]:
    """Load canonical name lists from web/public/game-data/database.json.

    Returns a dict with keys: heroes, skills, formations, bonds. Hero keys in
    the DB sometimes carry a trailing disambiguation digit (e.g. "孙坚2"); the
    in-game log shows the bare name, so we strip the trailing digits.
    """
    with open(path, "r", encoding="utf-8") as f:
        db = json.load(f)

    def clean_hero(name: str) -> str:
        return re.sub(r"\d+$", "", name)

    heroes = sorted({clean_hero(k) for k in db.get("heroes", {})})
    skills = sorted(db.get("skills", {}).keys())
    formations = sorted(db.get("formations", {}).keys())
    bonds = sorted(db.get("bonds", {}).keys())
    return {
        "heroes": heroes,
        "skills": skills,
        "formations": formations,
        "bonds": bonds,
    }


def best_match(token: str, candidates: List[str], threshold: float) -> Optional[str]:
    """Return the closest canonical candidate to *token*, or None.

    Exact match wins immediately. Otherwise the highest-ratio candidate above
    *threshold* is returned. Equal-length comparisons are favoured to avoid
    snapping a short OCR fragment onto a long unrelated name.
    """
    if not token:
        return None
    if token in candidates:
        return token

    best, best_score = None, 0.0
    for cand in candidates:
        score = SequenceMatcher(None, token, cand).ratio()
        # Light length-similarity bonus to prefer same-length names.
        len_pen = 1.0 - abs(len(token) - len(cand)) / max(len(token), len(cand))
        score = 0.85 * score + 0.15 * len_pen
        if score > best_score:
            best, best_score = cand, score
    return best if best_score >= threshold else None


# --------------------------------------------------------------------------- #
# Colour classification (blue = 我方 / red = 敌方)
# --------------------------------------------------------------------------- #
def _color_masks(region_bgr: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    hsv = cv2.cvtColor(region_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    blue = (h > 95) & (h < 130) & (s > 80) & (v > 120)
    red = ((h < 10) | (h > 170)) & (s > 80) & (v > 120)
    return blue, red


def classify_color(crop_bgr: np.ndarray, box: np.ndarray) -> Optional[str]:
    """Classify the side (我方/敌方) of a log line by the colour of its name.

    The owner's name (in [..]) sits at the LEFT of every line and is the only
    blue/red coloured token; the rest of the line is white/yellow/green.

    PaddleOCR detection boxes for the dim top rows can be vertically offset
    from the actual glyphs, so we don't trust the box band directly. Instead we
    scan a generous vertical window over the LEFT portion of the line, compute a
    per-row coloured-pixel signal, then keep only the contiguous coloured
    segment whose centre is nearest the box centre. This isolates the line's own
    name from neighbouring rows' colours and classifies just that segment.

    Returns "我方" (blue), "敌方" (red), or None.
    """
    xs = box[:, 0]
    ys = box[:, 1]
    x0, x1 = int(max(0, xs.min())), int(min(crop_bgr.shape[1], xs.max()))
    y0, y1 = int(max(0, ys.min())), int(min(crop_bgr.shape[0], ys.max()))
    if x1 <= x0 or y1 <= y0:
        return None

    width = x1 - x0
    box_h = y1 - y0
    # Empirically, PaddleOCR boxes for this game's font sit ABOVE the actual
    # coloured glyphs by roughly one box-height; the glyph row aligns with the
    # box's lower edge. Target the colour search just below the box bottom.
    target_cy = y1 + box_h * 0.3

    # Left name region, with a generous vertical window to absorb box offset.
    xe = x0 + max(1, int(width * 0.40))
    wy0 = max(0, y0 - int(box_h * 0.3))
    wy1 = min(crop_bgr.shape[0], y1 + int(box_h * 1.1))
    region = crop_bgr[wy0:wy1, x0:xe]
    if region.size == 0:
        return None

    blue_m, red_m = _color_masks(region)
    row_blue = blue_m.sum(axis=1)
    row_red = red_m.sum(axis=1)
    row_total = row_blue + row_red

    active = row_total > 2  # rows that contain coloured glyph pixels
    if not active.any():
        return None

    # Split active rows into contiguous segments; pick the one closest to the
    # box centre (i.e. this line's own name, not a neighbour's).
    segments: List[Tuple[int, int]] = []
    start = None
    for i, a in enumerate(active):
        if a and start is None:
            start = i
        elif not a and start is not None:
            segments.append((start, i))
            start = None
    if start is not None:
        segments.append((start, len(active)))

    def seg_center(seg: Tuple[int, int]) -> float:
        return wy0 + (seg[0] + seg[1]) / 2.0

    best = min(segments, key=lambda seg: abs(seg_center(seg) - target_cy))
    b = int(row_blue[best[0]:best[1]].sum())
    r = int(row_red[best[0]:best[1]].sum())
    if max(b, r) < 15:
        return None
    return "我方" if b >= r else "敌方"


def _serialise_box(box: np.ndarray) -> Optional[List[List[float]]]:
    if not box.size or box.shape != (4, 2):
        return None
    return [[round(float(value), 3) for value in point] for point in box.tolist()]


def sample_name_token_sides(
        text: str, box: np.ndarray, crop_bgr: np.ndarray,
        evidence_frame: Optional[str] = None) -> List[dict]:
    """Return conservative side evidence for each untagged ``[name]`` token.

    PaddleOCR provides a box for the whole line, not individual glyphs. Token
    regions are therefore proportional approximations from character spans. The
    evidence records that calibration limit and leaves low-pixel or mixed-colour
    regions unresolved instead of borrowing another token's side.
    """
    token_re = re.compile(r"\[([^\[\]:]{1,8})\]")
    matches = list(token_re.finditer(text))
    if not matches:
        return []
    if not box.size or box.shape != (4, 2) or crop_bgr.size == 0:
        return [
            {
                "token_index": index,
                "token_text": match.group(1),
                "span": [match.start(), match.end()],
                "decision": None,
                "confidence_status": "unavailable_geometry",
                "blue_pixels": 0,
                "red_pixels": 0,
                "dominance": None,
                "sample_region": None,
                "evidence_frame": evidence_frame,
                "method": TOKEN_COLOR_METHOD,
                "token_box_is_approximate": True,
            }
            for index, match in enumerate(matches)
        ]

    xs = box[:, 0]
    ys = box[:, 1]
    line_x0 = max(0, int(np.floor(xs.min())))
    line_x1 = min(crop_bgr.shape[1], int(np.ceil(xs.max())))
    line_y0 = max(0, int(np.floor(ys.min())))
    line_y1 = min(crop_bgr.shape[0], int(np.ceil(ys.max())))
    width = max(1, line_x1 - line_x0)
    height = max(1, line_y1 - line_y0)
    sample_y0 = max(0, line_y0 - int(height * 0.3))
    sample_y1 = min(crop_bgr.shape[0], line_y1 + int(height * 1.1))
    char_count = max(1, len(text))
    evidence: List[dict] = []
    for index, match in enumerate(matches):
        sample_x0 = max(
            0, line_x0 + int(width * match.start() / char_count)
        )
        sample_x1 = min(
            crop_bgr.shape[1],
            line_x0 + max(1, int(np.ceil(width * match.end() / char_count))),
        )
        region = crop_bgr[sample_y0:sample_y1, sample_x0:sample_x1]
        if region.size:
            blue_mask, red_mask = _color_masks(region)
            blue_pixels = int(blue_mask.sum())
            red_pixels = int(red_mask.sum())
        else:
            blue_pixels = red_pixels = 0
        coloured = blue_pixels + red_pixels
        dominance = max(blue_pixels, red_pixels) / coloured if coloured else None
        if coloured < TOKEN_COLOR_MIN_PIXELS:
            decision = None
            confidence_status = "insufficient_pixels"
        elif (
                abs(blue_pixels - red_pixels) < TOKEN_COLOR_MIN_MARGIN
                or dominance is None
                or dominance < TOKEN_COLOR_DOMINANCE):
            decision = None
            confidence_status = "ambiguous_colour"
        else:
            decision = "我方" if blue_pixels > red_pixels else "敌方"
            confidence_status = "strong_approximate"
        evidence.append(
            {
                "token_index": index,
                "token_text": match.group(1),
                "span": [match.start(), match.end()],
                "decision": decision,
                "confidence_status": confidence_status,
                "blue_pixels": blue_pixels,
                "red_pixels": red_pixels,
                "dominance": round(dominance, 6) if dominance is not None else None,
                "sample_region": [sample_x0, sample_y0, sample_x1, sample_y1],
                "evidence_frame": evidence_frame,
                "method": TOKEN_COLOR_METHOD,
                "token_box_is_approximate": True,
            }
        )
    return evidence


def tag_name_tokens(text: str, token_evidence: List[dict]) -> str:
    decisions = {tuple(item["span"]): item["decision"] for item in token_evidence}
    token_re = re.compile(r"\[([^\[\]:]{1,8})\]")
    parts: List[str] = []
    cursor = 0
    for match in token_re.finditer(text):
        parts.append(text[cursor:match.start()])
        side = decisions.get((match.start(), match.end()))
        parts.append(f"[{side}:{match.group(1)}]" if side else match.group(0))
        cursor = match.end()
    parts.append(text[cursor:])
    return "".join(parts)


def process_observation(
        raw_text: str, box: np.ndarray, score: float, crop_bgr: np.ndarray,
        db: Dict[str, List[str]], observation_id: str,
        evidence_frame: Optional[str] = None) -> dict:
    corrected = correct_brackets(raw_text, db)
    token_evidence = sample_name_token_sides(
        corrected, box, crop_bgr, evidence_frame=evidence_frame
    )
    processed = tag_name_tokens(corrected, token_evidence)
    return {
        "observation_id": observation_id,
        "raw_text": raw_text,
        "processed_text": processed,
        "bbox": _serialise_box(box),
        "score": float(score),
        "name_tokens": token_evidence,
        "provenance_status": "complete_observation_v2",
        "reused_from_observation_id": None,
        "processing": {
            "canonical_correction_applied": corrected != raw_text,
            "token_side_method": TOKEN_COLOR_METHOD,
            "token_side_geometry": "approximate_from_line_box",
        },
    }


# --------------------------------------------------------------------------- #
# OCR
# --------------------------------------------------------------------------- #
def build_ocr() -> PaddleOCR:
    """Initialise a Chinese PaddleOCR instance tuned for the log panel."""
    return PaddleOCR(lang="ch", use_textline_orientation=False)


def crop_main_area(image_bgr: np.ndarray) -> np.ndarray:
    return image_bgr[CROP_TOP:CROP_BOTTOM, CROP_LEFT:CROP_RIGHT]


def dhash(crop_bgr: np.ndarray, hash_size: int = 16) -> int:
    """Perceptual difference-hash of the cropped panel.

    Robust to the tiny pixel jitter (cursor blink / anti-aliasing) that makes
    otherwise-identical end-of-battle screenshots byte-different, so we can skip
    OCR on near-duplicate consecutive frames.
    """
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    diff = resized[:, 1:] > resized[:, :-1]
    bits = 0
    for b in diff.flatten():
        bits = (bits << 1) | int(b)
    return bits


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


# Two cropped panels with a dHash Hamming distance <= this are treated as the
# same frame (OCR skipped). 16x16 dHash => 256 bits; a handful of differing
# bits is just rendering noise.
DHASH_DUP_THRESHOLD = 6

# Per-line OCR recognition confidence below which a line is a *candidate* for
# being dropped — but only when it ALSO looks like noise (see drop_low_conf).
# PaddleOCR scores are 0..1; genuine game-log lines usually score > 0.9.
LOW_CONF_THRESHOLD = 0.80
# Below this, even a short low-CJK line is almost certainly pure garbage and is
# dropped outright regardless of content.
JUNK_CONF_THRESHOLD = 0.55


def ocr_lines(ocr: PaddleOCR, crop_bgr: np.ndarray) -> List[Tuple[str, np.ndarray, float]]:
    """Run OCR and return (text, box, score) tuples sorted top-to-bottom."""
    result = ocr.predict(crop_bgr)
    if not result:
        return []
    res = result[0]
    texts = res.get("rec_texts", [])
    scores = res.get("rec_scores", [])
    polys = res.get("rec_polys", res.get("dt_polys", []))

    lines: List[Tuple[str, np.ndarray, float]] = []
    for i, text in enumerate(texts):
        if not text or not text.strip():
            continue
        box = np.array(polys[i], dtype=np.float32) if i < len(polys) else np.zeros((4, 2))
        score = scores[i] if i < len(scores) else 0.0
        lines.append((text.strip(), box, score))

    # Sort by vertical centre (then horizontal) for reading order.
    lines.sort(key=lambda t: (t[1][:, 1].mean() if t[1].size else 0.0,
                              t[1][:, 0].mean() if t[1].size else 0.0))
    return lines


# --------------------------------------------------------------------------- #
# Text correction + side tagging
# --------------------------------------------------------------------------- #
def repair_brackets(text: str, db: Dict[str, List[str]]) -> str:
    """Repair name brackets where OCR dropped one side.

    Handles two common failures:
      * "[袁绍的..."  (missing closing ])  -> "[袁绍]的..."
      * "袁绍]的..."  (missing opening [) at line start -> "[袁绍]的..."
    Only fires when the candidate inner text matches a known hero name, so it
    will not corrupt unrelated text.
    """
    heroes = db["heroes"]

    # Spurious leading bracket: OCR sometimes prepends a stray 【 or [ before a
    # well-formed [name] bracket at line start (e.g. "【[我方:诸葛亮]队..." or
    # "[[袁绍]的..."). Strip the orphan opener when it directly precedes the
    # real "[" that opens the name. Conservative: only fires at line start and
    # only when the inner bracket is immediately adjacent.
    text = re.sub(r"^[【\[]\s*(?=\[)", "", text)

    # Missing closing ]: "[" + hero + (action keyword | skill bracket).
    def fix_open(m: re.Match) -> str:
        inner, tail = m.group(1), m.group(2)
        match = best_match(inner, heroes, NAME_MATCH_THRESHOLD)
        return f"[{match}]{tail}" if match else m.group(0)

    text = re.sub(
        r"\[([^\[\]【】「」]{1,5}?)(的|队|对|损失|恢复|执行|发动|消耗|由于|【|「)",
        fix_open, text)

    # Missing opening [ at start of line: hero + "]" + tail
    def fix_close(m: re.Match) -> str:
        inner = m.group(1)
        match = best_match(inner, heroes, NAME_MATCH_THRESHOLD)
        return f"[{match}]" if match else m.group(0)

    text = re.sub(r"^([^\[\]【】「」]{1,5}?)\]", fix_close, text)

    # Mismatched name bracket: OCR read the opening "[" of a name as a full-width
    # "【" but kept the correct "]" closer, e.g. "【袁术]损失了..." -> "[袁术]损失了...".
    # Only fires at line start and only when the inner text fuzzy-matches a known
    # hero, so legitimate "【skill】" tokens (which close with 】, not ]) are safe.
    def fix_wrong_open(m: re.Match) -> str:
        inner = m.group(1)
        match = best_match(inner, heroes, NAME_MATCH_THRESHOLD)
        return f"[{match}]" if match else m.group(0)

    text = re.sub(r"^【([^\[\]【】「」]{1,5}?)\]", fix_wrong_open, text)
    return text


def correct_brackets(text: str, db: Dict[str, List[str]]) -> str:
    """Snap bracketed tokens to canonical DB names.

    - [name]  -> matched against heroes
    - 【x】    -> matched against skills + formations + bonds
    - 「x」    -> matched against skills + formations + bonds
    """
    text = repair_brackets(text, db)
    skill_like = db["skills"] + db["formations"] + db["bonds"]

    def repl_square(m: re.Match) -> str:
        inner = m.group(1)
        match = best_match(inner, db["heroes"], NAME_MATCH_THRESHOLD)
        return f"[{match}]" if match else m.group(0)

    def repl_skill(open_b: str, close_b: str):
        def _r(m: re.Match) -> str:
            inner = m.group(1)
            match = best_match(inner, skill_like, NAME_MATCH_THRESHOLD)
            return f"{open_b}{match}{close_b}" if match else m.group(0)
        return _r

    text = re.sub(r"\[([^\[\]]{1,8})\]", repl_square, text)
    text = re.sub(r"【([^【】]{1,10})】", repl_skill("【", "】"), text)
    text = re.sub(r"「([^「」]{1,10})」", repl_skill("「", "」"), text)
    return text


def tag_sides(text: str, side: Optional[str]) -> str:
    """Inject side tag into the first [name] bracket of a line.

    Names in a single OCR line nearly always share one colour (the row's
    owner), so we tag every [name] in the line with the detected side.
    """
    if not side:
        return text
    return re.sub(r"\[([^\[\]]+)\]", lambda m: f"[{side}:{m.group(1)}]", text)


def process_line(text: str, box: np.ndarray, crop_bgr: np.ndarray,
                 db: Dict[str, List[str]]) -> str:
    return process_observation(
        text, box, 1.0, crop_bgr, db, "compatibility-call"
    )["processed_text"]


def drop_low_conf(text: str, score: float) -> bool:
    """Decide whether to drop a line based on OCR confidence + content.

    Strategy (conservative — never drop confident or content-rich lines):
      * score >= LOW_CONF_THRESHOLD  -> keep (trusted recognition).
      * score <  JUNK_CONF_THRESHOLD -> drop (almost certainly noise), unless
        the line carries real structure (>= 4 CJK chars or a bracket), which we
        keep so a slightly-garbled real entry survives for fragment merging.
      * in between -> drop only if the line ALSO looks like noise per
        is_garbage() (short, low-CJK) or has < 2 CJK chars.
    """
    s = text.strip()
    if not s:
        return True
    if score >= LOW_CONF_THRESHOLD:
        return False

    has_structure = _cjk_count(s) >= 4 or "[" in s or "【" in s or "「" in s
    if score < JUNK_CONF_THRESHOLD:
        return not has_structure
    # Mid-confidence: drop only obvious noise.
    if has_structure:
        return False
    return is_garbage(s) or _cjk_count(s) < 2


# --------------------------------------------------------------------------- #
# Stitching / dedup across overlapping screenshots
# --------------------------------------------------------------------------- #
def _norm(line: str) -> str:
    """Normalise a line for overlap comparison.

    Strips side tags, whitespace and trailing parenthesised running totals so
    that small OCR variations in the numbers don't defeat the overlap match.
    """
    line = re.sub(r"\[[^:\]]+:", "[", line)  # drop side prefix
    line = re.sub(r"\s+", "", line)
    # Fold full/half-width punctuation + unify bracket variants so trivially
    # different OCR renderings of the same line collapse together.
    trans = {
        "！": "!", "（": "(", "）": ")", "，": ",", "：": ":", "％": "%",
        "【": "[", "】": "]", "「": "[", "」": "]", "『": "[", "』": "]",
    }
    line = line.translate(str.maketrans(trans))
    return line


def _similar(a: str, b: str, threshold: float = 0.86) -> bool:
    """Fuzzy line-equality tolerant of OCR noise."""
    if a == b:
        return True
    if not a or not b:
        return False
    # Quick length gate, then ratio.
    if abs(len(a) - len(b)) > max(3, 0.35 * max(len(a), len(b))):
        return False
    return SequenceMatcher(None, a, b).ratio() >= threshold


def stitch(accumulated: List[str], new_lines: List[str],
           window: int = 45) -> List[str]:
    """Merge a new screenshot's lines into the running log, dropping overlap.

    Consecutive scroll captures overlap heavily, but OCR splits/wraps lines
    inconsistently between frames, so a positional suffix==prefix match is
    unreliable. Instead we keep a rolling *window* of the most recently kept
    normalised lines and drop any incoming line that fuzzy-matches something
    already in that window. Kept lines are pushed onto the window too.

    This is robust to OCR jitter and, because the window is bounded, it still
    preserves genuinely repeated events from *different* rounds (e.g. each
    hero's "开始行动" once per round) as long as they are more than *window*
    lines apart — which they always are in practice.
    """
    if not accumulated:
        return list(new_lines)
    if not new_lines:
        return accumulated

    out = list(accumulated)
    window_lines = [_norm(l) for l in accumulated[-window:]]

    for line in new_lines:
        norm = _norm(line)
        if not norm:
            continue
        if any(_similar(norm, w) for w in window_lines):
            continue
        out.append(line)
        window_lines.append(norm)
        if len(window_lines) > window:
            window_lines = window_lines[-window:]
    return out


# --------------------------------------------------------------------------- #
# Fragment merging (rejoin OCR-split log entries)
# --------------------------------------------------------------------------- #
# A line ending in one of these "dangling" tokens is an entry wrapped by the
# game UI onto the next visual line; the continuation should be joined back.
_DANGLING_SUFFIXES = (
    "损失了", "恢复了", "由于", "来自", "此次伤害减少", "效果治疗效果降",
)
# Cause-line endings (e.g. "...的「效果」效果，") whose damage tail wrapped onto
# the next line as "损失了兵力NNN(总)". Only merge the FIRST such continuation.
_CAUSE_SUFFIXES = ("效果,", "效果，")
# A continuation fragment typically begins with one of these.
_CONT_PREFIXES = ("兵力", "为30%", "为50%")
# Damage-tail continuation fragments (a wrapped "损失了兵力NNN(总)").
_DMG_CONT_RE = re.compile(r"^[，,]?(?:损?失了|了)?兵[力兴]\s*\d")

# Terminal / standalone lines that must never be glued onto a previous entry.
_TERMINAL_TOKENS = ("平局", "胜利", "失败", "战斗结束", "第")

# A nameless action fragment: a log entry whose leading [name] was OCR'd onto a
# *separate* line (it appears right after this one). Detect the verb-led body.
_NAMELESS_ACTION_RE = re.compile(
    r"^(?:执行来自|发动战法|开始行动|对\[|的[【「]|损失了|恢复了|消耗|由于|因几率)"
)


def normalize_name_line(line: str, heroes: Optional[List[str]] = None) -> str:
    """Fix half/mismatched name brackets and bare hero-name lines to "[name]".

    Handles: "【袁绍]", "[袁绍】", "【袁绍", "袁绍】", and a line that is just a
    bare hero name ("诸葛亮"). Only rewrites when the inner text matches a known
    hero (when *heroes* is provided) or is a short 2-4 char CJK token.
    """
    s = line.strip()
    m = re.fullmatch(r"[【\[]?([\u4e00-\u9fa5]{2,4})[】\]]?", s)
    if not m:
        return line
    inner = m.group(1)
    # Don't touch obvious non-name standalone words.
    if inner in ("判断结果", "行动顺序", "判断完毕"):
        return line
    if heroes is not None:
        match = best_match(inner, heroes, NAME_MATCH_THRESHOLD)
        if match:
            return f"[{match}]"
        return line
    return f"[{inner}]"


def _is_bare_name(line: str) -> bool:
    """True if the line is only a [name] token (optionally side-tagged)."""
    return bool(re.fullmatch(r"\[(?:我方|敌方):[^\[\]]+\]", line.strip())) or \
        bool(re.fullmatch(r"\[[^\[\]]+\]", line.strip()))


def _is_terminal(line: str) -> bool:
    s = line.strip()
    return s.startswith(_TERMINAL_TOKENS)


def _cjk_count(s: str) -> int:
    return sum(1 for c in s if "\u4e00" <= c <= "\u9fa5")


def is_garbage(line: str) -> bool:
    """True for pure OCR-noise lines safe to drop from the final log.

    Conservative: only flags short lines that carry no real Chinese content —
    lone symbols/letters ("V", "AT", "÷", "4T1") and orphan number tails
    ("(9414)", "71)", "458)") that lost their parent entry. Anything with even
    a couple of CJK characters, or any recognisable log keyword, is kept.
    """
    s = line.strip()
    if not s:
        return True
    if _cjk_count(s) >= 2:
        return False
    # No/▏one CJK char: keep only if it's clearly meaningful, else drop short.
    if len(s) <= 6 and re.fullmatch(r"[\dA-Za-z（）()，,。.%·:：、＋\-+\s\u00b7\u00f7]+"
                                    r"|[A-Za-z0-9]{1,4}", s):
        return True
    # Single stray CJK char alone (e.g. "的", "上") is noise.
    if len(s) <= 1:
        return True
    return False


def merge_fragments(lines: List[str],
                    heroes: Optional[List[str]] = None) -> List[str]:
    """Best-effort rejoin of OCR-split battle-log entries.

    Conservative heuristics only:
      * half/mismatched name brackets and bare hero names are normalised first;
      * a bare "[name]" line is merged with the following line (its action),
        including the reversed (name-after-action) OCR ordering;
      * a line ending in a dangling connector is merged with the next line;
      * a short continuation fragment (no leading name) is appended to the
        previous line when that line looks incomplete.
    """
    if heroes is not None:
        hero_alt = "|".join(sorted(map(re.escape, heroes), key=len, reverse=True))
        # Action verbs that mark the start of a log entry's body. Used to detect
        # an entry whose leading "[name]" lost BOTH brackets in OCR.
        verb_re = (r"(?:执行来自|开始行动|发动|对\[|由于|损失了|恢复了|成功规避|"
                   r"消耗|因几率|为\[|的[【「]|的【)")

        def _fix_inline(l: str) -> str:
            # Spurious leading bracket before a well-formed name bracket, e.g.
            # "【[我方:诸葛亮]队..." / "[[袁绍]的...". Runs here too (not just in
            # repair_brackets) so it also cleans already-tagged cached lines on
            # a --use-cache re-stitch. Conservative: line start, adjacent only.
            l = re.sub(r"^[【\[]\s*(?=\[)", "", l)
            # "[袁绍】" -> "[袁绍]"
            l = re.sub(r"\[([\u4e00-\u9fa5]{2,4})】", r"[\1]", l)
            # "[袁绍【合聚群雄】" -> "[袁绍]【合聚群雄】" (missing ] before skill).
            l = re.sub(r"\[([\u4e00-\u9fa5]{2,4})(【|「)", r"[\1]\2", l)
            # "袁术〕的..." (wrong closing bracket, no opening) -> "[袁术]的..."
            l = re.sub(rf"^({hero_alt})〕", r"[\1]", l)
            # "【袁术]损失了..." (opening "[" misread as full-width 【, correct ]
            # closer) -> "[袁术]损失了...". Anchored to a known hero + "]" so the
            # legitimate "【skill】" tokens (which close with 】) are never hit.
            l = re.sub(rf"^【({hero_alt})\]", r"[\1]", l)
            # Bare hero name + action verb, brackets fully lost ->
            # "袁术执行来自..." => "[袁术]执行来自...". Only when the head is an
            # exact known hero immediately followed by a recognised verb, so we
            # never corrupt continuation fragments.
            l = re.sub(rf"^({hero_alt})(?={verb_re})", r"[\1]", l)
            # OCR reads the digit 0 as letter O/o inside 兵力 amounts, e.g.
            # "恢复了兵力O(9953)" -> "恢复了兵力0(9953)".
            l = re.sub(r"(兵[力兴])[Oo](?=[（(])", r"\g<1>0", l)
            l = re.sub(r"([（(])([Oo])([）)])", r"\g<1>0\g<3>", l)
            return l
        lines = [normalize_name_line(_fix_inline(l), heroes) for l in lines]

    out: List[str] = []
    i = 0
    n = len(lines)
    while i < n:
        cur = lines[i].strip()
        if not cur:
            i += 1
            continue

        nxt = lines[i + 1].strip() if i + 1 < n else None
        nxt2 = lines[i + 2].strip() if i + 2 < n else None
        nxt3 = lines[i + 3].strip() if i + 3 < n else None

        # Case 0a: 4-line 普通攻击 split: "[A]" / "对" / "[B]" / "发动普通攻击".
        if _is_bare_name(cur) and nxt == "对" and nxt2 is not None \
                and _is_bare_name(nxt2) and nxt3 is not None \
                and nxt3.startswith("发动"):
            out.append(f"{cur}对{nxt2}{nxt3}")
            i += 4
            continue

        # Case 0b: 2-line 普通攻击 split: "[A]对[B]" / "发动普通攻击".
        if re.match(r"^\[[^\]]+\]对\[[^\]]+\]$", cur) and nxt is not None \
                and nxt.startswith("发动"):
            out.append(cur + nxt)
            i += 2
            continue

        # Case 0c: drop a stray bare-name line that merely repeats the name of
        # the immediately preceding or following entry (OCR duplicated it).
        if _is_bare_name(cur):
            bare = re.sub(r"\[(?:我方|敌方):", "[", cur)
            inner = bare.strip("[]")
            prev_has = out and inner in out[-1]
            next_has = nxt is not None and nxt.startswith("[") and inner in nxt
            if (prev_has or next_has) and not (
                    nxt is not None and _NAMELESS_ACTION_RE.match(nxt)
                    and not nxt.startswith("[")):
                i += 1
                continue

        # Case 1: bare name on its own line.
        if _is_bare_name(cur) and nxt is not None:
            # 1a) Forward split: "[name]" then its action -> "[name]action".
            if not nxt.startswith("[") and not _is_terminal(nxt) \
                    and _NAMELESS_ACTION_RE.match(nxt):
                out.append(cur + nxt)
                i += 2
                continue
            # 1b) Reversed split: a nameless action line was emitted BEFORE the
            #     name (OCR/sort quirk). Back-patch the previous output line.
            if out and _NAMELESS_ACTION_RE.match(_norm(out[-1])) \
                    and not out[-1].startswith("["):
                out[-1] = cur + out[-1]
                i += 1
                continue

        # Case 2: a nameless action line whose name is on the NEXT line.
        if _NAMELESS_ACTION_RE.match(cur) and not cur.startswith("[") \
                and nxt is not None and _is_bare_name(nxt):
            out.append(nxt + cur)
            i += 2
            continue

        # Case 2b: damage-tail continuation. A previous output line that ends in
        # an incomplete "损失"/"损" (the verb wrapped) is completed by a
        # "了兵力NNN(总)" / "失了兵力NNN" / "兵力NNN" fragment on this line.
        if out and _DMG_CONT_RE.match(cur) and out[-1].rstrip().endswith(("损失", "损")):
            out[-1] = out[-1].rstrip() + re.sub(r"^[，,]", "", cur)
            i += 1
            continue

        # Case 2c: cause line ("...效果，") whose damage tail wrapped to the next
        # line as a full "损失了兵力NNN". Only merge when the tail is clearly a
        # damage fragment (avoids gluing unrelated standalone events).
        if out and out[-1].rstrip().endswith(_CAUSE_SUFFIXES) \
                and _DMG_CONT_RE.match(cur):
            out[-1] = out[-1].rstrip() + cur
            i += 1
            continue

        # Case 2d: "降为NN%" tail of a "...治疗效果降为NN%" line that wrapped.
        # Only merge when the previous line clearly ends mid-phrase ("效果降" /
        # "治疗效果"), so we don't append it to an unrelated entry.
        if out and re.match(r"^降为\d", cur) \
                and out[-1].rstrip().endswith(("效果降", "治疗效果", "效果治疗效果")):
            out[-1] = out[-1].rstrip() + cur
            i += 1
            continue

        # Case 2e: 3-piece 治疗-reduction wrap. A cause line ending in
        # "由于[name]" (the skill/effect middle was dropped) followed by a bare
        # "降为NN%" -> join them into one readable cause line.
        if out and re.match(r"^降为\d", cur) \
                and re.search(r"由于\[[^\]]+\]$", out[-1].rstrip()):
            out[-1] = out[-1].rstrip() + "治疗效果" + cur
            i += 1
            continue

        # Case 2f: reversed 规避 split: "[X]的伤害" then "成功规避" ->
        # "成功规避[X]的伤害".
        if cur == "成功规避" and out and out[-1].rstrip().endswith("的伤害"):
            out[-1] = "成功规避" + out[-1].rstrip()
            i += 1
            continue

        # Case 2g: 普通攻击 tail. A previous line ending in an incomplete attack
        # ("...对" or "...对[B]") followed by a bare "发动普通攻击" -> join.
        if cur.startswith("发动普通攻击") and out \
                and re.search(r"对(\[[^\]]*\]?)?$", out[-1].rstrip()):
            out[-1] = out[-1].rstrip() + cur
            i += 1
            continue

        # Cosmetic: a line that begins with a stray "]" (its "[name" was lost to
        # the previous wrap) — drop the orphan bracket so it reads cleanly.
        if cur.startswith("]"):
            cur = cur[1:].lstrip()
            if not cur:
                i += 1
                continue

        # Case 3: current line ends with a dangling connector -> join next,
        # but never absorb a terminal/standalone line (e.g. "平局！").
        if cur.endswith(_DANGLING_SUFFIXES) and nxt is not None \
                and not _is_bare_name(nxt) and not nxt.startswith("[") \
                and not _is_terminal(nxt):
            out.append(cur + nxt)
            i += 2
            continue

        out.append(cur)
        i += 1

    # Second light pass: pull obvious continuation fragments onto previous line.
    merged: List[str] = []
    for line in out:
        s = line.strip()
        if merged and not s.startswith("[") and not s.startswith("【") \
                and not s.startswith("第") and s.startswith(_CONT_PREFIXES) \
                and len(s) <= 16:
            merged[-1] = merged[-1] + s
        else:
            merged.append(s)

    # Final pass: drop pure OCR-noise lines (lone symbols, orphan number tails).
    return [l for l in merged if not is_garbage(l)]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
# A name receives a heuristic single-side consensus only when its dominant
# colour wins by at least this fraction of tagged occurrences. Per-frame colour
# detection is noisy, so downstream provenance keeps every consensus change
# distinct from direct token-colour evidence. A likely mirror name should sit
# nearer 50/50; the threshold avoids changing balanced evidence while retaining
# strongly one-sided observations.
SIDE_CONSENSUS_THRESHOLD = 0.65


def backfill_sides(lines: List[str]) -> Tuple[List[str], int, int, int]:
    """Normalise side tags from battle-wide colour consensus.

    For a non-mirror hero, a strong majority across tagged occurrences can
    back-fill bare ``[name]`` brackets or correct minority tags. These changes
    are heuristic side inferences: the lineage sidecar records them separately,
    and downstream research must not treat them as direct token-colour identity.

    A name is changed only when one side wins by at least
    ``SIDE_CONSENSUS_THRESHOLD`` or has a conflict-free opening-window anchor.
    Names whose evidence remains balanced are left untouched so likely mirror
    matches are not forced to one side.
    """
    tagged_re = re.compile(r"\[(我方|敌方):([^\[\]]+)\]")
    counts: Dict[str, Dict[str, int]] = {}
    for line in lines:
        for side, name in tagged_re.findall(line):
            counts.setdefault(name, {"我方": 0, "敌方": 0})[side] += 1

    # Heuristic opening-side fallback from the 【判断结果】 buff block. Opening
    # rows tend to render more cleanly than mid-battle scroll captures, so a
    # conflict-free first side can fill an otherwise weak battle-wide consensus.
    # The sidecar still labels every resulting text change as inferred rather
    # than direct token-colour identity. If both sides occur in this opening
    # window, no fallback anchor is retained for that name.
    OPENING_WINDOW = 40
    first_side: Dict[str, str] = {}
    first_conflict: set = set()
    for line in lines[:OPENING_WINDOW]:
        for side, name in tagged_re.findall(line):
            if name in first_side:
                if first_side[name] != side:
                    first_conflict.add(name)
            else:
                first_side[name] = side
    anchor = {n: s for n, s in first_side.items() if n not in first_conflict}

    resolved: Dict[str, str] = {}
    for name, c in counts.items():
        ours, enemy = c["我方"], c["敌方"]
        total = ours + enemy
        if total == 0:
            continue
        major = "我方" if ours >= enemy else "敌方"
        if max(ours, enemy) / total >= SIDE_CONSENSUS_THRESHOLD:
            resolved[name] = major
        elif name in anchor:
            # Consensus is ambiguous but the opening buff block saw this name on
            # a single, unambiguous side — trust that anchor.
            resolved[name] = anchor[name]

    # Skill -> side ownership, learned from lines where a consensus-resolved
    # hero *uses* a skill ("[side:hero]发动战法【skill】" / "...执行来自【skill】").
    # A skill is only kept when it maps to exactly one side (no contradiction).
    skill_owner_re = re.compile(
        r"\[(我方|敌方):([^\[\]]+)\](?:发动战法|执行来自|的)?[【「]([^【】「」]+)[】」]")
    skill_sides: Dict[str, set] = {}
    for line in lines:
        for side, name, skill in skill_owner_re.findall(line):
            if resolved.get(name) == side:  # trust only resolved owners
                skill_sides.setdefault(skill, set()).add(side)
    skill_side = {sk: next(iter(s)) for sk, s in skill_sides.items()
                  if len(s) == 1}

    def _other(side: str) -> str:
        return "敌方" if side == "我方" else "我方"

    filled = 0     # bare [name] -> [side:name]
    corrected = 0  # [wrong:name] -> [consensus:name]
    inferred = 0   # garbled [name] -> [side:name] via skill-side context

    def fix_tagged(m: re.Match) -> str:
        nonlocal corrected
        side, name = m.group(1), m.group(2)
        want = resolved.get(name)
        if want is not None and want != side:
            corrected += 1
            return f"[{want}:{name}]"
        return m.group(0)

    bare_re = re.compile(r"\[([^\[\]:]+)\]")

    def fix_bare(m: re.Match) -> str:
        nonlocal filled
        name = m.group(1)
        side = resolved.get(name)
        if side is None:
            return m.group(0)
        filled += 1
        return f"[{side}:{name}]"

    def infer_garbled_side(line: str) -> str:
        """Side-only inference for a leading garbled (non-roster) name bracket.

        Conservative & deterministic — fires only when a skill on the line maps
        to exactly one consensus side:
          * victim:  "[?]由于…【skill】…(损失|伤害)"  -> opposite of skill's side
          * owner:   "[?]的「skill」效果" / "[?]执行来自【skill】" -> skill's side
        The garbled glyph is preserved; only the side prefix is added. Never
        guesses the hero, never touches roster names or already-tagged brackets.
        """
        nonlocal inferred
        m = re.match(r"^\[([^\[\]:]+)\]", line)
        if not m:
            return line
        name = m.group(1)
        if resolved.get(name) is not None:  # a real/resolved hero, not garbled
            return line
        body = line[m.end():]
        side: Optional[str] = None
        # Victim: "由于…【skill】…" means this subject suffered FROM a skill, so
        # it is on the OPPOSITE side of that skill's owner. Check this FIRST and
        # independently of 损失/伤害 — the damage tail often wraps to the next
        # line ("…效果，" + "损失了兵力…"), leaving only "由于【skill】" on this
        # line. The skill bracket that matters is the one right after "由于".
        cause = re.search(r"由于(?:\[[^\]]*\])?\s*[【「]([^【】「」]+)[】」]", body)
        if cause and cause.group(1) in skill_side:
            side = _other(skill_side[cause.group(1)])
        # Owner/beneficiary: possesses/executes a skill -> same side. Only when
        # there is no "由于" victim clause (which would invert the relationship).
        if side is None and "由于" not in body \
                and re.search(r"的[「【]|执行来自", body):
            for sk in re.findall(r"[【「]([^【】「」]+)[】」]", body):
                if sk in skill_side:
                    side = skill_side[sk]; break
        if side is None:
            return line
        inferred += 1
        return f"[{side}:{name}]" + body

    out: List[str] = []
    for line in lines:
        line = tagged_re.sub(fix_tagged, line)
        line = bare_re.sub(fix_bare, line)
        line = infer_garbled_side(line)
        out.append(line)
    return out, filled, corrected, inferred



def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_hash(value: object) -> str:
    rendered = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def _write_json_deterministic(path: str, value: object) -> None:
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, sort_keys=True, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _write_text_deterministic(path: str, text: str) -> None:
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def new_v2_cache_document(battle_id: str) -> dict:
    return {
        "schema_version": OCR_CACHE_SCHEMA_V2,
        "battle_id": battle_id,
        "ocr_config": {
            "crop": {
                "top": CROP_TOP,
                "bottom": CROP_BOTTOM,
                "left": CROP_LEFT,
                "right": CROP_RIGHT,
            },
            "dhash_duplicate_threshold": DHASH_DUP_THRESHOLD,
            "low_confidence_threshold": LOW_CONF_THRESHOLD,
            "junk_confidence_threshold": JUNK_CONF_THRESHOLD,
            "name_match_threshold": NAME_MATCH_THRESHOLD,
            "token_side": {
                "method": TOKEN_COLOR_METHOD,
                "minimum_coloured_pixels": TOKEN_COLOR_MIN_PIXELS,
                "minimum_pixel_margin": TOKEN_COLOR_MIN_MARGIN,
                "minimum_dominance": TOKEN_COLOR_DOMINANCE,
                "geometry": "approximate_from_whole_line_box",
            },
        },
        "frames": {},
    }


def write_cache_document(path: str, cache_document: dict) -> None:
    if cache_document.get("schema_version") != OCR_CACHE_SCHEMA_V2:
        raise ValueError("only v2 OCR cache documents may be written")
    _write_json_deterministic(path, cache_document)


def load_cache_document(path: str, battle_id: str) -> Tuple[dict, str]:
    """Load v2 or normalize legacy v1 cache without inventing lost evidence."""
    with open(path, "r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("OCR cache must be a JSON object")
    if value.get("schema_version") == OCR_CACHE_SCHEMA_V2:
        if value.get("battle_id") != battle_id:
            raise ValueError("v2 OCR cache battle_id mismatch")
        if not isinstance(value.get("frames"), dict):
            raise ValueError("v2 OCR cache frames must be an object")
        for image_name, frame in value["frames"].items():
            if not isinstance(frame, dict) or not isinstance(
                    frame.get("observations"), list):
                raise ValueError(f"invalid v2 frame: {image_name}")
            for observation in frame["observations"]:
                required = {
                    "observation_id", "raw_text", "processed_text", "bbox",
                    "score", "name_tokens", "provenance_status", "processing",
                }
                if not isinstance(observation, dict) or not required.issubset(observation):
                    raise ValueError(f"invalid v2 observation in {image_name}")
                processing = observation["processing"]
                if (
                        not isinstance(processing, dict)
                        or not isinstance(
                            processing.get("canonical_correction_applied"), bool
                        )):
                    raise ValueError(
                        f"invalid v2 observation processing in {image_name}"
                    )
        return value, OCR_CACHE_SCHEMA_V2

    frames: Dict[str, dict] = {}
    for image_name in sorted(value):
        entries = value[image_name]
        if not isinstance(entries, list):
            raise ValueError(f"legacy cache entries for {image_name} must be a list")
        observations = []
        for index, entry in enumerate(entries, 1):
            if isinstance(entry, str):
                processed_text, score = entry, 1.0
            elif isinstance(entry, (list, tuple)) and len(entry) == 2:
                processed_text, score = entry[0], float(entry[1])
            else:
                raise ValueError(f"unsupported legacy cache entry {image_name}:{index}")
            observations.append(
                {
                    "observation_id": f"legacy:{image_name}:o{index:04d}",
                    "raw_text": None,
                    "processed_text": processed_text,
                    "bbox": None,
                    "score": score,
                    "name_tokens": [],
                    "provenance_status": "legacy_v1_missing_raw_bbox_token_side",
                    "reused_from_observation_id": None,
                    "processing": {
                        "legacy_processed_text_only": True,
                        "token_side_method": None,
                    },
                }
            )
        frames[image_name] = {
            "image_sha256": None,
            "crop_dhash": None,
            "near_duplicate_of": None,
            "observations": observations,
            "provenance_status": "legacy_v1_frame_metadata_unavailable",
        }
    return {
        "schema_version": "sanmou-ocr-cache-v1-normalized",
        "source_schema_version": "legacy-v1",
        "battle_id": battle_id,
        "ocr_config": None,
        "frames": frames,
    }, "legacy-v1"


def validate_v2_cache_images(cache_document: dict, image_paths: List[str]) -> None:
    if cache_document.get("schema_version") != OCR_CACHE_SCHEMA_V2:
        return
    actual = {
        os.path.basename(path): _sha256_file(path)
        for path in image_paths
    }
    frames = cache_document["frames"]
    if set(frames) != set(actual):
        raise ValueError(
            "v2 OCR cache frame set does not match current screenshots"
        )
    for image_name, image_sha256 in actual.items():
        if frames[image_name].get("image_sha256") != image_sha256:
            raise ValueError(
                f"v2 OCR cache image_sha256 mismatch for {image_name}"
            )


class LineageRecorder:
    def __init__(self) -> None:
        self.transformations: List[dict] = []
        self._next_node = 1

    def _status(self, inputs: List[dict], mapping_status: str) -> str:
        statuses = {item["lineage_status"] for item in inputs}
        if (
                mapping_status == "unresolved"
                or "unresolved_transform_mapping" in statuses):
            return "unresolved_transform_mapping"
        if any(status.startswith("legacy_v1") for status in statuses):
            return "legacy_v1_missing_observation_provenance"
        if (
                mapping_status == "heuristic"
                or "deterministic_heuristic_v2" in statuses):
            return "deterministic_heuristic_v2"
        return "deterministic_v2"

    def transform(
            self, stage: str, operation: str, inputs: List[dict], text: str,
            mapping_status: str = "exact", details: Optional[dict] = None) -> dict:
        transform_id = f"t{len(self.transformations) + 1:06d}"
        node_id = f"n{self._next_node:06d}"
        self._next_node += 1
        observation_ids = sorted({
            observation_id
            for item in inputs
            for observation_id in item.get("observation_ids", [])
        })
        transform_ids = list(dict.fromkeys(
            transform_id_value
            for item in inputs
            for transform_id_value in item.get("transform_ids", [])
        ))
        transform_ids.append(transform_id)
        self.transformations.append(
            {
                "transform_id": transform_id,
                "stage": stage,
                "operation": operation,
                "mapping_status": mapping_status,
                "input_node_ids": [item["node_id"] for item in inputs],
                "output_node_ids": [node_id],
                "details": details or {},
            }
        )
        return {
            "node_id": node_id,
            "text": text,
            "observation_ids": observation_ids,
            "transform_ids": transform_ids,
            "lineage_status": self._status(inputs, mapping_status),
        }

    def drop(
            self, stage: str, operation: str, inputs: List[dict],
            details: Optional[dict] = None) -> None:
        self.transformations.append(
            {
                "transform_id": f"t{len(self.transformations) + 1:06d}",
                "stage": stage,
                "operation": operation,
                "mapping_status": "exact",
                "input_node_ids": [item["node_id"] for item in inputs],
                "output_node_ids": [],
                "details": details or {},
            }
        )


def _observation_record(observation: dict) -> dict:
    status = observation.get("provenance_status", "")
    correction_applied = observation.get("processing", {}).get(
        "canonical_correction_applied"
    )
    if status.startswith("legacy_v1"):
        lineage_status = "legacy_v1_missing_observation_provenance"
    elif (
            status == "near_duplicate_reuse_v2"
            or observation.get("reused_from_observation_id") is not None
            or observation.get("processing", {}).get("near_duplicate_reuse") is True):
        lineage_status = "deterministic_heuristic_v2"
    elif correction_applied is True:
        lineage_status = "deterministic_heuristic_v2"
    elif correction_applied is False:
        lineage_status = "exact_v2_observation"
    else:
        lineage_status = "unresolved_transform_mapping"
    return {
        "node_id": f"observation:{observation['observation_id']}",
        "text": observation["processed_text"],
        "observation_ids": [observation["observation_id"]],
        "transform_ids": [],
        "lineage_status": lineage_status,
    }


def merge_fragment_records(
        records: List[dict], heroes: List[str], recorder: LineageRecorder,
        scope: str) -> List[dict]:
    """Run the established merger and map outputs to exact monotonic prefixes."""
    texts = [record["text"] for record in records]
    output_texts = merge_fragments(texts, heroes)
    outputs: List[dict] = []
    consumed = 0
    for output_index, output_text in enumerate(output_texts):
        matched_end: Optional[int] = None
        for end in range(consumed + 1, len(records) + 1):
            prefix_outputs = merge_fragments(texts[:end], heroes)
            if prefix_outputs[:output_index + 1] == output_texts[:output_index + 1]:
                matched_end = end
                break
        if matched_end is None:
            possible = records[consumed:consumed + 1]
            outputs.append(
                recorder.transform(
                    "fragment_merge", "unresolved_mapping", possible, output_text,
                    mapping_status="unresolved",
                    details={"scope": scope, "output_index": output_index},
                )
            )
            consumed = min(len(records), consumed + 1)
            continue
        inputs = records[consumed:matched_end]
        operation = (
            "identity" if len(inputs) == 1 and inputs[0]["text"] == output_text
            else "merge_or_repair"
        )
        outputs.append(
            recorder.transform(
                "fragment_merge", operation, inputs, output_text,
                mapping_status=(
                    "exact" if operation == "identity" else "heuristic"
                ),
                details={"scope": scope, "output_index": output_index},
            )
        )
        consumed = matched_end
    if consumed < len(records):
        recorder.drop(
            "fragment_merge", "drop_garbage_or_duplicate", records[consumed:],
            details={"scope": scope},
        )
    return outputs


def stitch_records(
        accumulated: List[dict], new_records: List[dict],
        recorder: LineageRecorder, scope: str, window: int = 45) -> List[dict]:
    if not accumulated:
        return [
            recorder.transform(
                "stitch", "accept_initial", [record], record["text"],
                details={"scope": scope},
            )
            for record in new_records
        ]
    out = list(accumulated)
    for record in new_records:
        norm = _norm(record["text"])
        if not norm:
            recorder.drop("stitch", "drop_empty", [record], {"scope": scope})
            continue
        matched_index = next(
            (
                index for index in range(max(0, len(out) - window), len(out))
                if _similar(norm, _norm(out[index]["text"]))
            ),
            None,
        )
        if matched_index is not None:
            previous = out[matched_index]
            similarity = SequenceMatcher(
                None, norm, _norm(previous["text"])
            ).ratio()
            out[matched_index] = recorder.transform(
                "stitch", "deduplicate_overlap", [previous, record],
                previous["text"], mapping_status="heuristic",
                details={
                    "scope": scope,
                    "window": window,
                    "similarity": round(similarity, 6),
                },
            )
            continue
        out.append(
            recorder.transform(
                "stitch", "accept_new", [record], record["text"],
                details={"scope": scope},
            )
        )
    return out


def _changed_side_entity_indices(before_text: str, after_text: str) -> List[int]:
    entity_re = re.compile(r"\[(?:(我方|敌方):)?([^\[\]]+)\]")
    before_entities = entity_re.findall(before_text)
    return [
        entity_index
        for entity_index, (side, name) in enumerate(entity_re.findall(after_text))
        if side
        and (
            entity_index >= len(before_entities)
            or before_entities[entity_index] != (side, name)
        )
    ]


def backfill_side_records(
        records: List[dict], recorder: LineageRecorder
) -> Tuple[List[dict], int, int, int]:
    output_texts, filled, corrected, inferred = backfill_sides(
        [record["text"] for record in records]
    )
    outputs = []
    for record, output_text in zip(records, output_texts):
        outputs.append(
            recorder.transform(
                "side_backfill",
                "side_consensus_change" if output_text != record["text"] else "identity",
                [record], output_text,
                mapping_status=("heuristic" if output_text != record["text"] else "exact"),
                details={
                    "text_changed": output_text != record["text"],
                    "inferred_entity_indices": _changed_side_entity_indices(
                        record["text"], output_text
                    ),
                },
            )
        )
    return outputs, filled, corrected, inferred


def _entity_side_provenance(
        before_text: str, after_text: str, source_observations: List[dict],
        legacy: bool) -> List[dict]:
    entity_re = re.compile(r"\[(?:(我方|敌方):)?([^\[\]]+)\]")
    inferred_entity_indices = set(
        _changed_side_entity_indices(before_text, after_text)
    )
    direct: set[Tuple[str, str]] = set()
    reused: set[Tuple[str, str]] = set()
    for observation in source_observations:
        is_reused = (
            observation.get("provenance_status") == "near_duplicate_reuse_v2"
            or observation.get("reused_from_observation_id") is not None
            or observation.get("processing", {}).get("near_duplicate_reuse") is True
        )
        destination = reused if is_reused else direct
        for token in observation.get("name_tokens", []):
            side = token.get("decision")
            name = token.get("token_text")
            if side in {"我方", "敌方"} and isinstance(name, str):
                destination.add((side, name))

    result: List[dict] = []
    for entity_index, (side, name) in enumerate(entity_re.findall(after_text)):
        displayed_side = side or None
        if displayed_side is None:
            side_source = "missing"
        elif entity_index in inferred_entity_indices:
            side_source = "inferred_side_backfill"
        elif (side, name) in direct:
            side_source = "direct_token_colour"
        elif (side, name) in reused:
            side_source = "near_duplicate_reuse"
        elif legacy:
            side_source = "legacy_unverifiable"
        else:
            side_source = "unresolved"
        result.append(
            {
                "entity_index": entity_index,
                "name": name,
                "displayed_side": displayed_side,
                "side_source": side_source,
            }
        )
    return result


def build_log_and_provenance(
        cache_document: dict, image_names: List[str], heroes: List[str],
        battle_id: str) -> Tuple[List[str], dict, dict]:
    recorder = LineageRecorder()
    frames = cache_document["frames"]
    cache_schema = cache_document.get("schema_version", "unknown")
    observations_by_id: Dict[str, dict] = {}
    accumulated: List[dict] = []
    frame_stats: List[dict] = []
    dropped_low_confidence = 0

    for image_name in image_names:
        frame = frames.get(image_name)
        if frame is None:
            frame_stats.append(
                {
                    "image": image_name,
                    "observation_count": 0,
                    "kept_count": 0,
                    "merged_count": 0,
                    "added_count": 0,
                    "status": "missing_from_cache",
                }
            )
            continue
        kept_records = []
        for observation in frame["observations"]:
            observation_view = copy.deepcopy(observation)
            observation_view["image"] = image_name
            observations_by_id[observation["observation_id"]] = observation_view
            record = _observation_record(observation)
            if drop_low_conf(observation["processed_text"], float(observation["score"])):
                dropped_low_confidence += 1
                recorder.drop(
                    "confidence_filter", "drop_low_confidence", [record],
                    {
                        "image": image_name,
                        "score": float(observation["score"]),
                    },
                )
                continue
            kept_records.append(record)
        merged = merge_fragment_records(
            kept_records, heroes, recorder, scope=f"frame:{image_name}"
        )
        before = len(accumulated)
        accumulated = stitch_records(
            accumulated, merged, recorder, scope=f"frame:{image_name}"
        )
        frame_stats.append(
            {
                "image": image_name,
                "observation_count": len(frame["observations"]),
                "kept_count": len(kept_records),
                "merged_count": len(merged),
                "added_count": len(accumulated) - before,
                "near_duplicate_of": frame.get("near_duplicate_of"),
                "status": frame.get("provenance_status", "available"),
            }
        )

    accumulated = merge_fragment_records(
        accumulated, heroes, recorder, scope="cross_frame_final"
    )
    result_tail = re.compile(r"(平局|胜利|失败|战斗结束)\s*[!！]\s*$")
    for result_index, record in enumerate(accumulated):
        if result_tail.search(record["text"].strip()):
            if result_index + 1 < len(accumulated):
                recorder.drop(
                    "result_truncation", "drop_after_result",
                    accumulated[result_index + 1:],
                )
            accumulated = accumulated[:result_index + 1]
            break

    before_side_backfill = accumulated
    accumulated, filled, corrected, inferred = backfill_side_records(
        accumulated, recorder
    )
    final_lines = [record["text"] for record in accumulated]
    final_line_lineage = []
    legacy = cache_schema != OCR_CACHE_SCHEMA_V2
    for line_number, (record, before_record) in enumerate(
            zip(accumulated, before_side_backfill, strict=True), 1):
        source_observations = [
            observations_by_id[observation_id]
            for observation_id in record["observation_ids"]
            if observation_id in observations_by_id
        ]
        final_line_lineage.append(
            {
                "line_number": line_number,
                "text": record["text"],
                "lineage_node_id": record["node_id"],
                "lineage_status": record["lineage_status"],
                "observation_ids": record["observation_ids"],
                "transformation_ids": record["transform_ids"],
                "source_observations": source_observations,
                "entity_side_provenance": _entity_side_provenance(
                    before_record["text"], record["text"], source_observations,
                    legacy,
                ),
            }
        )

    sidecar = {
        "schema_version": PROVENANCE_SCHEMA_V2,
        "battle_id": battle_id,
        "cache_schema_version": cache_schema,
        "cache_content_hash": _canonical_hash(cache_document),
        "observation_provenance_complete": not legacy,
        "token_side_calibration": {
            "method": TOKEN_COLOR_METHOD if not legacy else None,
            "geometry": "approximate_from_whole_line_box" if not legacy else None,
            "claim": (
                "calibrated_pixel_counts_with_conservative_unknown_decision"
                if not legacy else "unavailable_in_legacy_v1_cache"
            ),
        },
        "frames": [
            {
                "image": image_name,
                "image_sha256": frames.get(image_name, {}).get("image_sha256"),
                "crop_dhash": frames.get(image_name, {}).get("crop_dhash"),
                "near_duplicate_of": frames.get(image_name, {}).get("near_duplicate_of"),
                "observation_ids": [
                    observation["observation_id"]
                    for observation in frames.get(image_name, {}).get("observations", [])
                ],
            }
            for image_name in image_names
        ],
        "transformations": recorder.transformations,
        "final_lines": final_line_lineage,
        "summary": {
            "frame_count": len(image_names),
            "final_line_count": len(final_lines),
            "dropped_low_confidence_count": dropped_low_confidence,
            "side_backfilled_count": filled,
            "side_corrected_count": corrected,
            "side_inferred_count": inferred,
        },
        "limitations": (
            [
                "Legacy v1 cache has processed text and score only; raw text, bbox, token colour, frame hashes, and near-duplicate origin cannot be recovered."
            ]
            if legacy else [
                "Token side regions are proportional approximations within a whole-line PaddleOCR box, not exact glyph boxes.",
                "Stitch deduplication is deterministic but fuzzy; its transformation records preserve the decision and similarity without claiming semantic certainty.",
            ]
        ),
    }
    stats = {
        "frame_stats": frame_stats,
        "dropped_low_confidence": dropped_low_confidence,
        "backfilled": filled,
        "corrected": corrected,
        "inferred": inferred,
    }
    return final_lines, sidecar, stats
def main() -> int:
    parser = argparse.ArgumentParser(
        description="OCR a battle's scrolling screenshots into a battle log.")
    parser.add_argument(
        "battle", nargs="?", default=None,
        help="Battle id/label (subdir under battles/). Optional when only one "
             "battle exists.")
    parser.add_argument(
        "--use-cache", action="store_true",
        help="Reuse a legacy v1 or current v2 OCR cache and deterministically "
             "rebuild the log plus provenance sidecar.")
    parser.add_argument(
        "--list", action="store_true",
        help="List known battles and exit.")
    args = parser.parse_args()

    if args.list:
        battles = list_battles()
        print("Battles under", BATTLES_DIR + ":")
        for battle in battles:
            count = len(glob.glob(os.path.join(
                BATTLES_DIR, battle, IMAGES_SUBDIR, "battle_detail_*.png")))
            print(f"  {battle}  ({count} frames)")
        if not battles:
            print("  (none)")
        return 0

    bp = resolve_battle(args.battle)
    images = sorted(glob.glob(
        os.path.join(bp.images_dir, "battle_detail_*.png")))
    if not images:
        print(f"No screenshots found in {bp.images_dir}", file=sys.stderr)
        return 1
    image_names = [os.path.basename(path) for path in images]
    print(f"Battle: {bp.id}  ({len(images)} frames)")

    print(f"Loading database from {DATABASE_PATH} ...")
    db = load_database(DATABASE_PATH)
    print(f"  heroes={len(db['heroes'])} skills={len(db['skills'])} "
          f"formations={len(db['formations'])} bonds={len(db['bonds'])}")

    use_cache = args.use_cache and os.path.exists(bp.cache)
    if use_cache:
        print(f"Loading cached per-image OCR from {bp.cache} ...")
        cache_document, source_schema = load_cache_document(bp.cache, bp.id)
        validate_v2_cache_images(cache_document, images)
        print(f"  cache schema: {source_schema}")
    else:
        print("Initialising PaddleOCR ...")
        ocr = build_ocr()
        cache_document = new_v2_cache_document(bp.id)
        seen_hashes: List[Tuple[int, str]] = []
        skipped = 0
        for frame_index, path in enumerate(images, 1):
            image = cv2.imread(path)
            image_name = os.path.basename(path)
            image_hash = _sha256_file(path)
            if image is None:
                print(f"  [{frame_index}/{len(images)}] SKIP unreadable {image_name}")
                cache_document["frames"][image_name] = {
                    "image_sha256": image_hash,
                    "crop_dhash": None,
                    "near_duplicate_of": None,
                    "observations": [],
                    "provenance_status": "unreadable_frame",
                }
                continue
            crop = crop_main_area(image)
            perceptual_hash = dhash(crop)
            duplicate_of = next(
                (
                    prior_name for prior_hash, prior_name in seen_hashes
                    if hamming(perceptual_hash, prior_hash) <= DHASH_DUP_THRESHOLD
                ),
                None,
            )
            if duplicate_of is not None:
                source_observations = cache_document["frames"][duplicate_of][
                    "observations"
                ]
                observations = []
                for observation_index, source_observation in enumerate(
                        source_observations, 1):
                    cloned = copy.deepcopy(source_observation)
                    cloned["observation_id"] = (
                        f"{image_name}:o{observation_index:04d}"
                    )
                    cloned["reused_from_observation_id"] = source_observation[
                        "observation_id"
                    ]
                    cloned["provenance_status"] = "near_duplicate_reuse_v2"
                    cloned["processing"] = {
                        **cloned.get("processing", {}),
                        "near_duplicate_reuse": True,
                        "evidence_sampled_from_frame": duplicate_of,
                    }
                    observations.append(cloned)
                cache_document["frames"][image_name] = {
                    "image_sha256": image_hash,
                    "crop_dhash": f"{perceptual_hash:064x}",
                    "near_duplicate_of": duplicate_of,
                    "observations": observations,
                    "provenance_status": "near_duplicate_ocr_reuse_v2",
                }
                seen_hashes.append((perceptual_hash, image_name))
                skipped += 1
                print(
                    f"  [{frame_index}/{len(images)}] {image_name}: "
                    f"DUP of {duplicate_of} (OCR skipped)"
                )
                continue

            observations = []
            for observation_index, (raw_text, box, score) in enumerate(
                    ocr_lines(ocr, crop), 1):
                observations.append(
                    process_observation(
                        raw_text,
                        box,
                        float(score),
                        crop,
                        db,
                        f"{image_name}:o{observation_index:04d}",
                        evidence_frame=image_name,
                    )
                )
            cache_document["frames"][image_name] = {
                "image_sha256": image_hash,
                "crop_dhash": f"{perceptual_hash:064x}",
                "near_duplicate_of": None,
                "observations": observations,
                "provenance_status": "direct_ocr_v2",
            }
            seen_hashes.append((perceptual_hash, image_name))
            print(
                f"  [{frame_index}/{len(images)}] {image_name}: "
                f"{len(observations)} observations"
            )
        print(f"  (OCR skipped on {skipped} near-duplicate frame(s))")
        os.makedirs(bp.root, exist_ok=True)
        write_cache_document(bp.cache, cache_document)
        source_schema = OCR_CACHE_SCHEMA_V2

    final_lines, provenance, stats = build_log_and_provenance(
        cache_document, image_names, db["heroes"], bp.id
    )
    for frame in stats["frame_stats"]:
        print(
            f"  stitch {frame['image']}: {frame['merged_count']} lines, "
            f"+{frame['added_count']} new"
        )

    log_text = "\n".join(final_lines) + "\n"
    provenance["cache_file_sha256"] = _sha256_file(bp.cache)
    provenance["battle_log_sha256"] = hashlib.sha256(
        log_text.encode("utf-8")
    ).hexdigest()
    _write_text_deterministic(bp.log, log_text)
    _write_json_deterministic(bp.provenance, provenance)

    print(f"\nWrote {len(final_lines)} lines to {bp.log}")
    print(f"Wrote provenance to {bp.provenance}")
    print(f"  (cache schema {source_schema})")
    print(
        f"  (dropped {stats['dropped_low_confidence']} "
        "low-confidence noise line(s))"
    )
    print(
        f"  (back-filled {stats['backfilled']} missing side tag(s), "
        f"corrected {stats['corrected']} mis-tag(s) from consensus, "
        f"inferred {stats['inferred']} garbled-name side(s) from skill context)"
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
