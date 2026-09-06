from __future__ import annotations

from pathlib import Path

from parse_events import parse_lines
from provenance import align_log_lines
from schema import validate_event


FIXTURES = Path(__file__).parent / "fixtures"


def parsed_fixture() -> list[dict]:
    lines, _ = align_log_lines(
        "fixture",
        FIXTURES / "log_excerpt.txt",
        FIXTURES / "cache_excerpt.json",
        {"乐进", "糜夫人"},
    )
    events, _ = parse_lines("fixture", lines, {"乐进", "糜夫人"})
    return events


def test_parser_keeps_unknown_event_original_and_source_line() -> None:
    events = parsed_fixture()

    assert len(events) == 9
    unknown = events[7]
    assert unknown["event_type"] == "unknown"
    assert unknown["parse_status"] == "unknown"
    assert unknown["raw_text"] == "完全无法解析的碎片"
    assert unknown["source_lines"] == [8]
    assert unknown["analysis_eligibility"] == "excluded_unknown"
    for event in events:
        validate_event(event)


def test_parser_marks_lethal_damage_as_right_censored() -> None:
    lethal = parsed_fixture()[6]

    assert lethal["event_type"] == "damage"
    assert lethal["damage"] == 4190
    assert lethal["troops_after"] == 0
    assert lethal["is_lethal_censored"] is True
    assert lethal["censoring"] == {"kind": "right", "lower_bound": 4190}
    assert lethal["analysis_eligibility"] == "censored_likelihood_only"


def test_parser_does_not_force_resolve_mirror_sides() -> None:
    attack = parsed_fixture()[5]

    assert attack["event_type"] == "normal_attack"
    assert attack["actor"]["name"] == "糜夫人"
    assert attack["actor"]["observed_side"] == "我方"
    assert attack["actor"]["resolved_side"] is None
    assert attack["actor"]["side_status"] == "mirror_ambiguous"
    assert attack["target"]["name"] == "乐进"
    assert attack["target"]["resolved_side"] is None


def test_damage_without_actor_skill_cause_is_partial_not_fit_eligible() -> None:
    line = {
        "final_line_no": 1,
        "final_log_text": "[我方:夏侯渊]损失了兵力100(9900)",
        "anomalies": [],
        "uncertainties": [],
    }

    event = parse_lines("fixture", [line], set())[0][0]
    assert event["event_type"] == "damage"
    assert event["parse_status"] == "partial"
    assert event["analysis_eligibility"] == "excluded_partial_parse"
    assert "damage_skill_missing" in event["uncertainties"]
    assert "damage_source_or_target_incomplete" in event["uncertainties"]
