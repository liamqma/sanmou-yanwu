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
_ENTITY_RE = re.compile(r"\[(?:(我方|敌方):)?([^\[\]]+)\]")


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


def _v2_cache_frame_hashes(
    cache_path: Path, battle_id: str | None = None
) -> dict[str, str]:
    with cache_path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict) or value.get("schema_version") != "sanmou-ocr-cache-v2":
        raise ValueError("v2 exact lineage requires a v2 OCR cache")
    if battle_id is not None and value.get("battle_id") != battle_id:
        raise ValueError("v2 OCR cache battle_id mismatch")
    frames = value.get("frames")
    if not isinstance(frames, dict):
        raise ValueError("v2 OCR cache frames must be an object")
    hashes: dict[str, str] = {}
    for image, frame in frames.items():
        if not isinstance(image, str) or not isinstance(frame, dict):
            raise ValueError("v2 OCR cache frame metadata is invalid")
        image_hash = frame.get("image_sha256")
        if not isinstance(image_hash, str):
            raise ValueError(f"v2 OCR cache image_sha256 is invalid for {image}")
        hashes[image] = image_hash
    return hashes


def _v2_sidecar_frame_hashes(sidecar: dict[str, Any]) -> dict[str, str]:
    frames = sidecar.get("frames")
    if not isinstance(frames, list):
        raise ValueError("battle-log provenance frames must be a list")
    hashes: dict[str, str] = {}
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError("battle-log provenance frame metadata is invalid")
        image = frame.get("image")
        image_hash = frame.get("image_sha256")
        if not isinstance(image, str) or not isinstance(image_hash, str):
            raise ValueError("battle-log provenance frame source is invalid")
        if image in hashes:
            raise ValueError(f"battle-log provenance contains duplicate frame {image}")
        hashes[image] = image_hash
    return hashes


def _v2_cache_observations(
    cache_path: Path, battle_id: str
) -> dict[str, dict[str, Any]]:
    with cache_path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict) or value.get("schema_version") != "sanmou-ocr-cache-v2":
        raise ValueError("v2 exact lineage requires a v2 OCR cache")
    if value.get("battle_id") != battle_id:
        raise ValueError("v2 OCR cache battle_id mismatch")
    frames = value.get("frames")
    if not isinstance(frames, dict):
        raise ValueError("v2 OCR cache frames must be an object")

    observations: dict[str, dict[str, Any]] = {}
    for image, frame in frames.items():
        if not isinstance(image, str) or not isinstance(frame, dict):
            raise ValueError("v2 OCR cache frame metadata is invalid")
        frame_observations = frame.get("observations")
        if not isinstance(frame_observations, list):
            raise ValueError(f"v2 OCR observations for {image} must be a list")
        for observation in frame_observations:
            if not isinstance(observation, dict):
                raise ValueError(f"v2 OCR observation for {image} is invalid")
            observation_id = observation.get("observation_id")
            if not isinstance(observation_id, str) or not observation_id:
                raise ValueError(f"v2 OCR observation id for {image} is invalid")
            if observation_id in observations:
                raise ValueError(f"duplicate v2 OCR observation id {observation_id}")
            observations[observation_id] = {
                "image": image,
                "observation": observation,
            }
    return observations


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
                        "processing": observation.get("processing"),
                        "observation_provenance_status": observation.get(
                            "provenance_status"
                        ),
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
                    "processing": None,
                    "observation_provenance_status": None,
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


def _entity_side_evidence(
    sources: list[dict[str, Any]],
) -> tuple[set[tuple[str, str]], set[tuple[str, str]], bool]:
    direct: set[tuple[str, str]] = set()
    reused: set[tuple[str, str]] = set()
    legacy = any(
        source.get("provenance_kind") == "legacy_v1_candidate"
        for source in sources
    )
    for source in sources:
        processing = source.get("processing")
        is_reused = (
            source.get("reused_from_observation_id") is not None
            or (
                isinstance(processing, dict)
                and processing.get("near_duplicate_reuse") is True
            )
        )
        destination = reused if is_reused else direct
        for token in source.get("name_tokens", []):
            side = token.get("decision")
            name = token.get("token_text")
            if side in {"我方", "敌方"} and isinstance(name, str):
                destination.add((side, name))
    return direct, reused, legacy


