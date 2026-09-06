"""Grammar-based, fail-soft parsing of one event for every final log line."""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

from schema import SCHEMA_VERSION


_ENTITY_RE = re.compile(r"\[(?:(我方|敌方):)?([^\[\]]+)\]")
_SKILL_RE = re.compile(r"【([^【】]+)】")
_ROUNDS = {
    "第一回合": 1,
    "第二回合": 2,
    "第三回合": 3,
    "第四回合": 4,
    "第五回合": 5,
    "第六回合": 6,
    "第七回合": 7,
    "第八回合": 8,
    "第九回合": 9,
    "第十回合": 10,
}

_PERCENT_RE = re.compile(
    r"的【(?P<metric>[^【】]+)】(?P<direction>提升|降低)"
    r"(?P<delta>-?\d+(?:\.\d+)?)%"
    r"(?:[（(](?P<total>-?\d+(?:\.\d+)?)%?[）)]?)?"
)
_STAT_RE = re.compile(
    r"的【(?P<metric>武力|智力|统率|先攻|抵御次数|不屈次数)】"
    r"(?P<direction>提升|降低)(?P<delta>-?\d+(?:\.\d+)?)"
    r"(?:[（(](?P<total>-?\d+(?:\.\d+)?)[）)]?)?"
)
_DAMAGE_RE = re.compile(r"损失了兵力\s*(\d+)")
_HEAL_RE = re.compile(r"恢复了兵力\s*(\d+)")
_POST_VALUE_RE = re.compile(r"[（(](\d+)[）)]?")
_RESISTANCE_RE = re.compile(r"此次伤害减少\s*(\d+(?:\.\d+)?)%")
_CRITICAL_RE = re.compile(r"会心伤害为\s*(\d+(?:\.\d+)?)%")
_STATUS_RE = re.compile(
    r"的「([^「」]+)」(?:效果)?已(施加|刷新|消失)|"
    r"的「([^「」]+)」已(叠加\d+次|满层\d+次)"
)


def _entities(text: str, mirror_names: set[str]) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []
    for side, name in _ENTITY_RE.findall(text):
        if name in mirror_names:
            resolved_side = None
            side_status = "mirror_ambiguous"
        elif side:
            resolved_side = side
            side_status = "observed"
        else:
            resolved_side = None
            side_status = "missing"
        entities.append(
            {
                "name": name,
                "observed_side": side or None,
                "resolved_side": resolved_side,
                "side_status": side_status,
            }
        )
    return entities


def _first_skill(text: str) -> str | None:
    match = _SKILL_RE.search(text)
    return match.group(1) if match else None


def _post_value(text: str, value_end: int) -> int | None:
    match = _POST_VALUE_RE.search(text, value_end)
    return int(match.group(1)) if match else None


def _base_event(
    battle_id: str,
    line: dict[str, Any],
    round_number: int | None,
) -> dict[str, Any]:
    line_no = line["final_line_no"]
    return {
        "schema_version": SCHEMA_VERSION,
        "battle_id": battle_id,
        "event_id": f"{battle_id}:L{line_no:04d}",
        "parent_action_id": None,
        "round": round_number,
        "sequence": line_no,
        "event_type": "unknown",
        "parse_status": "unknown",
        "raw_text": line["final_log_text"],
        "source_lines": [line_no],
        "actor": None,
        "source": None,
        "target": None,
        "skill": None,
        "metric": None,
        "direction": None,
        "delta_displayed": None,
        "total_displayed": None,
        "damage": None,
        "healing": None,
        "troops_after": None,
        "critical_multiplier": None,
        "event_reduction": None,
        "is_lethal_censored": False,
        "censoring": None,
        "anomalies": list(line["anomalies"]),
        "uncertainties": list(line["uncertainties"]),
        "analysis_eligibility": "excluded_unknown",
    }


