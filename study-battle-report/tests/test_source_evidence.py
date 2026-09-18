"""Source identity and actor-boundary regressions using recorded game pixels."""
from copy import deepcopy
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from hybrid import tag_transcript
from test_hybrid import BLUE, NAMES, localized


FIXTURES = Path(__file__).parent.parent / "fixtures"
EXPECTED_SIDES = {"mixed-names": ["我方", "敌方"], "mirror-names": ["敌方", "我方"]}


def real_source(fixture):
    raw = json.loads((FIXTURES / f"{fixture}.json").read_text())
    return raw, cv2.imread(str(FIXTURES / f"{fixture}.png"))


def duplicate_source(raw, geometry="unchanged", reverse_rows=False):
    duplicate = deepcopy(raw["localization"][0])
    for glyph in duplicate["glyphs"]:
        box = np.asarray(glyph["box"], dtype=float)
        if geometry == "reversed":
            box = box[::-1]
        elif geometry == "permuted":
            box = box[[2, 0, 3, 1]]
        elif geometry == "jittered":
            box += [0.4, 0.3]
        glyph["box"] = box.tolist()
    raw["localization"].append(duplicate)
    if reverse_rows:
        raw["localization"].reverse()
    raw["glm_text"] = "\n".join([raw["glm_text"]] * 2)


def nested_source(raw, close_outer):
    row = raw["localization"][0]
    insertion = 2 if raw["glm_text"].startswith("[皇") else 1
    row["glyphs"].insert(insertion, deepcopy(row["glyphs"][0]))
    if close_outer:
        closing = next(i for i, glyph in enumerate(row["glyphs"]) if glyph["text"] == "]")
        row["glyphs"].insert(closing, deepcopy(row["glyphs"][closing]))
    row["text"] = "".join(g["text"] for g in row["glyphs"])
    raw["glm_text"] = raw["glm_text"].replace("[皇甫嵩]", "[甫嵩]")


def delimiter_conflict_rows(raw, case):
    glyphs = raw["localization"][0]["glyphs"]
    if case == "missing_prefix":
        raw["localization"] = [
            {"text": "[皇", "glyphs": [glyphs[0]]},
            {"text": "甫嵩]对[刘表]发动普通攻击", "glyphs": glyphs[2:]},
        ]
        raw["glm_text"] = raw["glm_text"].replace("[皇甫嵩]", "[甫嵩]")
    else:
        raw["localization"] = [
            {"text": "[皇甫", "glyphs": glyphs[:3]},
            {"text": "嵩]对[刘表]发动普通攻击", "glyphs": glyphs[4:]},
        ]
        raw["glm_text"] = raw["glm_text"].replace("[皇甫嵩]", "[皇甫]")


@pytest.mark.parametrize("case", ["missing_prefix", "missing_suffix"])
def test_row_text_glyph_disagreement_taints_delimiter_only_actor_boundaries(case):
    raw, image = real_source("mixed-names")
    delimiter_conflict_rows(raw, case)
    line, = tag_transcript(raw["glm_text"], raw["localization"], image, NAMES)
    token = line["tokens"][0]
    assert token["side"] is None
    assert token["reason"] == "source_actor_boundary_mismatch"
    assert f"[待核:{token['name']}]" in line["text"]
    actor, = token["candidates"][0]["source_actors"]
    assert actor["reason"] == "source_text_glyph_mismatch"
    assert actor["row_text"] != actor["glyph_text"]
    assert actor["row_text"] == raw["localization"][actor["row"]]["text"]
    assert actor["glyph_text"] == "".join(g["text"] for g in raw["localization"][actor["row"]]["glyphs"])


@pytest.mark.parametrize("fixture", EXPECTED_SIDES)
@pytest.mark.parametrize("geometry", ["unchanged", "reversed", "permuted", "jittered"])
@pytest.mark.parametrize("reverse_rows", [False, True])
def test_duplicate_physical_glyphs_cannot_authorize_repeated_events(fixture, geometry, reverse_rows):
    raw, image = real_source(fixture)
    duplicate_source(raw, geometry, reverse_rows)
    lines = tag_transcript(raw["glm_text"], raw["localization"], image, NAMES)
    assert len(lines) == 2
    for line in lines:
        for index, token in enumerate(line["tokens"]):
            assert token["side"] is None
            assert token["reason"] == "competing_source_assignments"
            assert token["candidates"][0]["side"] == EXPECTED_SIDES[fixture][index]
            assert f"[待核:{token['name']}]" in line["text"]
            for conflict in token["source_conflicts"]:
                assert conflict["reason"] == "overlapping_character_regions"
                assert conflict["overlap_area"] > 0
                assert {s["row"] for s in conflict["sources"]} == {0, 1}
                assert conflict["targets"] == [{"line_index": 0, "token_index": index},
                                               {"line_index": 1, "token_index": index}]
                for source in conflict["sources"]:
                    assert source["box"] == raw["localization"][source["row"]]["glyphs"][source["glyph"]]["box"]


