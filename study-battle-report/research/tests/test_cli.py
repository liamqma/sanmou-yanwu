from __future__ import annotations

import json
from pathlib import Path

import pytest

import cli
from schema import ContractError, SCHEMA_VERSION, file_sha256


FIXTURES = Path(__file__).parent / "fixtures"


def _write_complete_v2_sources(
    battle_id: str,
    log_path: Path,
    cache_path: Path,
    sidecar_path: Path,
) -> None:
    image = "battle_detail_001.png"
    image_sha256 = file_sha256(cache_path.parent / "images" / image)
    lines = log_path.read_text(encoding="utf-8").splitlines()
    observations = [
        {
            "observation_id": f"{image}:o{line_number:04d}",
            "raw_text": text,
            "processed_text": text,
            "bbox": [
                [0.0, float(line_number - 1) * 20.0],
                [100.0, float(line_number - 1) * 20.0],
                [100.0, float(line_number) * 20.0],
                [0.0, float(line_number) * 20.0],
            ],
            "score": 0.99,
            "name_tokens": [],
            "provenance_status": "complete_observation_v2",
            "reused_from_observation_id": None,
            "processing": {
                "canonical_correction_applied": False,
                "token_side_method": "proportional-text-box-v1",
                "token_side_geometry": "approximate_from_line_box",
            },
        }
        for line_number, text in enumerate(lines, 1)
    ]
    cache = {
        "schema_version": "sanmou-ocr-cache-v2",
        "battle_id": battle_id,
        "ocr_config": {},
        "frames": {
            image: {
                "image_sha256": image_sha256,
                "crop_dhash": "2" * 64,
                "near_duplicate_of": None,
                "observations": observations,
                "provenance_status": "direct_ocr_v2",
            }
        },
    }
    cache_path.write_text(
        json.dumps(cache, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    observation_ids = [item["observation_id"] for item in observations]
    sidecar = {
        "schema_version": "sanmou-battle-log-provenance-v2",
        "battle_id": battle_id,
        "cache_schema_version": "sanmou-ocr-cache-v2",
        "observation_provenance_complete": True,
        "cache_file_sha256": file_sha256(cache_path),
        "battle_log_sha256": file_sha256(log_path),
        "token_side_calibration": {
            "method": "proportional-text-box-v1",
            "geometry": "approximate_from_whole_line_box",
            "claim": "calibrated_pixel_counts_with_conservative_unknown_decision",
        },
        "frames": [
            {
                "image": image,
                "image_sha256": image_sha256,
                "crop_dhash": "2" * 64,
                "near_duplicate_of": None,
                "observation_ids": observation_ids,
            }
        ],
        "transformations": [
            {
                "transform_id": f"t{line_number:06d}",
                "stage": "stitch",
                "operation": "accept_initial",
                "mapping_status": "exact",
                "input_node_ids": [
                    f"observation:{observation['observation_id']}"
                ],
                "output_node_ids": [f"n{line_number:06d}"],
                "details": {"scope": "fixture"},
            }
            for line_number, observation in enumerate(observations, 1)
        ],
        "final_lines": [
            {
                "line_number": line_number,
                "text": text,
                "lineage_node_id": f"n{line_number:06d}",
                "lineage_status": "deterministic_v2",
                "observation_ids": [observation["observation_id"]],
                "transformation_ids": [f"t{line_number:06d}"],
                "source_observations": [{**observation, "image": image}],
            }
            for line_number, (text, observation) in enumerate(
                zip(lines, observations, strict=True), 1
            )
        ],
        "summary": {"frame_count": 1, "final_line_count": len(lines)},
        "limitations": [],
    }
    sidecar_path.write_text(
        json.dumps(sidecar, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def _fixture_repository(
    tmp_path: Path,
    *,
    complete_v2_sidecar: bool = False,
    pin_sidecar: bool = True,
    game_metadata: dict | None = None,
    mirror_names: list[str] | None = None,
    teams: dict | None = None,
) -> tuple[Path, Path]:
    battle_id = "fixture-battle"
    battle_root = tmp_path / "repo" / "study-battle-report" / "battles" / battle_id
    images = battle_root / "images"
    images.mkdir(parents=True)
    log_path = battle_root / "battle_log.txt"
    cache_path = battle_root / ".ocr_cache.json"
    sidecar_path = battle_root / "battle_log.provenance.json"
    log_path.write_text((FIXTURES / "log_excerpt.txt").read_text(encoding="utf-8"), encoding="utf-8")
    (images / "battle_detail_001.png").write_bytes(b"fixture-png")
    if complete_v2_sidecar:
        _write_complete_v2_sources(
            battle_id, log_path, cache_path, sidecar_path
        )
    else:
        cache_path.write_text(
            (FIXTURES / "cache_excerpt.json").read_text(encoding="utf-8"),
            encoding="utf-8",
        )

    expected_sources = {
        "battle_log_sha256": file_sha256(log_path),
        "ocr_cache_sha256": file_sha256(cache_path),
        "battle_log_line_count": 9,
        "screenshot_count": 1,
    }
    if complete_v2_sidecar and pin_sidecar:
        expected_sources["battle_log_provenance_sha256"] = file_sha256(
            sidecar_path
        )
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "battle_id": battle_id,
        "experiment_session_id": "fixture-session",
        "expected_sources": expected_sources,
        "game_metadata": game_metadata or {"metadata_status": "test_fixture"},
        "teams": teams if teams is not None else {"ours": {}, "enemy": {}},
        "mirror_names": mirror_names if mirror_names is not None else ["乐进", "糜夫人"],
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


def test_report_only_claims_channels_observed_in_events(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(tmp_path)
    output = tmp_path / "observed-channel-report"

    cli.build("fixture-battle", output, manifest_path, repo_root)

    report = (output / "report.md").read_text(encoding="utf-8")
    channel_line = next(
        line for line in report.splitlines()
        if line.startswith("- 当前日志可解析字段包括：")
    )
    assert "`造成伤害` 百分比" in channel_line
    assert "`受到伤害` 百分比" in channel_line
    assert "`兵力损失`" in channel_line
    assert "会心伤害" not in channel_line
    assert "此次伤害减少" not in channel_line


def test_report_renders_manifest_metadata_and_mirror_names(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(
        tmp_path,
        game_metadata={
            "metadata_status": "partially_recorded",
            "season": 18,
            "game_build": "2026.03",
            "equipment": None,
        },
        mirror_names=["甲"],
        teams={
            "ours": {
                "heroes": ["甲", "乙", "丙"],
                "formation": "测试阵",
                "rows": [],
                "loadouts": None,
            },
            "enemy": {
                "heroes": ["丁", "戊", "己"],
                "formation": "敌阵",
                "rows": ["front", "middle", "back"],
                "loadouts": {"丁": ["一", "二"]},
            },
            "identity_status": "test_identity",
        },
    )
    output = tmp_path / "manifest-report"

    cli.build("fixture-battle", output, manifest_path, repo_root)

    report = (output / "report.md").read_text(encoding="utf-8")
    assert "manifest 登记的镜像名字为 `甲`" in report
    assert "manifest 已记录字段：`game_build`、`season`" in report
    assert "  - `game_build`：`\"2026.03\"`" in report
    assert "  - `season`：`18`" in report
    assert "manifest 未知字段：`equipment`" in report
    assert "我方队伍 已记录字段：`formation`、`heroes`" in report
    assert "  - `formation`：`\"测试阵\"`" in report
    assert "我方队伍 未知字段：`loadouts`、`rows`" in report
    assert "敌方队伍 未知字段：无" in report
    assert "乐进和糜夫人同时出现在双方" not in report
    assert "游戏版本、赛季、英雄/战法等级" not in report
    evaluation = json.loads(
        (output / "model_comparison.json").read_text(encoding="utf-8")
    )
    metadata_gap = next(
        gap
        for gap in evaluation["unresolved_data_gaps"]
        if gap["id"] == "battle_metadata"
    )
    assert "teams.ours.rows" in metadata_gap["missing_by_source"][0][
        "missing_fields"
    ]


def test_configured_manifest_requires_every_known_mirror_name(
    tmp_path: Path,
) -> None:
    _, manifest_path = _fixture_repository(
        tmp_path,
        mirror_names=[],
        teams={
            "ours": {"heroes": ["甲", "共享"]},
            "enemy": {"heroes": ["共享", "乙"]},
        },
    )

    with pytest.raises(ContractError, match="omits heroes present on both sides"):
        cli._configured_manifest(manifest_path)


def test_configured_manifest_allows_additional_ambiguity_names(
    tmp_path: Path,
) -> None:
    _, manifest_path = _fixture_repository(
        tmp_path,
        mirror_names=["共享", "额外歧义"],
        teams={
            "ours": {"heroes": ["甲", "共享"]},
            "enemy": {"heroes": ["共享", "乙"]},
        },
    )

    configured = cli._configured_manifest(manifest_path)

    assert configured["mirror_names"] == ["共享", "额外歧义"]


def test_validate_rejects_tampered_generated_artifact(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(tmp_path)
    output = tmp_path / "output"
    cli.build("fixture-battle", output, manifest_path, repo_root)
    with (output / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write("{}\n")

    with pytest.raises(ContractError, match="hash mismatch"):
        cli.validate(output)


def test_owned_output_can_be_rebuilt_byte_identically(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(tmp_path)
    output = tmp_path / "owned-output"
    cli.build("fixture-battle", output, manifest_path, repo_root)
    before = {path.name: path.read_bytes() for path in output.iterdir()}

    cli.build("fixture-battle", output, manifest_path, repo_root)

    after = {path.name: path.read_bytes() for path in output.iterdir()}
    assert after == before


def test_build_refuses_unowned_directory_and_preserves_sentinel(
    tmp_path: Path,
) -> None:
    repo_root, manifest_path = _fixture_repository(tmp_path)
    output = tmp_path / "unowned-output"
    output.mkdir()
    sentinel = output / "sentinel.txt"
    sentinel.write_text("do-not-delete", encoding="utf-8")

    with pytest.raises(ContractError, match="refusing unowned output directory"):
        cli.build("fixture-battle", output, manifest_path, repo_root)

    assert sentinel.read_text(encoding="utf-8") == "do-not-delete"
    assert {path.name for path in output.iterdir()} == {"sentinel.txt"}


def test_build_refuses_repository_ancestor_output(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(tmp_path)
    ancestor = repo_root.parent
    marker = ancestor / "ancestor-sentinel.txt"
    marker.write_text("preserve", encoding="utf-8")

    with pytest.raises(ContractError, match="repository/source ancestor"):
        cli.build("fixture-battle", ancestor, manifest_path, repo_root)

    assert marker.read_text(encoding="utf-8") == "preserve"
    assert repo_root.is_dir()


def test_build_refuses_foreign_file_added_to_owned_output(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(tmp_path)
    output = tmp_path / "owned-with-foreign-file"
    cli.build("fixture-battle", output, manifest_path, repo_root)
    expected_artifacts = {
        path.name: path.read_bytes() for path in output.iterdir()
    }
    sentinel = output / "sentinel.txt"
    sentinel.write_text("do-not-delete", encoding="utf-8")

    with pytest.raises(ContractError, match="foreign=\\['sentinel.txt'\\]"):
        cli.build("fixture-battle", output, manifest_path, repo_root)

    assert sentinel.read_text(encoding="utf-8") == "do-not-delete"
    assert {
        path.name: path.read_bytes()
        for path in output.iterdir()
        if path.name != "sentinel.txt"
    } == expected_artifacts


def test_build_pins_and_consumes_complete_v2_sidecar(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(
        tmp_path, complete_v2_sidecar=True
    )
    output = tmp_path / "v2-output"

    cli.build("fixture-battle", output, manifest_path, repo_root)

    source_manifest = json.loads(
        (output / "source_manifest.json").read_text(encoding="utf-8")
    )
    sidecar_source = source_manifest["sources"]["battle_log_provenance"]
    sidecar_path = (
        repo_root
        / "study-battle-report"
        / "battles"
        / "fixture-battle"
        / "battle_log.provenance.json"
    )
    assert sidecar_source == {
        "path": (
            "study-battle-report/battles/fixture-battle/"
            "battle_log.provenance.json"
        ),
        "sha256": file_sha256(sidecar_path),
    }
    quality = json.loads(
        (output / "quality_report.json").read_text(encoding="utf-8")
    )
    assert quality["provenance"]["provenance_mode"] == "v2_exact_lineage"
    report = (output / "report.md").read_text(encoding="utf-8")
    assert "当前 V2 来源已保存原始 OCR 文本" in report
    assert "原始 OCR 文本、bbox、token 级颜色以及精确拼接 lineage 不存在" not in report
    evaluation = json.loads(
        (output / "model_comparison.json").read_text(encoding="utf-8")
    )
    ocr_gap = next(
        gap for gap in evaluation["unresolved_data_gaps"] if gap["id"] == "ocr_lineage"
    )
    assert ocr_gap["provenance_mode"] == "v2_exact_lineage"
    assert "V2 已保留原始 OCR 文本" in ocr_gap["required"]


def test_build_rejects_changed_v2_screenshot_bytes(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(
        tmp_path, complete_v2_sidecar=True
    )
    image_path = (
        repo_root
        / "study-battle-report"
        / "battles"
        / "fixture-battle"
        / "images"
        / "battle_detail_001.png"
    )
    image_path.write_bytes(b"replacement-png")

    with pytest.raises(ValueError, match="do not match v2 OCR cache frames"):
        cli.build(
            "fixture-battle", tmp_path / "changed-image-output", manifest_path, repo_root
        )


def test_build_rejects_renamed_v2_screenshot_frame(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(
        tmp_path, complete_v2_sidecar=True
    )
    images = (
        repo_root
        / "study-battle-report"
        / "battles"
        / "fixture-battle"
        / "images"
    )
    (images / "battle_detail_001.png").rename(images / "battle_detail_002.png")

    with pytest.raises(ValueError, match="do not match v2 OCR cache frames"):
        cli.build(
            "fixture-battle", tmp_path / "renamed-image-output", manifest_path, repo_root
        )


def test_build_rejects_unpinned_complete_v2_sidecar(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(
        tmp_path, complete_v2_sidecar=True, pin_sidecar=False
    )

    with pytest.raises(ValueError, match="complete .* is unpinned"):
        cli.build(
            "fixture-battle", tmp_path / "unpinned-output", manifest_path, repo_root
        )


def test_build_rejects_tampered_pinned_v2_sidecar(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(
        tmp_path, complete_v2_sidecar=True
    )
    sidecar_path = (
        repo_root
        / "study-battle-report"
        / "battles"
        / "fixture-battle"
        / "battle_log.provenance.json"
    )
    with sidecar_path.open("a", encoding="utf-8") as handle:
        handle.write(" ")

    with pytest.raises(ValueError, match="battle_log.provenance.json hash mismatch"):
        cli.build(
            "fixture-battle", tmp_path / "tampered-output", manifest_path, repo_root
        )


def test_build_rejects_missing_configured_v2_sidecar(tmp_path: Path) -> None:
    repo_root, manifest_path = _fixture_repository(
        tmp_path, complete_v2_sidecar=True
    )
    sidecar_path = (
        repo_root
        / "study-battle-report"
        / "battles"
        / "fixture-battle"
        / "battle_log.provenance.json"
    )
    sidecar_path.unlink()

    with pytest.raises(FileNotFoundError, match="battle_log.provenance.json"):
        cli.build(
            "fixture-battle", tmp_path / "missing-output", manifest_path, repo_root
        )
