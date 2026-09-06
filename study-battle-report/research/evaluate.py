"""Deterministic descriptive evaluation for an auditable research corpus."""
from __future__ import annotations

from collections import Counter
from typing import Any

from formula_registry import FORMULA_REGISTRY, evaluate_ui_transitions, registry_document
from schema import SCHEMA_VERSION


MIN_INDEPENDENT_GROUPS = 5


def build_quality_report(
    battle_id: str,
    provenance_quality: dict[str, Any],
    parse_quality: dict[str, Any],
    replay_quality: dict[str, Any],
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    event_anomalies = Counter(
        anomaly for event in events for anomaly in event["anomalies"]
    )
    uncertainties = Counter(
        uncertainty for event in events for uncertainty in event["uncertainties"]
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "battle_id": battle_id,
        "provenance": provenance_quality,
        "parsing": parse_quality,
        "state_replay": replay_quality,
        "event_anomaly_counts": dict(sorted(event_anomalies.items())),
        "event_uncertainty_counts": dict(sorted(uncertainties.items())),
        "primary_analysis_exclusions": {
            "unknown_events_are_retained": True,
            "mirror_sides_are_never_force_resolved": True,
            "lethal_damage_is_right_censored": True,
            "llm_annotations_are_excluded": True,
        },
    }


def _unfitted_damage_candidates(candidate_status: str) -> list[dict[str, Any]]:
    candidates = []
    for family in (
        "base_damage",
        "damage_modifier",
        "reduction_curve",
        "resistance_semantics",
        "rounding_and_censoring",
    ):
        for candidate in FORMULA_REGISTRY[family]:
            candidates.append(
                {
                    "family": family,
                    "candidate_id": candidate["id"],
                    "status": candidate_status,
                    "parameters": None,
                    "residuals": None,
                }
            )
    return candidates


def evaluate_corpus(
    source_manifests: list[dict[str, Any]],
    events: list[dict[str, Any]],
    snapshots: list[dict[str, Any]],
) -> dict[str, Any]:
    group_ids = sorted(
        {manifest["experiment_session_id"] for manifest in source_manifests}
    )
    battle_ids = sorted({manifest["battle_id"] for manifest in source_manifests})
    exact_damage = [
        event
        for event in events
        if event["event_type"] == "damage"
        and event["analysis_eligibility"] == "eligible_exact_damage"
    ]
    censored_damage = [
        event
        for event in events
        if event["event_type"] == "damage" and event["is_lethal_censored"]
    ]
    ui_evaluation = evaluate_ui_transitions(snapshots)

    enough_groups = len(group_ids) >= MIN_INDEPENDENT_GROUPS
    if enough_groups:
        status = "ready_for_future_grouped_evaluation_not_implemented"
        candidate_status = "not_evaluated_phase_one_not_implemented"
        cross_validation_status = "not_run_phase_one_not_implemented"
        parameter_status = "not_estimated_phase_one_not_implemented"
        corpus_inference = (
            "独立组数达到最低门槛，但第一阶段未实现拟合，"
            "仍未执行最终公式评估。"
        )
    else:
        status = "insufficient_independent_groups"
        candidate_status = "not_evaluated_insufficient_independent_groups"
        cross_validation_status = "unavailable_insufficient_groups"
        parameter_status = "unavailable_no_identifiable_fit"
        corpus_inference = "当前独立战斗组不足，只能支持描述性检查。"
    final_damage = {
        "status": status,
        "independent_group_count": len(group_ids),
        "minimum_independent_groups": MIN_INDEPENDENT_GROUPS,
        "battle_count": len(battle_ids),
        "eligible_exact_damage_event_count": len(exact_damage),
        "right_censored_damage_event_count": len(censored_damage),
        "selected_formula": None,
        "restored_formula_claim": False,
        "candidates": _unfitted_damage_candidates(candidate_status),
        "cross_validation": {
            "status": cross_validation_status,
            "split_unit": "whole experiment_session_id",
        },
        "residual_analysis": {"status": "unavailable_no_fitted_model"},
        "counterexamples": {
            "status": "unavailable_no_fitted_model",
            "events": [],
        },
        "parameter_uncertainty": {
            "status": parameter_status,
            "confidence_intervals": None,
        },
    }

    gaps = [
        {
            "id": "independent_reports",
            "required": (
                "正式分组模型评估至少需要 5 个独立 session；获批的近上限"
                "实验矩阵要求 8 个配置各 3 个 session（共 24 份有效战报）。"
            ),
        },
        {
            "id": "controlled_reduction_levels",
            "required": (
                "固定攻击者、目标、属性、技能、位置、补给和游戏版本，分别采集"
                "游戏实际显示减伤约 0–10%、40–55%、70–80% 和至少 90% 的事件。"
            ),
        },
        {
            "id": "resistance_semantics",
            "required": (
                "每个减伤档位都分别采集无抵御和有抵御版本，以检验单次显示"
                "百分比是最终总减伤还是独立分量。"
            ),
        },
        {
            "id": "component_equivalence",
            "required": (
                "采集显示总量近似相等的单一大分量和两个小分量配置，并反转"
                "两个小分量的施加顺序。"
            ),
        },
        {
            "id": "battle_metadata",
            "required": (
                "记录游戏版本/赛季、英雄和战法等级、装备/韬略、阵型、站位、"
                "战前属性与完整技能配置。"
            ),
        },
        {
            "id": "ocr_lineage",
            "required": (
                "当前缓存缺少原始 OCR 文本、token 级阵营颜色、检测框和精确"
                "合并/去重 lineage；不进行后续溯源升级就无法恢复。"
            ),
        },
    ]

    return {
        "schema_version": SCHEMA_VERSION,
        "deterministic_main_analysis": True,
        "llm_annotations_included": False,
        "battle_ids": battle_ids,
        "experiment_session_ids": group_ids,
        "formula_registry": registry_document(),
        "ui_accumulator": ui_evaluation,
        "final_damage": final_damage,
        "unresolved_data_gaps": gaps,
        "interpretation": {
            "facts": [
                "输出为最终日志每一行保留一个事件行。",
                "显示战后兵力为 0 的致死伤害按右删失记录。",
                "镜像名字的阵营保持未解析，并从身份状态重放中排除。",
            ],
            "inferences": [
                "UI 累计更新兼容性与最终伤害公式分开评估。",
                corpus_inference,
            ],
            "hypotheses": [
                "最终伤害可能使用固定登记表中的加法、乘法、硬封顶或软封顶修正族。",
                "抵御显示百分比可能是总减伤，也可能是独立分量。",
            ],
            "cannot_answer": [
                "最终伤害公式及其参数。",
                "减伤采用硬封顶、软封顶还是无封顶。",
                "抵御如何与常驻受到伤害降低组合。",
            ],
        },
    }
