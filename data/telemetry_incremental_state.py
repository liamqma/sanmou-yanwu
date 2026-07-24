"""Deterministic aggregate-only checkpoint for incremental telemetry builds.

The checkpoint intentionally contains no raw events or stable client/session
identifiers.  It preserves additive analytics, a fixed-size distinct-session
estimate, and the sufficient state for an event-by-event conditional-choice
model so processed D1 rows can be removed in a later rollout.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from collections import Counter
from typing import Any, Iterable, Mapping

from build_telemetry_data import (
    ARTIFACT_SCHEMA_VERSION,
    EVENT_SCHEMA_VERSION,
    MAX_MODEL_VERSIONS,
    MAX_PREFERENCE_FEATURES,
    MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS,
    MEANINGFUL_PREFERENCE_MARGIN,
    MIN_FEATURE_SUPPORT,
    MIN_HOLDOUT_EVENTS,
    MIN_MODEL_DISAGREEMENTS,
    MIN_MODEL_EVENTS,
    MIN_MODEL_SESSIONS,
    MIN_RATE_SUPPORT,
    PREFERENCE_FEATURE_SCHEMA_VERSION,
    PREFERENCE_L2,
    PREFERENCE_QUALITY_DECIMAL_PLACES,
    PREFERENCE_VERSION_OTHER_BUCKET,
    ROUND_TYPES,
    InvalidTelemetryError,
    _MODEL_VERSION_RE,
    _PREFERENCE_MODEL_VERSION_RE,
    _is_int,
    _is_short_string,
    _minimum_preference_feature_support,
    _preference_feature_parts,
    _preference_features,
    _preference_quality_gate_passes,
    _quantize_preference_probabilities,
    _score_margin_bucket,
    _softmax,
    _version_counts,
)


STATE_SCHEMA_VERSION = 1
ONLINE_MODEL_SEMANTICS_VERSION = 2
ONLINE_FEATURE_SCHEMA_VERSION = PREFERENCE_FEATURE_SCHEMA_VERSION + 1
ONLINE_MODEL_ALGORITHM = "ftrl-proximal"
FTRL_ALPHA = 0.1
FTRL_BETA = 1.0
FTRL_L1 = 0.0
FTRL_L2 = PREFERENCE_L2
ONLINE_SCORE_FEATURE_LIMIT = 10.0
SESSION_HLL_PRECISION = 10
SESSION_HLL_REGISTER_COUNT = 1 << SESSION_HLL_PRECISION
CALIBRATION_BIN_COUNT = 10
MAX_STATE_FEATURES = 100_000
INCREMENTAL_ARTIFACT_SCHEMA_VERSION = 4
INCREMENTAL_PREFERENCE_MODEL_VERSION_PREFIX = "preference-v2:"
MODEL_VERSION_OTHER_BUCKET = "other"

_ROUND_COUNT_KEYS = {
    "event_count",
    "recommendation_accepted_count",
    "chosen_position_counts",
    "recommended_position_counts",
    "preference_top_disagreement_count",
    "meaningful_preference_disagreement_count",
    "player_preference_agreement_count",
    "meaningful_preference_disagreement_margin_total",
}
_ROUND_SHADOW_KEYS = {
    "preference_top_disagreement_count",
    "meaningful_preference_disagreement_count",
    "player_preference_agreement_count",
    "meaningful_preference_disagreement_margin_total",
}
_SCORE_MARGIN_KEYS = ("tie", "0_to_1", "1_to_3", "over_3")


def _empty_round_counts() -> dict[str, Any]:
    return {
        "event_count": 0,
        "recommendation_accepted_count": 0,
        "chosen_position_counts": [0, 0, 0],
        "recommended_position_counts": [0, 0, 0],
        "preference_top_disagreement_count": 0,
        "meaningful_preference_disagreement_count": 0,
        "player_preference_agreement_count": 0,
        "meaningful_preference_disagreement_margin_total": 0.0,
    }


def _empty_calibration_bin() -> dict[str, Any]:
    return {
        "count": 0,
        "confidence_sum": 0.0,
        "outcome_sum": 0.0,
    }


def new_state(catalog_version: str) -> dict[str, Any]:
    """Create an empty, deterministic checkpoint for one catalog."""
    return {
        "schema": {
            "version": STATE_SCHEMA_VERSION,
            "source_event_schema_version": EVENT_SCHEMA_VERSION,
            "shadow_artifact_schema_version": ARTIFACT_SCHEMA_VERSION,
            "preference_feature_schema_version": ONLINE_FEATURE_SCHEMA_VERSION,
            "preference_model_semantics_version": ONLINE_MODEL_SEMANTICS_VERSION,
        },
        "catalog_version": catalog_version,
        "cursor": {"last_processed_id": 0},
        "summary": {
            "event_count": 0,
            "invalid_event_count": 0,
            "recommendation_accepted_count": 0,
            "preference_event_count": 0,
            "model_version_counts": {},
            "preference_model_version_counts": {},
            "session_hll": {
                "precision": SESSION_HLL_PRECISION,
                "registers": [0] * SESSION_HLL_REGISTER_COUNT,
            },
        },
        "rounds": {
            str(number): _empty_round_counts()
            for number in ROUND_TYPES
        },
        "analytics": {
            "opportunity_counts": {"hero": 0, "skill": 0},
            "items": {"hero": {}, "skill": {}},
            "score_margins": {
                key: {
                    "event_count": 0,
                    "recommendation_accepted_count": 0,
                }
                for key in _SCORE_MARGIN_KEYS
            },
        },
        "preference_model": {
            "algorithm": ONLINE_MODEL_ALGORITHM,
            "alpha": FTRL_ALPHA,
            "beta": FTRL_BETA,
            "l1": FTRL_L1,
            "l2": FTRL_L2,
            "score_feature_limit": ONLINE_SCORE_FEATURE_LIMIT,
            "minimum_persisted_event_support": MIN_RATE_SUPPORT,
            "update_count": 0,
            "support": {},
            "z": {},
            "n": {},
            "evaluation": {
                "event_count": 0,
                "correct_count": 0,
                "log_loss_sum": 0.0,
                "brier_sum": 0.0,
                "paired_correct_count": 0,
                "calibration_bins": [
                    _empty_calibration_bin()
                    for _ in range(CALIBRATION_BIN_COUNT)
                ],
            },
        },
    }


def _require_non_negative_int(value: Any, description: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise InvalidTelemetryError(f"telemetry state {description} is invalid")
    return value


def _require_finite_number(
    value: Any,
    description: str,
    *,
    non_negative: bool = False,
) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or (non_negative and value < 0)
    ):
        raise InvalidTelemetryError(f"telemetry state {description} is invalid")
    return float(value)


def _validate_count_mapping(
    value: Any,
    description: str,
    *,
    maximum_keys: int | None = None,
) -> None:
    if not isinstance(value, dict) or (
        maximum_keys is not None and len(value) > maximum_keys
    ):
        raise InvalidTelemetryError(f"telemetry state {description} is invalid")
    for key, count in value.items():
        if not isinstance(key, str) or not key or len(key) > 128:
            raise InvalidTelemetryError(f"telemetry state {description} is invalid")
        _require_non_negative_int(count, description)


def validate_state(
    state: Mapping[str, Any],
    expected_catalog_version: str | None = None,
) -> None:
    """Fail closed when a persisted checkpoint is corrupt or incompatible."""
    required_top_level = {
        "schema",
        "catalog_version",
        "cursor",
        "summary",
        "rounds",
        "analytics",
        "preference_model",
    }
    if not isinstance(state, dict) or set(state) != required_top_level:
        raise InvalidTelemetryError("telemetry state contract is invalid")

    expected_schema = {
        "version": STATE_SCHEMA_VERSION,
        "source_event_schema_version": EVENT_SCHEMA_VERSION,
        "shadow_artifact_schema_version": ARTIFACT_SCHEMA_VERSION,
        "preference_feature_schema_version": ONLINE_FEATURE_SCHEMA_VERSION,
        "preference_model_semantics_version": ONLINE_MODEL_SEMANTICS_VERSION,
    }
    if state["schema"] != expected_schema:
        raise InvalidTelemetryError("telemetry state schema is incompatible")
    catalog_version = state["catalog_version"]
    if (
        not isinstance(catalog_version, str)
        or not catalog_version
        or (
            expected_catalog_version is not None
            and catalog_version != expected_catalog_version
        )
    ):
        raise InvalidTelemetryError("telemetry state catalog is incompatible")

    cursor = state["cursor"]
    if not isinstance(cursor, dict) or set(cursor) != {"last_processed_id"}:
        raise InvalidTelemetryError("telemetry state cursor is invalid")
    _require_non_negative_int(cursor["last_processed_id"], "cursor")

    summary = state["summary"]
    required_summary = {
        "event_count",
        "invalid_event_count",
        "recommendation_accepted_count",
        "preference_event_count",
        "model_version_counts",
        "preference_model_version_counts",
        "session_hll",
    }
    if not isinstance(summary, dict) or set(summary) != required_summary:
        raise InvalidTelemetryError("telemetry state summary is invalid")
    event_count = _require_non_negative_int(summary["event_count"], "event count")
    invalid_event_count = _require_non_negative_int(
        summary["invalid_event_count"], "invalid event count"
    )
    accepted_count = _require_non_negative_int(
        summary["recommendation_accepted_count"],
        "recommendation accepted count",
    )
    preference_event_count = _require_non_negative_int(
        summary["preference_event_count"], "preference event count"
    )
    if accepted_count > event_count or preference_event_count > event_count:
        raise InvalidTelemetryError("telemetry state summary totals are inconsistent")
    if event_count + invalid_event_count > cursor["last_processed_id"]:
        raise InvalidTelemetryError("telemetry state invalid event total is inconsistent")
    _validate_count_mapping(
        summary["model_version_counts"],
        "model version counts",
        maximum_keys=MAX_MODEL_VERSIONS,
    )
    if any(
        version != MODEL_VERSION_OTHER_BUCKET
        and _MODEL_VERSION_RE.fullmatch(version) is None
        for version in summary["model_version_counts"]
    ):
        raise InvalidTelemetryError(
            "telemetry state model version labels are invalid"
        )
    _validate_count_mapping(
        summary["preference_model_version_counts"],
        "preference model version counts",
    )
    if set(summary["preference_model_version_counts"]) - {
        PREFERENCE_VERSION_OTHER_BUCKET
    }:
        raise InvalidTelemetryError(
            "telemetry state preference version labels are invalid"
        )
    if sum(summary["model_version_counts"].values()) != event_count:
        raise InvalidTelemetryError("telemetry state model version total is inconsistent")
    if (
        sum(summary["preference_model_version_counts"].values())
        != preference_event_count
    ):
        raise InvalidTelemetryError(
            "telemetry state preference version total is inconsistent"
        )

    hll = summary["session_hll"]
    if (
        not isinstance(hll, dict)
        or set(hll) != {"precision", "registers"}
        or hll["precision"] != SESSION_HLL_PRECISION
        or not isinstance(hll["registers"], list)
        or len(hll["registers"]) != SESSION_HLL_REGISTER_COUNT
        or any(
            isinstance(register, bool)
            or not isinstance(register, int)
            or not 0 <= register <= 65 - SESSION_HLL_PRECISION
            for register in hll["registers"]
        )
    ):
        raise InvalidTelemetryError("telemetry state session estimate is invalid")

    rounds = state["rounds"]
    if (
        not isinstance(rounds, dict)
        or set(rounds) != {str(number) for number in ROUND_TYPES}
    ):
        raise InvalidTelemetryError("telemetry state rounds are invalid")
    round_event_total = 0
    round_accepted_total = 0
    expected_item_totals = {
        "hero": {"opportunities": 0, "offers": 0, "picks": 0},
        "skill": {"opportunities": 0, "offers": 0, "picks": 0},
    }
    for number in ROUND_TYPES:
        row = rounds[str(number)]
        if not isinstance(row, dict) or set(row) != _ROUND_COUNT_KEYS:
            raise InvalidTelemetryError(f"telemetry state round {number} is invalid")
        count = _require_non_negative_int(row["event_count"], f"round {number}")
        accepted = _require_non_negative_int(
            row["recommendation_accepted_count"], f"round {number}"
        )
        chosen = row["chosen_position_counts"]
        recommended = row["recommended_position_counts"]
        if (
            accepted > count
            or not isinstance(chosen, list)
            or not isinstance(recommended, list)
            or len(chosen) != 3
            or len(recommended) != 3
            or any(
                isinstance(value, bool) or not isinstance(value, int) or value < 0
                for value in [*chosen, *recommended]
            )
            or sum(chosen) != count
            or sum(recommended) != count
        ):
            raise InvalidTelemetryError(f"telemetry state round {number} is invalid")
        for field in (
            "preference_top_disagreement_count",
            "meaningful_preference_disagreement_count",
            "player_preference_agreement_count",
        ):
            if _require_non_negative_int(row[field], f"round {number}") > count:
                raise InvalidTelemetryError(
                    f"telemetry state round {number} is invalid"
                )
        if (
            row["meaningful_preference_disagreement_count"]
            > row["preference_top_disagreement_count"]
        ):
            raise InvalidTelemetryError(f"telemetry state round {number} is invalid")
        _require_finite_number(
            row["meaningful_preference_disagreement_margin_total"],
            f"round {number}",
            non_negative=True,
        )
        round_event_total += count
        round_accepted_total += accepted
        round_type = ROUND_TYPES[number]
        items_per_option = 2 if number == 7 else 3
        expected_item_totals[round_type]["opportunities"] += count
        expected_item_totals[round_type]["offers"] += (
            count * items_per_option * 3
        )
        expected_item_totals[round_type]["picks"] += (
            count * items_per_option
        )
    if round_event_total != event_count or round_accepted_total != accepted_count:
        raise InvalidTelemetryError("telemetry state round totals are inconsistent")

    analytics = state["analytics"]
    if (
        not isinstance(analytics, dict)
        or set(analytics)
        != {"opportunity_counts", "items", "score_margins"}
    ):
        raise InvalidTelemetryError("telemetry state analytics are invalid")
    opportunities = analytics["opportunity_counts"]
    items = analytics["items"]
    score_margins = analytics["score_margins"]
    if (
        not isinstance(opportunities, dict)
        or set(opportunities) != {"hero", "skill"}
        or not isinstance(items, dict)
        or set(items) != {"hero", "skill"}
        or not isinstance(score_margins, dict)
        or set(score_margins) != set(_SCORE_MARGIN_KEYS)
    ):
        raise InvalidTelemetryError("telemetry state analytics are invalid")
    for round_type in ("hero", "skill"):
        opportunity_count = _require_non_negative_int(
            opportunities[round_type], "opportunity count"
        )
        family_items = items[round_type]
        if not isinstance(family_items, dict):
            raise InvalidTelemetryError("telemetry state item counts are invalid")
        offer_total = 0
        picked_total = 0
        for name, counts in family_items.items():
            if (
                not isinstance(name, str)
                or not name
                or len(name) > 64
                or not isinstance(counts, dict)
                or set(counts) != {"offer_count", "picked_count"}
            ):
                raise InvalidTelemetryError("telemetry state item counts are invalid")
            offer_count = _require_non_negative_int(
                counts["offer_count"], "item offer count"
            )
            picked_count = _require_non_negative_int(
                counts["picked_count"], "item picked count"
            )
            if picked_count > offer_count or offer_count > opportunity_count:
                raise InvalidTelemetryError("telemetry state item counts are invalid")
            offer_total += offer_count
            picked_total += picked_count
        expected = expected_item_totals[round_type]
        if (
            opportunity_count != expected["opportunities"]
            or offer_total != expected["offers"]
            or picked_total != expected["picks"]
        ):
            raise InvalidTelemetryError(
                "telemetry state item totals are inconsistent"
            )
    margin_event_total = 0
    margin_accepted_total = 0
    for key in _SCORE_MARGIN_KEYS:
        counts = score_margins[key]
        if (
            not isinstance(counts, dict)
            or set(counts)
            != {"event_count", "recommendation_accepted_count"}
        ):
            raise InvalidTelemetryError("telemetry state score margins are invalid")
        count = _require_non_negative_int(
            counts["event_count"], "score margin event count"
        )
        accepted = _require_non_negative_int(
            counts["recommendation_accepted_count"],
            "score margin accepted count",
        )
        if accepted > count:
            raise InvalidTelemetryError("telemetry state score margins are invalid")
        margin_event_total += count
        margin_accepted_total += accepted
    if margin_event_total != event_count or margin_accepted_total != accepted_count:
        raise InvalidTelemetryError("telemetry state score-margin totals are inconsistent")

    model = state["preference_model"]
    required_model = {
        "algorithm",
        "alpha",
        "beta",
        "l1",
        "l2",
        "score_feature_limit",
        "minimum_persisted_event_support",
        "update_count",
        "support",
        "z",
        "n",
        "evaluation",
    }
    if (
        not isinstance(model, dict)
        or set(model) != required_model
        or model["algorithm"] != ONLINE_MODEL_ALGORITHM
        or model["alpha"] != FTRL_ALPHA
        or model["beta"] != FTRL_BETA
        or model["l1"] != FTRL_L1
        or model["l2"] != FTRL_L2
        or model["score_feature_limit"] != ONLINE_SCORE_FEATURE_LIMIT
        or model["minimum_persisted_event_support"] != MIN_RATE_SUPPORT
        or _require_non_negative_int(model["update_count"], "model update count")
        != event_count
        or not isinstance(model["support"], dict)
        or not isinstance(model["z"], dict)
        or not isinstance(model["n"], dict)
        or len(model["support"]) > MAX_STATE_FEATURES
        or set(model["support"]) != set(model["z"])
        or set(model["support"]) != set(model["n"])
    ):
        raise InvalidTelemetryError("telemetry state preference model is invalid")
    for feature_id in model["support"]:
        parts = _preference_feature_parts(feature_id)
        if parts is None:
            raise InvalidTelemetryError("telemetry state preference feature is invalid")
        support = _require_non_negative_int(
            model["support"][feature_id], "preference feature support"
        )
        if support < _minimum_persisted_feature_support(parts):
            raise InvalidTelemetryError(
                "telemetry state preference feature support is private"
            )
        _require_finite_number(model["z"][feature_id], "preference optimizer z")
        _require_finite_number(
            model["n"][feature_id],
            "preference optimizer n",
            non_negative=True,
        )

    evaluation = model["evaluation"]
    required_evaluation = {
        "event_count",
        "correct_count",
        "log_loss_sum",
        "brier_sum",
        "paired_correct_count",
        "calibration_bins",
    }
    if not isinstance(evaluation, dict) or set(evaluation) != required_evaluation:
        raise InvalidTelemetryError("telemetry state model evaluation is invalid")
    evaluation_count = _require_non_negative_int(
        evaluation["event_count"], "evaluation event count"
    )
    if evaluation_count > event_count:
        raise InvalidTelemetryError("telemetry state model evaluation is inconsistent")
    for field in ("correct_count", "paired_correct_count"):
        if _require_non_negative_int(evaluation[field], field) > evaluation_count:
            raise InvalidTelemetryError("telemetry state model evaluation is invalid")
    _require_finite_number(
        evaluation["log_loss_sum"], "evaluation log-loss", non_negative=True
    )
    _require_finite_number(
        evaluation["brier_sum"], "evaluation Brier score", non_negative=True
    )
    calibration_bins = evaluation["calibration_bins"]
    if (
        not isinstance(calibration_bins, list)
        or len(calibration_bins) != CALIBRATION_BIN_COUNT
    ):
        raise InvalidTelemetryError("telemetry state calibration is invalid")
    calibration_count = 0
    for row in calibration_bins:
        if (
            not isinstance(row, dict)
            or set(row) != {"count", "confidence_sum", "outcome_sum"}
        ):
            raise InvalidTelemetryError("telemetry state calibration is invalid")
        count = _require_non_negative_int(row["count"], "calibration count")
        confidence_sum = _require_finite_number(
            row["confidence_sum"], "calibration confidence", non_negative=True
        )
        outcome_sum = _require_finite_number(
            row["outcome_sum"], "calibration outcome", non_negative=True
        )
        if confidence_sum > count or outcome_sum > count:
            raise InvalidTelemetryError("telemetry state calibration is invalid")
        calibration_count += count
    if calibration_count > evaluation_count:
        raise InvalidTelemetryError("telemetry state calibration is inconsistent")


def _hll_add(hll: dict[str, Any], session_id: str) -> None:
    digest = hashlib.sha256(session_id.encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big")
    index = value >> (64 - SESSION_HLL_PRECISION)
    remainder_bits = 64 - SESSION_HLL_PRECISION
    remainder = value & ((1 << remainder_bits) - 1)
    rank = (
        remainder_bits + 1
        if remainder == 0
        else remainder_bits - remainder.bit_length() + 1
    )
    hll["registers"][index] = max(hll["registers"][index], rank)


def estimated_session_count(state: Mapping[str, Any]) -> int:
    """Return the deterministic rounded HyperLogLog cardinality estimate."""
    registers = state["summary"]["session_hll"]["registers"]
    count = len(registers)
    alpha = 0.7213 / (1 + 1.079 / count)
    estimate = alpha * count * count / sum(2.0 ** -register for register in registers)
    zero_count = registers.count(0)
    if estimate <= 2.5 * count and zero_count:
        estimate = count * math.log(count / zero_count)
    return max(0, int(round(estimate)))


def _online_preference_features(
    event: Mapping[str, Any],
    option_index: int,
) -> dict[str, float]:
    features = _preference_features(event, option_index)
    for feature_id, value in list(features.items()):
        parts = _preference_feature_parts(feature_id)
        if parts and parts[0] in {"score", "round_score"}:
            features[feature_id] = max(
                -ONLINE_SCORE_FEATURE_LIMIT,
                min(ONLINE_SCORE_FEATURE_LIMIT, value),
            )
    return features


def _ftrl_weight(model: Mapping[str, Any], feature_id: str) -> float:
    z = float(model["z"].get(feature_id, 0.0))
    n = float(model["n"].get(feature_id, 0.0))
    if abs(z) <= FTRL_L1:
        return 0.0
    return -(
        z - math.copysign(FTRL_L1, z)
    ) / ((FTRL_BETA + math.sqrt(n)) / FTRL_ALPHA + FTRL_L2)


def _minimum_persisted_feature_support(parts: list[Any]) -> int:
    # Score features occur once per option, so three observations represent one
    # event. Every other feature can occur at most once per event for a given
    # feature ID.
    if parts[0] in {"score", "round_score"}:
        return MIN_RATE_SUPPORT * 3
    return max(MIN_FEATURE_SUPPORT, _minimum_preference_feature_support(parts))


def _feature_is_deployable(model: Mapping[str, Any], feature_id: str) -> bool:
    parts = _preference_feature_parts(feature_id)
    return bool(
        parts is not None
        and model["support"].get(feature_id, 0)
        >= _minimum_persisted_feature_support(parts)
    )


def _discard_low_support_model_updates(
    model: dict[str, Any],
    previous_model: Mapping[str, Any],
) -> None:
    """Persist each optimizer delta only after a privacy-sized new batch."""
    retained: set[str] = set()
    previous_support = previous_model["support"]
    for feature_id, support in model["support"].items():
        parts = _preference_feature_parts(feature_id)
        if parts is None:
            continue
        support_delta = support - int(previous_support.get(feature_id, 0))
        if support_delta >= _minimum_persisted_feature_support(parts):
            retained.add(feature_id)
        elif feature_id in previous_support:
            retained.add(feature_id)
            for field in ("support", "z", "n"):
                model[field][feature_id] = previous_model[field][feature_id]

    for field in ("support", "z", "n"):
        model[field] = {
            feature_id: model[field][feature_id]
            for feature_id in sorted(retained)
        }


def _discard_low_support_evaluation_updates(
    model: dict[str, Any],
    previous_model: Mapping[str, Any],
    interval_event_count: int,
) -> None:
    """Release evaluation deltas only in privacy-sized groups."""
    evaluation = model["evaluation"]
    previous_evaluation = previous_model["evaluation"]
    if interval_event_count < MIN_RATE_SUPPORT:
        model["evaluation"] = copy.deepcopy(previous_evaluation)
        return

    for index, row in enumerate(evaluation["calibration_bins"]):
        previous_row = previous_evaluation["calibration_bins"][index]
        if row["count"] - previous_row["count"] < MIN_RATE_SUPPORT:
            evaluation["calibration_bins"][index] = copy.deepcopy(previous_row)


def _discard_low_support_round_shadow_updates(
    rounds: dict[str, Any],
    previous_rounds: Mapping[str, Any],
) -> None:
    """Release each round's prediction deltas only in privacy-sized groups."""
    for number in ROUND_TYPES:
        key = str(number)
        row = rounds[key]
        previous_row = previous_rounds[key]
        interval_event_count = row["event_count"] - previous_row["event_count"]
        if interval_event_count < MIN_RATE_SUPPORT:
            for field in _ROUND_SHADOW_KEYS:
                row[field] = copy.deepcopy(previous_row[field])


