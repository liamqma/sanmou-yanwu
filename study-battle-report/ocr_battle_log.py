#!/usr/bin/env python3
"""OCR one or more scrolling battle reports from a screenshot batch.

The screenshots are one or more 战报详情 (detail) views captured while scrolling,
so consecutive images overlap heavily. This script:

  1. Crops out the top nav (我方/敌方 tab) + left round-marker nav + bottom nav,
     keeping only the main log panel.
  2. Runs PaddleOCR (Chinese) on the panel, getting per-line text + boxes.
  3. Tags the leading owner name by text colour: blue => 我方 (our), red => 敌方
     (enemy), producing tokens like [我方:诸葛亮] / [敌方:袁绍].
  4. Cross-references hero / skill / formation / bond names against
     web/public/game-data/database.json and snaps OCR output to the canonical spelling.
  5. Splits a capture batch into battles and stitches each battle into a
     de-duplicated, ordered text file.

See README.md for batch layout, commands, outputs, and cache behavior.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import glob
import hashlib
import json
import os
import re
import sys
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

# Model-host probing delays an otherwise offline run. Missing official models
# can still be downloaded from Paddle's default source when first requested.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
from paddleocr import PaddleOCR

# --------------------------------------------------------------------------- #
# Paths / config
# --------------------------------------------------------------------------- #
HERE = os.path.dirname(os.path.abspath(__file__))
BATTLES_DIR = os.path.join(HERE, "battles")
DATABASE_PATH = os.path.join(HERE, "..", "web", "public", "game-data", "database.json")

# Per-batch paths (under battles/<id>/).
IMAGES_SUBDIR = "images"
LOGS_SUBDIR = "battle_logs"
CACHE_NAME = ".ocr_cache.json"
CACHE_VERSION = 3
OCR_CONFIG = "paddle-ppocrv6-medium-ch-upright-v3"

# Screenshot-verified PP-OCRv6 edge-row confusions. Only corrections supported
# by visible glyphs are included. Ambiguous observations stay in the log for
# later source verification instead of being silently deleted.
KNOWN_OCR_REPAIRS = {
    "「北汉1也行来白】双叔御下】的「双叔御下":
        "[张辽]执行来自【叔侄御下】的「叔侄御下」效果",
    "『说1也行夹白】曰向甘这】的「曰向甘这」效用":
        "[刘禅]执行来自【同舟共济】的「同舟共济」效果",
    "「张了1协行来白网龙逍浮】的「网龙逍浮_龙」效甲":
        "[张辽]执行来自【风袭逍遥】的「风袭逍遥-龙」效果",
    "[自书告1的】写个】坦1(0)": "[皇甫嵩]的【军令】提升1(0)",
    "的个庆堰倾涛*虚弱丁效果":
        "[张昭]执行来自【决堰倾涛】的「决堰倾涛-虚弱」效果",
    "「水户1田口率去发动战法】黄工或心":
        "[张宁]因几率未发动战法【黄天惑心】",
    "「吕蒙1开始行动": "[吕蒙]开始行动",
    "X[诸葛高]开始行动": "[诸葛亮]开始行动",
}

HERO_DISPLAY_ALIASES = {"祝融夫人": "祝融"}

AMBIGUOUS_OCR_OBSERVATIONS = {
    "ヒ站田",
    "「张辽]由于[张宁1大平金响】的「大平全响」效里损告了",
    "[水71由工[工士1的■料事加神】的作害坦生了后±10",
    "[百倍惊1的】抵御次数】降低1(0)",
    "指生了",
    "[诸草言1劫行来白】草船供签】的「草船供签」效里",
    "【庆偃倾诗】",
    "[张哈执行味白",
    "[吐栏1由工[老草享]】荣船供笼】的「营船借签」效用损生",
    "[陆抗]中干[诸葛高]计垄粮仓】的「计垄粮仓」效果损牛",
}


def uncertain_observation(line: str) -> str:
    """Tag an uncertain OCR observation without deleting any observed text."""
    return "OCR不确定：" + line


def is_uncertain_observation(line: str) -> bool:
    return line.startswith("OCR不确定：")


def has_unbalanced_delimiters(line: str) -> bool:
    return any((line.count(left) != line.count(right)) for left, right in (
        ("[", "]"), ("【", "】"), ("「", "」"), ("『", "』"),
        ("(", ")"), ("（", "）"),
    ))


class BattlePaths:
    """Resolved filesystem paths for one screenshot capture batch."""

    def __init__(self, battle_id: str) -> None:
        self.id = battle_id
        self.root = os.path.join(BATTLES_DIR, battle_id)
        self.images_dir = os.path.join(self.root, IMAGES_SUBDIR)
        self.logs_dir = os.path.join(self.root, LOGS_SUBDIR)
        self.cache = os.path.join(self.root, CACHE_NAME)


def list_battles() -> List[str]:
    """Return batch ids (subdir names under battles/) that contain images."""
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
    """Resolve a batch id/label to BattlePaths.

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


