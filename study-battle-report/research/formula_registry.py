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


def _hidden_sum_interval(
    previous: float, signed_delta: float
) -> tuple[float, float]:
    previous_low, previous_high = _rounding_interval(previous)
    magnitude_low, magnitude_high = _rounding_interval(abs(signed_delta))
    if signed_delta >= 0:
        return previous_low + magnitude_low, previous_high + magnitude_high
    return previous_low - magnitude_high, previous_high - magnitude_low


def _fixed_bounds_hidden_additive_feasible(
    previous: float,
    signed_delta: float,
    total: float,
    lower_bound: float,
    upper_bound: float,
) -> bool:
    if lower_bound > upper_bound:
        return False
    sum_low, sum_high = _hidden_sum_interval(previous, signed_delta)
    output_low = min(max(sum_low, lower_bound), upper_bound)
    output_high = min(max(sum_high, lower_bound), upper_bound)
    total_low, total_high = _rounding_interval(total)
    if abs(output_high - output_low) < 1e-12:
        return total_low <= output_low < total_high
    return max(output_low, total_low) < min(output_high, total_high)


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


def _fit_shared_hidden_bounds(
    transitions: list[dict[str, Any]],
) -> dict[str, Any]:
    if not transitions:
        return {
            "accepted_indices": set(),
            "shared_bounds": None,
            "parameter_status": "not_evaluated_no_transitions",
        }

    candidates = _hidden_bound_candidates(transitions)
    best_indices: set[int] = set()
    best_bounds: tuple[float, float] | None = None
    best_rank: tuple[int, float, float] | None = None
    for lower_bound in candidates:
        for upper_bound in candidates:
            if lower_bound > upper_bound:
                continue
            accepted = {
                index
                for index, transition in enumerate(transitions)
                if _fixed_bounds_hidden_additive_feasible(
                    transition["previous"],
                    transition["signed_delta"],
                    transition["observed_total"],
                    lower_bound,
                    upper_bound,
                )
            }
            decimal_complexity = abs(lower_bound - round(lower_bound, 2)) + abs(
                upper_bound - round(upper_bound, 2)
            )
            rank = (
                len(accepted),
                -round(decimal_complexity, 12),
                upper_bound - lower_bound,
            )
            if best_rank is None or rank > best_rank:
                best_rank = rank
                best_indices = accepted
                best_bounds = (lower_bound, upper_bound)

    assert best_bounds is not None
    return {
        "accepted_indices": best_indices,
        "shared_bounds": {
            "L": round(best_bounds[0], 6),
            "U": round(best_bounds[1], 6),
        },
        "parameter_status": (
            "feasible_all_transitions"
            if len(best_indices) == len(transitions)
            else "best_common_bounds_with_counterexamples"
        ),
    }


def hidden_additive_feasible(
    previous: float, signed_delta: float, total: float
) -> bool:
    transition = {
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
    for snapshot in snapshots:
        if snapshot["event_type"] != "percent_change" or snapshot["state_status"] != "applied":
            continue
        transition = snapshot["transition"]
        previous = transition.get("previous_total_displayed")
        delta = transition.get("signed_delta_displayed")
        total = transition.get("observed_total_displayed")
        if previous is None or delta is None or total is None:
            continue
        transitions.append(
            {
                "event_id": snapshot["event_id"],
                "source_lines": snapshot["source_lines"],
                "metric": transition["metric"],
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
                parameter_status=hidden_fit["parameter_status"],
            )
        results.append(result)
    return {
        "transition_count": len(transitions),
        "candidate_results": results,
        "interpretation_constraint": (
            "这里的兼容性仅针对游戏显示的累计值，不能作为最终伤害采用"
            "相同组合方式的证据。"
        ),
    }
