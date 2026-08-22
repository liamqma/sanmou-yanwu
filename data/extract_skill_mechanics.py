#!/usr/bin/env python3
"""Audit or atomically refresh the reviewed named-status mechanics registry."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from skill_mechanics import (
        MechanicsRegistryError,
        audit,
        load_overrides,
        validate_registry,
        write_registry_atomic,
    )
except ImportError:  # pragma: no cover - package import
    from .skill_mechanics import (
        MechanicsRegistryError,
        audit,
        load_overrides,
        validate_registry,
        write_registry_atomic,
    )


def _read_object(path: Path, *, required: bool) -> dict[str, Any] | None:
    if not path.exists() and not required:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MechanicsRegistryError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise MechanicsRegistryError(f"{path} must contain a JSON object")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default="web/public/game-data/database.json")
    parser.add_argument("--registry", default="data/skill_mechanics.json")
    parser.add_argument("--overrides", default="data/skill_mechanics_overrides.json")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)

    try:
        database = _read_object(Path(args.database), required=True)
        assert database is not None
        registry = _read_object(Path(args.registry), required=False)
        overrides = load_overrides(args.overrides)
        proposed, ambiguities, report = audit(database, registry, overrides=overrides)
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
        if ambiguities:
            print("\nUnresolved exact status mentions (no files were written):")
            for item in ambiguities:
                print(f"- skill: {item.skill}")
                print(f"  status: {item.status}")
                print(f"  snippet: {item.snippet}")
                print(f"  why: {item.reason}")
                print(f"  add override: {item.override_shape()}")
            return 2 if args.apply else 0
        if args.apply:
            validate_registry(database, proposed)
            write_registry_atomic(args.registry, proposed)
            print(f"Updated {args.registry} atomically; mechanics_version={proposed['mechanics_version']}")
        elif registry is None:
            print("Registry does not exist; run with APPLY=1 after resolving ambiguities.")
        else:
            try:
                validate_registry(database, registry)
            except MechanicsRegistryError as exc:
                print(f"Registry is stale: {exc}")
                return 2
            else:
                print(f"Registry is current; mechanics_version={registry['mechanics_version']}")
        return 0
    except MechanicsRegistryError as exc:
        print(f"error: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
