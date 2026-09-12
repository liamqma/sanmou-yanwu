from copy import deepcopy
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from hybrid import classify_character, stitch_frames, tag_transcript

BLUE = (255, 100, 0)
RED = (0, 0, 255)
NAMES = {"张宝", "孙权", "皇甫嵩", "刘表", "乐进"}


def localized(text, colours, y=0):
    """Synthetic monospace source glyphs; only the supplied name spans are coloured."""
    image = np.full((y + 20, max(1, len(text)) * 10, 3), 255, np.uint8)
    glyphs = []
    for i, char in enumerate(text):
        box = [[i*10, y], [i*10+9, y], [i*10+9, y+18], [i*10, y+18]]
        image[y:y+18, i*10:i*10+9] = colours.get(i, (255, 255, 255))
        glyphs.append({"text": char, "score": 1.0, "box": box})
    return image, [{"text": text, "glyphs": glyphs}]


def name_colours(text, sides):
    import re
    result = {}
    for match, colour in zip(re.finditer(r"\[([^]]+)\]", text), sides):
        for i in range(match.start(1), match.end(1)):
            result[i] = colour
    return result


def test_each_name_uses_its_own_pixels_including_same_hero_on_both_sides():
    text = "[张宝]对[张宝]发动普通攻击"
    image, rows = localized(text, name_colours(text, [BLUE, RED]))
    result = tag_transcript(text, rows, image, NAMES)[0]
    assert result["text"] == "[我方:张宝]对[敌方:张宝]发动普通攻击"
    assert [t["side"] for t in result["tokens"]] == ["我方", "敌方"]
    assert all(t["candidates"][0]["characters"] for t in result["tokens"])


@pytest.mark.parametrize("fixture,expected", [
    ("mixed-names", "[我方:皇甫嵩]对[敌方:刘表]发动普通攻击"),
    ("mirror-names", "[敌方:乐进]对[我方:乐进]发动普通攻击"),
])
def test_real_game_glyph_geometry(fixture, expected):
    root = Path(__file__).parent.parent / "fixtures"
    raw = json.loads((root / f"{fixture}.json").read_text())
    image = cv2.imread(str(root / f"{fixture}.png"))
    result = tag_transcript(raw["glm_text"], raw["localization"], image, NAMES)
    assert result[0]["text"] == expected


def test_wrapped_source_and_unit_icon_do_not_break_event_alignment():
    text = "[张宝]损失了兵力318(6003)"
    image, rows = localized(text, name_colours(text, [RED]))
    glyphs = rows[0]["glyphs"]
    split = text.index("兵")
    rows = [{"text": text[:split], "glyphs": glyphs[:split]},
            {"text": "X", "glyphs": [{"text": "X", "box": glyphs[0]["box"], "score": 1.0}]},
            {"text": text[split:], "glyphs": glyphs[split:]}]
    result = tag_transcript(text, rows, image, NAMES)
    assert result[0]["text"] == "[敌方:张宝]损失了兵力318(6003)"


def test_identical_text_on_opposite_sides_is_unresolved_not_majority_vote():
    text = "[张宝]恢复了兵力0(9000)"
    blue_image, blue_rows = localized(text, name_colours(text, [BLUE]))
    red_image, red_rows = localized(text, name_colours(text, [RED]), y=25)
    image = red_image.copy()
    image[:20] = blue_image
    result = tag_transcript(text, blue_rows + red_rows, image, NAMES)[0]
    assert result["text"].startswith("[待核:张宝]")
    assert result["tokens"][0]["reason"] == "ambiguous_or_insufficient_pixel_evidence"
    assert {c["side"] for c in result["tokens"][0]["candidates"]} == {"我方", "敌方"}


def test_identical_text_with_consistent_pixels_can_be_tagged():
    text = "[张宝]恢复了兵力0(9000)"
    image, rows = localized(text, name_colours(text, [BLUE]))
    result = tag_transcript(text, rows * 2, image, NAMES)[0]
    assert result["tokens"][0]["side"] == "我方"
    assert len(result["tokens"][0]["candidates"]) == 2


@pytest.mark.parametrize("damage", ["wrong-transcription", "missing-colour", "low-score", "mixed-colour"])
def test_insufficient_evidence_is_visible(damage):
    text = "[张宝]恢复了兵力0(9000)"
    image, rows = localized(text, name_colours(text, [BLUE]))
    names = NAMES
    if damage == "wrong-transcription":
        rows[0]["glyphs"][1]["text"] = "孙"
    elif damage == "missing-colour":
        image[:] = 255
    elif damage == "low-score":
        rows[0]["glyphs"][1]["score"] = 0.1
    else:
        image[:9, 10:19] = RED
    result = tag_transcript(text, rows, image, names)[0]
    assert result["tokens"][0]["side"] is None
    assert result["text"].startswith("[待核:张宝]")


