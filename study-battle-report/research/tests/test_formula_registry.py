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
