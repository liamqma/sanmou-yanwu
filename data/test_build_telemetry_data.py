"""Self-contained tests for the deterministic telemetry aggregate builder."""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_telemetry_data import (  # noqa: E402
    InvalidTelemetryError,
    MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS,
    MAX_PREFERENCE_FEATURES,
    PREFERENCE_QUALITY_DECIMAL_PLACES,
    PREFERENCE_VERSION_OTHER_BUCKET,
    _build_preference_model,
    _published_preference_version_counts,
    _quantize_preference_probabilities,
    _session_is_holdout,
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
INSERT_WITH_ID_SQL = """
INSERT INTO round_telemetry (
    id, event_id, session_id, client_ts, received_at, round_number, round_type,
    schema_version, model_version, catalog_version, pool_before_json,
    offered_sets_json, paired_scores_json, recommended_index, chosen_index,
    preference_model_version, preference_probs_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    *,
    row_ids: list[int] | None = None,
) -> None:
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        schema_sql if schema_sql is not None else MIGRATION.read_text(encoding="utf-8")
    )
    if row_ids is None:
        connection.executemany(INSERT_SQL, rows)
    else:
        if len(row_ids) != len(rows):
            raise ValueError("row_ids must match rows")
        connection.executemany(
            INSERT_WITH_ID_SQL,
            [
                (row_id, *row)
                for row_id, row in zip(row_ids, rows, strict=True)
            ],
        )
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
        self.assertEqual(artifact["summary"]["invalid_event_count"], 0)
        self.assertEqual(artifact["summary"]["session_count"], 2)
        self.assertEqual(
            artifact["summary"]["model_versions"],
            [{"version": MODEL_VERSION, "event_count": 2}],
        )
        self.assertEqual(artifact["rounds"][0]["recommendation_accepted_count"], 1)
        self.assertEqual(artifact["rounds"][1]["chosen_position_counts"], [0, 1, 0])
        self.assertEqual(
            artifact["preference_model"]["status"], "insufficient_evidence"
        )
        self.assertIsNone(artifact["preference_model"]["version"])
        self.assertEqual(artifact["summary"]["recommendation_accepted_count"], 1)
        self.assertEqual(artifact["analytics"]["minimum_rate_support"], 10)
        self.assertTrue(
            artifact["analytics"]["items"]["heroes"][0]["rate_suppressed"]
        )
        invalid_offer_count = json.loads(json.dumps(artifact))
        invalid_item = invalid_offer_count["analytics"]["items"]["heroes"][0]
        invalid_item["offer_count"] = invalid_item["opportunity_count"] + 1
        with self.assertRaisesRegex(InvalidTelemetryError, "item row"):
            validate_artifact(invalid_offer_count)
        serialized = first_bytes.decode("utf-8")
        self.assertNotIn("event_id", serialized)
        self.assertNotIn("session_id", serialized)
        self.assertNotIn("client_ts", serialized)

    def test_item_analytics_count_only_offered_sets_and_chosen_option(self) -> None:
        rows = [
            _event(self.catalog_version, suffix=1, round_number=1, chosen_index=2),
            _event(self.catalog_version, suffix=2, round_number=2, chosen_index=1),
        ]
        _write_export(self.export_path, rows)

        artifact = self._build()
        hero_rows = {
            row["name"]: row for row in artifact["analytics"]["items"]["heroes"]
        }
        skill_rows = {
            row["name"]: row for row in artifact["analytics"]["items"]["skills"]
        }

        self.assertNotIn("J", hero_rows)
        self.assertNotIn("j", skill_rows)
        self.assertEqual(sum(row["offer_count"] for row in hero_rows.values()), 9)
        self.assertEqual(sum(row["picked_count"] for row in hero_rows.values()), 3)
        self.assertEqual(sum(row["offer_count"] for row in skill_rows.values()), 9)
        self.assertEqual(sum(row["picked_count"] for row in skill_rows.values()), 3)
        self.assertEqual(
            [hero_rows[name]["picked_count"] for name in ("G", "H", "I")],
            [1, 1, 1],
        )
        self.assertEqual(
            [skill_rows[name]["picked_count"] for name in ("d", "e", "f")],
            [1, 1, 1],
        )

    def test_accepts_empty_export_and_emits_all_rounds(self) -> None:
        _write_export(self.export_path, [])
        artifact = self._build()
        self.assertEqual(artifact["summary"]["event_count"], 0)
        self.assertEqual([row["round_number"] for row in artifact["rounds"]], list(range(1, 9)))

    def test_schema_metadata_and_constraints_must_match_migration(self) -> None:
        canonical = MIGRATION.read_text(encoding="utf-8")
        mutations = {
            "type": (
                '"event_id"                 TEXT',
                '"event_id"                 BLOB',
            ),
            "nullability": (
                '"model_version"            TEXT NOT NULL',
                '"model_version"            TEXT',
            ),
            "primary key": (
                '"id"                       INTEGER PRIMARY KEY AUTOINCREMENT',
                '"id"                       INTEGER',
            ),
            "default": ("DEFAULT CURRENT_TIMESTAMP", "DEFAULT 'not-current'"),
            "check": (
                '"round_number" BETWEEN 1 AND 8',
                '"round_number" BETWEEN 1 AND 7',
            ),
            "unique": (
                '"event_id"                 TEXT NOT NULL UNIQUE',
                '"event_id"                 TEXT NOT NULL',
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

    def test_duplicate_and_already_owned_offers_are_quarantined(self) -> None:
        cases = {
            "duplicate within set": (
                [["A", "A", "C"], ["D", "E", "F"], ["G", "H", "I"]],
                {"heroes": ["J"], "skills": ["j"]},
            ),
            "duplicate across sets": (
                [["A", "B", "C"], ["C", "D", "E"], ["F", "G", "H"]],
                {"heroes": ["J"], "skills": ["j"]},
            ),
            "normal pool overlap": (
                [["A", "B", "C"], ["D", "E", "F"], ["G", "H", "I"]],
                {"heroes": ["A"], "skills": ["j"]},
            ),
            "support overlap": (
                [["A", "B", "C"], ["D", "E", "F"], ["G", "H", "I"]],
                {"heroes": ["J"], "skills": ["j"], "hero_support": "A"},
            ),
        }
        for category, (offered_sets, pool) in cases.items():
            with self.subTest(category=category):
                row = list(_event(self.catalog_version))
                row[9] = json.dumps(pool)
                row[10] = json.dumps(offered_sets)
                _write_export(self.export_path, [tuple(row)])
                artifact = self._build()
                self.assertEqual(artifact["summary"]["event_count"], 0)
                self.assertEqual(artifact["summary"]["invalid_event_count"], 1)

    def test_duplicate_normal_pool_items_are_quarantined(self) -> None:
        cases = {
            "heroes": {"heroes": ["J", "J"], "skills": ["j"]},
            "skills": {"heroes": ["J"], "skills": ["j", "j"]},
        }
        for category, pool in cases.items():
            with self.subTest(category=category):
                row = list(_event(self.catalog_version))
                row[9] = json.dumps(pool)
                _write_export(self.export_path, [tuple(row)])
                artifact = self._build()
                self.assertEqual(artifact["summary"]["event_count"], 0)
                self.assertEqual(artifact["summary"]["invalid_event_count"], 1)

    def test_malformed_event_json_is_quarantined(self) -> None:
        row = list(_event(self.catalog_version))
        row[9] = "{not-json"
        _write_export(self.export_path, [tuple(row)])
        self.output_path.write_text("keep-me", encoding="utf-8")

        artifact = self._build()
        self.assertEqual(artifact["summary"]["event_count"], 0)
        self.assertEqual(artifact["summary"]["invalid_event_count"], 1)
        self.assertNotEqual(self.output_path.read_text(encoding="utf-8"), "keep-me")

    def test_catalog_mismatch_fails_closed(self) -> None:
        _write_export(self.export_path, [_event("old-catalog")])
        with self.assertRaisesRegex(InvalidTelemetryError, "catalog mismatch"):
            self._build()
        self.assertFalse(self.output_path.exists())

    def test_event_schema_mismatch_fails_closed(self) -> None:
        row = list(_event(self.catalog_version))
        row[6] = 2
        _write_export(self.export_path, [tuple(row)])
        with self.assertRaisesRegex(InvalidTelemetryError, "schema_version"):
            self._build()
        self.assertFalse(self.output_path.exists())

    def test_unknown_catalog_item_is_quarantined(self) -> None:
        row = list(_event(self.catalog_version))
        row[10] = json.dumps([["A", "B", "unknown"], ["D", "E", "F"], ["G", "H", "I"]])
        _write_export(self.export_path, [tuple(row)])
        artifact = self._build()
        self.assertEqual(artifact["summary"]["event_count"], 0)
        self.assertEqual(artifact["summary"]["invalid_event_count"], 1)

    def test_valid_events_build_when_an_overlap_event_is_quarantined(self) -> None:
        invalid = list(_event(self.catalog_version, suffix=1, round_number=1))
        invalid[9] = json.dumps({"heroes": ["A"], "skills": ["j"]})
        valid = _event(self.catalog_version, suffix=2, round_number=2)
        _write_export(self.export_path, [tuple(invalid), valid])

        artifact = self._build()

        self.assertEqual(artifact["summary"]["event_count"], 1)
        self.assertEqual(artifact["summary"]["invalid_event_count"], 1)
        self.assertEqual(artifact["rounds"][0]["event_count"], 0)
        self.assertEqual(artifact["rounds"][1]["event_count"], 1)

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
                artifact = self._build()
                self.assertEqual(artifact["summary"]["event_count"], 0)
                self.assertEqual(artifact["summary"]["invalid_event_count"], 1)

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
        artifact = self._build()
        self.assertEqual(artifact["summary"]["event_count"], 0)
        self.assertEqual(artifact["summary"]["invalid_event_count"], 1)

    def test_future_preference_probabilities_are_validated_and_privately_counted(
        self,
    ) -> None:
        row = list(_event(self.catalog_version))
        row[14] = "preference-v1:0000000000000001"
        row[15] = json.dumps([0.2, 0.3, 0.5])
        _write_export(self.export_path, [tuple(row)])
        artifact = self._build()
        self.assertEqual(artifact["summary"]["preference_event_count"], 1)
        self.assertEqual(
            artifact["summary"]["preference_model_versions"],
            [{"version": PREFERENCE_VERSION_OTHER_BUCKET, "event_count": 1}],
        )

    def test_untrusted_preference_version_cardinality_is_bounded_not_fatal(
        self,
    ) -> None:
        rows = []
        for index in range(1, 514):
            row = list(_event(self.catalog_version, suffix=index))
            row[14] = f"preference-v1:{index:016x}"
            row[15] = json.dumps([0.0, 0.0, 1.0])
            rows.append(tuple(row))
        _write_export(self.export_path, rows)

        artifact = self._build()

        self.assertEqual(artifact["summary"]["event_count"], 513)
        self.assertEqual(artifact["summary"]["preference_event_count"], 513)
        self.assertEqual(
            artifact["summary"]["preference_model_versions"],
            [
                {
                    "version": PREFERENCE_VERSION_OTHER_BUCKET,
                    "event_count": 513,
                }
            ],
        )
        self.assertEqual(
            artifact["preference_model"]["status"],
            "insufficient_evidence",
        )
        self.assertNotIn(
            "preference-v1:0000000000000001",
            self.output_path.read_text(encoding="utf-8"),
        )

    def test_preference_version_bucket_is_deterministic_and_preserves_total(
        self,
    ) -> None:
        counts = {
            f"preference-v1:{index:016x}": 10 + index
            for index in range(40)
        }
        reversed_counts = dict(reversed(list(counts.items())))

        rows = _published_preference_version_counts(counts)

        self.assertEqual(
            rows,
            _published_preference_version_counts(reversed_counts),
        )
        self.assertEqual(
            len(rows),
            MAX_PUBLISHED_PREFERENCE_MODEL_VERSIONS,
        )
        self.assertEqual(
            sum(row["event_count"] for row in rows),
            sum(counts.values()),
        )
        self.assertEqual(
            next(
                row["event_count"]
                for row in rows
                if row["version"] == PREFERENCE_VERSION_OTHER_BUCKET
            ),
            sum(10 + index for index in range(9)),
        )

    def test_database_and_recommendation_catalogs_must_match(self) -> None:
        self.recommendation_path.write_text(
            json.dumps({"catalog": {"catalog_version": "wrong"}}), encoding="utf-8"
        )
        with self.assertRaisesRegex(InvalidTelemetryError, "catalog mismatch"):
            load_catalog(self.database_path, self.recommendation_path)

    def test_artifact_validation_rejects_invalid_preference_model(self) -> None:
        artifact = build_artifact([], self.catalog_version)
        artifact["preference_model"] = {"version": "too-early"}
        with self.assertRaisesRegex(InvalidTelemetryError, "contract"):
            validate_artifact(artifact)

    def test_full_corpus_predictions_use_browser_display_quantization(self) -> None:
        raw_tie = [0.3337, 0.3325, 0.3338]
        displayed_tie = _quantize_preference_probabilities(raw_tie)
        self.assertEqual(displayed_tie, [0.334, 0.332, 0.334])
        self.assertEqual(
            min(range(3), key=lambda index: (-displayed_tie[index], index)),
            0,
        )
        self.assertEqual(
            min(range(3), key=lambda index: (-raw_tie[index], index)),
            2,
        )

        raw_margin = [0.4002, 0.30025, 0.29955]
        displayed_margin = _quantize_preference_probabilities(raw_margin)
        self.assertEqual(displayed_margin, [0.4, 0.3, 0.3])
        self.assertLess(raw_margin[0] - raw_margin[1], 0.1)
        self.assertGreaterEqual(
            displayed_margin[0] - displayed_margin[1],
            0.1,
        )

    def test_quality_gate_uses_precise_stored_values_at_rounding_boundary(
        self,
    ) -> None:
        events = [
            {
                "event_id": f"00000000-0000-4000-8000-{index:012d}",
                "session_id": f"10000000-0000-4000-8000-{index:012d}",
                "round_number": 1,
                "round_type": "hero",
                "model_version": MODEL_VERSION,
                "pool_before": {"heroes": [], "skills": []},
                "offered_sets": [["A"], ["B"], ["C"]],
                "paired_scores": [0.0, 0.0, 0.0],
                "recommended_index": 1,
                "chosen_index": 0,
                "preference_model_version": None,
                "preference_probabilities": None,
            }
            for index in range(1, 241)
        ]
        stored_baseline = round(
            math.log(3),
            PREFERENCE_QUALITY_DECIMAL_PLACES,
        )

        def zero_weights(
            _events: list[dict],
            selected_features: list[str],
        ) -> dict[str, float]:
            return {feature_id: 0.0 for feature_id in selected_features}

        for offset, expected_status in (
            (0.0, "ready"),
            (1e-7, "quality_gate_failed"),
        ):
            with self.subTest(offset=offset):
                target_log_loss = (
                    stored_baseline - 0.01 + offset
                )
                chosen_probability = math.exp(-target_log_loss)
                probabilities = [
                    chosen_probability,
                    (1 - chosen_probability) / 2,
                    (1 - chosen_probability) / 2,
                ]
                with patch(
                    "build_telemetry_data._fit_preference_model",
                    side_effect=zero_weights,
                ), patch(
                    "build_telemetry_data._predict_preference",
                    return_value=probabilities,
                ):
                    artifact = build_artifact(events, self.catalog_version)

                model = artifact["preference_model"]
                self.assertEqual(model["status"], expected_status)
                self.assertEqual(
                    model["held_out"]["log_loss"],
                    round(
                        target_log_loss,
                        PREFERENCE_QUALITY_DECIMAL_PLACES,
                    ),
                )
                validate_artifact(artifact)

    def test_trains_session_held_out_conditional_choice_model_after_evidence_gate(
        self,
    ) -> None:
        rows = [
            _event(
                self.catalog_version,
                suffix=index,
                round_number=(index % 6) + 1,
                chosen_index=1 if index % 4 == 0 else 0,
            )
            for index in range(1, 241)
        ]
        _write_export(self.export_path, rows)

        artifact = self._build()
        first_bytes = self.output_path.read_bytes()
        artifact_again = self._build()

        model = artifact["preference_model"]
        self.assertEqual(artifact, artifact_again)
        self.assertEqual(first_bytes, self.output_path.read_bytes())
        self.assertEqual(model["status"], "ready")
        self.assertRegex(model["version"], r"^preference-v1:[0-9a-f]{16}$")
        self.assertTrue(model["weights"])
        self.assertEqual(set(model["weights"]), set(model["support"]))
        self.assertGreaterEqual(model["held_out"]["event_count"], 36)
        self.assertLessEqual(
            model["held_out"]["log_loss"],
            model["held_out"]["uniform_log_loss"] - 0.01 + 1e-6,
        )
        self.assertEqual(
            artifact["summary"]["recommendation_accepted_count"], 180
        )
        self.assertTrue(
            all(
                row["preference_top_disagreement_count"] is not None
                for row in artifact["rounds"]
            )
        )
        self.assertNotIn("pool_before", self.output_path.read_text(encoding="utf-8"))

        invalid_feature = json.loads(json.dumps(artifact))
        invalid_feature["preference_model"]["weights"] = {"event_id": 1.0}
        invalid_feature["preference_model"]["support"] = {"event_id": 240}
        with self.assertRaisesRegex(InvalidTelemetryError, "preference model"):
            validate_artifact(invalid_feature)

        low_support = json.loads(json.dumps(artifact))
        low_support["preference_model"]["weights"]['["round_score",8]'] = 0.5
        low_support["preference_model"]["support"]['["round_score",8]'] = 3
        with self.assertRaisesRegex(InvalidTelemetryError, "preference model"):
            validate_artifact(low_support)

        unhashed_version = json.loads(json.dumps(artifact))
        unhashed_version["preference_model"]["version"] = "preference-v1"
        with self.assertRaisesRegex(InvalidTelemetryError, "preference model"):
            validate_artifact(unhashed_version)

        unsupported_hashed_version = json.loads(json.dumps(artifact))
        unsupported_hashed_version["preference_model"][
            "version"
        ] = "preference-v2:0000000000000001"
        with self.assertRaisesRegex(InvalidTelemetryError, "preference model"):
            validate_artifact(unsupported_hashed_version)

        zero_train_events = json.loads(json.dumps(artifact))
        total_events = zero_train_events["summary"]["event_count"]
        zero_train_events["preference_model"]["evidence"][
            "holdout_event_count"
        ] = total_events
        zero_train_events["preference_model"]["held_out"][
            "event_count"
        ] = total_events
        zero_train_events["preference_model"]["held_out"][
            "train_event_count"
        ] = 0
        with self.assertRaisesRegex(InvalidTelemetryError, "held-out metrics"):
            validate_artifact(zero_train_events)

        noncanonical_feature = json.loads(json.dumps(artifact))
        score_weight = noncanonical_feature["preference_model"]["weights"].pop(
            '["score"]'
        )
        score_support = noncanonical_feature["preference_model"]["support"].pop(
            '["score"]'
        )
        noncanonical_feature["preference_model"]["weights"][
            '[ "score" ]'
        ] = score_weight
        noncanonical_feature["preference_model"]["support"][
            '[ "score" ]'
        ] = score_support
        with self.assertRaisesRegex(InvalidTelemetryError, "preference model"):
            validate_artifact(noncanonical_feature)

        too_many_features = json.loads(json.dumps(artifact))
        oversized_weights = {
            json.dumps(
                ["item", "hero", f"item-{index}"],
                separators=(",", ":"),
            ): 0.0
            for index in range(MAX_PREFERENCE_FEATURES + 1)
        }
        too_many_features["preference_model"]["weights"] = oversized_weights
        too_many_features["preference_model"]["support"] = {
            feature_id: 10 for feature_id in oversized_weights
        }
        with self.assertRaisesRegex(InvalidTelemetryError, "preference model"):
            validate_artifact(too_many_features)

        failed_quality = json.loads(json.dumps(artifact))
        failed_quality["preference_model"]["held_out"]["log_loss"] = failed_quality[
            "preference_model"
        ]["held_out"]["uniform_log_loss"]
        with self.assertRaisesRegex(InvalidTelemetryError, "quality gate"):
            validate_artifact(failed_quality)

    def test_no_signal_model_fails_the_held_out_quality_gate(self) -> None:
        events = []
        train_count = 0
        holdout_count = 0
        suffix = 1
        while train_count < 192 or holdout_count < 48:
            session_id = f"10000000-0000-4000-8000-{suffix:012d}"
            is_holdout = _session_is_holdout(session_id)
            if (is_holdout and holdout_count >= 48) or (
                not is_holdout and train_count >= 192
            ):
                suffix += 1
                continue
            group_index = holdout_count if is_holdout else train_count
            chosen_index = group_index % 3
            if is_holdout:
                holdout_count += 1
            else:
                train_count += 1
            events.append(
                {
                    "event_id": f"00000000-0000-4000-8000-{suffix:012d}",
                    "session_id": session_id,
                    "round_number": 1,
                    "round_type": "hero",
                    "model_version": MODEL_VERSION,
                    "pool_before": {"heroes": [], "skills": []},
                    "offered_sets": [["A"], ["B"], ["C"]],
                    "paired_scores": [0.0, 0.0, 0.0],
                    "recommended_index": 0,
                    "chosen_index": chosen_index,
                    "preference_model_version": None,
                    "preference_probabilities": None,
                }
            )
            suffix += 1

        model, predictions = _build_preference_model(events)

        self.assertEqual(model["status"], "quality_gate_failed")
        self.assertEqual(
            model["held_out"]["log_loss"],
            round(math.log(3), PREFERENCE_QUALITY_DECIMAL_PLACES),
        )
        self.assertEqual(model["weights"], {})
        self.assertEqual(predictions, {})


if __name__ == "__main__":
    unittest.main()
