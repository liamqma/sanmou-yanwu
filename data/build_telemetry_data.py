#!/usr/bin/env python3
"""Build the deterministic public aggregate from a D1 telemetry export.

The input is the SQL file produced by ``wrangler d1 export --table
round_telemetry``.  It is loaded into an in-memory SQLite database, validated
against the schema-v1 browser contract and current game catalog, and reduced to
counts that are safe to publish.  Raw events are never written by this script.

Phase 2 deliberately publishes no player-preference model.  The explicit
``preference_model: null`` field is the stable hand-off point for Phase 3.
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
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping


ARTIFACT_SCHEMA_VERSION = 1
EVENT_SCHEMA_VERSION = 1
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


class InvalidTelemetryError(ValueError):
    """Raised when an export cannot safely produce a public artifact."""


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


def load_catalog(database_path: Path, recommendation_path: Path) -> tuple[str, set[str], set[str]]:
    """Load catalog names and verify recommendation data uses the same hash."""
    database = _load_json_object(database_path, "game database")
    heroes = database.get("heroes")
    skills = database.get("skills")
    if not isinstance(heroes, dict) or not isinstance(skills, dict):
        raise InvalidTelemetryError("game database must contain heroes and skills objects")

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

    recommendation = _load_json_object(recommendation_path, "recommendation artifact")
    recommendation_catalog = recommendation.get("catalog")
    recommendation_version = (
        recommendation_catalog.get("catalog_version")
        if isinstance(recommendation_catalog, dict)
        else None
    )
    if recommendation_version != catalog_version:
        raise InvalidTelemetryError(
            "catalog mismatch between database.json and recommendation_data.json"
        )
    return catalog_version, set(heroes), set(skills)


def _load_export(export_path: Path) -> sqlite3.Connection:
    try:
        sql = export_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise InvalidTelemetryError(f"cannot read D1 export {export_path}: {exc}") from exc
    if not sql.strip():
        raise InvalidTelemetryError("D1 export is empty")

    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript(sql)
    except sqlite3.Error as exc:
        connection.close()
        raise InvalidTelemetryError(f"D1 export is not valid SQLite SQL: {exc}") from exc

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

    columns = tuple(
        row["name"] for row in connection.execute("PRAGMA table_info(round_telemetry)")
    )
    if columns != EXPECTED_COLUMNS:
        connection.close()
        raise InvalidTelemetryError(
            f"round_telemetry schema mismatch: expected {EXPECTED_COLUMNS}, got {columns}"
        )
    return connection


def _validate_uuid(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _UUID_RE.fullmatch(value):
        raise InvalidTelemetryError(f"{field} must be a UUID")
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise InvalidTelemetryError(f"{field} must be a UUID") from exc
    return value


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


def _validate_event(
    row: sqlite3.Row,
    catalog_version: str,
    hero_names: set[str],
    skill_names: set[str],
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
        raise InvalidTelemetryError("unsupported telemetry schema_version")
    if not _is_short_string(row["model_version"]):
        raise InvalidTelemetryError("model_version must be present")
    if row["catalog_version"] != catalog_version:
        raise InvalidTelemetryError(
            f"catalog mismatch in event {event_id}: expected {catalog_version}"
        )

    pool = _load_json_field(row["pool_before_json"], "pool_before_json")
    if not isinstance(pool, dict) or not {"heroes", "skills"}.issubset(pool):
        raise InvalidTelemetryError("pool_before_json must contain heroes and skills")
    allowed_pool_keys = {"heroes", "skills", "hero_support", "skills_support"}
    if set(pool) - allowed_pool_keys:
        raise InvalidTelemetryError("pool_before_json has unexpected fields")
    _validate_item_list(pool["heroes"], "pool heroes", 20, hero_names)
    _validate_item_list(pool["skills"], "pool skills", 32, skill_names)
    if "hero_support" in pool:
        if not _is_short_string(pool["hero_support"], 64) or pool["hero_support"] not in hero_names:
            raise InvalidTelemetryError("pool hero_support is unknown or invalid")
    if "skills_support" in pool:
        support = _validate_item_list(
            pool["skills_support"], "pool skills_support", 2, skill_names
        )
        if not support:
            raise InvalidTelemetryError("pool skills_support cannot be empty")

    offered_sets = _load_json_field(row["offered_sets_json"], "offered_sets_json")
    items_per_set = 2 if round_number == 7 else 3
    known_offers = hero_names if round_type == "hero" else skill_names
    if not isinstance(offered_sets, list) or len(offered_sets) != 3:
        raise InvalidTelemetryError("offered_sets_json must contain three sets")
    for index, offered_set in enumerate(offered_sets):
        validated = _validate_item_list(
            offered_set, f"offered set {index}", items_per_set, known_offers
        )
        if len(validated) != items_per_set:
            raise InvalidTelemetryError(
                f"offered set {index} must contain {items_per_set} items"
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
    recommended_score = paired_scores[recommended_index]
    if any(score > recommended_score + 1e-9 for score in paired_scores):
        raise InvalidTelemetryError("recommended_index must identify a highest paired score")

    preference_version = row["preference_model_version"]
    preference_raw = row["preference_probs_json"]
    if preference_version is None and preference_raw is None:
        preference_probabilities = None
    elif _is_short_string(preference_version) and isinstance(preference_raw, str):
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
        "model_version": row["model_version"],
        "recommended_index": recommended_index,
        "chosen_index": chosen_index,
        "preference_model_version": preference_version,
    }


def load_events(
    export_path: Path,
    catalog_version: str,
    hero_names: set[str],
    skill_names: set[str],
) -> list[dict[str, Any]]:
    connection = _load_export(export_path)
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
    for row in rows:
        event = _validate_event(row, catalog_version, hero_names, skill_names)
        if event["event_id"] in event_ids:
            raise InvalidTelemetryError("duplicate event_id in D1 export")
        session_round = (event["session_id"], event["round_number"])
        if session_round in session_rounds:
            raise InvalidTelemetryError("duplicate session_id/round_number in D1 export")
        event_ids.add(event["event_id"])
        session_rounds.add(session_round)
        events.append(event)
    return events


def _version_counts(counts: Mapping[str, int]) -> list[dict[str, Any]]:
    return [
        {"version": version, "event_count": counts[version]}
        for version in sorted(counts)
    ]


def build_artifact(events: Iterable[Mapping[str, Any]], catalog_version: str) -> dict[str, Any]:
    round_rows = {
        number: {
            "round_number": number,
            "round_type": round_type,
            "event_count": 0,
            "recommendation_accepted_count": 0,
            "chosen_position_counts": [0, 0, 0],
            "recommended_position_counts": [0, 0, 0],
        }
        for number, round_type in ROUND_TYPES.items()
    }
    event_count = 0
    sessions: set[str] = set()
    model_versions: Counter[str] = Counter()
    preference_versions: Counter[str] = Counter()

    for event in events:
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

    artifact = {
        "schema": {
            "version": ARTIFACT_SCHEMA_VERSION,
            "source_event_schema_version": EVENT_SCHEMA_VERSION,
        },
        "catalog_version": catalog_version,
        "summary": {
            "event_count": event_count,
            "session_count": len(sessions),
            "preference_event_count": sum(preference_versions.values()),
            "model_versions": _version_counts(model_versions),
            "preference_model_versions": _version_counts(preference_versions),
        },
        "rounds": list(round_rows.values()),
        "preference_model": None,
    }
    validate_artifact(artifact)
    return artifact


def validate_artifact(artifact: Mapping[str, Any]) -> None:
    """Fail closed if aggregation or future model wiring emits bad output."""
    if set(artifact) != {
        "schema",
        "catalog_version",
        "summary",
        "rounds",
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
    if artifact["preference_model"] is not None:
        raise InvalidTelemetryError("Phase 2 preference_model must be null")

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
        ):
            raise InvalidTelemetryError(f"telemetry artifact round {number} counts are invalid")
        total_events += event_count

    required_summary = {
        "event_count",
        "session_count",
        "preference_event_count",
        "model_versions",
        "preference_model_versions",
    }
    if set(summary) != required_summary or summary["event_count"] != total_events:
        raise InvalidTelemetryError("telemetry artifact summary totals are invalid")
    for field in ("session_count", "preference_event_count"):
        if not _is_int(summary[field]) or not 0 <= summary[field] <= total_events:
            raise InvalidTelemetryError(f"telemetry artifact {field} is invalid")
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
        ):
            raise InvalidTelemetryError(f"telemetry artifact {field} is invalid")


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
) -> dict[str, Any]:
    catalog_version, hero_names, skill_names = load_catalog(
        database_path, recommendation_path
    )
    events = load_events(export_path, catalog_version, hero_names, skill_names)
    artifact = build_artifact(events, catalog_version)
    write_artifact(artifact, output_path)
    return artifact


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Build deterministic public aggregates from a D1 telemetry SQL export."
    )
    parser.add_argument("export", type=Path, help="round_telemetry SQL export")
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
        "--output",
        type=Path,
        default=root / "web/public/game-data/telemetry_data.json",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        artifact = build(
            args.export,
            args.database,
            args.recommendation_data,
            args.output,
        )
    except InvalidTelemetryError as exc:
        print(f"Telemetry build failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"Wrote {args.output} from {artifact['summary']['event_count']} validated events"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
