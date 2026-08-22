"""Deterministic reviewed named-status mechanics registry maintenance.

The browser never parses descriptions.  This module is an offline audit helper:
it recognizes only a deliberately small local grammar, requires explicit
overrides for every other exact catalog-status mention, and writes the reviewed
registry atomically only after the complete catalog validates.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

SCHEMA_VERSION = 1
OVERRIDE_SCHEMA_VERSION = 1
ROLES = ("provides", "benefitsFrom", "removes", "counters", "referenceOnly")
OPERATIONAL_ROLES = frozenset(ROLES[:-1])
# Exact catalog labels that denote broad classes rather than a named status.
# They are audited, but must never generate provider/beneficiary relationships.
BROAD_STATUS_CLASSES = frozenset((
    "特殊增益状态", "常规负面状态", "控制状态", "属性降低状态",
))


class MechanicsRegistryError(ValueError):
    """Raised when catalog mechanics are stale, ambiguous, or malformed."""


@dataclass(frozen=True)
class Ambiguity:
    skill: str
    status: str
    snippet: str
    reason: str

    def override_shape(self) -> str:
        return json.dumps(
            {"skills": {self.skill: {self.status: {"roles": ["referenceOnly"]}}}},
            ensure_ascii=False,
            sort_keys=True,
        )


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _short_hash(value: Any, length: int = 16) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()[:length]


def description_hash(description: str) -> str:
    return hashlib.sha256(description.encode("utf-8")).hexdigest()[:16]


def _catalog_parts(database: Mapping[str, Any]) -> tuple[Mapping[str, Any], tuple[str, ...]]:
    skills = database.get("skills")
    buffs = database.get("buffs")
    debuffs = database.get("debuffs")
    if not isinstance(skills, Mapping) or not isinstance(buffs, Mapping) or not isinstance(debuffs, Mapping):
        raise MechanicsRegistryError("database skills, buffs, and debuffs must be objects")
    statuses: list[str] = []
    for group_name, group in (("buffs", buffs), ("debuffs", debuffs)):
        for key, raw in group.items():
            if not isinstance(raw, Mapping) or not isinstance(raw.get("name"), str) or not raw["name"]:
                raise MechanicsRegistryError(f"database {group_name} entry {key!r} has no status name")
            statuses.append(raw["name"])
    if len(statuses) != len(set(statuses)):
        raise MechanicsRegistryError("status catalog contains duplicate names")
    # Longest first prevents a shorter status from splitting an exact longer one.
    return skills, tuple(sorted(statuses, key=lambda item: (-len(item), item)))


def _description(raw: Any, skill: str) -> str:
    if not isinstance(raw, Mapping) or not isinstance(raw.get("desc"), str):
        raise MechanicsRegistryError(f"database skill {skill!r} has no description")
    return raw["desc"]


def mentioned_statuses(description: str, statuses: Iterable[str]) -> tuple[str, ...]:
    return tuple(sorted(status for status in statuses if status in description))


def _snippet(description: str, status: str, radius: int = 28) -> str:
    at = description.find(status)
    if at < 0:
        return description[: radius * 2]
    return description[max(0, at - radius): min(len(description), at + len(status) + radius)]


def _infer_roles(description: str, status: str) -> set[str]:
    """Infer roles using only the approved explicit local grammar."""
    if status in BROAD_STATUS_CLASSES:
        return set()
    q = re.escape(status)
    roles: set[str] = set()
    provides = (
        rf"施加(?:[^，。；;]{{0,16}})?{q}",
        rf"获得(?:[^，。；;]{{0,10}})?{q}",
        rf"使[^，。；;]{{0,20}}进入(?:[^，。；;]{{0,8}})?{q}",
        rf"令[^，。；;]{{0,20}}获得(?:[^，。；;]{{0,8}})?{q}",
    )
    benefits = (
        rf"若[^，。；;]{{0,24}}持有(?:[^，。；;]{{0,6}})?{q}",
        rf"若[^，。；;]{{0,24}}处于(?:[^，。；;]{{0,6}})?{q}",
        rf"当[^，。；;]{{0,24}}持有(?:[^，。；;]{{0,6}})?{q}",
        rf"目标已持有(?:[^，。；;]{{0,6}})?{q}",
        rf"受到(?:[^，。；;]{{0,6}})?{q}影响时",
        # Catalog wording used by the approved examples.
        rf"(?:目标|敌军目标)[^，。；;]{{0,8}}处于(?:[^，。；;]{{0,6}})?{q}状态",
        rf"已持有(?:[^，。；;]{{0,6}})?{q}状态",
    )
    removes = (rf"(?:驱散|解除|清除)(?:[^，。；;]{{0,12}})?{q}",)
    counters = (rf"免疫(?:[^，。；;]{{0,12}})?{q}", rf"无法被施加(?:[^，。；;]{{0,8}})?{q}")
    for role, patterns in (
        ("provides", provides),
        ("benefitsFrom", benefits),
        ("removes", removes),
        ("counters", counters),
    ):
        if any(re.search(pattern, description) for pattern in patterns):
            roles.add(role)
    return roles


def _load_overrides(path: Path | None) -> dict[str, dict[str, tuple[str, ...]]]:
    if path is None or not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MechanicsRegistryError(f"cannot read mechanics overrides {path}: {exc}") from exc
    if not isinstance(raw, Mapping) or raw.get("schema_version") != OVERRIDE_SCHEMA_VERSION or not isinstance(raw.get("skills"), Mapping):
        raise MechanicsRegistryError("mechanics overrides contract is invalid")
    result: dict[str, dict[str, tuple[str, ...]]] = {}
    for skill, statuses in raw["skills"].items():
        if not isinstance(skill, str) or not isinstance(statuses, Mapping):
            raise MechanicsRegistryError("mechanics override skill entry is invalid")
        result[skill] = {}
        for status, value in statuses.items():
            if not isinstance(status, str) or not isinstance(value, Mapping) or not isinstance(value.get("roles"), list):
                raise MechanicsRegistryError(f"mechanics override {skill!r}/{status!r} is invalid")
            roles = value["roles"]
            if any(role not in ROLES for role in roles) or len(roles) != len(set(roles)) or not roles:
                raise MechanicsRegistryError(f"mechanics override {skill!r}/{status!r} has invalid roles")
            if "referenceOnly" in roles and len(roles) != 1:
                raise MechanicsRegistryError(f"mechanics override {skill!r}/{status!r} mixes referenceOnly with an operational role")
            result[skill][status] = tuple(sorted(roles))
    return result


def propose_registry(
    database: Mapping[str, Any],
    *,
    overrides: Mapping[str, Mapping[str, tuple[str, ...]]] | None = None,
) -> tuple[dict[str, Any], list[Ambiguity]]:
    skills, status_order = _catalog_parts(database)
    known_statuses = frozenset(status_order)
    overrides = overrides or {}
    unknown_override_skills = set(overrides) - set(skills)
    if unknown_override_skills:
        raise MechanicsRegistryError(f"mechanics overrides contain unknown skills: {sorted(unknown_override_skills)}")

    entries: dict[str, Any] = {}
    ambiguities: list[Ambiguity] = []
    for skill in sorted(skills):
        desc = _description(skills[skill], skill)
        mentions = mentioned_statuses(desc, status_order)
        role_sets: dict[str, set[str]] = {role: set() for role in ROLES}
        allowances: set[str] = set()
        skill_overrides = overrides.get(skill, {})
        unknown_override_statuses = set(skill_overrides) - set(mentions)
        if unknown_override_statuses:
            raise MechanicsRegistryError(
                f"mechanics overrides for {skill!r} contain unmentioned statuses: {sorted(unknown_override_statuses)}"
            )
        for status in mentions:
            if status not in known_statuses:
                raise MechanicsRegistryError(f"unknown status {status!r}")
            inferred = _infer_roles(desc, status)
            reviewed = set(skill_overrides.get(status, ()))
            roles = reviewed or inferred
            if not roles:
                ambiguities.append(
                    Ambiguity(skill, status, _snippet(desc, status), "exact status mention is outside the reviewed local grammar")
                )
                continue
            if "referenceOnly" in roles and len(roles) > 1:
                raise MechanicsRegistryError(f"{skill!r}/{status!r} has contradictory reference and operational roles")
            for role in roles:
                role_sets[role].add(status)
            if len(roles & OPERATIONAL_ROLES) > 1:
                allowances.add(status)
        entries[skill] = {
            "description_hash": description_hash(desc),
            "mentions": list(mentions),
            **{role: sorted(role_sets[role]) for role in ROLES},
            "allowMultipleRoles": sorted(allowances),
        }

    status_catalog = sorted(known_statuses)
    source_payload = {
        "skills": [{"name": name, "description": _description(skills[name], name)} for name in sorted(skills)],
        "statuses": status_catalog,
    }
    relationship_payload = {
        name: {role: entries[name][role] for role in ROLES}
        for name in sorted(entries)
    }
    registry = {
        "schema_version": SCHEMA_VERSION,
        "source_hash": _short_hash(source_payload),
        "status_catalog_hash": _short_hash(status_catalog),
        "mechanics_version": _short_hash({"source": source_payload, "relationships": relationship_payload}),
        "skills": entries,
    }
    return registry, ambiguities


def validate_registry(database: Mapping[str, Any], registry: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a tracked registry against the current catalog, failing closed."""
    if not isinstance(registry, Mapping) or registry.get("schema_version") != SCHEMA_VERSION:
        raise MechanicsRegistryError("mechanics registry schema version is invalid")
    raw_entries = registry.get("skills")
    if not isinstance(raw_entries, Mapping):
        raise MechanicsRegistryError("mechanics registry skills must be an object")
    skills, statuses = _catalog_parts(database)
    if set(raw_entries) != set(skills):
        missing = sorted(set(skills) - set(raw_entries))
        stale = sorted(set(raw_entries) - set(skills))
        raise MechanicsRegistryError(f"mechanics registry skill names are stale (missing={missing}, removed={stale})")
    known_statuses = frozenset(statuses)
    normalized_entries: dict[str, Any] = {}
    for skill in sorted(skills):
        entry = raw_entries[skill]
        if not isinstance(entry, Mapping) or entry.get("description_hash") != description_hash(_description(skills[skill], skill)):
            raise MechanicsRegistryError(f"mechanics registry description hash is stale for {skill!r}")
        mentions = mentioned_statuses(_description(skills[skill], skill), statuses)
        if entry.get("mentions") != list(mentions):
            raise MechanicsRegistryError(f"mechanics registry exact mentions are stale for {skill!r}")
        role_values: dict[str, list[str]] = {}
        for role in ROLES:
            values = entry.get(role)
            if not isinstance(values, list) or values != sorted(values) or len(values) != len(set(values)):
                raise MechanicsRegistryError(f"mechanics registry {skill!r}.{role} must be a unique sorted array")
            if any(status not in known_statuses or status not in mentions for status in values):
                raise MechanicsRegistryError(f"mechanics registry {skill!r}.{role} contains an unknown or unmentioned status")
            role_values[role] = values
        assigned = set().union(*(set(role_values[role]) for role in ROLES))
        if assigned != set(mentions):
            raise MechanicsRegistryError(f"mechanics registry has unresolved exact status mentions for {skill!r}")
        operational_counts = {
            status: sum(status in role_values[role] for role in OPERATIONAL_ROLES)
            for status in mentions
        }
        allowances = entry.get("allowMultipleRoles")
        expected_allowances = sorted(status for status, count in operational_counts.items() if count > 1)
        if allowances != expected_allowances:
            raise MechanicsRegistryError(f"mechanics registry multi-role allowance is stale for {skill!r}")
        if set(role_values["referenceOnly"]) & set().union(*(set(role_values[r]) for r in OPERATIONAL_ROLES)):
            raise MechanicsRegistryError(f"mechanics registry has contradictory roles for {skill!r}")
        normalized_entries[skill] = {
            "description_hash": entry["description_hash"],
            "mentions": list(mentions),
            **role_values,
            "allowMultipleRoles": expected_allowances,
        }
    expected, ambiguities = propose_registry(database, overrides={
        skill: {
            status: tuple(role for role in ROLES if status in normalized_entries[skill][role])
            for status in normalized_entries[skill]["mentions"]
        }
        for skill in normalized_entries
    })
    if ambiguities:
        raise MechanicsRegistryError("validated registry unexpectedly contains unresolved mentions")
    for key in ("source_hash", "status_catalog_hash", "mechanics_version"):
        if registry.get(key) != expected[key]:
            raise MechanicsRegistryError(f"mechanics registry {key} is stale")
    return dict(registry)


