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
MODEL_VERSION = "2:0000000000000001"


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


def _write_model(
    path: Path,
    catalog_version: str,
    corpus_version: str,
    *,
    weights: dict[str, float] | None = None,
    support: dict[str, int] | None = None,
) -> None:
    path.write_text(
        json.dumps(
            {
                "schema": {"version": 2},
                "battle_counts": {"corpus_version": corpus_version},
                "catalog": {"catalog_version": catalog_version},
                "model": {
                    "weights": weights
                    if weights is not None
                    else {
                        "H|A": 0.3,
                        "H|D": 0.2,
                        "H|G": 0.1,
                        "S|a": 0.3,
                        "S|d": 0.2,
                        "S|g": 0.1,
                    },
                    "support": support
                    if support is not None
                    else {
                        "H|A": 30,
                        "H|D": 20,
                        "H|G": 10,
                        "S|a": 30,
                        "S|d": 20,
                        "S|g": 10,
                    },
                },
            }
        ),
        encoding="utf-8",
    )


def _write_catalog(directory: Path) -> tuple[Path, Path, str]:
    database = {
        "heroes": {
            name: {"skill": f"sig-{name}"}
            for name in ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J")
        },
        "skills": {
            **{
                name: {"color": "orange"}
                for name in ("a", "b", "c", "d", "e", "f", "g", "h", "i", "j")
            },
            "purple": {"color": "purple"},
            **{
                f"sig-{name}": {"color": "orange"}
                for name in ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J")
            },
        },
    }
    version = _catalog_version(database)
    database_path = directory / "database.json"
    recommendation_path = directory / "recommendation_data.json"
    database_path.write_text(json.dumps(database), encoding="utf-8")
    _write_model(recommendation_path, version, "0000000000000001")
    return database_path, recommendation_path, version


def _event(
    catalog_version: str,
    *,
    suffix: int = 1,
    round_number: int = 1,
    chosen_index: int = 0,
    model_version: str = MODEL_VERSION,
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
        json.dumps({"heroes": ["J"], "skills": ["j"]}),
        json.dumps(offered_sets),
        json.dumps([3.0, 2.0, 0.0] if round_number == 7 else [3.0, 2.0, 1.0]),
        0,
        chosen_index,
        None,
        None,
    )


