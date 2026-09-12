from copy import deepcopy
import json
from pathlib import Path
import unicodedata

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


@pytest.mark.parametrize("actor,name,glyph_indices", [
    ("[甫嵩]", "甫嵩", [2, 3]),
    ("[皇甫]嵩", "皇甫", [1, 2]),
])
@pytest.mark.parametrize("in_catalog", [False, True])
def test_real_source_actor_substrings_remain_pending(actor, name, glyph_indices, in_catalog):
    root = Path(__file__).parent.parent / "fixtures"
    raw = json.loads((root / "mixed-names.json").read_text())
    image = cv2.imread(str(root / "mixed-names.png"))
    names = NAMES | {name} if in_catalog else NAMES
    transcript = raw["glm_text"].replace("[皇甫嵩]", actor)
    result = tag_transcript(transcript, raw["localization"], image, names)[0]
    assert result["text"] == transcript.replace(f"[{name}]", f"[待核:{name}]").replace("[刘表]", "[敌方:刘表]")
    token = result["tokens"][0]
    assert token["side"] is None
    assert token["in_catalog"] is in_catalog
    assert token["reason"] == "source_actor_boundary_mismatch"
    candidate, = token["candidates"]
    assert candidate["side"] is None
    assert candidate["source_actors"] == [{"name": "皇甫嵩", "span": [0, 3], "raw_actor": "[皇甫嵩]"}]
    assert [c["glyph"] for c in candidate["characters"]] == glyph_indices
    for character in candidate["characters"]:
        source = raw["localization"][0]["glyphs"][character["glyph"]]
        assert character["blue_pixels"] > 0
        assert character["box"] == source["box"]
        assert character["score"] == source["score"]


@pytest.mark.parametrize("actor", ["[祝融]夫人", "祝[融夫]人", "祝融[夫人]"])
@pytest.mark.parametrize("source_actor,wrapped_context", [("[祝融夫人]", False), ("［ 敌 方 ： 祝融夫人 ］", True)])
def test_source_actor_boundaries_survive_typography_wraps_and_context_anchors(actor, source_actor, wrapped_context):
    tail = "执行来自【妖风大作】的「妖风大作」效果，损失了兵力100(9000)"
    source = source_actor + tail
    colours = {i: BLUE for i in range(source.index("祝"), source.index("人") + 1)}
    image, rows = localized(source, colours)
    if wrapped_context:
        split = source.index("夫")
        glyphs = rows[0]["glyphs"]
        rows = [{"text": source[:split], "glyphs": glyphs[:split]},
                {"text": source[split:], "glyphs": glyphs[split:]}]
        tail = tail.replace("9000", "9001")
    transcript = actor + tail
    result = tag_transcript(transcript, rows, image, NAMES | {"祝融"})[0]
    token, = result["tokens"]
    assert token["side"] is None
    assert token["reason"] == "source_actor_boundary_mismatch"
    assert result["text"] == unicodedata.normalize("NFKC", transcript).replace("[", "[待核:")
    candidate, = token["candidates"]
    assert candidate["source_actors"][0]["name"] == "祝融夫人"
    assert all(c["blue_pixels"] > 0 and c["score"] == 1.0 for c in candidate["characters"])
    exact = tag_transcript("[祝融夫人]" + tail, rows, image, NAMES)[0]
    assert exact["tokens"][0]["side"] == "我方"


@pytest.mark.parametrize("transcript,expected", [
    ("[皇甫嵩]开始行动\n[甫嵩]开始行动", ["[我方:皇甫嵩]开始行动", "[敌方:甫嵩]开始行动"]),
    ("[甫嵩]开始行动", ["[待核:甫嵩]开始行动"]),
])
def test_actor_boundaries_are_occurrence_local_not_name_wide(transcript, expected):
    source = "[皇甫嵩]开始行动[甫嵩]开始行动"
    image, rows = localized(source, name_colours(source, [BLUE, RED]))
    result = tag_transcript(transcript, rows, image, NAMES)
    assert [line["text"] for line in result] == expected
    if len(result) == 1:
        token = result[0]["tokens"][0]
        assert token["reason"] == "source_actor_boundary_mismatch"
        assert [c["side"] for c in token["candidates"]] == [None, "敌方"]
    else:
        assert all(t["reason"] == "pixel_evidence" for line in result for t in line["tokens"])


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


