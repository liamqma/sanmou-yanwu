#!/usr/bin/env python3
"""Deterministic lifecycle tooling for the reviewed MECH v1 catalog.

This module deliberately performs no natural-language extraction.  An explicitly
invoked agent reviews descriptions and edits mech.json; this tool inventories,
hashes, validates, stamps, and formats that reviewed content.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, NoReturn, Sequence

SCHEMA_VERSION = 1
DATABASE_REFERENCE = "web/public/game-data/database.json"
SKILL_SOURCE_FIELDS = ["type", "prob", "desc"]
RELATIONS = (
    "provides",
    "benefits_from",
    "requires",
    "consumes",
    "removes",
    "prevents",
)
SUBJECTS = ("self", "ally", "enemy", "any", "team", "unknown")
CERTAINTIES = ("explicit", "inferred")
EXTRACTION_STATUSES = ("pending", "complete")
HEX_DIGITS = frozenset("0123456789abcdef")

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / DATABASE_REFERENCE
DEFAULT_CATALOG = ROOT / "web/public/game-data/mech.json"

TOP_LEVEL_KEYS = {"schema_version", "source", "mechanics", "skills"}
SOURCE_KEYS = {"database", "skill_source_fields", "mechanics_source_hash"}
MECHANIC_KEYS = {"kind", "source_key", "name"}
SKILL_KEYS = {"source_hash", "extraction_status", "relations", "unresolved"}
RELATION_BASE_KEYS = {"relation", "mechanic", "subject", "certainty", "evidence"}
UNRESOLVED_KEYS = {"name", "evidence", "reason"}


class CatalogError(ValueError):
    """A deterministic catalog/schema failure suitable for CLI reporting."""


@dataclass(frozen=True)
class CatalogStatus:
    mechanics_registry_stale: bool
    new_skills: tuple[str, ...]
    stale_skills: tuple[str, ...]
    removed_skills: tuple[str, ...]
    pending_skills: tuple[str, ...]
    current_skills: tuple[str, ...]
    unresolved_mechanic_count: int

    @property
    def update_required(self) -> bool:
        return self.mechanics_registry_stale or any(
            (
                self.new_skills,
                self.stale_skills,
                self.removed_skills,
                self.pending_skills,
            )
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "mechanics_registry_stale": self.mechanics_registry_stale,
            "new_skills": list(self.new_skills),
            "stale_skills": list(self.stale_skills),
            "removed_skills": list(self.removed_skills),
            "pending_skills": list(self.pending_skills),
            "current_skills": list(self.current_skills),
            "unresolved_mechanic_count": self.unresolved_mechanic_count,
            "update_required": self.update_required,
        }


def _fail(message: str) -> NoReturn:
    raise CatalogError(message)


def _reject_duplicate_object_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail(f"duplicate JSON object key: {key!r}")
        result[key] = value
    return result


def _read_json(path: Path) -> Any:
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_reject_duplicate_object_keys,
        )
    except FileNotFoundError:
        _fail(f"file not found: {path}")
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        _fail(f"cannot read JSON {path}: {exc}")


def load_database(path: Path = DEFAULT_DATABASE) -> dict[str, Any]:
    value = _read_json(path)
    if not isinstance(value, dict):
        _fail("database root must be an object")
    for field in ("skills", "buffs", "debuffs"):
        if not isinstance(value.get(field), dict):
            _fail(f"database.{field} must be an object")
    for name, skill in value["skills"].items():
        if not isinstance(name, str) or not name:
            _fail("database skill names must be non-empty strings")
        if not isinstance(skill, dict):
            _fail(f"database skill {name!r} must be an object")
        if not isinstance(skill.get("type"), str):
            _fail(f"database skill {name!r}.type must be a string")
        prob = skill.get("prob")
        if isinstance(prob, bool) or not isinstance(prob, (int, float)):
            _fail(f"database skill {name!r}.prob must be a number")
        if not isinstance(skill.get("desc"), str):
            _fail(f"database skill {name!r}.desc must be a string")
    return value


def load_catalog(path: Path = DEFAULT_CATALOG) -> dict[str, Any]:
    value = _read_json(path)
    if not isinstance(value, dict):
        _fail("MECH catalog root must be an object")
    return value


def _canonical_json_bytes(value: Any) -> bytes:
    try:
        text = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        _fail(f"value cannot be canonically hashed: {exc}")
    return text.encode("utf-8")


def _hash_value(value: Any) -> str:
    return hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def mechanics_source_hash(database: Mapping[str, Any]) -> str:
    """Hash exactly the canonical buff/debuff source objects."""
    return _hash_value(
        {"buffs": database["buffs"], "debuffs": database["debuffs"]}
    )


def skill_source_hash(name: str, skill: Mapping[str, Any]) -> str:
    """Hash exactly name, type, probability, and description."""
    return _hash_value(
        {
            "name": name,
            "type": skill["type"],
            "prob": skill["prob"],
            "desc": skill["desc"],
        }
    )


def canonical_mechanics(database: Mapping[str, Any]) -> dict[str, dict[str, str]]:
    mechanics: dict[str, dict[str, str]] = {}
    for kind in ("buff", "debuff"):
        section = database[f"{kind}s"]
        for source_key, definition in section.items():
            if not isinstance(source_key, str) or not source_key:
                _fail(f"database {kind} keys must be non-empty strings")
            if not isinstance(definition, dict) or not isinstance(
                definition.get("name"), str
            ) or not definition["name"]:
                _fail(f"database {kind} {source_key!r} requires a non-empty name")
            mechanic_id = f"{kind}:{source_key}"
            mechanics[mechanic_id] = {
                "kind": kind,
                "source_key": source_key,
                "name": definition["name"],
            }
    return {key: mechanics[key] for key in sorted(mechanics)}


def empty_skill_entry(name: str, skill: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "source_hash": skill_source_hash(name, skill),
        "extraction_status": "pending",
        "relations": [],
        "unresolved": [],
    }


def new_catalog(database: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "source": {
            "database": DATABASE_REFERENCE,
            "skill_source_fields": list(SKILL_SOURCE_FIELDS),
            "mechanics_source_hash": mechanics_source_hash(database),
        },
        "mechanics": canonical_mechanics(database),
        "skills": {
            name: empty_skill_entry(name, database["skills"][name])
            for name in sorted(database["skills"])
        },
    }


def _require_exact_keys(value: Any, expected: set[str], context: str) -> None:
    if not isinstance(value, dict):
        _fail(f"{context} must be an object")
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        unknown = sorted(actual - expected)
        details: list[str] = []
        if missing:
            details.append(f"missing={missing}")
        if unknown:
            details.append(f"unknown={unknown}")
        _fail(f"{context} has invalid keys ({', '.join(details)})")


def _require_nonempty_string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value:
        _fail(f"{context} must be a non-empty string")
    return value


def _require_hash(value: Any, context: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(char not in HEX_DIGITS for char in value)
    ):
        _fail(f"{context} must be a lowercase SHA-256 hex digest")
    return value


def _relation_sort_key(relation: Mapping[str, Any]) -> tuple[Any, ...]:
    relation_name = relation.get("relation")
    subject = relation.get("subject")
    certainty = relation.get("certainty")
    return (
        RELATIONS.index(relation_name) if relation_name in RELATIONS else len(RELATIONS),
        str(relation.get("mechanic", "")),
        SUBJECTS.index(subject) if subject in SUBJECTS else len(SUBJECTS),
        CERTAINTIES.index(certainty) if certainty in CERTAINTIES else len(CERTAINTIES),
        str(relation.get("evidence", "")),
        str(relation.get("reason", "")),
    )


def canonicalize_catalog(catalog: Mapping[str, Any]) -> dict[str, Any]:
    """Return canonical key/array ordering without changing semantic values."""
    _require_exact_keys(catalog, TOP_LEVEL_KEYS, "catalog")
    source = catalog["source"]
    _require_exact_keys(source, SOURCE_KEYS, "catalog.source")
    mechanics = catalog["mechanics"]
    skills = catalog["skills"]
    if not isinstance(mechanics, dict):
        _fail("catalog.mechanics must be an object")
    if not isinstance(skills, dict):
        _fail("catalog.skills must be an object")

    canonical_mechanic_entries: dict[str, Any] = {}
    for mechanic_id in sorted(mechanics):
        mechanic = mechanics[mechanic_id]
        _require_exact_keys(mechanic, MECHANIC_KEYS, f"mechanics[{mechanic_id!r}]")
        canonical_mechanic_entries[mechanic_id] = {
            "kind": mechanic["kind"],
            "source_key": mechanic["source_key"],
            "name": mechanic["name"],
        }

    canonical_skill_entries: dict[str, Any] = {}
    for name in sorted(skills):
        entry = skills[name]
        _require_exact_keys(entry, SKILL_KEYS, f"skills[{name!r}]")
        relations = entry["relations"]
        unresolved = entry["unresolved"]
        if not isinstance(relations, list):
            _fail(f"skills[{name!r}].relations must be an array")
        if not isinstance(unresolved, list):
            _fail(f"skills[{name!r}].unresolved must be an array")
        canonical_relations: list[dict[str, Any]] = []
        for index, relation in enumerate(relations):
            context = f"skills[{name!r}].relations[{index}]"
            if not isinstance(relation, dict):
                _fail(f"{context} must be an object")
            certainty = relation.get("certainty")
            expected = RELATION_BASE_KEYS | ({"reason"} if certainty == "inferred" else set())
            _require_exact_keys(relation, expected, context)
            ordered = {
                "relation": relation["relation"],
                "mechanic": relation["mechanic"],
                "subject": relation["subject"],
                "certainty": relation["certainty"],
                "evidence": relation["evidence"],
            }
            if certainty == "inferred":
                ordered["reason"] = relation["reason"]
            canonical_relations.append(ordered)
        canonical_relations.sort(key=_relation_sort_key)

        canonical_unresolved: list[dict[str, str]] = []
        for index, item in enumerate(unresolved):
            context = f"skills[{name!r}].unresolved[{index}]"
            _require_exact_keys(item, UNRESOLVED_KEYS, context)
            canonical_unresolved.append(
                {
                    "name": item["name"],
                    "evidence": item["evidence"],
                    "reason": item["reason"],
                }
            )
        canonical_unresolved.sort(
            key=lambda item: (item["name"], item["evidence"], item["reason"])
        )
        canonical_skill_entries[name] = {
            "source_hash": entry["source_hash"],
            "extraction_status": entry["extraction_status"],
            "relations": canonical_relations,
            "unresolved": canonical_unresolved,
        }

    return {
        "schema_version": catalog["schema_version"],
        "source": {
            "database": source["database"],
            "skill_source_fields": source["skill_source_fields"],
            "mechanics_source_hash": source["mechanics_source_hash"],
        },
        "mechanics": canonical_mechanic_entries,
        "skills": canonical_skill_entries,
    }


def rendered_catalog(catalog: Mapping[str, Any]) -> bytes:
    canonical = canonicalize_catalog(catalog)
    return (
        json.dumps(canonical, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    ).encode("utf-8")


def atomic_write(path: Path, content: bytes) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if path.exists() and path.read_bytes() == content:
            return False
    except OSError as exc:
        _fail(f"cannot read existing output {path}: {exc}")
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", delete=False
        ) as handle:
            temporary = handle.name
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        temporary = None
    except OSError as exc:
        _fail(f"cannot atomically write {path}: {exc}")
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    return True


def _mechanics_registry_is_current(
    catalog: Mapping[str, Any], database: Mapping[str, Any]
) -> bool:
    source = catalog.get("source")
    mechanics = catalog.get("mechanics")
    return (
        type(catalog.get("schema_version")) is int
        and catalog.get("schema_version") == SCHEMA_VERSION
        and isinstance(source, dict)
        and set(source) == SOURCE_KEYS
        and source.get("database") == DATABASE_REFERENCE
        and source.get("skill_source_fields") == SKILL_SOURCE_FIELDS
        and source.get("mechanics_source_hash") == mechanics_source_hash(database)
        and isinstance(mechanics, dict)
        and mechanics == canonical_mechanics(database)
    )


def bootstrap_catalog(database: Mapping[str, Any], existing: Mapping[str, Any] | None) -> dict[str, Any]:
    if existing is None:
        return new_catalog(database)
    _require_exact_keys(existing, TOP_LEVEL_KEYS, "catalog")
    old_skills = existing.get("skills")
    if not isinstance(old_skills, dict):
        _fail("catalog.skills must be an object")
    registry_stale = not _mechanics_registry_is_current(existing, database)
    skills: dict[str, Any] = {}
    for name in sorted(database["skills"]):
        if name not in old_skills:
            skills[name] = empty_skill_entry(name, database["skills"][name])
            continue
        old_entry = old_skills[name]
        if not isinstance(old_entry, dict):
            _fail(f"skills[{name!r}] must be an object")
        skills[name] = dict(old_entry)
        if registry_stale:
            skills[name]["extraction_status"] = "pending"
    updated = {
        "schema_version": SCHEMA_VERSION,
        "source": {
            "database": DATABASE_REFERENCE,
            "skill_source_fields": list(SKILL_SOURCE_FIELDS),
            "mechanics_source_hash": mechanics_source_hash(database),
        },
        "mechanics": canonical_mechanics(database),
        "skills": skills,
    }
    return canonicalize_catalog(updated)


def _validate_mechanic_registry(catalog: Mapping[str, Any], database: Mapping[str, Any]) -> None:
    expected = canonical_mechanics(database)
    actual = catalog["mechanics"]
    if actual != expected:
        _fail("canonical mechanics registry is stale or does not match database buffs/debuffs")
    expected_hash = mechanics_source_hash(database)
    actual_hash = catalog["source"]["mechanics_source_hash"]
    _require_hash(actual_hash, "catalog.source.mechanics_source_hash")
    if actual_hash != expected_hash:
        _fail("mechanics_source_hash is stale")


def _validate_skill_entry(
    name: str,
    entry: Mapping[str, Any],
    skill: Mapping[str, Any],
    mechanics: Mapping[str, Any],
    *,
    require_current_hash: bool,
    require_complete: bool,
) -> int:
    context = f"skills[{name!r}]"
    _require_exact_keys(entry, SKILL_KEYS, context)
    source_hash = _require_hash(entry["source_hash"], f"{context}.source_hash")
    if require_current_hash and source_hash != skill_source_hash(name, skill):
        _fail(f"{context}.source_hash is stale")
    status = entry["extraction_status"]
    if status not in EXTRACTION_STATUSES:
        _fail(f"{context}.extraction_status must be one of {list(EXTRACTION_STATUSES)}")
    if require_complete and status != "complete":
        _fail(f"{context} is pending; final validation requires complete")
    relations = entry["relations"]
    unresolved = entry["unresolved"]
    if not isinstance(relations, list):
        _fail(f"{context}.relations must be an array")
    if not isinstance(unresolved, list):
        _fail(f"{context}.unresolved must be an array")
    desc = skill["desc"]
    seen: set[tuple[str, str, str]] = set()
    for index, relation in enumerate(relations):
        relation_context = f"{context}.relations[{index}]"
        if not isinstance(relation, dict):
            _fail(f"{relation_context} must be an object")
        certainty = relation.get("certainty")
        expected_keys = RELATION_BASE_KEYS | (
            {"reason"} if certainty == "inferred" else set()
        )
        _require_exact_keys(relation, expected_keys, relation_context)
        relation_name = relation["relation"]
        if relation_name not in RELATIONS:
            _fail(f"{relation_context}.relation must be one of {list(RELATIONS)}")
        mechanic_id = _require_nonempty_string(
            relation["mechanic"], f"{relation_context}.mechanic"
        )
        if mechanic_id not in mechanics:
            _fail(f"{relation_context}.mechanic is unknown: {mechanic_id}")
        subject = relation["subject"]
        if subject not in SUBJECTS:
            _fail(f"{relation_context}.subject must be one of {list(SUBJECTS)}")
        if certainty not in CERTAINTIES:
            _fail(f"{relation_context}.certainty must be one of {list(CERTAINTIES)}")
        evidence = _require_nonempty_string(
            relation["evidence"], f"{relation_context}.evidence"
        )
        if evidence not in desc:
            _fail(f"{relation_context}.evidence is not an exact description substring")
        if certainty == "inferred":
            _require_nonempty_string(
                relation["reason"], f"{relation_context}.reason"
            )
        identity = (relation_name, mechanic_id, subject)
        if identity in seen:
            _fail(
                f"{context} has duplicate relationship "
                f"{relation_name}/{mechanic_id}/{subject}"
            )
        seen.add(identity)
    for index, item in enumerate(unresolved):
        unresolved_context = f"{context}.unresolved[{index}]"
        _require_exact_keys(item, UNRESOLVED_KEYS, unresolved_context)
        _require_nonempty_string(item["name"], f"{unresolved_context}.name")
        evidence = _require_nonempty_string(
            item["evidence"], f"{unresolved_context}.evidence"
        )
        if evidence not in desc:
            _fail(f"{unresolved_context}.evidence is not an exact description substring")
        _require_nonempty_string(item["reason"], f"{unresolved_context}.reason")
    return len(unresolved)


def validate_catalog(catalog: Mapping[str, Any], database: Mapping[str, Any]) -> list[tuple[str, str]]:
    _require_exact_keys(catalog, TOP_LEVEL_KEYS, "catalog")
    if type(catalog["schema_version"]) is not int or catalog["schema_version"] != SCHEMA_VERSION:
        _fail(f"catalog.schema_version must be integer {SCHEMA_VERSION}")
    source = catalog["source"]
    _require_exact_keys(source, SOURCE_KEYS, "catalog.source")
    if source["database"] != DATABASE_REFERENCE:
        _fail(f"catalog.source.database must be {DATABASE_REFERENCE!r}")
    if source["skill_source_fields"] != SKILL_SOURCE_FIELDS:
        _fail(
            "catalog.source.skill_source_fields must be exactly "
            f"{SKILL_SOURCE_FIELDS}"
        )
    mechanics = catalog["mechanics"]
    skills = catalog["skills"]
    if not isinstance(mechanics, dict):
        _fail("catalog.mechanics must be an object")
    if not isinstance(skills, dict):
        _fail("catalog.skills must be an object")
    _validate_mechanic_registry(catalog, database)

    database_names = set(database["skills"])
    catalog_names = set(skills)
    missing = sorted(database_names - catalog_names)
    unknown = sorted(catalog_names - database_names)
    if missing or unknown:
        _fail(f"skill coverage mismatch: missing={missing}, unknown_or_removed={unknown}")

    unresolved_items: list[tuple[str, str]] = []
    for name in sorted(database_names):
        _validate_skill_entry(
            name,
            skills[name],
            database["skills"][name],
            mechanics,
            require_current_hash=True,
            require_complete=True,
        )
        for item in skills[name]["unresolved"]:
            unresolved_items.append((name, item["name"]))
    return unresolved_items


def catalog_status(
    database: Mapping[str, Any], catalog: Mapping[str, Any] | None
) -> CatalogStatus:
    database_names = set(database["skills"])
    if catalog is None:
        return CatalogStatus(
            mechanics_registry_stale=True,
            new_skills=tuple(sorted(database_names)),
            stale_skills=(),
            removed_skills=(),
            pending_skills=(),
            current_skills=(),
            unresolved_mechanic_count=0,
        )
    _require_exact_keys(catalog, TOP_LEVEL_KEYS, "catalog")
    source = catalog.get("source")
    mechanics = catalog.get("mechanics")
    skills = catalog.get("skills")
    if not isinstance(source, dict) or not isinstance(mechanics, dict) or not isinstance(skills, dict):
        _fail("catalog source, mechanics, and skills must be objects")
    catalog_names = set(skills)
    new_names = database_names - catalog_names
    removed_names = catalog_names - database_names
    stale: list[str] = []
    current: list[str] = []
    pending: list[str] = []
    unresolved_count = 0
    for name in sorted(database_names & catalog_names):
        entry = skills[name]
        if not isinstance(entry, dict):
            _fail(f"skills[{name!r}] must be an object")
        if entry.get("source_hash") == skill_source_hash(name, database["skills"][name]):
            current.append(name)
        else:
            stale.append(name)
        extraction_status = entry.get("extraction_status")
        if extraction_status not in EXTRACTION_STATUSES:
            _fail(
                f"skills[{name!r}].extraction_status must be one of "
                f"{list(EXTRACTION_STATUSES)}"
            )
        if extraction_status == "pending":
            pending.append(name)
        unresolved = entry.get("unresolved", [])
        if not isinstance(unresolved, list):
            _fail(f"skills[{name!r}].unresolved must be an array")
        unresolved_count += len(unresolved)
    mechanics_stale = not _mechanics_registry_is_current(catalog, database)
    return CatalogStatus(
        mechanics_registry_stale=mechanics_stale,
        new_skills=tuple(sorted(new_names)),
        stale_skills=tuple(stale),
        removed_skills=tuple(sorted(removed_names)),
        pending_skills=tuple(pending),
        current_skills=tuple(current),
        unresolved_mechanic_count=unresolved_count,
    )


def stamp_catalog(
    catalog: Mapping[str, Any], database: Mapping[str, Any], names: Sequence[str]
) -> dict[str, Any]:
    if not names:
        _fail("stamp requires at least one explicitly named skill")
    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        _fail(f"stamp skill names must be unique: {duplicates}")
    unknown = sorted(set(names) - set(database["skills"]))
    if unknown:
        _fail(f"unknown skill name(s): {unknown}")
    _require_exact_keys(catalog, TOP_LEVEL_KEYS, "catalog")
    if type(catalog["schema_version"]) is not int or catalog["schema_version"] != SCHEMA_VERSION:
        _fail(f"catalog.schema_version must be integer {SCHEMA_VERSION}")
    source = catalog.get("source")
    skills = catalog.get("skills")
    mechanics = catalog.get("mechanics")
    _require_exact_keys(source, SOURCE_KEYS, "catalog.source")
    if source["database"] != DATABASE_REFERENCE:
        _fail(f"catalog.source.database must be {DATABASE_REFERENCE!r}")
    if source["skill_source_fields"] != SKILL_SOURCE_FIELDS:
        _fail(
            "catalog.source.skill_source_fields must be exactly "
            f"{SKILL_SOURCE_FIELDS}"
        )
    if not isinstance(skills, dict) or not isinstance(mechanics, dict):
        _fail("catalog mechanics and skills must be objects")
    missing = sorted(set(names) - set(skills))
    if missing:
        _fail(f"catalog is missing skill skeleton(s): {missing}; run bootstrap")
    _validate_mechanic_registry(catalog, database)

    updated = json.loads(json.dumps(catalog, ensure_ascii=False))
    for name in names:
        entry = updated["skills"][name]
        _validate_skill_entry(
            name,
            entry,
            database["skills"][name],
            mechanics,
            require_current_hash=False,
            require_complete=True,
        )
        entry["source_hash"] = skill_source_hash(name, database["skills"][name])
    return canonicalize_catalog(updated)


def _status_text(status: CatalogStatus) -> str:
    lines = [f"mechanics_registry_stale: {str(status.mechanics_registry_stale).lower()}"]
    for label, values in (
        ("new_skills", status.new_skills),
        ("stale_skills", status.stale_skills),
        ("removed_skills", status.removed_skills),
        ("pending_skills", status.pending_skills),
        ("current_skills", status.current_skills),
    ):
        lines.append(f"{label} ({len(values)}):")
        lines.extend(f"  - {value}" for value in values)
    lines.append(f"unresolved_mechanic_count: {status.unresolved_mechanic_count}")
    lines.append(f"update_required: {str(status.update_required).lower()}")
    return "\n".join(lines) + "\n"


def _paths_for(args: argparse.Namespace) -> tuple[Path, Path]:
    return Path(args.database).resolve(), Path(args.catalog).resolve()


def _existing_catalog_or_none(path: Path) -> dict[str, Any] | None:
    return load_catalog(path) if path.exists() else None


def _add_paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--database", default=str(DEFAULT_DATABASE))
    parser.add_argument("--catalog", default=str(DEFAULT_CATALOG))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="report catalog freshness")
    _add_paths(status_parser)
    status_parser.add_argument("--json", action="store_true", dest="as_json")

    bootstrap_parser = subparsers.add_parser(
        "bootstrap", help="synchronize registry/coverage with pending skeletons"
    )
    _add_paths(bootstrap_parser)

    validate_parser = subparsers.add_parser("validate", help="strictly validate final catalog")
    _add_paths(validate_parser)

    format_parser = subparsers.add_parser("format", help="rewrite canonical JSON formatting")
    _add_paths(format_parser)

    stamp_parser = subparsers.add_parser("stamp", help="stamp explicitly reviewed skill hashes")
    _add_paths(stamp_parser)
    stamp_parser.add_argument("skills", nargs="+")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    database_path, catalog_path = _paths_for(args)
    try:
        database = load_database(database_path)
        if args.command == "status":
            status = catalog_status(database, _existing_catalog_or_none(catalog_path))
            if args.as_json:
                print(json.dumps(status.as_dict(), ensure_ascii=False, indent=2))
            else:
                print(_status_text(status), end="")
            return 1 if status.update_required else 0
        if args.command == "bootstrap":
            catalog = bootstrap_catalog(database, _existing_catalog_or_none(catalog_path))
            changed = atomic_write(catalog_path, rendered_catalog(catalog))
            print(f"bootstrap: {'updated' if changed else 'unchanged'} {catalog_path}")
            return 0
        catalog = load_catalog(catalog_path)
        if args.command == "validate":
            unresolved = validate_catalog(catalog, database)
            if catalog_path.read_bytes() != rendered_catalog(catalog):
                _fail("catalog JSON is not canonically formatted; run format")
            print(
                f"valid: {len(database['skills'])} skills; "
                f"unresolved mechanics: {len(unresolved)}"
            )
            for skill_name, mechanic_name in unresolved:
                print(f"unresolved: {skill_name}: {mechanic_name}")
            return 0
        if args.command == "format":
            changed = atomic_write(catalog_path, rendered_catalog(catalog))
            print(f"format: {'updated' if changed else 'unchanged'} {catalog_path}")
            return 0
        if args.command == "stamp":
            updated = stamp_catalog(catalog, database, args.skills)
            changed = atomic_write(catalog_path, rendered_catalog(updated))
            print(
                f"stamp: {'updated' if changed else 'unchanged'} "
                f"{len(args.skills)} skill(s)"
            )
            return 0
        parser.error(f"unknown command: {args.command}")
    except CatalogError as exc:
        print(f"error: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
