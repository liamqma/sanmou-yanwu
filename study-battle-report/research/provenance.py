"""Conservative source alignment for stitched battle logs and OCR cache rows."""
from __future__ import annotations

import json
import re
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from schema import SCHEMA_VERSION, content_hash, file_sha256


PIPELINE_VERSION = 1
FUZZY_ALIGNMENT_THRESHOLD = 0.88
MAX_FUZZY_SOURCES = 8

_SIDE_PREFIX_RE = re.compile(r"\[(?:我方|敌方):")
_TAGGED_NAME_RE = re.compile(r"\[(我方|敌方):([^\[\]]+)\]")


def normalize_for_alignment(text: str) -> str:
    text = _SIDE_PREFIX_RE.sub("[", text)
    text = re.sub(r"\s+", "", text)
    return text.translate(
        str.maketrans(
            {
                "！": "!",
                "（": "(",
                "）": ")",
                "，": ",",
                "：": ":",
                "％": "%",
                "【": "[",
                "】": "]",
                "「": "[",
                "」": "]",
            }
        )
    )


def _cache_rows(cache_path: Path) -> tuple[list[dict[str, Any]], str]:
    with cache_path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"OCR cache must be an object: {cache_path}")

    rows: list[dict[str, Any]] = []
    if value.get("schema_version") == "sanmou-ocr-cache-v2":
        frames = value.get("frames")
        if not isinstance(frames, dict):
            raise ValueError("v2 OCR cache frames must be an object")
        for image in sorted(frames):
            observations = frames[image].get("observations", [])
            if not isinstance(observations, list):
                raise ValueError(f"v2 OCR observations for {image} must be a list")
            for cache_line_no, observation in enumerate(observations, 1):
                text = observation.get("processed_text")
                if not isinstance(text, str):
                    raise ValueError(f"v2 OCR text {image}:{cache_line_no} is invalid")
                rows.append(
                    {
                        "image": image,
                        "cache_line_no": cache_line_no,
                        "cache_processed_text": text,
                        "ocr_score": float(observation.get("score", 0.0)),
                        "normalized_text": normalize_for_alignment(text),
                        "raw_ocr_text": observation.get("raw_text"),
                        "bbox": observation.get("bbox"),
                        "observation_id": observation.get("observation_id"),
                        "name_tokens": observation.get("name_tokens", []),
                        "provenance_kind": "v2_cache_candidate",
                        "reused_from_observation_id": observation.get(
                            "reused_from_observation_id"
                        ),
                    }
                )
        return rows, "v2_cache_without_exact_sidecar"

    for image in sorted(value):
        entries = value[image]
        if not isinstance(entries, list):
            raise ValueError(f"OCR cache entries for {image} must be a list")
        for cache_line_no, entry in enumerate(entries, 1):
            if isinstance(entry, str):
                text, score = entry, 1.0
            elif isinstance(entry, list) and len(entry) == 2:
                text, score = entry
            else:
                raise ValueError(
                    f"OCR cache entry {image}:{cache_line_no} has unsupported shape"
                )
            if not isinstance(text, str):
                raise ValueError(f"OCR cache text {image}:{cache_line_no} must be a string")
            rows.append(
                {
                    "image": image,
                    "cache_line_no": cache_line_no,
                    "cache_processed_text": text,
                    "ocr_score": float(score),
                    "normalized_text": normalize_for_alignment(text),
                    "raw_ocr_text": None,
                    "bbox": None,
                    "observation_id": f"legacy:{image}:o{cache_line_no:04d}",
                    "name_tokens": [],
                    "provenance_kind": "legacy_v1_candidate",
                    "reused_from_observation_id": None,
                }
            )
    return rows, "legacy_v1_fallback"

def _line_anomalies(text: str, mirror_names: set[str]) -> list[str]:
    anomalies: set[str] = set()
    if "重连" in text or re.search(r"\d{1,2}:\d{2}", text):
        anomalies.add("overlay_or_reconnect")
    if "兵力" in text and (
        text.count("(") + text.count("（") > text.count(")") + text.count("）")
    ):
        anomalies.add("truncated_number")
    if re.search(r"(?:(?:来自|由于|损失)[,，]?$|效果[,，]$)", text) or text.startswith(
        ("】的", "的「", "失了兵", "损失了兵")
    ):
        anomalies.add("fragmented_event")
    attack = re.search(
        r"\[(我方|敌方):([^\]]+)\]对\[(我方|敌方):([^\]]+)\]发动普通攻击",
        text,
    )
    if attack and attack.group(1) == attack.group(3):
        anomalies.add("same_side_attack_suspect")
    names = {name for _, name in _TAGGED_NAME_RE.findall(text)}
    if names & mirror_names:
        anomalies.add("mirror_side_ambiguous")
    return sorted(anomalies)


