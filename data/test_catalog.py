from __future__ import annotations

import json
from pathlib import Path

import pytest

from data.build_telemetry_data import load_catalog as load_telemetry_contract
from data.catalog import InvalidCatalogError, catalog_version, load_catalog

DATABASE = Path(__file__).resolve().parent.parent / "web/public/game-data/database.json"
HEROES = {"乙": {"skill": "甲技", "season": 2}, "甲": {"skill": "乙技", "season": 1}}
SKILLS = {
    "甲技": {"color": "orange", "season": 2},
    "乙技": {"color": "purple", "season": 1, "shadow": True},
    '丙"技': {"season": 3},
}


def test_catalog_version_is_pinned():
    # web/src/catalogVersion.test.ts pins the same value for the same catalog.
    assert catalog_version(HEROES, SKILLS) == "2544b17e0cd9"


def test_catalog_matches_the_telemetry_contract():
    catalog = load_catalog(str(DATABASE))
    assert catalog["catalog_version"] == load_telemetry_contract(DATABASE).catalog_version
    assert set(catalog["default_skill"].values()) <= catalog["skills"]


def test_invalid_catalogs_are_rejected(tmp_path):
    for database in (
        {"heroes": [], "skills": {}},
        {"heroes": {"甲": {"skill": "缺", "season": 1}}, "skills": {}},
        {"heroes": {}, "skills": {"甲技": {"season": 0}}},
        {"heroes": {}, "skills": {"甲技": {"season": 1, "shadow": "yes"}}},
    ):
        path = tmp_path / "database.json"
        path.write_text(json.dumps(database))
        with pytest.raises(InvalidCatalogError):
            load_catalog(str(path))