@pytest.mark.parametrize("actor", [
    "[敌方 :陈琳]", "［ 敌 方 ： 陈琳 ］", "[我方:\t陈琳]", "[待核∶陈琳]", "[敌方:我方:陈琳]",
])
def test_npc_side_prefix_typography_is_untrusted(actor):
    text = "[陈琳]开始行动"
    image, rows = localized(text, name_colours(text, [BLUE]))
    result = tag_transcript(actor + "开始行动", rows, image, NAMES)[0]
    assert result["text"] == "[我方:陈琳]开始行动"
    assert result["tokens"][0]["in_catalog"] is False
    assert result["tokens"][0]["reason"] == "pixel_evidence"
    assert result["unparsed_names"] == []


@pytest.mark.parametrize("actor,name", [
    ("[张?]", "张?"), ("[张?宝]", "张?宝"), ("[张宝?]", "张宝?"),
    ("[敌方 :陈?]", "陈?"), ("[]", ""), ("[张宝张宝张宝]", "张宝张宝张宝"),
])
def test_malformed_actors_preserve_corrupt_names_and_require_review(actor, name):
    text = actor + "开始行动"
    image, rows = localized(text, name_colours(text, [BLUE]))
    result = tag_transcript(text, rows, image, NAMES)[0]
    assert result["text"] == f"[待核:{name}]开始行动"
    token = result["tokens"][0]
    assert token["side"] is None
    assert token["reason"] == "unparseable_actor"
    assert token["candidates"] == []
    assert result["unparsed_names"] == [{"name": name, "span": token["span"], "reason": "unparseable_actor"}]


@pytest.mark.parametrize("actor,name", [
    ("陈琳]", "陈琳"), ("陈?]", "陈?"), ("敌方 :陈琳]", "陈琳"),
    ("我 方∶ 陈琳］", "陈琳"), ("]", ""),
])
def test_closing_only_actor_is_pending_even_outside_the_catalog(actor, name):
    source = "[陈琳]开始行动"
    image, rows = localized(source, name_colours(source, [BLUE]))
    result = tag_transcript(actor + "开始行动", rows, image, NAMES)[0]
    assert result["text"] == f"[待核:{name}]开始行动"
    token = result["tokens"][0]
    assert token["side"] is None
    assert token["reason"] == "unparseable_actor"
    assert token["raw_actor"].endswith("]")
    assert result["unparsed_names"]


def test_closing_only_target_preserves_the_uncertain_source_fragment():
    source = "[张宝]对[陈琳]发动普通攻击"
    image, rows = localized(source, name_colours(source, [BLUE, RED]))
    result = tag_transcript("[张宝]对陈琳]发动普通攻击", rows, image, NAMES)[0]
    assert result["tokens"][0]["side"] == "我方"
    assert result["tokens"][1]["side"] is None
    assert result["tokens"][1]["raw_actor"] == "对陈琳]"
    assert result["text"] == "[我方:张宝][待核:对陈琳]发动普通攻击"
    assert result["unparsed_names"]


@pytest.mark.parametrize("actor", [
    "[陈琳]", "[ 陈琳]", "[陈琳 ]", "［\t陈琳　］", "[敌方 :陈琳 ]", "［ 敌 方 ： 陈琳 ］",
])
def test_localized_npc_missing_both_brackets_is_reported_without_guessing(actor):
    source = actor + "开始行动"
    image, rows = localized(source, name_colours(source, [BLUE]))
    result = tag_transcript("陈琳开始行动", rows, image, NAMES)[0]
    assert result["text"] == "陈琳开始行动"
    assert result["tokens"] == []
    assert result["unparsed_names"] == [{"name": "陈琳", "span": [0, 2]}]


@pytest.mark.parametrize("actor", ["[陈?]", "[陈 琳]", "陈琳]", "[陈琳"])
def test_source_name_hints_do_not_repair_corrupt_or_incomplete_actors(actor):
    source = actor + "开始行动"
    image, rows = localized(source, {})
    result = tag_transcript("陈琳开始行动", rows, image, NAMES)[0]
    assert result["text"] == "陈琳开始行动"
    assert result["tokens"] == []
    assert result["unparsed_names"] == []


def test_unclosed_actor_is_explicitly_pending_without_inventing_a_name():
    text = "[敌方 :张宝开始行动"
    image, rows = localized(text, {i: BLUE for i in range(len(text))})
    result = tag_transcript(text, rows, image, NAMES)[0]
    assert result["text"] == "[待核:张宝开始行动]"
    assert result["tokens"][0]["side"] is None
    assert result["unparsed_names"] == [{"name": "张宝开始行动", "span": [0, 7], "reason": "unparseable_actor"}]


