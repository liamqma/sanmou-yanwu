#!/usr/bin/env python3
"""Build and validate deterministic battle-report research artifacts."""
from __future__ import annotations

import argparse
import os
import tempfile
import sys
from pathlib import Path
from typing import Any

from evaluate import build_quality_report, evaluate_corpus
from formula_registry import registry_document
from parse_events import parse_lines
from provenance import align_log_lines, build_source_manifest
from render_report import render_report
from replay_state import replay_events
from schema import (
    SCHEMA_VERSION,
    ContractError,
    content_hash,
    file_sha256,
    read_json,
    read_jsonl,
    validate_artifact_manifest,
    validate_event,
    validate_line_observation,
    validate_state_snapshot,
    write_json,
    write_jsonl,
    write_text,
)


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
MODULE_NAMES = (
    "schema.py",
    "provenance.py",
    "parse_events.py",
    "replay_state.py",
    "formula_registry.py",
    "evaluate.py",
    "render_report.py",
    "cli.py",
)
ARTIFACT_NAMES = (
    "source_manifest.json",
    "line_observations.jsonl",
    "events.jsonl",
    "state_snapshots.jsonl",
    "formula_registry.json",
    "quality_report.json",
    "model_comparison.json",
    "report.md",
)


def _configured_manifest(path: Path) -> dict[str, Any]:
    value = read_json(path)
    required = {
        "schema_version",
        "battle_id",
        "experiment_session_id",
        "expected_sources",
        "game_metadata",
        "teams",
        "mirror_names",
        "audit_notes",
    }
    if not isinstance(value, dict) or not required.issubset(value):
        missing = sorted(required - set(value if isinstance(value, dict) else {}))
        raise ContractError(f"configured manifest missing keys: {missing}")
    if value["schema_version"] != SCHEMA_VERSION:
        raise ContractError("configured manifest has unsupported schema_version")
    if (
        not isinstance(value["mirror_names"], list)
        or not all(isinstance(name, str) for name in value["mirror_names"])
    ):
        raise ContractError("configured manifest mirror_names must be strings")
    if not isinstance(value["game_metadata"], dict):
        raise ContractError("configured manifest game_metadata must be an object")
    teams = value["teams"]
    if not isinstance(teams, dict):
        raise ContractError("configured manifest teams must be an object")
    known_heroes: dict[str, set[str]] = {}
    for side in ("ours", "enemy"):
        team = teams.get(side)
        if not isinstance(team, dict):
            raise ContractError(f"configured manifest teams.{side} must be an object")
        heroes = team.get("heroes")
        if heroes is None:
            known_heroes[side] = set()
        elif not isinstance(heroes, list) or not all(
            isinstance(name, str) and name for name in heroes
        ):
            raise ContractError(
                f"configured manifest teams.{side}.heroes must be strings"
            )
        else:
            known_heroes[side] = set(heroes)
    known_intersection = known_heroes["ours"] & known_heroes["enemy"]
    missing_mirrors = sorted(known_intersection - set(value["mirror_names"]))
    if missing_mirrors:
        raise ContractError(
            "configured manifest mirror_names omits heroes present on both sides: "
            f"{missing_mirrors}"
        )
    expected_sources = value["expected_sources"]
    required_sources = {
        "battle_log_sha256",
        "ocr_cache_sha256",
        "battle_log_line_count",
        "screenshot_count",
    }
    if not isinstance(expected_sources, dict):
        raise ContractError("configured manifest expected_sources must be an object")
    missing_sources = sorted(required_sources - set(expected_sources))
    if missing_sources:
        raise ContractError(
            f"configured manifest expected_sources missing keys: {missing_sources}"
        )
    if (
        "battle_log_provenance_sha256" in expected_sources
        and not isinstance(expected_sources["battle_log_provenance_sha256"], str)
    ):
        raise ContractError(
            "configured manifest battle_log_provenance_sha256 must be a string"
        )
    return value


def _safe_output_dir(output_dir: Path, repo_root: Path) -> Path:
    if output_dir.is_symlink():
        raise ContractError(f"refusing symlink output path: {output_dir}")
    resolved = output_dir.resolve()
    repository = repo_root.resolve()
    results_root = (
        repository / "study-battle-report" / "research" / "results"
    ).resolve()
    protected = (repository, HERE.resolve(), HERE.parent.resolve())
    if any(resolved == path or resolved in path.parents for path in protected):
        raise ContractError(f"refusing repository/source ancestor output: {resolved}")
    if resolved == results_root:
        raise ContractError(f"refusing shared results-root output: {resolved}")
    if resolved.is_relative_to(repository) and not resolved.is_relative_to(results_root):
        raise ContractError(f"refusing non-results repository output: {resolved}")
    return resolved


