"""Model-free regressions for split actor boundaries and pinned CTC scores."""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from backends import LocalModels
from hybrid import tag_transcript
from localization import character_score_alignment
from test_hybrid import BLUE, NAMES, localized, name_colours


@pytest.mark.parametrize("cuts", [[1], [1, 4, 5], list(range(1, 17))])
def test_detector_splits_cannot_erase_source_actor_boundaries(cuts):
    root = Path(__file__).parent.parent / "fixtures"
    fixture = json.loads((root / "mixed-names.json").read_text())
    image = cv2.imread(str(root / "mixed-names.png"))
    original = fixture["localization"][0]
    glyphs = original["glyphs"]
    positions = [0] + [n for n in cuts if n < len(glyphs)] + [len(glyphs)]
    rows = [{"text": "".join(g["text"] for g in glyphs[a:b]), "glyphs": glyphs[a:b]}
            for a, b in zip(positions, positions[1:])]
    partial = tag_transcript("[甫嵩]对[刘表]发动普通攻击", rows, image, NAMES)[0]
    assert partial["text"] == "[待核:甫嵩]对[敌方:刘表]发动普通攻击"
    assert partial["tokens"][0]["reason"] == "source_actor_boundary_mismatch"
    assert partial["tokens"][0]["candidates"][0]["source_actors"][0]["name"] == "皇甫嵩"
    complete = tag_transcript(fixture["glm_text"], rows, image, NAMES)[0]
    assert complete["text"] == "[我方:皇甫嵩]对[敌方:刘表]发动普通攻击"


@pytest.mark.parametrize("cuts", [[2], [1, 2, 3, 4]])
def test_complete_source_actor_hints_survive_row_wraps(cuts):
    text = "[陈琳]开始行动"
    image, rows = localized(text, name_colours(text, [BLUE]))
    glyphs = rows[0]["glyphs"]
    positions = [0, *cuts, len(glyphs)]
    rows = [{"text": text[a:b], "glyphs": glyphs[a:b]} for a, b in zip(positions, positions[1:])]
    result = tag_transcript("陈琳开始行动", rows, image, NAMES)[0]
    assert result["text"] == "陈琳开始行动"
    assert result["tokens"] == []
    assert result["unparsed_names"] == [{"name": "陈琳", "span": [0, 2]}]


def rapid_whitespace_result():
    # Execute the pinned decoder/box consumer, not a source-text assertion or
    # neural inference. Its actual zip shifts 宝's 0.79 onto the closing bracket.
    from rapidocr.ch_ppocr_rec.utils import CTCLabelDecode
    from rapidocr.cal_rec_boxes.main import CalRecBoxes

    text = "[ 张宝]开始行动"
    decoder = CTCLabelDecode(character=list(dict.fromkeys(text.replace(" ", ""))))
    indices = np.array([[decoder.dict[c] for c in text]])
    scores = np.full(indices.shape, 0.99)
    scores[0, text.index("宝")] = 0.79
    decoded, word_info = decoder.decode(indices, scores, return_word_box=True)
    box = np.array([[0, 0], [180, 0], [180, 20], [0, 20]])
    words, boxes, confs = CalRecBoxes().cal_ocr_word_box(text, box, word_info[0], True)
    word_results = tuple(zip(words, confs, boxes))
    assert dict((t, s) for t, s, _ in word_results)["宝"] == 0.99
    assert dict((t, s) for t, s, _ in word_results)["]"] == 0.79
    return SimpleNamespace(txts=(decoded[0][0],), boxes=np.array([box]), word_results=(word_results,))


def test_live_adapter_and_legacy_cache_do_not_authorize_shifted_ctc_scores():
    result = rapid_whitespace_result()
    image = np.full((20, 180, 3), BLUE, dtype=np.uint8)
    models = LocalModels()
    models.rapid = lambda _: result
    rows = models.localize(image)
    # Cached annotations cannot override the guard. Raw rows from before this
    # fix have no annotation at all and must be just as safe.
    for annotation in [None, "aligned", "recognized_whitespace"]:
        cached = deepcopy(rows)
        if annotation is None:
            cached[0].pop("score_alignment", None)
        else:
            cached[0]["score_alignment"] = annotation
        tagged = tag_transcript("[张宝]开始行动", cached, image, NAMES)[0]
        assert tagged["text"] == "[待核:张宝]开始行动"
        character = next(c for c in tagged["tokens"][0]["candidates"][0]["characters"] if c["text"] == "宝")
        assert character["raw_score"] == 0.99
        assert character["score"] is None
        assert character["reason"] == "unverified_character_confidence"
        assert character["score_alignment"] == "recognized_whitespace"
        assert character["blue_pixels"] > 0
    assert rows[0]["score_alignment"] == "recognized_whitespace"


def test_non_whitespace_character_correspondence_failure_is_also_pending():
    text = "[张宝]开始行动"
    image, rows = localized(text, name_colours(text, [BLUE]))
    rows[0]["text"] = "X" + text
    assert character_score_alignment(rows[0]) == "text_glyph_mismatch"
    token = tag_transcript(text, rows, image, NAMES)[0]["tokens"][0]
    assert token["side"] is None
    assert all(c["score"] is None for c in token["candidates"][0]["characters"])


def test_genuinely_complete_character_scores_are_not_rejected_for_spaces():
    text = "[ 张宝]开始行动"
    image, rows = localized(text, name_colours(text, [BLUE]))
    assert character_score_alignment(rows[0]) == "aligned"
    assert tag_transcript("[张宝]开始行动", rows, image, NAMES)[0]["tokens"][0]["side"] == "我方"
