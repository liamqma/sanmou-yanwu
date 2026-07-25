"""Focused tests for bounded D1 web-battle ingestion."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from build_recommendation_data import (  # noqa: E402
    build as build_recommendation,
    duplicate_fingerprint,
    load_battles,
    load_catalog,
    manual_fingerprint_counts,
    validate_battle,
)
from build_telemetry_data import load_catalog as load_telemetry_catalog  # noqa: E402
from import_web_battles import (  # noqa: E402
    InvalidWebBattleImport,
    build_public_artifact,
    fresh_state,
    import_web_battles,
    load_submission_batch,
    load_submission_catalog,
    plan_recommendation_archive,
    process_rows,
    render_purge_sql,
)


TABLE_SQL = """
CREATE TABLE "web_battle_submissions" (
    "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
    "submission_id"   TEXT NOT NULL UNIQUE,
    "uploader_name"   TEXT,
    "received_at"     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "catalog_version" TEXT NOT NULL,
    "canonical_hash"  TEXT NOT NULL,
    "battle_json"     TEXT NOT NULL
);
"""


def _catalog_data(hero_count: int = 12) -> dict:
    heroes = {}
    skills = {}
    for index in range(hero_count):
        signature = f"signature-{index}"
        season = index % 3 + 1
        heroes[f"hero-{index}"] = {"skill": signature, "season": season}
        skills[signature] = {"season": season}
        skills[f"skill-{index}-a"] = {"season": season}
        skills[f"skill-{index}-b"] = {"season": season}
    return {"heroes": heroes, "skills": skills}


def _write_catalog(path: Path, hero_count: int = 12) -> None:
    path.write_text(
        json.dumps(_catalog_data(hero_count), ensure_ascii=False),
        encoding="utf-8",
    )


def _hero(index: int) -> dict:
    return {
        "name": f"hero-{index}",
        "skills": [
            f"signature-{index}",
            f"skill-{index}-a",
            f"skill-{index}-b",
        ],
    }


def _battle(
    first: tuple[int, int, int] = (0, 1, 2),
    second: tuple[int, int, int] = (3, 4, 5),
    winner: str = "1",
    season: int = 3,
) -> dict:
    return {
        "1": [_hero(index) for index in first],
        "2": [_hero(index) for index in second],
        "winner": winner,
        "season": season,
    }


def _swap_sides(raw: dict) -> dict:
    return {
        "1": raw["2"],
        "2": raw["1"],
        "winner": "2" if raw["winner"] == "1" else "1",
        "season": raw["season"],
    }


def _uuid(index: int) -> str:
    return f"00000000-0000-4000-8000-{index:012x}"


def _row(
    raw_battle: dict,
    catalog_version: str,
    *,
    row_id: int,
    uploader_name: str | None = None,
    canonical_hash: str | None = None,
    received_at: str | None = None,
) -> dict:
    battle = validate_battle(raw_battle, "row")
    return {
        "id": row_id,
        "submission_id": _uuid(row_id),
        "uploader_name": uploader_name,
        "received_at": received_at or f"2026-07-{row_id:02d} 03:04:05",
        "catalog_version": catalog_version,
        "canonical_hash": canonical_hash
        or duplicate_fingerprint(battle, uploader_name),
        "battle_json": json.dumps(
            raw_battle,
            ensure_ascii=False,
            separators=(",", ":"),
        ),
    }


def _write_export(path: Path, rows: list[dict]) -> None:
    connection = sqlite3.connect(":memory:")
    connection.executescript(TABLE_SQL)
    connection.executemany(
        """
        INSERT INTO web_battle_submissions (
            id, submission_id, uploader_name, received_at,
            catalog_version, canonical_hash, battle_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            tuple(row[column] for column in (
                "id",
                "submission_id",
                "uploader_name",
                "received_at",
                "catalog_version",
                "canonical_hash",
                "battle_json",
            ))
            for row in rows
        ],
    )
    connection.commit()
    path.write_text("\n".join(connection.iterdump()) + "\n", encoding="utf-8")
    connection.close()


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _setup_import_tree(tmp_path: Path) -> dict[str, Path | str]:
    manual_dir = tmp_path / "data/battles"
    web_dir = tmp_path / "data/web-upload"
    archive_dir = tmp_path / "data/recommendation_models"
    manual_dir.mkdir(parents=True)
    web_dir.mkdir(parents=True)
    archive_dir.mkdir(parents=True)
    database = tmp_path / "web/public/game-data/database.json"
    database.parent.mkdir(parents=True)
    _write_catalog(database)
    manual = _battle()
    _write_json(manual_dir / "manual.json", manual)

    recommendation = tmp_path / "web/src/recommendation_data.json"
    recommendation.parent.mkdir(parents=True)
    build_recommendation(
        str(manual_dir),
        str(database),
        str(recommendation),
    )
    manual_battles, errors = load_battles(str(manual_dir))
    assert not errors
    state = fresh_state(manual_fingerprint_counts(manual_battles))
    state_path = tmp_path / "data/web_upload_state.json"
    _write_json(state_path, state)
    public = tmp_path / "web/public/game-data/web_upload_data.json"
    _write_json(public, build_public_artifact(state))
    return {
        "manual_dir": manual_dir,
        "web_dir": web_dir,
        "archive_dir": archive_dir,
        "database": database,
        "recommendation": recommendation,
        "state": state_path,
        "public": public,
        "catalog_version": load_catalog(str(database))["catalog_version"],
    }


