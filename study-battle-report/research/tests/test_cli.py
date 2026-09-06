from __future__ import annotations

import json
from pathlib import Path

import pytest

import cli
from schema import ContractError, SCHEMA_VERSION, file_sha256


FIXTURES = Path(__file__).parent / "fixtures"


def _fixture_repository(tmp_path: Path) -> tuple[Path, Path]:
    battle_id = "fixture-battle"
    battle_root = tmp_path / "repo" / "study-battle-report" / "battles" / battle_id
    images = battle_root / "images"
    images.mkdir(parents=True)
    log_path = battle_root / "battle_log.txt"
    cache_path = battle_root / ".ocr_cache.json"
    log_path.write_text((FIXTURES / "log_excerpt.txt").read_text(encoding="utf-8"), encoding="utf-8")
    cache_path.write_text((FIXTURES / "cache_excerpt.json").read_text(encoding="utf-8"), encoding="utf-8")
    (images / "battle_detail_001.png").write_bytes(b"fixture-png")

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "battle_id": battle_id,
        "experiment_session_id": "fixture-session",
        "expected_sources": {
            "battle_log_sha256": file_sha256(log_path),
            "ocr_cache_sha256": file_sha256(cache_path),
            "battle_log_line_count": 9,
            "screenshot_count": 1,
        },
        "game_metadata": {"metadata_status": "test_fixture"},
        "teams": {"ours": {}, "enemy": {}},
        "mirror_names": ["乐进", "糜夫人"],
        "audit_notes": ["behavior fixture"],
    }
    manifest_path = tmp_path / "fixture-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )
    return tmp_path / "repo", manifest_path


def test_cli_build_validate_and_repeat_are_byte_deterministic(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(tmp_path)
    first = tmp_path / "first"
    second = tmp_path / "second"

    cli.build("fixture-battle", first, manifest_path, repo_root)
    cli.build("fixture-battle", second, manifest_path, repo_root)
    summary = cli.validate(first)

    assert summary["status"] == "valid"
    assert summary["line_count"] == 9
    assert summary["event_count"] == 9
    assert summary["final_damage_status"] == "insufficient_independent_groups"
    assert sorted(path.name for path in first.iterdir()) == sorted(
        path.name for path in second.iterdir()
    )
    for first_path in first.iterdir():
        assert first_path.read_bytes() == (second / first_path.name).read_bytes()

    model = json.loads((first / "model_comparison.json").read_text(encoding="utf-8"))
    assert model["final_damage"]["selected_formula"] is None
    assert model["llm_annotations_included"] is False
    report = (first / "report.md").read_text(encoding="utf-8")
    assert "insufficient_independent_groups" in report
    assert "不声称已从单场战斗还原最终伤害公式" in report


def test_validate_rejects_tampered_generated_artifact(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(tmp_path)
    output = tmp_path / "output"
    cli.build("fixture-battle", output, manifest_path, repo_root)
    with (output / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write("{}\n")

    with pytest.raises(ContractError, match="hash mismatch"):
        cli.validate(output)
