#!/usr/bin/env python3
"""OCR the scrolling battle-log screenshots in study-battle-report/images.

The screenshots are a single battle's 战报详情 (detail) view, captured while
scrolling, so consecutive images overlap heavily. This script:

  1. Crops out the top nav (我方/敌方 tab) + left round-marker nav + bottom nav,
     keeping only the main log panel.
  2. Runs PaddleOCR (Chinese) on the panel, getting per-line text + boxes.
  3. Tags each bracketed name by text colour: blue => 我方 (our), red => 敌方
     (enemy), producing tokens like [我方:诸葛亮] / [敌方:袁绍].
  4. Cross-references hero / skill / formation / bond names against
     web/src/database.json and snaps OCR output to the canonical spelling.
  5. Stitches all images into ONE de-duplicated, ordered battle log.

Run with:  uv run python study-battle-report/ocr_battle_log.py
"""
from __future__ import annotations

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
IMAGES_DIR = os.path.join(HERE, "images")
OUTPUT_TXT = os.path.join(HERE, "battle_log.txt")
# Cache of per-image processed (tagged + corrected) lines, so the stitching
# step can be re-tuned without re-running the slow OCR pass.
CACHE_JSON = os.path.join(HERE, ".ocr_cache.json")
DATABASE_PATH = os.path.join(HERE, "..", "web", "src", "database.json")

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
    """Load canonical name lists from web/src/database.json.

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
def _count_blue_red(region_bgr: np.ndarray) -> Tuple[int, int]:
    hsv = cv2.cvtColor(region_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    blue = int(((h > 95) & (h < 130) & (s > 80) & (v > 120)).sum())
    red = int((((h < 10) | (h > 170)) & (s > 80) & (v > 120)).sum())
    return blue, red


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

    # Missing closing ]: "[" + hero + (的|队|对|损失|恢复|执行|发动|消耗|由于)
    def fix_open(m: re.Match) -> str:
        inner, tail = m.group(1), m.group(2)
        match = best_match(inner, heroes, NAME_MATCH_THRESHOLD)
        return f"[{match}]{tail}" if match else m.group(0)

    text = re.sub(r"\[([^\[\]【】「」]{1,5}?)(的|队|对|损失|恢复|执行|发动|消耗|由于)",
                  fix_open, text)

    # Missing opening [ at start of line: hero + "]" + tail
    def fix_close(m: re.Match) -> str:
        inner = m.group(1)
        match = best_match(inner, heroes, NAME_MATCH_THRESHOLD)
        return f"[{match}]" if match else m.group(0)

    text = re.sub(r"^([^\[\]【】「」]{1,5}?)\]", fix_close, text)
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
    side = classify_color(crop_bgr, box) if box.size else None
    corrected = correct_brackets(text, db)
    return tag_sides(corrected, side)


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
# A continuation fragment typically begins with one of these.
_CONT_PREFIXES = ("兵力", "为30%", "为50%")

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
        # Fix inline name brackets that close with the wrong glyph, e.g.
        # "[袁绍】" -> "[袁绍]", so downstream attack/merge patterns match.
        def _fix_inline(l: str) -> str:
            return re.sub(r"\[([\u4e00-\u9fa5]{2,4})】", r"[\1]", l)
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
    return merged


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    images = sorted(glob.glob(os.path.join(IMAGES_DIR, "battle_detail_*.png")))
    if not images:
        print(f"No screenshots found in {IMAGES_DIR}", file=sys.stderr)
        return 1

    print(f"Loading database from {DATABASE_PATH} ...")
    db = load_database(DATABASE_PATH)
    print(f"  heroes={len(db['heroes'])} skills={len(db['skills'])} "
          f"formations={len(db['formations'])} bonds={len(db['bonds'])}")

    use_cache = "--use-cache" in sys.argv and os.path.exists(CACHE_JSON)
    if use_cache:
        print(f"Loading cached per-image OCR from {CACHE_JSON} ...")
        with open(CACHE_JSON, "r", encoding="utf-8") as f:
            per_image = json.load(f)
    else:
        print("Initialising PaddleOCR ...")
        ocr = build_ocr()
        per_image = {}
        seen_hashes: List[Tuple[int, str]] = []  # (dhash, image_name)
        skipped = 0
        for idx, path in enumerate(images, 1):
            img = cv2.imread(path)
            name = os.path.basename(path)
            if img is None:
                print(f"  [{idx}/{len(images)}] SKIP unreadable {name}")
                per_image[name] = []
                continue
            crop = crop_main_area(img)

            # Near-duplicate frame? Reuse the matching frame's OCR, skip the
            # (slow) OCR call entirely.
            h = dhash(crop)
            dup_of = next((nm for ph, nm in seen_hashes
                           if hamming(h, ph) <= DHASH_DUP_THRESHOLD), None)
            if dup_of is not None:
                per_image[name] = per_image[dup_of]
                seen_hashes.append((h, name))
                skipped += 1
                print(f"  [{idx}/{len(images)}] {name}: DUP of {dup_of} (OCR skipped)")
                continue

            lines = ocr_lines(ocr, crop)
            processed = [process_line(t, b, crop, db) for (t, b, _s) in lines]
            per_image[name] = processed
            seen_hashes.append((h, name))
            print(f"  [{idx}/{len(images)}] {name}: {len(processed)} lines")
        print(f"  (OCR skipped on {skipped} near-duplicate frame(s))")
        with open(CACHE_JSON, "w", encoding="utf-8") as f:
            json.dump(per_image, f, ensure_ascii=False, indent=0)

    accumulated: List[str] = []
    for path in images:
        name = os.path.basename(path)
        processed = merge_fragments(per_image.get(name, []), db["heroes"])
        before = len(accumulated)
        accumulated = stitch(accumulated, processed)
        added = len(accumulated) - before
        print(f"  stitch {name}: {len(processed)} lines, +{added} new")

    # Final merge pass to catch fragments that straddled image boundaries.
    accumulated = merge_fragments(accumulated, db["heroes"])

    # The battle ends at the result line (平局/胜利/失败). Drop any straggler
    # lines that leaked in after it from an earlier frame's bottom edge.
    for idx_end, line in enumerate(accumulated):
        s = line.strip()
        if s.startswith(("平局", "胜利", "失败")) and s.endswith(("!", "！")):
            accumulated = accumulated[:idx_end + 1]
            break

    with open(OUTPUT_TXT, "w", encoding="utf-8") as f:
        f.write("\n".join(accumulated) + "\n")

    print(f"\nWrote {len(accumulated)} lines to {OUTPUT_TXT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
