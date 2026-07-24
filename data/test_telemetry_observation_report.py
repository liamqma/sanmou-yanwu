"""Tests for the aggregate-only D1 workflow observation report."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from data.telemetry_observation_report import (
    ObservationReportError,
    main,
    parse_observation,
)


class TelemetryObservationReportTests(unittest.TestCase):
    def test_parses_wrangler_4_112_database_size_and_nested_query_result(
        self,
    ) -> None:
        info = {
            "uuid": "database-id",
            "name": "TELEMETRY_DB",
            "database_size": 1_234_567,
        }
        retention = [
            {
                "results": [{"older_than_14_days_count": 42}],
                "success": True,
            }
        ]

        self.assertEqual(
            parse_observation(info, retention),
            (1_234_567, 42),
        )

    def test_accepts_file_size_as_compatibility_fallback(self) -> None:
        self.assertEqual(
            parse_observation(
                {"file_size": "4096"},
                {"older_than_14_days_count": "0"},
            ),
            (4096, 0),
        )

    def test_rejects_missing_or_invalid_values(self) -> None:
        cases = (
            ({}, {"older_than_14_days_count": 0}),
            ({"database_size": -1}, {"older_than_14_days_count": 0}),
            ({"database_size": True}, {"older_than_14_days_count": 0}),
            ({"database_size": 1.5}, {"older_than_14_days_count": 0}),
            ({"database_size": 1}, {}),
        )
        for info, retention in cases:
            with self.subTest(info=info, retention=retention):
                with self.assertRaises(ObservationReportError):
                    parse_observation(info, retention)

    def test_main_appends_only_aggregate_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            info_path = directory / "info.json"
            retention_path = directory / "retention.json"
            summary_path = directory / "summary.md"
            info_path.write_text(
                json.dumps({"database_size": 2048}),
                encoding="utf-8",
            )
            retention_path.write_text(
                json.dumps(
                    [
                        {
                            "results": [
                                {"older_than_14_days_count": 7}
                            ]
                        }
                    ]
                ),
                encoding="utf-8",
            )

            exit_code = main(
                [
                    str(info_path),
                    str(retention_path),
                    str(summary_path),
                ]
            )

            self.assertEqual(exit_code, 0)
            self.assertEqual(
                summary_path.read_text(encoding="utf-8"),
                (
                    "### Telemetry D1 observation report\n\n"
                    "- Database size: 2,048 bytes\n"
                    "- Rows older than 14 days: 7\n"
                    "- Rows deleted: 0 (deletion is disabled)\n"
                ),
            )


if __name__ == "__main__":
    unittest.main()