def _render_source(row: dict[str, Any], similarity: float) -> dict[str, Any]:
    return {
        "image": row["image"],
        "cache_line_no": row["cache_line_no"],
        "cache_processed_text": row["cache_processed_text"],
        "ocr_score": row["ocr_score"],
        "similarity": round(similarity, 6),
        "raw_ocr_text": row["raw_ocr_text"],
        "bbox": row["bbox"],
        "observation_id": row["observation_id"],
        "name_tokens": row["name_tokens"],
        "provenance_kind": row["provenance_kind"],
        "reused_from_observation_id": row["reused_from_observation_id"],
    }


def _render_v2_lineage_source(observation: dict[str, Any]) -> dict[str, Any]:
    return {
        "image": observation["image"],
        "cache_line_no": None,
        "cache_processed_text": observation["processed_text"],
        "ocr_score": float(observation["score"]),
        "similarity": 1.0,
        "raw_ocr_text": observation["raw_text"],
        "bbox": observation["bbox"],
        "observation_id": observation["observation_id"],
        "name_tokens": observation.get("name_tokens", []),
        "provenance_kind": "v2_exact_lineage",
        "reused_from_observation_id": observation.get(
            "reused_from_observation_id"
        ),
    }


def _align_from_v2_sidecar(
    battle_id: str,
    log_path: Path,
    sidecar: dict[str, Any],
    mirror_names: set[str],
    provenance_path: Path | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if sidecar.get("schema_version") != "sanmou-battle-log-provenance-v2":
        raise ValueError("unsupported battle-log provenance sidecar schema")
    if sidecar.get("battle_id") != battle_id:
        raise ValueError("battle-log provenance sidecar battle_id mismatch")
    if sidecar.get("observation_provenance_complete") is not True:
        raise ValueError("v2 exact lineage requires complete observation provenance")
    expected_log_hash = sidecar.get("battle_log_sha256")
    if not isinstance(expected_log_hash, str):
        raise ValueError(
            "complete battle-log provenance sidecar requires battle_log_sha256"
        )
    actual_log_hash = file_sha256(log_path)
    if expected_log_hash != actual_log_hash:
        raise ValueError(
            "battle-log provenance battle_log_sha256 mismatch: "
            f"expected {expected_log_hash}, got {actual_log_hash}"
        )
    final_lineage = sidecar.get("final_lines")
    if not isinstance(final_lineage, list):
        raise ValueError("battle-log provenance final_lines must be a list")
    with log_path.open("r", encoding="utf-8") as handle:
        log_lines = handle.read().splitlines()
    if len(final_lineage) != len(log_lines):
        raise ValueError("battle-log provenance line count mismatch")

    observations: list[dict[str, Any]] = []
    for line_no, (text, lineage) in enumerate(
        zip(log_lines, final_lineage, strict=True), 1
    ):
        if lineage.get("line_number") != line_no or lineage.get("text") != text:
            raise ValueError(f"battle-log provenance text mismatch at line {line_no}")
        source_values = lineage.get("source_observations", [])
        if not isinstance(source_values, list):
            raise ValueError(f"battle-log provenance sources invalid at line {line_no}")
        sources = [_render_v2_lineage_source(value) for value in source_values]
        lineage_status = str(lineage.get("lineage_status", "unknown"))
        anomalies = _line_anomalies(text, mirror_names)
        uncertainties: list[str] = []
        if not sources:
            alignment_status = "unmatched"
            anomalies.append("provenance_unmatched")
        elif lineage_status == "unresolved_transform_mapping":
            alignment_status = "ambiguous"
            anomalies.append("provenance_lineage_partial")
            uncertainties.append("unresolved_transform_mapping")
        else:
            alignment_status = "exact"
        if lineage_status == "deterministic_heuristic_v2":
            uncertainties.append("deterministic_fuzzy_stitch_decision")
        token_evidence = [
            token for source in sources for token in source["name_tokens"]
        ]
        if token_evidence:
            uncertainties.append("token_side_geometry_approximate")
        if any(token.get("decision") is None for token in token_evidence):
            uncertainties.append("one_or_more_token_sides_unresolved")
        observations.append(
            {
                "schema_version": SCHEMA_VERSION,
                "battle_id": battle_id,
                "line_id": f"{battle_id}:L{line_no:04d}",
                "final_line_no": line_no,
                "final_log_text": text,
                "normalized_text": normalize_for_alignment(text),
                "provenance_schema_version": sidecar["schema_version"],
                "lineage_status": lineage_status,
                "alignment_status": alignment_status,
                "source_observations": sources,
                "anomalies": sorted(set(anomalies)),
                "uncertainties": sorted(set(uncertainties)),
            }
        )

    status_counts = Counter(row["alignment_status"] for row in observations)
    anomaly_counts = Counter(
        anomaly for row in observations for anomaly in row["anomalies"]
    )
    lineage_counts = Counter(row["lineage_status"] for row in observations)
    frame_observation_count = sum(
        len(frame.get("observation_ids", [])) for frame in sidecar.get("frames", [])
    )
    quality = {
        "schema_version": SCHEMA_VERSION,
        "battle_id": battle_id,
        "provenance_mode": "v2_exact_lineage",
        "provenance_schema_version": sidecar["schema_version"],
        "line_count": len(observations),
        "cache_observation_count": frame_observation_count,
        "alignment_status_counts": dict(sorted(status_counts.items())),
        "lineage_status_counts": dict(sorted(lineage_counts.items())),
        "line_anomaly_counts": dict(sorted(anomaly_counts.items())),
        "provenance_limitations": list(sidecar.get("limitations", [])),
        "token_side_calibration": sidecar.get("token_side_calibration"),
    }
    return observations, quality

def align_log_lines(
    battle_id: str,
    log_path: Path,
    cache_path: Path,
    mirror_names: set[str],
    provenance_path: Path | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    sidecar_schema: str | None = None
    if provenance_path is not None and provenance_path.exists():
        with provenance_path.open("r", encoding="utf-8") as handle:
            sidecar = json.load(handle)
        sidecar_schema = sidecar.get("schema_version")
        if sidecar.get("observation_provenance_complete") is True:
            return _align_from_v2_sidecar(
                battle_id, log_path, sidecar, mirror_names
            )
    cache_rows, cache_mode = _cache_rows(cache_path)
    exact_index: dict[str, list[dict[str, Any]]] = {}
    for row in cache_rows:
        exact_index.setdefault(row["normalized_text"], []).append(row)

    with log_path.open("r", encoding="utf-8") as handle:
        log_lines = handle.read().splitlines()

    observations: list[dict[str, Any]] = []
    for line_no, text in enumerate(log_lines, 1):
        normalized = normalize_for_alignment(text)
        exact = exact_index.get(normalized, [])
        sources: list[dict[str, Any]]
        if exact:
            sources = [_render_source(row, 1.0) for row in exact]
            alignment_status = "ambiguous" if len(exact) > 1 else "exact"
        else:
            scored: list[tuple[float, dict[str, Any]]] = []
            for row in cache_rows:
                candidate = row["normalized_text"]
                if not normalized or not candidate:
                    continue
                if abs(len(normalized) - len(candidate)) > max(
                    4, int(max(len(normalized), len(candidate)) * 0.35)
                ):
                    continue
                similarity = SequenceMatcher(None, normalized, candidate).ratio()
                if similarity >= FUZZY_ALIGNMENT_THRESHOLD:
                    scored.append((similarity, row))
            scored.sort(
                key=lambda item: (
                    -item[0],
                    item[1]["image"],
                    item[1]["cache_line_no"],
                )
            )
            if scored:
                best = scored[0][0]
                selected = [item for item in scored if item[0] >= best - 0.01][
                    :MAX_FUZZY_SOURCES
                ]
                sources = [_render_source(row, similarity) for similarity, row in selected]
                alignment_status = "ambiguous" if len(selected) > 1 else "fuzzy"
            else:
                sources = []
                alignment_status = "unmatched"

        anomalies = _line_anomalies(text, mirror_names)
        uncertainties = (
            ["ocr_v1_raw_text_and_bbox_not_retained"]
            if cache_mode == "legacy_v1_fallback"
            else ["v2_exact_stitch_lineage_unavailable"]
        )
        if alignment_status == "unmatched":
            anomalies.append("provenance_unmatched")
        elif alignment_status == "ambiguous":
            uncertainties.append("multiple_possible_cache_sources")
        elif alignment_status == "fuzzy":
            uncertainties.append("fuzzy_cache_alignment")

        observations.append(
            {
                "schema_version": SCHEMA_VERSION,
                "battle_id": battle_id,
                "line_id": f"{battle_id}:L{line_no:04d}",
                "final_line_no": line_no,
                "final_log_text": text,
                "normalized_text": normalized,
                "provenance_schema_version": sidecar_schema,
                "lineage_status": (
                    "legacy_v1_candidate_alignment"
                    if cache_mode == "legacy_v1_fallback"
                    else "v2_cache_candidate_alignment"
                ),
                "alignment_status": alignment_status,
                "source_observations": sources,
                "anomalies": sorted(set(anomalies)),
                "uncertainties": sorted(set(uncertainties)),
            }
        )

    status_counts = Counter(row["alignment_status"] for row in observations)
    anomaly_counts = Counter(
        anomaly for row in observations for anomaly in row["anomalies"]
    )
    quality = {
        "schema_version": SCHEMA_VERSION,
        "battle_id": battle_id,
        "line_count": len(observations),
        "provenance_mode": cache_mode,
        "provenance_schema_version": sidecar_schema,
        "cache_observation_count": len(cache_rows),
        "alignment_status_counts": dict(sorted(status_counts.items())),
        "line_anomaly_counts": dict(sorted(anomaly_counts.items())),
        "provenance_limitations": (
            [
            "The OCR v1 cache contains corrected, side-tagged text and recognition scores only.",
            "Raw OCR text, token-level colour evidence, bounding boxes, and exact stitch lineage are unavailable.",
            "Fuzzy or ambiguous alignments are retained as uncertainty and are never promoted to exact provenance.",
            ]
            if cache_mode == "legacy_v1_fallback"
            else [
                "V2 raw text, boxes, and token evidence are available, but the exact stitch sidecar is unavailable.",
                "Cache-to-final-line matching remains candidate alignment and is not promoted to exact lineage.",
            ]
        ),
    }
    return observations, quality


def build_source_manifest(
    repo_root: Path,
    configured_manifest: dict[str, Any],
    module_paths: list[Path],
) -> dict[str, Any]:
    battle_id = configured_manifest["battle_id"]
    battle_root = repo_root / "study-battle-report" / "battles" / battle_id
    log_path = battle_root / "battle_log.txt"
    cache_path = battle_root / ".ocr_cache.json"
    images_dir = battle_root / "images"

    for path in (log_path, cache_path, images_dir):
        if not path.exists():
            raise FileNotFoundError(path)

    actual_log_hash = file_sha256(log_path)
    actual_cache_hash = file_sha256(cache_path)
    expected = configured_manifest["expected_sources"]
    if actual_log_hash != expected["battle_log_sha256"]:
        raise ValueError(
            f"battle_log.txt hash mismatch: expected {expected['battle_log_sha256']}, "
            f"got {actual_log_hash}"
        )
    if actual_cache_hash != expected["ocr_cache_sha256"]:
        raise ValueError(
            f".ocr_cache.json hash mismatch: expected {expected['ocr_cache_sha256']}, "
            f"got {actual_cache_hash}"
        )

    images = sorted(images_dir.glob("battle_detail_*.png"))
    if len(images) != expected["screenshot_count"]:
        raise ValueError(
            f"screenshot count mismatch: expected {expected['screenshot_count']}, got {len(images)}"
        )
    screenshots = [
        {
            "path": image.relative_to(repo_root).as_posix(),
            "sha256": file_sha256(image),
        }
        for image in images
    ]
    code_files = [
        {
            "path": f"study-battle-report/research/{path.name}",
            "sha256": file_sha256(path),
        }
        for path in sorted(module_paths)
    ]
    sources = {
        "configured_manifest": {
            "canonical_sha256": content_hash(configured_manifest),
        },
        "battle_log": {
            "path": log_path.relative_to(repo_root).as_posix(),
            "sha256": actual_log_hash,
        },
        "ocr_cache": {
            "path": cache_path.relative_to(repo_root).as_posix(),
            "sha256": actual_cache_hash,
        },
        "screenshots": screenshots,
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "battle_id": battle_id,
        "experiment_session_id": configured_manifest["experiment_session_id"],
        "game_metadata": configured_manifest["game_metadata"],
        "teams": configured_manifest["teams"],
        "mirror_names": sorted(configured_manifest["mirror_names"]),
        "sources": sources,
        "source_set_hash": content_hash(sources),
        "pipeline_code": code_files,
        "pipeline_code_hash": content_hash(code_files),
        "audit_notes": configured_manifest["audit_notes"],
    }