def parse_lines(
    battle_id: str,
    lines: list[dict[str, Any]],
    mirror_names: set[str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    events: list[dict[str, Any]] = []
    current_round: int | None = None

    for line in lines:
        text = line["final_log_text"]
        stripped = text.strip()
        if stripped in _ROUNDS:
            current_round = _ROUNDS[stripped]

        event = _base_event(battle_id, line, current_round)
        entities = _entities(text, mirror_names)
        first = entities[0] if entities else None
        second = entities[1] if len(entities) > 1 else None
        skill = _first_skill(text)

        if stripped in _ROUNDS:
            event.update(
                event_type="round_start",
                parse_status="parsed",
                analysis_eligibility="descriptive_only",
            )
        elif re.search(r"(?:胜利|失败|平局|战斗结束)[！!]\s*$", stripped):
            event.update(
                event_type="battle_result",
                parse_status="parsed",
                analysis_eligibility="descriptive_only",
            )
        else:
            damage = _DAMAGE_RE.search(text)
            healing = _HEAL_RE.search(text)
            percent = _PERCENT_RE.search(text)
            stat = _STAT_RE.search(text)
            resistance = _RESISTANCE_RE.search(text)
            critical = _CRITICAL_RE.search(text)
            normal_attack = "发动普通攻击" in text and "对" in text
            skill_action = "发动战法" in text or "因几率未发动战法" in text
            death = "兵力为0" in text and "无法再战" in text
            status = _STATUS_RE.search(text)

            if damage:
                amount = int(damage.group(1))
                troops_after = _post_value(text, damage.end())
                lethal = troops_after == 0
                uncertainties = list(event["uncertainties"])
                if second is None:
                    uncertainties.append("damage_source_or_target_incomplete")
                if skill is None:
                    uncertainties.append("damage_skill_missing")
                complete_cause = (
                    first is not None and second is not None and skill is not None
                )
                event.update(
                    event_type="damage",
                    parse_status="parsed" if complete_cause else "partial",
                    source=second,
                    actor=second,
                    target=first,
                    skill=skill,
                    damage=amount,
                    troops_after=troops_after,
                    is_lethal_censored=lethal,
                    censoring=(
                        {"kind": "right", "lower_bound": amount} if lethal else None
                    ),
                    uncertainties=sorted(set(uncertainties)),
                )
                if lethal:
                    event["analysis_eligibility"] = "censored_likelihood_only"
                elif first and first["side_status"] == "mirror_ambiguous":
                    event["analysis_eligibility"] = "excluded_mirror_side"
                elif event["parse_status"] != "parsed":
                    event["analysis_eligibility"] = "excluded_partial_parse"
                elif line["anomalies"]:
                    event["analysis_eligibility"] = "excluded_ocr_anomaly"
                else:
                    event["analysis_eligibility"] = "eligible_exact_damage"
                if first and first["side_status"] == "mirror_ambiguous":
                    event["anomalies"] = sorted(
                        set(event["anomalies"] + ["mirror_side_ambiguous"])
                    )
            elif healing:
                amount = int(healing.group(1))
                event.update(
                    event_type="healing",
                    parse_status="parsed" if first is not None else "partial",
                    actor=first,
                    target=first,
                    healing=amount,
                    troops_after=_post_value(text, healing.end()),
                    analysis_eligibility="descriptive_only",
                )
            elif percent:
                delta = float(percent.group("delta"))
                total_text = percent.group("total")
                event.update(
                    event_type="percent_change",
                    parse_status="parsed" if first is not None else "partial",
                    actor=first,
                    target=first,
                    metric=percent.group("metric"),
                    direction=percent.group("direction"),
                    delta_displayed=delta,
                    total_displayed=float(total_text) if total_text is not None else None,
                    analysis_eligibility="ui_transition_candidate",
                )
            elif stat:
                total_text = stat.group("total")
                event.update(
                    event_type=(
                        "troop_change"
                        if stat.group("metric") in {"抵御次数", "不屈次数"}
                        else "stat_change"
                    ),
                    parse_status="parsed" if first is not None else "partial",
                    actor=first,
                    target=first,
                    metric=stat.group("metric"),
                    direction=stat.group("direction"),
                    delta_displayed=float(stat.group("delta")),
                    total_displayed=float(total_text) if total_text is not None else None,
                    analysis_eligibility="state_replay_only",
                )
            elif resistance:
                event.update(
                    event_type="resistance",
                    parse_status="parsed" if first is not None else "partial",
                    actor=first,
                    target=first,
                    event_reduction=float(resistance.group(1)),
                    analysis_eligibility="descriptive_only",
                )
            elif critical:
                event.update(
                    event_type="critical",
                    parse_status="parsed",
                    actor=first,
                    target=first,
                    critical_multiplier=float(critical.group(1)) / 100.0,
                    analysis_eligibility="descriptive_only",
                )
            elif normal_attack:
                event.update(
                    event_type="normal_attack",
                    parse_status="parsed" if second is not None else "partial",
                    actor=first,
                    source=first,
                    target=second,
                    analysis_eligibility="action_link_only",
                )
            elif skill_action:
                event.update(
                    event_type="skill_action",
                    parse_status="parsed" if skill is not None else "partial",
                    actor=first,
                    source=first,
                    skill=skill,
                    analysis_eligibility="action_link_only",
                )
            elif death:
                event.update(
                    event_type="death",
                    parse_status="parsed" if first is not None else "partial",
                    actor=first,
                    target=first,
                    analysis_eligibility="descriptive_only",
                )
            elif status:
                effect_name = status.group(1) or status.group(3)
                event.update(
                    event_type="status_change",
                    parse_status="parsed" if first is not None else "partial",
                    actor=first,
                    target=first,
                    skill=effect_name,
                    analysis_eligibility="state_replay_only",
                )

        if any(
            entity and entity["side_status"] == "mirror_ambiguous"
            for entity in (event["actor"], event["source"], event["target"])
        ):
            event["anomalies"] = sorted(
                set(event["anomalies"] + ["mirror_side_ambiguous"])
            )
        events.append(event)

    event_counts = Counter(event["event_type"] for event in events)
    parse_counts = Counter(event["parse_status"] for event in events)
    eligibility_counts = Counter(event["analysis_eligibility"] for event in events)
    quality = {
        "schema_version": SCHEMA_VERSION,
        "battle_id": battle_id,
        "event_count": len(events),
        "event_type_counts": dict(sorted(event_counts.items())),
        "parse_status_counts": dict(sorted(parse_counts.items())),
        "analysis_eligibility_counts": dict(sorted(eligibility_counts.items())),
        "unknown_event_count": event_counts.get("unknown", 0),
        "lethal_right_censored_count": sum(
            1 for event in events if event["is_lethal_censored"]
        ),
        "mirror_ambiguous_event_count": sum(
            1 for event in events if "mirror_side_ambiguous" in event["anomalies"]
        ),
    }
    return events, quality
