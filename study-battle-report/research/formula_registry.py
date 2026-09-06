"""Pre-registered formula families and UI-transition compatibility checks."""
from __future__ import annotations

from typing import Any

from schema import SCHEMA_VERSION, content_hash


# This registry is deliberately finite and reviewable. Model-backed annotations
# cannot add candidates or participate in deterministic selection.
FORMULA_REGISTRY: dict[str, list[dict[str, Any]]] = {
    "ui_accumulator": [
        {
            "id": "ui_exact_display_additive",
            "formula": "x_t=round2(x_(t-1)+signed(displayed_delta))",
            "free_parameters": [],
        },
        {
            "id": "ui_hidden_precision_additive",
            "formula": "z_t=clip(z_(t-1)+signed(d_t),L,U); x_t=round2(z_t)",
            "free_parameters": ["L", "U"],
        },
        {
            "id": "ui_independent_multiplicative",
            "formula": "x_t=round2(((1+x_(t-1))*(1+signed(d_t)))-1)",
            "free_parameters": [],
        },
    ],
    "base_damage": [
        {
            "id": "base_attribute_difference",
            "formula": "B=kappa*c_skill*max(A-lambda*D+b,epsilon)*h(N)",
            "free_parameters": ["kappa", "lambda", "b", "epsilon", "troop_scale"],
        },
        {
            "id": "base_attribute_ratio",
            "formula": "B=kappa*c_skill*(A/D)^p*h(N)",
            "free_parameters": ["kappa", "p", "troop_scale"],
        },
        {
            "id": "base_saturating_contest",
            "formula": "B=kappa*c_skill*A^p/(A^p+lambda*D^p)*h(N)",
            "free_parameters": ["kappa", "p", "lambda", "troop_scale"],
        },
        {
            "id": "base_empirical_log_linear",
            "formula": "log(B)=alpha_skill+p*log(A)-q*log(D)+gamma*log(N)",
            "free_parameters": ["alpha_skill", "p", "q", "gamma"],
        },
    ],
    "damage_modifier": [
        {
            "id": "modifier_single_additive_pool",
            "formula": "M=max(m_min,1+O+K+I)",
            "free_parameters": ["m_min"],
        },
        {
            "id": "modifier_source_additive_attack_defence_product",
            "formula": "M=(1+O+K)*(1+I)",
            "free_parameters": [],
        },
        {
            "id": "modifier_independent_channels",
            "formula": "M=(1+O)*(1+K)*(1+I)",
            "free_parameters": [],
        },
        {
            "id": "modifier_nonlinear_incoming",
            "formula": "M=(1+O+K)*(1-g(R))",
            "free_parameters": ["reduction_curve"],
        },
        {
            "id": "modifier_component_product_incoming",
            "formula": "M=(1+O+K)*product_j(1-r_j)",
            "free_parameters": [],
        },
    ],
    "reduction_curve": [
        {
            "id": "reduction_linear_no_cap",
            "formula": "g(R)=R",
            "free_parameters": [],
        },
        {
            "id": "reduction_hard_cap",
            "formula": "g(R)=min(R,c)",
            "free_parameters": ["c"],
        },
        {
            "id": "reduction_exponential_soft_cap",
            "formula": "g(R)=c*(1-exp(-R/c))",
            "free_parameters": ["c"],
        },
        {
            "id": "reduction_rational_soft_cap",
            "formula": "g(R)=c*R/(c+R)",
            "free_parameters": ["c"],
        },
        {
            "id": "reduction_piecewise_diminishing",
            "formula": "g(R)=min(k+s*max(0,R-k),c), 0<=s<1",
            "free_parameters": ["k", "s", "c"],
        },
    ],
    "resistance_semantics": [
        {
            "id": "resistance_independent_component",
            "formula": "M_final=M_prior*(1-E)",
            "free_parameters": [],
        },
        {
            "id": "resistance_displayed_total",
            "formula": "M_final=(1-E), replacing incoming-reduction channel",
            "free_parameters": [],
        },
    ],
    "rounding_and_censoring": [
        {
            "id": "damage_integer_floor",
            "formula": "D_logged=min(HP_before,floor(D_star))",
            "free_parameters": [],
        },
        {
            "id": "damage_integer_nearest",
            "formula": "D_logged=min(HP_before,round(D_star))",
            "free_parameters": [],
        },
    ],
}


def registry_document() -> dict[str, Any]:
    registry_hash = content_hash(FORMULA_REGISTRY)
    return {
        "schema_version": SCHEMA_VERSION,
        "registry_hash": registry_hash,
        "selection_authority": "deterministic_numeric_evaluation_only",
        "llm_annotations_included": False,
        "families": FORMULA_REGISTRY,
    }