def _fallback_backfilled_entity_indices(
    text: str,
    sources: list[dict[str, Any]],
    lineage: dict[str, Any],
    transformations: dict[str, dict[str, Any]],
) -> set[int]:
    inferred_indices: set[int] = set()
    needs_legacy_fallback = False
    for transform_id in lineage.get("transformation_ids", []):
        transformation = transformations.get(transform_id)
        if (
            transformation is None
            or transformation.get("stage") != "side_backfill"
            or transformation.get("details", {}).get("text_changed") is not True
        ):
            continue
        details = transformation.get("details", {})
        mapped_indices = details.get("inferred_entity_indices")
        if mapped_indices is None:
            needs_legacy_fallback = True
            continue
        if not isinstance(mapped_indices, list) or not all(
            isinstance(index, int) and index >= 0 for index in mapped_indices
        ):
            raise ValueError("side_backfill inferred_entity_indices are invalid")
        inferred_indices.update(mapped_indices)

    entities = _ENTITY_RE.findall(text)
    if any(index >= len(entities) for index in inferred_indices):
        raise ValueError("side_backfill inferred_entity_indices are out of range")
    if needs_legacy_fallback:
        positional_candidates: list[set[int]] = []
        final_names = [name for _, name in entities]
        for source in sources:
            source_text = source.get("cache_processed_text")
            if not isinstance(source_text, str):
                continue
            source_entities = _ENTITY_RE.findall(source_text)
            if (
                normalize_for_alignment(source_text) != normalize_for_alignment(text)
                or [name for _, name in source_entities] != final_names
            ):
                continue
            positional_candidates.append(
                {
                    entity_index
                    for entity_index, (
                        (source_side, _),
                        (final_side, _),
                    ) in enumerate(zip(source_entities, entities, strict=True))
                    if final_side and source_side != final_side
                }
            )
        if positional_candidates:
            distinct_candidates = {
                tuple(sorted(candidate)) for candidate in positional_candidates
            }
            if len(distinct_candidates) != 1:
                raise ValueError(
                    "legacy side_backfill sources disagree on inferred entity occurrences"
                )
            inferred_indices.update(positional_candidates[0])
        else:
            direct, reused, _ = _entity_side_evidence(sources)
            inferred_indices.update(
                entity_index
                for entity_index, (side, name) in enumerate(entities)
                if side and (side, name) not in direct and (side, name) not in reused
            )
    return inferred_indices


def _derived_entity_side_provenance(
    text: str,
    sources: list[dict[str, Any]],
    *,
    inferred_entity_indices: set[int] | None = None,
) -> list[dict[str, Any]]:
    direct, reused, legacy = _entity_side_evidence(sources)
    inferred_indices = inferred_entity_indices or set()

    result: list[dict[str, Any]] = []
    for entity_index, (side, name) in enumerate(_ENTITY_RE.findall(text)):
        displayed_side = side or None
        if displayed_side is None:
            side_source = "missing"
        elif entity_index in inferred_indices:
            side_source = "inferred_side_backfill"
        elif (side, name) in direct:
            side_source = "direct_token_colour"
        elif (side, name) in reused:
            side_source = "near_duplicate_reuse"
        elif legacy:
            side_source = "legacy_unverifiable"
        else:
            side_source = "unresolved"
        result.append(
            {
                "entity_index": entity_index,
                "name": name,
                "displayed_side": displayed_side,
                "side_source": side_source,
            }
        )
    return result


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
        "processing": row["processing"],
        "observation_provenance_status": row["observation_provenance_status"],
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
        "processing": observation.get("processing"),
        "observation_provenance_status": observation.get("provenance_status"),
        "provenance_kind": "v2_exact_lineage",
        "reused_from_observation_id": observation.get(
            "reused_from_observation_id"
        ),
    }


def _v2_transformations(sidecar: dict[str, Any]) -> dict[str, dict[str, Any]]:
    values = sidecar.get("transformations")
    if not isinstance(values, list):
        raise ValueError("battle-log provenance transformations must be a list")
    transformations: dict[str, dict[str, Any]] = {}
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("battle-log provenance transformation is invalid")
        transform_id = value.get("transform_id")
        mapping_status = value.get("mapping_status")
        input_node_ids = value.get("input_node_ids")
        output_node_ids = value.get("output_node_ids")
        details = value.get("details")
        if not isinstance(transform_id, str) or not transform_id:
            raise ValueError("battle-log provenance transform_id is invalid")
        if transform_id in transformations:
            raise ValueError(f"duplicate battle-log provenance transform {transform_id}")
        if mapping_status not in {"exact", "heuristic", "unresolved"}:
            raise ValueError(f"invalid mapping_status for transformation {transform_id}")
        if not isinstance(input_node_ids, list) or not all(
            isinstance(node_id, str) and node_id for node_id in input_node_ids
        ):
            raise ValueError(f"invalid input nodes for transformation {transform_id}")
        if not isinstance(output_node_ids, list) or not all(
            isinstance(node_id, str) and node_id for node_id in output_node_ids
        ):
            raise ValueError(f"invalid output nodes for transformation {transform_id}")
        if not isinstance(details, dict):
            raise ValueError(f"invalid details for transformation {transform_id}")
        transformations[transform_id] = value
    return transformations