# --------------------------------------------------------------------------- #
# OCR
# --------------------------------------------------------------------------- #
def build_ocr() -> PaddleOCR:
    """Initialise a Chinese PaddleOCR instance tuned for the log panel."""
    return PaddleOCR(
        text_detection_model_name="PP-OCRv6_medium_det",
        text_recognition_model_name="PP-OCRv6_medium_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


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

    text = re.sub(r"^[【「『]([^\[\]【】「」『』]{1,5}?)\]", fix_wrong_open, text)
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

    The detected colour belongs to the row owner at the start of the line.
    Other bracketed names can be targets on the opposing side and must not
    inherit the owner's colour.
    """
    if not side:
        return text
    return re.sub(r"\[([^\[\]]+)\]", lambda m: f"[{side}:{m.group(1)}]", text,
                  count=1)


def process_line(text: str, box: np.ndarray, crop_bgr: np.ndarray,
                 db: Dict[str, List[str]]) -> str:
    raw = KNOWN_OCR_REPAIRS.get(text.strip(), text.strip())
    if "开始行动" in raw or "队当前补给值" in raw:
        roster_row = re.match(r"^(.*?)(开始行动|队当前补给值.*)$", raw)
        if roster_row:
            owner, tail = roster_row.groups()
            noise_wrapped = re.fullmatch(
                r"[^\u4e00-\u9fa5\[]?\[([\u4e00-\u9fa5]{2,4})\]", owner)
            if noise_wrapped and noise_wrapped.group(1) in db["heroes"]:
                owner = f"[{noise_wrapped.group(1)}]"
            side_match = re.match(r"^\[(我方|敌方):", owner)
            side = side_match.group(1) if side_match else None
            if side:
                owner = re.sub(r"^\[(?:我方|敌方):", "", owner)
            candidate = owner.strip("[]【】「」『』")
            candidate = HERO_DISPLAY_ALIASES.get(candidate, candidate)
            if candidate in db["heroes"]:
                prefix = f"{side}:" if side else ""
                raw = f"[{prefix}{candidate}]{tail}"
        hero_alt = "|".join(sorted(map(re.escape, db["heroes"]),
                                   key=len, reverse=True))
        valid_owner = re.match(
            rf"^\[(?:(?:我方|敌方):)?(?:{hero_alt})\]"
            r"(?:开始行动|队当前补给值)", raw)
        if not valid_owner:
            return uncertain_observation(raw)
    side = classify_color(crop_bgr, box) if box.size else None
    corrected = correct_brackets(raw, db)
    return tag_sides(corrected, side)


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
    # Running totals wrap at the right edge, e.g. `损失...219(4` then `798)`.
    # Preserve the digit-only tail even at low confidence so merge_fragments
    # can reconstruct the exact number.
    if re.fullmatch(r"\d+[)）]?", s):
        return False
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
            if l in AMBIGUOUS_OCR_OBSERVATIONS:
                return uncertain_observation(l)
            # If delimiter damage survives fragment merging, the line will be
            # marked uncertain in the final pass. Do not mutate its raw text
            # before that decision.
            if has_unbalanced_delimiters(l):
                return l
            if l in KNOWN_OCR_REPAIRS:
                return KNOWN_OCR_REPAIRS[l]
            # Spurious leading bracket before a well-formed name bracket, e.g.
            # "【[我方:诸葛亮]队..." / "[[袁绍]的...". Runs here too (not just in
            # repair_brackets) so it also cleans lines rebuilt from cached raw
            # observations during a --use-cache re-stitch. Conservative: line
            # start, adjacent only.
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
            # Game logs never use corner quotes around hero owners. Repair
            # common OCR lookalikes before canonical-name matching.
            l = re.sub(r"^[「『]([^\[\]【】「」『』]{1,5})\]", r"[\1]", l)
            l = re.sub(
                r"^[\[「『]([\u4e00-\u9fa5]{2,4})1(?=的|执行|开始|发动|由于|消耗|对)",
                r"[\1]", l)
            l = re.sub(r"「([^「」\]]{1,24})\](?=效果)", r"「\1」", l)
            l = re.sub(r"的】([^【】\[\]]{1,8})\]", r"的【\1】", l)
            l = re.sub(r"的「([^「」]{2,12})(?=效果)", r"的「\1」", l)
            # Bare hero name + action verb, brackets fully lost ->
            # "袁术执行来自..." => "[袁术]执行来自...". Only when the head is an
            # exact known hero immediately followed by a recognised verb, so we
            # never corrupt continuation fragments.
            l = re.sub(rf"^({hero_alt})(?={verb_re})", r"[\1]", l)
            # OCR reads the digit 0 as letter O/o inside 兵力 amounts, e.g.
            # "恢复了兵力O(9953)" -> "恢复了兵力0(9953)".
            l = re.sub(r"(兵[力兴])[Oo](?=[（(])", r"\g<1>0", l)
            l = re.sub(r"([（(])([Oo])([）)])", r"\g<1>0\g<3>", l)
            l = l.replace("由干", "由于").replace("中干", "由于")
            l = l.replace("来白", "来自").replace("味白", "来自")
            l = l.replace("效里", "效果").replace("效甲", "效果")
            l = l.replace("损牛", "损失").replace("损告", "损失")
            return l
        fixed_lines = [_fix_inline(line) for line in lines]
        lines = [
            line if is_uncertain_observation(line)
            else normalize_name_line(line, heroes)
            for line in fixed_lines
        ]

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

        if out and re.fullmatch(r"\d+[)）]?", cur):
            previous = out[-1]
            if previous.count("(") + previous.count("（") \
                    > previous.count(")") + previous.count("）"):
                out[-1] += cur
                i += 1
                continue

        # A wrapped closing word belongs to an immediately preceding skill or
        # effect phrase. It is never a standalone battle event.
        if cur == "效果" and out and not out[-1].endswith("效果"):
            out[-1] += cur
            i += 1
            continue
        if out and cur.startswith(("提升", "降低")) \
                and out[-1].endswith(("]", "】", "」")):
            out[-1] += cur
            i += 1
            continue
        if out and cur.startswith((",损失", "，损失")) \
                and out[-1].endswith("效果"):
            out[-1] += cur
            i += 1
            continue
        # Remove symbol noise before it can separate a wrapped numeric tail
        # from the line it completes.
        if is_garbage(cur):
            i += 1
            continue

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
    return [
        l if is_uncertain_observation(l)
        else uncertain_observation(l) if has_unbalanced_delimiters(l)
        else l
        for l in merged if not is_garbage(l)
    ]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
# A name is treated as belonging to a single side when its dominant side wins
# by at least this fraction of its tagged occurrences. Per-frame colour
# detection is noisy (a name's true side can still be mis-coloured ~30% of the
# time in the worst case), but the *majority* is reliably the true side. A
# genuinely shared (mirror-match) name would sit near 50/50, so 0.65 keeps a
# safe margin above that while still resolving heavily-but-not-cleanly biased
# names (observed real heroes land at 0.70-1.00; only a true mirror would dip
# toward 0.50).
SIDE_CONSENSUS_THRESHOLD = 0.65


def backfill_sides(lines: List[str]) -> Tuple[List[str], int, int]:
    """Normalise side tags from each hero's battle-wide consensus.

    A hero's side is constant for the whole battle, so the *majority* colour
    across all of a name's tagged occurrences is its true side. This pass:

      1. **back-fills** bare "[name]" brackets that per-frame colour detection
         missed (no [我方:…]/[敌方:…] prefix at all), and
      2. **corrects** minority mis-tags (e.g. a [敌方:诸葛亮] that should be
         [我方:诸葛亮]) to the consensus side.

    Safety: a name is only resolved when one side wins by >=
    SIDE_CONSENSUS_THRESHOLD of its occurrences. A genuine mirror match (same
    hero on both teams) sits near 50/50 and is left untouched, so neither bare
    names nor existing tags for that name are changed.
    """
    tagged_re = re.compile(r"\[(我方|敌方):([^\[\]]+)\]")
    counts: Dict[str, Dict[str, int]] = {}
    for line in lines:
        if is_uncertain_observation(line):
            continue
        for side, name in tagged_re.findall(line):
            counts.setdefault(name, {"我方": 0, "敌方": 0})[side] += 1

    # Authoritative side anchor from the opening 【判断结果】 buff block. The
    # per-team补给/阵型/属性 buffs at the very top of the log render in clean,
    # unambiguous colour (no mid-battle scroll/colour jitter), so the FIRST
    # tagged occurrence of each name is a high-trust side signal. We record the
    # side of each name's first appearance within the opening window and use it
    # to resolve names whose battle-wide colour consensus is ambiguous (below
    # threshold) — e.g. a hero mis-coloured on ~40% of mid-battle rows. This is
    # mirror-safe: in a genuine same-hero-both-sides match the name's first two
    # appearances disagree, so no anchor is recorded.
    OPENING_WINDOW = 40
    first_side: Dict[str, str] = {}
    first_conflict: set = set()
    for line in lines[:OPENING_WINDOW]:
        if is_uncertain_observation(line):
            continue
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
        if is_uncertain_observation(line):
            continue
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
        if is_uncertain_observation(line):
            out.append(line)
            continue
        line = tagged_re.sub(fix_tagged, line)
        line = bare_re.sub(fix_bare, line)
        line = infer_garbled_side(line)
        out.append(line)
    return out, filled, corrected, inferred


_RESULT_TAIL_RE = re.compile(r"(平局|胜利|失败|战斗结束)\s*[!！]\s*$")
_OPENING_MARKERS = ("列队布阵", "行动顺序判断")
_CAPTURE_TS_RE = re.compile(r"battle_detail_(\d+)\.png$")


def capture_timestamp(path: str) -> int:
    match = _CAPTURE_TS_RE.search(os.path.basename(path))
    return int(match.group(1)) if match else 0


def capture_date(path: str) -> str:
    """Return the UTC calendar date encoded in a screenshot filename."""
    timestamp = capture_timestamp(path)
    if not timestamp:
        return "unknown-date"
    return datetime.fromtimestamp(timestamp / 1000, timezone.utc).date().isoformat()


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: str, value: object) -> None:
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as target:
        json.dump(value, target, ensure_ascii=False, indent=2)
        target.write("\n")
    os.replace(temp, path)


def empty_ocr_cache() -> Dict[str, object]:
    return {
        "version": CACHE_VERSION,
        "ocr_config": OCR_CONFIG,
        "observations": {},
        "images": {},
    }


def load_ocr_cache(path: str) -> Dict[str, object]:
    """Load the current cache or migrate the filename-keyed v2 format."""
    with open(path, "r", encoding="utf-8") as source:
        candidate = json.load(source)
    if candidate.get("ocr_config") != OCR_CONFIG:
        return empty_ocr_cache()
    if candidate.get("version") == CACHE_VERSION:
        candidate.setdefault("observations", {})
        candidate.setdefault("images", {})
        return candidate
    if candidate.get("version") == 2:
        migrated = empty_ocr_cache()
        observations = migrated["observations"]
        images = migrated["images"]
        for name, entry in candidate.get("images", {}).items():
            digest = entry.get("sha256")
            raw = entry.get("raw")
            if digest and raw is not None:
                observations.setdefault(digest, {"raw": raw})
                images[name] = digest
        return migrated
    return empty_ocr_cache()


def cached_raw(cache: Dict[str, object], digest: str) -> Optional[List[dict]]:
    observation = cache.get("observations", {}).get(digest, {})
    return observation.get("raw")


def store_cached_raw(cache: Dict[str, object], name: str, digest: str,
                     raw: List[dict]) -> None:
    cache["observations"][digest] = {"raw": raw}
    cache["images"][name] = digest


def frame_texts(lines: List[object]) -> List[str]:
    return [entry[0] if isinstance(entry, tuple) else entry for entry in lines]


def frame_has_opening(lines: List[object]) -> bool:
    joined = "".join(frame_texts(lines))
    return any(marker in joined for marker in _OPENING_MARKERS)


def frame_has_fresh_opening(lines: List[object]) -> bool:
    """Recognise the complete opening block used as a battle boundary."""
    joined = "".join(frame_texts(lines))
    return all(marker in joined for marker in _OPENING_MARKERS)


def frame_has_result(lines: List[object]) -> bool:
    return any(_RESULT_TAIL_RE.search(line.strip()) for line in frame_texts(lines))


def frame_overlap_count(first: List[object], second: List[object]) -> int:
    """Count distinct, meaningful observations shared by two frames."""
    def identity(line: str) -> Tuple[str, Tuple[str, ...]]:
        return _norm(line), tuple(re.findall(r"\[(我方|敌方):", line))

    first_norm = {identity(line) for line in frame_texts(first)
                  if len(_norm(line)) >= 6}
    second_norm = {identity(line) for line in frame_texts(second)
                   if len(_norm(line)) >= 6}
    return len(first_norm & second_norm)


def split_battle_frames(
        frames: List[Tuple[str, List[Tuple[str, float]]]],
) -> List[List[Tuple[str, List[Tuple[str, float]]]]]:
    """Split ordered frames, refusing ambiguous content after a result."""
    battles: List[List[Tuple[str, List[Tuple[str, float]]]]] = []
    current: List[Tuple[str, List[Tuple[str, float]]]] = []
    current_has_result = False

    for path, lines in frames:
        opening = frame_has_fresh_opening(lines)
        if current and opening and current_has_result:
            battles.append(current)
            current = []
            current_has_result = False
        elif current and opening and not current_has_result:
            previous_lines = current[-1][1]
            same_observations = frame_texts(previous_lines) == frame_texts(lines)
            if not same_observations \
                    and frame_overlap_count(previous_lines, lines) < 2:
                raise ValueError(
                    "new battle opening before the current battle result in "
                    f"{os.path.basename(path)}")
        elif current and current_has_result and not opening:
            previous_lines = current[-1][1]
            if not frame_has_result(lines) \
                    and frame_overlap_count(previous_lines, lines) < 2:
                raise ValueError(
                    "ambiguous content after a battle result in "
                    f"{os.path.basename(path)}; a new battle opening may have "
                    "been misread")

        current.append((path, lines))
        current_has_result = current_has_result or frame_has_result(lines)

    if current:
        battles.append(current)
    return battles


def select_new_frame_lines(previous: List[Tuple[str, float]],
                           current: List[Tuple[str, float]]) -> List[str]:
    """Select lines revealed by a downward scroll using text + Y displacement."""
    def stationary_identity(entries: List[Tuple[str, float]]) \
            -> List[Tuple[str, float]]:
        # Preserve 我方/敌方 tags here: mirror matchups can otherwise look
        # identical after _norm strips their side labels.
        return [
            (re.sub(r"[\s，,。.!！:：;；]", "", text), round(y, 1))
            for text, y in entries
        ]

    if current and stationary_identity(current) == stationary_identity(previous):
        return []

    candidates: List[Tuple[int, float, float, int, int]] = []
    for old_index, (old_text, old_y) in enumerate(previous):
        old_norm = _norm(old_text)
        if len(old_norm) < 6:
            continue
        for new_index, (new_text, new_y) in enumerate(current):
            old_sides = tuple(re.findall(r"\[(我方|敌方):", old_text))
            new_sides = tuple(re.findall(r"\[(我方|敌方):", new_text))
            if old_sides != new_sides:
                continue
            new_norm = _norm(new_text)
            if len(new_norm) < 6:
                continue
            if re.search(r"\d|损失|兵力", old_text + new_text) \
                    and old_norm != new_norm:
                continue
            ratio = SequenceMatcher(None, old_norm, new_norm).ratio()
            shift = old_y - new_y
            if ratio >= 0.84 and 80 <= shift <= 1800:
                candidates.append((round(shift / 30), ratio, new_y,
                                   old_index, new_index))

    buckets: Dict[int, List[Tuple[int, float, float, int, int]]] = {}
    for candidate in candidates:
        buckets.setdefault(candidate[0], []).append(candidate)
    if not buckets:
        return [text for text, _ in current]

    bucket = max(buckets.values(),
                 key=lambda values: (len(values), sum(v[1] for v in values)))
    # Use a one-to-one, monotonically ordered alignment. A single matching row
    # is not enough evidence to discard any prefix because combat events repeat.
    selected = []
    used_old = set()
    used_new = set()
    for candidate in sorted(bucket, key=lambda value: value[1], reverse=True):
        old_index, new_index = candidate[3], candidate[4]
        if old_index not in used_old and new_index not in used_new:
            selected.append(candidate)
            used_old.add(old_index)
            used_new.add(new_index)
    matches = []
    last_old = -1
    for candidate in sorted(selected, key=lambda value: value[4]):
        if candidate[3] > last_old:
            matches.append(candidate)
            last_old = candidate[3]
    if len(matches) < 2:
        return [text for text, _ in current]
    matched_current_indexes = {value[4] for value in matches}
    return [
        text for index, (text, _) in enumerate(current)
        if index not in matched_current_indexes
    ]


def stitch_battle(frames: List[Tuple[str, List[Tuple[str, float]]]],
                  db: Dict[str, List[str]]) -> List[str]:
    if not frames:
        return []
    selected_lines = [text for text, _ in frames[0][1]]
    previous = frames[0][1]
    for _, entries in frames[1:]:
        selected_lines.extend(select_new_frame_lines(previous, entries))
        previous = entries
    # Merge once after frame selection so a numeric continuation revealed at a
    # frame seam remains adjacent to the incomplete observation it completes.
    accumulated = merge_fragments(selected_lines, db["heroes"])
    for idx_end, line in enumerate(accumulated):
        if _RESULT_TAIL_RE.search(line.strip()):
            accumulated = accumulated[:idx_end + 1]
            break
    accumulated, _, _, _ = backfill_sides(accumulated)
    return correct_roster_references(accumulated, db["heroes"])


def roster_from_log(lines: List[str], side: str,
                    known_heroes: Optional[List[str]] = None) -> List[str]:
    """Return all distinct canonical row owners observed for one side."""
    names: List[str] = []
    pattern = re.compile(rf"^\[{re.escape(side)}:([^\]]+)\]")
    for line in lines:
        match = pattern.search(line)
        name = match.group(1) if match else None
        if name and known_heroes is not None and name not in known_heroes:
            continue
        if name and name not in names:
            names.append(name)
    return names


def correct_roster_references(lines: List[str],
                              known_heroes: List[str]) -> List[str]:
    """Snap damaged hero references to the six names established at setup."""
    rosters = {
        "我方": roster_from_log(lines, "我方", known_heroes),
        "敌方": roster_from_log(lines, "敌方", known_heroes),
    }
    all_names = list(dict.fromkeys(rosters["我方"] + rosters["敌方"]))

    def tagged(match: re.Match) -> str:
        side, name = match.group(1), match.group(2)
        candidates = rosters[side]
        if name in candidates:
            return match.group(0)
        fixed = best_match(name, candidates, 0.52)
        return f"[{side}:{fixed}]" if fixed else match.group(0)

    def bare(match: re.Match) -> str:
        name = match.group(1)
        if name in all_names:
            return match.group(0)
        fixed = best_match(name, all_names, 0.52)
        return f"[{fixed}]" if fixed else match.group(0)

    output = []
    for line in lines:
        if is_uncertain_observation(line):
            output.append(line)
            continue
        observed = line
        roster_owner = re.match(
            r"^\[(?:(我方|敌方):)?([^\]]+)\]"
            r"(?:开始行动|队当前补给值)", line)
        if roster_owner and (roster_owner.group(1) is None
                             or roster_owner.group(2) not in known_heroes):
            # Roster-defining evidence must reach publication validation
            # unchanged. Fuzzy repair here could hide a fourth or unsided
            # observed owner by snapping it to one of the accepted three.
            output.append(observed)
            continue
        line = re.sub(r"\[(我方|敌方):([^\[\]]{1,6})\]", tagged, line)
        line = re.sub(r"(?<!:)\[([^:\[\]]{1,6})\]", bare, line)
        unresolved = [
            name for _, name in re.findall(
                r"\[(我方|敌方):([^\]]+)\]", line)
            if name not in known_heroes
        ]
        if unresolved and "开始行动" not in line \
                and "队当前补给值" not in line:
            output.append(uncertain_observation(observed))
            continue
        output.append(line)
    return output


def safe_filename_part(value: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|]", "_", value).strip(" .")
    return value or "未知队伍"


def battle_outcome(lines: List[str]) -> str:
    """Return the result from our/enemy perspective for a filename."""
    result_index = next(
        (index for index in range(len(lines) - 1, -1, -1)
         if _RESULT_TAIL_RE.search(lines[index].strip())),
        None,
    )
    if result_index is None:
        return "胜负未知"

    result = lines[result_index]
    if "平局" in result:
        return "平局"
    explicit = re.search(r"(我方|敌方)\s*(胜利|失败)\s*[!！]\s*$", result)
    if explicit:
        side, outcome = explicit.groups()
        won = (side == "我方") == (outcome == "胜利")
        return "我方胜" if won else "敌方胜"
    if re.fullmatch(r"\s*胜利\s*[!！]\s*", result):
        return "我方胜"
    if re.fullmatch(r"\s*失败\s*[!！]\s*", result):
        return "敌方胜"

    # The terminal sentence commonly names the attacking/defending side, while
    # the OCR log identifies teams as 我方/敌方. The final tagged hero to reach
    # zero troops tells us which team was wiped out without assuming that 我方
    # is always the attacker or always the defender.
    zero_troops = re.compile(
        r"^\[(我方|敌方):[^\]]+\].*兵力为\s*0.*无法再战")
    for line in reversed(lines[:result_index]):
        match = zero_troops.search(line)
        if match:
            return "敌方胜" if match.group(1) == "我方" else "我方胜"

    return "胜负未知"


def complete_battle_rosters(
        lines: List[str], known_heroes: Optional[List[str]] = None,
) -> Tuple[List[str], List[str]]:
    """Return both complete canonical rosters or reject the battle."""
    if known_heroes is not None:
        known = set(known_heroes)
        roster_owner = re.compile(
            r"^\[(?:(我方|敌方):)?([^\]]+)\]"
            r"(?:开始行动|队当前补给值)")
        unresolved_roster = []
        for line in lines:
            if is_uncertain_observation(line):
                raw = line.removeprefix("OCR不确定：")
                if "开始行动" in raw or "队当前补给值" in raw:
                    unresolved_roster.append("OCR不确定:" + raw)
                continue
            match = roster_owner.match(line)
            if match and (match.group(1) is None or match.group(2) not in known):
                side = match.group(1) or "侧别未知"
                unresolved_roster.append(f"{side}:{match.group(2)}")
        if unresolved_roster:
            raise ValueError(
                "unresolved roster owner(s): "
                + ", ".join(sorted(set(unresolved_roster))))
        tagged_owner = re.compile(r"\[(我方|敌方):([^\]]+)\]")
        unresolved = sorted({
            f"{side}:{name}"
            for line in lines
            if not is_uncertain_observation(line)
            for side, name in tagged_owner.findall(line)
            if name not in known
        })
        if unresolved:
            raise ValueError(
                "unresolved tagged roster owner(s): " + ", ".join(unresolved))
    ours = roster_from_log(lines, "我方", known_heroes)
    enemy = roster_from_log(lines, "敌方", known_heroes)
    if len(ours) != 3 or len(enemy) != 3:
        raise ValueError(
            f"incomplete rosters: 我方={len(ours)}/3, 敌方={len(enemy)}/3")
    return ours, enemy


def validate_battle_lines(
        lines: List[str], known_heroes: Optional[List[str]] = None,
) -> Tuple[bool, bool, str]:
    """Return publication metadata, rejecting incomplete or unknown battles."""
    has_opening = frame_has_opening(lines)
    has_result = frame_has_result(lines)
    outcome = battle_outcome(lines)
    if not has_opening or not has_result:
        raise ValueError(
            f"opening={has_opening}, result={has_result}, outcome={outcome}")
    if outcome == "胜负未知":
        raise ValueError(
            f"opening={has_opening}, result={has_result}, outcome={outcome}")
    complete_battle_rosters(lines, known_heroes)
    return has_opening, has_result, outcome


def load_image(path: str) -> np.ndarray:
    """Read one source frame, failing rather than hiding missing evidence."""
    image = cv2.imread(path)
    if image is None:
        raise ValueError(f"unreadable screenshot: {os.path.basename(path)}")
    return image


def battle_filename(lines: List[str], number: int, used: Dict[str, int],
                    known_heroes: Optional[List[str]] = None,
                    battle_date: Optional[str] = None) -> str:
    ours, enemy = complete_battle_rosters(lines, known_heroes)
    left = "+".join(ours)
    right = "+".join(enemy)
    date_suffix = f" - {battle_date}" if battle_date else ""
    base = safe_filename_part(
        f"{left} vs {right} - {battle_outcome(lines)}{date_suffix}")
    used[base] = used.get(base, 0) + 1
    suffix = f" ({used[base]})" if used[base] > 1 else ""
    return f"{base}{suffix}.txt"


def invalidate_published_logs(logs_dir: str) -> None:
    """Remove regenerable outputs before attempting a replacement run."""
    for path in glob.glob(os.path.join(logs_dir, "*.txt")):
        os.remove(path)
    manifest = os.path.join(logs_dir, ".manifest.json")
    if os.path.exists(manifest):
        os.remove(manifest)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="OCR a screenshot batch into one text file per battle.")
    parser.add_argument(
        "battle", nargs="?", default=None,
        help="Battle id/label (subdir under battles/). Optional when only one "
             "battle exists.")
    parser.add_argument(
        "--use-cache", action="store_true",
        help="Reuse content-addressed OCR observations; only re-run the text "
             "post-processing (stitch/merge/side-fix).")
    parser.add_argument(
        "--list", action="store_true",
        help="List known battles and exit.")
    args = parser.parse_args()

    if args.list:
        battles = list_battles()
        print("Battles under", BATTLES_DIR + ":")
        for b in battles:
            n = len(glob.glob(os.path.join(
                BATTLES_DIR, b, IMAGES_SUBDIR, "battle_detail_*.png")))
            print(f"  {b}  ({n} frames)")
        if not battles:
            print("  (none)")
        return 0

    bp = resolve_battle(args.battle)
    invalidate_published_logs(bp.logs_dir)
    images = sorted(glob.glob(
        os.path.join(bp.images_dir, "battle_detail_*.png")),
        key=capture_timestamp)
    if not images:
        print(f"No screenshots found in {bp.images_dir}", file=sys.stderr)
        return 1
    print(f"Batch: {bp.id}  ({len(images)} frames)")

    print(f"Loading database from {DATABASE_PATH} ...")
    db = load_database(DATABASE_PATH)
    print(f"  heroes={len(db['heroes'])} skills={len(db['skills'])} "
          f"formations={len(db['formations'])} bonds={len(db['bonds'])}")

    cache = empty_ocr_cache()
    if args.use_cache and os.path.exists(bp.cache):
        print(f"Loading cached raw OCR from {bp.cache} ...")
        cache = load_ocr_cache(bp.cache)

    per_image: Dict[str, List[List[object]]] = {}
    ocr: Optional[PaddleOCR] = None
    seen_hashes: List[Tuple[int, str]] = []
    skipped = 0
    os.makedirs(bp.root, exist_ok=True)
    for idx, path in enumerate(images, 1):
        name = os.path.basename(path)
        try:
            img = load_image(path)
        except ValueError as error:
            print(f"Cannot process batch safely: {error}", file=sys.stderr)
            return 1
        crop = crop_main_area(img)
        digest = file_sha256(path)
        raw = cached_raw(cache, digest)

        h = dhash(crop)
        duplicate_digest = next(
            (seen_digest for ph, seen_digest in reversed(seen_hashes[-5:])
             if hamming(h, ph) <= DHASH_DUP_THRESHOLD), None)
        if raw is None and duplicate_digest is not None:
            raw = cached_raw(cache, duplicate_digest)
            skipped += 1
        if raw is None:
            if ocr is None:
                print("Initialising PaddleOCR ...")
                ocr = build_ocr()
            detected = ocr_lines(ocr, crop)
            raw = [{"text": text, "score": float(score), "box": box.tolist()}
                   for text, box, score in detected]

        processed: List[List[object]] = []
        for entry in raw:
            box = np.array(entry["box"], dtype=np.float32)
            center_y = float(box[:, 1].mean()) if box.size else 0.0
            processed.append([
                process_line(entry["text"], box, crop, db),
                float(entry["score"]),
                center_y,
            ])
        per_image[name] = processed
        store_cached_raw(cache, name, digest, raw)
        seen_hashes.append((h, digest))
        atomic_json(bp.cache, cache)
        print(f"  [{idx}/{len(images)}] {name}: {len(processed)} lines")
    print(f"  (OCR skipped on {skipped} near-duplicate frame(s))")

    dropped_lowconf = 0

    def confident_lines(entries: List) -> List[Tuple[str, float]]:
        """Return surviving text and vertical-position pairs.

        Backward-compatible with the old cache format (plain strings, no
        score), which is treated as fully confident.
        """
        nonlocal dropped_lowconf
        out_lines: List[Tuple[str, float]] = []
        for e in entries:
            if isinstance(e, (list, tuple)) and len(e) >= 2:
                text, score = e[0], float(e[1])
                center_y = float(e[2]) if len(e) >= 3 else 0.0
            else:  # legacy: string only
                text, score, center_y = e, 1.0, 0.0
            if drop_low_conf(text, score):
                dropped_lowconf += 1
                continue
            out_lines.append((text, center_y))
        return out_lines

    frames: List[Tuple[str, List[Tuple[str, float]]]] = []
    for path in images:
        name = os.path.basename(path)
        kept = confident_lines(per_image.get(name, []))
        frames.append((path, kept))

    try:
        battles = split_battle_frames(frames)
    except ValueError as error:
        print(f"Cannot split batch safely: {error}", file=sys.stderr)
        return 1
    used_names: Dict[str, int] = {}
    rendered = []
    for number, battle_frames in enumerate(battles, 1):
        lines = stitch_battle(battle_frames, db)
        try:
            has_opening, has_result, outcome = validate_battle_lines(
                lines, db["heroes"])
        except ValueError as error:
            first = os.path.basename(battle_frames[0][0])
            last = os.path.basename(battle_frames[-1][0])
            print(
                "Refusing to publish battle "
                f"{number} ({first}..{last}): {error}",
                file=sys.stderr,
            )
            return 1
        battle_date = capture_date(battle_frames[0][0])
        filename = battle_filename(
            lines, number, used_names, db["heroes"], battle_date)
        rendered.append((filename, lines, battle_frames,
                         has_opening, has_result, outcome, battle_date))

    os.makedirs(bp.logs_dir, exist_ok=True)
    written_names = set()
    manifest = []
    print(f"\nDetected {len(battles)} battle(s)")
    for (filename, lines, battle_frames, has_opening, has_result,
         outcome, battle_date) in rendered:
        output_path = os.path.join(bp.logs_dir, filename)
        temp_path = output_path + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as target:
            target.write("\n".join(lines) + "\n")
        os.replace(temp_path, output_path)
        written_names.add(filename)
        manifest.append({
            "file": filename,
            "outcome": outcome,
            "date": battle_date,
            "first_image": os.path.basename(battle_frames[0][0]),
            "last_image": os.path.basename(battle_frames[-1][0]),
            "image_count": len(battle_frames),
            "line_count": len(lines),
            "uncertain_line_count": sum(
                line.startswith("OCR不确定：") for line in lines),
            "has_opening": has_opening,
            "has_result": has_result,
        })
        print(f"  {filename}: {len(battle_frames)} frames, {len(lines)} lines")
    for old_path in glob.glob(os.path.join(bp.logs_dir, "*.txt")):
        if os.path.basename(old_path) not in written_names:
            os.remove(old_path)
    atomic_json(os.path.join(bp.logs_dir, ".manifest.json"), manifest)

    print(f"\nWrote {len(battles)} battle log(s) to {bp.logs_dir}")
    print(f"  (dropped {dropped_lowconf} low-confidence noise line(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