def _prequential_probabilities(
    model: Mapping[str, Any],
    option_features: list[dict[str, float]],
) -> list[float]:
    utilities = []
    for features in option_features:
        utilities.append(
            sum(
                _ftrl_weight(model, feature_id) * value
                for feature_id, value in features.items()
                if _feature_is_deployable(model, feature_id)
            )
        )
    return _softmax(utilities)


def _update_evaluation(
    evaluation: dict[str, Any],
    event: Mapping[str, Any],
    probabilities: list[float],
) -> None:
    chosen_index = int(event["chosen_index"])
    top_index = min(
        range(3),
        key=lambda index: (-probabilities[index], index),
    )
    evaluation["event_count"] += 1
    evaluation["correct_count"] += int(top_index == chosen_index)
    evaluation["paired_correct_count"] += int(
        int(event["recommended_index"]) == chosen_index
    )
    evaluation["log_loss_sum"] -= math.log(
        max(probabilities[chosen_index], 1e-15)
    )
    evaluation["brier_sum"] += sum(
        (
            probability
            - (1.0 if option_index == chosen_index else 0.0)
        )
        ** 2
        for option_index, probability in enumerate(probabilities)
    ) / 3
    confidence = probabilities[top_index]
    calibration = evaluation["calibration_bins"][
        min(CALIBRATION_BIN_COUNT - 1, int(confidence * CALIBRATION_BIN_COUNT))
    ]
    calibration["count"] += 1
    calibration["confidence_sum"] += confidence
    calibration["outcome_sum"] += float(top_index == chosen_index)


