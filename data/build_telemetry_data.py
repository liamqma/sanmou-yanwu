#!/usr/bin/env python3
"""Build the deterministic public analytics/model artifact from a D1 export.

The input is the SQL file produced by ``wrangler d1 export --table
round_telemetry``.  It is loaded into an in-memory SQLite database, validated
against the schema-v1 browser contract and current game catalog, and reduced to
counts and, once evidence is sufficient, a regularized conditional-choice
model that are safe to publish. Raw events are never written by this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import tempfile
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping


ARTIFACT_SCHEMA_VERSION = 3
EVENT_SCHEMA_VERSION = 1
MAX_MODEL_VERSIONS = 32
MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS = 32
PREFERENCE_VERSION_OTHER_BUCKET = "other"
MIN_RATE_SUPPORT = 10
MIN_MODEL_EVENTS = 240
MIN_MODEL_SESSIONS = 40
MIN_MODEL_DISAGREEMENTS = 30
MIN_HOLDOUT_EVENTS = 36
MIN_FEATURE_SUPPORT = 10
MAX_PREFERENCE_FEATURES = 5_000
PREFERENCE_FEATURE_SCHEMA_VERSION = 1
PREFERENCE_MODEL_FAMILY = "conditional-choice-logit"
PREFERENCE_L2 = 0.05
PREFERENCE_ITERATIONS = 200
MEANINGFUL_PREFERENCE_MARGIN = 0.10
MIN_HELD_OUT_LOG_LOSS_IMPROVEMENT = 0.01
PREFERENCE_QUALITY_DECIMAL_PLACES = 12
HOLDOUT_BUCKETS = 5
ROUND_TYPES = {
    1: "hero",
    2: "skill",
    3: "skill",
    4: "hero",
    5: "skill",
    6: "skill",
    7: "hero",
    8: "skill",
}
EXPECTED_COLUMNS = (
    "id",
    "event_id",
    "session_id",
    "client_ts",
    "received_at",
    "round_number",
    "round_type",
    "schema_version",
    "model_version",
    "catalog_version",
    "pool_before_json",
    "offered_sets_json",
    "paired_scores_json",
    "recommended_index",
    "chosen_index",
    "preference_model_version",
    "preference_probs_json",
)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_ISO_UTC_MILLIS_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
)
_CORPUS_VERSION_RE = re.compile(r"^[0-9a-f]{16}$")
_MODEL_VERSION_RE = re.compile(r"^[1-9]\d*:[0-9a-f]{16}$")
_PREFERENCE_MODEL_VERSION_RE = re.compile(
    r"^preference-v[1-9]\d*:[0-9a-f]{16}$"
)
_READY_PREFERENCE_MODEL_VERSION_RE = re.compile(
    r"^preference-v1:[0-9a-f]{16}$"
)


class InvalidTelemetryError(ValueError):
    """Raised when an export cannot safely produce a public artifact."""


class InvalidTelemetryEventError(InvalidTelemetryError):
    """Raised when one event is invalid but the export contract is intact."""


class TelemetryContractError(InvalidTelemetryError):
    """Raised when event data cannot be verified against a retained contract."""


@dataclass(frozen=True)
class RecommendationModel:
    version: str
    weights: Mapping[str, float]
    support: Mapping[str, int]


@dataclass(frozen=True)
class TelemetryContract:
    catalog_version: str
    hero_names: frozenset[str]
    pool_skill_names: frozenset[str]
    round_skill_names: frozenset[str]
    support_skill_names: frozenset[str]
    models: Mapping[str, RecommendationModel]


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_short_string(value: Any, maximum: int = 128) -> bool:
    return isinstance(value, str) and 0 < len(value) <= maximum


def _reject_constant(value: str) -> None:
    raise InvalidTelemetryError(f"non-standard JSON number {value!r}")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidTelemetryError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _load_json_field(raw: Any, field: str) -> Any:
    if not isinstance(raw, str):
        raise InvalidTelemetryError(f"{field} must contain JSON text")
    try:
        return json.loads(
            raw,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (json.JSONDecodeError, InvalidTelemetryError) as exc:
        raise InvalidTelemetryError(f"{field} contains invalid JSON: {exc}") from exc


def _load_json_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise InvalidTelemetryError(f"cannot read {description} {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise InvalidTelemetryError(f"{description} must be a JSON object")
    return value


def _load_recommendation_model(
    path: Path,
    catalog_version: str,
) -> RecommendationModel:
    recommendation = _load_json_object(path, "recommendation artifact")
    recommendation_catalog = recommendation.get("catalog")
    recommendation_version = (
        recommendation_catalog.get("catalog_version")
        if isinstance(recommendation_catalog, dict)
        else None
    )
    if recommendation_version != catalog_version:
        raise InvalidTelemetryError(
            "catalog mismatch between database.json and recommendation artifact"
        )

    schema = recommendation.get("schema")
    battle_counts = recommendation.get("battle_counts")
    model = recommendation.get("model")
    schema_version = schema.get("version") if isinstance(schema, dict) else None
    corpus_version = (
        battle_counts.get("corpus_version")
        if isinstance(battle_counts, dict)
        else None
    )
    if (
        not _is_int(schema_version)
        or schema_version <= 0
        or not isinstance(corpus_version, str)
        or not _CORPUS_VERSION_RE.fullmatch(corpus_version)
        or not isinstance(model, dict)
        or not isinstance(model.get("weights"), dict)
        or not isinstance(model.get("support"), dict)
    ):
        raise InvalidTelemetryError("recommendation artifact model contract is invalid")

    weights: dict[str, float] = {}
    for feature_id, value in model["weights"].items():
        if (
            not _is_short_string(feature_id, 256)
            or isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise InvalidTelemetryError("recommendation artifact weights are invalid")
        weights[feature_id] = float(value)

    support: dict[str, int] = {}
    for feature_id, value in model["support"].items():
        if not _is_short_string(feature_id, 256) or not _is_int(value) or value < 0:
            raise InvalidTelemetryError("recommendation artifact support is invalid")
        support[feature_id] = value

    version = f"{schema_version}:{corpus_version}"
    if not _MODEL_VERSION_RE.fullmatch(version):
        raise InvalidTelemetryError("recommendation artifact version is invalid")
    return RecommendationModel(version=version, weights=weights, support=support)


def load_catalog(
    database_path: Path,
    recommendation_paths: Path | Iterable[Path],
) -> TelemetryContract:
    """Load catalog eligibility and an immutable model-version registry."""
    database = _load_json_object(database_path, "game database")
    heroes = database.get("heroes")
    skills = database.get("skills")
    if not isinstance(heroes, dict) or not isinstance(skills, dict):
        raise InvalidTelemetryError("game database must contain heroes and skills objects")
    if any(
        not isinstance(name, str) or not isinstance(value, dict)
        for name, value in heroes.items()
    ):
        raise InvalidTelemetryError("game database hero metadata is invalid")
    if any(
        not isinstance(name, str) or not isinstance(value, dict)
        for name, value in skills.items()
    ):
        raise InvalidTelemetryError("game database skill metadata is invalid")

    default_skill = {
        name: hero.get("skill")
        for name, hero in heroes.items()
        if isinstance(name, str) and isinstance(hero, dict) and hero.get("skill")
    }
    payload = json.dumps(
        {
            "heroes": sorted(heroes),
            "skills": sorted(skills),
            "default_skill": default_skill,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    catalog_version = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]

    default_skills = set(default_skill.values())
    support_skill_names = set(skills) - default_skills
    round_skill_names = {
        name
        for name, metadata in skills.items()
        if name in support_skill_names
        and isinstance(metadata, dict)
        and metadata.get("color") == "orange"
    }
    paths = (
        [recommendation_paths]
        if isinstance(recommendation_paths, Path)
        else list(recommendation_paths)
    )
    if not paths or len(paths) > MAX_MODEL_VERSIONS:
        raise InvalidTelemetryError(
            f"recommendation model registry must contain 1-{MAX_MODEL_VERSIONS} artifacts"
        )
    models: dict[str, RecommendationModel] = {}
    for path in paths:
        recommendation_model = _load_recommendation_model(path, catalog_version)
        existing = models.get(recommendation_model.version)
        if existing is not None and existing != recommendation_model:
            raise InvalidTelemetryError("conflicting recommendation artifacts share a version")
        models[recommendation_model.version] = recommendation_model

    return TelemetryContract(
        catalog_version=catalog_version,
        hero_names=frozenset(heroes),
        pool_skill_names=frozenset(skills),
        round_skill_names=frozenset(round_skill_names),
        support_skill_names=frozenset(support_skill_names),
        models=models,
    )


def _normalized_schema_sql(value: Any) -> str:
    if not isinstance(value, str):
        raise InvalidTelemetryError("round_telemetry table definition is missing")
    return " ".join(value.rstrip(";").split())


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _schema_contract(connection: sqlite3.Connection) -> tuple[Any, ...]:
    table = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'round_telemetry'"
    ).fetchone()
    if table is None:
        raise InvalidTelemetryError("round_telemetry table definition is missing")

    columns = tuple(
        (
            row["cid"],
            row["name"],
            row["type"],
            row["notnull"],
            row["dflt_value"],
            row["pk"],
        )
        for row in connection.execute("PRAGMA table_info(round_telemetry)")
    )
    indexes = []
    for index in connection.execute("PRAGMA index_list(round_telemetry)"):
        index_columns = tuple(
            row["name"]
            for row in connection.execute(
                f"PRAGMA index_info({_quote_identifier(index['name'])})"
            )
        )
        indexes.append(
            (
                index["unique"],
                index["origin"],
                index["partial"],
                index_columns,
            )
        )
    return (
        _normalized_schema_sql(table["sql"]),
        columns,
        tuple(sorted(indexes, key=repr)),
    )


def _load_sql_connection(sql: str, description: str) -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript(sql)
    except sqlite3.Error as exc:
        connection.close()
        raise InvalidTelemetryError(
            f"{description} is not valid SQLite SQL: {exc}"
        ) from exc
    return connection


def _load_export(export_path: Path, migration_path: Path) -> sqlite3.Connection:
    try:
        sql = export_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise InvalidTelemetryError(f"cannot read D1 export {export_path}: {exc}") from exc
    if not sql.strip():
        raise InvalidTelemetryError("D1 export is empty")

    try:
        migration_sql = migration_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise InvalidTelemetryError(
            f"cannot read canonical D1 migration {migration_path}: {exc}"
        ) from exc

    connection = _load_sql_connection(sql, "D1 export")

    objects = connection.execute(
        "SELECT type, name FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    ).fetchall()
    unexpected = [
        (row["type"], row["name"])
        for row in objects
        if not (row["type"] == "table" and row["name"] == "round_telemetry")
        and row["type"] != "index"
    ]
    tables = [row["name"] for row in objects if row["type"] == "table"]
    if tables != ["round_telemetry"] or unexpected:
        connection.close()
        raise InvalidTelemetryError(
            "D1 export must contain only the round_telemetry table"
        )

    canonical = _load_sql_connection(migration_sql, "canonical D1 migration")
    try:
        actual_contract = _schema_contract(connection)
        expected_contract = _schema_contract(canonical)
    finally:
        canonical.close()
    if actual_contract != expected_contract:
        connection.close()
        raise InvalidTelemetryError(
            "round_telemetry schema mismatch with canonical migration"
        )
    return connection


def _validate_uuid(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _UUID_RE.fullmatch(value):
        raise InvalidTelemetryError(f"{field} must be a UUID")
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise InvalidTelemetryError(f"{field} must be a UUID") from exc
    return str(parsed)


def _validate_item_list(
    value: Any,
    field: str,
    maximum: int,
    known_items: set[str],
) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum:
        raise InvalidTelemetryError(f"{field} must be a list of at most {maximum} items")
    for item in value:
        if not _is_short_string(item, 64) or item not in known_items:
            raise InvalidTelemetryError(f"{field} contains an unknown or invalid item")
    return value


def _hero_id(hero: str) -> str:
    return f"H|{hero}"


def _hero_pair_id(first: str, second: str) -> str:
    left, right = sorted((first, second))
    return f"HP|{left}|{right}"


def _skill_id(skill: str) -> str:
    return f"S|{skill}"


def _hero_skill_id(hero: str, skill: str) -> str:
    return f"HS|{hero}|{skill}"


def _hero_feature_ids(heroes: Iterable[str]) -> set[str]:
    unique_heroes = sorted(set(heroes))
    features = {_hero_id(hero) for hero in unique_heroes}
    for index, first in enumerate(unique_heroes):
        for second in unique_heroes[index + 1 :]:
            features.add(_hero_pair_id(first, second))
    return features


def _weight(model: RecommendationModel, feature_id: str) -> float:
    return float(model.weights.get(feature_id, 0.0))


def _support(model: RecommendationModel, feature_id: str) -> int:
    return int(model.support.get(feature_id, 0))


def _display_score(value: float) -> float:
    """Match the client's ``Math.round(value * 100) / 10`` display score."""
    scaled = value * 100
    return math.floor(scaled + 0.5) / 10