def _run_import(tree: dict[str, Path | str], export: Path) -> dict:
    return import_web_battles(
        export,
        state_path=tree["state"],
        manual_battles_dir=tree["manual_dir"],
        web_upload_dir=tree["web_dir"],
        database_path=tree["database"],
        recommendation_path=tree["recommendation"],
        public_output_path=tree["public"],
        recommendation_archive_dir=tree["archive_dir"],
    )


def test_fingerprint_matches_cross_language_vector() -> None:
    path = Path("data/battles/screenshot_1781911393823.json")
    raw = json.loads(path.read_text(encoding="utf-8"))
    # Match the backend's compact pinned vector. Hero-origin skills are valid in
    # carried slots; this replacement only makes the two test fixtures equal.
    raw["2"][0]["skills"][2] = "百战不殆"
    battle = validate_battle(
        {"1": raw["1"], "2": raw["2"], "winner": raw["winner"]},
        "vector",
    )
    assert duplicate_fingerprint(battle, "贡献者👩‍💻") == (
        "efc53a9795d0e5a82c73598154939160"
        "1e23fb34eb5f13c1f54fee3d4bc78705"
    )


def test_fingerprint_preserves_winner_uploader_and_positions_but_not_side() -> None:
    raw = _battle()
    base = validate_battle(raw, "base")
    swapped = validate_battle(_swap_sides(raw), "swapped")
    assert duplicate_fingerprint(base, "exact") == duplicate_fingerprint(
        swapped,
        "exact",
    )

    other_winner = validate_battle({**raw, "winner": "2"}, "winner")
    assert duplicate_fingerprint(base, "exact") != duplicate_fingerprint(
        other_winner,
        "exact",
    )
    assert duplicate_fingerprint(base, None) != duplicate_fingerprint(base, "")
    assert duplicate_fingerprint(base, "exact") != duplicate_fingerprint(base, " exact")
    assert duplicate_fingerprint(base, manual=True) != duplicate_fingerprint(
        base,
        None,
    )
    with_metadata = {**raw, "season": 99, "transport": "excluded"}
    assert duplicate_fingerprint(
        validate_battle(with_metadata, "metadata"),
        "exact",
    ) == duplicate_fingerprint(base, "exact")

    hero_reordered = _battle(first=(1, 0, 2))
    skill_reordered = _battle()
    skill_reordered["1"][0]["skills"][1:] = reversed(
        skill_reordered["1"][0]["skills"][1:]
    )
    assert duplicate_fingerprint(base, "exact") != duplicate_fingerprint(
        validate_battle(hero_reordered, "hero-order"),
        "exact",
    )
    assert duplicate_fingerprint(base, "exact") != duplicate_fingerprint(
        validate_battle(skill_reordered, "skill-order"),
        "exact",
    )

    equal_teams_first = validate_battle(
        _battle(first=(0, 1, 2), second=(0, 1, 2), winner="1"),
        "equal-first",
    )
    equal_teams_second = validate_battle(
        _battle(first=(0, 1, 2), second=(0, 1, 2), winner="2"),
        "equal-second",
    )
    assert duplicate_fingerprint(
        equal_teams_first,
        "exact",
    ) == duplicate_fingerprint(equal_teams_second, "exact")


