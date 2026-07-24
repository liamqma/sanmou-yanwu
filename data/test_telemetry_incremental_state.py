"""Tests for the aggregate-only incremental telemetry checkpoint."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_telemetry_data import (  # noqa: E402
    InvalidTelemetryError,
    build,
    load_catalog,
    load_event_batch,
)
from telemetry_incremental_state import (  # noqa: E402
    SESSION_HLL_REGISTER_COUNT,
    estimated_session_count,
    fold_events,
    online_model_snapshot,
    state_aggregate_snapshot,
    validate_state,
)
from test_build_telemetry_data import (  # noqa: E402
    MIGRATION,
    _event,
    _write_catalog,
    _write_export,
)


class IncrementalTelemetryStateTests(unittest.TestCase):
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
        self.state_path = self.directory / "telemetry_state.json"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _build(self) -> dict:
        return build(
            self.export_path,
            self.database_path,
            self.recommendation_path,
            self.output_path,
            state_path=self.state_path,
        )

    def _load_state(self) -> dict:
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def test_missing_state_bootstraps_and_replay_is_byte_identical(self) -> None:
        rows = [
            _event(self.catalog_version, suffix=1, round_number=1),
            _event(
                self.catalog_version,
                suffix=2,
                round_number=2,
                chosen_index=1,
            ),
        ]
        _write_export(self.export_path, rows)

        artifact = self._build()
        state_bytes = self.state_path.read_bytes()
        artifact_bytes = self.output_path.read_bytes()
        state = self._load_state()

        self.assertEqual(state["cursor"]["last_processed_id"], 2)
        self.assertEqual(state["summary"]["event_count"], 2)
        self.assertEqual(
            state["summary"]["recommendation_accepted_count"],
            artifact["summary"]["recommendation_accepted_count"],
        )
        self.assertGreaterEqual(estimated_session_count(state), 1)
        self.assertEqual(
            len(state["summary"]["session_hll"]["registers"]),
            SESSION_HLL_REGISTER_COUNT,
        )

        artifact_again = self._build()
        self.assertEqual(artifact_again, artifact)
        self.assertEqual(self.state_path.read_bytes(), state_bytes)
        self.assertEqual(self.output_path.read_bytes(), artifact_bytes)

    def test_split_batches_preserve_cumulative_public_aggregates(self) -> None:
        rows = [
            _event(
                self.catalog_version,
                suffix=index,
                round_number=(index % 6) + 1,
                chosen_index=index % 3,
            )
            for index in range(1, 31)
        ]
        _write_export(self.export_path, rows)
        contract = load_catalog(
            self.database_path,
            self.recommendation_path,
        )
        events, invalid_count, last_id = load_event_batch(
            self.export_path,
            MIGRATION,
            contract,
        )

        one_shot = fold_events(
            None,
            events,
            catalog_version=self.catalog_version,
            last_processed_id=last_id,
            invalid_event_count=invalid_count,
        )
        midpoint = 13
        first = fold_events(
            None,
            events[:midpoint],
            catalog_version=self.catalog_version,
            last_processed_id=events[midpoint - 1]["row_id"],
        )
        split = fold_events(
            first,
            events[midpoint:],
            catalog_version=self.catalog_version,
            last_processed_id=last_id,
        )

        self.assertEqual(
            state_aggregate_snapshot(split),
            state_aggregate_snapshot(one_shot),
        )
        self.assertEqual(
            split["cursor"]["last_processed_id"],
            one_shot["cursor"]["last_processed_id"],
        )

    def test_invalid_rows_advance_cursor_once(self) -> None:
        invalid = list(_event(self.catalog_version, suffix=1))
        invalid[9] = "{not-json"
        valid = _event(
            self.catalog_version,
            suffix=2,
            round_number=2,
        )
        _write_export(self.export_path, [tuple(invalid), valid])
        contract = load_catalog(
            self.database_path,
            self.recommendation_path,
        )

        events, invalid_count, last_id = load_event_batch(
            self.export_path,
            MIGRATION,
            contract,
        )
        state = fold_events(
            None,
            events,
            catalog_version=self.catalog_version,
            last_processed_id=last_id,
            invalid_event_count=invalid_count,
        )
        replay_events, replay_invalid, replay_last_id = load_event_batch(
            self.export_path,
            MIGRATION,
            contract,
            after_id=state["cursor"]["last_processed_id"],
        )
        replayed = fold_events(
            state,
            replay_events,
            catalog_version=self.catalog_version,
            last_processed_id=replay_last_id,
            invalid_event_count=replay_invalid,
        )

        self.assertEqual(state["cursor"]["last_processed_id"], 2)
        self.assertEqual(state["summary"]["event_count"], 1)
        self.assertEqual(state["summary"]["invalid_event_count"], 1)
        self.assertEqual(replayed, state)

    def test_state_contains_no_raw_or_stable_client_identifiers(self) -> None:
        row = _event(self.catalog_version, suffix=987, round_number=4)
        _write_export(self.export_path, [row])
        self._build()
        serialized = self.state_path.read_text(encoding="utf-8")
        state = self._load_state()

        for forbidden in (
            row[0],
            row[1],
            '"event_id"',
            '"session_id"',
            '"client_ts"',
            '"received_at"',
            '"pool_before"',
            '"offered_sets"',
            '"paired_scores"',
        ):
            self.assertNotIn(forbidden, serialized)
        self.assertEqual(state["preference_model"]["support"], {})
        self.assertEqual(state["preference_model"]["z"], {})
        self.assertEqual(state["preference_model"]["n"], {})
        self.assertEqual(
            state["preference_model"]["evaluation"]["event_count"],
            0,
        )
        self.assertEqual(
            state["rounds"]["4"]["preference_top_disagreement_count"],
            0,
        )

    def test_optimizer_state_waits_for_ten_event_support(self) -> None:
        nine_rows = [
            _event(
                self.catalog_version,
                suffix=index,
                round_number=1,
                chosen_index=index % 3,
            )
            for index in range(1, 10)
        ]
        _write_export(self.export_path, nine_rows)
        self._build()
        below_threshold = self._load_state()["preference_model"]

        self.assertEqual(below_threshold["support"], {})
        self.assertEqual(below_threshold["z"], {})
        self.assertEqual(below_threshold["n"], {})

        ten_rows = [
            *nine_rows,
            _event(
                self.catalog_version,
                suffix=10,
                round_number=1,
                chosen_index=1,
            ),
        ]
        _write_export(self.export_path, ten_rows)
        self.state_path.unlink()
        self._build()
        at_threshold = self._load_state()["preference_model"]

        self.assertEqual(at_threshold["minimum_persisted_event_support"], 10)
        self.assertTrue(at_threshold["support"])
        self.assertEqual(set(at_threshold["support"]), set(at_threshold["z"]))
        self.assertEqual(set(at_threshold["support"]), set(at_threshold["n"]))

        persisted_optimizer = {
            field: dict(at_threshold[field])
            for field in ("support", "z", "n")
        }
        persisted_evaluation = json.loads(
            json.dumps(at_threshold["evaluation"])
        )
        persisted_round_shadow = {
            field: self._load_state()["rounds"]["1"][field]
            for field in (
                "preference_top_disagreement_count",
                "meaningful_preference_disagreement_count",
                "player_preference_agreement_count",
                "meaningful_preference_disagreement_margin_total",
            )
        }
        eleven_rows = [
            *ten_rows,
            _event(
                self.catalog_version,
                suffix=11,
                round_number=1,
                chosen_index=2,
            ),
        ]
        _write_export(self.export_path, eleven_rows)
        self._build()
        after_private_delta = self._load_state()["preference_model"]

        for field, expected in persisted_optimizer.items():
            self.assertEqual(after_private_delta[field], expected)
        self.assertEqual(
            after_private_delta["evaluation"],
            persisted_evaluation,
        )
        state_after_private_delta = self._load_state()
        for field, expected in persisted_round_shadow.items():
            self.assertEqual(
                state_after_private_delta["rounds"]["1"][field],
                expected,
            )

    def test_unrecognized_preference_version_is_compacted_to_other(self) -> None:
        row = list(_event(self.catalog_version, suffix=1))
        untrusted_version = "preference-v9:deadbeefdeadbeef"
        row[14] = untrusted_version
        row[15] = json.dumps([0.2, 0.3, 0.5])
        _write_export(self.export_path, [tuple(row)])

        self._build()
        state = self._load_state()
        serialized = self.state_path.read_text(encoding="utf-8")

        self.assertNotIn(untrusted_version, serialized)
        self.assertEqual(
            state["summary"]["preference_model_version_counts"],
            {"other": 1},
        )

    def test_checkpoint_does_not_depend_on_preexisting_public_output(self) -> None:
        row = list(_event(self.catalog_version, suffix=1))
        row[14] = "preference-v1:0123456789abcdef"
        row[15] = json.dumps([0.2, 0.3, 0.5])
        _write_export(self.export_path, [tuple(row)])
        first_output = self.directory / "first-output.json"
        second_output = self.directory / "second-output.json"
        first_state = self.directory / "first-state.json"
        second_state = self.directory / "second-state.json"
        second_output.write_text(
            json.dumps(
                {
                    "summary": {
                        "preference_model_versions": [
                            {
                                "version": row[14],
                                "event_count": 10,
                            }
                        ]
                    }
                }
            ),
            encoding="utf-8",
        )

        build(
            self.export_path,
            self.database_path,
            self.recommendation_path,
            first_output,
            state_path=first_state,
        )
        build(
            self.export_path,
            self.database_path,
            self.recommendation_path,
            second_output,
            state_path=second_state,
        )

        self.assertEqual(first_state.read_bytes(), second_state.read_bytes())
        self.assertEqual(first_output.read_bytes(), second_output.read_bytes())

    def test_online_model_preview_is_finite_and_versioned(self) -> None:
        rows = [
            _event(
                self.catalog_version,
                suffix=index,
                round_number=1,
                chosen_index=0 if index % 3 else 1,
            )
            for index in range(1, 16)
        ]
        _write_export(self.export_path, rows)
        self._build()

        preview = online_model_snapshot(self._load_state())

        self.assertEqual(preview["algorithm"], "ftrl-proximal")
        self.assertEqual(preview["evaluation"]["method"], "prequential")
        self.assertEqual(preview["evaluation"]["event_count"], len(rows))
        self.assertRegex(
            preview["version"],
            r"^preference-v2:[0-9a-f]{16}$",
        )
        self.assertTrue(preview["weights"])
        self.assertEqual(set(preview["weights"]), set(preview["support"]))

    def test_corrupt_or_incompatible_state_fails_closed(self) -> None:
        _write_export(
            self.export_path,
            [
                _event(
                    self.catalog_version,
                    suffix=index,
                    round_number=1,
                )
                for index in range(1, 16)
            ],
        )
        self._build()
        state = self._load_state()

        corrupt = json.loads(json.dumps(state))
        corrupt["preference_model"]["n"][next(iter(corrupt["preference_model"]["n"]))] = -1
        with self.assertRaisesRegex(InvalidTelemetryError, "optimizer n"):
            validate_state(corrupt, self.catalog_version)

        incompatible = json.loads(json.dumps(state))
        incompatible["catalog_version"] = "different"
        with self.assertRaisesRegex(InvalidTelemetryError, "catalog"):
            validate_state(incompatible, self.catalog_version)

        labelled_version = json.loads(json.dumps(state))
        labelled_version["summary"]["preference_model_version_counts"] = {
            "preference-v1:0123456789abcdef": 1
        }
        labelled_version["summary"]["preference_event_count"] = 1
        with self.assertRaisesRegex(InvalidTelemetryError, "version labels"):
            validate_state(labelled_version, self.catalog_version)

    def test_cursor_regression_and_out_of_order_events_fail(self) -> None:
        rows = [
            _event(self.catalog_version, suffix=1),
            _event(self.catalog_version, suffix=2, round_number=2),
        ]
        _write_export(self.export_path, rows)
        contract = load_catalog(
            self.database_path,
            self.recommendation_path,
        )
        events, invalid_count, last_id = load_event_batch(
            self.export_path,
            MIGRATION,
            contract,
        )
        state = fold_events(
            None,
            events,
            catalog_version=self.catalog_version,
            last_processed_id=last_id,
            invalid_event_count=invalid_count,
        )

        with self.assertRaisesRegex(InvalidTelemetryError, "behind"):
            fold_events(
                state,
                [],
                catalog_version=self.catalog_version,
                last_processed_id=last_id - 1,
            )
        with self.assertRaisesRegex(InvalidTelemetryError, "ID-ordered"):
            fold_events(
                None,
                reversed(events),
                catalog_version=self.catalog_version,
                last_processed_id=last_id,
            )

    def test_state_path_cannot_overwrite_build_inputs_or_public_output(self) -> None:
        _write_export(
            self.export_path,
            [_event(self.catalog_version, suffix=1)],
        )

        for conflicting_path in (self.export_path, self.output_path):
            with self.subTest(path=conflicting_path.name):
                with self.assertRaisesRegex(
                    InvalidTelemetryError,
                    "must not overwrite",
                ):
                    build(
                        self.export_path,
                        self.database_path,
                        self.recommendation_path,
                        self.output_path,
                        state_path=conflicting_path,
                    )


if __name__ == "__main__":
    unittest.main()
