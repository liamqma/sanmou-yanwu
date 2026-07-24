#!/usr/bin/env python3
"""Fail-closed helpers for the bounded D1 telemetry-retention workflow.

The workflow deliberately passes only aggregate query results to this module.
No command prints a D1 row ID, cursor value, event, or identifier.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from telemetry_incremental_state import validate_state


MAX_PURGE_ROWS = 10_000
RETENTION_DAYS = 14
TABLE_NAME = "round_telemetry"
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CANONICAL_MIGRATION = (
    ROOT / "web/migrations/0001_round_telemetry.sql"
)

_EXPECTED_COLUMNS = (
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
    "preference_probs_json",
)
_TABLE_PREFIX_RE = re.compile(
    r'^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?'
    r'(?:"round_telemetry"|`round_telemetry`|\[round_telemetry\]|round_telemetry)'
    r"\s*\(",
    re.IGNORECASE,
)
_ID_PRIMARY_KEY_RE = re.compile(
    r'(?:^|[,(])\s*(?:"id"|`id`|\[id\]|id)\s+'
    r"INTEGER\s+PRIMARY\s+KEY"
    r"(?P<autoincrement>\s+AUTOINCREMENT)?(?=\s*[,)]|\s*$)",
    re.IGNORECASE | re.DOTALL,
)
_QUOTED_IDENTIFIER_RE = re.compile(r'"([A-Za-z_][A-Za-z0-9_]*)"')


class TelemetryRetentionError(ValueError):
    """Raised when a retention precondition or aggregate result is unsafe."""


@dataclass(frozen=True, repr=False)
class TableSnapshot:
    """Aggregate-only table metadata returned by one Wrangler query."""

    table_sql: str
    row_count: int
    min_id: int | None
    max_id: int | None
    sequence_value: int | None = None


@dataclass(frozen=True)
class MigrationDecision:
    """Safe workflow status without row-level or cursor-level details."""

    migration_required: bool

    @property
    def status(self) -> str:
        return "required" if self.migration_required else "already-applied"


def _reject_constant(value: str) -> None:
    raise TelemetryRetentionError("JSON contains a non-standard number")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise TelemetryRetentionError("JSON contains a duplicate object key")
        result[key] = value
    return result


def load_json_document(path: Path, description: str) -> Any:
    """Load strict JSON without echoing potentially sensitive input."""
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except OSError as exc:
        raise TelemetryRetentionError(
            f"cannot read {description}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise TelemetryRetentionError(
            f"{description} is not valid JSON"
        ) from exc


def _non_negative_integer(value: Any, description: str) -> int:
    if isinstance(value, bool):
        raise TelemetryRetentionError(f"{description} is not an integer")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and value.isdecimal():
        parsed = int(value)
    else:
        raise TelemetryRetentionError(f"{description} is not an integer")
    if parsed < 0:
        raise TelemetryRetentionError(f"{description} is negative")
    return parsed


def _positive_integer(value: Any, description: str) -> int:
    parsed = _non_negative_integer(value, description)
    if parsed == 0:
        raise TelemetryRetentionError(f"{description} is not positive")
    return parsed


def _find_wrangler_executions(value: Any) -> list[Mapping[str, Any]]:
    executions: list[Mapping[str, Any]] = []

    def visit(child: Any) -> None:
        if isinstance(child, dict):
            if "results" in child:
                executions.append(child)
                return
            for nested in child.values():
                visit(nested)
        elif isinstance(child, list):
            for nested in child:
                visit(nested)

    visit(value)
    if not executions:
        raise TelemetryRetentionError(
            "Wrangler JSON contains no query execution"
        )
    return executions


def _wrangler_result_rows(value: Any) -> list[Mapping[str, Any]]:
    rows: list[Mapping[str, Any]] = []
    for execution in _find_wrangler_executions(value):
        if execution.get("success") is not True:
            raise TelemetryRetentionError("Wrangler query was not successful")
        execution_rows = execution["results"]
        if not isinstance(execution_rows, list):
            raise TelemetryRetentionError(
                "Wrangler query results are malformed"
            )
        for row in execution_rows:
            if not isinstance(row, dict):
                raise TelemetryRetentionError(
                    "Wrangler query result row is malformed"
                )
            rows.append(row)
    return rows


def _optional_id(
    row: Mapping[str, Any],
    field: str,
    description: str,
) -> int | None:
    if field not in row:
        raise TelemetryRetentionError(f"{description} is missing")
    value = row[field]
    if value is None:
        return None
    return _positive_integer(value, description)


def parse_table_snapshot(
    wrangler_json: Any,
    *,
    require_sequence: bool = False,
) -> TableSnapshot:
    """Parse one aggregate table-metadata row from Wrangler JSON."""
    rows = _wrangler_result_rows(wrangler_json)
    if len(rows) != 1:
        raise TelemetryRetentionError(
            "Wrangler table metadata must contain exactly one aggregate row"
        )
    row = rows[0]
    table_sql = row.get("table_sql")
    if not isinstance(table_sql, str) or not table_sql.strip():
        raise TelemetryRetentionError("round_telemetry table SQL is missing")
    row_count = _non_negative_integer(
        row.get("row_count"),
        "round_telemetry row count",
    )
    min_id = _optional_id(row, "min_id", "minimum telemetry ID")
    max_id = _optional_id(row, "max_id", "maximum telemetry ID")
    if row_count == 0:
        if min_id is not None or max_id is not None:
            raise TelemetryRetentionError(
                "empty table metadata contains an ID range"
            )
    elif (
        min_id is None
        or max_id is None
        or min_id > max_id
        or row_count > max_id - min_id + 1
    ):
        raise TelemetryRetentionError(
            "non-empty table metadata has an invalid ID range"
        )

    sequence_value: int | None = None
    if require_sequence:
        if "sequence_value" not in row:
            raise TelemetryRetentionError(
                "round_telemetry sqlite_sequence value is missing"
            )
        sequence_value = _non_negative_integer(
            row["sequence_value"],
            "round_telemetry sqlite_sequence value",
        )
    return TableSnapshot(
        table_sql=table_sql,
        row_count=row_count,
        min_id=min_id,
        max_id=max_id,
        sequence_value=sequence_value,
    )


def schema_has_autoincrement(table_sql: str) -> bool:
    """Validate the table target/id declaration and return its ID mode."""
    stripped = table_sql.strip().rstrip(";")
    if ";" in stripped or _TABLE_PREFIX_RE.match(stripped) is None:
        raise TelemetryRetentionError(
            "round_telemetry table SQL is not a single expected CREATE TABLE"
        )
    primary_key = _ID_PRIMARY_KEY_RE.search(stripped)
    if primary_key is None:
        raise TelemetryRetentionError(
            "round_telemetry ID is not an INTEGER PRIMARY KEY"
        )
    return primary_key.group("autoincrement") is not None


def _schema_comparison_key(table_sql: str) -> str:
    schema_has_autoincrement(table_sql)
    normalized = _QUOTED_IDENTIFIER_RE.sub(r"\1", table_sql)
    normalized = re.sub(
        r"\bIF\s+NOT\s+EXISTS\b",
        "",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bAUTOINCREMENT\b",
        "",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\s*,\s*", ",", normalized)
    normalized = re.sub(r"\(\s*", "(", normalized)
    normalized = re.sub(r"\s*\)", ")", normalized)
    return " ".join(normalized.rstrip(";").split()).casefold()


def load_canonical_table_sql(path: Path) -> str:
    """Load the final schema through SQLite, matching sqlite_master output."""
    try:
        migration_sql = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise TelemetryRetentionError(
            "cannot read canonical telemetry migration"
        ) from exc
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(migration_sql)
        row = connection.execute(
            "SELECT sql FROM sqlite_master "
            "WHERE type = 'table' AND name = ?",
            (TABLE_NAME,),
        ).fetchone()
        objects = connection.execute(
            "SELECT type, name FROM sqlite_master "
            "WHERE name NOT LIKE 'sqlite_%'"
        ).fetchall()
    except sqlite3.Error as exc:
        raise TelemetryRetentionError(
            "canonical telemetry migration is invalid"
        ) from exc
    finally:
        connection.close()
    if row is None or len(objects) != 1:
        raise TelemetryRetentionError(
            "canonical telemetry migration has unexpected objects"
        )
    table_sql = row[0]
    if not isinstance(table_sql, str) or not schema_has_autoincrement(table_sql):
        raise TelemetryRetentionError(
            "canonical telemetry migration is not AUTOINCREMENT"
        )
    return table_sql


def _validate_schema_compatibility(
    table_sql: str,
    canonical_table_sql: str,
) -> None:
    if (
        _schema_comparison_key(table_sql)
        != _schema_comparison_key(canonical_table_sql)
    ):
        raise TelemetryRetentionError(
            "round_telemetry schema is incompatible with the migration"
        )


def load_validated_cursor(path: Path) -> int:
    """Read the committed aggregate checkpoint and return its safe cursor."""
    state = load_json_document(path, "committed telemetry state")
    try:
        validate_state(state)
    except (TypeError, ValueError) as exc:
        raise TelemetryRetentionError(
            "committed telemetry state is invalid"
        ) from exc
    cursor = state["cursor"]["last_processed_id"]
    return _non_negative_integer(cursor, "committed telemetry cursor")


def evaluate_preflight(
    snapshot: TableSnapshot,
    cursor: int,
    canonical_table_sql: str,
) -> MigrationDecision:
    """Refuse an unsafe rebuild and decide whether migration 0002 is needed."""
    cursor = _non_negative_integer(cursor, "committed telemetry cursor")
    _validate_schema_compatibility(snapshot.table_sql, canonical_table_sql)
    migration_required = not schema_has_autoincrement(snapshot.table_sql)
    if (
        migration_required
        and (
            (snapshot.max_id is None and cursor != 0)
            or (
                snapshot.max_id is not None
                and snapshot.max_id < cursor
            )
        )
    ):
        raise TelemetryRetentionError(
            "AUTOINCREMENT migration is unsafe for the committed cursor"
        )
    return MigrationDecision(migration_required=migration_required)


def verify_migration(
    before: TableSnapshot,
    after: TableSnapshot,
    cursor: int,
    canonical_table_sql: str,
) -> None:
    """Verify the rebuild preserved rows and established a safe sequence."""
    cursor = _non_negative_integer(cursor, "committed telemetry cursor")
    _validate_schema_compatibility(before.table_sql, canonical_table_sql)
    _validate_schema_compatibility(after.table_sql, canonical_table_sql)
    if not schema_has_autoincrement(after.table_sql):
        raise TelemetryRetentionError(
            "round_telemetry migration did not enable AUTOINCREMENT"
        )
    if (
        before.row_count,
        before.min_id,
        before.max_id,
    ) != (
        after.row_count,
        after.min_id,
        after.max_id,
    ):
        raise TelemetryRetentionError(
            "round_telemetry row statistics changed during migration"
        )
    if after.sequence_value is None:
        raise TelemetryRetentionError(
            "round_telemetry sqlite_sequence value is missing"
        )
    required_sequence = max(after.max_id or 0, cursor)
    if after.sequence_value < required_sequence:
        raise TelemetryRetentionError(
            "round_telemetry sqlite_sequence is behind retained history"
        )


def render_bounded_purge_sql(cursor: int) -> str:
    """Create the private runner-temporary bounded deletion batch."""
    cursor = _non_negative_integer(cursor, "committed telemetry cursor")
    return (
        'DELETE FROM "round_telemetry"\n'
        'WHERE "id" IN (\n'
        '    SELECT "id"\n'
        '    FROM "round_telemetry"\n'
        f'    WHERE "id" <= {cursor}\n'
        f"      AND \"received_at\" < datetime('now', '-{RETENTION_DAYS} days')\n"
        '    ORDER BY "id" ASC\n'
        f"    LIMIT {MAX_PURGE_ROWS}\n"
        ");\n"
    )


def write_bounded_purge_sql(path: Path, cursor: int) -> None:
    """Atomically write purge SQL with owner-only permissions."""
    content = render_bounded_purge_sql(cursor)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_name = handle.name
            os.chmod(temporary_name, 0o600)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def parse_rows_deleted(wrangler_json: Any) -> int:
    """Extract the affected-row count from one Wrangler command result."""
    executions = _find_wrangler_executions(wrangler_json)
    if len(executions) != 1:
        raise TelemetryRetentionError(
            "Wrangler delete result must contain exactly one execution"
        )
    execution = executions[0]
    if execution.get("success") is not True:
        raise TelemetryRetentionError("Wrangler delete was not successful")
    if not isinstance(execution.get("results"), list):
        raise TelemetryRetentionError("Wrangler delete results are malformed")
    metadata = execution.get("meta")
    if not isinstance(metadata, Mapping) or "changes" not in metadata:
        raise TelemetryRetentionError(
            "Wrangler delete metadata is missing the affected-row count"
        )
    rows_deleted = _non_negative_integer(
        metadata["changes"],
        "deleted-row count",
    )
    if rows_deleted > MAX_PURGE_ROWS:
        raise TelemetryRetentionError(
            "deleted-row count exceeds the bounded purge limit"
        )
    return rows_deleted


def parse_remaining_old_rows(wrangler_json: Any) -> int:
    """Extract one aggregate post-purge backlog count."""
    rows = _wrangler_result_rows(wrangler_json)
    if (
        len(rows) != 1
        or set(rows[0]) != {"remaining_old_row_count"}
    ):
        raise TelemetryRetentionError(
            "Wrangler backlog result must contain one aggregate count"
        )
    return _non_negative_integer(
        rows[0]["remaining_old_row_count"],
        "remaining old-row count",
    )


def append_rows_deleted(summary_path: Path, rows_deleted: int) -> None:
    rows_deleted = _non_negative_integer(
        rows_deleted,
        "deleted-row count",
    )
    if rows_deleted > MAX_PURGE_ROWS:
        raise TelemetryRetentionError(
            "deleted-row count exceeds the bounded purge limit"
        )
    with summary_path.open("a", encoding="utf-8") as summary:
        summary.write(f"- Rows deleted: {rows_deleted:,}\n")


def append_remaining_old_rows(
    summary_path: Path,
    remaining_old_rows: int,
) -> None:
    remaining_old_rows = _non_negative_integer(
        remaining_old_rows,
        "remaining old-row count",
    )
    with summary_path.open("a", encoding="utf-8") as summary:
        summary.write(
            "- Rows still older than the retention window: "
            f"{remaining_old_rows:,}\n"
        )


def _append_github_outputs(
    output_path: Path,
    decision: MigrationDecision,
) -> None:
    with output_path.open("a", encoding="utf-8") as output:
        required = "true" if decision.migration_required else "false"
        output.write("migration_safe=true\n")
        output.write(f"migration_required={required}\n")
        output.write(f"migration_status={decision.status}\n")


def _add_canonical_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--canonical",
        type=Path,
        default=DEFAULT_CANONICAL_MIGRATION,
        help="final canonical round_telemetry migration",
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and execute aggregate-only D1 retention steps."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    preflight = commands.add_parser(
        "preflight",
        help="validate pre-migration metadata and emit safe migration status",
    )
    preflight.add_argument("metadata", type=Path)
    preflight.add_argument("state", type=Path)
    preflight.add_argument("--github-output", type=Path)
    preflight.add_argument(
        "--reset-checkpoint",
        action="store_true",
        help="explicitly treat the validated committed cursor as zero",
    )
    _add_canonical_argument(preflight)

    verify = commands.add_parser(
        "verify",
        help="verify AUTOINCREMENT, row preservation, and sqlite_sequence",
    )
    verify.add_argument("before_metadata", type=Path)
    verify.add_argument("after_metadata", type=Path)
    verify.add_argument("state", type=Path)
    verify.add_argument(
        "--reset-checkpoint",
        action="store_true",
        help="explicitly treat the validated committed cursor as zero",
    )
    _add_canonical_argument(verify)

    purge = commands.add_parser(
        "write-purge",
        help="write private SQL for one bounded 14-day purge",
    )
    purge.add_argument("state", type=Path)
    purge.add_argument("output", type=Path)

    report = commands.add_parser(
        "report-delete",
        help="append the aggregate delete count to a GitHub summary",
    )
    report.add_argument("delete_result", type=Path)
    report.add_argument("summary", type=Path)
    report.add_argument(
        "--remaining",
        required=True,
        type=Path,
        help="post-purge aggregate old-row count",
    )

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "preflight":
            metadata = load_json_document(
                args.metadata,
                "Wrangler preflight metadata",
            )
            snapshot = parse_table_snapshot(metadata)
            committed_cursor = load_validated_cursor(args.state)
            cursor = 0 if args.reset_checkpoint else committed_cursor
            canonical = load_canonical_table_sql(args.canonical)
            decision = evaluate_preflight(snapshot, cursor, canonical)
            if args.github_output is not None:
                _append_github_outputs(args.github_output, decision)
            print(
                "Telemetry retention preflight passed; "
                f"AUTOINCREMENT migration status: {decision.status}."
            )
        elif args.command == "verify":
            before = parse_table_snapshot(
                load_json_document(
                    args.before_metadata,
                    "Wrangler pre-migration metadata",
                )
            )
            after = parse_table_snapshot(
                load_json_document(
                    args.after_metadata,
                    "Wrangler post-migration metadata",
                ),
                require_sequence=True,
            )
            committed_cursor = load_validated_cursor(args.state)
            cursor = 0 if args.reset_checkpoint else committed_cursor
            canonical = load_canonical_table_sql(args.canonical)
            verify_migration(before, after, cursor, canonical)
            print(
                "Telemetry AUTOINCREMENT migration verification passed."
            )
        elif args.command == "write-purge":
            cursor = load_validated_cursor(args.state)
            write_bounded_purge_sql(args.output, cursor)
            print("Bounded telemetry purge SQL prepared.")
        elif args.command == "report-delete":
            delete_result = load_json_document(
                args.delete_result,
                "Wrangler delete result",
            )
            remaining_result = load_json_document(
                args.remaining,
                "Wrangler post-purge backlog result",
            )
            rows_deleted = parse_rows_deleted(delete_result)
            remaining_old_rows = parse_remaining_old_rows(remaining_result)
            append_rows_deleted(args.summary, rows_deleted)
            append_remaining_old_rows(args.summary, remaining_old_rows)
            if remaining_old_rows:
                raise TelemetryRetentionError(
                    "checkpointed old-row backlog remains after bounded purge"
                )
            print("Aggregate telemetry deletion report appended.")
        else:  # pragma: no cover - argparse enforces the command choices.
            raise TelemetryRetentionError("unknown retention command")
    except (OSError, sqlite3.Error, TelemetryRetentionError) as exc:
        print(f"Telemetry retention failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