def test_cap_zero_one_two_three_across_batches_and_cursor_advances(tmp_path: Path) -> None:
    database = tmp_path / "database.json"
    _write_catalog(database)
    catalog = load_submission_catalog(database)
    state = fresh_state({})
    raw = _battle()

    state, accepted = process_rows(
        [_row(raw, catalog.catalog_version, row_id=1, uploader_name="same")],
        state,
        catalog,
    )
    assert len(accepted) == 1
    fingerprint = next(iter(state["fingerprints"]["web"]))
    assert state["fingerprints"]["web"][fingerprint] == 1

    state, accepted = process_rows(
        [
            _row(raw, catalog.catalog_version, row_id=2, uploader_name="same"),
            _row(raw, catalog.catalog_version, row_id=3, uploader_name="same"),
        ],
        state,
        catalog,
    )
    assert [name for name, _ in accepted] == ["web-battle-00000002.json"]
    assert state["fingerprints"]["web"][fingerprint] == 2
    assert state["summary"] == {
        "processed_reports": 3,
        "accepted_reports": 2,
        "rejected_reports": 1,
    }
    assert state["cursor"]["last_processed_id"] == 3


def test_season_changes_do_not_bypass_semantic_duplicate_cap(
    tmp_path: Path,
) -> None:
    database = tmp_path / "database.json"
    _write_catalog(database)
    catalog = load_submission_catalog(database)
    state = fresh_state({})
    seasons = [1, 2, 3]
    rows = [
        _row(
            _battle(
                first=(0, 3, 6),
                second=(9, 0, 3),
                season=season,
            ),
            catalog.catalog_version,
            row_id=index,
            uploader_name="same",
        )
        for index, season in enumerate(seasons, start=1)
    ]

    state, accepted = process_rows(rows, state, catalog)

    assert [battle["season"] for _, battle in accepted] == [1, 2]
    assert state["summary"] == {
        "processed_reports": 3,
        "accepted_reports": 2,
        "rejected_reports": 1,
    }
    assert list(state["fingerprints"]["web"].values()) == [2]


def test_contributors_are_accepted_only_exact_and_named(tmp_path: Path) -> None:
    database = tmp_path / "database.json"
    _write_catalog(database)
    catalog = load_submission_catalog(database)
    state = fresh_state({})
    exact_name = " 贡献者👩‍💻 "
    names = [exact_name, exact_name, None, "", f" {_ZERO_WIDTH_JOINER_FOR_TEST} "]
    rows = [
        _row(_battle(first=(index, 6, 7)), catalog.catalog_version, row_id=index + 1, uploader_name=name)
        for index, name in enumerate(names)
    ]
    invalid_name = _row(
        _battle(first=(5, 6, 7)),
        catalog.catalog_version,
        row_id=6,
        uploader_name="bad\nname",
    )
    rows.append(invalid_name)

    state, accepted = process_rows(rows, state, catalog)

    assert len(accepted) == 5
    assert [
        battle["uploader_name"]
        for _, battle in accepted
    ] == [exact_name, exact_name, None, "", f" {_ZERO_WIDTH_JOINER_FOR_TEST} "]
    assert accepted[0][1]["uploaded_at"] == "2026-07-01T03:04:05Z"
    assert all(battle["season"] == 3 for _, battle in accepted)
    assert state["contributors"] == {exact_name: 2}
    public = build_public_artifact(state)
    assert public["contributors"] == [
        {"name": exact_name, "accepted_reports": 2}
    ]
    assert public["summary"]["rejected_reports"] == 1
    assert public["updated_through_id"] == 6


_ZERO_WIDTH_JOINER_FOR_TEST = "\u200d"


def test_invalid_row_is_rejected_and_checkpoint_advances(tmp_path: Path) -> None:
    tree = _setup_import_tree(tmp_path)
    raw = _battle()
    raw["1"][0]["name"] = "unknown"
    export = tmp_path / "export.sql"
    _write_export(
        export,
        [
            _row(
                raw,
                tree["catalog_version"],
                row_id=1,
                canonical_hash="0" * 64,
            )
        ],
    )

    artifact = _run_import(tree, export)

    assert artifact["summary"] == {
        "processed_reports": 1,
        "accepted_reports": 0,
        "rejected_reports": 1,
    }
    assert artifact["updated_through_id"] == 1
    assert artifact["updated_date"] == "2026-07-01"
    assert list(tree["web_dir"].glob("*.json")) == []