@pytest.mark.parametrize("score", [0.0, 0.79])
@pytest.mark.parametrize("colour,pixel_count", [(BLUE, "blue_pixels"), (RED, "red_pixels")])
def test_low_confidence_retains_diagnostic_pixels_geometry_and_score(score, colour, pixel_count):
    text = "[张宝]开始行动"
    image, rows = localized(text, name_colours(text, [colour]))
    glyph = rows[0]["glyphs"][1]
    trusted = classify_character(image, deepcopy(glyph))
    glyph["score"] = score
    result = tag_transcript(text, rows, image, NAMES)[0]
    assert result["text"] == "[待核:张宝]开始行动"
    character = result["tokens"][0]["candidates"][0]["characters"][0]
    assert character["side"] is None
    assert character["reason"] == "low_localization_confidence"
    assert character["score"] == score
    assert character["box"] == glyph["box"]
    assert character[pixel_count] > 0
    assert (character["blue_pixels"], character["red_pixels"]) == (trusted["blue_pixels"], trusted["red_pixels"])


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


@pytest.mark.parametrize("event,transcript,other_source", [
    ("[张宝]开始行动", "[张宝]开始行动", "[张宝]开始行功"),
    (
        "[张宝]执行来自【妖风大作】的「妖风大作」效果，损失了兵力100(9000)",
        "[张宝]执行来自【妖风大作】的「妖风大作」效果，损失了兵力100(9001)",
        "[张宝]执行来白【妖风大作】的「妖风大作」效果，损失了兵力100(9000)",
    ),
])
def test_count_deficient_full_event_and_context_anchors_cannot_reuse_pixels(event, transcript, other_source):
    first_image, first_rows = localized(event, name_colours(event, [BLUE]))
    image, second_rows = localized(other_source, name_colours(other_source, [RED]), y=25)
    image[:20] = first_image
    result = tag_transcript(transcript + "\n" + transcript, first_rows + second_rows, image, NAMES)
    expected = unicodedata.normalize("NFKC", transcript).replace("[张宝]", "[待核:张宝]")
    assert [line["text"] for line in result] == [expected] * 2
    for line in result:
        token = line["tokens"][0]
        assert token["side"] is None
        assert token["reason"] == "insufficient_source_occurrences"
        assert token["alignment"] == "count_deficient"
        assert token["matching_occurrences"] == 1
        assert token["target_occurrences"] == 2
        assert len(token["candidates"]) == 1
        assert all(c["row"] == 0 and c["blue_pixels"] > 0 and c["red_pixels"] == 0
                   for c in token["candidates"][0]["characters"])


@pytest.mark.parametrize("source_count", [1, 2])
@pytest.mark.parametrize("target,suffix", [("祝融夫人", ""), ("祝融", "夫人")])
def test_different_anchors_cannot_reuse_whole_or_partial_source_glyphs(source_count, target, suffix):
    event = "[皇甫嵩]对[祝融夫人]发动普通攻击"
    source = event * source_count
    image, rows = localized(source, name_colours(source, [BLUE, RED] * source_count))
    text = f"[皇甫嵩]对[祝融夫人]\n[{target}]{suffix}发动普通攻击"
    result = tag_transcript(text, rows, image, NAMES)
    assert [line["text"] for line in result] == [
        "[我方:皇甫嵩]对[待核:祝融夫人]", f"[待核:{target}]{suffix}发动普通攻击",
    ]
    assert "source_conflicts" not in result[0]["tokens"][0]
    targets = [result[0]["tokens"][1], result[1]["tokens"][0]]
    for index, token in enumerate(targets):
        assert token["side"] is None
        expected_reason = "source_actor_boundary_mismatch" if index == 1 and suffix else "competing_source_assignments"
        assert token["reason"] == expected_reason
        assert len(token["candidates"]) == source_count
        assert len(token["source_conflicts"]) == len(target) * source_count
        for conflict in token["source_conflicts"]:
            assert conflict["row"] == 0
            assert conflict["targets"] == [{"line_index": 0, "token_index": 1},
                                            {"line_index": 1, "token_index": 0}]
            for claimant in targets:
                characters = [c for candidate in claimant["candidates"] for c in candidate["characters"]]
                character = next(c for c in characters if c["glyph"] == conflict["glyph"])
                assert character["score"] == 1.0
                assert character["red_pixels"] > 0
                assert character["blue_pixels"] == 0
                assert character["box"] == rows[0]["glyphs"][conflict["glyph"]]["box"]


