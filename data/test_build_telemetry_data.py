"""Self-contained tests for the deterministic telemetry aggregate builder."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_telemetry_data import (  # noqa: E402
    InvalidTelemetryError,
    build,
    build_artifact,
    load_catalog,
    validate_artifact,
)


ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "web/migrations/0001_round_telemetry.sql"
INSERT_SQL = """
INSERT INTO round_telemetry (
    event_id, session_id, client_ts, received_at, round_number, round_type,
    schema_version, model_version, catalog_version, pool_before_json,
    offered_sets_json, paired_scores_json, recommended_index, chosen_index,
    preference_model_version, preference_probs_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _catalog_version(database: dict) -> str:
    heroes = database["heroes"]
    payload = json.dumps(
        {
            "heroes": sorted(heroes),
            "skills": sorted(database["skills"]),
            "default_skill": {
                name: hero["skill"] for name, hero in heroes.items() if hero.get("skill")
            },
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def _write_catalog(directory: Path) -> tuple[Path, Path, str]:
    database = {
        "heroes": {
            name: {"skill": f"sig-{name}"}
            for name in ("A", "B", "C", "D", "E", "F", "G", "H", "I")
        },
        "skills": {name: {} for name in ("a", "b", "c", "d", "e", "f", "g", "h", "i")},
    }
    version = _catalog_version(database)
    database_path = directory / "database.json"
    recommendation_path = directory / "recommendation_data.json"
    database_path.write_text(json.dumps(database), encoding="utf-8")
    recommendation_path.write_text(
        json.dumps({"catalog": {"catalog_version": version}}), encoding="utf-8"
    )
    return database_path, recommendation_path, version


def _event(
    catalog_version: str,
    *,
    suffix: int = 1,
    round_number: int = 1,
    chosen_index: int = 0,
    model_version: str = "2:model-a",
) -> tuple:
    round_type = "hero" if round_number in (1, 4, 7) else "skill"
    offered_sets = (
        [["A", "B"], ["C", "D"], ["E", "F"]]
        if round_number == 7
        else [["A", "B", "C"], ["D", "E", "F"], ["G", "H", "I"]]
        if round_type == "hero"
        else [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]
    )
    return (
        f"00000000-0000-4000-8000-{suffix:012d}",
        f"10000000-0000-4000-8000-{suffix:012d}",
        "2026-07-22T10:20:30.123Z",
        "2026-07-22 10:20:31",
        round_number,
        round_type,
        1,
        model_version,
        catalog_version,
        json.dumps({"heroes": ["A"], "skills": ["a"]}),
        json.dumps(offered_sets),
        json.dumps([3.0, 2.0, 1.0]),
        0,
        chosen_index,
        None,
        None,
    )


def _write_export(path: Path, rows: list[tuple]) -> None:
    connection = sqlite3.connect(":memory:")
    connection.executescript(MIGRATION.read_text(encoding="utf-8"))
    connection.executemany(INSERT_SQL, rows)
    path.write_text("\n".join(connection.iterdump()) + "\n", encoding="utf-8")
    connection.close()


class TelemetryBuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        (
            self.database_path,
            self.recommendation_path,
            self.catalog_version,
        ) = _write_catalog(self.directory)
        self.export_path = self.directory / "round_telemetry.sql"
        self.output_path = self.directory / "telemetry_data.json"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _build(self) -> dict:
        return build(
            self.export_path,
            self.database_path,
            self.recommendation_path,
            self.output_path,
        )

    def test_builds_only_deterministic_aggregates(self) -> None:
        rows = [
            _event(self.catalog_version, suffix=2, round_number=2, chosen_index=1),
            _event(self.catalog_version, suffix=1, round_number=1, chosen_index=0),
        ]
        _write_export(self.export_path, rows)

        artifact = self._build()
        first_bytes = self.output_path.read_bytes()
        artifact_again = self._build()

        self.assertEqual(artifact, artifact_again)
        self.assertEqual(first_bytes, self.output_path.read_bytes())
        self.assertEqual(artifact["summary"]["event_count"], 2)
        self.assertEqual(artifact["summary"]["session_count"], 2)
        self.assertEqual(
            artifact["summary"]["model_versions"],
            [{"version": "2:model-a", "event_count": 2}],
        )
        self.assertEqual(artifact["rounds"][0]["recommendation_accepted_count"], 1)
        self.assertEqual(artifact["rounds"][1]["chosen_position_counts"], [0, 1, 0])
        self.assertIsNone(artifact["preference_model"])
        serialized = first_bytes.decode("utf-8")
        self.assertNotIn("event_id", serialized)
        self.assertNotIn("session_id", serialized)
        self.assertNotIn("client_ts", serialized)

    def test_accepts_empty_export_and_emits_all_rounds(self) -> None:
        _write_export(self.export_path, [])
        artifact = self._build()
        self.assertEqual(artifact["summary"]["event_count"], 0)
        self.assertEqual([row["round_number"] for row in artifact["rounds"]], list(range(1, 9)))

    def test_malformed_json_fails_without_replacing_output(self) -> None:
        row = list(_event(self.catalog_version))
        row[9] = "{not-json"
        _write_export(self.export_path, [tuple(row)])
        self.output_path.write_text("keep-me", encoding="utf-8")

        with self.assertRaisesRegex(InvalidTelemetryError, "invalid JSON"):
            self._build()
        self.assertEqual(self.output_path.read_text(encoding="utf-8"), "keep-me")

    def test_catalog_mismatch_fails_closed(self) -> None:
        _write_export(self.export_path, [_event("old-catalog")])
        with self.assertRaisesRegex(InvalidTelemetryError, "catalog mismatch"):
            self._build()
        self.assertFalse(self.output_path.exists())

    def test_unknown_catalog_item_fails_closed(self) -> None:
        row = list(_event(self.catalog_version))
        row[10] = json.dumps([["A", "B", "unknown"], ["D", "E", "F"], ["G", "H", "I"]])
        _write_export(self.export_path, [tuple(row)])
        with self.assertRaisesRegex(InvalidTelemetryError, "unknown or invalid item"):
            self._build()

    def test_recommendation_must_point_to_a_highest_score(self) -> None:
        row = list(_event(self.catalog_version))
        row[11] = json.dumps([1.0, 3.0, 2.0])
        _write_export(self.export_path, [tuple(row)])
        with self.assertRaisesRegex(InvalidTelemetryError, "highest paired score"):
            self._build()

    def test_future_preference_probabilities_are_validated_and_counted(self) -> None:
        row = list(_event(self.catalog_version))
        row[14] = "preference-v1"
        row[15] = json.dumps([0.2, 0.3, 0.5])
        _write_export(self.export_path, [tuple(row)])
        artifact = self._build()
        self.assertEqual(artifact["summary"]["preference_event_count"], 1)
        self.assertEqual(
            artifact["summary"]["preference_model_versions"],
            [{"version": "preference-v1", "event_count": 1}],
        )

    def test_database_and_recommendation_catalogs_must_match(self) -> None:
        self.recommendation_path.write_text(
            json.dumps({"catalog": {"catalog_version": "wrong"}}), encoding="utf-8"
        )
        with self.assertRaisesRegex(InvalidTelemetryError, "catalog mismatch"):
            load_catalog(self.database_path, self.recommendation_path)

    def test_artifact_validation_rejects_non_null_phase_two_model(self) -> None:
        artifact = build_artifact([], self.catalog_version)
        artifact["preference_model"] = {"version": "too-early"}
        with self.assertRaisesRegex(InvalidTelemetryError, "must be null"):
            validate_artifact(artifact)


if __name__ == "__main__":
    unittest.main()