def load_validated_registry(database: Mapping[str, Any], path: str | Path) -> dict[str, Any]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MechanicsRegistryError(f"cannot read mechanics registry {path}: {exc}") from exc
    return validate_registry(database, value)


def audit(
    database: Mapping[str, Any],
    registry: Mapping[str, Any] | None,
    *,
    overrides: Mapping[str, Mapping[str, tuple[str, ...]]] | None = None,
) -> tuple[dict[str, Any], list[Ambiguity], dict[str, list[str]]]:
    proposed, ambiguities = propose_registry(database, overrides=overrides)
    current = registry.get("skills", {}) if isinstance(registry, Mapping) and isinstance(registry.get("skills"), Mapping) else {}
    proposed_skills = proposed["skills"]
    changed = sorted(
        name for name in set(current) & set(proposed_skills)
        if current[name].get("description_hash") != proposed_skills[name]["description_hash"]
    )
    newly_mentioned = sorted(
        name for name in set(current) & set(proposed_skills)
        if set(proposed_skills[name]["mentions"]) - set(current[name].get("mentions", []))
    )
    report = {
        "new_skills": sorted(set(proposed_skills) - set(current)),
        "changed_descriptions": changed,
        "removed_or_renamed_skills": sorted(set(current) - set(proposed_skills)),
        "newly_mentioned_statuses": newly_mentioned,
        "stale_reviewed_entries": sorted(set(current) - set(proposed_skills)) + changed,
        "unresolved_or_ambiguous_mentions": [f"{item.skill}:{item.status}" for item in ambiguities],
        "proposed_unambiguous_relationships": sorted(
            f"{skill}:{role}:{status}"
            for skill, entry in proposed_skills.items()
            for role in OPERATIONAL_ROLES
            for status in entry[role]
        ),
    }
    return proposed, ambiguities, report


def write_registry_atomic(path: str | Path, registry: Mapping[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(registry, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, target)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def load_overrides(path: str | Path | None) -> dict[str, dict[str, tuple[str, ...]]]:
    return _load_overrides(Path(path) if path else None)