def _rounding_interval(displayed: float) -> tuple[float, float]:
    return displayed - 0.005, displayed + 0.005


def _signed_delta_interval(signed_delta: float) -> tuple[float, float]:
    magnitude_low, magnitude_high = _rounding_interval(abs(signed_delta))
    if signed_delta >= 0:
        return magnitude_low, magnitude_high
    return -magnitude_high, -magnitude_low


def _hidden_sum_interval(
    previous: float, signed_delta: float
) -> tuple[float, float]:
    previous_low, previous_high = _rounding_interval(previous)
    delta_low, delta_high = _signed_delta_interval(signed_delta)
    return previous_low + delta_low, previous_high + delta_high


def _display_interval_with_bounds(
    displayed: float, lower_bound: float, upper_bound: float
) -> tuple[float, float] | None:
    display_low, display_high = _rounding_interval(displayed)
    low = max(display_low, lower_bound)
    high = min(display_high, upper_bound)
    if low < high:
        return low, high
    if low == high and display_low <= low < display_high:
        return low, high
    return None


def _intersect_display_interval(
    interval: tuple[float, float], displayed: float
) -> tuple[float, float] | None:
    low, high = interval
    display_low, display_high = _rounding_interval(displayed)
    if low == high:
        return interval if display_low <= low < display_high else None
    intersection_low = max(low, display_low)
    intersection_high = min(high, display_high)
    if intersection_low < intersection_high:
        return intersection_low, intersection_high
    return None


def _advance_hidden_interval(
    previous_interval: tuple[float, float],
    signed_delta: float,
    observed_total: float,
    lower_bound: float,
    upper_bound: float,
) -> tuple[float, float] | None:
    delta_low, delta_high = _signed_delta_interval(signed_delta)
    sum_low = previous_interval[0] + delta_low
    sum_high = previous_interval[1] + delta_high
    if sum_high <= lower_bound:
        clipped = (lower_bound, lower_bound)
    elif sum_low >= upper_bound:
        clipped = (upper_bound, upper_bound)
    else:
        clipped = (
            max(sum_low, lower_bound),
            min(sum_high, upper_bound),
        )
    return _intersect_display_interval(clipped, observed_total)


def _hidden_bound_candidates(
    transitions: list[dict[str, Any]],
) -> list[float]:
    anchors: set[float] = set()
    for transition in transitions:
        previous = float(transition["previous"])
        signed_delta = float(transition["signed_delta"])
        total = float(transition["observed_total"])
        anchors.update(_rounding_interval(previous))
        anchors.update(_rounding_interval(total))
        anchors.update(_hidden_sum_interval(previous, signed_delta))
        anchors.update((previous, total))
    if not anchors:
        return []
    ordered = sorted(anchors)
    span = max(1.0, ordered[-1] - ordered[0])
    candidates = set(ordered)
    candidates.update(
        (left + right) / 2.0
        for left, right in zip(ordered, ordered[1:])
    )
    candidates.update((ordered[0] - span - 1.0, ordered[-1] + span + 1.0))
    return sorted(candidates)


def _continuous_hidden_transitions(
    transitions: list[dict[str, Any]],
    lower_bound: float,
    upper_bound: float,
) -> set[int]:
    if lower_bound > upper_bound:
        return set()
    states: dict[tuple[Any, str], tuple[float, float]] = {}
    accepted: set[int] = set()
    for index, transition in enumerate(transitions):
        key = (transition.get("subject_key"), transition["metric"])
        previous = float(transition["previous"])
        previous_interval = states.get(key)
        if previous_interval is None:
            previous_interval = _display_interval_with_bounds(
                previous, lower_bound, upper_bound
            )
        else:
            previous_interval = _intersect_display_interval(
                previous_interval, previous
            )
        if previous_interval is None:
            states.pop(key, None)
            continue
        next_interval = _advance_hidden_interval(
            previous_interval,
            float(transition["signed_delta"]),
            float(transition["observed_total"]),
            lower_bound,
            upper_bound,
        )
        if next_interval is None:
            states.pop(key, None)
            continue
        accepted.add(index)
        states[key] = next_interval
    return accepted


