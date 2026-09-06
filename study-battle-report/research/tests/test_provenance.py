from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from provenance import align_log_lines
from schema import validate_line_observation


FIXTURES = Path(__file__).parent / "fixtures"


def _write_json(path: Path, value: dict) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def _write_v2_alignment_contract(
    tmp_path: Path,
) -> tuple[Path, Path, Path, dict]:
    battle_id = "v2-contract"
    image = "battle_detail_001.png"
    text = "[甲]发动战法"
    log_path = tmp_path / "battle_log.txt"
    cache_path = tmp_path / ".ocr_cache.json"
    sidecar_path = tmp_path / "battle_log.provenance.json"
    log_path.write_bytes((text + "\n").encode("utf-8"))

    token_evidence = {
        "token_index": 0,
        "token_text": "甲",
        "span": [0, 3],
        "decision": None,
        "confidence_status": "ambiguous_colour",
        "blue_pixels": 40,
        "red_pixels": 40,
        "dominance": 0.5,
        "sample_region": [0, 0, 30, 20],
        "evidence_frame": image,
        "method": "proportional-text-box-v1",
        "token_box_is_approximate": True,
    }
    observation = {
        "observation_id": f"{image}:o0001",
        "raw_text": text,
        "processed_text": text,
        "bbox": [[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
        "score": 0.99,
        "name_tokens": [token_evidence],
        "provenance_status": "complete_observation_v2",
        "reused_from_observation_id": None,
        "processing": {
            "canonical_correction_applied": False,
            "token_side_method": "proportional-text-box-v1",
            "token_side_geometry": "approximate_from_line_box",
        },
    }
    cache = {
        "schema_version": "sanmou-ocr-cache-v2",
        "battle_id": battle_id,
        "ocr_config": {},
        "frames": {
            image: {
                "image_sha256": "1" * 64,
                "crop_dhash": "2" * 64,
                "near_duplicate_of": None,
                "observations": [observation],
                "provenance_status": "direct_ocr_v2",
            }
        },
    }
    _write_json(cache_path, cache)
    sidecar_observation = {**observation, "image": image}
    sidecar = {
        "schema_version": "sanmou-battle-log-provenance-v2",
        "battle_id": battle_id,
        "cache_schema_version": "sanmou-ocr-cache-v2",
        "observation_provenance_complete": True,
        "cache_file_sha256": hashlib.sha256(cache_path.read_bytes()).hexdigest(),
        "battle_log_sha256": hashlib.sha256(log_path.read_bytes()).hexdigest(),
        "token_side_calibration": {
            "method": "proportional-text-box-v1",
            "geometry": "approximate_from_whole_line_box",
            "claim": "calibrated_pixel_counts_with_conservative_unknown_decision",
        },
        "frames": [
            {
                "image": image,
                "image_sha256": "1" * 64,
                "crop_dhash": "2" * 64,
                "near_duplicate_of": None,
                "observation_ids": [observation["observation_id"]],
            }
        ],
        "transformations": [],
        "final_lines": [
            {
                "line_number": 1,
                "text": text,
                "lineage_node_id": "n000001",
                "lineage_status": "deterministic_heuristic_v2",
                "observation_ids": [observation["observation_id"]],
                "transformation_ids": ["t000001"],
                "source_observations": [sidecar_observation],
            }
        ],
        "summary": {"frame_count": 1, "final_line_count": 1},
        "limitations": [
            "Stitch deduplication is deterministic but fuzzy and remains uncertain."
        ],
    }
    _write_json(sidecar_path, sidecar)
    return log_path, cache_path, sidecar_path, sidecar


def test_alignment_preserves_final_text_and_missing_v1_provenance() -> None:
    lines, quality = align_log_lines(
        "fixture",
        FIXTURES / "log_excerpt.txt",
        FIXTURES / "cache_excerpt.json",
        {"乐进", "糜夫人"},
    )

    assert len(lines) == 9
    assert lines[1]["final_log_text"] == "[我方:夏侯渊]的【造成伤害】提升14.00%(14.00%)"
    assert lines[1]["final_line_no"] == 2
    assert lines[1]["alignment_status"] == "exact"
    assert lines[1]["source_observations"][0]["ocr_score"] == 0.98
    assert lines[1]["source_observations"][0]["raw_ocr_text"] is None
    assert lines[1]["source_observations"][0]["bbox"] is None
    assert "ocr_v1_raw_text_and_bbox_not_retained" in lines[1]["uncertainties"]

    unknown_source = lines[7]
    assert unknown_source["final_log_text"] == "完全无法解析的碎片"
    assert unknown_source["alignment_status"] == "unmatched"
    assert "provenance_unmatched" in unknown_source["anomalies"]
    assert quality["line_count"] == 9
    for line in lines:
        validate_line_observation(line)


def test_alignment_marks_mirror_and_same_side_attack_without_rewriting() -> None:
    lines, _ = align_log_lines(
        "fixture",
        FIXTURES / "log_excerpt.txt",
        FIXTURES / "cache_excerpt.json",
        {"乐进", "糜夫人"},
    )

    attack = lines[5]
    assert attack["final_log_text"] == "[我方:糜夫人]对[我方:乐进]发动普通攻击"
    assert "mirror_side_ambiguous" in attack["anomalies"]
    assert "same_side_attack_suspect" in attack["anomalies"]


def test_identical_exact_text_from_multiple_cache_sources_is_ambiguous(
    tmp_path: Path,
) -> None:
    text = "[我方:夏侯渊]的【造成伤害】提升14.00%(14.00%)"
    log_path = tmp_path / "battle_log.txt"
    cache_path = tmp_path / ".ocr_cache.json"
    log_path.write_text(text + "\n", encoding="utf-8")
    cache_path.write_text(
        json.dumps(
            {
                "battle_detail_001.png": [[text, 0.99]],
                "battle_detail_002.png": [[text, 0.98]],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    lines, quality = align_log_lines(
        "duplicate-source", log_path, cache_path, set()
    )

    assert lines[0]["alignment_status"] == "ambiguous"
    assert [source["image"] for source in lines[0]["source_observations"]] == [
        "battle_detail_001.png",
        "battle_detail_002.png",
    ]
    assert "multiple_possible_cache_sources" in lines[0]["uncertainties"]
    assert quality["alignment_status_counts"] == {"ambiguous": 1}


def test_complete_v2_sidecar_preserves_exact_lineage_and_uncertainty(
    tmp_path: Path,
) -> None:
    log_path, cache_path, sidecar_path, sidecar = _write_v2_alignment_contract(
        tmp_path
    )

    lines, quality = align_log_lines(
        sidecar["battle_id"], log_path, cache_path, set(), sidecar_path
    )

    assert len(lines) == 1
    line = lines[0]
    source = line["source_observations"][0]
    assert line["lineage_status"] == "deterministic_heuristic_v2"
    assert source["provenance_kind"] == "v2_exact_lineage"
    assert source["raw_ocr_text"] == "[甲]发动战法"
    assert source["bbox"] == [
        [0.0, 0.0],
        [100.0, 0.0],
        [100.0, 20.0],
        [0.0, 20.0],
    ]
    assert source["name_tokens"][0]["decision"] is None
    assert "deterministic_fuzzy_stitch_decision" in line["uncertainties"]
    assert "token_side_geometry_approximate" in line["uncertainties"]
    assert "one_or_more_token_sides_unresolved" in line["uncertainties"]
    assert quality["provenance_mode"] == "v2_exact_lineage"
    assert (
        quality["provenance_schema_version"]
        == "sanmou-battle-log-provenance-v2"
    )
    validate_line_observation(line)


def test_complete_v2_sidecar_downgrades_canonical_repair_to_heuristic(
    tmp_path: Path,
) -> None:
    log_path, cache_path, sidecar_path, sidecar = _write_v2_alignment_contract(
        tmp_path
    )
    cache = json.loads(cache_path.read_text(encoding="utf-8"))
    cache_observation = cache["frames"]["battle_detail_001.png"]["observations"][0]
    cache_observation["processing"]["canonical_correction_applied"] = True
    _write_json(cache_path, cache)
    source = sidecar["final_lines"][0]["source_observations"][0]
    source["processing"]["canonical_correction_applied"] = True
    sidecar["final_lines"][0]["lineage_status"] = "deterministic_v2"
    sidecar["cache_file_sha256"] = hashlib.sha256(cache_path.read_bytes()).hexdigest()
    _write_json(sidecar_path, sidecar)

    lines, _ = align_log_lines(
        sidecar["battle_id"], log_path, cache_path, set(), sidecar_path
    )

    line = lines[0]
    assert line["lineage_status"] == "deterministic_heuristic_v2"
    assert "canonical_ocr_correction_applied" in line["uncertainties"]
    assert line["source_observations"][0]["processing"][
        "canonical_correction_applied"
    ] is True
    validate_line_observation(line)


def test_complete_v2_sidecar_without_log_hash_is_rejected(tmp_path: Path) -> None:
    log_path, cache_path, sidecar_path, sidecar = _write_v2_alignment_contract(
        tmp_path
    )
    del sidecar["battle_log_sha256"]
    _write_json(sidecar_path, sidecar)

    with pytest.raises(ValueError, match="requires battle_log_sha256"):
        align_log_lines(
            sidecar["battle_id"], log_path, cache_path, set(), sidecar_path
        )


def test_complete_v2_sidecar_with_mismatched_log_hash_is_rejected(
    tmp_path: Path,
) -> None:
    log_path, cache_path, sidecar_path, sidecar = _write_v2_alignment_contract(
        tmp_path
    )
    sidecar["battle_log_sha256"] = "0" * 64
    _write_json(sidecar_path, sidecar)

    with pytest.raises(ValueError, match="battle_log_sha256 mismatch"):
        align_log_lines(
            sidecar["battle_id"], log_path, cache_path, set(), sidecar_path
        )


def test_complete_v2_sidecar_without_cache_hash_is_rejected(tmp_path: Path) -> None:
    log_path, cache_path, sidecar_path, sidecar = _write_v2_alignment_contract(
        tmp_path
    )
    del sidecar["cache_file_sha256"]
    _write_json(sidecar_path, sidecar)

    with pytest.raises(ValueError, match="requires cache_file_sha256"):
        align_log_lines(
            sidecar["battle_id"], log_path, cache_path, set(), sidecar_path
        )


def test_complete_v2_sidecar_with_mismatched_cache_hash_is_rejected(
    tmp_path: Path,
) -> None:
    log_path, cache_path, sidecar_path, sidecar = _write_v2_alignment_contract(
        tmp_path
    )
    sidecar["cache_file_sha256"] = "0" * 64
    _write_json(sidecar_path, sidecar)

    with pytest.raises(ValueError, match="cache_file_sha256 mismatch"):
        align_log_lines(
            sidecar["battle_id"], log_path, cache_path, set(), sidecar_path
        )


def test_incomplete_v2_sidecar_falls_back_to_cache_candidate_alignment(
    tmp_path: Path,
) -> None:
    log_path, cache_path, sidecar_path, sidecar = _write_v2_alignment_contract(
        tmp_path
    )
    sidecar["observation_provenance_complete"] = False
    del sidecar["battle_log_sha256"]
    sidecar["final_lines"][0]["source_observations"][0]["raw_text"] = (
        "untrusted sidecar text"
    )
    _write_json(sidecar_path, sidecar)

    lines, quality = align_log_lines(
        sidecar["battle_id"], log_path, cache_path, set(), sidecar_path
    )

    line = lines[0]
    source = line["source_observations"][0]
    assert quality["provenance_mode"] == "v2_cache_without_exact_sidecar"
    assert (
        quality["provenance_schema_version"]
        == "sanmou-battle-log-provenance-v2"
    )
    assert line["lineage_status"] == "v2_cache_candidate_alignment"
    assert source["provenance_kind"] == "v2_cache_candidate"
    assert source["raw_ocr_text"] == "[甲]发动战法"
    assert source["name_tokens"][0]["decision"] is None
    assert "v2_exact_stitch_lineage_unavailable" in line["uncertainties"]
    validate_line_observation(line)