def _verified_v2_lineage_sources(
    source_values: Any,
    cache_observations: dict[str, dict[str, Any]],
    line_no: int,
) -> list[dict[str, Any]]:
    if not isinstance(source_values, list):
        raise ValueError(f"battle-log provenance sources invalid at line {line_no}")
    sources: list[dict[str, Any]] = []
    seen: set[str] = set()
    for value in source_values:
        if not isinstance(value, dict):
            raise ValueError(f"battle-log provenance source invalid at line {line_no}")
        observation_id = value.get("observation_id")
        image = value.get("image")
        if not isinstance(observation_id, str) or observation_id in seen:
            raise ValueError(
                f"battle-log provenance observation ids invalid at line {line_no}"
            )
        cached = cache_observations.get(observation_id)
        if cached is None or image != cached["image"]:
            raise ValueError(
                f"battle-log provenance source is absent from cache at line {line_no}"
            )
        embedded_observation = {
            key: item for key, item in value.items() if key != "image"
        }
        if embedded_observation != cached["observation"]:
            raise ValueError(
                f"battle-log provenance source differs from cache at line {line_no}"
            )
        seen.add(observation_id)
        sources.append(_render_v2_lineage_source(value))
    return sources


def _recomputed_lineage_status(
    lineage: dict[str, Any],
    sources: list[dict[str, Any]],
    transformations: dict[str, dict[str, Any]],
    line_no: int,
) -> str:
    observation_ids = [source["observation_id"] for source in sources]
    declared_observation_ids = lineage.get("observation_ids")
    if (
        not isinstance(declared_observation_ids, list)
        or not all(isinstance(value, str) for value in declared_observation_ids)
        or len(declared_observation_ids) != len(set(declared_observation_ids))
        or set(declared_observation_ids) != set(observation_ids)
    ):
        raise ValueError(
            f"battle-log provenance observation_ids mismatch at line {line_no}"
        )

    transform_ids = lineage.get("transformation_ids")
    if (
        not isinstance(transform_ids, list)
        or not all(isinstance(value, str) for value in transform_ids)
        or len(transform_ids) != len(set(transform_ids))
    ):
        raise ValueError(
            f"battle-log provenance transformation_ids invalid at line {line_no}"
        )
    referenced: dict[str, dict[str, Any]] = {}
    output_producers: dict[str, str] = {}
    for transform_id in transform_ids:
        transformation = transformations.get(transform_id)
        if transformation is None:
            raise ValueError(
                f"battle-log provenance references missing transform {transform_id}"
            )
        referenced[transform_id] = transformation
        for node_id in transformation["output_node_ids"]:
            if node_id in output_producers:
                raise ValueError(
                    f"battle-log provenance node {node_id} has multiple producers"
                )
            output_producers[node_id] = transform_id

    lineage_node_id = lineage.get("lineage_node_id")
    if not isinstance(lineage_node_id, str) or not lineage_node_id:
        raise ValueError(f"battle-log provenance lineage node invalid at line {line_no}")
    source_nodes = {
        f"observation:{observation_id}" for observation_id in observation_ids
    }
    used_transforms: set[str] = set()
    used_sources: set[str] = set()
    visiting: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in source_nodes:
            used_sources.add(node_id)
            return
        if node_id in visiting:
            raise ValueError(f"battle-log provenance lineage cycle at line {line_no}")
        transform_id = output_producers.get(node_id)
        if transform_id is None:
            raise ValueError(
                f"battle-log provenance lineage node {node_id} is disconnected at line {line_no}"
            )
        if transform_id in used_transforms:
            return
        visiting.add(node_id)
        used_transforms.add(transform_id)
        for input_node_id in referenced[transform_id]["input_node_ids"]:
            visit(input_node_id)
        visiting.remove(node_id)

    visit(lineage_node_id)
    if used_transforms != set(transform_ids) or used_sources != source_nodes:
        raise ValueError(f"battle-log provenance lineage graph mismatch at line {line_no}")

    unresolved = False
    heuristic = False
    for transformation in referenced.values():
        if transformation["mapping_status"] == "unresolved":
            unresolved = True
        elif transformation["mapping_status"] == "heuristic":
            heuristic = True
    for source in sources:
        processing = source.get("processing")
        correction = (
            processing.get("canonical_correction_applied")
            if isinstance(processing, dict)
            else None
        )
        if not isinstance(correction, bool):
            unresolved = True
        elif correction:
            heuristic = True
        if (
            source.get("reused_from_observation_id") is not None
            or (
                isinstance(processing, dict)
                and processing.get("near_duplicate_reuse") is True
            )
        ):
            heuristic = True
        observation_status = source.get("observation_provenance_status")
        if observation_status == "near_duplicate_reuse_v2":
            heuristic = True
        elif observation_status != "complete_observation_v2":
            unresolved = True

    if unresolved:
        return "unresolved_transform_mapping"
    if heuristic:
        return "deterministic_heuristic_v2"
    return "deterministic_v2"


