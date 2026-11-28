"""Hero and skill catalog read from database.json."""
from __future__ import annotations

import hashlib
import json
from typing import Any


class InvalidCatalogError(ValueError):
    """Raised when database.json cannot be used as the catalog."""


def catalog_version(heroes: dict[str, Any], skills: dict[str, Any]) -> str:
    """Hash of the fields that change draft availability.

    The telemetry builder and the web app (`web/src/catalogVersion.js`) compute
    the same value.
    """
    payload = json.dumps(
        {
            "heroes": [
                {"name": name, "default_skill": heroes[name].get("skill"),
                 "season": heroes[name].get("season")}
                for name in sorted(heroes)
            ],
            "skills": [
                {"name": name, "color": skills[name].get("color"),
                 "season": skills[name].get("season"),
                 "shadow": skills[name].get("shadow", False)}
                for name in sorted(skills)
            ],
        },
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def load_catalog(database_path: str) -> dict[str, Any]:
    """Return `catalog_version`, the hero -> signature skill map and every skill name."""
    try:
        with open(database_path, "r", encoding="utf-8") as handle:
            db = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise InvalidCatalogError(f"cannot read database catalog {database_path}: {exc}") from exc
    heroes, skills = (db.get("heroes"), db.get("skills")) if isinstance(db, dict) else (None, None)
    if not isinstance(heroes, dict) or not isinstance(skills, dict):
        raise InvalidCatalogError("database catalog heroes and skills must both be objects")

    def season(item: Any, description: str) -> None:
        value = item.get("season") if isinstance(item, dict) else None
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise InvalidCatalogError(f"{description} season must be a positive integer")

    for name, hero in heroes.items():
        season(hero, f"database hero {name!r}")
        if not isinstance(hero.get("skill"), str) or hero["skill"] not in skills:
            raise InvalidCatalogError(f"database hero {name!r} has no catalogued default skill")
    for name, skill in skills.items():
        season(skill, f"database skill {name!r}")
        if "shadow" in skill and not isinstance(skill["shadow"], bool):
            raise InvalidCatalogError(f"database skill {name!r} has a non-boolean shadow marker")

    return {
        "catalog_version": catalog_version(heroes, skills),
        "default_skill": {name: hero["skill"] for name, hero in heroes.items()},
        "skills": frozenset(skills),
    }