def test_revalidates_exact_shape_catalog_skills_hash_and_catalog_version(
    tmp_path: Path,
) -> None:
    database = tmp_path / "database.json"
    _write_catalog(database)
    catalog = load_submission_catalog(database)

    extra_metadata = _battle()
    extra_metadata["transport"] = "not part of the stored battle contract"
    duplicate_team_skill = _battle()
    duplicate_team_skill["1"][1]["skills"][1] = "skill-0-a"
    rows = [
        _row(extra_metadata, catalog.catalog_version, row_id=1),
        _row(duplicate_team_skill, catalog.catalog_version, row_id=2),
        _row(
            _battle(),
            catalog.catalog_version,
            row_id=3,
            canonical_hash="0" * 64,
        ),
        {
            **_row(_battle(), catalog.catalog_version, row_id=4),
            "catalog_version": "0" * 12,
        },
    ]

    state, accepted = process_rows(rows, fresh_state({}), catalog)

    assert accepted == []
    assert state["summary"] == {
        "processed_reports": 4,
        "accepted_reports": 0,
        "rejected_reports": 4,
    }
    assert state["cursor"]["last_processed_id"] == 4


def test_revalidates_season_payload_and_item_availability(
    tmp_path: Path,
) -> None:
    database = tmp_path / "database.json"
    _write_catalog(database)
    catalog = load_submission_catalog(database)

    missing_season = _battle()
    del missing_season["season"]
    non_integer_season = _battle()
    non_integer_season["season"] = "3"
    late_skill = _battle(
        first=(0, 3, 6),
        second=(0, 3, 6),
        season=1,
    )
    late_skill["1"][0]["skills"][1] = "skill-1-a"
    rows = [
        _row(
            missing_season,
            catalog.catalog_version,
            row_id=1,
        ),
        _row(
            non_integer_season,
            catalog.catalog_version,
            row_id=2,
        ),
        _row(
            _battle(season=1),
            catalog.catalog_version,
            row_id=3,
        ),
        _row(
            late_skill,
            catalog.catalog_version,
            row_id=4,
        ),
        _row(
            _battle(season=4),
            catalog.catalog_version,
            row_id=5,
        ),
    ]

    state, accepted = process_rows(rows, fresh_state({}), catalog)

    assert accepted == []
    assert state["summary"] == {
        "processed_reports": 5,
        "accepted_reports": 0,
        "rejected_reports": 5,
    }
    assert state["cursor"]["last_processed_id"] == 5


def test_items_without_season_are_available_and_upload_time_normalizes_to_utc(
    tmp_path: Path,
) -> None:
    database = tmp_path / "database.json"
    database_data = _catalog_data()
    database_data["heroes"]["hero-0"].pop("season")
    for skill in ("signature-0", "skill-0-a", "skill-0-b"):
        database_data["skills"][skill].pop("season")
    database.write_text(json.dumps(database_data), encoding="utf-8")
    catalog = load_submission_catalog(database)
    raw = _battle(
        first=(0, 3, 6),
        second=(0, 3, 6),
        season=1,
    )

    state, accepted = process_rows(
        [
            _row(
                raw,
                catalog.catalog_version,
                row_id=1,
                uploader_name="",
                received_at="2026-07-02T01:04:05.120000+10:00",
            )
        ],
        fresh_state({}),
        catalog,
    )

    assert len(accepted) == 1
    assert accepted[0][1]["uploader_name"] == ""
    assert accepted[0][1]["uploaded_at"] == "2026-07-01T15:04:05.12Z"
    assert accepted[0][1]["season"] == 1
    assert state["cursor"]["updated_date"] == "2026-07-01"


def test_accepts_another_hero_signature_in_a_carried_slot() -> None:
    database = Path("web/public/game-data/database.json")
    catalog = load_submission_catalog(database)
    raw = json.loads(
        Path(
            "image_extraction/fixtures/"
            "20251222-105040-453258_f17a780d.json"
        ).read_text(encoding="utf-8")
    )
    raw["season"] = 16

    state, accepted = process_rows(
        [
            _row(
                raw,
                catalog.catalog_version,
                row_id=1,
                uploader_name="fixture",
            )
        ],
        fresh_state({}),
        catalog,
    )

    assert len(accepted) == 1
    assert accepted[0][1]["1"][1]["skills"][1] == "苦肉计"
    assert state["summary"] == {
        "processed_reports": 1,
        "accepted_reports": 1,
        "rejected_reports": 0,
    }


