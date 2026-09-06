from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest


MODULE_DIR = Path(__file__).resolve().parent
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

import ocr_battle_log as ocr  # noqa: E402


def _observation(
    observation_id: str, text: str, *, canonical_correction_applied: bool = False
) -> dict:
    return {
        "observation_id": observation_id,
        "raw_text": text,
        "processed_text": text,
        "bbox": [[0.0, 0.0], [100.0, 0.0], [100.0, 20.0], [0.0, 20.0]],
        "score": 0.99,
        "name_tokens": [],
        "provenance_status": "complete_observation_v2",
        "reused_from_observation_id": None,
        "processing": {
            "canonical_correction_applied": canonical_correction_applied,
            "token_side_method": ocr.TOKEN_COLOR_METHOD,
            "token_side_geometry": "approximate_from_line_box",
        },
    }


def _frame(observations: list[dict]) -> dict:
    return {
        "image_sha256": "0" * 64,
        "crop_dhash": "0" * 64,
        "near_duplicate_of": None,
        "observations": observations,
        "provenance_status": "direct_ocr_v2",
    }


def test_legacy_v1_cache_is_read_without_inventing_provenance(tmp_path: Path) -> None:
    cache_path = tmp_path / ".ocr_cache.json"
    cache_path.write_text(
        json.dumps({"battle_detail_001.png": [["第一回合", 0.98]]}),
        encoding="utf-8",
    )

    cache, source_schema = ocr.load_cache_document(str(cache_path), "legacy")
    observation = cache["frames"]["battle_detail_001.png"]["observations"][0]
    lines, provenance, _ = ocr.build_log_and_provenance(
        cache, ["battle_detail_001.png"], [], "legacy"
    )

    assert source_schema == "legacy-v1"
    assert observation["raw_text"] is None
    assert observation["bbox"] is None
    assert observation["name_tokens"] == []
    assert lines == ["第一回合"]
    assert provenance["observation_provenance_complete"] is False
    assert provenance["final_lines"][0]["lineage_status"].startswith("legacy_v1")
    assert provenance["final_lines"][0]["source_observations"][0]["raw_text"] is None


def test_v2_cache_round_trip_preserves_observation_contract(tmp_path: Path) -> None:
    cache_path = tmp_path / ".ocr_cache.json"
    cache = ocr.new_v2_cache_document("round-trip")
    cache["frames"]["battle_detail_001.png"] = _frame(
        [_observation("battle_detail_001.png:o0001", "第一回合")]
    )

    ocr.write_cache_document(str(cache_path), cache)
    loaded, source_schema = ocr.load_cache_document(str(cache_path), "round-trip")

    assert source_schema == ocr.OCR_CACHE_SCHEMA_V2
    assert loaded == cache
    assert loaded["frames"]["battle_detail_001.png"]["observations"][0][
        "raw_text"
    ] == "第一回合"


def test_per_token_colour_can_record_mixed_sides() -> None:
    image = np.zeros((80, 800, 3), dtype=np.uint8)
    box = np.array([[0, 20], [800, 20], [800, 40], [0, 40]], dtype=np.float32)
    text = "[甲]由于[乙]"
    image[14:62, 0:300] = (255, 0, 0)
    image[14:62, 500:800] = (0, 0, 255)

    evidence = ocr.sample_name_token_sides(text, box, image, "mixed.png")
    processed = ocr.tag_name_tokens(text, evidence)

    assert [item["decision"] for item in evidence] == ["我方", "敌方"]
    assert all(item["token_box_is_approximate"] for item in evidence)
    assert processed == "[我方:甲]由于[敌方:乙]"


def test_ambiguous_token_colour_remains_unknown() -> None:
    image = np.zeros((80, 400, 3), dtype=np.uint8)
    box = np.array([[0, 20], [400, 20], [400, 40], [0, 40]], dtype=np.float32)
    image[14:62, 0:200] = (255, 0, 0)
    image[14:62, 200:400] = (0, 0, 255)

    evidence = ocr.sample_name_token_sides("[甲]", box, image, "ambiguous.png")

    assert evidence[0]["decision"] is None
    assert evidence[0]["confidence_status"] == "ambiguous_colour"
    assert ocr.tag_name_tokens("[甲]", evidence) == "[甲]"


def test_canonical_ocr_correction_is_retained_as_heuristic_lineage() -> None:
    cache = ocr.new_v2_cache_document("corrected")
    observation = _observation(
        "battle_detail_001.png:o0001",
        "[我方:夏侯渊]损失了兵力100（900）",
        canonical_correction_applied=True,
    )
    observation["raw_text"] = "[我方:夏候渊]损失了兵力100（900）"
    cache["frames"]["battle_detail_001.png"] = _frame([observation])

    _, provenance, _ = ocr.build_log_and_provenance(
        cache, ["battle_detail_001.png"], ["夏侯渊"], "corrected"
    )

    final_line = provenance["final_lines"][0]
    assert final_line["lineage_status"] == "deterministic_heuristic_v2"
    assert final_line["source_observations"][0]["processing"][
        "canonical_correction_applied"
    ] is True