def _update_online_model(
    model: dict[str, Any],
    event: Mapping[str, Any],
) -> list[float]:
    option_features = [
        _online_preference_features(event, option_index)
        for option_index in range(3)
    ]
    probabilities = _prequential_probabilities(model, option_features)
    _update_evaluation(model["evaluation"], event, probabilities)

    gradients: Counter[str] = Counter()
    chosen_index = int(event["chosen_index"])
    for option_index, features in enumerate(option_features):
        residual = probabilities[option_index] - (
            1.0 if option_index == chosen_index else 0.0
        )
        for feature_id, value in features.items():
            gradients[feature_id] += residual * value
            if (
                feature_id not in model["support"]
                and len(model["support"]) >= MAX_STATE_FEATURES
            ):
                raise InvalidTelemetryError(
                    "telemetry state preference feature limit is exceeded"
                )
            model["support"][feature_id] = (
                int(model["support"].get(feature_id, 0)) + 1
            )

    for feature_id in sorted(gradients):
        gradient = float(gradients[feature_id])
        previous_n = float(model["n"].get(feature_id, 0.0))
        weight = _ftrl_weight(model, feature_id)
        next_n = previous_n + gradient * gradient
        sigma = (math.sqrt(next_n) - math.sqrt(previous_n)) / FTRL_ALPHA
        model["z"][feature_id] = (
            float(model["z"].get(feature_id, 0.0))
            + gradient
            - sigma * weight
        )
        model["n"][feature_id] = next_n
    model["update_count"] += 1
    return probabilities