def test_independent_source_occurrences_with_different_anchors_keep_their_own_sides():
    source = "[皇甫嵩]对[祝融夫人]发动普通攻击[祝融夫人]开始行动"
    image, rows = localized(source, name_colours(source, [BLUE, RED, BLUE]))
    result = tag_transcript("[皇甫嵩]对[祝融夫人]\n[祝融夫人]开始行动", rows, image, NAMES)
    assert [line["text"] for line in result] == [
        "[我方:皇甫嵩]对[敌方:祝融夫人]", "[我方:祝融夫人]开始行动",
    ]
    assert all("source_conflicts" not in token for line in result for token in line["tokens"])


def test_pending_count_deficient_targets_still_compete_with_other_anchor_claims():
    source = "[皇甫嵩]对[祝融夫人]发动普通攻击"
    image, rows = localized(source, name_colours(source, [BLUE, RED]))
    result = tag_transcript("[皇甫嵩]对[祝融夫人]\n" + "[祝融夫人]发动普通攻击\n" * 2,
                            rows, image, NAMES)
    assert result[0]["tokens"][0]["side"] == "我方"
    assert result[0]["tokens"][1]["side"] is None
    assert result[0]["tokens"][1]["reason"] == "competing_source_assignments"
    for line in result[1:]:
        token = line["tokens"][0]
        assert token["side"] is None
        assert token["reason"] == "insufficient_source_occurrences"
        assert token["source_conflicts"] == result[0]["tokens"][1]["source_conflicts"]


@pytest.mark.parametrize("count", [2, 3])
@pytest.mark.parametrize("first_side", ["我方", "待核"])
def test_competing_overlap_lengths_preserve_all_events_without_backfill(count, first_side):
    repeated = "[我方:张宝]恢复了兵力0(9000)"
    first = ["第八回合"] + [repeated.replace("我方", first_side)] * count
    second = [repeated] * count + ["[敌方:孙权]开始行动"]
    result, issues = stitch_frames([first, second])
    assert result == first + second
    assert issues == [{"frame_index": 1, "reason": "ambiguous_overlap",
                       "candidate_overlaps": list(range(1, count + 1))}]


def test_periodic_multi_event_overlap_is_also_ambiguous():
    block = ["[我方:张宝]开始行动", "[我方:张宝]恢复了兵力0(9000)"]
    first = ["第八回合"] + block * 2
    second = block * 2 + ["[敌方:孙权]开始行动"]
    result, issues = stitch_frames([first, second])
    assert result == first + second
    assert issues == [{"frame_index": 1, "reason": "ambiguous_overlap", "candidate_overlaps": [2, 4]}]


@pytest.mark.parametrize("first,second,third,first_reason,first_candidates", [
    (["A", "B"], ["B", "C"], ["A", "B", "B", "C", "D"], "unverified_overlap", [1]),
    (["A", "A"], ["A", "A", "B"], ["A", "A", "A", "A", "B", "C"], "ambiguous_overlap", [1, 2]),
])
def test_stitch_cannot_use_history_assembled_across_uncertain_boundaries(
        first, second, third, first_reason, first_candidates):
    result, issues = stitch_frames([first, second, third])
    assert result == first + second + third
    assert issues == [
        {"frame_index": 1, "reason": first_reason, "candidate_overlaps": first_candidates},
        {"frame_index": 2, "reason": "unverified_overlap", "candidate_overlaps": []},
    ]


def test_unique_overlap_after_uncertain_boundary_uses_only_the_previous_frame():
    result, issues = stitch_frames([["A", "B"], ["B", "C"], ["B", "C", "D"]])
    assert result == ["A", "B", "B", "C", "D"]
    assert issues == [{"frame_index": 1, "reason": "unverified_overlap", "candidate_overlaps": [1]}]


def test_previous_frame_suffix_retains_verified_side_backfill():
    first = ["[我方:张宝]开始行动", "第八回合"]
    second = ["[待核:张宝]开始行动", "第八回合", "[敌方:孙权]开始行动"]
    third = ["[敌方:张宝]开始行动", "第八回合", "[敌方:孙权]开始行动", "第九回合"]
    result, issues = stitch_frames([first, second, third])
    assert result == first + second[2:] + third
    assert issues == [{"frame_index": 2, "reason": "unverified_overlap", "candidate_overlaps": []}]


def test_empty_frame_breaks_overlap_evidence():
    first, third = ["A", "B"], ["A", "B", "C"]
    result, issues = stitch_frames([first, [], third])
    assert result == first + third
    assert issues == [{"frame_index": 1, "reason": "empty_frame"},
                      {"frame_index": 2, "reason": "unverified_overlap", "candidate_overlaps": []}]


def test_unique_identical_frame_overlap_still_collapses():
    frame = ["第八回合", "[我方:张宝]开始行动", "[敌方:孙权]开始行动"]
    assert stitch_frames([frame, frame]) == (frame, [])


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