def test_fragment_merge_and_stitch_dedup_preserve_observation_lineage() -> None:
    cache = ocr.new_v2_cache_document("lineage")
    cache["frames"]["battle_detail_001.png"] = _frame(
        [
            _observation("battle_detail_001.png:o0001", "[我方:甲]"),
            _observation("battle_detail_001.png:o0002", "开始行动"),
        ]
    )
    cache["frames"]["battle_detail_002.png"] = _frame(
        [
            _observation("battle_detail_002.png:o0001", "[我方:甲]"),
            _observation("battle_detail_002.png:o0002", "开始行动"),
        ]
    )

    lines, provenance, _ = ocr.build_log_and_provenance(
        cache,
        ["battle_detail_001.png", "battle_detail_002.png"],
        ["甲"],
        "lineage",
    )

    assert lines == ["[我方:甲]开始行动"]
    assert provenance["final_lines"][0]["observation_ids"] == [
        "battle_detail_001.png:o0001",
        "battle_detail_001.png:o0002",
        "battle_detail_002.png:o0001",
        "battle_detail_002.png:o0002",
    ]
    assert (
        provenance["final_lines"][0]["lineage_status"]
        == "deterministic_heuristic_v2"
    )
    merge_or_repair = [
        item
        for item in provenance["transformations"]
        if item["stage"] == "fragment_merge"
        and item["operation"] == "merge_or_repair"
    ]
    assert merge_or_repair
    assert all(item["mapping_status"] == "heuristic" for item in merge_or_repair)
    fragment_identities = [
        item
        for item in provenance["transformations"]
        if item["stage"] == "fragment_merge" and item["operation"] == "identity"
    ]
    assert fragment_identities
    assert all(item["mapping_status"] == "exact" for item in fragment_identities)
    operations = {item["operation"] for item in provenance["transformations"]}
    assert "merge_or_repair" in operations
    assert "deduplicate_overlap" in operations


def test_use_cache_twice_is_byte_deterministic(
    tmp_path: Path, monkeypatch,
) -> None:
    battles_dir = tmp_path / "battles"
    battle_root = battles_dir / "cache-determinism"
    images_dir = battle_root / "images"
    images_dir.mkdir(parents=True)
    image_name = "battle_detail_001.png"
    image_path = images_dir / image_name
    image_path.write_bytes(b"not-read-when-cache-is-used")
    cache = ocr.new_v2_cache_document("cache-determinism")
    cache["frames"][image_name] = _frame(
        [_observation(f"{image_name}:o0001", "第一回合")]
    )
    cache["frames"][image_name]["image_sha256"] = hashlib.sha256(
        image_path.read_bytes()
    ).hexdigest()
    ocr.write_cache_document(str(battle_root / ocr.CACHE_NAME), cache)
    monkeypatch.setattr(ocr, "BATTLES_DIR", str(battles_dir))
    monkeypatch.setattr(
        sys, "argv", ["ocr_battle_log.py", "cache-determinism", "--use-cache"]
    )

    assert ocr.main() == 0
    first_log = (battle_root / ocr.LOG_NAME).read_bytes()
    first_provenance = (battle_root / ocr.PROVENANCE_NAME).read_bytes()
    assert ocr.main() == 0

    assert (battle_root / ocr.LOG_NAME).read_bytes() == first_log
    assert (battle_root / ocr.PROVENANCE_NAME).read_bytes() == first_provenance
    value = json.loads(first_provenance)
    assert value["cache_schema_version"] == ocr.OCR_CACHE_SCHEMA_V2
    assert value["final_lines"][0]["source_observations"][0]["raw_text"] == "第一回合"


def test_use_cache_rejects_changed_screenshot_bytes(
    tmp_path: Path, monkeypatch,
) -> None:
    battles_dir = tmp_path / "battles"
    battle_root = battles_dir / "changed-frame"
    images_dir = battle_root / "images"
    images_dir.mkdir(parents=True)
    image_name = "battle_detail_001.png"
    image_path = images_dir / image_name
    image_path.write_bytes(b"original-frame")
    cache = ocr.new_v2_cache_document("changed-frame")
    cache["frames"][image_name] = _frame(
        [_observation(f"{image_name}:o0001", "第一回合")]
    )
    cache["frames"][image_name]["image_sha256"] = hashlib.sha256(
        image_path.read_bytes()
    ).hexdigest()
    ocr.write_cache_document(str(battle_root / ocr.CACHE_NAME), cache)
    image_path.write_bytes(b"replacement-frame")
    monkeypatch.setattr(ocr, "BATTLES_DIR", str(battles_dir))
    monkeypatch.setattr(
        sys, "argv", ["ocr_battle_log.py", "changed-frame", "--use-cache"]
    )

    with pytest.raises(ValueError, match="image_sha256 mismatch"):
        ocr.main()
