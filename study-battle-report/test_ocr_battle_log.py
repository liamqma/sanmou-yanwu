import importlib.util
from pathlib import Path

import numpy as np
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


def test_battle_filename_starts_with_capture_date():
    lines = [
        "列队布阵", "行动顺序判断完毕",
        "[我方:张辽]开始行动", "[我方:关羽]开始行动",
        "[我方:刘备]开始行动", "[敌方:曹操]开始行动",
        "[敌方:张飞]开始行动", "[敌方:赵云]开始行动", "胜利！",
    ]
    filename = ocr.battle_filename(
        lines, 1, {}, ["张辽", "关羽", "刘备", "曹操", "张飞", "赵云"],
        "2026-09-19")
    assert filename.startswith("2026-09-19 - ")


def test_battle_skill_summary_excludes_signature_skill():
    lines = [
        "[我方:张辽]发动战法【风袭逍遥】",
        "[我方:张辽]发动战法【横征暴敛】",
        "[敌方:曹操]发动战法【乱世奸雄】",
    ]
    summary = ocr.battle_skill_lines(
        lines, ["张辽"], ["曹操"],
        {"张辽": "风袭逍遥", "曹操": "乱世奸雄"})
    assert "我方：" in summary
    assert "敌方：" in summary
    assert "我方：张辽" not in summary
    assert "  张辽：横征暴敛" in summary
    assert "  曹操：（无记录）" in summary


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


BLUE_BGR = (230, 120, 40)
RED_BGR = (40, 40, 230)


def _row_box(x0, y0, x1, y1):
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float32)


def test_row_colour_is_read_from_its_own_box_not_the_row_below():
    crop = np.zeros((200, 600, 3), dtype=np.uint8)
    crop[50:80, 10:90] = BLUE_BGR    # this row's owner name
    crop[95:125, 10:90] = RED_BGR    # next row, opposing side
    assert ocr.classify_color(crop, _row_box(5, 48, 500, 82)) == "我方"


def test_row_colour_ignores_the_opposing_target_name():
    crop = np.zeros((100, 900, 3), dtype=np.uint8)
    crop[30:60, 10:80] = BLUE_BGR     # "[陆抗]"
    crop[30:60, 150:260] = RED_BGR    # "由于[张宝]" target, larger
    assert ocr.classify_color(crop, _row_box(5, 28, 850, 62)) == "我方"


def test_mirror_hero_keeps_per_line_sides_despite_lopsided_counts():
    lines = [
        "[敌方:张宝]的【造成伤害】提升12.00%(12.00%)",
        "[我方:张宝]的【造成伤害】提升12.00%(12.00%)",
        *["[我方:张宝]发动战法【妖风大作】"] * 5,
        "[敌方:张宝]损失了兵力117(1072)",
    ]
    fixed, _, corrected, _ = ocr.backfill_sides(lines)
    assert fixed == lines
    assert corrected == 0


def test_sub_effect_suffix_survives_canonical_snapping():
    db = {"heroes": ["张宝"], "skills": ["明其虚实", "诱敌深入"],
          "formations": [], "bonds": []}
    assert ocr.correct_brackets("[张宝]的「明其虚实-取」效果已消失", db) \
        == "[张宝]的「明其虚实-取」效果已消失"
    assert ocr.correct_brackets("[陆抗]的【诱敌深人-伏兵】的【伏兵数量】", db) \
        .startswith("[陆抗]的【诱敌深入-伏兵】")


def _raw(text, x0, y0, x1, y1, score=1.0):
    return {"text": text, "score": score,
            "box": _row_box(x0, y0, x1, y1).tolist()}


def test_split_row_pieces_join_left_to_right_around_icon_noise():
    raw = [
        _raw("【妖风大作】的「妖风大作」效果", 262, 1081, 699, 1114),
        _raw("X", 5, 1082, 40, 1113),
        _raw("[张宝]执行来自", 57, 1081, 262, 1115),
        _raw("[张宝]由于[张宝]", 55, 823, 290, 859),
        _raw("]【决水破敌】的「决水破敌」效果,损失了", 274, 824, 819, 857),
    ]
    assert [entry["text"] for entry in ocr.join_row_fragments(raw)] == [
        "[张宝]由于[张宝]【决水破敌】的「决水破敌」效果,损失了",
        "X",
        "[张宝]执行来自【妖风大作】的「妖风大作」效果",
    ]