def test_full_import_retains_metadata_and_is_deterministic(tmp_path: Path) -> None:
    tree = _setup_import_tree(tmp_path)
    raw = _battle(first=(6, 7, 8), second=(9, 10, 11), winner="2")
    export = tmp_path / "export.sql"
    _write_export(
        export,
        [
            _row(
                raw,
                tree["catalog_version"],
                row_id=1,
                uploader_name="贡献者👩‍💻",
                received_at="2026-07-01 13:14:15",
            )
        ],
    )

    first_artifact = _run_import(tree, export)
    accepted_path = tree["web_dir"] / "web-battle-00000001.json"
    accepted = json.loads(accepted_path.read_text(encoding="utf-8"))
    assert set(accepted) == {
        "1",
        "2",
        "winner",
        "uploader_name",
        "uploaded_at",
        "season",
    }
    assert accepted["uploader_name"] == "贡献者👩‍💻"
    assert accepted["uploaded_at"] == "2026-07-01T13:14:15Z"
    assert accepted["season"] == 3
    assert first_artifact["contributors"] == [
        {"name": "贡献者👩‍💻", "accepted_reports": 1}
    ]
    checkpoint_text = tree["state"].read_text(encoding="utf-8")
    assert "submission_id" not in checkpoint_text
    assert "battle_json" not in checkpoint_text
    assert json.loads(tree["recommendation"].read_text(encoding="utf-8"))[
        "battle_counts"
    ]["total_battles"] == 2
    archives = list(tree["archive_dir"].glob("*.json"))
    assert len(archives) == 1
    telemetry_contract = load_telemetry_catalog(
        tree["database"],
        [tree["recommendation"], *archives],
    )
    assert len(telemetry_contract.models) == 2

    tracked = [
        tree["state"],
        tree["public"],
        tree["recommendation"],
        accepted_path,
        *archives,
    ]
    before = {str(path): path.read_bytes() for path in tracked}
    second_artifact = _run_import(tree, export)
    after = {str(path): path.read_bytes() for path in tracked}
    assert second_artifact == first_artifact
    assert after == before


def test_full_import_preserves_null_and_empty_uploader_names(
    tmp_path: Path,
) -> None:
    tree = _setup_import_tree(tmp_path)
    raw = _battle(first=(6, 7, 8), second=(9, 10, 11), winner="2")
    export = tmp_path / "export.sql"
    _write_export(
        export,
        [
            _row(
                raw,
                tree["catalog_version"],
                row_id=1,
                uploader_name=None,
                received_at="2026-07-01 01:02:03",
            ),
            _row(
                raw,
                tree["catalog_version"],
                row_id=2,
                uploader_name="",
                received_at="2026-07-01T02:02:03Z",
            ),
        ],
    )

    artifact = _run_import(tree, export)
    accepted = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(tree["web_dir"].glob("*.json"))
    ]

    assert artifact["summary"]["accepted_reports"] == 2
    assert [battle["uploader_name"] for battle in accepted] == [None, ""]
    assert [battle["uploaded_at"] for battle in accepted] == [
        "2026-07-01T01:02:03Z",
        "2026-07-01T02:02:03Z",
    ]
    assert [battle["season"] for battle in accepted] == [3, 3]


@pytest.mark.parametrize(
    ("drift", "expected_error"),
    [
        ("retained-uploader", "fingerprints"),
        ("checkpoint-fingerprint", "fingerprints"),
        ("checkpoint-contributor", "contributors"),
    ],
)
def test_full_import_rejects_retained_web_checkpoint_drift(
    tmp_path: Path,
    drift: str,
    expected_error: str,
) -> None:
    tree = _setup_import_tree(tmp_path)
    raw = _battle(first=(6, 7, 8), second=(9, 10, 11), winner="2")
    export = tmp_path / "export.sql"
    _write_export(
        export,
        [
            _row(
                raw,
                tree["catalog_version"],
                row_id=1,
                uploader_name="original-contributor",
            )
        ],
    )
    _run_import(tree, export)

    accepted_path = tree["web_dir"] / "web-battle-00000001.json"
    if drift == "retained-uploader":
        accepted = json.loads(accepted_path.read_text(encoding="utf-8"))
        accepted["uploader_name"] = "different-contributor"
        _write_json(accepted_path, accepted)
    else:
        state = json.loads(tree["state"].read_text(encoding="utf-8"))
        if drift == "checkpoint-fingerprint":
            state["fingerprints"]["web"] = {"0" * 64: 1}
        else:
            state["contributors"] = {"different-contributor": 1}
        _write_json(tree["state"], state)

    with pytest.raises(InvalidWebBattleImport, match=expected_error):
        _run_import(tree, export)