def _assert_owned_output(output: Path, battle_id: str) -> None:
    if output.is_symlink() or not output.is_dir():
        raise ContractError(f"refusing unowned output path: {output}")
    expected = set(ARTIFACT_NAMES) | {"artifact_manifest.json"}
    entries = {entry.name for entry in output.iterdir()}
    foreign = sorted(entries - expected)
    missing = sorted(expected - entries)
    if foreign or missing:
        raise ContractError(
            f"refusing unowned output directory {output}: "
            f"foreign={foreign}, missing={missing}"
        )
    artifact_manifest = validate_artifact_manifest(output)
    listed_paths = [
        item.get("path") for item in artifact_manifest.get("artifact_files", [])
    ]
    if len(listed_paths) != len(set(listed_paths)) or set(listed_paths) != set(ARTIFACT_NAMES):
        raise ContractError("existing output manifest does not own the exact artifact set")
    source_manifest = read_json(output / "source_manifest.json")
    if artifact_manifest.get("schema_version") != SCHEMA_VERSION:
        raise ContractError("existing output has a different schema")
    if artifact_manifest.get("battle_id") != battle_id:
        raise ContractError("existing output belongs to a different battle")
    if source_manifest.get("schema_version") != SCHEMA_VERSION:
        raise ContractError("existing source manifest has a different schema")
    if source_manifest.get("battle_id") != battle_id:
        raise ContractError("existing source manifest belongs to a different battle")


