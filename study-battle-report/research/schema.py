"""Versioned output contracts for the battle-report research pipeline.

The research output deliberately uses plain JSON/JSONL and a small in-process
validator. This keeps the pipeline deterministic and avoids turning an OCR
failure into a silently dropped row.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "sanmou-battle-research-v1"

EVENT_TYPES = frozenset(
    {
        "battle_result",
        "critical",
        "damage",
        "death",
        "healing",
        "normal_attack",
        "percent_change",
        "resistance",
        "round_start",
        "skill_action",
        "stat_change",
        "status_change",
        "troop_change",
        "unknown",
    }
)

ALIGNMENT_STATUSES = frozenset({"exact", "fuzzy", "ambiguous", "unmatched"})
PARSE_STATUSES = frozenset({"parsed", "partial", "unknown"})
SIDE_STATUSES = frozenset(
    {"observed", "inferred", "mirror_ambiguous", "missing", "not_applicable"}
)
SIDE_SOURCES = frozenset(
    {
        "direct_token_colour",
        "inferred_side_backfill",
        "near_duplicate_reuse",
        "legacy_unverifiable",
        "unresolved",
        "missing",
    }
)
_ENTITY_RE = re.compile(r"\[(?:(我方|敌方):)?([^\[\]]+)\]")


class ContractError(ValueError):
    """Raised when a generated artifact violates the v1 contract."""


def canonical_json(value: Any) -> str:
    """Return the byte-stable compact representation used for content hashes."""
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def write_json(path: Path, value: Any) -> None:
    rendered = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
        allow_nan=False,
    )
    _atomic_write(path, rendered + "\n")


def write_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    rendered = "".join(canonical_json(dict(row)) + "\n" for row in rows)
    _atomic_write(path, rendered)


def write_text(path: Path, text: str) -> None:
    _atomic_write(path, text)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, 1):
            if not raw.strip():
                raise ContractError(f"{path}:{line_number}: blank JSONL row")
            try:
                value = json.loads(raw)
            except json.JSONDecodeError as error:
                raise ContractError(f"{path}:{line_number}: invalid JSON: {error}") from error
            if not isinstance(value, dict):
                raise ContractError(f"{path}:{line_number}: row must be an object")
            rows.append(value)
    return rows


def _require_keys(value: Mapping[str, Any], keys: Sequence[str], context: str) -> None:
    missing = [key for key in keys if key not in value]
    if missing:
        raise ContractError(f"{context}: missing keys {missing}")


def validate_line_observation(row: Mapping[str, Any]) -> None:
    _require_keys(
        row,
        (
            "schema_version",
            "battle_id",
            "line_id",
            "final_line_no",
            "final_log_text",
            "normalized_text",
            "provenance_schema_version",
            "lineage_status",
            "alignment_status",
            "source_observations",
            "entity_side_provenance",
            "anomalies",
            "uncertainties",
        ),
        "line observation",
    )
    if row["schema_version"] != SCHEMA_VERSION:
        raise ContractError("line observation: unsupported schema_version")
    if not isinstance(row["final_line_no"], int) or row["final_line_no"] < 1:
        raise ContractError("line observation: final_line_no must be positive")
    if not isinstance(row["final_log_text"], str):
        raise ContractError("line observation: final_log_text must be a string")
    if row["alignment_status"] not in ALIGNMENT_STATUSES:
        raise ContractError("line observation: invalid alignment_status")
    if not isinstance(row["source_observations"], list):
        raise ContractError("line observation: source_observations must be a list")
    for source in row["source_observations"]:
        _require_keys(
            source,
            (
                "image",
                "cache_line_no",
                "cache_processed_text",
                "ocr_score",
                "similarity",
                "raw_ocr_text",
                "bbox",
                "observation_id",
                "name_tokens",
                "processing",
                "provenance_kind",
                "reused_from_observation_id",
            ),
            "source observation",
        )
        provenance_kind = source["provenance_kind"]
        if provenance_kind == "legacy_v1_candidate":
            if source["raw_ocr_text"] is not None or source["bbox"] is not None:
                raise ContractError(
                    "legacy source observation cannot claim raw text or bounding box"
                )
            if source["processing"] is not None:
                raise ContractError("legacy source observation cannot claim processing")
        elif provenance_kind in {"v2_exact_lineage", "v2_cache_candidate"}:
            if not isinstance(source["raw_ocr_text"], str):
                raise ContractError("v2 source observation must retain raw text")
            if not isinstance(source["bbox"], list):
                raise ContractError("v2 source observation must retain its line box")
            if not isinstance(source["name_tokens"], list):
                raise ContractError("v2 source observation must retain token evidence")
            processing = source["processing"]
            if (
                not isinstance(processing, dict)
                or not isinstance(processing.get("canonical_correction_applied"), bool)
            ):
                raise ContractError(
                    "v2 source observation must retain canonical correction status"
                )
        else:
            raise ContractError("source observation: unknown provenance_kind")
    side_provenance = row["entity_side_provenance"]
    text_entities = _ENTITY_RE.findall(row["final_log_text"])
    if not isinstance(side_provenance, list) or len(side_provenance) != len(
        text_entities
    ):
        raise ContractError("line observation: entity side provenance mismatch")
    for entity_index, ((side, name), item) in enumerate(
        zip(text_entities, side_provenance, strict=True)
    ):
        if not isinstance(item, Mapping):
            raise ContractError("line observation: invalid entity side provenance")
        _require_keys(
            item,
            ("entity_index", "name", "displayed_side", "side_source"),
            "entity side provenance",
        )
        if (
            item["entity_index"] != entity_index
            or item["name"] != name
            or item["displayed_side"] != (side or None)
            or item["side_source"] not in SIDE_SOURCES
        ):
            raise ContractError("line observation: invalid entity side provenance")
        if side is None and item["side_source"] != "missing":
            raise ContractError("line observation: untagged entity side must be missing")
        if side and item["side_source"] == "missing":
            raise ContractError("line observation: tagged entity side source is missing")
        if item["side_source"] == "direct_token_colour" and not any(
            source["reused_from_observation_id"] is None
            and not (
                isinstance(source["processing"], dict)
                and source["processing"].get("near_duplicate_reuse") is True
            )
            and any(
                token.get("decision") == side and token.get("token_text") == name
                for token in source["name_tokens"]
            )
            for source in row["source_observations"]
        ):
            raise ContractError(
                "line observation: direct side lacks token colour evidence"
            )
    if row["lineage_status"] == "deterministic_v2":
        if row["alignment_status"] != "exact" or not row["source_observations"]:
            raise ContractError("line observation: deterministic v2 lineage is incomplete")
        if any(
            source["provenance_kind"] != "v2_exact_lineage"
            or source["processing"]["canonical_correction_applied"] is not False
            or source["reused_from_observation_id"] is not None
            or source["processing"].get("near_duplicate_reuse") is True
            for source in row["source_observations"]
        ):
            raise ContractError(
                "line observation: deterministic v2 lineage contains non-exact evidence"
            )


def validate_entity(entity: Mapping[str, Any] | None) -> None:
    if entity is None:
        return
    _require_keys(
        entity,
        ("name", "observed_side", "resolved_side", "side_status", "side_source"),
        "entity",
    )
    side_status = entity["side_status"]
    side_source = entity["side_source"]
    if side_status not in SIDE_STATUSES or side_source not in SIDE_SOURCES:
        raise ContractError("entity: invalid side provenance")
    if side_status == "observed" and (
        side_source != "direct_token_colour"
        or entity["resolved_side"] != entity["observed_side"]
        or entity["resolved_side"] not in {"我方", "敌方"}
    ):
        raise ContractError("entity: observed side requires direct token evidence")
    if side_status == "inferred" and (
        side_source in {"direct_token_colour", "missing"}
        or entity["observed_side"] not in {"我方", "敌方"}
        or entity["resolved_side"] is not None
    ):
        raise ContractError("entity: inferred side must remain unresolved")
    if side_status == "missing" and (
        entity["observed_side"] is not None or entity["resolved_side"] is not None
    ):
        raise ContractError("entity: missing side must remain unresolved")
    if side_status == "mirror_ambiguous" and entity["resolved_side"] is not None:
        raise ContractError("entity: mirror ambiguity must not be force-resolved")


def validate_event(row: Mapping[str, Any]) -> None:
    _require_keys(
        row,
        (
            "schema_version",
            "battle_id",
            "event_id",
            "parent_action_id",
            "round",
            "sequence",
            "event_type",
            "parse_status",
            "raw_text",
            "source_lines",
            "actor",
            "source",
            "target",
            "skill",
            "metric",
            "direction",
            "delta_displayed",
            "total_displayed",
            "damage",
            "healing",
            "troops_after",
            "critical_multiplier",
            "event_reduction",
            "is_lethal_censored",
            "censoring",
            "anomalies",
            "uncertainties",
            "analysis_eligibility",
        ),
        "event",
    )
    if row["schema_version"] != SCHEMA_VERSION:
        raise ContractError("event: unsupported schema_version")
    if row["event_type"] not in EVENT_TYPES:
        raise ContractError(f"event: unknown event_type {row['event_type']!r}")
    if row["parse_status"] not in PARSE_STATUSES:
        raise ContractError("event: invalid parse_status")
    if row["event_type"] == "unknown" and row["parse_status"] != "unknown":
        raise ContractError("event: unknown events must retain unknown parse status")
    if not row["source_lines"]:
        raise ContractError("event: source_lines must not be empty")
    for field in ("actor", "source", "target"):
        validate_entity(row[field])
    if row["analysis_eligibility"] == "eligible_exact_damage":
        if (
            row["event_type"] != "damage"
            or row["parse_status"] != "parsed"
            or not isinstance(row["troops_after"], int)
            or row["troops_after"] <= 0
            or row["is_lethal_censored"]
        ):
            raise ContractError("event: invalid exact damage eligibility")
        for field in ("actor", "source", "target"):
            entity = row[field]
            if (
                entity is None
                or entity["side_status"] != "observed"
                or entity["resolved_side"] not in {"我方", "敌方"}
            ):
                raise ContractError(
                    "event: exact damage requires resolved causal sides"
                )
    if row["is_lethal_censored"]:
        censoring = row["censoring"]
        if not isinstance(censoring, dict) or censoring.get("kind") != "right":
            raise ContractError("event: lethal damage must be right-censored")
        if censoring.get("lower_bound") != row["damage"]:
            raise ContractError("event: censor lower bound must equal logged damage")


def validate_state_snapshot(row: Mapping[str, Any]) -> None:
    _require_keys(
        row,
        (
            "schema_version",
            "battle_id",
            "event_id",
            "event_type",
            "state_status",
            "subject_key",
            "state_before",
            "state_after",
            "transition",
            "source_lines",
        ),
        "state snapshot",
    )
    if row["schema_version"] != SCHEMA_VERSION:
        raise ContractError("state snapshot: unsupported schema_version")


def validate_artifact_manifest(output_dir: Path) -> dict[str, Any]:
    manifest_path = output_dir / "artifact_manifest.json"
    manifest = read_json(manifest_path)
    _require_keys(
        manifest,
        ("schema_version", "artifact_files", "artifact_set_hash"),
        "artifact manifest",
    )
    if manifest["schema_version"] != SCHEMA_VERSION:
        raise ContractError("artifact manifest: unsupported schema_version")
    files = manifest["artifact_files"]
    if not isinstance(files, list) or not files:
        raise ContractError("artifact manifest: artifact_files must be non-empty")
    for item in files:
        _require_keys(item, ("path", "sha256"), "artifact file")
        path = output_dir / item["path"]
        if not path.is_file():
            raise ContractError(f"artifact manifest: missing {item['path']}")
        actual = file_sha256(path)
        if actual != item["sha256"]:
            raise ContractError(
                f"artifact manifest: hash mismatch for {item['path']}: "
                f"expected {item['sha256']}, got {actual}"
            )
    if content_hash(files) != manifest["artifact_set_hash"]:
        raise ContractError("artifact manifest: artifact_set_hash mismatch")
    return manifest
