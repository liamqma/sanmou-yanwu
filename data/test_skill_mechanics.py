from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from data.extract_skill_mechanics import main
from data.skill_mechanics import (
    MechanicsRegistryError,
    load_validated_registry,
    propose_registry,
    validate_registry,
    write_registry_atomic,
)


def database(description: str = "对目标施加火攻，若目标已持有火攻状态则增强") -> dict:
    return {
        "skills": {"测试": {"desc": description}},
        "buffs": {},
        "debuffs": {"fire": {"name": "火攻"}},
    }


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_unambiguous_provider_and_beneficiary_and_version_stability():
    first, ambiguous = propose_registry(database())
    second, _ = propose_registry(database())
    assert not ambiguous
    assert first == second
    entry = first["skills"]["测试"]
    assert entry["provides"] == ["火攻"]
    assert entry["benefitsFrom"] == ["火攻"]
    assert entry["allowMultipleRoles"] == ["火攻"]
    validate_registry(database(), first)


def test_real_reviewed_examples_have_the_required_narrow_roles():
    catalog = json.loads(Path("web/public/game-data/database.json").read_text(encoding="utf-8"))
    registry = load_validated_registry(catalog, "data/skill_mechanics.json")
    assert registry["skills"]["火烧连营"]["provides"] == ["火攻", "焚烧"]
    assert registry["skills"]["火烧连营"]["benefitsFrom"] == ["火攻"]
    assert registry["skills"]["烈火张天"]["provides"] == ["火攻"]
    assert registry["skills"]["风助火势"]["provides"] == ["火攻", "风暴"]
    assert registry["skills"]["风助火势"]["benefitsFrom"] == ["火攻", "风暴"]
    assert registry["skills"]["巧利天灾"]["benefitsFrom"] == ["洪水", "火攻", "风暴"]


def test_ambiguous_phrase_fails_apply_with_actionable_override(tmp_path: Path, capsys):
    db = tmp_path / "db.json"
    registry = tmp_path / "registry.json"
    overrides = tmp_path / "overrides.json"
    write_json(db, database("火攻伤害提升"))
    write_json(overrides, {"schema_version": 1, "skills": {}})
    result = main(["--database", str(db), "--registry", str(registry), "--overrides", str(overrides), "--apply"])
    output = capsys.readouterr().out
    assert result == 2 and not registry.exists()
    assert "skill: 测试" in output and "status: 火攻" in output
    assert '"roles": ["referenceOnly"]' in output


def test_manual_override_resolves_ambiguity_and_apply_is_atomic_deterministic(tmp_path: Path):
    db = tmp_path / "db.json"
    registry = tmp_path / "registry.json"
    overrides = tmp_path / "overrides.json"
    write_json(db, database("火攻伤害提升"))
    write_json(overrides, {
        "schema_version": 1,
        "skills": {"测试": {"火攻": {"roles": ["referenceOnly"]}}},
    })
    args = ["--database", str(db), "--registry", str(registry), "--overrides", str(overrides), "--apply"]
    assert main(args) == 0
    first = registry.read_bytes()
    assert main(args) == 0
    assert registry.read_bytes() == first
    assert not list(tmp_path.glob(".registry.json.*.tmp"))


def test_dry_run_never_writes_and_reports_new_changed_removed(tmp_path: Path, capsys):
    db = tmp_path / "db.json"
    registry = tmp_path / "registry.json"
    overrides = tmp_path / "overrides.json"
    write_json(db, database())
    write_json(overrides, {"schema_version": 1, "skills": {}})
    assert main(["--database", str(db), "--registry", str(registry), "--overrides", str(overrides)]) == 0
    assert not registry.exists()
    assert "new_skills" in capsys.readouterr().out

    current, _ = propose_registry(database())
    write_registry_atomic(registry, current)
    changed = database("对目标施加火攻")
    changed["skills"]["新增"] = {"desc": "无状态"}
    write_json(db, changed)
    result = main(["--database", str(db), "--registry", str(registry), "--overrides", str(overrides)])
    output = capsys.readouterr().out
    assert result == 2
    assert "changed_descriptions" in output and "new_skills" in output


def test_registry_rejects_unknown_stale_and_contradictory_entries():
    db = database()
    registry, _ = propose_registry(db)
    stale = deepcopy(registry)
    stale["skills"]["测试"]["description_hash"] = "bad"
    with pytest.raises(MechanicsRegistryError, match="description hash"):
        validate_registry(db, stale)
    unknown = deepcopy(registry)
    unknown["skills"]["未知"] = deepcopy(unknown["skills"]["测试"])
    with pytest.raises(MechanicsRegistryError, match="skill names"):
        validate_registry(db, unknown)
    contradictory = deepcopy(registry)
    contradictory["skills"]["测试"]["referenceOnly"] = ["火攻"]
    with pytest.raises(MechanicsRegistryError, match="contradictory"):
        validate_registry(db, contradictory)


def test_mechanics_version_changes_with_description_or_relationship():
    first, _ = propose_registry(database())
    second, _ = propose_registry(database("令目标获得火攻"))
    assert first["mechanics_version"] != second["mechanics_version"]
    assert first["mechanics_version"] == propose_registry(database())[0]["mechanics_version"]