def test_non_catalog_npc_name_is_grounded_by_exact_text_and_pixels():
    text = "[陈琳]因几率未发动战法【讨贼檄文】"
    image, rows = localized(text, name_colours(text, [RED]))
    result = tag_transcript(text, rows, image, NAMES)[0]
    assert result["text"] == "[敌方:陈琳]因几率未发动战法【讨贼檄文】"
    assert result["tokens"][0]["in_catalog"] is False


def test_vlm_cannot_supply_authoritative_side_tags():
    text = "[张宝]恢复了兵力0(9000)"
    image, rows = localized(text, name_colours(text, [BLUE]))
    result = tag_transcript(text.replace("[张宝]", "[敌方:张宝]"), rows, image, NAMES)
    assert result[0]["text"].startswith("[我方:张宝]")


def test_whole_event_mismatch_can_use_exact_name_context_but_never_fuzzy_name():
    text = "[张宝]执行来自【妖风大作】的「妖风大作」效果，损失了兵力100(9000)"
    image, rows = localized(text, name_colours(text, [BLUE]))
    result = tag_transcript(text.replace("9000", "9001"), rows, image, NAMES)
    assert result[0]["tokens"][0]["side"] == "我方"
    assert "9001" in result[0]["text"]  # localization must not overwrite GLM's numbers


@pytest.mark.parametrize("box", [None, [[float('nan'), 0]] * 4, [[-9, -9]] * 4])
def test_invalid_or_off_image_geometry_does_not_guess(box):
    result = classify_character(np.zeros((10, 10, 3), np.uint8), {"box": box, "score": 1.0})
    assert result["side"] is None


def test_unrelated_red_damage_numbers_do_not_change_blue_name_tag():
    text = "[张宝]损失了兵力318(6003)"
    colours = name_colours(text, [BLUE])
    colours.update({i: RED for i, c in enumerate(text) if c.isdigit()})
    image, rows = localized(text, colours)
    assert tag_transcript(text, rows, image, NAMES)[0]["tokens"][0]["side"] == "我方"


def test_stitch_preserves_real_repetitions_and_numbers_and_opposing_sides():
    repeated = "[我方:张宝]恢复了兵力0(9000)"
    attack = "[我方:张宝]对[敌方:孙权]发动普通攻击"
    incoming = [repeated, attack, "[敌方:张宝]恢复了兵力0(9000)"]
    result, issues = stitch_frames([[repeated, repeated, attack], incoming])
    assert result == [repeated, repeated, attack, incoming[-1]]
    assert not issues
    different = [repeated.replace("9000", "9001"), attack]
    result, issues = stitch_frames([incoming, different])
    assert result == incoming + different
    assert issues[0]["reason"] == "unverified_overlap"


def test_overlap_backfill_only_changes_the_aligned_occurrence():
    first = ["[待核:张宝]恢复了兵力0(9000)", "第八回合"]
    second = ["[敌方:张宝]恢复了兵力0(9000)", "第八回合", "[待核:张宝]恢复了兵力0(8900)"]
    result, issues = stitch_frames([first, second])
    assert result == second
    assert not issues


def test_matching_repeated_event_counts_use_each_occurrences_pixels_in_order():
    text = "[张宝]恢复了兵力0(9000)"
    first, first_rows = localized(text, name_colours(text, [BLUE]))
    image, second_rows = localized(text, name_colours(text, [RED]), y=25)
    image[:20] = first
    result = tag_transcript(text + "\n" + text, first_rows + second_rows, image, NAMES)
    assert [line["tokens"][0]["side"] for line in result] == ["我方", "敌方"]
    assert all(line["tokens"][0]["alignment"] == "ordered_equal_count" for line in result)


def test_short_complete_action_is_localized_but_bare_name_is_not_guessed():
    text = "[张宝]开始行动"
    image, rows = localized(text, name_colours(text, [BLUE]))
    assert tag_transcript(text, rows, image, NAMES)[0]["tokens"][0]["side"] == "我方"
    assert tag_transcript("[张宝]", rows, image, NAMES)[0]["tokens"][0]["side"] is None


def test_literal_wrapped_totals_rejoin_without_synthesizing_text():
    text = "[张宝]恢复了兵力123(9999)"
    image, rows = localized(text, name_colours(text, [BLUE]))
    result = tag_transcript(text.replace("9999", "99\n99"), rows, image, NAMES)
    assert len(result) == 1
    assert result[0]["text"] == "[我方:张宝]恢复了兵力123(9999)"


def test_missing_brackets_are_reported_not_silently_accepted_as_complete():
    text = "张宝开始行动"
    image, rows = localized(text, {})
    result = tag_transcript(text, rows, image, NAMES)[0]
    assert result["text"] == text
    assert result["unparsed_names"] == [{"name": "张宝", "span": [0, 2]}]


def test_conflicting_mirror_tags_never_collapse():
    a = ["[我方:张宝]恢复了兵力0(9000)", "第八回合"]
    b = ["[敌方:张宝]恢复了兵力0(9000)", "第八回合"]
    assert stitch_frames([a, b])[0] == a + b