def _align_from_v2_sidecar(
    battle_id: str,
    log_path: Path,
    cache_path: Path,
    sidecar: dict[str, Any],
    mirror_names: set[str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if sidecar.get("schema_version") != "sanmou-battle-log-provenance-v2":
        raise ValueError("unsupported battle-log provenance sidecar schema")
    if sidecar.get("battle_id") != battle_id:
        raise ValueError("battle-log provenance sidecar battle_id mismatch")
    if sidecar.get("observation_provenance_complete") is not True:
        raise ValueError("v2 exact lineage requires complete observation provenance")
    expected_cache_hash = sidecar.get("cache_file_sha256")
    if not isinstance(expected_cache_hash, str):
        raise ValueError(
            "complete battle-log provenance sidecar requires cache_file_sha256"
        )
    actual_cache_hash = file_sha256(cache_path)
    if expected_cache_hash != actual_cache_hash:
        raise ValueError(
            "battle-log provenance cache_file_sha256 mismatch: "
            f"expected {expected_cache_hash}, got {actual_cache_hash}"
        )
    if sidecar.get("cache_schema_version") != "sanmou-ocr-cache-v2":
        raise ValueError("v2 exact lineage requires a v2 sidecar cache schema")
    cache_frame_hashes = _v2_cache_frame_hashes(cache_path, battle_id)
    cache_observations = _v2_cache_observations(cache_path, battle_id)
    sidecar_frame_hashes = _v2_sidecar_frame_hashes(sidecar)
    if cache_frame_hashes != sidecar_frame_hashes:
        raise ValueError(
            "v2 OCR cache and battle-log provenance frame metadata mismatch"
        )
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

    transformations = _v2_transformations(sidecar)
    observations: list[dict[str, Any]] = []
    for line_no, (text, lineage) in enumerate(
        zip(log_lines, final_lineage, strict=True), 1
    ):
        if not isinstance(lineage, dict):
            raise ValueError(f"battle-log provenance lineage invalid at line {line_no}")
        if lineage.get("line_number") != line_no or lineage.get("text") != text:
            raise ValueError(f"battle-log provenance text mismatch at line {line_no}")
        sources = _verified_v2_lineage_sources(
            lineage.get("source_observations", []), cache_observations, line_no
        )
        recomputed_status = _recomputed_lineage_status(
            lineage, sources, transformations, line_no
        )
        declared_status = lineage.get("lineage_status")
        status_rank = {
            "deterministic_v2": 0,
            "deterministic_heuristic_v2": 1,
            "unresolved_transform_mapping": 2,
        }
        if declared_status not in status_rank:
            lineage_status = "unresolved_transform_mapping"
        else:
            lineage_status = max(
                (recomputed_status, declared_status),
                key=status_rank.__getitem__,
            )
        anomalies = _line_anomalies(text, mirror_names)
        uncertainties: list[str] = []
        if declared_status != recomputed_status:
            uncertainties.append("declared_lineage_status_mismatch")
        correction_flags = [
            source.get("processing", {}).get("canonical_correction_applied")
            if isinstance(source.get("processing"), dict)
            else None
            for source in sources
        ]
        reuse_flags = [
            source.get("reused_from_observation_id") is not None
            or (
                isinstance(source.get("processing"), dict)
                and source["processing"].get("near_duplicate_reuse") is True
            )
            for source in sources
        ]
        if any(not isinstance(flag, bool) for flag in correction_flags):
            lineage_status = "unresolved_transform_mapping"
            uncertainties.append("canonical_correction_status_missing")
        elif any(flag is True for flag in correction_flags):
            if lineage_status == "deterministic_v2":
                lineage_status = "deterministic_heuristic_v2"
            uncertainties.append("canonical_ocr_correction_applied")
        if any(reuse_flags):
            if lineage_status == "deterministic_v2":
                lineage_status = "deterministic_heuristic_v2"
            uncertainties.append("near_duplicate_ocr_reuse")
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
        inferred_entity_indices = _fallback_backfilled_entity_indices(
            text, sources, lineage, transformations
        )
        entity_side_provenance = _derived_entity_side_provenance(
            text,
            sources,
            inferred_entity_indices=inferred_entity_indices,
        )
        provided_side_provenance = lineage.get("entity_side_provenance")
        if (
            provided_side_provenance is not None
            and provided_side_provenance != entity_side_provenance
        ):
            raise ValueError(
                f"battle-log provenance entity side mapping mismatch at line {line_no}"
            )
        side_sources = {
            item.get("side_source")
            for item in entity_side_provenance
            if isinstance(item, dict)
        }
        if "inferred_side_backfill" in side_sources:
            uncertainties.append("one_or_more_entity_sides_inferred")
        if side_sources & {
            "legacy_unverifiable",
            "near_duplicate_reuse",
            "unresolved",
        }:
            uncertainties.append("one_or_more_entity_side_sources_unverified")
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
                "entity_side_provenance": entity_side_provenance,
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
                battle_id, log_path, cache_path, sidecar, mirror_names
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
        entity_side_provenance = _derived_entity_side_provenance(text, sources)
        if any(
            item["side_source"] != "direct_token_colour"
            and item["side_source"] != "missing"
            for item in entity_side_provenance
        ):
            uncertainties.append("one_or_more_entity_side_sources_unverified")

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
                "entity_side_provenance": entity_side_provenance,
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
    provenance_path = battle_root / "battle_log.provenance.json"
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

    expected_provenance_hash = expected.get("battle_log_provenance_sha256")
    actual_provenance_hash: str | None = None
    pinned_sidecar: dict[str, Any] | None = None
    if "battle_log_provenance_sha256" in expected:
        if not isinstance(expected_provenance_hash, str):
            raise ValueError("battle_log_provenance_sha256 must be a string")
        if not provenance_path.is_file():
            raise FileNotFoundError(provenance_path)
        actual_provenance_hash = file_sha256(provenance_path)
        if actual_provenance_hash != expected_provenance_hash:
            raise ValueError(
                "battle_log.provenance.json hash mismatch: "
                f"expected {expected_provenance_hash}, got {actual_provenance_hash}"
            )
        with provenance_path.open("r", encoding="utf-8") as handle:
            loaded_sidecar = json.load(handle)
        if not isinstance(loaded_sidecar, dict):
            raise ValueError("battle_log.provenance.json must be an object")
        pinned_sidecar = loaded_sidecar
    elif provenance_path.is_file():
        try:
            with provenance_path.open("r", encoding="utf-8") as handle:
                unpinned_sidecar = json.load(handle)
        except (OSError, json.JSONDecodeError):
            unpinned_sidecar = None
        if (
            isinstance(unpinned_sidecar, dict)
            and unpinned_sidecar.get("schema_version")
            == "sanmou-battle-log-provenance-v2"
            and unpinned_sidecar.get("observation_provenance_complete") is True
        ):
            raise ValueError(
                "complete battle_log.provenance.json is unpinned; configure "
                "expected_sources.battle_log_provenance_sha256"
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
    if (
        pinned_sidecar is not None
        and pinned_sidecar.get("observation_provenance_complete") is True
    ):
        current_frame_hashes = {
            image.name: screenshot["sha256"]
            for image, screenshot in zip(images, screenshots, strict=True)
        }
        cache_frame_hashes = _v2_cache_frame_hashes(cache_path, battle_id)
        sidecar_frame_hashes = _v2_sidecar_frame_hashes(pinned_sidecar)
        if current_frame_hashes != cache_frame_hashes:
            raise ValueError(
                "current screenshot names or SHA-256 values do not match v2 OCR cache frames"
            )
        if current_frame_hashes != sidecar_frame_hashes:
            raise ValueError(
                "current screenshot names or SHA-256 values do not match v2 provenance frames"
            )
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
    if actual_provenance_hash is not None:
        sources["battle_log_provenance"] = {
            "path": provenance_path.relative_to(repo_root).as_posix(),
            "sha256": actual_provenance_hash,
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
