"""Tests for safe D1 AUTOINCREMENT migration and bounded retention."""
from __future__ import annotations

import contextlib
import io
import json
import sqlite3
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from telemetry_incremental_state import new_state  # noqa: E402
from telemetry_retention import (  # noqa: E402
    MAX_PURGE_ROWS,
    TelemetryRetentionError,
    append_remaining_old_rows,
    append_rows_deleted,
    evaluate_preflight,
    load_canonical_table_sql,
    load_json_document,
    load_validated_cursor,
    main,
    parse_remaining_old_rows,
    parse_rows_deleted,
    parse_table_snapshot,
    render_bounded_purge_sql,
    schema_has_autoincrement,
    verify_migration,
    write_bounded_purge_sql,
)


ROOT = Path(__file__).resolve().parent.parent
CANONICAL_MIGRATION = ROOT / "web/migrations/0001_round_telemetry.sql"
UPGRADE_MIGRATION = (
    ROOT / "web/migrations/0002_round_telemetry_autoincrement.sql"
)
UPDATE_WORKFLOW = ROOT / ".github/workflows/update-telemetry-data.yml"
INSERT_SQL = """
INSERT INTO "round_telemetry" (
    "id",
    "event_id",
    "session_id",
    "client_ts",
    "received_at",
    "round_number",
    "round_type",
    "schema_version",
    "model_version",
    "catalog_version",
    "pool_before_json",
    "offered_sets_json",
    "paired_scores_json",
    "recommended_index",
    "chosen_index",
    "preference_model_version",
    "preference_probs_json"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _row(identifier: int, *, round_number: int = 1) -> tuple[object, ...]:
    return (
        identifier,
        f"00000000-0000-4000-8000-{identifier:012d}",
        f"10000000-0000-4000-8000-{identifier:012d}",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01 00:00:01",
        round_number,
        "hero" if round_number in {1, 4, 7} else "skill",
        1,
        "1:0123456789abcdef",
        "fedcba9876543210",
        '{"heroes":[],"skills":[]}',
        '[["a"],["b"],["c"]]',
        "[1,2,3]",
        2,
        1,
        None,
        None,
    )


def _metadata(
    table_sql: str,
    *,
    row_count: int,
    min_id: int | None,
    max_id: int | None,
    sequence_value: int | None = None,
    include_sequence: bool = False,
) -> list[dict[str, object]]:
    row: dict[str, object] = {
        "table_sql": table_sql,
        "row_count": row_count,
        "min_id": min_id,
        "max_id": max_id,
    }
    if include_sequence:
        row["sequence_value"] = sequence_value
    return [{"results": [row], "success": True}]


def _write_state(path: Path, cursor: int) -> None:
    state = new_state("test-catalog")
    state["cursor"]["last_processed_id"] = cursor
    path.write_text(
        json.dumps(state, ensure_ascii=False),
        encoding="utf-8",
    )


class TelemetryMigrationTests(unittest.TestCase):
    def test_upgrade_preserves_every_column_id_and_constraint(self) -> None:
        canonical_sql = CANONICAL_MIGRATION.read_text(encoding="utf-8")
        old_sql = canonical_sql.replace(" AUTOINCREMENT", "", 1)
        upgrade_sql = UPGRADE_MIGRATION.read_text(encoding="utf-8")
        self.assertNotRegex(upgrade_sql.upper(), r"\b(?:BEGIN|COMMIT)\b")

        connection = sqlite3.connect(":memory:")
        connection.executescript(old_sql)
        rows = [_row(4), _row(9, round_number=2)]
        connection.executemany(INSERT_SQL, rows)
        columns_before = [
            row[1]
            for row in connection.execute(
                'PRAGMA table_info("round_telemetry")'
            )
        ]
        values_before = connection.execute(
            'SELECT * FROM "round_telemetry" ORDER BY "id"'
        ).fetchall()

        connection.executescript(upgrade_sql)

        columns_after = [
            row[1]
            for row in connection.execute(
                'PRAGMA table_info("round_telemetry")'
            )
        ]
        values_after = connection.execute(
            'SELECT * FROM "round_telemetry" ORDER BY "id"'
        ).fetchall()
        table_sql = connection.execute(
            "SELECT sql FROM sqlite_master "
            "WHERE type = 'table' AND name = 'round_telemetry'"
        ).fetchone()[0]
        sequence = connection.execute(
            "SELECT seq FROM sqlite_sequence "
            "WHERE name = 'round_telemetry'"
        ).fetchone()[0]

        self.assertEqual(columns_after, columns_before)
        self.assertEqual(values_after, values_before)
        self.assertTrue(schema_has_autoincrement(table_sql))
        self.assertEqual(sequence, 9)

        duplicate_event = list(_row(10, round_number=2))
        duplicate_event[1] = rows[0][1]
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(INSERT_SQL, duplicate_event)

        duplicate_session_round = list(_row(11))
        duplicate_session_round[2] = rows[0][2]
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(INSERT_SQL, duplicate_session_round)

        invalid_round = list(_row(12))
        invalid_round[5] = 9
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(INSERT_SQL, invalid_round)

        invalid_type = list(_row(13))
        invalid_type[6] = "other"
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(INSERT_SQL, invalid_type)

        invalid_position = list(_row(14))
        invalid_position[13] = 3
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(INSERT_SQL, invalid_position)
        connection.close()

    def test_delete_all_then_reinsert_never_reuses_an_id(self) -> None:
        old_sql = CANONICAL_MIGRATION.read_text(encoding="utf-8").replace(
            " AUTOINCREMENT",
            "",
            1,
        )
        connection = sqlite3.connect(":memory:")
        connection.executescript(old_sql)
        connection.executemany(INSERT_SQL, [_row(2), _row(8, round_number=2)])
        connection.executescript(
            UPGRADE_MIGRATION.read_text(encoding="utf-8")
        )
        connection.execute('DELETE FROM "round_telemetry"')

        values = list(_row(999, round_number=3))
        values.pop(0)
        cursor = connection.execute(
            """
            INSERT INTO "round_telemetry" (
                "event_id",
                "session_id",
                "client_ts",
                "received_at",
                "round_number",
                "round_type",
                "schema_version",
                "model_version",
                "catalog_version",
                "pool_before_json",
                "offered_sets_json",
                "paired_scores_json",
                "recommended_index",
                "chosen_index",
                "preference_model_version",
                "preference_probs_json"
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values,
        )
        self.assertEqual(cursor.lastrowid, 9)
        self.assertEqual(
            connection.execute(
                "SELECT seq FROM sqlite_sequence "
                "WHERE name = 'round_telemetry'"
            ).fetchone()[0],
            9,
        )
        connection.close()

    def test_canonical_schema_is_quoted_and_autoincrement(self) -> None:
        source = CANONICAL_MIGRATION.read_text(encoding="utf-8")
        self.assertIn('CREATE TABLE IF NOT EXISTS "round_telemetry"', source)
        self.assertIn('"id"                       INTEGER PRIMARY KEY AUTOINCREMENT', source)
        self.assertTrue(
            schema_has_autoincrement(
                load_canonical_table_sql(CANONICAL_MIGRATION)
            )
        )

    def test_workflow_executes_upgrade_without_a_wrangler_config(self) -> None:
        source = UPDATE_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "if: steps.retention_preflight.outputs.migration_required "
            "== 'true'",
            source,
        )
        self.assertIn(
            "--file=migrations/0002_round_telemetry_autoincrement.sql",
            source,
        )
        self.assertNotIn("d1 migrations apply", source)


class TelemetryRetentionMetadataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.canonical = load_canonical_table_sql(CANONICAL_MIGRATION)
        cls.old_schema = cls.canonical.replace(
            '"',
            "",
        ).replace(" AUTOINCREMENT", "", 1)

    def test_preflight_accepts_deployed_unquoted_schema_and_emits_status(
        self,
    ) -> None:
        snapshot = parse_table_snapshot(
            _metadata(
                self.old_schema,
                row_count=3,
                min_id=4,
                max_id=9,
            )
        )
        decision = evaluate_preflight(snapshot, 8, self.canonical)
        self.assertTrue(decision.migration_required)
        self.assertEqual(decision.status, "required")

        already_applied = parse_table_snapshot(
            _metadata(
                self.canonical,
                row_count=0,
                min_id=None,
                max_id=None,
            )
        )
        # Once AUTOINCREMENT exists, an empty table after a purge is safe only
        # after verify_migration independently checks sqlite_sequence.
        self.assertFalse(
            evaluate_preflight(
                already_applied,
                50,
                self.canonical,
            ).migration_required
        )

    def test_preflight_rejects_unmigrated_id_range_behind_cursor(self) -> None:
        for row_count, min_id, max_id in (
            (0, None, None),
            (2, 3, 5),
        ):
            with self.subTest(row_count=row_count):
                snapshot = parse_table_snapshot(
                    _metadata(
                        self.old_schema,
                        row_count=row_count,
                        min_id=min_id,
                        max_id=max_id,
                    )
                )
                with self.assertRaisesRegex(
                    TelemetryRetentionError,
                    "unsafe",
                ):
                    evaluate_preflight(snapshot, 6, self.canonical)

    def test_verify_requires_preserved_stats_autoincrement_and_safe_sequence(
        self,
    ) -> None:
        before = parse_table_snapshot(
            _metadata(
                self.old_schema,
                row_count=2,
                min_id=4,
                max_id=9,
            )
        )
        after = parse_table_snapshot(
            _metadata(
                self.canonical,
                row_count=2,
                min_id=4,
                max_id=9,
                sequence_value=9,
                include_sequence=True,
            ),
            require_sequence=True,
        )
        verify_migration(before, after, 8, self.canonical)

        unsafe_sequence = parse_table_snapshot(
            _metadata(
                self.canonical,
                row_count=2,
                min_id=4,
                max_id=9,
                sequence_value=8,
                include_sequence=True,
            ),
            require_sequence=True,
        )
        with self.assertRaisesRegex(
            TelemetryRetentionError,
            "sqlite_sequence",
        ):
            verify_migration(before, unsafe_sequence, 8, self.canonical)

        changed_stats = parse_table_snapshot(
            _metadata(
                self.canonical,
                row_count=1,
                min_id=9,
                max_id=9,
                sequence_value=9,
                include_sequence=True,
            ),
            require_sequence=True,
        )
        with self.assertRaisesRegex(
            TelemetryRetentionError,
            "statistics changed",
        ):
            verify_migration(before, changed_stats, 8, self.canonical)

        not_migrated = parse_table_snapshot(
            _metadata(
                self.old_schema,
                row_count=2,
                min_id=4,
                max_id=9,
                sequence_value=9,
                include_sequence=True,
            ),
            require_sequence=True,
        )
        with self.assertRaisesRegex(
            TelemetryRetentionError,
            "did not enable",
        ):
            verify_migration(before, not_migrated, 8, self.canonical)

    def test_verify_empty_purged_table_uses_sequence_as_cursor_guard(self) -> None:
        before = parse_table_snapshot(
            _metadata(
                self.canonical,
                row_count=0,
                min_id=None,
                max_id=None,
            )
        )
        after = parse_table_snapshot(
            _metadata(
                self.canonical,
                row_count=0,
                min_id=None,
                max_id=None,
                sequence_value=49,
                include_sequence=True,
            ),
            require_sequence=True,
        )
        with self.assertRaisesRegex(
            TelemetryRetentionError,
            "sqlite_sequence",
        ):
            verify_migration(before, after, 50, self.canonical)

    def test_malformed_wrangler_shapes_fail_closed(self) -> None:
        invalid_payloads: tuple[object, ...] = (
            {},
            [],
            [{"results": [], "success": False}],
            [{"results": "not-a-list", "success": True}],
            [{"results": [None], "success": True}],
            [
                {
                    "results": [
                        {
                            "table_sql": self.old_schema,
                            "row_count": True,
                            "min_id": None,
                            "max_id": None,
                        }
                    ],
                    "success": True,
                }
            ],
            [
                {
                    "results": [
                        {
                            "table_sql": self.old_schema,
                            "row_count": 1,
                            "min_id": None,
                            "max_id": 1,
                        }
                    ],
                    "success": True,
                }
            ],
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(TelemetryRetentionError):
                    parse_table_snapshot(payload)

    def test_strict_json_and_committed_state_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            malformed = directory / "malformed.json"
            duplicate = directory / "duplicate.json"
            nonstandard = directory / "nonstandard.json"
            state_path = directory / "state.json"
            malformed.write_text("{", encoding="utf-8")
            duplicate.write_text('{"value": 1, "value": 2}', encoding="utf-8")
            nonstandard.write_text('{"value": NaN}', encoding="utf-8")

            for path in (malformed, duplicate, nonstandard):
                with self.subTest(path=path.name):
                    with self.assertRaises(TelemetryRetentionError):
                        load_json_document(path, "test JSON")

            _write_state(state_path, 12)
            self.assertEqual(load_validated_cursor(state_path), 12)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["cursor"]["last_processed_id"] = "12"
            state_path.write_text(json.dumps(state), encoding="utf-8")
            with self.assertRaisesRegex(
                TelemetryRetentionError,
                "state is invalid",
            ):
                load_validated_cursor(state_path)

    def test_preflight_cli_writes_only_boolean_and_status_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            metadata_path = directory / "metadata.json"
            state_path = directory / "state.json"
            output_path = directory / "github-output"
            metadata_path.write_text(
                json.dumps(
                    _metadata(
                        self.old_schema,
                        row_count=1,
                        min_id=25,
                        max_id=25,
                    )
                ),
                encoding="utf-8",
            )
            _write_state(state_path, 25)
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main(
                    [
                        "preflight",
                        str(metadata_path),
                        str(state_path),
                        "--github-output",
                        str(output_path),
                    ]
                )

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                output_path.read_text(encoding="utf-8"),
                (
                    "migration_safe=true\n"
                    "migration_required=true\n"
                    "migration_status=required\n"
                ),
            )
            self.assertNotIn("25", stdout.getvalue())

    def test_reset_checkpoint_allows_explicit_replacement_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            before_path = directory / "before.json"
            after_path = directory / "after.json"
            state_path = directory / "state.json"
            before_path.write_text(
                json.dumps(
                    _metadata(
                        self.old_schema,
                        row_count=0,
                        min_id=None,
                        max_id=None,
                    )
                ),
                encoding="utf-8",
            )
            after_path.write_text(
                json.dumps(
                    _metadata(
                        self.canonical,
                        row_count=0,
                        min_id=None,
                        max_id=None,
                        sequence_value=0,
                        include_sequence=True,
                    )
                ),
                encoding="utf-8",
            )
            _write_state(state_path, 25)

            self.assertEqual(
                main(
                    [
                        "preflight",
                        str(before_path),
                        str(state_path),
                        "--reset-checkpoint",
                    ]
                ),
                0,
            )
            self.assertEqual(
                main(
                    [
                        "verify",
                        str(before_path),
                        str(after_path),
                        str(state_path),
                        "--reset-checkpoint",
                    ]
                ),
                0,
            )
            self.assertEqual(
                main(
                    [
                        "preflight",
                        str(before_path),
                        str(state_path),
                    ]
                ),
                1,
            )
            self.assertEqual(
                main(
                    [
                        "verify",
                        str(before_path),
                        str(after_path),
                        str(state_path),
                    ]
                ),
                1,
            )


