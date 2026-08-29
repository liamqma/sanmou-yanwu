import hashlib
import json
from collections import Counter
from itertools import combinations
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "data/import-manifests/season-16-ocr-dispositions.json"
EXPECTED_PROVENANCE = {
    "source": "complete_batch_extraction_log",
    "sha256": "46ce98069aa5d5a259b09611509b109c9540b051e00870e4107b5b259cba8f43",
    "line_count": 4995,
}
EXPECTED_COUNTS = {
    "source_screenshots": 144,
    "accepted": 114,
    "draw": 15,
    "incomplete_ocr": 15,
}


def test_season_16_ocr_dispositions_match_committed_battles():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    assert manifest["schema_version"] == 1
    assert manifest["season"] == 16
    assert manifest["provenance"] == EXPECTED_PROVENANCE
    assert manifest["counts"] == EXPECTED_COUNTS

    entries = manifest["entries"]
    assert [entry["sequence"] for entry in entries] == list(range(1, 145))

    source_files = [entry["source_file"] for entry in entries]
    assert source_files == sorted(source_files)
    assert len(source_files) == len(set(source_files)) == 144
    assert all(Path(source_file).name == source_file for source_file in source_files)

    dispositions = {"accepted", "draw", "incomplete_ocr"}
    partitions = {
        disposition: {
            entry["source_file"]
            for entry in entries
            if entry["disposition"] == disposition
        }
        for disposition in dispositions
    }
    assert all(
        left.isdisjoint(right)
        for left, right in combinations(partitions.values(), 2)
    )
    assert set().union(*partitions.values()) == set(source_files)

    actual_counts = Counter(entry["disposition"] for entry in entries)
    assert set(actual_counts) == dispositions
    assert {
        "source_screenshots": len(entries),
        **{disposition: actual_counts[disposition] for disposition in dispositions},
    } == EXPECTED_COUNTS

    for entry in entries:
        source_file = Path(entry["source_file"])
        battle_path = ROOT / "data/battles" / source_file.with_suffix(".json")

        if entry["disposition"] == "accepted":
            assert set(entry) == {
                "sequence",
                "source_file",
                "disposition",
                "battle_file",
                "battle_sha256",
            }
            assert entry["battle_file"] == battle_path.relative_to(ROOT).as_posix()
            assert battle_path.is_file()
            assert hashlib.sha256(battle_path.read_bytes()).hexdigest() == entry["battle_sha256"]
        elif entry["disposition"] == "draw":
            assert set(entry) == {"sequence", "source_file", "disposition", "reason"}
            assert entry["reason"] == "winner_ocr_detected_draw"
            assert not battle_path.exists()
        else:
            assert set(entry) == {
                "sequence",
                "source_file",
                "disposition",
                "reason",
                "slot",
            }
            assert entry["reason"] == "empty_skill_ocr"
            assert set(entry["slot"]) == {"team", "hero", "skill"}
            assert entry["slot"]["team"] in {1, 2}
            assert entry["slot"]["hero"] in {1, 2, 3}
            assert entry["slot"]["skill"] in {1, 2, 3}
            assert not battle_path.exists()