def _increment_count(mapping: dict[str, int], key: str) -> None:
    mapping[key] = int(mapping.get(key, 0)) + 1


def _increment_bounded_model_version(
    mapping: dict[str, int],
    version: str,
) -> None:
    """Keep model labels bounded while preserving the exact event total."""
    if version in mapping:
        _increment_count(mapping, version)
        return
    while len(mapping) >= MAX_MODEL_VERSIONS:
        candidates = [
            key
            for key in mapping
            if key != MODEL_VERSION_OTHER_BUCKET
        ]
        if not candidates:
            _increment_count(mapping, MODEL_VERSION_OTHER_BUCKET)
            return
        victim = min(candidates, key=lambda key: (mapping[key], key))
        compacted_count = mapping.pop(victim)
        mapping[MODEL_VERSION_OTHER_BUCKET] = (
            int(mapping.get(MODEL_VERSION_OTHER_BUCKET, 0))
            + compacted_count
        )
    mapping[version] = 1


def _fold_event(
    state: dict[str, Any],
    event: Mapping[str, Any],
) -> None:
    summary = state["summary"]
    summary["event_count"] += 1
    model_version = str(event["model_version"])
    _increment_bounded_model_version(
        summary["model_version_counts"],
        model_version,
    )
    preference_version = event["preference_model_version"]
    if isinstance(preference_version, str):
        summary["preference_event_count"] += 1
        _increment_count(
            summary["preference_model_version_counts"],
            PREFERENCE_VERSION_OTHER_BUCKET,
        )
    _hll_add(summary["session_hll"], str(event["session_id"]))

    probabilities = _update_online_model(state["preference_model"], event)
    displayed_probabilities = _quantize_preference_probabilities(probabilities)
    top_index = min(
        range(3),
        key=lambda index: (-displayed_probabilities[index], index),
    )
    sorted_probabilities = sorted(displayed_probabilities, reverse=True)
    probability_margin = sorted_probabilities[0] - sorted_probabilities[1]

    round_number = int(event["round_number"])
    row = state["rounds"][str(round_number)]
    recommended_index = int(event["recommended_index"])
    chosen_index = int(event["chosen_index"])
    row["event_count"] += 1
    row["recommended_position_counts"][recommended_index] += 1
    row["chosen_position_counts"][chosen_index] += 1
    if recommended_index == chosen_index:
        row["recommendation_accepted_count"] += 1
        summary["recommendation_accepted_count"] += 1
    row["preference_top_disagreement_count"] += int(
        top_index != recommended_index
    )
    meaningful_disagreement = (
        top_index != recommended_index
        and probability_margin >= MEANINGFUL_PREFERENCE_MARGIN
    )
    row["meaningful_preference_disagreement_count"] += int(
        meaningful_disagreement
    )
    if meaningful_disagreement:
        row["meaningful_preference_disagreement_margin_total"] += (
            probability_margin
        )
    row["player_preference_agreement_count"] += int(top_index == chosen_index)

    round_type = str(event["round_type"])
    state["analytics"]["opportunity_counts"][round_type] += 1
    family_items = state["analytics"]["items"][round_type]
    for offered_set in event["offered_sets"]:
        for item in offered_set:
            counts = family_items.setdefault(
                str(item),
                {"offer_count": 0, "picked_count": 0},
            )
            counts["offer_count"] += 1
    for item in event["offered_sets"][chosen_index]:
        counts = family_items.setdefault(
            str(item),
            {"offer_count": 0, "picked_count": 0},
        )
        counts["picked_count"] += 1

    paired_scores = [float(score) for score in event["paired_scores"]]
    margin = paired_scores[recommended_index] - max(
        score
        for index, score in enumerate(paired_scores)
        if index != recommended_index
    )
    margin_counts = state["analytics"]["score_margins"][
        _score_margin_bucket(max(0.0, margin))
    ]
    margin_counts["event_count"] += 1
    if recommended_index == chosen_index:
        margin_counts["recommendation_accepted_count"] += 1


def fold_events(
    previous_state: Mapping[str, Any] | None,
    events: Iterable[Mapping[str, Any]],
    *,
    catalog_version: str,
    last_processed_id: int,
    invalid_event_count: int = 0,
) -> dict[str, Any]:
    """Fold one ordered D1 ID interval into a validated checkpoint."""
    if previous_state is None:
        state = new_state(catalog_version)
    else:
        validate_state(previous_state, catalog_version)
        state = copy.deepcopy(previous_state)

    previous_model = copy.deepcopy(state["preference_model"])
    previous_rounds = copy.deepcopy(state["rounds"])
    previous_id = int(state["cursor"]["last_processed_id"])
    if last_processed_id < previous_id:
        raise InvalidTelemetryError("telemetry export is behind the persisted cursor")
    previous_event_id = previous_id
    for event in events:
        row_id = event.get("row_id")
        if (
            isinstance(row_id, bool)
            or not isinstance(row_id, int)
            or not previous_event_id < row_id <= last_processed_id
        ):
            raise InvalidTelemetryError(
                "incremental telemetry events are not strictly ID-ordered"
            )
        _fold_event(state, event)
        previous_event_id = row_id

    # Low-support optimizer deltas combine literal item/pool feature IDs with
    # gradients that could reveal a small weekly batch's choices. They are
    # deliberately discarded, including updates to already-persisted features.
    # This is intentionally lossy because the model is only indicative.
    _discard_low_support_model_updates(
        state["preference_model"],
        previous_model,
    )
    _discard_low_support_evaluation_updates(
        state["preference_model"],
        previous_model,
        state["summary"]["event_count"]
        - int(previous_state["summary"]["event_count"])
        if previous_state is not None
        else state["summary"]["event_count"],
    )
    _discard_low_support_round_shadow_updates(
        state["rounds"],
        previous_rounds,
    )
    state["summary"]["invalid_event_count"] += _require_non_negative_int(
        invalid_event_count,
        "new invalid event count",
    )
    state["cursor"]["last_processed_id"] = last_processed_id
    validate_state(state, catalog_version)
    return state