def _write_export(
    path: Path,
    rows: list[tuple],
    schema_sql: str | None = None,
) -> None:
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        schema_sql if schema_sql is not None else MIGRATION.read_text(encoding="utf-8")
    )
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
            [{"version": MODEL_VERSION, "event_count": 2}],
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

    def test_schema_metadata_and_constraints_must_match_migration(self) -> None:
        canonical = MIGRATION.read_text(encoding="utf-8")
        mutations = {
            "type": ("event_id                 TEXT", "event_id                 BLOB"),
            "nullability": (
                "model_version            TEXT NOT NULL",
                "model_version            TEXT",
            ),
            "primary key": (
                "id                       INTEGER PRIMARY KEY",
                "id                       INTEGER",
            ),
            "default": ("DEFAULT CURRENT_TIMESTAMP", "DEFAULT 'not-current'"),
            "check": (
                "round_number BETWEEN 1 AND 8",
                "round_number BETWEEN 1 AND 7",
            ),
            "unique": (
                "event_id                 TEXT NOT NULL UNIQUE",
                "event_id                 TEXT NOT NULL",
            ),
        }
        for category, (old, new) in mutations.items():
            with self.subTest(category=category):
                self.assertIn(old, canonical)
                _write_export(self.export_path, [], canonical.replace(old, new, 1))
                with self.assertRaisesRegex(InvalidTelemetryError, "schema mismatch"):
                    self._build()

    def test_uuid_case_cannot_bypass_logical_duplicate_detection(self) -> None:
        event_a = list(_event(self.catalog_version, suffix=1, round_number=1))
        event_b = list(_event(self.catalog_version, suffix=2, round_number=2))
        event_a[0] = "abcdefab-1234-4abc-8def-abcdefabcdef"
        event_b[0] = event_a[0].upper()
        _write_export(self.export_path, [tuple(event_a), tuple(event_b)])
        with self.assertRaisesRegex(InvalidTelemetryError, "duplicate event_id"):
            self._build()

        session_a = list(_event(self.catalog_version, suffix=3, round_number=1))
        session_b = list(_event(self.catalog_version, suffix=4, round_number=1))
        session_a[1] = "abcdefab-1234-4abc-8def-abcdefabcdef"
        session_b[1] = session_a[1].upper()
        _write_export(self.export_path, [tuple(session_a), tuple(session_b)])
        with self.assertRaisesRegex(InvalidTelemetryError, "duplicate session_id"):
            self._build()

    def test_duplicate_and_already_owned_offers_fail_closed(self) -> None:
        cases = {
            "duplicate within set": (
                [["A", "A", "C"], ["D", "E", "F"], ["G", "H", "I"]],
                {"heroes": ["J"], "skills": ["j"]},
                "duplicate offered items",
            ),
            "duplicate across sets": (
                [["A", "B", "C"], ["C", "D", "E"], ["F", "G", "H"]],
                {"heroes": ["J"], "skills": ["j"]},
                "duplicate offered items",
            ),
            "normal pool overlap": (
                [["A", "B", "C"], ["D", "E", "F"], ["G", "H", "I"]],
                {"heroes": ["A"], "skills": ["j"]},
                "overlaps the existing pool",
            ),
            "support overlap": (
                [["A", "B", "C"], ["D", "E", "F"], ["G", "H", "I"]],
                {"heroes": ["J"], "skills": ["j"], "hero_support": "A"},
                "overlaps the existing pool",
            ),
        }
        for category, (offered_sets, pool, message) in cases.items():
            with self.subTest(category=category):
                row = list(_event(self.catalog_version))
                row[9] = json.dumps(pool)
                row[10] = json.dumps(offered_sets)
                _write_export(self.export_path, [tuple(row)])
                with self.assertRaisesRegex(InvalidTelemetryError, message):
                    self._build()

    def test_duplicate_normal_pool_items_fail_closed(self) -> None:
        cases = {
            "heroes": {"heroes": ["J", "J"], "skills": ["j"]},
            "skills": {"heroes": ["J"], "skills": ["j", "j"]},
        }
        for category, pool in cases.items():
            with self.subTest(category=category):
                row = list(_event(self.catalog_version))
                row[9] = json.dumps(pool)
                _write_export(self.export_path, [tuple(row)])
                with self.assertRaisesRegex(
                    InvalidTelemetryError, f"pool {category} contains duplicates"
                ):
                    self._build()

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

    def test_fabricated_scores_fail_even_when_recommendation_is_the_maximum(self) -> None:
        row = list(_event(self.catalog_version))
        row[11] = json.dumps([999.0, 0.0, 0.0])
        _write_export(self.export_path, [tuple(row)])
        with self.assertRaisesRegex(InvalidTelemetryError, "retained recommendation model"):
            self._build()

    def test_unknown_model_version_fails_without_echoing_client_values(self) -> None:
        unknown = "2:ffffffffffffffff"
        row = list(_event(self.catalog_version, model_version=unknown))
        row[0] = "abcdefab-1234-4abc-8def-abcdefabcdef"
        _write_export(self.export_path, [tuple(row)])
        with self.assertRaises(InvalidTelemetryError) as raised:
            self._build()
        message = str(raised.exception)
        self.assertIn("retained model registry", message)
        self.assertNotIn(unknown, message)
        self.assertNotIn(row[0], message)

    def test_retained_historical_model_is_accepted_and_controls_ties(self) -> None:
        historical_path = self.directory / "historical.json"
        historical_version = "2:0000000000000002"
        _write_model(
            historical_path,
            self.catalog_version,
            "0000000000000002",
            weights={"H|A": 0.0, "H|D": 0.0},
            support={"H|A": 10, "H|D": 20},
        )
        row = list(_event(self.catalog_version, model_version=historical_version))
        row[11] = json.dumps([0.0, 0.0, 0.0])
        row[12] = 1
        _write_export(self.export_path, [tuple(row)])

        artifact = build(
            self.export_path,
            self.database_path,
            self.recommendation_path,
            self.output_path,
            historical_recommendation_paths=[historical_path],
        )
        self.assertEqual(
            artifact["summary"]["model_versions"],
            [{"version": historical_version, "event_count": 1}],
        )

    def test_skill_eligibility_matches_ui_catalog_rules(self) -> None:
        cases = {
            "purple round offer": ("offers", "purple"),
            "signature round offer": ("offers", "sig-A"),
            "signature support skill": ("support", "sig-A"),
        }
        for category, (location, invalid_skill) in cases.items():
            with self.subTest(category=category):
                row = list(_event(self.catalog_version, round_number=2))
                if location == "offers":
                    offers = json.loads(row[10])
                    offers[0][0] = invalid_skill
                    row[10] = json.dumps(offers)
                else:
                    pool = json.loads(row[9])
                    pool["skills_support"] = [invalid_skill]
                    row[9] = json.dumps(pool)
                _write_export(self.export_path, [tuple(row)])
                with self.assertRaisesRegex(
                    InvalidTelemetryError, "unknown or invalid item"
                ):
                    self._build()

        row = list(_event(self.catalog_version, round_number=2))
        pool = json.loads(row[9])
        pool["skills_support"] = ["purple"]
        row[9] = json.dumps(pool)
        _write_export(self.export_path, [tuple(row)])
        self.assertEqual(self._build()["summary"]["event_count"], 1)

    def test_normal_pool_accepts_signature_skill_but_rejects_unknown_skill(self) -> None:
        row = list(_event(self.catalog_version, round_number=2))
        pool = json.loads(row[9])
        pool["skills"] = ["sig-A", "j"]
        row[9] = json.dumps(pool)
        _write_export(self.export_path, [tuple(row)])
        self.assertEqual(self._build()["summary"]["event_count"], 1)

        pool["skills"] = ["unknown", "j"]
        row[9] = json.dumps(pool)
        _write_export(self.export_path, [tuple(row)])
        with self.assertRaisesRegex(InvalidTelemetryError, "unknown or invalid item"):
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
