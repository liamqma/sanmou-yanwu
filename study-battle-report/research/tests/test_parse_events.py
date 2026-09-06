from __future__ import annotations

import re
from pathlib import Path

from parse_events import parse_lines
from provenance import align_log_lines
from schema import validate_event


FIXTURES = Path(__file__).parent / "fixtures"
_ENTITY_RE = re.compile(r"\[(?:(我方|敌方):)?([^\[\]]+)\]")


def _direct_side_provenance(text: str) -> list[dict]:
    return [
        {
            "entity_index": entity_index,
            "name": name,
            "displayed_side": side or None,
            "side_source": "direct_token_colour" if side else "missing",
        }
        for entity_index, (side, name) in enumerate(_ENTITY_RE.findall(text))
    ]


def _complete_damage_line(
    alignment_status: str,
    lineage_status: str,
) -> dict:
    return {
        "final_line_no": 1,
        "final_log_text": (
            "[我方:夏侯渊]由于[敌方:祝融]【弓腰姬】的「弓腰姬」效果,"
            "损失了兵力100（900）"
        ),
        "alignment_status": alignment_status,
        "lineage_status": lineage_status,
        "entity_side_provenance": _direct_side_provenance(
            "[我方:夏侯渊]由于[敌方:祝融]【弓腰姬】的「弓腰姬」效果,"
            "损失了兵力100（900）"
        ),
        "anomalies": [],
        "uncertainties": [],
    }


def _exact_line(text: str, line_no: int = 1) -> dict:
    return {
        "final_line_no": line_no,
        "final_log_text": text,
        "alignment_status": "exact",
        "lineage_status": "deterministic_v2",
        "entity_side_provenance": _direct_side_provenance(text),
        "anomalies": [],
        "uncertainties": [],
    }


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


def test_damage_with_missing_or_mirror_causal_side_is_not_fit_eligible() -> None:
    cases = (
        (
            "[我方:夏侯渊]由于[祝融]【弓腰姬】损失了兵力100（900）",
            set(),
            "excluded_unresolved_side",
        ),
        (
            "[我方:夏侯渊]由于[敌方:祝融]【弓腰姬】损失了兵力100（900）",
            {"祝融"},
            "excluded_mirror_side",
        ),
    )
    for text, mirror_names, expected_eligibility in cases:
        event = parse_lines(
            "fixture", [_exact_line(text)], mirror_names
        )[0][0]

        assert event["parse_status"] == "parsed"
        assert event["source"]["resolved_side"] is None
        assert event["analysis_eligibility"] == expected_eligibility
        assert "damage_causal_side_unresolved" in event["uncertainties"]


def test_damage_with_inferred_displayed_side_is_not_fit_eligible() -> None:
    line = _exact_line(
        "[我方:夏侯渊]由于[敌方:祝融]【弓腰姬】损失了兵力100（900）"
    )
    line["entity_side_provenance"][1]["side_source"] = (
        "inferred_side_backfill"
    )

    event = parse_lines("fixture", [line], set())[0][0]

    assert event["source"]["observed_side"] == "敌方"
    assert event["source"]["resolved_side"] is None
    assert event["source"]["side_status"] == "inferred"
    assert event["analysis_eligibility"] == "excluded_unresolved_side"


def test_damage_without_post_hit_troops_is_not_exact() -> None:
    line = _exact_line(
        "[我方:夏侯渊]由于[敌方:祝融]【弓腰姬】损失了兵力100"
    )

    event = parse_lines("fixture", [line], set())[0][0]

    assert event["troops_after"] is None
    assert event["is_lethal_censored"] is False
    assert event["analysis_eligibility"] == "excluded_missing_post_hit_troops"
    assert "damage_post_hit_troops_missing" in event["uncertainties"]