class TelemetryPurgeTests(unittest.TestCase):
    def test_purge_sql_is_cursor_age_and_limit_bounded(self) -> None:
        sql = render_bounded_purge_sql(20_000)
        self.assertIn('"id" <= 20000', sql)
        self.assertIn("datetime('now', '-14 days')", sql)
        self.assertIn(f"LIMIT {MAX_PURGE_ROWS}", sql)
        self.assertNotIn("SELECT changes()", sql)
        self.assertEqual(sql.count(";"), 1)

        connection = sqlite3.connect(":memory:")
        connection.execute(
            'CREATE TABLE "round_telemetry" ('
            '"id" INTEGER PRIMARY KEY AUTOINCREMENT, '
            '"received_at" TEXT NOT NULL)'
        )
        connection.executemany(
            'INSERT INTO "round_telemetry" ("id", "received_at") '
            "VALUES (?, '2000-01-01 00:00:00')",
            ((identifier,) for identifier in range(1, 10_006)),
        )
        connection.execute(
            'INSERT INTO "round_telemetry" ("id", "received_at") '
            "VALUES (20001, '2000-01-01 00:00:00')"
        )
        connection.execute(
            'INSERT INTO "round_telemetry" ("id", "received_at") '
            "VALUES (20002, CURRENT_TIMESTAMP)"
        )
        connection.execute(sql)
        rows_deleted = connection.execute("SELECT changes()").fetchone()[0]

        self.assertEqual(rows_deleted, MAX_PURGE_ROWS)
        self.assertEqual(
            connection.execute(
                'SELECT COUNT(*) FROM "round_telemetry"'
            ).fetchone()[0],
            7,
        )
        self.assertEqual(
            connection.execute(
                'SELECT COUNT(*) FROM "round_telemetry" '
                'WHERE "id" IN (20001, 20002)'
            ).fetchone()[0],
            2,
        )
        connection.close()

    def test_purge_file_is_owner_only_and_uses_validated_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            state_path = directory / "state.json"
            sql_path = directory / "purge.sql"
            _write_state(state_path, 77)

            write_bounded_purge_sql(
                sql_path,
                load_validated_cursor(state_path),
            )

            self.assertEqual(
                stat.S_IMODE(sql_path.stat().st_mode),
                0o600,
            )
            self.assertIn('"id" <= 77', sql_path.read_text(encoding="utf-8"))

    def test_delete_result_parsing_and_summary_are_aggregate_only(self) -> None:
        payload = [
            {
                "results": [],
                "success": True,
                "meta": {"changes": "7", "rows_written": 21},
            }
        ]
        self.assertEqual(parse_rows_deleted(payload), 7)
        self.assertEqual(
            parse_remaining_old_rows(
                [
                    {
                        "results": [{"remaining_old_row_count": "0"}],
                        "success": True,
                    }
                ]
            ),
            0,
        )

        with tempfile.TemporaryDirectory() as directory_name:
            summary_path = Path(directory_name) / "summary.md"
            summary_path.write_text(
                "### Telemetry D1 retention report\n\n",
                encoding="utf-8",
            )
            append_rows_deleted(summary_path, 7)
            append_remaining_old_rows(summary_path, 0)
            self.assertEqual(
                summary_path.read_text(encoding="utf-8"),
                (
                    "### Telemetry D1 retention report\n\n"
                    "- Rows deleted: 7\n"
                    "- Rows still older than the retention window: 0\n"
                ),
            )

        invalid_payloads = (
            [
                {
                    "results": [],
                    "success": True,
                    "meta": {"changes": MAX_PURGE_ROWS + 1},
                }
            ],
            [{"results": [], "success": True, "meta": {"changes": True}}],
            [{"results": [], "success": True, "meta": {}}],
            [
                {
                    "results": [],
                    "success": True,
                    "meta": {"changes": 1},
                },
                {
                    "results": [],
                    "success": True,
                    "meta": {"changes": 2},
                }
            ],
            [{"results": [], "success": False, "meta": {"changes": 1}}],
            [{"results": "not-a-list", "success": True, "meta": {"changes": 1}}],
        )
        for invalid in invalid_payloads:
            with self.subTest(payload=invalid):
                with self.assertRaises(TelemetryRetentionError):
                    parse_rows_deleted(invalid)

        invalid_backlogs = (
            [{"results": [], "success": True}],
            [
                {
                    "results": [
                        {
                            "remaining_old_row_count": 0,
                            "unexpected": 1,
                        }
                    ],
                    "success": True,
                }
            ],
            [
                {
                    "results": [{"remaining_old_row_count": True}],
                    "success": True,
                }
            ],
        )
        for invalid in invalid_backlogs:
            with self.subTest(payload=invalid):
                with self.assertRaises(TelemetryRetentionError):
                    parse_remaining_old_rows(invalid)

    def test_report_delete_fails_after_reporting_a_backlog(self) -> None:
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            delete_path = directory / "delete.json"
            remaining_path = directory / "remaining.json"
            summary_path = directory / "summary.md"
            delete_path.write_text(
                json.dumps(
                    [
                        {
                            "results": [],
                            "success": True,
                            "meta": {"changes": MAX_PURGE_ROWS},
                        }
                    ]
                ),
                encoding="utf-8",
            )
            remaining_path.write_text(
                json.dumps(
                    [
                        {
                            "results": [
                                {"remaining_old_row_count": 3}
                            ],
                            "success": True,
                        }
                    ]
                ),
                encoding="utf-8",
            )
            summary_path.write_text("", encoding="utf-8")

            with contextlib.redirect_stderr(io.StringIO()):
                exit_code = main(
                    [
                        "report-delete",
                        str(delete_path),
                        str(summary_path),
                        "--remaining",
                        str(remaining_path),
                    ]
                )

            self.assertEqual(exit_code, 1)
            self.assertEqual(
                summary_path.read_text(encoding="utf-8"),
                (
                    f"- Rows deleted: {MAX_PURGE_ROWS:,}\n"
                    "- Rows still older than the retention window: 3\n"
                ),
            )


if __name__ == "__main__":
    unittest.main()
