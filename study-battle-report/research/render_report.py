"""Render a deterministic, audit-oriented Markdown research report."""
from __future__ import annotations

import json
from collections import Counter
from typing import Any


def _line_ref(event: dict[str, Any]) -> str:
    lines = event["source_lines"]
    return ",".join(f"L{line}" for line in lines)


def _table_value(value: Any) -> str:
    return str(value).replace("|", "\\|")


def _provenance_boundary(
    provenance: dict[str, Any], mirror_names: list[str]
) -> list[str]:
    mode = provenance.get("provenance_mode")
    if mode == "v2_exact_lineage":
        lines = [
            "限制：当前 V2 来源已保存原始 OCR 文本、bbox、token 级阵营颜色证据和逐行 observation lineage。",
            "token 区域仍是整行检测框内的比例近似；未知颜色判定保持未知，canonical OCR 修复、模糊拼接和其他 heuristic lineage 不会进入 exact damage 样本。",
        ]
    elif mode == "v2_cache_without_exact_sidecar":
        lines = [
            "限制：当前 V2 cache 已保存原始 OCR 文本、bbox 和 token 级阵营颜色证据，但缺少经 manifest 固定的完整逐行拼接 sidecar。",
            "cache 到最终行只能保守记录为候选对齐，不会提升为 exact lineage；近似 token 区域和未知颜色判定仍保持不确定。",
        ]
    elif mode == "legacy_v1_fallback":
        lines = [
            "限制：当前 `.ocr_cache.json` 只保存已经纠正并打过侧别的文本和 OCR 分数；",
            "原始 OCR 文本、bbox、token 级颜色以及精确拼接 lineage 不存在。管线将其显式记录为不确定性，不伪造来源。",
        ]
    else:
        lines = [
            "限制：当前来源的 OCR provenance 模式未知，因此不声称原始观察或逐行拼接 lineage 完整，也不允许进入 exact damage 样本。",
        ]
    if mirror_names:
        rendered_names = "、".join(f"`{name}`" for name in mirror_names)
        lines.append(
            f"manifest 登记的镜像名字为 {rendered_names}；相关侧别保持 `mirror_ambiguous`，不会强制归边或写入身份状态。"
        )
    else:
        lines.append("manifest 未登记镜像名字；管线不会据此推断任何额外阵营身份。")
    return lines


def _observed_channel_summary(events: list[dict[str, Any]]) -> str:
    channels = [
        f"`{metric}` 百分比"
        for metric in sorted(
            {
                event["metric"]
                for event in events
                if event["event_type"] == "percent_change"
                and isinstance(event.get("metric"), str)
            }
        )
    ]
    typed_channels = (
        ("damage", "`兵力损失`"),
        ("healing", "`兵力恢复`"),
        ("critical", "`会心伤害`"),
        ("resistance", "`此次伤害减少`"),
    )
    channels.extend(
        label
        for event_type, label in typed_channels
        if any(event["event_type"] == event_type for event in events)
    )
    if not channels:
        return (
            "- 当前日志未解析出伤害、治疗、会心、抵御或百分比通道；"
            "不能声称这些字段已被本场证据观察。"
        )
    return (
        "- 当前日志可解析字段包括："
        + "、".join(channels)
        + "；后续公式研究必须保留这些通道的独立语义，不能预设其组合方式。"
    )


