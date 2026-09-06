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


def hidden_additive_feasible(previous: float, signed_delta: float, total: float) -> bool:
    previous_low, previous_high = _rounding_interval(previous)
    magnitude_low, magnitude_high = _rounding_interval(abs(signed_delta))
    if signed_delta >= 0:
        sum_low = previous_low + magnitude_low
        sum_high = previous_high + magnitude_high
    else:
        sum_low = previous_low - magnitude_high
        sum_high = previous_high - magnitude_low
    total_low, total_high = _rounding_interval(total)
    return max(sum_low, total_low) < min(sum_high, total_high)


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

    results = []
    for candidate in FORMULA_REGISTRY["ui_accumulator"]:
        candidate_id = candidate["id"]
        violations = []
        consistent = 0
        for transition in transitions:
            if candidate_id == "ui_hidden_precision_additive":
                accepted = hidden_additive_feasible(
                    transition["previous"],
                    transition["signed_delta"],
                    transition["observed_total"],
                )
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
        results.append(
            {
                "candidate_id": candidate_id,
                "evaluated_transition_count": len(transitions),
                "consistent_transition_count": consistent,
                "violation_count": len(transitions) - consistent,
                "representative_violations": violations,
            }
        )
    return {
        "transition_count": len(transitions),
        "candidate_results": results,
        "interpretation_constraint": (
            "这里的兼容性仅针对游戏显示的累计值，不能作为最终伤害采用"
            "相同组合方式的证据。"
        ),
    }
