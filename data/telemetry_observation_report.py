#!/usr/bin/env python3
"""Render the aggregate-only D1 observation section for GitHub Actions."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


class ObservationReportError(ValueError):
    """Raised when Wrangler output does not match the expected contract."""


def find_field(value: Any, field: str) -> Any:
    """Find the first matching field in Wrangler's nested JSON responses."""
    if isinstance(value, dict):
        if field in value:
            return value[field]
        for child in value.values():
            found = find_field(child, field)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_field(child, field)
            if found is not None:
                return found
    return None


def non_negative_integer(value: Any, description: str) -> int:
    if isinstance(value, bool):
        raise ObservationReportError(f"{description} is not an integer")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and value.isdecimal():
        parsed = int(value)
    else:
        raise ObservationReportError(f"{description} is not an integer")
    if parsed < 0:
        raise ObservationReportError(f"{description} is negative")
    return parsed


def parse_observation(
    info: Any,
    retention: Any,
) -> tuple[int, int]:
    """Extract database bytes and old-row count from pinned Wrangler output."""
    # Wrangler 4.112.0 converts the Cloudflare API's `file_size` field to
    # `database_size` before emitting JSON. Retain the API name as a
    # compatibility fallback for older/newer output shapes.
    size_value = find_field(info, "database_size")
    if size_value is None:
        size_value = find_field(info, "file_size")
    size_bytes = non_negative_integer(
        size_value,
        "D1 database_size/file_size",
    )
    older_rows = non_negative_integer(
        find_field(retention, "older_than_14_days_count"),
        "rows-older-than-14-days count",
    )
    return size_bytes, older_rows


def append_summary(
    path: Path,
    size_bytes: int,
    older_rows: int,
) -> None:
    with path.open("a", encoding="utf-8") as summary:
        summary.write("### Telemetry D1 observation report\n\n")
        summary.write(f"- Database size: {size_bytes:,} bytes\n")
        summary.write(f"- Rows older than 14 days: {older_rows:,}\n")
        summary.write("- Rows deleted: 0 (deletion is disabled)\n")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Append aggregate D1 telemetry observations to a job summary."
    )
    parser.add_argument("info", type=Path, help="wrangler d1 info --json output")
    parser.add_argument(
        "retention",
        type=Path,
        help="wrangler d1 execute --json retention-count output",
    )
    parser.add_argument("summary", type=Path, help="GitHub job summary path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        info = json.loads(args.info.read_text(encoding="utf-8"))
        retention = json.loads(args.retention.read_text(encoding="utf-8"))
        size_bytes, older_rows = parse_observation(info, retention)
        append_summary(args.summary, size_bytes, older_rows)
    except (OSError, json.JSONDecodeError, ObservationReportError) as error:
        print(f"D1 observation report failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
