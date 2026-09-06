"""Deterministic state replay with explicit skips for ambiguous identities."""
from __future__ import annotations

import copy
from collections import Counter
from typing import Any

from schema import SCHEMA_VERSION


_REPLAY_EVENT_TYPES = frozenset(
    {
        "damage",
        "healing",
        "percent_change",
        "resistance",
        "stat_change",
        "troop_change",
    }
)


def _empty_state() -> dict[str, Any]:
    return {
        "attributes": {},
        "percentages": {},
        "counters": {},
        "troops_after": None,
        "component_ledger": [],
    }


def _subject(event: dict[str, Any]) -> dict[str, Any] | None:
    return event["target"] or event["actor"]


def _subject_key(entity: dict[str, Any] | None) -> tuple[str | None, str]:
    if entity is None:
        return None, "skipped_missing_identity"
    if entity["side_status"] == "mirror_ambiguous":
        return None, "skipped_mirror_ambiguous"
    if entity["side_status"] == "inferred":
        return None, "skipped_inferred_side"
    if entity["resolved_side"] is None:
        return None, "skipped_missing_side"
    return f"{entity['resolved_side']}:{entity['name']}", "applied"


def replay_events(
    battle_id: str, events: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    states: dict[str, dict[str, Any]] = {}
    snapshots: list[dict[str, Any]] = []

    for event in events:
        if event["event_type"] not in _REPLAY_EVENT_TYPES:
            continue
        entity = _subject(event)
        key, state_status = _subject_key(entity)
        before: dict[str, Any] | None = None
        after: dict[str, Any] | None = None
        transition: dict[str, Any] = {}

        if key is not None:
            state = states.setdefault(key, _empty_state())
            before = copy.deepcopy(state)

            if event["event_type"] == "percent_change":
                metric = event["metric"]
                delta = event["delta_displayed"]
                direction = event["direction"]
                total = event["total_displayed"]
                signed_delta = delta if direction == "提升" else -delta
                previous = state["percentages"].get(metric)
                transition = {
                    "metric": metric,
                    "previous_total_displayed": previous,
                    "signed_delta_displayed": signed_delta,
                    "observed_total_displayed": total,
                    "display_additive_residual": (
                        round(total - previous - signed_delta, 6)
                        if previous is not None and total is not None
                        else None
                    ),
                }
                state["component_ledger"].append(
                    {
                        "event_id": event["event_id"],
                        "metric": metric,
                        "direction": direction,
                        "displayed_magnitude": delta,
                        "signed_displayed_delta": signed_delta,
                        "source_lines": event["source_lines"],
                        "effect_instance": None,
                        "link_status": "effect_instance_not_reconstructed",
                    }
                )
                if total is not None:
                    state["percentages"][metric] = total

            elif event["event_type"] in {"stat_change", "troop_change"}:
                metric = event["metric"]
                total = event["total_displayed"]
                bucket = (
                    state["counters"]
                    if event["event_type"] == "troop_change"
                    else state["attributes"]
                )
                transition = {
                    "metric": metric,
                    "previous_total_displayed": bucket.get(metric),
                    "signed_delta_displayed": (
                        event["delta_displayed"]
                        if event["direction"] == "提升"
                        else -event["delta_displayed"]
                    ),
                    "observed_total_displayed": total,
                }
                if total is not None:
                    bucket[metric] = total

            elif event["event_type"] == "damage":
                damage = event["damage"]
                troops_after = event["troops_after"]
                inferred_before = (
                    troops_after + damage
                    if troops_after is not None and damage is not None
                    else None
                )
                previous = state["troops_after"]
                transition = {
                    "logged_damage": damage,
                    "troops_before_inferred": inferred_before,
                    "troops_after": troops_after,
                    "previous_known_troops_after": previous,
                    "previous_state_matches_inference": (
                        previous == inferred_before
                        if previous is not None and inferred_before is not None
                        else None
                    ),
                    "true_damage_relation": (
                        f">={damage}" if event["is_lethal_censored"] else f"={damage}"
                    ),
                }
                if troops_after is not None:
                    state["troops_after"] = troops_after

            elif event["event_type"] == "healing":
                healing = event["healing"]
                troops_after = event["troops_after"]
                transition = {
                    "logged_healing": healing,
                    "troops_before_inferred": (
                        troops_after - healing
                        if troops_after is not None and healing is not None
                        else None
                    ),
                    "troops_after": troops_after,
                }
                if troops_after is not None:
                    state["troops_after"] = troops_after

            elif event["event_type"] == "resistance":
                transition = {
                    "event_reduction": event["event_reduction"],
                    "semantics": "unknown_total_or_component",
                }

            after = copy.deepcopy(state)
        else:
            transition = {
                "reason": state_status,
                "identity": entity,
                "mutation_applied": False,
            }

        snapshots.append(
            {
                "schema_version": SCHEMA_VERSION,
                "battle_id": battle_id,
                "event_id": event["event_id"],
                "event_type": event["event_type"],
                "state_status": state_status,
                "subject_key": key,
                "state_before": before,
                "state_after": after,
                "transition": transition,
                "source_lines": event["source_lines"],
            }
        )

    status_counts = Counter(snapshot["state_status"] for snapshot in snapshots)
    quality = {
        "schema_version": SCHEMA_VERSION,
        "battle_id": battle_id,
        "snapshot_count": len(snapshots),
        "state_status_counts": dict(sorted(status_counts.items())),
        "tracked_subject_count": len(states),
        "tracked_subjects": sorted(states),
        "limitations": [
            "Mirror-name and inferred-side entities are never merged or force-resolved; their state mutations are skipped.",
            "Effect-instance links are unavailable in the stitched log and remain explicit nulls.",
            "A displayed resistance percentage is retained with unknown total-versus-component semantics.",
        ],
    }
    return snapshots, quality