def test_highlight_card_collapses_to_one_owned_row():
    raw = [
        _raw("智冠群雄", 368, 28, 571, 80),
        _raw("高额伤害7668", 367, 93, 559, 128),
        _raw("张宝", 166, 103, 238, 146),
        _raw("张宝]开始行动", 47, 196, 239, 231),
    ]
    rows = ocr.collapse_highlight_cards(raw)
    assert [entry["text"] for entry in rows] == [
        "张宝]开始行动", "[张宝]高光：智冠群雄，高额伤害7668"]
    assert rows[1]["box"] == raw[2]["box"]


def test_wrapped_entries_rejoin():
    heroes = ["张宝", "陆抗", "步练师"]
    assert ocr.merge_fragments([
        "[敌方:张宝]由于[张宝]【潜龙在渊】的「潜龙在渊-潜伏」效果[",
        "[敌方:张宝]无法进行普通攻击",
        "[敌方:张宝]由于[我方:陆抗]【决堰倾涛】的「虚弱」效果造成伤害减",
        "少70%",
        "[敌方:步练师]由于[我方:陆抗]【诱敌深入】的「逃兵」效果,损失了兵",
        "力66(9934)",
        "[我方:于吉]由于[张宝]【妖风大作】的「妖风大作」效果,损失了",
        "X",
        "兵力995(6397)",
    ], heroes) == [
        "[敌方:张宝]由于[张宝]【潜龙在渊】的「潜龙在渊-潜伏」效果"
        "[敌方:张宝]无法进行普通攻击",
        "[敌方:张宝]由于[我方:陆抗]【决堰倾涛】的「虚弱」效果造成伤害减少70%",
        "[敌方:步练师]由于[我方:陆抗]【诱敌深入】的「逃兵」效果,损失了兵力66(9934)",
        "[我方:于吉]由于[张宝]【妖风大作】的「妖风大作」效果,损失了兵力995(6397)",
    ]


def test_single_row_frame_edge_overlap_is_not_repeated():
    previous = [
        ("[敌方:于吉]开始行动", 1712.0),
        ("[敌方:于吉]的「嘲讽」效果已消失", 1758.0),
    ]
    current = [
        ("[敌方:于吉]的「嘲讽」效果已消失", 26.0),
        ("[敌方:于吉]发动战法【风急雨晦】", 72.0),
    ]
    assert ocr.select_new_frame_lines(previous, current) == [
        "[敌方:于吉]发动战法【风急雨晦】"]


def test_stitching_dedupes_short_rows_and_prefers_clean_edge_reads():
    db = {"heroes": ["于吉", "陆抗", "张宝"]}
    frames = [
        ("battle_detail_1.png", [
            ("[敌方:于吉]由于[我方:陆抗]【决堰倾涛】的「虚弱」效果造成伤害减", 1300.0),
            ("少70%", 1336.0),
            ("[我方:张宝]的「风暴」效果已消失", 1650.0),
            ("[我方:陆抗]的「妖术」效果已消失", 1700.0),
            ("[陆坑1的【奇谋伤害】提升1500%(150.00%)", 1757.0),
        ]),
        ("battle_detail_2.png", [
            ("张宝执行未百【陷元养晦】的效果", 8.0),
            ("[敌方:于吉]由于[我方:陆抗]【决堰倾涛】的「虚弱」效果造成伤害减", 100.0),
            ("少70%", 136.0),
            ("[我方:张宝]的「风暴」效果已消失", 450.0),
            ("[我方:陆抗]的「妖术」效果已消失", 500.0),
            ("[我方:陆抗]的【奇谋伤害】提升15.00%(150.00%)", 557.0),
            ("[我方:于吉]的「风暴」效果已消失", 603.0),
        ]),
    ]
    assert ocr.stitch_battle(frames, db) == [
        "[敌方:于吉]由于[我方:陆抗]【决堰倾涛】的「虚弱」效果造成伤害减少70%",
        "[我方:张宝]的「风暴」效果已消失",
        "[我方:陆抗]的「妖术」效果已消失",
        "[我方:陆抗]的【奇谋伤害】提升15.00%(150.00%)",
        "[我方:于吉]的「风暴」效果已消失",
    ]