def state_aggregate_snapshot(state: Mapping[str, Any]) -> dict[str, Any]:
    """Render only the additive fields shared with the current public artifact."""
    validate_state(state)
    summary = state["summary"]
    rounds = []
    for number, round_type in ROUND_TYPES.items():
        counts = state["rounds"][str(number)]
        rounds.append(
            {
                "round_number": number,
                "round_type": round_type,
                "event_count": counts["event_count"],
                "recommendation_accepted_count": counts[
                    "recommendation_accepted_count"
                ],
                "chosen_position_counts": list(counts["chosen_position_counts"]),
                "recommended_position_counts": list(
                    counts["recommended_position_counts"]
                ),
            }
        )

    items = {"heroes": [], "skills": []}
    for round_type, family in (("hero", "heroes"), ("skill", "skills")):
        opportunity_count = state["analytics"]["opportunity_counts"][round_type]
        for name, counts in sorted(
            state["analytics"]["items"][round_type].items()
        ):
            items[family].append(
                {
                    "name": name,
                    "offer_count": counts["offer_count"],
                    "opportunity_count": opportunity_count,
                    "picked_count": counts["picked_count"],
                    "rate_suppressed": counts["offer_count"] < MIN_RATE_SUPPORT,
                }
            )

    labels = {
        "tie": "并列",
        "0_to_1": "0–1 分",
        "1_to_3": "1–3 分",
        "over_3": "超过 3 分",
    }
    score_margins = []
    for key in _SCORE_MARGIN_KEYS:
        counts = state["analytics"]["score_margins"][key]
        score_margins.append(
            {
                "key": key,
                "label": labels[key],
                "event_count": counts["event_count"],
                "recommendation_accepted_count": counts[
                    "recommendation_accepted_count"
                ],
                "rate_suppressed": counts["event_count"] < MIN_RATE_SUPPORT,
            }
        )

    preference_event_count = summary["preference_event_count"]
    published_preference_versions = (
        [
            {
                "version": PREFERENCE_VERSION_OTHER_BUCKET,
                "event_count": preference_event_count,
            }
        ]
        if preference_event_count
        else []
    )

    return {
        "summary": {
            "event_count": summary["event_count"],
            "invalid_event_count": summary["invalid_event_count"],
            # HyperLogLog is approximate and can very slightly overshoot the
            # number of events. A session cannot exist without an event, so
            # keep the public estimate inside that hard upper bound.
            "estimated_session_count": min(
                summary["event_count"],
                estimated_session_count(state),
            ),
            "recommendation_accepted_count": summary[
                "recommendation_accepted_count"
            ],
            "preference_event_count": summary["preference_event_count"],
            "model_versions": _version_counts(summary["model_version_counts"]),
            "preference_model_versions": published_preference_versions,
        },
        "rounds": rounds,
        "analytics": {
            "minimum_rate_support": MIN_RATE_SUPPORT,
            "items": items,
            "score_margins": score_margins,
        },
    }


def validate_state_matches_artifact(
    state: Mapping[str, Any],
    artifact: Mapping[str, Any],
) -> None:
    """Ensure a no-delete replay matches every additive public aggregate."""
    if artifact.get("schema") == {
        "version": INCREMENTAL_ARTIFACT_SCHEMA_VERSION,
        "source_event_schema_version": EVENT_SCHEMA_VERSION,
    }:
        if artifact != build_public_artifact(state):
            raise InvalidTelemetryError(
                "incremental telemetry state disagrees with public artifact"
            )
        return

    snapshot = state_aggregate_snapshot(state)
    public_summary = artifact.get("summary")
    if not isinstance(public_summary, dict):
        raise InvalidTelemetryError("public telemetry summary is invalid")
    for field in (
        "event_count",
        "invalid_event_count",
        "recommendation_accepted_count",
        "preference_event_count",
        "model_versions",
    ):
        if snapshot["summary"][field] != public_summary.get(field):
            raise InvalidTelemetryError(
                f"incremental telemetry state disagrees with public {field}"
            )

    public_rounds = artifact.get("rounds")
    if not isinstance(public_rounds, list):
        raise InvalidTelemetryError("public telemetry rounds are invalid")
    reduced_public_rounds = [
        {
            field: row[field]
            for field in (
                "round_number",
                "round_type",
                "event_count",
                "recommendation_accepted_count",
                "chosen_position_counts",
                "recommended_position_counts",
            )
        }
        for row in public_rounds
    ]
    if snapshot["rounds"] != reduced_public_rounds:
        raise InvalidTelemetryError(
            "incremental telemetry state disagrees with public rounds"
        )
    if snapshot["analytics"] != artifact.get("analytics"):
        raise InvalidTelemetryError(
            "incremental telemetry state disagrees with public analytics"
        )


