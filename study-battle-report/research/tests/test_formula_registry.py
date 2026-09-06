from __future__ import annotations

from pathlib import Path

from evaluate import evaluate_corpus
from formula_registry import evaluate_ui_transitions, hidden_additive_feasible, registry_document
from parse_events import parse_lines
from provenance import align_log_lines
from replay_state import replay_events


FIXTURES = Path(__file__).parent / "fixtures"


def fixture_events_and_snapshots() -> tuple[list[dict], list[dict]]:
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
    return events, snapshots


def test_hidden_precision_interval_accepts_observed_rounding_difference() -> None:
    assert hidden_additive_feasible(35.09, 6.54, 41.64)

    _, snapshots = fixture_events_and_snapshots()
    results = {
        result["candidate_id"]: result
        for result in evaluate_ui_transitions(snapshots)["candidate_results"]
    }
    assert results["ui_hidden_precision_additive"]["violation_count"] == 0
    assert results["ui_exact_display_additive"]["violation_count"] == 1
    assert results["ui_independent_multiplicative"]["violation_count"] == 2


def _ui_snapshot(
    event_id: str, previous: float, signed_delta: float, observed_total: float
) -> dict:
    return {
        "event_id": event_id,
        "event_type": "percent_change",
        "state_status": "applied",
        "source_lines": [1],
        "transition": {
            "metric": "造成伤害",
            "previous_total_displayed": previous,
            "signed_delta_displayed": signed_delta,
            "observed_total_displayed": observed_total,
        },
    }


def test_hidden_precision_additive_fits_a_real_clipped_cap() -> None:
    evaluation = evaluate_ui_transitions(
        [_ui_snapshot("cap-100", 95.0, 10.0, 100.0)]
    )
    result = next(
        item
        for item in evaluation["candidate_results"]
        if item["candidate_id"] == "ui_hidden_precision_additive"
    )

    assert result["consistent_transition_count"] == 1
    assert result["violation_count"] == 0
    assert result["parameter_status"] == "feasible_all_transitions"
    assert result["shared_bounds"]["U"] == 100.0


def test_hidden_precision_additive_rejects_caps_without_shared_bounds() -> None:
    evaluation = evaluate_ui_transitions(
        [
            _ui_snapshot("cap-100", 95.0, 10.0, 100.0),
            _ui_snapshot("cap-90", 85.0, 10.0, 90.0),
        ]
    )
    result = next(
        item
        for item in evaluation["candidate_results"]
        if item["candidate_id"] == "ui_hidden_precision_additive"
    )

    assert result["consistent_transition_count"] == 1
    assert result["violation_count"] == 1
    assert result["parameter_status"] == "best_common_bounds_with_counterexamples"
    assert len(result["representative_violations"]) == 1


def test_fixed_registry_excludes_llm_selection() -> None:
    registry = registry_document()

    assert registry["selection_authority"] == "deterministic_numeric_evaluation_only"
    assert registry["llm_annotations_included"] is False
    assert {item["id"] for item in registry["families"]["reduction_curve"]} == {
        "reduction_linear_no_cap",
        "reduction_hard_cap",
        "reduction_exponential_soft_cap",
        "reduction_rational_soft_cap",
        "reduction_piecewise_diminishing",
    }


def _complete_source_manifest(battle_id: str) -> dict:
    return {
        "battle_id": battle_id,
        "experiment_session_id": f"{battle_id}-session",
        "game_metadata": {
            "season": 18,
            "game_build": "2026.03",
            "captured_at": "2026-03-01T00:00:00Z",
            "hero_levels": {"all": 50},
            "tactic_levels": {"all": 20},
            "equipment_and_strategy": {"recorded": True},
            "pre_battle_attributes": {"recorded": True},
            "supply": {"ours": 100, "enemy": 100},
        },
        "teams": {
            "ours": {
                "heroes": ["甲", "乙", "丙"],
                "formation": "阵一",
                "rows": ["front", "middle", "back"],
                "loadouts": {"甲": ["一", "二"]},
            },
            "enemy": {
                "heroes": ["丁", "戊", "己"],
                "formation": "阵二",
                "rows": ["front", "middle", "back"],
                "loadouts": {"丁": ["三", "四"]},
            },
        },
    }


def test_battle_metadata_gap_is_omitted_when_every_source_is_complete() -> None:
    evaluation = evaluate_corpus(
        [_complete_source_manifest("complete-a"), _complete_source_manifest("complete-b")],
        [],
        [],
    )

    assert "battle_metadata" not in {
        gap["id"] for gap in evaluation["unresolved_data_gaps"]
    }


def test_battle_metadata_gap_reports_only_missing_fields_from_all_sources() -> None:
    complete = _complete_source_manifest("complete")
    incomplete = _complete_source_manifest("incomplete")
    incomplete["game_metadata"]["tactic_levels"] = None
    incomplete["teams"]["enemy"]["rows"] = None

    evaluation = evaluate_corpus([complete, incomplete], [], [])
    metadata_gap = next(
        gap
        for gap in evaluation["unresolved_data_gaps"]
        if gap["id"] == "battle_metadata"
    )

    assert metadata_gap["missing_by_source"] == [
        {
            "battle_id": "incomplete",
            "experiment_session_id": "incomplete-session",
            "missing_fields": [
                "game_metadata.tactic_levels",
                "teams.enemy.rows",
            ],
        }
    ]
    assert "game_metadata.tactic_levels" in metadata_gap["required"]
    assert "teams.enemy.rows" in metadata_gap["required"]
    assert "game_metadata.game_build" not in metadata_gap["required"]
    assert "teams.ours.heroes" not in metadata_gap["required"]


def test_single_session_refuses_to_select_final_damage_formula() -> None:
    events, snapshots = fixture_events_and_snapshots()
    source_manifest = {
        "battle_id": "fixture",
        "experiment_session_id": "fixture-session",
    }

    evaluation = evaluate_corpus([source_manifest], events, snapshots)
    final_damage = evaluation["final_damage"]
    assert final_damage["status"] == "insufficient_independent_groups"
    assert final_damage["selected_formula"] is None
    assert final_damage["restored_formula_claim"] is False
    assert final_damage["cross_validation"]["status"] == "unavailable_insufficient_groups"
    assert evaluation["llm_annotations_included"] is False


def test_five_groups_are_ready_only_for_unimplemented_future_evaluation() -> None:
    events, snapshots = fixture_events_and_snapshots()
    source_manifests = [
        {
            "battle_id": f"fixture-{index}",
            "experiment_session_id": f"fixture-session-{index}",
        }
        for index in range(5)
    ]

    evaluation = evaluate_corpus(source_manifests, events, snapshots)
    final_damage = evaluation["final_damage"]
    assert final_damage["status"] == "ready_for_future_grouped_evaluation_not_implemented"
    assert final_damage["selected_formula"] is None
    assert final_damage["restored_formula_claim"] is False
    assert final_damage["cross_validation"]["status"] == "not_run_phase_one_not_implemented"
    assert final_damage["residual_analysis"]["status"] == "unavailable_no_fitted_model"
    assert final_damage["parameter_uncertainty"]["status"] == (
        "not_estimated_phase_one_not_implemented"
    )
    assert {candidate["status"] for candidate in final_damage["candidates"]} == {
        "not_evaluated_phase_one_not_implemented"
    }
    assert all(candidate["parameters"] is None for candidate in final_damage["candidates"])
    assert all(candidate["residuals"] is None for candidate in final_damage["candidates"])
    assert "达到最低门槛" in evaluation["interpretation"]["inferences"][1]