def test_batch_over_500_drains_in_bounded_chunks(tmp_path: Path) -> None:
    database = tmp_path / "database.json"
    _write_catalog(database)
    catalog_version = load_catalog(str(database))["catalog_version"]
    raw = _battle(first=(6, 7, 8), second=(9, 10, 11))
    rows = [
        _row(
            raw,
            catalog_version,
            row_id=index,
            uploader_name=f"name-{index}",
            received_at="2026-07-01 03:04:05",
        )
        for index in range(1, 502)
    ]
    export = tmp_path / "export.sql"
    _write_export(export, rows)
    first_batch = load_submission_batch(export, after_id=0)
    second_batch = load_submission_batch(export, after_id=500)

    assert len(first_batch) == 500
    assert first_batch[0]["id"] == 1
    assert first_batch[-1]["id"] == 500
    assert [row["id"] for row in second_batch] == [501]

def test_export_batch_boundary_and_autoincrement_schema(tmp_path: Path) -> None:
    database = tmp_path / "database.json"
    _write_catalog(database)
    catalog_version = load_catalog(str(database))["catalog_version"]
    raw = _battle()
    rows = [
        _row(raw, catalog_version, row_id=index, uploader_name=f"name-{index}")
        for index in range(1, 501)
    ]
    export = tmp_path / "five-hundred.sql"
    _write_export(export, rows)
    assert len(load_submission_batch(export, after_id=0)) == 500

    invalid_schema = tmp_path / "not-autoincrement.sql"
    invalid_schema.write_text(
        TABLE_SQL.replace(" PRIMARY KEY AUTOINCREMENT", " PRIMARY KEY"),
        encoding="utf-8",
    )
    with pytest.raises(InvalidWebBattleImport, match="AUTOINCREMENT"):
        load_submission_batch(invalid_schema, after_id=0)


def _model_artifact(corpus: str) -> dict:
    return {
        "schema": {"version": 2},
        "catalog": {"catalog_version": "975e9b7727fc"},
        "battle_counts": {"corpus_version": corpus},
        "model": {"weights": {}, "support": {}},
    }


def test_archive_plan_is_deterministic_and_prunes_oldest(tmp_path: Path) -> None:
    archive_dir = tmp_path / "archive"
    archive_dir.mkdir()
    first = "00000001-v2-aaaaaaaaaaaaaaaa.json"
    second = "00000002-v2-bbbbbbbbbbbbbbbb.json"
    _write_json(archive_dir / first, _model_artifact("aaaaaaaaaaaaaaaa"))
    _write_json(archive_dir / second, _model_artifact("bbbbbbbbbbbbbbbb"))
    current = tmp_path / "current.json"
    proposed = tmp_path / "proposed.json"
    _write_json(current, _model_artifact("cccccccccccccccc"))
    _write_json(proposed, _model_artifact("dddddddddddddddd"))
    checkpoint = {"next_sequence": 3, "files": [first, second]}

    plan = plan_recommendation_archive(
        current,
        proposed,
        archive_dir,
        checkpoint,
        maximum_archives=2,
    )

    new_name = "00000003-v2-cccccccccccccccc.json"
    assert plan.checkpoint == {
        "next_sequence": 4,
        "files": [second, new_name],
    }
    assert set(plan.writes) == {archive_dir / new_name}
    assert plan.deletes == (archive_dir / first,)
    assert plan_recommendation_archive(
        current,
        proposed,
        archive_dir,
        checkpoint,
        maximum_archives=2,
    ) == plan


def test_purge_sql_uses_only_validated_committed_highwater() -> None:
    state = fresh_state({})
    state["cursor"]["last_processed_id"] = 42
    assert render_purge_sql(state) == (
        'DELETE FROM "web_battle_submissions"\n'
        'WHERE "id" <= 42;\n'
    )
