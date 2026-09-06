from __future__ import annotations

import json
from pathlib import Path

from provenance import align_log_lines
from schema import validate_line_observation


FIXTURES = Path(__file__).parent / "fixtures"


def test_alignment_preserves_final_text_and_missing_v1_provenance() -> None:
    lines, quality = align_log_lines(
        "fixture",
        FIXTURES / "log_excerpt.txt",
        FIXTURES / "cache_excerpt.json",
        {"乐进", "糜夫人"},
    )

    assert len(lines) == 9
    assert lines[1]["final_log_text"] == "[我方:夏侯渊]的【造成伤害】提升14.00%(14.00%)"
    assert lines[1]["final_line_no"] == 2
    assert lines[1]["alignment_status"] == "exact"
    assert lines[1]["source_observations"][0]["ocr_score"] == 0.98
    assert lines[1]["source_observations"][0]["raw_ocr_text"] is None
    assert lines[1]["source_observations"][0]["bbox"] is None
    assert "ocr_v1_raw_text_and_bbox_not_retained" in lines[1]["uncertainties"]

    unknown_source = lines[7]
    assert unknown_source["final_log_text"] == "完全无法解析的碎片"
    assert unknown_source["alignment_status"] == "unmatched"
    assert "provenance_unmatched" in unknown_source["anomalies"]
    assert quality["line_count"] == 9
    for line in lines:
        validate_line_observation(line)


def test_alignment_marks_mirror_and_same_side_attack_without_rewriting() -> None:
    lines, _ = align_log_lines(
        "fixture",
        FIXTURES / "log_excerpt.txt",
        FIXTURES / "cache_excerpt.json",
        {"乐进", "糜夫人"},
    )

    attack = lines[5]
    assert attack["final_log_text"] == "[我方:糜夫人]对[我方:乐进]发动普通攻击"
    assert "mirror_side_ambiguous" in attack["anomalies"]
    assert "same_side_attack_suspect" in attack["anomalies"]


def test_identical_exact_text_from_multiple_cache_sources_is_ambiguous(
    tmp_path: Path,
) -> None:
    text = "[我方:夏侯渊]的【造成伤害】提升14.00%(14.00%)"
    log_path = tmp_path / "battle_log.txt"
    cache_path = tmp_path / ".ocr_cache.json"
    log_path.write_text(text + "\n", encoding="utf-8")
    cache_path.write_text(
        json.dumps(
            {
                "battle_detail_001.png": [[text, 0.99]],
                "battle_detail_002.png": [[text, 0.98]],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    lines, quality = align_log_lines(
        "duplicate-source", log_path, cache_path, set()
    )

    assert lines[0]["alignment_status"] == "ambiguous"
    assert [source["image"] for source in lines[0]["source_observations"]] == [
        "battle_detail_001.png",
        "battle_detail_002.png",
    ]
    assert "multiple_possible_cache_sources" in lines[0]["uncertainties"]
    assert quality["alignment_status_counts"] == {"ambiguous": 1}
