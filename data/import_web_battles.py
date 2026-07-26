#!/usr/bin/env python3
"""Import a bounded D1 web-battle export into the offline training corpus.

The importer is deliberately the only bridge from the write-only D1 table to
committed training data. It validates the exported table and every row again,
processes rows in ascending AUTOINCREMENT ID order, enforces the global
two-observation semantic duplicate cap, and writes validated battle files with
their exact contributor and capture metadata.

Raw exports, transport submission IDs, and D1 row IDs never enter an accepted
battle file. Exact uploader identity, normalized upload time, and season are
retained with the teams and winner; only uploader identity and battle semantics
participate in the versioned SHA-256 duplicate fingerprint. The same checkpoint
drives a deterministic static leaderboard; the site never reads D1 at runtime.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from build_recommendation_data import (
    DUPLICATE_FINGERPRINT_ALGORITHM,
    DUPLICATE_FINGERPRINT_VERSION,
    MAX_DUPLICATE_FINGERPRINT_COUNT,
    Battle,
    InvalidBattleError,
    build as build_recommendation,
    duplicate_fingerprint,
    load_battles,
    load_catalog,
    manual_fingerprint_counts,
    validate_battle,
)


STATE_SCHEMA_VERSION = 2
PUBLIC_SCHEMA_VERSION = 1
MAX_BATCH_ROWS = 500
MAX_EXPORT_BYTES = 12 * 1024 * 1024
MAX_BATTLE_JSON_BYTES = 16 * 1024
MAX_UPLOADER_NAME_CODE_POINTS = 80

TABLE_NAME = "web_battle_submissions"
EXPECTED_COLUMNS = (
    "id",
    "submission_id",
    "uploader_name",
    "received_at",
    "catalog_version",
    "canonical_hash",
    "battle_json",
)
_EXPECTED_COLUMN_CONTRACT = (
    ("id", "INTEGER", 0, None, 1),
    ("submission_id", "TEXT", 1, None, 0),
    ("uploader_name", "TEXT", 0, None, 0),
    ("received_at", "TEXT", 1, "CURRENT_TIMESTAMP", 0),
    ("catalog_version", "TEXT", 1, None, 0),
    ("canonical_hash", "TEXT", 1, None, 0),
    ("battle_json", "TEXT", 1, None, 0),
)

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}",
    re.IGNORECASE,
)
_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_CATALOG_VERSION_RE = re.compile(r"[0-9a-f]{12}")
_TIMESTAMP_RE = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]"
    r"[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?"
)
_FORBIDDEN_UPLOADER_CATEGORIES = {"Cc", "Cf", "Cs", "Zl", "Zp"}
_ZERO_WIDTH_JOINER = "\u200d"


class InvalidWebBattleImport(ValueError):
    """Raised when an import cannot safely mutate the repository."""


class InvalidSubmissionRow(ValueError):
    """Raised when one D1 row must be rejected while advancing the cursor."""


def _reject_constant(value: str) -> None:
    raise InvalidWebBattleImport(f"non-finite JSON constant {value!r} is invalid")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise InvalidWebBattleImport(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def _load_json_text(text: str, description: str) -> Any:
    try:
        return json.loads(
            text,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (json.JSONDecodeError, InvalidWebBattleImport) as exc:
        raise InvalidWebBattleImport(f"{description} contains invalid JSON: {exc}") from exc


def _load_json_object(path: Path, description: str) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise InvalidWebBattleImport(f"cannot read {description} {path}: {exc}") from exc
    value = _load_json_text(text, description)
    if not isinstance(value, dict):
        raise InvalidWebBattleImport(f"{description} must be a JSON object")
    return value


def _json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "wb",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_name = handle.name
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_fingerprint_counts(value: Any, field: str) -> dict[str, int]:
    if not isinstance(value, dict):
        raise InvalidWebBattleImport(f"{field} must be an object")
    result: dict[str, int] = {}
    for fingerprint, count in value.items():
        if (
            not isinstance(fingerprint, str)
            or not _SHA256_RE.fullmatch(fingerprint)
            or not _is_int(count)
            or not 1 <= count <= MAX_DUPLICATE_FINGERPRINT_COUNT
        ):
            raise InvalidWebBattleImport(f"{field} contains an invalid count")
        result[fingerprint] = count
    return result


def _validate_uploader_name(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise InvalidSubmissionRow("uploader_name must be null or a string")
    if len(value) > MAX_UPLOADER_NAME_CODE_POINTS:
        raise InvalidSubmissionRow("uploader_name is too long")
    for character in value:
        category = unicodedata.category(character)
        if (
            category in _FORBIDDEN_UPLOADER_CATEGORIES
            and character != _ZERO_WIDTH_JOINER
        ):
            raise InvalidSubmissionRow(
                "uploader_name contains an invisible control character"
            )
    return value


def _is_named_contributor(value: str | None) -> bool:
    if value is None:
        return False
    visible = value.replace(_ZERO_WIDTH_JOINER, "")
    return bool(visible.strip())


def _normalize_uploaded_at(value: Any) -> str:
    if (
        not isinstance(value, str)
        or len(value) > 64
        or not _TIMESTAMP_RE.fullmatch(value)
    ):
        raise InvalidSubmissionRow("received_at must be a timestamp string")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise InvalidSubmissionRow("received_at must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    timestamp = parsed.strftime("%Y-%m-%dT%H:%M:%S")
    if parsed.microsecond:
        timestamp += f".{parsed.microsecond:06d}".rstrip("0")
    return timestamp + "Z"


def fresh_state(manual_counts: Mapping[str, int]) -> dict[str, Any]:
    """Return a new aggregate-only checkpoint for an existing manual corpus."""
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "cursor": {
            "last_processed_id": 0,
            "updated_date": None,
        },
        "summary": {
            "processed_reports": 0,
            "accepted_reports": 0,
            "rejected_reports": 0,
        },
        "contributors": {},
        "fingerprints": {
            "version": DUPLICATE_FINGERPRINT_VERSION,
            "algorithm": DUPLICATE_FINGERPRINT_ALGORITHM,
            "manual": dict(sorted(manual_counts.items())),
            "web": {},
        },
    }


def validate_state(state: Mapping[str, Any]) -> None:
    expected_top_level = {
        "schema_version",
        "cursor",
        "summary",
        "contributors",
        "fingerprints",
    }
    if set(state) != expected_top_level or state.get("schema_version") != STATE_SCHEMA_VERSION:
        raise InvalidWebBattleImport("web-upload checkpoint schema is invalid")

    cursor = state.get("cursor")
    if not isinstance(cursor, dict) or set(cursor) != {
        "last_processed_id",
        "updated_date",
    }:
        raise InvalidWebBattleImport("web-upload cursor is invalid")
    last_processed_id = cursor["last_processed_id"]
    if not _is_int(last_processed_id) or last_processed_id < 0:
        raise InvalidWebBattleImport("web-upload cursor ID is invalid")
    updated_date = cursor["updated_date"]
    if updated_date is not None:
        if (
            not isinstance(updated_date, str)
            or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", updated_date)
        ):
            raise InvalidWebBattleImport("web-upload updated date is invalid")
        try:
            datetime.fromisoformat(updated_date)
        except ValueError as exc:
            raise InvalidWebBattleImport("web-upload updated date is invalid") from exc

    summary = state.get("summary")
    summary_fields = {
        "processed_reports",
        "accepted_reports",
        "rejected_reports",
    }
    if not isinstance(summary, dict) or set(summary) != summary_fields:
        raise InvalidWebBattleImport("web-upload summary is invalid")
    if any(not _is_int(summary[field]) or summary[field] < 0 for field in summary_fields):
        raise InvalidWebBattleImport("web-upload summary counts are invalid")
    if (
        summary["processed_reports"]
        != summary["accepted_reports"] + summary["rejected_reports"]
    ):
        raise InvalidWebBattleImport("web-upload summary counts are inconsistent")

    fingerprints = state.get("fingerprints")
    if (
        not isinstance(fingerprints, dict)
        or set(fingerprints) != {
            "version",
            "algorithm",
            "manual",
            "web",
        }
        or fingerprints.get("version") != DUPLICATE_FINGERPRINT_VERSION
        or fingerprints.get("algorithm") != DUPLICATE_FINGERPRINT_ALGORITHM
    ):
        raise InvalidWebBattleImport("web-upload fingerprint contract is invalid")
    _validate_fingerprint_counts(
        fingerprints["manual"],
        "manual fingerprint counts",
    )
    web_counts = _validate_fingerprint_counts(
        fingerprints["web"],
        "web fingerprint counts",
    )
    if sum(web_counts.values()) != summary["accepted_reports"]:
        raise InvalidWebBattleImport(
            "accepted report count does not match web fingerprint counts"
        )

    contributors = state.get("contributors")
    if not isinstance(contributors, dict):
        raise InvalidWebBattleImport("web-upload contributors must be an object")
    contributor_total = 0
    for name, count in contributors.items():
        try:
            validated_name = _validate_uploader_name(name)
        except InvalidSubmissionRow as exc:
            raise InvalidWebBattleImport("checkpoint contributor name is invalid") from exc
        if (
            validated_name is None
            or not _is_named_contributor(validated_name)
            or not _is_int(count)
            or count <= 0
        ):
            raise InvalidWebBattleImport("checkpoint contributor count is invalid")
        contributor_total += count
    if contributor_total > summary["accepted_reports"]:
        raise InvalidWebBattleImport("checkpoint contributor counts exceed accepted reports")

def build_public_artifact(state: Mapping[str, Any]) -> dict[str, Any]:
    """Render the deterministic static leaderboard from aggregate state."""
    validate_state(state)
    contributors = [
        {
            "name": name,
            "accepted_reports": count,
        }
        for name, count in state["contributors"].items()
    ]
    contributors.sort(key=lambda row: (-row["accepted_reports"], row["name"]))
    summary = state["summary"]
    return {
        "schema_version": PUBLIC_SCHEMA_VERSION,
        "updated_through_id": state["cursor"]["last_processed_id"],
        "updated_date": state["cursor"]["updated_date"],
        "summary": {
            "processed_reports": summary["processed_reports"],
            "accepted_reports": summary["accepted_reports"],
            "rejected_reports": summary["rejected_reports"],
        },
        "contributors": contributors,
    }


def _normalized_sql(value: str) -> str:
    return " ".join(value.rstrip(";").split())


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _load_export_connection(export_path: Path) -> sqlite3.Connection:
    try:
        size = export_path.stat().st_size
    except OSError as exc:
        raise InvalidWebBattleImport(f"cannot inspect D1 export {export_path}: {exc}") from exc
    if size <= 0:
        raise InvalidWebBattleImport("D1 web-battle export is empty")
    if size > MAX_EXPORT_BYTES:
        raise InvalidWebBattleImport("D1 web-battle export is unexpectedly large")
    try:
        sql = export_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise InvalidWebBattleImport(f"cannot read D1 export {export_path}: {exc}") from exc

    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript(sql)
    except sqlite3.Error as exc:
        connection.close()
        raise InvalidWebBattleImport(f"D1 web-battle export is invalid SQLite SQL: {exc}") from exc

    objects = connection.execute(
        "SELECT type, name FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    ).fetchall()
    tables = [row["name"] for row in objects if row["type"] == "table"]
    unexpected = [
        (row["type"], row["name"])
        for row in objects
        if row["type"] not in {"table", "index"}
    ]
    if tables != [TABLE_NAME] or unexpected:
        connection.close()
        raise InvalidWebBattleImport(
            f"D1 export must contain only the {TABLE_NAME} table"
        )

    table = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        (TABLE_NAME,),
    ).fetchone()
    if table is None or not isinstance(table["sql"], str):
        connection.close()
        raise InvalidWebBattleImport("D1 web-battle table definition is missing")
    normalized_table_sql = _normalized_sql(table["sql"]).upper()
    if "INTEGER PRIMARY KEY AUTOINCREMENT" not in normalized_table_sql:
        connection.close()
        raise InvalidWebBattleImport("D1 web-battle IDs must use AUTOINCREMENT")

    columns = tuple(
        (
            row["name"],
            str(row["type"]).upper(),
            row["notnull"],
            row["dflt_value"],
            row["pk"],
        )
        for row in connection.execute(f"PRAGMA table_info({TABLE_NAME})")
    )
    if columns != _EXPECTED_COLUMN_CONTRACT:
        connection.close()
        raise InvalidWebBattleImport("D1 web-battle table schema is invalid")

    unique_submission_id = False
    for index in connection.execute(f"PRAGMA index_list({TABLE_NAME})"):
        if not index["unique"]:
            continue
        columns_in_index = tuple(
            row["name"]
            for row in connection.execute(
                f"PRAGMA index_info({_quote_identifier(index['name'])})"
            )
        )
        if columns_in_index == ("submission_id",):
            unique_submission_id = True
    if not unique_submission_id:
        connection.close()
        raise InvalidWebBattleImport("submission_id must have a unique constraint")
    return connection


def load_submission_batch(
    export_path: Path,
    *,
    after_id: int,
) -> list[sqlite3.Row]:
    """Validate the export and load at most one bounded ascending batch."""
    if not _is_int(after_id) or after_id < 0:
        raise InvalidWebBattleImport("after_id must be a non-negative integer")
    connection = _load_export_connection(export_path)
    try:
        rows = connection.execute(
            f'SELECT {", ".join(EXPECTED_COLUMNS)} FROM "{TABLE_NAME}" '
            'WHERE "id" > ? ORDER BY "id" LIMIT ?',
            (after_id, MAX_BATCH_ROWS),
        ).fetchall()
    except sqlite3.Error as exc:
        raise InvalidWebBattleImport(f"cannot read D1 web-battle rows: {exc}") from exc
    finally:
        connection.close()

    previous_id = after_id
    for row in rows:
        row_id = row["id"]
        if not _is_int(row_id) or row_id <= previous_id:
            raise InvalidWebBattleImport(
                "D1 web-battle IDs must be strictly increasing positive integers"
            )
        previous_id = row_id
    return rows


@dataclass(frozen=True)
class SubmissionCatalog:
    catalog_version: str
    hero_default_skills: Mapping[str, str]
    hero_seasons: Mapping[str, int | None]
    skill_seasons: Mapping[str, int | None]
    max_season: int


def load_submission_catalog(database_path: Path) -> SubmissionCatalog:
    database = _load_json_object(database_path, "game database")
    heroes = database.get("heroes")
    skills = database.get("skills")
    if not isinstance(heroes, dict) or not isinstance(skills, dict):
        raise InvalidWebBattleImport(
            "game database must contain hero and skill objects"
        )
    hero_default_skills: dict[str, str] = {}
    hero_seasons: dict[str, int | None] = {}
    for name, metadata in heroes.items():
        if (
            not isinstance(name, str)
            or not isinstance(metadata, dict)
            or not isinstance(metadata.get("skill"), str)
            or not metadata["skill"]
        ):
            raise InvalidWebBattleImport("game database hero catalog is invalid")
        season = metadata.get("season")
        if season is not None and (
            not _is_int(season) or season < 1
        ):
            raise InvalidWebBattleImport("game database hero season is invalid")
        hero_default_skills[name] = metadata["skill"]
        hero_seasons[name] = season
    skill_seasons: dict[str, int | None] = {}
    for name, metadata in skills.items():
        if not isinstance(name, str) or not isinstance(metadata, dict):
            raise InvalidWebBattleImport("game database skill catalog is invalid")
        season = metadata.get("season")
        if season is not None and (
            not _is_int(season) or season < 1
        ):
            raise InvalidWebBattleImport("game database skill season is invalid")
        skill_seasons[name] = season
    builder_catalog = load_catalog(str(database_path))
    catalog_version = builder_catalog.get("catalog_version")
    if (
        not isinstance(catalog_version, str)
        or not _CATALOG_VERSION_RE.fullmatch(catalog_version)
    ):
        raise InvalidWebBattleImport("game database catalog version is invalid")
    return SubmissionCatalog(
        catalog_version=catalog_version,
        hero_default_skills=hero_default_skills,
        hero_seasons=hero_seasons,
        skill_seasons=skill_seasons,
        max_season=max(
            [
                1,
                *(
                    season
                    for season in [*hero_seasons.values(), *skill_seasons.values()]
                    if season is not None
                ),
            ]
        ),
    )


def _validate_web_team(
    value: Any,
    field: str,
    catalog: SubmissionCatalog,
    season: int,
) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) != 3:
        raise InvalidSubmissionRow(f"{field} must contain exactly three heroes")

    heroes: list[dict[str, Any]] = []
    hero_names: list[str] = []
    team_skills: list[str] = []
    for index, hero in enumerate(value):
        hero_field = f"{field}[{index}]"
        if not isinstance(hero, dict) or set(hero) != {"name", "skills"}:
            raise InvalidSubmissionRow(
                f"{hero_field} must contain only name and skills"
            )
        name = hero.get("name")
        skills = hero.get("skills")
        if (
            not isinstance(name, str)
            or name not in catalog.hero_default_skills
        ):
            raise InvalidSubmissionRow(f"{hero_field}.name is outside the catalog")
        hero_season = catalog.hero_seasons[name]
        if hero_season is not None and hero_season > season:
            raise InvalidSubmissionRow(
                f"{hero_field}.name is unavailable in season {season}"
            )
        if (
            not isinstance(skills, list)
            or len(skills) != 3
            or any(
                not isinstance(skill, str) or skill not in catalog.skill_seasons
                for skill in skills
            )
        ):
            raise InvalidSubmissionRow(
                f"{hero_field}.skills must contain three catalog skills"
            )
        if any(
            catalog.skill_seasons[skill] is not None
            and catalog.skill_seasons[skill] > season
            for skill in skills
        ):
            raise InvalidSubmissionRow(
                f"{hero_field}.skills contains a skill unavailable in season {season}"
            )
        if skills[0] != catalog.hero_default_skills[name]:
            raise InvalidSubmissionRow(
                f"{hero_field}.skills[0] is not the hero signature skill"
            )
        hero_names.append(name)
        team_skills.extend(skills)
        heroes.append({"name": name, "skills": list(skills)})

    if len(set(hero_names)) != len(hero_names):
        raise InvalidSubmissionRow(f"{field} contains duplicate heroes")
    if len(set(team_skills)) != len(team_skills):
        raise InvalidSubmissionRow(f"{field} contains duplicate skills")
    return heroes


def _validate_submission_season(
    value: Any,
    catalog: SubmissionCatalog,
) -> int:
    if not _is_int(value) or not 1 <= value <= catalog.max_season:
        raise InvalidSubmissionRow(
            f"season must be an integer between 1 and {catalog.max_season}"
        )
    return value


def validate_web_battle_payload(
    raw: Any,
    catalog: SubmissionCatalog,
    *,
    filename: str,
) -> tuple[dict[str, Any], Battle]:
    """Validate and normalize the exact D1 battle-record shape."""
    if not isinstance(raw, dict) or set(raw) != {"1", "2", "winner", "season"}:
        raise InvalidSubmissionRow(
            "battle must contain only teams 1, 2, winner, and season"
        )
    if raw.get("winner") not in {"1", "2"}:
        raise InvalidSubmissionRow('battle winner must be "1" or "2"')
    season = _validate_submission_season(raw.get("season"), catalog)
    normalized = {
        "1": _validate_web_team(raw.get("1"), "battle.1", catalog, season),
        "2": _validate_web_team(raw.get("2"), "battle.2", catalog, season),
        "winner": raw["winner"],
        "season": season,
    }
    try:
        battle = validate_battle(normalized, filename)
    except InvalidBattleError as exc:
        raise InvalidSubmissionRow(str(exc)) from exc
    return normalized, battle


def validate_accepted_web_battle_payload(
    raw: Any,
    catalog: SubmissionCatalog,
    *,
    filename: str,
) -> tuple[dict[str, Any], Battle]:
    """Validate one retained training record including its exact metadata."""
    expected_keys = {
        "1",
        "2",
        "winner",
        "uploader_name",
        "uploaded_at",
        "season",
    }
    if not isinstance(raw, dict) or set(raw) != expected_keys:
        raise InvalidSubmissionRow(
            "accepted battle must contain teams, winner, uploader_name, "
            "uploaded_at, and season"
        )
    uploader_name = _validate_uploader_name(raw.get("uploader_name"))
    uploaded_at = _normalize_uploaded_at(raw.get("uploaded_at"))
    if raw["uploaded_at"] != uploaded_at:
        raise InvalidSubmissionRow("uploaded_at must be normalized UTC ISO")
    battle_data, battle = validate_web_battle_payload(
        {
            "1": raw.get("1"),
            "2": raw.get("2"),
            "winner": raw.get("winner"),
            "season": raw.get("season"),
        },
        catalog,
        filename=filename,
    )
    return {
        **battle_data,
        "uploader_name": uploader_name,
        "uploaded_at": uploaded_at,
    }, battle


def validate_submission_row(
    row: sqlite3.Row,
    catalog: SubmissionCatalog,
) -> tuple[dict[str, Any], Battle, str | None, str, str]:
    submission_id = row["submission_id"]
    if not isinstance(submission_id, str) or not _UUID_RE.fullmatch(submission_id):
        raise InvalidSubmissionRow("submission_id must be a UUID")

    uploader_name = _validate_uploader_name(row["uploader_name"])
    uploaded_at = _normalize_uploaded_at(row["received_at"])

    catalog_version = row["catalog_version"]
    if (
        not isinstance(catalog_version, str)
        or not _CATALOG_VERSION_RE.fullmatch(catalog_version)
        or catalog_version != catalog.catalog_version
    ):
        raise InvalidSubmissionRow("catalog_version does not match the current catalog")

    battle_json = row["battle_json"]
    if (
        not isinstance(battle_json, str)
        or len(battle_json.encode("utf-8")) > MAX_BATTLE_JSON_BYTES
    ):
        raise InvalidSubmissionRow("battle_json is invalid or too large")
    try:
        raw_battle = _load_json_text(battle_json, "battle_json")
    except InvalidWebBattleImport as exc:
        raise InvalidSubmissionRow(str(exc)) from exc
    battle_data, battle = validate_web_battle_payload(
        raw_battle,
        catalog,
        filename="D1 web-battle row",
    )
    stored_hash = row["canonical_hash"]
    if not isinstance(stored_hash, str) or not _SHA256_RE.fullmatch(stored_hash):
        raise InvalidSubmissionRow("canonical_hash is invalid")
    recomputed_hash = duplicate_fingerprint(battle, uploader_name)
    if stored_hash != recomputed_hash:
        raise InvalidSubmissionRow(
            "canonical_hash does not match the revalidated submission"
        )
    return battle_data, battle, uploader_name, recomputed_hash, uploaded_at


def _load_existing_web_battles(
    web_upload_dir: Path,
    catalog: SubmissionCatalog,
    expected_fingerprint_counts: Mapping[str, int],
    expected_contributors: Mapping[str, int],
) -> list[Path]:
    accepted_reports = sum(expected_fingerprint_counts.values())
    paths = sorted(web_upload_dir.glob("*.json")) if web_upload_dir.is_dir() else []
    expected_names = [
        f"web-battle-{sequence:08d}.json"
        for sequence in range(1, accepted_reports + 1)
    ]
    if [path.name for path in paths] != expected_names:
        raise InvalidWebBattleImport(
            "retained web battle files do not match the accepted checkpoint"
        )
    actual_fingerprint_counts: dict[str, int] = {}
    actual_contributors: dict[str, int] = {}
    for path in paths:
        raw = _load_json_object(path, "accepted web battle")
        try:
            normalized, battle = validate_accepted_web_battle_payload(
                raw,
                catalog,
                filename=f"web-upload/{path.name}",
            )
        except InvalidSubmissionRow as exc:
            raise InvalidWebBattleImport(
                f"accepted web battle {path.name} is invalid: {exc}"
            ) from exc
        uploader_name = normalized["uploader_name"]
        fingerprint = duplicate_fingerprint(battle, uploader_name)
        actual_fingerprint_counts[fingerprint] = (
            actual_fingerprint_counts.get(fingerprint, 0) + 1
        )
        if _is_named_contributor(uploader_name):
            assert isinstance(uploader_name, str)
            actual_contributors[uploader_name] = (
                actual_contributors.get(uploader_name, 0) + 1
            )
    if dict(sorted(actual_fingerprint_counts.items())) != dict(
        sorted(expected_fingerprint_counts.items())
    ):
        raise InvalidWebBattleImport(
            "retained web battle fingerprints do not match the checkpoint"
        )
    if dict(sorted(actual_contributors.items())) != dict(
        sorted(expected_contributors.items())
    ):
        raise InvalidWebBattleImport(
            "retained web battle contributors do not match the checkpoint"
        )
    return paths


def process_rows(
    rows: Sequence[sqlite3.Row],
    previous_state: Mapping[str, Any],
    catalog: SubmissionCatalog,
) -> tuple[dict[str, Any], list[tuple[str, dict[str, Any]]]]:
    """Fold one ascending batch, returning new state and retained records."""
    validate_state(previous_state)
    state = copy.deepcopy(dict(previous_state))
    web_counts: dict[str, int] = state["fingerprints"]["web"]
    contributors: dict[str, int] = state["contributors"]
    summary: dict[str, int] = state["summary"]
    cursor: dict[str, Any] = state["cursor"]
    accepted_files: list[tuple[str, dict[str, Any]]] = []

    previous_id = cursor["last_processed_id"]
    for row in rows:
        row_id = row["id"]
        if not _is_int(row_id) or row_id <= previous_id:
            raise InvalidWebBattleImport(
                "D1 web-battle rows are not strictly ascending"
            )
        previous_id = row_id
        cursor["last_processed_id"] = row_id
        summary["processed_reports"] += 1

        # The public "updated" date follows the highest processed row with a
        # valid D1 timestamp, even when its battle is later rejected.
        try:
            cursor["updated_date"] = _normalize_uploaded_at(
                row["received_at"]
            )[:10]
        except InvalidSubmissionRow:
            pass

        try:
            (
                battle_data,
                _battle,
                uploader_name,
                fingerprint,
                uploaded_at,
            ) = validate_submission_row(row, catalog)
        except InvalidSubmissionRow:
            summary["rejected_reports"] += 1
            continue
        cursor["updated_date"] = uploaded_at[:10]

        current_count = web_counts.get(fingerprint, 0)
        if current_count >= MAX_DUPLICATE_FINGERPRINT_COUNT:
            summary["rejected_reports"] += 1
            continue

        web_counts[fingerprint] = current_count + 1
        summary["accepted_reports"] += 1
        if _is_named_contributor(uploader_name):
            assert uploader_name is not None
            contributors[uploader_name] = contributors.get(uploader_name, 0) + 1
        filename = f"web-battle-{summary['accepted_reports']:08d}.json"
        accepted_files.append(
            (
                filename,
                {
                    **battle_data,
                    "uploader_name": uploader_name,
                    "uploaded_at": uploaded_at,
                },
            )
        )

    state["fingerprints"]["web"] = dict(sorted(web_counts.items()))
    state["contributors"] = dict(sorted(contributors.items()))
    validate_state(state)
    return state, accepted_files


def import_web_battles(
    export_path: Path,
    *,
    state_path: Path,
    manual_battles_dir: Path,
    web_upload_dir: Path,
    database_path: Path,
    recommendation_path: Path,
    public_output_path: Path,
    initialize_state: bool = False,
) -> dict[str, Any]:
    """Run one complete validated import and recommendation-model build."""
    previous_state: dict[str, Any] | None = None
    if state_path.exists():
        if initialize_state:
            raise InvalidWebBattleImport(
                "web-upload checkpoint already exists; omit --initialize-state"
            )
        previous_state = _load_json_object(
            state_path,
            "web-upload aggregate checkpoint",
        )
        validate_state(previous_state)
        after_id = previous_state["cursor"]["last_processed_id"]
    elif initialize_state:
        after_id = 0
    else:
        raise InvalidWebBattleImport(
            "web-upload aggregate checkpoint is missing; "
            "use --initialize-state once"
        )

    # This check happens before any repository mutation or model work.
    rows = load_submission_batch(export_path, after_id=after_id)
    catalog = load_submission_catalog(database_path)

    manual_battles, manual_errors = load_battles(str(manual_battles_dir))
    if manual_errors:
        raise InvalidWebBattleImport(
            f"manual corpus contains {len(manual_errors)} invalid battle file(s)"
        )
    if not manual_battles:
        raise InvalidWebBattleImport("manual battle corpus is empty")
    manual_counts = manual_fingerprint_counts(manual_battles)
    if any(
        count > MAX_DUPLICATE_FINGERPRINT_COUNT
        for count in manual_counts.values()
    ):
        raise InvalidWebBattleImport(
            "manual battle corpus exceeds the semantic duplicate cap"
        )

    if previous_state is None:
        previous_state = fresh_state(manual_counts)
    else:
        previous_state = copy.deepcopy(previous_state)
        previous_state["fingerprints"]["manual"] = dict(
            sorted(manual_counts.items())
        )
        validate_state(previous_state)

    existing_web_paths = _load_existing_web_battles(
        web_upload_dir,
        catalog,
        previous_state["fingerprints"]["web"],
        previous_state["contributors"],
    )

    proposed_state, new_files = process_rows(rows, previous_state, catalog)

    with tempfile.TemporaryDirectory(prefix="sanmou-web-battle-import-") as temp_name:
        temp_root = Path(temp_name)
        staged_web_dir = temp_root / "web-upload"
        staged_web_dir.mkdir()
        for path in existing_web_paths:
            shutil.copyfile(path, staged_web_dir / path.name)
        new_file_bytes: dict[Path, bytes] = {}
        for filename, battle_data in new_files:
            final_path = web_upload_dir / filename
            if final_path.exists():
                raise InvalidWebBattleImport(
                    f"accepted web battle filename already exists: {filename}"
                )
            content = _json_bytes(battle_data)
            (staged_web_dir / filename).write_bytes(content)
            new_file_bytes[final_path] = content

        staged_state_path = temp_root / "web_upload_state.json"
        staged_state_path.write_bytes(_json_bytes(proposed_state))
        staged_recommendation_path = temp_root / "recommendation_data.json"
        try:
            build_recommendation(
                battles_dir=str(manual_battles_dir),
                database_path=str(database_path),
                output_path=str(staged_recommendation_path),
                web_upload_dir=str(staged_web_dir),
                web_upload_state_path=str(staged_state_path),
            )
        except SystemExit as exc:
            raise InvalidWebBattleImport(
                f"recommendation rebuild failed: {exc}"
            ) from exc

        staged_recommendation_bytes = staged_recommendation_path.read_bytes()
        staged_recommendation = _load_json_text(
            staged_recommendation_bytes.decode("utf-8"),
            "rebuilt recommendation artifact",
        )
        if not isinstance(staged_recommendation, dict):
            raise InvalidWebBattleImport(
                "rebuilt recommendation artifact must be a JSON object"
            )
        validate_state(proposed_state)
        public_artifact = build_public_artifact(proposed_state)

        # All parsing, cap checks, model fitting, and JSON rendering have
        # succeeded. Apply only the already-validated proposal.
        for path, content in sorted(
            new_file_bytes.items(),
            key=lambda item: str(item[0]),
        ):
            _atomic_write_bytes(path, content)
        _atomic_write_bytes(
            recommendation_path,
            staged_recommendation_bytes,
        )
        _atomic_write_bytes(public_output_path, _json_bytes(public_artifact))
        # The checkpoint is written last, so a successful workflow commit
        # always describes every other staged artifact in the same commit.
        _atomic_write_bytes(state_path, _json_bytes(proposed_state))

    return public_artifact


def render_purge_sql(state: Mapping[str, Any]) -> str:
    """Return a purge bounded by the validated committed high-water mark."""
    validate_state(state)
    cursor = state["cursor"]["last_processed_id"]
    return (
        f'DELETE FROM "{TABLE_NAME}"\n'
        f'WHERE "id" <= {cursor};\n'
    )


def write_purge_sql(state_path: Path, output_path: Path) -> None:
    state = _load_json_object(state_path, "committed web-upload checkpoint")
    content = render_purge_sql(state).encode("utf-8")
    _atomic_write_bytes(output_path, content)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    import_parser = subparsers.add_parser(
        "import",
        help="validate and import one bounded D1 export",
    )
    import_parser.add_argument("export", type=Path)
    import_parser.add_argument(
        "--state",
        type=Path,
        default=root / "data/web_upload_state.json",
    )
    import_parser.add_argument(
        "--battles-dir",
        type=Path,
        default=root / "data/battles",
    )
    import_parser.add_argument(
        "--web-upload-dir",
        type=Path,
        default=root / "data/web-upload",
    )
    import_parser.add_argument(
        "--database",
        type=Path,
        default=root / "web/public/game-data/database.json",
    )
    import_parser.add_argument(
        "--recommendation-data",
        type=Path,
        default=root / "web/src/recommendation_data.json",
    )
    import_parser.add_argument(
        "--public-output",
        type=Path,
        default=root / "web/public/game-data/web_upload_data.json",
    )
    import_parser.add_argument(
        "--initialize-state",
        action="store_true",
    )

    purge_parser = subparsers.add_parser(
        "write-purge",
        help="write a DELETE statement from a committed checkpoint",
    )
    purge_parser.add_argument("state", type=Path)
    purge_parser.add_argument("output", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "write-purge":
            write_purge_sql(args.state, args.output)
            print(f"Wrote bounded purge SQL to {args.output}")
            return 0

        artifact = import_web_battles(
            args.export,
            state_path=args.state,
            manual_battles_dir=args.battles_dir,
            web_upload_dir=args.web_upload_dir,
            database_path=args.database,
            recommendation_path=args.recommendation_data,
            public_output_path=args.public_output,
            initialize_state=args.initialize_state,
        )
    except (InvalidWebBattleImport, OSError, UnicodeError) as exc:
        print(f"Web-battle import failed: {exc}", file=sys.stderr)
        return 1

    summary = artifact["summary"]
    print(
        "Wrote web-battle checkpoint, leaderboard, and recommendation model: "
        f"{summary['accepted_reports']} accepted / "
        f"{summary['rejected_reports']} rejected reports"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