@pytest.mark.parametrize("fixture", EXPECTED_SIDES)
@pytest.mark.parametrize("separation", ["separate", "edge_touching", "one_shared_actor"])
def test_independent_physical_actors_remain_eligible(fixture, separation):
    raw, strip = real_source(fixture)
    duplicate_source(raw)
    first, second = raw["localization"]
    boxes = np.asarray([g["box"] for g in first["glyphs"]])
    offset = int(boxes[:, :, 1].max() - boxes[:, :, 1].min()) if separation == "edge_touching" else strip.shape[0] + 3
    image = np.full((offset + strip.shape[0], strip.shape[1], 3), 255, dtype=np.uint8)
    image[:strip.shape[0]] = strip
    image[offset:] = strip
    closing = next(i for i, glyph in enumerate(second["glyphs"]) if glyph["text"] == "]")
    for index, glyph in enumerate(second["glyphs"]):
        if separation != "one_shared_actor" or index > closing:
            glyph["box"] = (np.asarray(glyph["box"]) + [0, offset]).tolist()
    lines = tag_transcript(raw["glm_text"], raw["localization"], image, NAMES)
    for line in lines:
        for index, token in enumerate(line["tokens"]):
            if separation == "one_shared_actor" and index == 0:
                assert token["side"] is None
                assert token["reason"] == "competing_source_assignments"
                assert token["source_conflicts"]
            else:
                assert token["side"] == EXPECTED_SIDES[fixture][index]
                assert "source_conflicts" not in token


@pytest.mark.parametrize("shift,conflict", [(3, True), (4, False), (5, False)])
def test_polygon_interiors_not_bounding_rectangles_determine_physical_reuse(shift, conflict):
    event = "[张宝]开始行动"
    _, rows = localized(event * 2, {})
    polygon = np.array([[0, 0], [4, 0], [14, 20], [10, 20]])
    for occurrence in range(2):
        for char in range(2):
            glyph = rows[0]["glyphs"][occurrence * len(event) + char + 1]
            glyph["box"] = (polygon + [char * 20 + occurrence * shift, 0]).tolist()
    image = np.full((24, 50, 3), BLUE, dtype=np.uint8)
    lines = tag_transcript(event + "\n" + event, rows, image, NAMES)
    for line in lines:
        token, = line["tokens"]
        assert token["side"] == (None if conflict else "我方")
        assert bool(token.get("source_conflicts")) is conflict


@pytest.mark.parametrize("box", [
    [[20, 3], [25, 15], [30, 27], [35, 39]],
    [[20, 3], [40, 3], [40, 39], [40, 39]],
    [[20, 3], [40, 3], [30, 15], [20, 39]],
    [[20, 3], [40, 3]],
    [["bad", 3]] * 4,
    [[1e100, 3]] * 4,
])
def test_unusable_character_regions_cannot_supply_a_side(box):
    raw, image = real_source("mixed-names")
    raw["localization"][0]["glyphs"][1]["box"] = box
    line, = tag_transcript(raw["glm_text"], raw["localization"], image, NAMES)
    assert line["text"] == "[待核:皇甫嵩]对[敌方:刘表]发动普通攻击"
    character = line["tokens"][0]["candidates"][0]["characters"][0]
    assert character["reason"] == "invalid_geometry"
    assert character["side"] is None
    assert character["box"] == box


@pytest.mark.parametrize("fixture", EXPECTED_SIDES)
@pytest.mark.parametrize("close_outer", [False, True])
@pytest.mark.parametrize("split_rows", [False, True])
def test_nested_source_actors_never_promote_balanced_inner_names(fixture, close_outer, split_rows):
    raw, image = real_source(fixture)
    nested_source(raw, close_outer)
    source_text = raw["localization"][0]["text"]
    if split_rows:
        raw["localization"] = [{"text": g["text"], "glyphs": [g]}
                               for g in raw["localization"][0]["glyphs"]]
    line, = tag_transcript(raw["glm_text"], raw["localization"], image, NAMES)
    for index, token in enumerate(line["tokens"]):
        if close_outer and index == 1:
            assert token["side"] == EXPECTED_SIDES[fixture][index]
            continue
        assert token["side"] is None
        assert token["reason"] == "source_actor_boundary_mismatch"
        assert f"[待核:{token['name']}]" in line["text"]
        candidate, = token["candidates"]
        assert candidate["side"] is None
        actor, = candidate["source_actors"]
        assert actor["reason"] == "nested_source_actor"
        assert actor["raw_actor"] == (source_text[:source_text.index("]]") + 2] if close_outer else source_text)
        assert all(c["blue_pixels"] + c["red_pixels"] > 0 and c["score"] > 0.8
                   for c in candidate["characters"])


@pytest.mark.parametrize("fixture", EXPECTED_SIDES)
def test_outer_malformed_group_taints_every_enclosed_actor_and_warning_hint(fixture):
    raw, image = real_source(fixture)
    row = raw["localization"][0]
    row["glyphs"].insert(0, deepcopy(row["glyphs"][0]))
    closing = next(g for g in row["glyphs"] if g["text"] == "]")
    row["glyphs"].append(deepcopy(closing))
    row["text"] = "".join(g["text"] for g in row["glyphs"])
    line, = tag_transcript(raw["glm_text"], raw["localization"], image, set())
    for token in line["tokens"]:
        assert token["side"] is None
        actor, = token["candidates"][0]["source_actors"]
        assert actor["reason"] == "nested_source_actor"
        assert actor["raw_actor"] == row["text"]
    bare = raw["glm_text"].replace("[", "").replace("]", "")
    line, = tag_transcript(bare, raw["localization"], image, set())
    assert line["text"] == bare
    assert line["tokens"] == []
    assert line["unparsed_names"] == []


@pytest.mark.parametrize("close_outer", [False, True])
def test_malformed_source_actor_is_not_a_warning_hint_for_an_invented_inner_name(close_outer):
    raw, image = real_source("mixed-names")
    nested_source(raw, close_outer)
    line, = tag_transcript("甫嵩对[刘表]发动普通攻击", raw["localization"], image, set())
    assert line["unparsed_names"] == []
    assert line["text"].startswith("甫嵩对[")
    assert line["tokens"][0]["side"] == ("敌方" if close_outer else None)