def _render_mapping_fields(
    lines: list[str], label: str, value: dict[str, Any], excluded: set[str]
) -> None:
    known = sorted(
        key
        for key, item in value.items()
        if key not in excluded and item is not None
    )
    missing = sorted(
        key
        for key, item in value.items()
        if key not in excluded and item is None
    )
    lines.append(
        f"- {label}已记录字段："
        + ("、".join(f"`{key}`" for key in known) if known else "无")
    )
    for key in known:
        rendered_value = json.dumps(
            value[key],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        lines.append(f"  - `{key}`：`{_table_value(rendered_value)}`")
    lines.append(
        f"- {label}未知字段："
        + ("、".join(f"`{key}`" for key in missing) if missing else "无")
    )


def _metadata_summary(source_manifest: dict[str, Any]) -> list[str]:
    game_metadata = source_manifest.get("game_metadata", {})
    status = game_metadata.get("metadata_status", "unspecified")
    lines = [f"- 游戏 metadata 状态：`{_table_value(status)}`"]
    _render_mapping_fields(lines, "manifest ", game_metadata, {"metadata_status"})

    teams = source_manifest.get("teams", {})
    identity_status = teams.get("identity_status", "unspecified")
    lines.append(f"- 队伍 identity 状态：`{_table_value(identity_status)}`")
    for side, label in (("ours", "我方队伍 "), ("enemy", "敌方队伍 ")):
        team = teams.get(side, {})
        if isinstance(team, dict):
            _render_mapping_fields(lines, label, team, set())
        else:
            lines.append(f"- {label}metadata：无")
    return lines


def render_report(
    source_manifest: dict[str, Any],
    quality: dict[str, Any],
    evaluation: dict[str, Any],
    events: list[dict[str, Any]],
) -> str:
    battle_id = source_manifest["battle_id"]
    parsing = quality["parsing"]
    provenance = quality["provenance"]
    replay = quality["state_replay"]
    final_damage = evaluation["final_damage"]
    resistances = [
        event for event in events if event["event_type"] == "resistance"
    ]
    maximum_resistance = max(
        resistances,
        key=lambda event: event["event_reduction"] or float("-inf"),
        default=None,
    )
    lethal_events = [event for event in events if event["is_lethal_censored"]]
    anomaly_counts = Counter(
        anomaly for event in events for anomaly in event["anomalies"]
    )

    lines = [
        f"# 战报 {battle_id}：第一阶段可审计研究报告",
        "",
        "> 本报告由确定性管线生成。它不调用 LLM 选择公式，不修改推荐模型，",
        "> 也不声称已从单场战斗还原最终伤害公式。",
        "",
        "## 1. 输入与可复现性",
        "",
        f"- Schema：`{source_manifest['schema_version']}`",
        f"- 实验 session：`{source_manifest['experiment_session_id']}`",
        f"- 最终日志 SHA-256：`{source_manifest['sources']['battle_log']['sha256']}`",
        f"- OCR 缓存 SHA-256：`{source_manifest['sources']['ocr_cache']['sha256']}`",
        f"- 截图数：{len(source_manifest['sources']['screenshots'])}",
        f"- 输入集合哈希：`{source_manifest['source_set_hash']}`",
        f"- 管线代码哈希：`{source_manifest['pipeline_code_hash']}`",
    ]
    lines.extend(_metadata_summary(source_manifest))
    lines.extend(
        [
            "",
            "## 2. 数据质量与保留策略",
            "",
            f"- 最终日志行数：{provenance['line_count']}",
            f"- 逐行事件数：{parsing['event_count']}（每一行都有事件记录）",
            f"- `unknown` 事件数：{parsing['unknown_event_count']}，均保留原文和源行号",
            f"- 致死右删失事件数：{parsing['lethal_right_censored_count']}",
            f"- 涉及镜像名字的歧义事件数：{parsing['mirror_ambiguous_event_count']}",
            f"- 涉及推断阵营的事件数：{parsing['inferred_side_event_count']}",
            f"- 状态快照数：{replay['snapshot_count']}",
            "",
            "| 对齐状态 | 行数 |",
            "|---|---:|",
        ]
    )
    for status, count in provenance["alignment_status_counts"].items():
        lines.append(f"| {_table_value(status)} | {count} |")

    lines.extend(
        [
            "",
            "`ambiguous` 包括相同规范化文本命中多个截图/缓存行的情况；",
            "这些行保留全部可能来源和 `multiple_possible_cache_sources`，不会伪装为唯一 exact 来源。",
            "",
            "主要异常：",
            "",
        ]
    )
    for anomaly, count in sorted(anomaly_counts.items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"- `{anomaly}`：{count}")
    if not anomaly_counts:
        lines.append("- 无自动标记异常")

    lines.append("")
    lines.extend(
        _provenance_boundary(provenance, source_manifest["mirror_names"])
    )
    lines.extend(
        [
            "",
            "## 3. 可核查的描述性证据",
            "",
        ]
    )
    if maximum_resistance is not None:
        lines.append(
            f"- 最大可解析的单次“此次伤害减少”为 "
            f"{maximum_resistance['event_reduction']:.2f}%（{_line_ref(maximum_resistance)}）。"
        )
    if lethal_events:
        refs = "、".join(_line_ref(event) for event in lethal_events)
        lines.append(
            f"- 致死伤害位于 {refs}；记录值只是实际伤害的下界，不能当精确公式输出。"
        )
    lines.append(_observed_channel_summary(events))

    lines.extend(
        [
            "",
            "## 4. 游戏显示累计百分比的独立检查",
            "",
            "此处只检查 UI 累计更新，不把结果外推为最终伤害公式。违反项也可能由 OCR 缺行或无法归属的前序更新造成，不能单独视为公式反例。",
            "",
            "| 固定候选 | 可检查转移 | 一致 | 违反 |",
            "|---|---:|---:|---:|",
        ]
    )
    hidden_result = None
    for result in evaluation["ui_accumulator"]["candidate_results"]:
        lines.append(
            f"| `{result['candidate_id']}` | {result['evaluated_transition_count']} | "
            f"{result['consistent_transition_count']} | {result['violation_count']} |"
        )
        if result["candidate_id"] == "ui_hidden_precision_additive":
            hidden_result = result
    if hidden_result is not None:
        shared_bounds = hidden_result.get("shared_bounds")
        if shared_bounds is None:
            lines.extend(["", "- 隐藏精度加法没有可估计的共同 `L/U` 边界。"])
        else:
            lines.append("")
            lines.append(
                "- 隐藏精度加法以全部受检转移共享的边界评估："
                f"`L={shared_bounds['L']}`、`U={shared_bounds['U']}`；"
                f"状态为 `{hidden_result['parameter_status']}`。"
            )
    lines.extend(
        [
            "",
            evaluation["ui_accumulator"]["interpretation_constraint"],
            "",
            "## 5. 最终伤害公式评估",
            "",
            f"- 状态：`{final_damage['status']}`",
            f"- 独立 session 数：{final_damage['independent_group_count']}",
            f"- 初步分组评估最低要求：{final_damage['minimum_independent_groups']}",
            f"- 可解析的非删失精确伤害事件：{final_damage['eligible_exact_damage_event_count']}",
            f"- 选中公式：`{final_damage['selected_formula'] if final_damage['selected_formula'] is not None else '未选择'}`",
            f"- 是否声称还原公式：`{str(final_damage['restored_formula_claim']).lower()}`",
            "",
            "第一阶段不实现最终伤害拟合：组数不足时明确报告证据不足；",
            "组数达到最低门槛时也只标记为可供未来评估，但仍不执行拟合或交叉验证。",
            "因此本阶段不选择公式，也不计算参数、残差、交叉验证分数或置信区间。",
            "",
            "## 6. 尚需采集的数据",
            "",
        ]
    )
    for gap in evaluation["unresolved_data_gaps"]:
        lines.append(f"- **{gap['id']}**：{gap['required']}")

    interpretation = evaluation["interpretation"]
    lines.extend(["", "## 7. 结论边界", "", "### 事实", ""])
    lines.extend(f"- {item}" for item in interpretation["facts"])
    lines.extend(["", "### 推断", ""])
    lines.extend(f"- {item}" for item in interpretation["inferences"])
    lines.extend(["", "### 假设", ""])
    lines.extend(f"- {item}" for item in interpretation["hypotheses"])
    lines.extend(["", "### 当前不能回答", ""])
    lines.extend(f"- {item}" for item in interpretation["cannot_answer"])
    lines.append("")
    return "\n".join(lines)
