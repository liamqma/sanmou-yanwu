from __future__ import annotations

from pathlib import Path

from parse_events import parse_lines
from provenance import align_log_lines
from replay_state import replay_events
from schema import validate_state_snapshot


FIXTURES = Path(__file__).parent / "fixtures"


def replayed_fixture() -> list[dict]:
    lines, _ = align_log_lines(
        "fixture",
        FIXTURES / "log_excerpt.txt",
        FIXTURES / "cache_excerpt.json",
        {"乐进", "糜夫人"},
    )
    for line in lines:
        for item in line["entity_side_provenance"]:
            if item["displayed_side"] is not None:
                item["side_source"] = "direct_token_colour"
    events, _ = parse_lines("fixture", lines, {"乐进", "糜夫人"})
    snapshots, _ = replay_events("fixture", events)
    return snapshots


def test_replay_tracks_displayed_components_without_erasing_precision_residual() -> None:
    snapshots = replayed_fixture()
    summer = [
        snapshot
        for snapshot in snapshots
        if snapshot["subject_key"] == "我方:夏侯渊"
        and snapshot["event_type"] == "percent_change"
    ]

    assert len(summer) == 3
    assert summer[1]["transition"]["previous_total_displayed"] == 14.0
    assert summer[1]["transition"]["display_additive_residual"] == 0.0
    assert summer[2]["transition"]["display_additive_residual"] == 0.01
    assert summer[2]["state_after"]["percentages"]["造成伤害"] == 41.64
    assert len(summer[2]["state_after"]["component_ledger"]) == 3
    for snapshot in snapshots:
        validate_state_snapshot(snapshot)


def test_replay_skips_ambiguous_mirror_identity() -> None:
    mirror = next(
        snapshot
        for snapshot in replayed_fixture()
        if snapshot["event_id"] == "fixture:L0005"
    )

    assert mirror["state_status"] == "skipped_mirror_ambiguous"
    assert mirror["subject_key"] is None
    assert mirror["state_before"] is None
    assert mirror["state_after"] is None
    assert mirror["transition"]["mutation_applied"] is False


def test_replay_skips_inferred_side_identity() -> None:
    text = "[我方:甲]的【造成伤害】提升1%（1%）"
    line = {
        "final_line_no": 1,
        "final_log_text": text,
        "alignment_status": "exact",
        "lineage_status": "deterministic_heuristic_v2",
        "entity_side_provenance": [
            {
                "entity_index": 0,
                "name": "甲",
                "displayed_side": "我方",
                "side_source": "inferred_side_backfill",
            }
        ],
        "anomalies": [],
        "uncertainties": ["one_or_more_entity_sides_inferred"],
    }

    event = parse_lines("inferred", [line], set())[0][0]
    snapshots, quality = replay_events("inferred", [event])

    assert event["actor"]["observed_side"] == "我方"
    assert event["actor"]["resolved_side"] is None
    assert event["actor"]["side_status"] == "inferred"
    assert event["actor"]["side_source"] == "inferred_side_backfill"
    assert snapshots[0]["state_status"] == "skipped_inferred_side"
    assert snapshots[0]["subject_key"] is None
    assert snapshots[0]["transition"]["mutation_applied"] is False
    assert quality["tracked_subject_count"] == 0


def test_replay_retains_censor_relation_in_damage_snapshot() -> None:
    damage = next(
        snapshot
        for snapshot in replayed_fixture()
        if snapshot["event_id"] == "fixture:L0007"
    )

    assert damage["transition"]["troops_before_inferred"] == 4190
    assert damage["transition"]["true_damage_relation"] == ">=4190"
