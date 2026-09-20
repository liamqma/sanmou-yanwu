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


def test_opposite_side_rows_are_not_overlap_duplicates():
    previous = [
        ("[我方:张辽]开始行动", 1000.0),
        ("[我方:张辽]发动战法【突击】", 1100.0),
    ]
    current = [
        ("[敌方:张辽]开始行动", 200.0),
        ("[敌方:张辽]发动战法【突击】", 300.0),
    ]
    assert ocr.select_new_frame_lines(previous, current) == [
        text for text, _ in current]


def test_numeric_damage_change_is_not_an_overlap_duplicate():
    previous = [
        ("[敌方:曹操]损失了兵力100(900)", 1000.0),
        ("[我方:张辽]开始行动", 1200.0),
    ]
    current = [
        ("[敌方:曹操]损失了兵力200(700)", 200.0),
        ("[我方:张辽]开始行动", 400.0),
    ]
    assert ocr.select_new_frame_lines(previous, current) == [
        text for text, _ in current]


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
    assert lines[0] == "OCR不确定：[我方:张辽]损失了兵力219(47"
    assert lines[1] == "[我方:张辽]损失了兵力219(4700)"


def test_ambiguous_content_after_result_fails_closed():
    frames = [
        ("battle_detail_1.png", [("平局！", 100.0)]),
        ("battle_detail_2.png", [("行动顺序判新完毕", 100.0)]),
    ]
    with pytest.raises(ValueError, match="ambiguous content"):
        ocr.split_battle_frames(frames)


def test_opposite_side_overlap_after_result_fails_closed():
    frames = [
        ("battle_detail_1.png", [
            ("[我方:张辽]开始行动", 100.0),
            ("[我方:张辽]发动战法【突击】", 200.0),
            ("平局！", 300.0),
        ]),
        ("battle_detail_2.png", [
            ("[敌方:张辽]开始行动", 100.0),
            ("[敌方:张辽]发动战法【突击】", 200.0),
        ]),
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


def test_ambiguous_four_hero_roster_cannot_be_published():
    lines = [
        "列队布阵",
        "行动顺序判断完毕",
        "[我方:张辽]开始行动",
        "[我方:关羽]开始行动",
        "[我方:刘备]开始行动",
        "[我方:马超]开始行动",
        "[敌方:曹操]开始行动",
        "[敌方:张飞]开始行动",
        "[敌方:赵云]开始行动",
        "平局！",
    ]
    heroes = ["张辽", "关羽", "刘备", "马超", "曹操", "张飞", "赵云"]
    with pytest.raises(ValueError, match="我方=4/3, 敌方=3/3"):
        ocr.validate_battle_lines(lines, heroes)


def test_unresolved_tagged_roster_owner_cannot_be_published():
    lines = [
        "列队布阵",
        "行动顺序判断完毕",
        "[我方:张辽]开始行动",
        "[我方:关羽]开始行动",
        "[我方:刘备]开始行动",
        "[我方:马趄]开始行动",
        "[敌方:曹操]开始行动",
        "[敌方:张飞]开始行动",
        "[敌方:赵云]开始行动",
        "平局！",
    ]
    heroes = ["张辽", "关羽", "刘备", "曹操", "张飞", "赵云"]
    with pytest.raises(ValueError, match="unresolved.*我方:马趄"):
        ocr.validate_battle_lines(lines, heroes)


def test_fuzzy_repair_cannot_hide_damaged_fourth_roster_owner():
    lines = [
        "列队布阵",
        "行动顺序判断完毕",
        "[我方:张辽]开始行动",
        "[我方:关羽]开始行动",
        "[我方:刘备]开始行动",
        "[我方:关半]开始行动",
        "[敌方:曹操]开始行动",
        "[敌方:张飞]开始行动",
        "[敌方:赵云]开始行动",
        "平局！",
    ]
    heroes = ["张辽", "关羽", "刘备", "曹操", "张飞", "赵云"]
    corrected = ocr.correct_roster_references(lines, heroes)
    assert "[我方:关半]开始行动" in corrected
    with pytest.raises(ValueError, match="unresolved roster owner.*我方:关半"):
        ocr.validate_battle_lines(corrected, heroes)


def test_raw_roster_owner_is_validated_before_fuzzy_repair():
    processed = ocr.process_line(
        "[张辽1]开始行动", ocr.np.array([]), None, {"heroes": ["张辽"]})
    assert processed == "OCR不确定：[张辽1]开始行动"


def test_uncertain_roster_row_cannot_be_published():
    lines = [
        "列队布阵",
        "行动顺序判断完毕",
        "[我方:张辽]开始行动",
        "[我方:关羽]开始行动",
        "[我方:刘备]开始行动",
        "OCR不确定：[我方:关半]开始行动",
        "[敌方:曹操]开始行动",
        "[敌方:张飞]开始行动",
        "[敌方:赵云]开始行动",
        "平局！",
    ]
    heroes = ["张辽", "关羽", "刘备", "曹操", "张飞", "赵云"]
    with pytest.raises(ValueError, match="unresolved roster owner.*关半"):
        ocr.validate_battle_lines(lines, heroes)


def test_unresolved_non_roster_reference_is_marked_uncertain():
    observed = "[敌方:呈角高]时【车令】提升(8)"
    corrected = ocr.correct_roster_references(
        ["[敌方:曹操]开始行动", observed], ["曹操"])
    assert corrected[1] == "OCR不确定：" + observed


def test_malformed_trailing_hero_fragment_is_preserved_as_uncertain():
    observed = "[张辽]由于【技能】效里损告[曹操"
    lines = ocr.merge_fragments([observed], ["张辽", "曹操"])
    assert len(lines) == 1
    assert lines[0] == "OCR不确定：" + observed

    side_fixed, _, _, _ = ocr.backfill_sides([
        "[我方:张辽]开始行动", lines[0]])
    assert side_fixed[1] == "OCR不确定：" + observed
    assert ocr.correct_roster_references(
        side_fixed, ["张辽", "曹操"])[1] == "OCR不确定：" + observed


def test_uncertain_unbalanced_line_is_not_prefixed_twice():
    observed = "OCR不确定：[张辽"
    assert ocr.merge_fragments([observed], ["张辽"]) == [observed]


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


def test_capture_date_uses_only_the_calendar_date():
    assert ocr.capture_date("battle_detail_1789820134055.png") == "2026-09-19"


def test_invalidating_outputs_keeps_non_generated_files(tmp_path):
    logs = tmp_path / "battle_logs"
    logs.mkdir()
    (logs / "old.txt").write_text("stale", encoding="utf-8")
    (logs / ".manifest.json").write_text("[]", encoding="utf-8")
    (logs / "notes.md").write_text("keep", encoding="utf-8")

    ocr.invalidate_published_logs(str(logs))

    assert not (logs / "old.txt").exists()
    assert not (logs / ".manifest.json").exists()
    assert (logs / "notes.md").read_text(encoding="utf-8") == "keep"