def _expected_recommendation(
    round_type: str,
    current_heroes: list[str],
    offered_sets: list[list[str]],
    model: RecommendationModel,
) -> tuple[list[float], int]:
    scores: list[float] = []
    evidence_totals: list[int] = []

    if round_type == "hero":
        base_features = _hero_feature_ids(current_heroes)
        for offered_set in offered_sets:
            combined_features = _hero_feature_ids([*current_heroes, *offered_set])
            delta = sum(
                _weight(model, feature_id)
                for feature_id in combined_features - base_features
            )
            scores.append(_display_score(delta))
            evidence_totals.append(
                sum(
                    _support(model, feature_id)
                    for feature_id in combined_features
                    if feature_id in model.weights
                )
            )
    else:
        for offered_set in offered_sets:
            delta = 0.0
            evidence_total = 0
            for skill in offered_set:
                standalone_id = _skill_id(skill)
                standalone = _weight(model, standalone_id)
                delta += standalone
                if standalone != 0:
                    evidence_total += _support(model, standalone_id)

                best_hero: str | None = None
                best_weight = -math.inf
                for hero in current_heroes:
                    candidate = _weight(model, _hero_skill_id(hero, skill))
                    if candidate > best_weight:
                        best_hero = hero
                        best_weight = candidate
                if best_hero is not None:
                    delta += best_weight
                    if best_weight != 0:
                        evidence_total += _support(
                            model, _hero_skill_id(best_hero, skill)
                        )
            scores.append(_display_score(delta))
            evidence_totals.append(evidence_total)

    recommended_index = min(
        range(3),
        key=lambda index: (-scores[index], -evidence_totals[index], index),
    )
    return scores, recommended_index