def online_model_snapshot(state: Mapping[str, Any]) -> dict[str, Any]:
    """Return a deterministic, publishable preview of the online model."""
    validate_state(state)
    model = state["preference_model"]
    eligible = sorted(
        (
            feature_id
            for feature_id in model["support"]
            if _feature_is_deployable(model, feature_id)
        ),
        key=lambda feature_id: (
            -model["support"][feature_id],
            feature_id,
        ),
    )[:5_000]
    weights = {
        feature_id: round(_ftrl_weight(model, feature_id), 12)
        for feature_id in sorted(eligible)
    }
    support = {
        feature_id: model["support"][feature_id]
        for feature_id in sorted(eligible)
    }
    evaluation = model["evaluation"]
    count = evaluation["event_count"]
    calibration_count = sum(
        row["count"]
        for row in evaluation["calibration_bins"]
    )
    if count:
        calibration_error = (
            sum(
                row["count"]
                / calibration_count
                * abs(
                    row["confidence_sum"] / row["count"]
                    - row["outcome_sum"] / row["count"]
                )
                for row in evaluation["calibration_bins"]
                if row["count"]
            )
            if calibration_count
            else None
        )
        metrics: dict[str, Any] = {
            "method": "prequential",
            "event_count": count,
            "calibration_event_count": calibration_count,
            "accuracy": round(evaluation["correct_count"] / count, 6),
            "log_loss": round(
                evaluation["log_loss_sum"] / count,
                PREFERENCE_QUALITY_DECIMAL_PLACES,
            ),
            "brier": round(evaluation["brier_sum"] / count, 6),
            "calibration_error": (
                round(calibration_error, 6)
                if calibration_error is not None
                else None
            ),
            "paired_accuracy": round(
                evaluation["paired_correct_count"] / count,
                6,
            ),
            "uniform_log_loss": round(
                math.log(3),
                PREFERENCE_QUALITY_DECIMAL_PLACES,
            ),
        }
    else:
        metrics = {
            "method": "prequential",
            "event_count": 0,
            "calibration_event_count": 0,
            "accuracy": None,
            "log_loss": None,
            "brier": None,
            "calibration_error": None,
            "paired_accuracy": None,
            "uniform_log_loss": round(
                math.log(3),
                PREFERENCE_QUALITY_DECIMAL_PLACES,
            ),
        }
    canonical = json.dumps(
        {
            "schema": ONLINE_MODEL_SEMANTICS_VERSION,
            "weights": weights,
            "support": support,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    version = (
        "preference-v2:"
        + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
        if weights
        else None
    )
    return {
        "model_type": "conditional-choice-logit",
        "feature_schema_version": ONLINE_FEATURE_SCHEMA_VERSION,
        "semantics_version": ONLINE_MODEL_SEMANTICS_VERSION,
        "algorithm": ONLINE_MODEL_ALGORITHM,
        "minimum_persisted_event_support": MIN_RATE_SUPPORT,
        "version": version,
        "evaluation": metrics,
        "weights": weights,
        "support": support,
    }


def _incremental_preference_artifact(
    state: Mapping[str, Any],
    aggregate: Mapping[str, Any],
) -> dict[str, Any]:
    """Gate the resumable model before exposing any coefficients publicly."""
    preview = online_model_snapshot(state)
    summary = aggregate["summary"]
    event_count = int(summary["event_count"])
    estimated_sessions = int(summary["estimated_session_count"])
    disagreements = (
        event_count - int(summary["recommendation_accepted_count"])
    )
    evaluation = preview["evaluation"]
    evidence = {
        "event_count": event_count,
        "estimated_session_count": estimated_sessions,
        "recommendation_disagreement_count": disagreements,
        "minimum_event_count": MIN_MODEL_EVENTS,
        "minimum_estimated_session_count": MIN_MODEL_SESSIONS,
        "minimum_recommendation_disagreement_count": MIN_MODEL_DISAGREEMENTS,
        "evaluation_event_count": evaluation["event_count"],
        "minimum_evaluation_event_count": MIN_HOLDOUT_EVENTS,
    }
    evidence_sufficient = (
        event_count >= MIN_MODEL_EVENTS
        and estimated_sessions >= MIN_MODEL_SESSIONS
        and disagreements >= MIN_MODEL_DISAGREEMENTS
        and evaluation["event_count"] >= MIN_HOLDOUT_EVENTS
    )
    quality_passed = bool(
        evidence_sufficient
        and preview["version"]
        and preview["weights"]
        and evaluation["log_loss"] is not None
        and _preference_quality_gate_passes(
            float(evaluation["log_loss"]),
            float(evaluation["uniform_log_loss"]),
        )
    )
    status = (
        "insufficient_evidence"
        if not evidence_sufficient
        else "ready"
        if quality_passed
        else "quality_gate_failed"
    )
    ready = status == "ready"
    return {
        "model_type": preview["model_type"],
        "feature_schema_version": preview["feature_schema_version"],
        "semantics_version": preview["semantics_version"],
        "algorithm": preview["algorithm"],
        "meaningful_probability_margin": MEANINGFUL_PREFERENCE_MARGIN,
        "l2": PREFERENCE_L2,
        "minimum_persisted_event_support": preview[
            "minimum_persisted_event_support"
        ],
        "evidence": evidence,
        "status": status,
        "version": preview["version"] if ready else None,
        "evaluation": evaluation,
        "weights": preview["weights"] if ready else {},
        "support": preview["support"] if ready else {},
    }


def build_public_artifact(state: Mapping[str, Any]) -> dict[str, Any]:
    """Render the cumulative schema-v4 artifact solely from checkpoint state."""
    validate_state(state)
    aggregate = state_aggregate_snapshot(state)
    preference_model = _incremental_preference_artifact(state, aggregate)
    preference_ready = preference_model["status"] == "ready"

    rounds = []
    for aggregate_row in aggregate["rounds"]:
        number = int(aggregate_row["round_number"])
        state_row = state["rounds"][str(number)]
        meaningful_count = int(
            state_row["meaningful_preference_disagreement_count"]
        )
        average_margin = (
            round(
                float(
                    state_row[
                        "meaningful_preference_disagreement_margin_total"
                    ]
                )
                / meaningful_count,
                6,
            )
            if preference_ready and meaningful_count >= MIN_RATE_SUPPORT
            else None
        )
        rounds.append(
            {
                **aggregate_row,
                "rate_suppressed": (
                    aggregate_row["event_count"] < MIN_RATE_SUPPORT
                ),
                "preference_top_disagreement_count": (
                    state_row["preference_top_disagreement_count"]
                    if preference_ready
                    else None
                ),
                "meaningful_preference_disagreement_count": (
                    meaningful_count if preference_ready else None
                ),
                "player_preference_agreement_count": (
                    state_row["player_preference_agreement_count"]
                    if preference_ready
                    else None
                ),
                "average_meaningful_preference_disagreement_margin": (
                    average_margin
                ),
            }
        )

    aggregate_summary = aggregate["summary"]
    artifact = {
        "schema": {
            "version": INCREMENTAL_ARTIFACT_SCHEMA_VERSION,
            "source_event_schema_version": EVENT_SCHEMA_VERSION,
        },
        "catalog_version": state["catalog_version"],
        "summary": {
            "event_count": aggregate_summary["event_count"],
            "invalid_event_count": aggregate_summary[
                "invalid_event_count"
            ],
            "estimated_session_count": aggregate_summary[
                "estimated_session_count"
            ],
            "recommendation_accepted_count": aggregate_summary[
                "recommendation_accepted_count"
            ],
            "preference_event_count": aggregate_summary[
                "preference_event_count"
            ],
            "model_versions": aggregate_summary["model_versions"],
            "preference_model_versions": aggregate_summary[
                "preference_model_versions"
            ],
        },
        "rounds": rounds,
        "analytics": aggregate["analytics"],
        "preference_model": preference_model,
    }
    validate_public_artifact(artifact)
    return artifact


def _require_public_count(value: Any, description: str) -> int:
    if not _is_int(value) or value < 0:
        raise InvalidTelemetryError(
            f"incremental public telemetry {description} is invalid"
        )
    return value


def _validate_public_version_counts(
    value: Any,
    expected_total: int,
    *,
    preference: bool = False,
) -> None:
    maximum = (
        MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS
        if preference
        else MAX_MODEL_VERSIONS
    )
    if (
        not isinstance(value, list)
        or len(value) > maximum
        or value
        != sorted(
            value,
            key=lambda entry: (
                entry.get("version", "")
                if isinstance(entry, dict)
                else ""
            ),
        )
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry version counts are invalid"
        )
    total = 0
    versions: set[str] = set()
    for row in value:
        if (
            not isinstance(row, dict)
            or set(row) != {"version", "event_count"}
            or not _is_short_string(row["version"])
            or not _is_int(row["event_count"])
            or row["event_count"] <= 0
            or row["version"] in versions
        ):
            raise InvalidTelemetryError(
                "incremental public telemetry version counts are invalid"
            )
        version = row["version"]
        if preference:
            if (
                version != PREFERENCE_VERSION_OTHER_BUCKET
                and (
                    not _PREFERENCE_MODEL_VERSION_RE.fullmatch(version)
                    or row["event_count"] < MIN_RATE_SUPPORT
                )
            ):
                raise InvalidTelemetryError(
                    "incremental public telemetry preference versions are invalid"
                )
        elif (
            version != MODEL_VERSION_OTHER_BUCKET
            and not _MODEL_VERSION_RE.fullmatch(version)
        ):
            raise InvalidTelemetryError(
                "incremental public telemetry model versions are invalid"
            )
        versions.add(version)
        total += row["event_count"]
    if total != expected_total:
        raise InvalidTelemetryError(
            "incremental public telemetry version totals are invalid"
        )


def _validate_public_evaluation(
    value: Any,
    total_events: int,
) -> None:
    keys = {
        "method",
        "event_count",
        "calibration_event_count",
        "accuracy",
        "log_loss",
        "brier",
        "calibration_error",
        "paired_accuracy",
        "uniform_log_loss",
    }
    if (
        not isinstance(value, dict)
        or set(value) != keys
        or value["method"] != "prequential"
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry evaluation is invalid"
        )
    event_count = _require_public_count(
        value["event_count"],
        "evaluation event count",
    )
    calibration_count = _require_public_count(
        value["calibration_event_count"],
        "evaluation calibration count",
    )
    if event_count > total_events or calibration_count > event_count:
        raise InvalidTelemetryError(
            "incremental public telemetry evaluation totals are invalid"
        )
    uniform_log_loss = value["uniform_log_loss"]
    if (
        isinstance(uniform_log_loss, bool)
        or not isinstance(uniform_log_loss, (int, float))
        or not math.isfinite(uniform_log_loss)
        or uniform_log_loss
        != round(math.log(3), PREFERENCE_QUALITY_DECIMAL_PLACES)
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry evaluation baseline is invalid"
        )
    metric_fields = (
        "accuracy",
        "log_loss",
        "brier",
        "paired_accuracy",
    )
    if event_count == 0:
        if any(value[field] is not None for field in metric_fields) or value[
            "calibration_error"
        ] is not None:
            raise InvalidTelemetryError(
                "incremental public telemetry empty evaluation is invalid"
            )
        return
    for field in metric_fields:
        metric = value[field]
        if (
            isinstance(metric, bool)
            or not isinstance(metric, (int, float))
            or not math.isfinite(metric)
        ):
            raise InvalidTelemetryError(
                "incremental public telemetry evaluation metrics are invalid"
            )
    if not (
        0 <= value["accuracy"] <= 1
        and value["log_loss"] >= 0
        and 0 <= value["brier"] <= 1
        and 0 <= value["paired_accuracy"] <= 1
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry evaluation metrics are invalid"
        )
    calibration_error = value["calibration_error"]
    if calibration_count == 0:
        if calibration_error is not None:
            raise InvalidTelemetryError(
                "incremental public telemetry calibration is invalid"
            )
    elif (
        isinstance(calibration_error, bool)
        or not isinstance(calibration_error, (int, float))
        or not math.isfinite(calibration_error)
        or not 0 <= calibration_error <= 1
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry calibration is invalid"
        )


def _validate_public_preference_model(
    model: Any,
    summary: Mapping[str, Any],
) -> bool:
    keys = {
        "model_type",
        "feature_schema_version",
        "semantics_version",
        "algorithm",
        "meaningful_probability_margin",
        "l2",
        "minimum_persisted_event_support",
        "evidence",
        "status",
        "version",
        "evaluation",
        "weights",
        "support",
    }
    if (
        not isinstance(model, dict)
        or set(model) != keys
        or model["model_type"] != "conditional-choice-logit"
        or model["feature_schema_version"] != ONLINE_FEATURE_SCHEMA_VERSION
        or model["semantics_version"] != ONLINE_MODEL_SEMANTICS_VERSION
        or model["algorithm"] != ONLINE_MODEL_ALGORITHM
        or model["meaningful_probability_margin"]
        != MEANINGFUL_PREFERENCE_MARGIN
        or model["l2"] != PREFERENCE_L2
        or model["minimum_persisted_event_support"] != MIN_RATE_SUPPORT
        or model["status"]
        not in {
            "insufficient_evidence",
            "quality_gate_failed",
            "ready",
        }
        or not isinstance(model["weights"], dict)
        or not isinstance(model["support"], dict)
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry preference model is invalid"
        )

    evidence = model["evidence"]
    evidence_keys = {
        "event_count",
        "estimated_session_count",
        "recommendation_disagreement_count",
        "minimum_event_count",
        "minimum_estimated_session_count",
        "minimum_recommendation_disagreement_count",
        "evaluation_event_count",
        "minimum_evaluation_event_count",
    }
    if not isinstance(evidence, dict) or set(evidence) != evidence_keys:
        raise InvalidTelemetryError(
            "incremental public telemetry preference evidence is invalid"
        )
    for field in evidence_keys:
        _require_public_count(
            evidence[field],
            f"preference evidence {field}",
        )
    total_events = int(summary["event_count"])
    if (
        evidence["event_count"] != total_events
        or evidence["estimated_session_count"]
        != summary["estimated_session_count"]
        or evidence["recommendation_disagreement_count"]
        != total_events - summary["recommendation_accepted_count"]
        or evidence["minimum_event_count"] != MIN_MODEL_EVENTS
        or evidence["minimum_estimated_session_count"]
        != MIN_MODEL_SESSIONS
        or evidence["minimum_recommendation_disagreement_count"]
        != MIN_MODEL_DISAGREEMENTS
        or evidence["minimum_evaluation_event_count"]
        != MIN_HOLDOUT_EVENTS
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry preference evidence is inconsistent"
        )

    _validate_public_evaluation(model["evaluation"], total_events)
    if (
        evidence["evaluation_event_count"]
        != model["evaluation"]["event_count"]
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry evaluation evidence is inconsistent"
        )
    evidence_sufficient = (
        evidence["event_count"] >= evidence["minimum_event_count"]
        and evidence["estimated_session_count"]
        >= evidence["minimum_estimated_session_count"]
        and evidence["recommendation_disagreement_count"]
        >= evidence["minimum_recommendation_disagreement_count"]
        and evidence["evaluation_event_count"]
        >= evidence["minimum_evaluation_event_count"]
    )
    evaluation = model["evaluation"]
    quality_metrics_passed = bool(
        evidence_sufficient
        and evaluation["log_loss"] is not None
        and _preference_quality_gate_passes(
            float(evaluation["log_loss"]),
            float(evaluation["uniform_log_loss"]),
        )
    )
    ready = model["status"] == "ready"
    if model["status"] == "insufficient_evidence" and evidence_sufficient:
        raise InvalidTelemetryError(
            "incremental public telemetry preference status is inconsistent"
        )
    if model["status"] == "quality_gate_failed" and not evidence_sufficient:
        raise InvalidTelemetryError(
            "incremental public telemetry preference status is inconsistent"
        )
    if ready and (not evidence_sufficient or not quality_metrics_passed):
        raise InvalidTelemetryError(
            "incremental public telemetry preference status is inconsistent"
        )

    weights = model["weights"]
    support = model["support"]
    if not ready:
        if model["version"] is not None or weights or support:
            raise InvalidTelemetryError(
                "incremental unavailable preference model exposes coefficients"
            )
        return False

    if (
        not isinstance(model["version"], str)
        or not model["version"].startswith(
            INCREMENTAL_PREFERENCE_MODEL_VERSION_PREFIX
        )
        or len(model["version"])
        != len(INCREMENTAL_PREFERENCE_MODEL_VERSION_PREFIX) + 16
        or any(
            character not in "0123456789abcdef"
            for character in model["version"][
                len(INCREMENTAL_PREFERENCE_MODEL_VERSION_PREFIX) :
            ]
        )
        or not weights
        or len(weights) > MAX_PREFERENCE_FEATURES
        or set(weights) != set(support)
    ):
        raise InvalidTelemetryError(
            "incremental ready preference model is invalid"
        )
    for feature_id, weight in weights.items():
        parts = _preference_feature_parts(feature_id)
        if (
            parts is None
            or isinstance(weight, bool)
            or not isinstance(weight, (int, float))
            or not math.isfinite(weight)
            or not _is_int(support[feature_id])
            or support[feature_id]
            < _minimum_persisted_feature_support(parts)
        ):
            raise InvalidTelemetryError(
                "incremental ready preference coefficients are invalid"
            )
    return True


def validate_public_artifact(artifact: Mapping[str, Any]) -> None:
    """Validate the cumulative schema-v4 public checkpoint projection."""
    if (
        not isinstance(artifact, dict)
        or set(artifact)
        != {
            "schema",
            "catalog_version",
            "summary",
            "rounds",
            "analytics",
            "preference_model",
        }
        or artifact["schema"]
        != {
            "version": INCREMENTAL_ARTIFACT_SCHEMA_VERSION,
            "source_event_schema_version": EVENT_SCHEMA_VERSION,
        }
        or not _is_short_string(artifact["catalog_version"])
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry artifact contract is invalid"
        )

    summary = artifact["summary"]
    summary_keys = {
        "event_count",
        "invalid_event_count",
        "estimated_session_count",
        "recommendation_accepted_count",
        "preference_event_count",
        "model_versions",
        "preference_model_versions",
    }
    if not isinstance(summary, dict) or set(summary) != summary_keys:
        raise InvalidTelemetryError(
            "incremental public telemetry summary is invalid"
        )
    event_count = _require_public_count(
        summary["event_count"],
        "event count",
    )
    _require_public_count(
        summary["invalid_event_count"],
        "invalid event count",
    )
    estimated_sessions = _require_public_count(
        summary["estimated_session_count"],
        "estimated session count",
    )
    accepted_count = _require_public_count(
        summary["recommendation_accepted_count"],
        "recommendation accepted count",
    )
    preference_event_count = _require_public_count(
        summary["preference_event_count"],
        "preference event count",
    )
    if (
        estimated_sessions > event_count
        or accepted_count > event_count
        or preference_event_count > event_count
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry summary totals are invalid"
        )
    _validate_public_version_counts(
        summary["model_versions"],
        event_count,
    )
    _validate_public_version_counts(
        summary["preference_model_versions"],
        preference_event_count,
        preference=True,
    )
    preference_ready = _validate_public_preference_model(
        artifact["preference_model"],
        summary,
    )

    rounds = artifact["rounds"]
    if not isinstance(rounds, list) or len(rounds) != len(ROUND_TYPES):
        raise InvalidTelemetryError(
            "incremental public telemetry rounds are invalid"
        )
    round_event_total = 0
    round_accepted_total = 0
    round_keys = {
        "round_number",
        "round_type",
        "event_count",
        "recommendation_accepted_count",
        "chosen_position_counts",
        "recommended_position_counts",
        "rate_suppressed",
        "preference_top_disagreement_count",
        "meaningful_preference_disagreement_count",
        "player_preference_agreement_count",
        "average_meaningful_preference_disagreement_margin",
    }
    for number, row in enumerate(rounds, start=1):
        if (
            not isinstance(row, dict)
            or set(row) != round_keys
            or row["round_number"] != number
            or row["round_type"] != ROUND_TYPES[number]
        ):
            raise InvalidTelemetryError(
                f"incremental public telemetry round {number} is invalid"
            )
        count = _require_public_count(
            row["event_count"],
            f"round {number} event count",
        )
        accepted = _require_public_count(
            row["recommendation_accepted_count"],
            f"round {number} accepted count",
        )
        chosen = row["chosen_position_counts"]
        recommended = row["recommended_position_counts"]
        if (
            accepted > count
            or not isinstance(chosen, list)
            or not isinstance(recommended, list)
            or len(chosen) != 3
            or len(recommended) != 3
            or any(
                not _is_int(value) or value < 0
                for value in [*chosen, *recommended]
            )
            or sum(chosen) != count
            or sum(recommended) != count
            or not isinstance(row["rate_suppressed"], bool)
            or row["rate_suppressed"] != (count < MIN_RATE_SUPPORT)
        ):
            raise InvalidTelemetryError(
                f"incremental public telemetry round {number} counts are invalid"
            )
        preference_fields = (
            "preference_top_disagreement_count",
            "meaningful_preference_disagreement_count",
            "player_preference_agreement_count",
        )
        if not preference_ready:
            if (
                any(row[field] is not None for field in preference_fields)
                or row[
                    "average_meaningful_preference_disagreement_margin"
                ]
                is not None
            ):
                raise InvalidTelemetryError(
                    f"incremental public telemetry round {number} preference data is invalid"
                )
        else:
            for field in preference_fields:
                value = _require_public_count(
                    row[field],
                    f"round {number} {field}",
                )
                if value > count:
                    raise InvalidTelemetryError(
                        f"incremental public telemetry round {number} preference data is invalid"
                    )
            if (
                row["meaningful_preference_disagreement_count"]
                > row["preference_top_disagreement_count"]
            ):
                raise InvalidTelemetryError(
                    f"incremental public telemetry round {number} preference data is invalid"
                )
            meaningful_count = row[
                "meaningful_preference_disagreement_count"
            ]
            average_margin = row[
                "average_meaningful_preference_disagreement_margin"
            ]
            if meaningful_count < MIN_RATE_SUPPORT:
                if average_margin is not None:
                    raise InvalidTelemetryError(
                        f"incremental public telemetry round {number} preference margin is invalid"
                    )
            elif (
                isinstance(average_margin, bool)
                or not isinstance(average_margin, (int, float))
                or not math.isfinite(average_margin)
                or not MEANINGFUL_PREFERENCE_MARGIN <= average_margin <= 1
            ):
                raise InvalidTelemetryError(
                    f"incremental public telemetry round {number} preference margin is invalid"
                )
        round_event_total += count
        round_accepted_total += accepted
    if (
        round_event_total != event_count
        or round_accepted_total != accepted_count
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry round totals are invalid"
        )

    analytics = artifact["analytics"]
    if (
        not isinstance(analytics, dict)
        or set(analytics)
        != {"minimum_rate_support", "items", "score_margins"}
        or analytics["minimum_rate_support"] != MIN_RATE_SUPPORT
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry analytics are invalid"
        )
    items = analytics["items"]
    if not isinstance(items, dict) or set(items) != {"heroes", "skills"}:
        raise InvalidTelemetryError(
            "incremental public telemetry items are invalid"
        )
    opportunity_counts = {
        "heroes": sum(
            row["event_count"]
            for row in rounds
            if row["round_type"] == "hero"
        ),
        "skills": sum(
            row["event_count"]
            for row in rounds
            if row["round_type"] == "skill"
        ),
    }
    expected_item_totals = {
        "heroes": {"offers": 0, "picks": 0},
        "skills": {"offers": 0, "picks": 0},
    }
    for round_row in rounds:
        family = (
            "heroes"
            if round_row["round_type"] == "hero"
            else "skills"
        )
        items_per_option = (
            2 if round_row["round_number"] == 7 else 3
        )
        expected_item_totals[family]["offers"] += (
            round_row["event_count"] * items_per_option * 3
        )
        expected_item_totals[family]["picks"] += (
            round_row["event_count"] * items_per_option
        )
    for family in ("heroes", "skills"):
        rows = items[family]
        if (
            not isinstance(rows, list)
            or rows
            != sorted(
                rows,
                key=lambda row: (
                    row.get("name", "")
                    if isinstance(row, dict)
                    else ""
                ),
            )
        ):
            raise InvalidTelemetryError(
                f"incremental public telemetry {family} are invalid"
            )
        names: set[str] = set()
        offer_total = 0
        picked_total = 0
        for row in rows:
            if (
                not isinstance(row, dict)
                or set(row)
                != {
                    "name",
                    "offer_count",
                    "opportunity_count",
                    "picked_count",
                    "rate_suppressed",
                }
                or not _is_short_string(row["name"], 64)
                or row["name"] in names
            ):
                raise InvalidTelemetryError(
                    f"incremental public telemetry {family} are invalid"
                )
            offer_count = _require_public_count(
                row["offer_count"],
                f"{family} offer count",
            )
            opportunity_count = _require_public_count(
                row["opportunity_count"],
                f"{family} opportunity count",
            )
            picked_count = _require_public_count(
                row["picked_count"],
                f"{family} picked count",
            )
            if (
                offer_count <= 0
                or opportunity_count != opportunity_counts[family]
                or offer_count > opportunity_count
                or picked_count > offer_count
                or not isinstance(row["rate_suppressed"], bool)
                or row["rate_suppressed"]
                != (offer_count < MIN_RATE_SUPPORT)
            ):
                raise InvalidTelemetryError(
                    f"incremental public telemetry {family} counts are invalid"
                )
            names.add(row["name"])
            offer_total += offer_count
            picked_total += picked_count
        expected = expected_item_totals[family]
        if (
            offer_total != expected["offers"]
            or picked_total != expected["picks"]
        ):
            raise InvalidTelemetryError(
                f"incremental public telemetry {family} totals are invalid"
            )

    score_margins = analytics["score_margins"]
    if (
        not isinstance(score_margins, list)
        or [
            row.get("key") if isinstance(row, dict) else None
            for row in score_margins
        ]
        != list(_SCORE_MARGIN_KEYS)
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry score margins are invalid"
        )
    margin_event_total = 0
    margin_accepted_total = 0
    expected_labels = {
        "tie": "并列",
        "0_to_1": "0–1 分",
        "1_to_3": "1–3 分",
        "over_3": "超过 3 分",
    }
    for row in score_margins:
        if (
            not isinstance(row, dict)
            or set(row)
            != {
                "key",
                "label",
                "event_count",
                "recommendation_accepted_count",
                "rate_suppressed",
            }
            or row["label"] != expected_labels[row["key"]]
            or not isinstance(row["rate_suppressed"], bool)
        ):
            raise InvalidTelemetryError(
                "incremental public telemetry score margins are invalid"
            )
        count = _require_public_count(
            row["event_count"],
            "score-margin event count",
        )
        accepted = _require_public_count(
            row["recommendation_accepted_count"],
            "score-margin accepted count",
        )
        if (
            accepted > count
            or row["rate_suppressed"] != (count < MIN_RATE_SUPPORT)
        ):
            raise InvalidTelemetryError(
                "incremental public telemetry score margins are invalid"
            )
        margin_event_total += count
        margin_accepted_total += accepted
    if (
        margin_event_total != event_count
        or margin_accepted_total != accepted_count
    ):
        raise InvalidTelemetryError(
            "incremental public telemetry score-margin totals are invalid"
        )
