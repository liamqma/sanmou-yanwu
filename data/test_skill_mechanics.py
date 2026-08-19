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
    assert wildfire["consumes"] == []
    assert "火攻" in luxun["provides"]
    assert "火攻" in luxun["consumes"]
    assert "火攻" not in zhangzhao["provides"]
    assert "火攻" not in zhangzhao["consumes"]


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
