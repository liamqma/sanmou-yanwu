import importlib.util
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).with_name("ocr_battle_log.py")
SPEC = importlib.util.spec_from_file_location("ocr_battle_log", MODULE_PATH)
ocr = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ocr)


def test_ambiguous_known_observation_is_preserved():
    damaged = "[张辽]由于[张宁1大平金响】的「大平全响」效里损告了"
    repaired = ocr.merge_fragments([damaged], ["张辽", "张宁"])
    assert len(repaired) == 1
    assert repaired[0].startswith("OCR不确定：")
    assert "大平金响" in repaired[0]


def test_single_repeated_event_cannot_discard_current_prefix():
    previous = [("[我方:张辽]开始行动", 1000.0)]
    current = [
        ("[敌方:曹操]损失了兵力100(900)", 200.0),
        ("[我方:张辽]开始行动", 400.0),
    ]
    assert ocr.select_new_frame_lines(previous, current) == [
        line for line, _ in current]


def test_stationary_duplicate_frame_is_not_appended():
    frame = [
        ("[我方:张辽]开始行动", 100.0),
        ("[敌方:曹操]损失了兵力100(900)", 200.0),
    ]
    assert ocr.select_new_frame_lines(frame, list(frame)) == []


def test_stationary_mirror_frame_preserves_side_identity():
    previous = [("[我方:张辽]开始行动", 100.0)]
    current = [("[敌方:张辽]开始行动", 100.0)]
    assert ocr.select_new_frame_lines(previous, current) == [
        "[敌方:张辽]开始行动"]


def test_unmatched_event_between_overlap_anchors_is_preserved():
    previous = [
        ("[我方:张辽]开始行动", 1000.0),
        ("[敌方:曹操]开始行动", 1200.0),
    ]
    current = [
        ("[我方:张辽]开始行动", 200.0),
        ("[敌方:曹操]损失了兵力100(900)", 300.0),
        ("[敌方:曹操]开始行动", 400.0),
    ]
    assert ocr.select_new_frame_lines(previous, current) == [
        "[敌方:曹操]损失了兵力100(900)"]


def test_numeric_continuation_survives_a_frame_seam():
    frames = [
        ("battle_detail_1.png", [
            ("[我方:张辽]损失了兵力219(479", 100.0),
        ]),
        ("battle_detail_2.png", [("8)", 100.0)]),
    ]
    lines = ocr.stitch_battle(frames, {"heroes": ["张辽"]})
    assert lines == ["[我方:张辽]损失了兵力219(4798)"]


def test_incomplete_number_is_not_completed_from_a_later_event():
    frames = [
        ("battle_detail_1.png", [
            ("[我方:张辽]损失了兵力219(47", 100.0),
        ]),
        ("battle_detail_2.png", [
            ("[我方:张辽]损失了兵力219(4700)", 100.0),
        ]),
    ]
    lines = ocr.stitch_battle(frames, {"heroes": ["张辽"]})
    assert lines[0].startswith("OCR不确定：")
    assert "损失了兵力21947" in lines[0]
    assert lines[1] == "[我方:张辽]损失了兵力219(4700)"


def test_ambiguous_content_after_result_fails_closed():
    frames = [
        ("battle_detail_1.png", [("平局！", 100.0)]),
        ("battle_detail_2.png", [("行动顺序判新完毕", 100.0)]),
    ]
    with pytest.raises(ValueError, match="ambiguous content"):
        ocr.split_battle_frames(frames)


def test_time_gap_alone_does_not_split_an_opening():
    opening = [("行动顺序判断完毕", 100.0), ("列队布阵", 200.0)]
    frames = [
        ("battle_detail_1.png", opening),
        ("battle_detail_60001.png", opening),
    ]
    assert len(ocr.split_battle_frames(frames)) == 1


def test_distinct_opening_before_previous_result_fails_closed():
    frames = [
        ("battle_detail_1.png", [
            ("列队布阵", 50.0),
            ("行动顺序判断完毕", 100.0),
            ("[我方:张辽]开始行动", 200.0),
        ]),
        ("battle_detail_2.png", [
            ("列队布阵", 50.0),
            ("行动顺序判断完毕", 100.0),
            ("[我方:关羽]开始行动", 200.0),
        ]),
    ]
    with pytest.raises(ValueError, match="before the current battle result"):
        ocr.split_battle_frames(frames)


def test_roster_uses_canonical_database_names():
    heroes = ["张辽", "关羽", "刘备", "曹操", "张飞", "赵云"]
    lines = [
        "[我方:张了]队当前补给值为100",
        "[我方:张辽]开始行动",
        "[我方:关羽]开始行动",
        "[我方:刘备]开始行动",
        "[敌方:曹操]开始行动",
        "[敌方:张飞]开始行动",
        "[敌方:赵云]开始行动",
    ]
    corrected = ocr.correct_roster_references(lines, heroes)
    assert ocr.roster_from_log(corrected, "我方", heroes) == [
        "张辽", "关羽", "刘备"]


@pytest.mark.parametrize(
    ("result", "expected"),
    [
        ("我方全部武将兵力为0，无法再战，敌方胜利！", "敌方胜"),
        ("敌方全部武将兵力为0，无法再战，我方胜利！", "我方胜"),
        ("失败！", "敌方胜"),
        ("胜利！", "我方胜"),
        ("平局！", "平局"),
    ],
)
def test_explicit_terminal_outcome_takes_precedence(result, expected):
    lines = ["[敌方:曹操]兵力为0无法再战", result]
    assert ocr.battle_outcome(lines) == expected


def test_unknown_outcome_cannot_be_published():
    lines = ["行动顺序判断完毕", "战斗结束！"]
    with pytest.raises(ValueError, match="胜负未知"):
        ocr.validate_battle_lines(lines)


def test_incomplete_roster_cannot_be_published():
    lines = [
        "列队布阵",
        "行动顺序判断完毕",
        "[我方:张辽]开始行动",
        "[我方:关羽]开始行动",
        "[敌方:曹操]开始行动",
        "[敌方:张飞]开始行动",
        "[敌方:赵云]开始行动",
        "平局！",
    ]
    heroes = ["张辽", "关羽", "刘备", "曹操", "张飞", "赵云"]
    with pytest.raises(ValueError, match="我方=2/3, 敌方=3/3"):
        ocr.validate_battle_lines(lines, heroes)
    with pytest.raises(ValueError, match="incomplete rosters"):
        ocr.battle_filename(lines, 1, {}, heroes)


def test_malformed_trailing_hero_fragment_is_preserved_as_uncertain():
    observed = "[张辽]由于【技能】效果[曹操"
    lines = ocr.merge_fragments([observed], ["张辽", "曹操"])
    assert len(lines) == 1
    assert lines[0].startswith("OCR不确定：")
    assert "张辽由于技能效果曹操" in lines[0]


def test_unreadable_image_fails_closed(monkeypatch):
    monkeypatch.setattr(ocr.cv2, "imread", lambda _path: None)
    with pytest.raises(ValueError, match="unreadable screenshot: broken.png"):
        ocr.load_image("broken.png")


def test_cache_is_addressed_by_content_not_filename(tmp_path):
    raw = [{"text": "行动顺序判断完毕", "score": 1.0, "box": []}]
    cache = ocr.empty_ocr_cache()
    ocr.store_cached_raw(cache, "old-name.png", "digest", raw)
    assert ocr.cached_raw(cache, "digest") == raw
    ocr.store_cached_raw(cache, "renamed.png", "digest", raw)
    assert cache["images"] == {
        "old-name.png": "digest",
        "renamed.png": "digest",
    }
    assert len(cache["observations"]) == 1