def _validate_event_fields(
    row: sqlite3.Row,
    contract: TelemetryContract,
) -> dict[str, Any]:
    row_id = row["id"]
    if not _is_int(row_id) or row_id <= 0:
        raise InvalidTelemetryError("id must be a positive integer")
    event_id = _validate_uuid(row["event_id"], "event_id")
    session_id = _validate_uuid(row["session_id"], "session_id")

    client_ts = row["client_ts"]
    if not isinstance(client_ts, str) or not _ISO_UTC_MILLIS_RE.fullmatch(client_ts):
        raise InvalidTelemetryError("client_ts must be an ISO UTC millisecond timestamp")
    try:
        datetime.strptime(client_ts, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError as exc:
        raise InvalidTelemetryError("client_ts must be a valid timestamp") from exc
    if not _is_short_string(row["received_at"], 40):
        raise InvalidTelemetryError("received_at must be present")

    round_number = row["round_number"]
    if not _is_int(round_number) or round_number not in ROUND_TYPES:
        raise InvalidTelemetryError("round_number must be between 1 and 8")
    round_type = row["round_type"]
    if round_type != ROUND_TYPES[round_number]:
        raise InvalidTelemetryError("round_type does not match round_number")
    if row["schema_version"] != EVENT_SCHEMA_VERSION:
        raise TelemetryContractError("unsupported telemetry schema_version")
    model_version = row["model_version"]
    if (
        not isinstance(model_version, str)
        or not _MODEL_VERSION_RE.fullmatch(model_version)
        or model_version not in contract.models
    ):
        raise TelemetryContractError(
            "model_version is not in the retained model registry"
        )
    if row["catalog_version"] != contract.catalog_version:
        raise TelemetryContractError("event catalog mismatch")

    pool = _load_json_field(row["pool_before_json"], "pool_before_json")
    if not isinstance(pool, dict) or not {"heroes", "skills"}.issubset(pool):
        raise InvalidTelemetryError("pool_before_json must contain heroes and skills")
    allowed_pool_keys = {"heroes", "skills", "hero_support", "skills_support"}
    if set(pool) - allowed_pool_keys:
        raise InvalidTelemetryError("pool_before_json has unexpected fields")
    pool_heroes = _validate_item_list(
        pool["heroes"], "pool heroes", 20, set(contract.hero_names)
    )
    pool_skills = _validate_item_list(
        pool["skills"], "pool skills", 32, set(contract.pool_skill_names)
    )
    if len(pool_heroes) != len(set(pool_heroes)):
        raise InvalidTelemetryError("pool heroes contains duplicates")
    if len(pool_skills) != len(set(pool_skills)):
        raise InvalidTelemetryError("pool skills contains duplicates")
    hero_support = None
    if "hero_support" in pool:
        if (
            not _is_short_string(pool["hero_support"], 64)
            or pool["hero_support"] not in contract.hero_names
        ):
            raise InvalidTelemetryError("pool hero_support is unknown or invalid")
        hero_support = pool["hero_support"]
        if hero_support in pool_heroes:
            raise InvalidTelemetryError("pool hero_support duplicates the normal hero pool")
    skills_support: list[str] = []
    if "skills_support" in pool:
        skills_support = _validate_item_list(
            pool["skills_support"],
            "pool skills_support",
            2,
            set(contract.support_skill_names),
        )
        if not skills_support:
            raise InvalidTelemetryError("pool skills_support cannot be empty")
        if len(skills_support) != len(set(skills_support)):
            raise InvalidTelemetryError("pool skills_support contains duplicates")
        if set(skills_support) & set(pool_skills):
            raise InvalidTelemetryError(
                "pool skills_support overlaps the normal skill pool"
            )

    offered_sets = _load_json_field(row["offered_sets_json"], "offered_sets_json")
    items_per_set = 2 if round_number == 7 else 3
    known_offers = (
        set(contract.hero_names)
        if round_type == "hero"
        else set(contract.round_skill_names)
    )
    if not isinstance(offered_sets, list) or len(offered_sets) != 3:
        raise InvalidTelemetryError("offered_sets_json must contain three sets")
    flattened_offers: list[str] = []
    for index, offered_set in enumerate(offered_sets):
        validated = _validate_item_list(
            offered_set, f"offered set {index}", items_per_set, known_offers
        )
        if len(validated) != items_per_set:
            raise InvalidTelemetryError(
                f"offered set {index} must contain {items_per_set} items"
            )
        flattened_offers.extend(validated)
    if len(flattened_offers) != len(set(flattened_offers)):
        raise InvalidTelemetryError("offered_sets_json contains duplicate offered items")
    occupied_items = set(pool_heroes if round_type == "hero" else pool_skills)
    if round_type == "hero" and hero_support is not None:
        occupied_items.add(hero_support)
    if round_type == "skill":
        occupied_items.update(skills_support)
    if occupied_items & set(flattened_offers):
        raise InvalidTelemetryError(
            "offered_sets_json overlaps the existing pool or support selections"
        )

    paired_scores = _load_json_field(row["paired_scores_json"], "paired_scores_json")
    if (
        not isinstance(paired_scores, list)
        or len(paired_scores) != 3
        or any(
            isinstance(score, bool)
            or not isinstance(score, (int, float))
            or not math.isfinite(score)
            or abs(score) > 1_000_000
            for score in paired_scores
        )
    ):
        raise InvalidTelemetryError("paired_scores_json must contain three finite scores")

    recommended_index = row["recommended_index"]
    chosen_index = row["chosen_index"]
    if (
        not _is_int(recommended_index)
        or recommended_index not in range(3)
        or not _is_int(chosen_index)
        or chosen_index not in range(3)
    ):
        raise InvalidTelemetryError("choice indices must be between 0 and 2")
    current_heroes = [*pool_heroes, *([hero_support] if hero_support else [])]
    expected_scores, expected_index = _expected_recommendation(
        round_type,
        current_heroes,
        offered_sets,
        contract.models[model_version],
    )
    if any(
        not math.isclose(actual, expected, rel_tol=0, abs_tol=1e-9)
        for actual, expected in zip(paired_scores, expected_scores, strict=True)
    ):
        raise TelemetryContractError(
            "paired_scores_json does not match the retained recommendation model"
        )
    if recommended_index != expected_index:
        raise TelemetryContractError(
            "recommended_index does not match the model score and tie-break contract"
        )

    preference_version = row["preference_model_version"]
    preference_raw = row["preference_probs_json"]
    if preference_version is None and preference_raw is None:
        preference_probabilities = None
    elif (
        _is_short_string(preference_version)
        and _PREFERENCE_MODEL_VERSION_RE.fullmatch(preference_version)
        and isinstance(preference_raw, str)
    ):
        preference_probabilities = _load_json_field(
            preference_raw, "preference_probs_json"
        )
        if (
            not isinstance(preference_probabilities, list)
            or len(preference_probabilities) != 3
            or any(
                isinstance(probability, bool)
                or not isinstance(probability, (int, float))
                or not math.isfinite(probability)
                or probability < 0
                or probability > 1
                for probability in preference_probabilities
            )
            or abs(sum(preference_probabilities) - 1) > 1e-6
        ):
            raise InvalidTelemetryError(
                "preference_probs_json must contain three normalized probabilities"
            )
    else:
        raise InvalidTelemetryError(
            "preference version and probabilities must both be null or valid"
        )

    return {
        "event_id": event_id,
        "session_id": session_id,
        "round_number": round_number,
        "round_type": round_type,
        "model_version": model_version,
        "pool_before": {
            "heroes": list(pool_heroes),
            "skills": list(pool_skills),
            **({"hero_support": hero_support} if hero_support else {}),
            **({"skills_support": list(skills_support)} if skills_support else {}),
        },
        "offered_sets": [list(offered_set) for offered_set in offered_sets],
        "paired_scores": [float(score) for score in paired_scores],
        "recommended_index": recommended_index,
        "chosen_index": chosen_index,
        "preference_model_version": preference_version,
        "preference_probabilities": preference_probabilities,
    }


def _validate_event(
    row: sqlite3.Row,
    contract: TelemetryContract,
) -> dict[str, Any]:
    try:
        return _validate_event_fields(row, contract)
    except TelemetryContractError:
        raise
    except InvalidTelemetryError as exc:
        raise InvalidTelemetryEventError(str(exc)) from exc


def load_events(
    export_path: Path,
    migration_path: Path,
    contract: TelemetryContract,
) -> tuple[list[dict[str, Any]], int]:
    connection = _load_export(export_path, migration_path)
    try:
        rows = connection.execute(
            f"SELECT {', '.join(EXPECTED_COLUMNS)} FROM round_telemetry ORDER BY id"
        ).fetchall()
    except sqlite3.Error as exc:
        raise InvalidTelemetryError(f"cannot read round_telemetry: {exc}") from exc
    finally:
        connection.close()

    events: list[dict[str, Any]] = []
    event_ids: set[str] = set()
    session_rounds: set[tuple[str, int]] = set()
    invalid_event_count = 0
    for row in rows:
        try:
            event = _validate_event(row, contract)
        except InvalidTelemetryEventError:
            invalid_event_count += 1
            continue
        if event["event_id"] in event_ids:
            raise InvalidTelemetryError("duplicate event_id in D1 export")
        session_round = (event["session_id"], event["round_number"])
        if session_round in session_rounds:
            raise InvalidTelemetryError("duplicate session_id/round_number in D1 export")
        event_ids.add(event["event_id"])
        session_rounds.add(session_round)
        events.append(event)
    return events, invalid_event_count


def _version_counts(counts: Mapping[str, int]) -> list[dict[str, Any]]:
    return [
        {"version": version, "event_count": counts[version]}
        for version in sorted(counts)
    ]


def _published_preference_version_counts(
    counts: Mapping[str, int],
) -> list[dict[str, Any]]:
    """Bound untrusted client labels and suppress one-off version fingerprints."""
    candidates = sorted(
        (
            (version, count)
            for version, count in counts.items()
            if count >= MIN_RATE_SUPPORT
        ),
        key=lambda item: (-item[1], item[0]),
    )
    total_count = sum(counts.values())
    all_candidates_publishable = (
        len(candidates) <= MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS
        and sum(count for _, count in candidates) == total_count
    )
    published_limit = (
        MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS
        if all_candidates_publishable
        else MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS - 1
    )
    published = candidates[:published_limit]
    omitted_count = total_count - sum(count for _, count in published)
    rows = [
        {"version": version, "event_count": count}
        for version, count in published
    ]
    if omitted_count:
        rows.append(
            {
                "version": PREFERENCE_VERSION_OTHER_BUCKET,
                "event_count": omitted_count,
            }
        )
    return sorted(rows, key=lambda row: row["version"])


def _preference_feature_id(*parts: object) -> str:
    """Use JSON arrays so catalog names cannot collide with key separators."""
    return json.dumps(list(parts), ensure_ascii=False, separators=(",", ":"))


def _preference_features(
    event: Mapping[str, Any],
    option_index: int,
) -> dict[str, float]:
    round_number = int(event["round_number"])
    round_type = str(event["round_type"])
    scores = [float(score) for score in event["paired_scores"]]
    centered_score = (scores[option_index] - sum(scores) / 3) / 10
    features = {
        _preference_feature_id("score"): centered_score,
        _preference_feature_id("round_score", round_number): centered_score,
        _preference_feature_id("position", option_index): 1.0,
    }

    offered_items = event["offered_sets"][option_index]
    pool = event["pool_before"]
    pool_items = [
        *[("hero", item) for item in pool["heroes"]],
        *[("skill", item) for item in pool["skills"]],
        *(
            [("hero", pool["hero_support"])]
            if isinstance(pool.get("hero_support"), str)
            else []
        ),
        *[("skill", item) for item in pool.get("skills_support", [])],
    ]
    for item in offered_items:
        features[_preference_feature_id("item", round_type, item)] = 1.0
        for pool_type, pool_item in pool_items:
            features[
                _preference_feature_id(
                    "pool_item",
                    pool_type,
                    pool_item,
                    round_type,
                    item,
                )
            ] = 1.0
    return features


def _feature_support(
    events: Iterable[Mapping[str, Any]],
) -> Counter[str]:
    support: Counter[str] = Counter()
    for event in events:
        for option_index in range(3):
            support.update(_preference_features(event, option_index).keys())
    return support


def _selected_features(
    events: list[Mapping[str, Any]],
) -> tuple[list[str], dict[str, int]]:
    support = _feature_support(events)
    eligible = sorted(
        (
            feature_id
            for feature_id, count in support.items()
            if count >= (
                MIN_RATE_SUPPORT * 3
                if json.loads(feature_id)[0] == "round_score"
                else MIN_FEATURE_SUPPORT
            )
        ),
        key=lambda feature_id: (-support[feature_id], feature_id),
    )
    selected = sorted(eligible[:MAX_PREFERENCE_FEATURES])
    return selected, {feature_id: support[feature_id] for feature_id in selected}


def _softmax(values: list[float]) -> list[float]:
    maximum = max(values)
    exponentials = [math.exp(max(-700, min(700, value - maximum))) for value in values]
    total = sum(exponentials)
    return [value / total for value in exponentials]


def _quantize_preference_probabilities(
    probabilities: list[float],
) -> list[float]:
    """Match the browser's largest-remainder one-decimal-percent display."""
    scaled = [probability * 1000 for probability in probabilities]
    units = [math.floor(value) for value in scaled]
    remainder = 1000 - sum(units)
    order = sorted(
        range(3),
        key=lambda index: (-(scaled[index] - units[index]), index),
    )
    for index in range(remainder):
        units[order[index % len(order)]] += 1
    remainder = 1000 - sum(units)
    if remainder:
        units[0] += remainder
    return [value / 1000 for value in units]


def _predict_preference(
    event: Mapping[str, Any],
    weights: Mapping[str, float],
) -> list[float]:
    utilities = []
    for option_index in range(3):
        utilities.append(
            sum(
                weights.get(feature_id, 0.0) * value
                for feature_id, value in _preference_features(
                    event, option_index
                ).items()
            )
        )
    return _softmax(utilities)


def _fit_preference_model(
    events: list[Mapping[str, Any]],
    selected_features: list[str],
) -> dict[str, float]:
    weights = {feature_id: 0.0 for feature_id in selected_features}
    selected = set(selected_features)
    prepared = [
        (
            [
                {
                    feature_id: value
                    for feature_id, value in _preference_features(
                        event, option_index
                    ).items()
                    if feature_id in selected
                }
                for option_index in range(3)
            ],
            int(event["chosen_index"]),
        )
        for event in events
    ]
    for iteration in range(PREFERENCE_ITERATIONS):
        gradient = {feature_id: 0.0 for feature_id in selected_features}
        for option_features, chosen_index in prepared:
            probabilities = _softmax(
                [
                    sum(weights[feature_id] * value for feature_id, value in features.items())
                    for features in option_features
                ]
            )
            for option_index, features in enumerate(option_features):
                residual = (1.0 if option_index == chosen_index else 0.0) - probabilities[
                    option_index
                ]
                for feature_id, value in features.items():
                    gradient[feature_id] += residual * value

        learning_rate = 0.25 / math.sqrt(1 + iteration / 100)
        event_count = max(1, len(prepared))
        for feature_id in selected_features:
            regularized_gradient = (
                gradient[feature_id] / event_count
                - PREFERENCE_L2 * weights[feature_id]
            )
            weights[feature_id] += learning_rate * regularized_gradient
    return {
        feature_id: round(weights[feature_id], 12)
        for feature_id in selected_features
    }


def _prediction_metrics(
    events: list[Mapping[str, Any]],
    probabilities: list[list[float]],
) -> dict[str, Any]:
    if not events:
        return {
            "event_count": 0,
            "accuracy": None,
            "log_loss": None,
            "brier": None,
            "calibration_error": None,
        }
    correct = 0
    log_loss = 0.0
    brier = 0.0
    calibration_bins: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for event, event_probabilities in zip(events, probabilities, strict=True):
        chosen_index = int(event["chosen_index"])
        top_index = min(
            range(3),
            key=lambda index: (-event_probabilities[index], index),
        )
        correct += int(top_index == chosen_index)
        log_loss -= math.log(max(event_probabilities[chosen_index], 1e-15))
        brier += sum(
            (
                probability
                - (1.0 if option_index == chosen_index else 0.0)
            )
            ** 2
            for option_index, probability in enumerate(event_probabilities)
        ) / 3
        confidence = event_probabilities[top_index]
        calibration_bins[min(9, int(confidence * 10))].append(
            (confidence, 1.0 if top_index == chosen_index else 0.0)
        )

    count = len(events)
    calibration_error = 0.0
    for values in calibration_bins.values():
        calibration_error += (
            len(values)
            / count
            * abs(
                sum(confidence for confidence, _ in values) / len(values)
                - sum(outcome for _, outcome in values) / len(values)
            )
        )
    return {
        "event_count": count,
        "accuracy": round(correct / count, 6),
        "log_loss": round(
            log_loss / count,
            PREFERENCE_QUALITY_DECIMAL_PLACES,
        ),
        "brier": round(brier / count, 6),
        "calibration_error": round(calibration_error, 6),
    }


def _preference_quality_gate_passes(
    log_loss: float,
    uniform_log_loss: float,
) -> bool:
    return (
        uniform_log_loss - log_loss
        >= MIN_HELD_OUT_LOG_LOSS_IMPROVEMENT
    )


def _session_is_holdout(session_id: str) -> bool:
    digest = hashlib.sha256(session_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % HOLDOUT_BUCKETS == 0


def _preference_corpus_version(events: list[Mapping[str, Any]]) -> str:
    payload = [
        {
            "event_id": event["event_id"],
            "round_number": event["round_number"],
            "pool_before": event["pool_before"],
            "offered_sets": event["offered_sets"],
            "paired_scores": event["paired_scores"],
            "chosen_index": event["chosen_index"],
        }
        for event in sorted(events, key=lambda event: str(event["event_id"]))
    ]
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _build_preference_model(
    events: list[Mapping[str, Any]],
) -> tuple[dict[str, Any], dict[str, list[float]]]:
    sessions = {str(event["session_id"]) for event in events}
    disagreements = sum(
        int(event["recommended_index"] != event["chosen_index"])
        for event in events
    )
    train_events = [
        event
        for event in events
        if not _session_is_holdout(str(event["session_id"]))
    ]
    holdout_events = [
        event
        for event in events
        if _session_is_holdout(str(event["session_id"]))
    ]
    evidence = {
        "event_count": len(events),
        "session_count": len(sessions),
        "recommendation_disagreement_count": disagreements,
        "minimum_event_count": MIN_MODEL_EVENTS,
        "minimum_session_count": MIN_MODEL_SESSIONS,
        "minimum_recommendation_disagreement_count": MIN_MODEL_DISAGREEMENTS,
        "holdout_event_count": len(holdout_events),
        "minimum_holdout_event_count": MIN_HOLDOUT_EVENTS,
    }
    base = {
        "model_type": PREFERENCE_MODEL_FAMILY,
        "feature_schema_version": PREFERENCE_FEATURE_SCHEMA_VERSION,
        "meaningful_probability_margin": MEANINGFUL_PREFERENCE_MARGIN,
        "l2": PREFERENCE_L2,
        "evidence": evidence,
    }
    sufficient = (
        len(events) >= MIN_MODEL_EVENTS
        and len(sessions) >= MIN_MODEL_SESSIONS
        and disagreements >= MIN_MODEL_DISAGREEMENTS
        and len(holdout_events) >= MIN_HOLDOUT_EVENTS
        and bool(train_events)
    )
    if not sufficient:
        return (
            {
                **base,
                "status": "insufficient_evidence",
                "version": None,
                "held_out": None,
                "weights": {},
                "support": {},
            },
            {},
        )

    train_features, _ = _selected_features(train_events)
    train_weights = _fit_preference_model(train_events, train_features)
    holdout_probabilities = [
        _predict_preference(event, train_weights) for event in holdout_events
    ]
    held_out = {
        **_prediction_metrics(holdout_events, holdout_probabilities),
        "train_event_count": len(train_events),
        "paired_accuracy": round(
            sum(
                int(event["recommended_index"] == event["chosen_index"])
                for event in holdout_events
            )
            / len(holdout_events),
            6,
        ),
        "uniform_log_loss": round(
            math.log(3),
            PREFERENCE_QUALITY_DECIMAL_PLACES,
        ),
    }
    if not _preference_quality_gate_passes(
        held_out["log_loss"],
        held_out["uniform_log_loss"],
    ):
        return (
            {
                **base,
                "status": "quality_gate_failed",
                "version": None,
                "held_out": held_out,
                "weights": {},
                "support": {},
            },
            {},
        )

    selected_features, support = _selected_features(events)
    weights = _fit_preference_model(events, selected_features)
    version = f"preference-v1:{_preference_corpus_version(events)}"
    predictions = {
        str(event["event_id"]): _quantize_preference_probabilities(
            _predict_preference(event, weights)
        )
        for event in events
    }
    return (
        {
            **base,
            "status": "ready",
            "version": version,
            "held_out": held_out,
            "weights": weights,
            "support": support,
        },
        predictions,
    )


def _score_margin_bucket(margin: float) -> str:
    if math.isclose(margin, 0.0, abs_tol=1e-9):
        return "tie"
    if margin <= 1:
        return "0_to_1"
    if margin <= 3:
        return "1_to_3"
    return "over_3"


def build_artifact(
    events: Iterable[Mapping[str, Any]],
    catalog_version: str,
    invalid_event_count: int = 0,
) -> dict[str, Any]:
    event_rows = list(events)
    preference_model, preference_predictions = _build_preference_model(event_rows)
    preference_ready = preference_model["status"] == "ready"
    round_rows = {
        number: {
            "round_number": number,
            "round_type": round_type,
            "event_count": 0,
            "recommendation_accepted_count": 0,
            "chosen_position_counts": [0, 0, 0],
            "recommended_position_counts": [0, 0, 0],
            "rate_suppressed": True,
            "preference_top_disagreement_count": 0 if preference_ready else None,
            "meaningful_preference_disagreement_count": 0
            if preference_ready
            else None,
            "player_preference_agreement_count": 0 if preference_ready else None,
            "average_meaningful_preference_disagreement_margin": None,
        }
        for number, round_type in ROUND_TYPES.items()
    }
    meaningful_disagreement_margin_totals: dict[int, float] = defaultdict(float)
    item_counts: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    opportunity_counts: Counter[str] = Counter()
    score_margin_counts = {
        key: {"event_count": 0, "recommendation_accepted_count": 0}
        for key in ("tie", "0_to_1", "1_to_3", "over_3")
    }
    event_count = 0
    accepted_count = 0
    sessions: set[str] = set()
    model_versions: Counter[str] = Counter()
    preference_versions: Counter[str] = Counter()

    for event in event_rows:
        event_count += 1
        sessions.add(str(event["session_id"]))
        model_versions[str(event["model_version"])] += 1
        preference_version = event["preference_model_version"]
        if isinstance(preference_version, str):
            preference_versions[preference_version] += 1

        row = round_rows[int(event["round_number"])]
        recommended_index = int(event["recommended_index"])
        chosen_index = int(event["chosen_index"])
        row["event_count"] += 1
        row["recommended_position_counts"][recommended_index] += 1
        row["chosen_position_counts"][chosen_index] += 1
        if recommended_index == chosen_index:
            row["recommendation_accepted_count"] += 1
            accepted_count += 1

        round_type = str(event["round_type"])
        opportunity_counts[round_type] += 1
        # Only the three sets offered in this round count as offers. Existing
        # pool/support items inform the preference model but are not offers.
        for offered_set in event["offered_sets"]:
            for item in offered_set:
                item_counts[(round_type, str(item))][0] += 1
        for item in event["offered_sets"][chosen_index]:
            item_counts[(round_type, str(item))][1] += 1

        paired_scores = [float(score) for score in event["paired_scores"]]
        margin = paired_scores[recommended_index] - max(
            score
            for index, score in enumerate(paired_scores)
            if index != recommended_index
        )
        margin_row = score_margin_counts[_score_margin_bucket(max(0.0, margin))]
        margin_row["event_count"] += 1
        if recommended_index == chosen_index:
            margin_row["recommendation_accepted_count"] += 1

        probabilities = preference_predictions.get(str(event["event_id"]))
        if probabilities is not None:
            top_index = min(
                range(3),
                key=lambda index: (-probabilities[index], index),
            )
            sorted_probabilities = sorted(probabilities, reverse=True)
            probability_margin = sorted_probabilities[0] - sorted_probabilities[1]
            row["preference_top_disagreement_count"] += int(
                top_index != recommended_index
            )
            row["meaningful_preference_disagreement_count"] += int(
                top_index != recommended_index
                and probability_margin >= MEANINGFUL_PREFERENCE_MARGIN
            )
            if (
                top_index != recommended_index
                and probability_margin >= MEANINGFUL_PREFERENCE_MARGIN
            ):
                meaningful_disagreement_margin_totals[int(event["round_number"])] += (
                    probability_margin
                )
            row["player_preference_agreement_count"] += int(
                top_index == chosen_index
            )

    for row in round_rows.values():
        row["rate_suppressed"] = row["event_count"] < MIN_RATE_SUPPORT
        meaningful_count = row["meaningful_preference_disagreement_count"]
        if (
            preference_ready
            and isinstance(meaningful_count, int)
            and meaningful_count >= MIN_RATE_SUPPORT
        ):
            row["average_meaningful_preference_disagreement_margin"] = round(
                meaningful_disagreement_margin_totals[row["round_number"]]
                / meaningful_count,
                6,
            )

    items = {"heroes": [], "skills": []}
    for (round_type, item), (offer_count, picked_count) in sorted(item_counts.items()):
        family = "heroes" if round_type == "hero" else "skills"
        items[family].append(
            {
                "name": item,
                "offer_count": offer_count,
                "opportunity_count": opportunity_counts[round_type],
                "picked_count": picked_count,
                "rate_suppressed": offer_count < MIN_RATE_SUPPORT,
            }
        )

    score_margins = []
    for key, label in (
        ("tie", "并列"),
        ("0_to_1", "0–1 分"),
        ("1_to_3", "1–3 分"),
        ("over_3", "超过 3 分"),
    ):
        counts = score_margin_counts[key]
        score_margins.append(
            {
                "key": key,
                "label": label,
                **counts,
                "rate_suppressed": counts["event_count"] < MIN_RATE_SUPPORT,
            }
        )

    artifact = {
        "schema": {
            "version": ARTIFACT_SCHEMA_VERSION,
            "source_event_schema_version": EVENT_SCHEMA_VERSION,
        },
        "catalog_version": catalog_version,
        "summary": {
            "event_count": event_count,
            "invalid_event_count": invalid_event_count,
            "session_count": len(sessions),
            "recommendation_accepted_count": accepted_count,
            "preference_event_count": sum(preference_versions.values()),
            "model_versions": _version_counts(model_versions),
            "preference_model_versions": _published_preference_version_counts(
                preference_versions
            ),
        },
        "rounds": list(round_rows.values()),
        "analytics": {
            "minimum_rate_support": MIN_RATE_SUPPORT,
            "items": items,
            "score_margins": score_margins,
        },
        "preference_model": preference_model,
    }
    validate_artifact(artifact)
    return artifact


def _preference_feature_parts(feature_id: Any) -> list[Any] | None:
    if not _is_short_string(feature_id, 512):
        return None
    try:
        parts = json.loads(feature_id)
    except json.JSONDecodeError:
        return None
    if not isinstance(parts, list) or not parts:
        return None
    if _preference_feature_id(*parts) != feature_id:
        return None
    kind = parts[0]
    if parts == ["score"]:
        return parts
    if (
        kind == "round_score"
        and len(parts) == 2
        and _is_int(parts[1])
        and parts[1] in ROUND_TYPES
    ):
        return parts
    if (
        kind == "position"
        and len(parts) == 2
        and _is_int(parts[1])
        and parts[1] in range(3)
    ):
        return parts
    if (
        kind == "item"
        and len(parts) == 3
        and parts[1] in {"hero", "skill"}
        and _is_short_string(parts[2], 64)
    ):
        return parts
    if (
        kind == "pool_item"
        and len(parts) == 5
        and parts[1] in {"hero", "skill"}
        and _is_short_string(parts[2], 64)
        and parts[3] in {"hero", "skill"}
        and _is_short_string(parts[4], 64)
    ):
        return parts
    return None


def _minimum_preference_feature_support(parts: list[Any]) -> int:
    return MIN_RATE_SUPPORT * 3 if parts[0] == "round_score" else MIN_FEATURE_SUPPORT


def validate_artifact(artifact: Mapping[str, Any]) -> None:
    """Fail closed if aggregation or preference-model wiring emits bad output."""
    if set(artifact) != {
        "schema",
        "catalog_version",
        "summary",
        "rounds",
        "analytics",
        "preference_model",
    }:
        raise InvalidTelemetryError("telemetry artifact has unexpected fields")
    if artifact["schema"] != {
        "version": ARTIFACT_SCHEMA_VERSION,
        "source_event_schema_version": EVENT_SCHEMA_VERSION,
    }:
        raise InvalidTelemetryError("telemetry artifact schema is invalid")
    if not _is_short_string(artifact["catalog_version"]):
        raise InvalidTelemetryError("telemetry artifact catalog_version is invalid")

    preference_model = artifact["preference_model"]
    preference_model_keys = {
        "model_type",
        "feature_schema_version",
        "meaningful_probability_margin",
        "l2",
        "evidence",
        "status",
        "version",
        "held_out",
        "weights",
        "support",
    }
    if (
        not isinstance(preference_model, dict)
        or set(preference_model) != preference_model_keys
        or preference_model["model_type"] != PREFERENCE_MODEL_FAMILY
        or preference_model["feature_schema_version"]
        != PREFERENCE_FEATURE_SCHEMA_VERSION
        or preference_model["meaningful_probability_margin"]
        != MEANINGFUL_PREFERENCE_MARGIN
        or preference_model["l2"] != PREFERENCE_L2
        or preference_model["status"]
        not in {"insufficient_evidence", "quality_gate_failed", "ready"}
    ):
        raise InvalidTelemetryError("telemetry preference_model contract is invalid")
    preference_ready = preference_model["status"] == "ready"

    summary = artifact["summary"]
    rounds = artifact["rounds"]
    if not isinstance(summary, dict) or not isinstance(rounds, list) or len(rounds) != 8:
        raise InvalidTelemetryError("telemetry artifact summary or rounds are invalid")
    if [row.get("round_number") for row in rounds if isinstance(row, dict)] != list(range(1, 9)):
        raise InvalidTelemetryError("telemetry artifact rounds are not ordered 1-8")

    total_events = 0
    for row in rounds:
        number = row["round_number"]
        if set(row) != {
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
        } or row["round_type"] != ROUND_TYPES[number]:
            raise InvalidTelemetryError(f"telemetry artifact round {number} is invalid")
        event_count = row["event_count"]
        chosen_counts = row["chosen_position_counts"]
        recommended_counts = row["recommended_position_counts"]
        if (
            not _is_int(event_count)
            or event_count < 0
            or not _is_int(row["recommendation_accepted_count"])
            or not 0 <= row["recommendation_accepted_count"] <= event_count
            or not isinstance(chosen_counts, list)
            or not isinstance(recommended_counts, list)
            or len(chosen_counts) != 3
            or len(recommended_counts) != 3
            or any(not _is_int(count) or count < 0 for count in chosen_counts + recommended_counts)
            or sum(chosen_counts) != event_count
            or sum(recommended_counts) != event_count
            or row["rate_suppressed"] != (event_count < MIN_RATE_SUPPORT)
        ):
            raise InvalidTelemetryError(f"telemetry artifact round {number} counts are invalid")
        preference_counts = (
            row["preference_top_disagreement_count"],
            row["meaningful_preference_disagreement_count"],
            row["player_preference_agreement_count"],
        )
        if preference_ready:
            if any(
                not _is_int(count) or not 0 <= count <= event_count
                for count in preference_counts
            ):
                raise InvalidTelemetryError(
                    f"telemetry artifact round {number} preference counts are invalid"
                )
            if (
                row["meaningful_preference_disagreement_count"]
                > row["preference_top_disagreement_count"]
            ):
                raise InvalidTelemetryError(
                    f"telemetry artifact round {number} preference counts are inconsistent"
                )
            meaningful_count = row[
                "meaningful_preference_disagreement_count"
            ]
            average_margin = row[
                "average_meaningful_preference_disagreement_margin"
            ]
            if meaningful_count >= MIN_RATE_SUPPORT:
                if (
                    isinstance(average_margin, bool)
                    or not isinstance(average_margin, (int, float))
                    or not MEANINGFUL_PREFERENCE_MARGIN
                    <= average_margin
                    <= 1
                ):
                    raise InvalidTelemetryError(
                        f"telemetry artifact round {number} disagreement margin is invalid"
                    )
            elif average_margin is not None:
                raise InvalidTelemetryError(
                    f"telemetry artifact round {number} low-support disagreement margin must be null"
                )
        elif any(count is not None for count in preference_counts):
            raise InvalidTelemetryError(
                f"telemetry artifact round {number} preference counts must be null"
            )
        elif row["average_meaningful_preference_disagreement_margin"] is not None:
            raise InvalidTelemetryError(
                f"telemetry artifact round {number} preference margin must be null"
            )
        total_events += event_count

    required_summary = {
        "event_count",
        "invalid_event_count",
        "session_count",
        "recommendation_accepted_count",
        "preference_event_count",
        "model_versions",
        "preference_model_versions",
    }
    if set(summary) != required_summary or summary["event_count"] != total_events:
        raise InvalidTelemetryError("telemetry artifact summary totals are invalid")
    if (
        not _is_int(summary["invalid_event_count"])
        or summary["invalid_event_count"] < 0
    ):
        raise InvalidTelemetryError(
            "telemetry artifact invalid_event_count is invalid"
        )
    for field in ("session_count", "preference_event_count"):
        if not _is_int(summary[field]) or not 0 <= summary[field] <= total_events:
            raise InvalidTelemetryError(f"telemetry artifact {field} is invalid")
    if (
        not _is_int(summary["recommendation_accepted_count"])
        or summary["recommendation_accepted_count"]
        != sum(row["recommendation_accepted_count"] for row in rounds)
    ):
        raise InvalidTelemetryError(
            "telemetry artifact recommendation_accepted_count is invalid"
        )
    for field, expected_total in (
        ("model_versions", total_events),
        ("preference_model_versions", summary["preference_event_count"]),
    ):
        versions = summary[field]
        if (
            not isinstance(versions, list)
            or versions != sorted(versions, key=lambda entry: entry.get("version", ""))
            or any(
                not isinstance(entry, dict)
                or set(entry) != {"version", "event_count"}
                or not _is_short_string(entry["version"])
                or not _is_int(entry["event_count"])
                or entry["event_count"] <= 0
                for entry in versions
            )
            or sum(entry["event_count"] for entry in versions) != expected_total
            or len({entry["version"] for entry in versions}) != len(versions)
        ):
            raise InvalidTelemetryError(f"telemetry artifact {field} is invalid")
        if field == "model_versions" and (
            len(versions) > MAX_MODEL_VERSIONS
            or any(
                not _MODEL_VERSION_RE.fullmatch(entry["version"])
                for entry in versions
            )
        ):
            raise InvalidTelemetryError(f"telemetry artifact {field} is invalid")
        if field == "preference_model_versions" and (
            len(versions) > MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS
            or any(
                entry["version"] != PREFERENCE_VERSION_OTHER_BUCKET
                and (
                    not _PREFERENCE_MODEL_VERSION_RE.fullmatch(entry["version"])
                    or entry["event_count"] < MIN_RATE_SUPPORT
                )
                for entry in versions
            )
        ):
            raise InvalidTelemetryError(f"telemetry artifact {field} is invalid")

    evidence = preference_model["evidence"]
    required_evidence = {
        "event_count",
        "session_count",
        "recommendation_disagreement_count",
        "minimum_event_count",
        "minimum_session_count",
        "minimum_recommendation_disagreement_count",
        "holdout_event_count",
        "minimum_holdout_event_count",
    }
    if (
        not isinstance(evidence, dict)
        or set(evidence) != required_evidence
        or any(not _is_int(value) or value < 0 for value in evidence.values())
        or evidence["event_count"] != total_events
        or evidence["session_count"] != summary["session_count"]
        or evidence["recommendation_disagreement_count"]
        != total_events - summary["recommendation_accepted_count"]
        or evidence["minimum_event_count"] != MIN_MODEL_EVENTS
        or evidence["minimum_session_count"] != MIN_MODEL_SESSIONS
        or evidence["minimum_recommendation_disagreement_count"]
        != MIN_MODEL_DISAGREEMENTS
        or evidence["minimum_holdout_event_count"] != MIN_HOLDOUT_EVENTS
        or evidence["holdout_event_count"] > total_events
    ):
        raise InvalidTelemetryError("telemetry preference evidence is invalid")
    evidence_sufficient = (
        evidence["event_count"] >= evidence["minimum_event_count"]
        and evidence["session_count"] >= evidence["minimum_session_count"]
        and evidence["recommendation_disagreement_count"]
        >= evidence["minimum_recommendation_disagreement_count"]
        and evidence["holdout_event_count"]
        >= evidence["minimum_holdout_event_count"]
    )

    weights = preference_model["weights"]
    support = preference_model["support"]
    held_out = preference_model["held_out"]
    if not isinstance(weights, dict) or not isinstance(support, dict):
        raise InvalidTelemetryError("telemetry preference coefficients are invalid")
    if preference_ready:
        if (
            not isinstance(preference_model["version"], str)
            or not _READY_PREFERENCE_MODEL_VERSION_RE.fullmatch(
                preference_model["version"]
            )
            or not weights
            or len(weights) > MAX_PREFERENCE_FEATURES
            or set(weights) != set(support)
            or any(
                _preference_feature_parts(feature_id) is None
                or isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                for feature_id, value in weights.items()
            )
            or any(
                (parts := _preference_feature_parts(feature_id)) is None
                or not _is_int(value)
                or value < _minimum_preference_feature_support(parts)
                for feature_id, value in support.items()
            )
        ):
            raise InvalidTelemetryError("telemetry ready preference model is invalid")
    elif preference_model["version"] is not None or weights or support:
        raise InvalidTelemetryError(
            "telemetry unavailable preference model must not publish coefficients"
        )

    if preference_model["status"] == "insufficient_evidence":
        if held_out is not None or (
            evidence_sufficient
            and evidence["holdout_event_count"] != evidence["event_count"]
        ):
            raise InvalidTelemetryError(
                "insufficient preference model status is inconsistent"
            )
    else:
        required_held_out = {
            "event_count",
            "accuracy",
            "log_loss",
            "brier",
            "calibration_error",
            "train_event_count",
            "paired_accuracy",
            "uniform_log_loss",
        }
        if (
            not isinstance(held_out, dict)
            or set(held_out) != required_held_out
            or held_out["event_count"] != evidence["holdout_event_count"]
            or not _is_int(held_out["train_event_count"])
            or held_out["train_event_count"] <= 0
            or held_out["train_event_count"] + held_out["event_count"] != total_events
            or any(
                isinstance(held_out[field], bool)
                or not isinstance(held_out[field], (int, float))
                or not math.isfinite(held_out[field])
                for field in (
                    "accuracy",
                    "log_loss",
                    "brier",
                    "calibration_error",
                    "paired_accuracy",
                    "uniform_log_loss",
                )
            )
            or any(
                not 0 <= held_out[field] <= 1
                for field in (
                    "accuracy",
                    "brier",
                    "calibration_error",
                    "paired_accuracy",
                )
            )
            or held_out["log_loss"] < 0
            or held_out["log_loss"]
            != round(
                held_out["log_loss"],
                PREFERENCE_QUALITY_DECIMAL_PLACES,
            )
            or held_out["uniform_log_loss"] < 0
            or held_out["uniform_log_loss"]
            != round(math.log(3), PREFERENCE_QUALITY_DECIMAL_PLACES)
            or not evidence_sufficient
        ):
            raise InvalidTelemetryError(
                "telemetry preference held-out metrics are invalid"
            )
        quality_passed = _preference_quality_gate_passes(
            held_out["log_loss"],
            held_out["uniform_log_loss"],
        )
        if preference_ready != quality_passed:
            raise InvalidTelemetryError(
                "telemetry preference model status does not match its quality gate"
            )

    analytics = artifact["analytics"]
    if (
        not isinstance(analytics, dict)
        or set(analytics)
        != {
            "minimum_rate_support",
            "items",
            "score_margins",
        }
        or analytics["minimum_rate_support"] != MIN_RATE_SUPPORT
    ):
        raise InvalidTelemetryError("telemetry analytics contract is invalid")

    items = analytics["items"]
    if not isinstance(items, dict) or set(items) != {"heroes", "skills"}:
        raise InvalidTelemetryError("telemetry item analytics are invalid")
    type_event_counts = {
        "heroes": sum(
            row["event_count"] for row in rounds if row["round_type"] == "hero"
        ),
        "skills": sum(
            row["event_count"] for row in rounds if row["round_type"] == "skill"
        ),
    }
    for family in ("heroes", "skills"):
        rows = items[family]
        if (
            not isinstance(rows, list)
            or rows != sorted(rows, key=lambda row: row.get("name", ""))
            or len({row.get("name") for row in rows if isinstance(row, dict)})
            != len(rows)
        ):
            raise InvalidTelemetryError(f"telemetry {family} analytics are invalid")
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
                or not _is_int(row["offer_count"])
                or row["offer_count"] <= 0
                or not _is_int(row["opportunity_count"])
                or row["opportunity_count"] != type_event_counts[family]
                or row["offer_count"] > row["opportunity_count"]
                or not _is_int(row["picked_count"])
                or not 0 <= row["picked_count"] <= row["offer_count"]
                or row["rate_suppressed"]
                != (row["offer_count"] < MIN_RATE_SUPPORT)
            ):
                raise InvalidTelemetryError(
                    f"telemetry {family} item row is invalid"
                )

    margin_rows = analytics["score_margins"]
    margin_keys = ["tie", "0_to_1", "1_to_3", "over_3"]
    if (
        not isinstance(margin_rows, list)
        or [row.get("key") for row in margin_rows if isinstance(row, dict)]
        != margin_keys
        or sum(row["event_count"] for row in margin_rows) != total_events
        or sum(row["recommendation_accepted_count"] for row in margin_rows)
        != summary["recommendation_accepted_count"]
    ):
        raise InvalidTelemetryError("telemetry score-margin analytics are invalid")
    for row in margin_rows:
        if (
            set(row)
            != {
                "key",
                "label",
                "event_count",
                "recommendation_accepted_count",
                "rate_suppressed",
            }
            or not _is_short_string(row["label"])
            or not _is_int(row["event_count"])
            or row["event_count"] < 0
            or not _is_int(row["recommendation_accepted_count"])
            or not 0
            <= row["recommendation_accepted_count"]
            <= row["event_count"]
            or row["rate_suppressed"]
            != (row["event_count"] < MIN_RATE_SUPPORT)
        ):
            raise InvalidTelemetryError("telemetry score-margin row is invalid")

def write_artifact(artifact: Mapping[str, Any], output_path: Path) -> None:
    """Atomically write canonical JSON after every validation has passed."""
    content = json.dumps(artifact, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_name = handle.name
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, output_path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def build(
    export_path: Path,
    database_path: Path,
    recommendation_path: Path,
    output_path: Path,
    migration_path: Path | None = None,
    historical_recommendation_paths: Iterable[Path] = (),
) -> dict[str, Any]:
    if migration_path is None:
        migration_path = (
            Path(__file__).resolve().parent.parent
            / "web/migrations/0001_round_telemetry.sql"
        )
    contract = load_catalog(
        database_path,
        [recommendation_path, *historical_recommendation_paths],
    )
    events, invalid_event_count = load_events(
        export_path,
        migration_path,
        contract,
    )
    artifact = build_artifact(
        events,
        contract.catalog_version,
        invalid_event_count,
    )
    write_artifact(artifact, output_path)
    return artifact


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Build deterministic public aggregates from a D1 telemetry SQL export."
    )
    parser.add_argument("export", type=Path, help="round_telemetry SQL export")
    parser.add_argument(
        "--migration",
        type=Path,
        default=root / "web/migrations/0001_round_telemetry.sql",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=root / "web/public/game-data/database.json",
    )
    parser.add_argument(
        "--recommendation-data",
        type=Path,
        default=root / "web/src/recommendation_data.json",
    )
    parser.add_argument(
        "--recommendation-archive",
        type=Path,
        default=root / "data/recommendation_models",
        help="directory of retained immutable recommendation artifacts",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=root / "web/public/game-data/telemetry_data.json",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    historical_recommendation_paths = (
        sorted(args.recommendation_archive.glob("*.json"))
        if args.recommendation_archive.is_dir()
        else []
    )
    try:
        artifact = build(
            args.export,
            args.database,
            args.recommendation_data,
            args.output,
            args.migration,
            historical_recommendation_paths,
        )
    except InvalidTelemetryError as exc:
        print(f"Telemetry build failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"Wrote {args.output} from {artifact['summary']['event_count']} validated "
        f"events ({artifact['summary']['invalid_event_count']} invalid events skipped)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