def test_unrelated_or_incomplete_parenthesis_is_not_post_hit_troops() -> None:
    suffixes = (
        "，此次伤害减少（50%）",
        "（50",
        "，其他字段(0)",
    )
    for suffix in suffixes:
        line = _exact_line(
            "[我方:夏侯渊]由于[敌方:祝融]【弓腰姬】"
            f"损失了兵力100{suffix}"
        )

        event = parse_lines("fixture", [line], set())[0][0]

        assert event["troops_after"] is None
        assert event["is_lethal_censored"] is False
        assert event["analysis_eligibility"] == "excluded_missing_post_hit_troops"


def test_adjacent_matching_death_proves_missing_post_hit_damage_is_censored() -> None:
    lines = [
        _exact_line(
            "[我方:夏侯渊]由于[敌方:祝融]【弓腰姬】损失了兵力100",
            1,
        ),
        _exact_line("[我方:夏侯渊]兵力为0，无法再战", 2),
    ]

    events, quality = parse_lines("fixture", lines, set())
    damage, death = events

    assert damage["troops_after"] is None
    assert damage["is_lethal_censored"] is True
    assert damage["censoring"] == {
        "kind": "right",
        "lower_bound": 100,
        "evidence_event_id": death["event_id"],
    }
    assert damage["analysis_eligibility"] == "censored_likelihood_only"
    assert "lethality_linked_from_adjacent_death_transition" in damage[
        "uncertainties"
    ]
    assert death["parent_action_id"] == damage["event_id"]
    assert quality["lethal_right_censored_count"] == 1
    validate_event(damage)
    validate_event(death)


def test_nonmatching_adjacent_death_does_not_infer_lethality() -> None:
    lines = [
        _exact_line(
            "[我方:夏侯渊]由于[敌方:祝融]【弓腰姬】损失了兵力100",
            1,
        ),
        _exact_line("[我方:乐进]兵力为0，无法再战", 2),
    ]

    damage, death = parse_lines("fixture", lines, set())[0]

    assert damage["is_lethal_censored"] is False
    assert damage["analysis_eligibility"] == "excluded_missing_post_hit_troops"
    assert death["parent_action_id"] is None


def test_heuristic_or_unresolved_damage_lineage_is_provenance_excluded() -> None:
    for lineage_status in (
        "deterministic_heuristic_v2",
        "unresolved_transform_mapping",
    ):
        line = _complete_damage_line("exact", lineage_status)

        event = parse_lines("fixture", [line], set())[0][0]

        assert event["parse_status"] == "parsed"
        assert (
            event["analysis_eligibility"]
            == "excluded_provenance_uncertainty"
        )


def test_candidate_damage_lineage_is_provenance_excluded_despite_exact_text() -> None:
    for lineage_status in (
        "legacy_v1_candidate_alignment",
        "v2_cache_candidate_alignment",
    ):
        line = _complete_damage_line("exact", lineage_status)

        event = parse_lines("fixture", [line], set())[0][0]

        assert event["parse_status"] == "parsed"
        assert (
            event["analysis_eligibility"]
            == "excluded_provenance_uncertainty"
        )


def test_fuzzy_ambiguous_or_unmatched_damage_alignment_is_provenance_excluded() -> None:
    for alignment_status in ("fuzzy", "ambiguous", "unmatched"):
        line = _complete_damage_line(alignment_status, "deterministic_v2")

        event = parse_lines("fixture", [line], set())[0][0]

        assert event["parse_status"] == "parsed"
        assert (
            event["analysis_eligibility"]
            == "excluded_provenance_uncertainty"
        )


def test_exact_deterministic_v2_damage_can_remain_fit_eligible() -> None:
    line = _complete_damage_line("exact", "deterministic_v2")

    event = parse_lines("fixture", [line], set())[0][0]

    assert event["event_type"] == "damage"
    assert event["parse_status"] == "parsed"
    assert event["is_lethal_censored"] is False
    assert event["analysis_eligibility"] == "eligible_exact_damage"
    validate_event(event)