def _fit_shared_hidden_bounds(
    transitions: list[dict[str, Any]],
) -> dict[str, Any]:
    if not transitions:
        return {
            "accepted_indices": set(),
            "shared_bounds": None,
            "feasible_region": None,
            "parameter_status": "not_evaluated_no_transitions",
        }

    candidates = _hidden_bound_candidates(transitions)
    best_indices: set[int] = set()
    best_rank: tuple[Any, ...] | None = None
    complete_witness_count = 0
    for lower_bound in candidates:
        for upper_bound in candidates:
            if lower_bound > upper_bound:
                continue
            accepted = _continuous_hidden_transitions(
                transitions, lower_bound, upper_bound
            )
            if len(accepted) == len(transitions):
                complete_witness_count += 1
            decimal_complexity = abs(lower_bound - round(lower_bound, 2)) + abs(
                upper_bound - round(upper_bound, 2)
            )
            rank = (
                len(accepted),
                tuple(index in accepted for index in range(len(transitions))),
                -round(decimal_complexity, 12),
                -abs(lower_bound),
                -abs(upper_bound),
            )
            if best_rank is None or rank > best_rank:
                best_rank = rank
                best_indices = accepted

    all_feasible = complete_witness_count > 0
    return {
        "accepted_indices": best_indices,
        "shared_bounds": None,
        "feasible_region": {
            "status": (
                "nonempty_not_point_identified"
                if all_feasible
                else "no_common_region_for_all_transitions"
            ),
            "shared_across_all_transitions": all_feasible,
            "L": "not_point_identified" if all_feasible else "not_identifiable",
            "U": "not_point_identified" if all_feasible else "not_identifiable",
        },
        "parameter_status": (
            "feasible_all_transitions_bounds_not_point_identified"
            if all_feasible
            else "best_common_bounds_with_counterexamples_not_identifiable"
        ),
    }


def hidden_additive_feasible(
    previous: float, signed_delta: float, total: float
) -> bool:
    transition = {
        "subject_key": None,
        "metric": "single_transition",
        "previous": previous,
        "signed_delta": signed_delta,
        "observed_total": total,
    }
    return 0 in _fit_shared_hidden_bounds([transition])["accepted_indices"]


def _candidate_prediction(candidate_id: str, previous: float, delta: float) -> float:
    if candidate_id == "ui_exact_display_additive":
        return round(previous + delta, 2)
    if candidate_id == "ui_independent_multiplicative":
        return round((((1 + previous / 100.0) * (1 + delta / 100.0)) - 1) * 100, 2)
    raise ValueError(candidate_id)


def evaluate_ui_transitions(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    transitions = []
    broken_sequences: set[tuple[Any, str]] = set()
    sequence_gap_count = 0
    reestablished_state_count = 0
    for snapshot in snapshots:
        if snapshot["event_type"] != "percent_change" or snapshot["state_status"] != "applied":
            continue
        transition = snapshot["transition"]
        metric = transition["metric"]
        key = (snapshot.get("subject_key"), metric)
        previous = transition.get("previous_total_displayed")
        delta = transition.get("signed_delta_displayed")
        total = transition.get("observed_total_displayed")
        if total is None or delta is None:
            broken_sequences.add(key)
            sequence_gap_count += 1
            continue
        if key in broken_sequences:
            broken_sequences.remove(key)
            reestablished_state_count += 1
            continue
        if previous is None:
            continue
        transitions.append(
            {
                "event_id": snapshot["event_id"],
                "source_lines": snapshot["source_lines"],
                "subject_key": snapshot.get("subject_key"),
                "metric": metric,
                "previous": previous,
                "signed_delta": delta,
                "observed_total": total,
            }
        )

    hidden_fit = _fit_shared_hidden_bounds(transitions)
    results = []
    for candidate in FORMULA_REGISTRY["ui_accumulator"]:
        candidate_id = candidate["id"]
        violations = []
        consistent = 0
        for transition_index, transition in enumerate(transitions):
            if candidate_id == "ui_hidden_precision_additive":
                accepted = transition_index in hidden_fit["accepted_indices"]
                predicted = None
            else:
                predicted = _candidate_prediction(
                    candidate_id,
                    transition["previous"],
                    transition["signed_delta"],
                )
                accepted = abs(predicted - transition["observed_total"]) < 0.005
            if accepted:
                consistent += 1
            elif len(violations) < 20:
                violations.append(
                    {
                        **transition,
                        "candidate_prediction": predicted,
                    }
                )
        result = {
            "candidate_id": candidate_id,
            "evaluated_transition_count": len(transitions),
            "consistent_transition_count": consistent,
            "violation_count": len(transitions) - consistent,
            "representative_violations": violations,
        }
        if candidate_id == "ui_hidden_precision_additive":
            result.update(
                shared_bounds=hidden_fit["shared_bounds"],
                feasible_region=hidden_fit["feasible_region"],
                parameter_status=hidden_fit["parameter_status"],
            )
        results.append(result)
    return {
        "transition_count": len(transitions),
        "sequence_gap_count": sequence_gap_count,
        "reestablished_state_count": reestablished_state_count,
        "candidate_results": results,
        "interpretation_constraint": (
            "这里的兼容性仅针对游戏显示的累计值，不能作为最终伤害采用"
            "相同组合方式的证据。"
        ),
    }
