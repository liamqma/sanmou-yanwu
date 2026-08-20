from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from data.skill_mechanics import extract_skill_mechanics


DATABASE_PATH = Path("web/public/game-data/database.json")


def _database() -> dict:
    return json.loads(DATABASE_PATH.read_text(encoding="utf-8"))


def test_extracts_fire_provider_and_consumer_relationships():
    mechanics = extract_skill_mechanics(_database())

    wildfire = mechanics["skills"]["烈火张天"]
    luxun = mechanics["skills"]["火烧连营"]
    zhangzhao = mechanics["skills"]["直谏固政"]

    assert wildfire["probability"] == 0.5
    assert "火攻" in wildfire["provides"]
    assert "负面状态" in wildfire["provides"]
    assert "火攻" not in wildfire["consumes"]
    assert "火攻" in luxun["provides"]
    assert "火攻" in luxun["consumes"]
    assert "火攻" not in zhangzhao["provides"]
    assert "火攻" not in zhangzhao["consumes"]


def test_extracts_wunan_buffs_and_mayunlu_signature_consumers():
    mechanics = extract_skill_mechanics(_database())

    wunan = mechanics["skills"]["无难之志"]
    mayunlu = mechanics["skills"]["红妆缭乱"]

    assert {"连击", "倒戈"} <= set(wunan["provides"])
    assert {"连击", "倒戈"} <= set(mayunlu["consumes"])


def test_current_catalog_audit_has_no_unreviewed_status_terms():
    mechanics = extract_skill_mechanics(_database())

    assert mechanics["schema_version"] == 4
    assert mechanics["audit"]["skill_count"] == 231
    assert mechanics["audit"]["hero_count"] == 100
    assert mechanics["audit"]["bond_count"] == 57
    assert mechanics["audit"]["unknown_status_terms"] == {}
    assert mechanics["audit"]["unknown_bond_status_terms"] == {}
    assert mechanics["audit"]["reference_only_status_mentions"] == {
        "恩威并行": ["倒戈"],
        "诱敌深入": ["增益状态"],
        "连环计": ["传递伤害"],
    }


def test_new_catalog_status_and_skill_use_existing_grammar_without_code_changes():
    database = _database()
    database["buffs"]["zhan_yi"] = {
        "name": "战意",
        "effect": "造成伤害提升",
        "functional": True,
    }
    database["skills"]["未来战法"] = {
        "color": "orange",
        "type": "主动",
        "prob": 60,
        "desc": "提升两名队友30%战意，持续2回合",
        "season": 99,
    }

    mechanics = extract_skill_mechanics(database)

    assert mechanics["skills"]["未来战法"]["provides"] == ["战意"]
    assert mechanics["audit"]["unknown_status_terms"] == {}


def test_extracts_standardized_hero_metadata_and_reviewed_bonds():
    mechanics = extract_skill_mechanics(_database())

    mayunlu = mechanics["heroes"]["马云禄"]
    assert mayunlu == {
        "signature": "红妆缭乱",
        "camp": "蜀",
        "troop": "盾",
        "stats": {"武力": 214, "智力": 109, "统率": 164, "先攻": 208},
        "normalized_stats": {
            "武力": 0.856,
            "智力": 0.436,
            "统率": 0.656,
            "先攻": 0.832,
        },
    }
    assert mechanics["bonds"]["五虎上将"]["required_members"] == 3
    assert mechanics["bonds"]["虎卫御侮"]["required_members"] == 2
    assert "会心" in mechanics["bonds"]["五虎上将"]["provides"]
    assert "魏阙疑妆" not in mechanics["bonds"]
    assert "魏阙凝妆" in mechanics["bonds"]


def test_extracts_all_current_skills_and_all_estimate_families():
    database = _database()
    mechanics = extract_skill_mechanics(database)

    assert set(mechanics["skills"]) == set(database["skills"])
    emitted = {
        feature
        for skill in mechanics["skills"].values()
        for feature in skill["features"]
    }
    for expected in (
        "ESTIMATE|damage",
        "ESTIMATE|healing",
        "ESTIMATE|attribute",
        "ESTIMATE|damage_boost",
        "ESTIMATE|damage_reduction",
        "ESTIMATE|damage_dealt_reduction",
        "ESTIMATE|damage_taken_increase",
        "ESTIMATE|evasion",
        "ESTIMATE|lifesteal",
        "ESTIMATE|crit",
        "ESTIMATE|crit_damage",
    ):
        assert expected in emitted


def test_rejects_missing_or_duplicate_bond_contracts():
    database = _database()
    del database["bonds"]["三分天下"]["condition"]
    with pytest.raises(ValueError, match="activation condition"):
        extract_skill_mechanics(database)

    duplicate = _database()
    duplicate["bonds"]["重复缘分"] = copy.deepcopy(
        duplicate["bonds"]["魏阙凝妆"]
    )
    with pytest.raises(ValueError, match="duplicates"):
        extract_skill_mechanics(duplicate)

    conflicting = _database()
    conflicting["bonds"]["冲突缘分"] = copy.deepcopy(
        conflicting["bonds"]["义薄云天"]
    )
    conflicting["bonds"]["冲突缘分"]["condition"] = (
        "缘分关系3人在同一部队时激活效果"
    )
    with pytest.raises(ValueError, match="conflicting activation threshold"):
        extract_skill_mechanics(conflicting)


def test_description_or_probability_change_updates_mechanics_version():
    database = _database()
    original = extract_skill_mechanics(database)

    changed_probability = copy.deepcopy(database)
    changed_probability["skills"]["烈火张天"]["prob"] = 40
    probability_artifact = extract_skill_mechanics(changed_probability)
    assert probability_artifact["mechanics_version"] != original["mechanics_version"]
    assert probability_artifact["skills"]["烈火张天"]["probability"] == 0.4

    changed_description = copy.deepcopy(database)
    changed_description["skills"]["烈火张天"]["desc"] = changed_description["skills"]["烈火张天"]["desc"].replace("火攻", "洪水")
    description_artifact = extract_skill_mechanics(changed_description)
    assert description_artifact["mechanics_version"] != original["mechanics_version"]
    assert "洪水" in description_artifact["skills"]["烈火张天"]["provides"]


@pytest.mark.parametrize("probability", [-1, 101, True, "50"])
def test_rejects_invalid_probability(probability):
    database = _database()
    database["skills"]["烈火张天"]["prob"] = probability

    with pytest.raises(ValueError, match="probability"):
        extract_skill_mechanics(database)


def test_output_is_deterministic():
    database = _database()
    assert extract_skill_mechanics(database) == extract_skill_mechanics(database)