def _temporary_output(output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    return Path(
        tempfile.mkdtemp(
            prefix=f".{output.name}.", suffix=".pipeline-tmp", dir=output.parent
        )
    )


def _discard_temporary_output(temporary: Path) -> None:
    if not temporary.exists():
        return
    known = set(ARTIFACT_NAMES) | {"artifact_manifest.json"}
    for entry in temporary.iterdir():
        if entry.name not in known or not entry.is_file() or entry.is_symlink():
            raise ContractError(f"refusing to delete unexpected temporary entry: {entry}")
        entry.unlink()
    temporary.rmdir()


def _publish_output(temporary: Path, output: Path, battle_id: str, existed: bool) -> None:
    if not existed:
        if output.exists() or output.is_symlink():
            raise ContractError(f"output appeared during build: {output}")
        os.replace(temporary, output)
        return
    _assert_owned_output(output, battle_id)
    for name in ARTIFACT_NAMES:
        os.replace(temporary / name, output / name)
    os.replace(temporary / "artifact_manifest.json", output / "artifact_manifest.json")
    temporary.rmdir()


def build(
    battle_id: str,
    output_dir: Path,
    manifest_path: Path | None = None,
    repo_root: Path = REPO_ROOT,
) -> Path:
    configured_path = manifest_path or HERE / "manifests" / f"{battle_id}.json"
    configured = _configured_manifest(configured_path)
    if configured["battle_id"] != battle_id:
        raise ContractError(
            f"manifest battle_id {configured['battle_id']!r} does not match {battle_id!r}"
        )

    output = _safe_output_dir(output_dir, repo_root)
    output_existed = output.exists()
    if output_existed:
        _assert_owned_output(output, battle_id)

    module_paths = [HERE / name for name in MODULE_NAMES]
    source_manifest = build_source_manifest(repo_root, configured, module_paths)
    battle_root = repo_root / "study-battle-report" / "battles" / battle_id
    provenance_path = (
        battle_root / "battle_log.provenance.json"
        if "battle_log_provenance" in source_manifest["sources"]
        else None
    )
    line_observations, provenance_quality = align_log_lines(
        battle_id,
        battle_root / "battle_log.txt",
        battle_root / ".ocr_cache.json",
        set(configured["mirror_names"]),
        provenance_path,
    )
    expected_line_count = configured["expected_sources"]["battle_log_line_count"]
    if len(line_observations) != expected_line_count:
        raise ValueError(
            f"battle log line count mismatch: expected {expected_line_count}, "
            f"got {len(line_observations)}"
        )
    events, parse_quality = parse_lines(
        battle_id, line_observations, set(configured["mirror_names"])
    )
    snapshots, replay_quality = replay_events(battle_id, events)
    quality = build_quality_report(
        battle_id,
        provenance_quality,
        parse_quality,
        replay_quality,
        events,
    )
    evaluation = evaluate_corpus(
        [source_manifest], events, snapshots, provenance_quality
    )
    report = render_report(source_manifest, quality, evaluation, events)

    temporary = _temporary_output(output)
    try:
        write_json(temporary / "source_manifest.json", source_manifest)
        write_jsonl(temporary / "line_observations.jsonl", line_observations)
        write_jsonl(temporary / "events.jsonl", events)
        write_jsonl(temporary / "state_snapshots.jsonl", snapshots)
        write_json(temporary / "formula_registry.json", registry_document())
        write_json(temporary / "quality_report.json", quality)
        write_json(temporary / "model_comparison.json", evaluation)
        write_text(temporary / "report.md", report)

        artifact_files = [
            {"path": name, "sha256": file_sha256(temporary / name)}
            for name in ARTIFACT_NAMES
        ]
        write_json(
            temporary / "artifact_manifest.json",
            {
                "schema_version": SCHEMA_VERSION,
                "battle_id": battle_id,
                "artifact_files": artifact_files,
                "artifact_set_hash": content_hash(artifact_files),
            },
        )
        validate(temporary)
        _publish_output(temporary, output, battle_id, output_existed)
    except BaseException:
        _discard_temporary_output(temporary)
        raise
    validate(output)
    return output


def validate(output_dir: Path) -> dict[str, Any]:
    output = output_dir.resolve()
    artifact_manifest = validate_artifact_manifest(output)
    listed_paths = [
        item.get("path") for item in artifact_manifest.get("artifact_files", [])
    ]
    if len(listed_paths) != len(set(listed_paths)) or set(listed_paths) != set(ARTIFACT_NAMES):
        raise ContractError("existing output manifest does not own the exact artifact set")
    source_manifest = read_json(output / "source_manifest.json")
    lines = read_jsonl(output / "line_observations.jsonl")
    events = read_jsonl(output / "events.jsonl")
    snapshots = read_jsonl(output / "state_snapshots.jsonl")
    formula_registry = read_json(output / "formula_registry.json")
    quality = read_json(output / "quality_report.json")
    evaluation = read_json(output / "model_comparison.json")

    for row in lines:
        validate_line_observation(row)
    for row in events:
        validate_event(row)
    for row in snapshots:
        validate_state_snapshot(row)

    if source_manifest.get("schema_version") != SCHEMA_VERSION:
        raise ContractError("source manifest has unsupported schema_version")
    if len(lines) != len(events):
        raise ContractError("every final line must have exactly one event row")
    for expected_line_no, (line, event) in enumerate(zip(lines, events, strict=True), 1):
        if line["final_line_no"] != expected_line_no:
            raise ContractError("line observations must be contiguous and ordered")
        if event["source_lines"] != [expected_line_no]:
            raise ContractError("event source line must match its retained final line")
        if event["raw_text"] != line["final_log_text"]:
            raise ContractError("event raw_text must preserve final_log_text exactly")
        if event["analysis_eligibility"] == "eligible_exact_damage" and (
            line["alignment_status"] != "exact"
            or line["lineage_status"] != "deterministic_v2"
        ):
            raise ContractError(
                "exact damage eligibility requires exact deterministic v2 lineage"
            )
    if quality.get("parsing", {}).get("event_count") != len(events):
        raise ContractError("quality report event_count does not match events.jsonl")
    if formula_registry != registry_document():
        raise ContractError("formula registry differs from the fixed code registry")
    if evaluation.get("formula_registry") != formula_registry:
        raise ContractError("model comparison does not embed the fixed formula registry")
    if evaluation.get("llm_annotations_included") is not False:
        raise ContractError("deterministic analysis must exclude LLM annotations")
    group_count = len(evaluation.get("experiment_session_ids", []))
    final_damage = evaluation.get("final_damage", {})
    minimum_groups = final_damage.get("minimum_independent_groups", 0)
    if final_damage.get("selected_formula") is not None:
        raise ContractError("phase-one output must not select a damage formula")
    if final_damage.get("restored_formula_claim") is not False:
        raise ContractError("phase-one output must not claim formula restoration")
    candidate_statuses = {
        candidate.get("status") for candidate in final_damage.get("candidates", [])
    }
    cross_validation_status = final_damage.get("cross_validation", {}).get("status")
    if group_count < minimum_groups:
        if final_damage.get("status") != "insufficient_independent_groups":
            raise ContractError("single/small corpus must report insufficient groups")
        if candidate_statuses != {"not_evaluated_insufficient_independent_groups"}:
            raise ContractError("insufficient corpus candidate statuses are inconsistent")
        if cross_validation_status != "unavailable_insufficient_groups":
            raise ContractError("insufficient corpus must not claim cross-validation")
    else:
        expected = "ready_for_future_grouped_evaluation_not_implemented"
        if final_damage.get("status") != expected:
            raise ContractError("ready corpus must retain phase-one not-implemented status")
        if candidate_statuses != {"not_evaluated_phase_one_not_implemented"}:
            raise ContractError("ready corpus candidate statuses are inconsistent")
        if cross_validation_status != "not_run_phase_one_not_implemented":
            raise ContractError("phase one must not claim cross-validation was run")

    return {
        "schema_version": SCHEMA_VERSION,
        "battle_id": artifact_manifest["battle_id"],
        "line_count": len(lines),
        "event_count": len(events),
        "snapshot_count": len(snapshots),
        "status": "valid",
        "final_damage_status": final_damage.get("status"),
        "artifact_set_hash": artifact_manifest["artifact_set_hash"],
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build or validate deterministic battle-report research artifacts."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--battle", required=True)
    build_parser.add_argument("--output", required=True, type=Path)
    build_parser.add_argument("--manifest", type=Path)
    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("output", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "build":
            output = build(args.battle, args.output, args.manifest)
            summary = validate(output)
            print(
                f"built {summary['battle_id']}: lines={summary['line_count']} "
                f"events={summary['event_count']} snapshots={summary['snapshot_count']} "
                f"final_damage={summary['final_damage_status']}"
            )
        else:
            summary = validate(args.output)
            print(
                f"valid {summary['battle_id']}: lines={summary['line_count']} "
                f"events={summary['event_count']} snapshots={summary['snapshot_count']} "
                f"final_damage={summary['final_damage_status']}"
            )
    except (ContractError, FileNotFoundError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
