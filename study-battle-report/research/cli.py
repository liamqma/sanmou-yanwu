#!/usr/bin/env python3
"""Build and validate deterministic battle-report research artifacts."""
from __future__ import annotations

import argparse
import shutil
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
    if not isinstance(value["mirror_names"], list):
        raise ContractError("configured manifest mirror_names must be a list")
    return value


def _safe_output_dir(output_dir: Path) -> Path:
    resolved = output_dir.resolve()
    forbidden = {REPO_ROOT.resolve(), HERE.resolve(), HERE.parent.resolve()}
    if resolved in forbidden:
        raise ValueError(f"refusing to replace source directory: {resolved}")
    return resolved


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

    module_paths = [HERE / name for name in MODULE_NAMES]
    source_manifest = build_source_manifest(repo_root, configured, module_paths)
    battle_root = repo_root / "study-battle-report" / "battles" / battle_id
    line_observations, provenance_quality = align_log_lines(
        battle_id,
        battle_root / "battle_log.txt",
        battle_root / ".ocr_cache.json",
        set(configured["mirror_names"]),
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
    evaluation = evaluate_corpus([source_manifest], events, snapshots)
    report = render_report(source_manifest, quality, evaluation, events)

    output = _safe_output_dir(output_dir)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    write_json(output / "source_manifest.json", source_manifest)
    write_jsonl(output / "line_observations.jsonl", line_observations)
    write_jsonl(output / "events.jsonl", events)
    write_jsonl(output / "state_snapshots.jsonl", snapshots)
    write_json(output / "formula_registry.json", registry_document())
    write_json(output / "quality_report.json", quality)
    write_json(output / "model_comparison.json", evaluation)
    write_text(output / "report.md", report)

    artifact_files = [
        {"path": name, "sha256": file_sha256(output / name)}
        for name in ARTIFACT_NAMES
    ]
    write_json(
        output / "artifact_manifest.json",
        {
            "schema_version": SCHEMA_VERSION,
            "battle_id": battle_id,
            "artifact_files": artifact_files,
            "artifact_set_hash": content_hash(artifact_files),
        },
    )
    validate(output)
    return output


def validate(output_dir: Path) -> dict[str, Any]:
    output = output_dir.resolve()
    artifact_manifest = validate_artifact_manifest(output)
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
    if group_count < final_damage.get("minimum_independent_groups", 0):
        if final_damage.get("status") != "insufficient_independent_groups":
            raise ContractError("single/small corpus must report insufficient groups")
        if final_damage.get("selected_formula") is not None:
            raise ContractError("insufficient corpus must not select a damage formula")
        if final_damage.get("restored_formula_claim") is not False:
            raise ContractError("insufficient corpus must not claim formula restoration")

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
