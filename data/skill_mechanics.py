"""Deterministic extraction of combat mechanics from the current game catalog.

The recommendation builder runs this module offline.  The browser receives only
its compact, reviewed output and never parses Chinese descriptions at runtime.
The extractor intentionally emits reusable mechanic dimensions rather than one
feature per skill: skill identity is already represented by the model's ``S``
feature family.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping

MECHANICS_SCHEMA_VERSION = 1

ESTIMATE_FIELDS: Mapping[str, str] = {
    "damageEstimate": "damage",
    "healingEstimate": "healing",
    "attributeEstimate": "attribute",
    "damageBoostEstimate": "damage_boost",
    "damageReductionEstimate": "damage_reduction",
    "damageDealtReductionEstimate": "damage_dealt_reduction",
    "damageTakenIncreaseEstimate": "damage_taken_increase",
    "evasionEstimate": "evasion",
    "lifestealEstimate": "lifesteal",
    "critEstimate": "crit",
    "critDamageEstimate": "crit_damage",
}

# Description tags deliberately cover combat concepts shared by many skills.
# More specific producer/consumer relationships are extracted separately below.
TEXT_TAG_PATTERNS: tuple[tuple[str, str], ...] = (
    ("DAMAGE_TYPE|兵刃", r"兵刃伤害"),
    ("DAMAGE_TYPE|谋略", r"谋略伤害"),
    ("EFFECT|治疗", r"治疗率|恢复.{0,10}兵力"),
    ("EFFECT|驱散", r"驱散|清除.{0,8}(?:状态|效果)"),
    ("EFFECT|免疫", r"免疫"),
    ("EFFECT|发动率", r"发动率"),
    ("EFFECT|伤害提升", r"造成伤害提升|伤害值提升|伤害提升"),
    ("EFFECT|伤害降低", r"受到伤害降低|造成伤害降低|伤害降低"),
    ("EFFECT|属性提升", r"(?:武力|智力|统率|先攻).{0,5}提升|提升.{0,5}(?:武力|智力|统率|先攻)"),
    ("EFFECT|属性降低", r"(?:武力|智力|统率|先攻).{0,5}降低|降低.{0,5}(?:武力|智力|统率|先攻)"),
    ("TARGET|自身", r"自身"),
    ("TARGET|我军全体", r"我军全体"),
    ("TARGET|友军单体", r"友军(?:随机)?单体|一名队友"),
    ("TARGET|友军随机两人", r"友军随机两人|两名队友"),
    ("TARGET|敌军全体", r"敌军全体|敌方全体"),
    ("TARGET|敌军随机单体", r"敌军随机单体"),
    ("TARGET|敌军随机两人", r"敌军随机两人"),
    ("TARGET|前排", r"前排"),
    ("TARGET|后排", r"后排"),
    ("TRIGGER|战斗开始", r"战斗开始|战斗中"),
    ("TRIGGER|回合开始", r"回合开始"),
    ("TRIGGER|回合结束", r"回合结束"),
    ("TRIGGER|普通攻击后", r"普通攻击后"),
    ("TRIGGER|主动战法后", r"发动主动战法后|主动战法发动后"),
    ("TRIGGER|造成伤害后", r"造成.{0,8}伤害后"),
    ("TRIGGER|受到伤害后", r"受到伤害后|受到.{0,8}伤害时"),
    ("TIMING|准备", r"准备\s*\d+\s*回合"),
    ("STACKING|层数", r"\d+\s*层|可叠加"),
)

SCALING_ATTRIBUTES = ("武力", "智力", "统率", "先攻", "兵力")
STATUS_ALIASES: Mapping[str, str] = {
    "负面状态": "负面状态",
    "异常状态": "异常状态",
    "增益状态": "增益状态",
}

_PROVIDER_VERBS = r"(?:施加|获得|进入|产生|附加|使[^，。；]{0,10}(?:获得|进入))"
_CONSUMER_VERBS = r"(?:持有|处于|带有|拥有)"
_REMOVE_VERBS = r"(?:驱散|清除|移除)"
_IMMUNE_VERBS = r"(?:免疫)"


def _validated_probability(value: Any, skill_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"skill {skill_name!r} has invalid probability")
    probability = float(value) / 100.0
    if probability < 0.0 or probability > 1.0:
        raise ValueError(f"skill {skill_name!r} probability must be between 0 and 100")
    return probability


def _numeric_feature(features: dict[str, float], key: str, value: Any, skill_name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"skill {skill_name!r} has invalid numeric field {key!r}")
    # Estimates are coefficient-like percentages. Scaling by 100 keeps them in a
    # range comparable to the binary dimensions while preserving ordering.
    features[key] = round(float(value) / 100.0, 6)


def _status_roles(description: str, status_name: str) -> set[str]:
    escaped = re.escape(status_name)
    roles: set[str] = set()
    if re.search(rf"{_PROVIDER_VERBS}[^，。；]{{0,14}}{escaped}", description):
        roles.add("provides")
    if re.search(rf"{_CONSUMER_VERBS}[^，。；]{{0,12}}{escaped}", description):
        roles.add("consumes")
    if re.search(rf"{_REMOVE_VERBS}[^，。；]{{0,12}}{escaped}", description):
        roles.add("removes")
    if re.search(rf"{_IMMUNE_VERBS}[^，。；]{{0,12}}{escaped}", description):
        roles.add("immunities")
    return roles


def extract_skill_mechanics(database: Mapping[str, Any]) -> dict[str, Any]:
    """Return a compact deterministic mechanics artifact for every skill."""
    skills = database.get("skills")
    buffs = database.get("buffs")
    debuffs = database.get("debuffs")
    if not isinstance(skills, dict) or not isinstance(buffs, dict) or not isinstance(debuffs, dict):
        raise ValueError("database skills, buffs, and debuffs must be objects")

    status_rows: list[tuple[str, dict[str, Any]]] = []
    for family, rows in (("buff", buffs), ("debuff", debuffs)):
        for status_id, raw in rows.items():
            if not isinstance(raw, dict) or not isinstance(raw.get("name"), str):
                raise ValueError(f"invalid {family} status {status_id!r}")
            status_rows.append((raw["name"], {"id": status_id, "family": family, **raw}))
    # Longest names first prevents a generic status name stealing a specific span.
    status_rows.sort(key=lambda row: (-len(row[0]), row[0]))

    status_metadata = {
        name: {
            "family": row["family"],
            "negative": bool(row.get("negative", False)),
            "controlling": bool(row.get("controlling", False)),
        }
        for name, row in sorted(status_rows)
    }
    for alias in STATUS_ALIASES:
        status_metadata.setdefault(
            alias,
            {
                "family": "status_class",
                "negative": alias in {"负面状态", "异常状态"},
                "controlling": False,
            },
        )
    status_rows.extend(
        (alias, {"family": "status_class"})
        for alias in STATUS_ALIASES
        if alias not in {name for name, _row in status_rows}
    )
    status_rows.sort(key=lambda row: (-len(row[0]), row[0]))

    extracted: dict[str, Any] = {}
    for skill_name in sorted(skills):
        raw = skills[skill_name]
        if not isinstance(raw, dict):
            raise ValueError(f"invalid skill {skill_name!r}")
        description = raw.get("desc")
        skill_type = raw.get("type")
        if not isinstance(description, str) or not description.strip():
            raise ValueError(f"skill {skill_name!r} has no description")
        if not isinstance(skill_type, str) or not skill_type:
            raise ValueError(f"skill {skill_name!r} has no type")

        probability = _validated_probability(raw.get("prob"), skill_name)
        features: dict[str, float] = {
            f"TYPE|{skill_type}": 1.0,
            f"CAST_RATE|{skill_type}": round(probability, 6),
        }
        category = raw.get("category")
        if isinstance(category, str) and category:
            features[f"CATEGORY|{category}"] = 1.0

        for source_field, token in ESTIMATE_FIELDS.items():
            if source_field in raw:
                _numeric_feature(features, f"ESTIMATE|{token}", raw[source_field], skill_name)

        for token, pattern in TEXT_TAG_PATTERNS:
            if re.search(pattern, description):
                features[token] = 1.0
        for attribute in SCALING_ATTRIBUTES:
            if re.search(rf"受{attribute}[^，。；)]{{0,8}}影响|受{attribute}影响", description):
                features[f"SCALES_WITH|{attribute}"] = 1.0

        durations = [int(value) for value in re.findall(r"持续\s*(\d+)\s*回合", description)]
        if durations:
            features["NUMERIC|MAX_DURATION_ROUNDS"] = float(max(durations))
        preparations = [int(value) for value in re.findall(r"准备\s*(\d+)\s*回合", description)]
        if preparations:
            features["NUMERIC|PREPARE_ROUNDS"] = float(max(preparations))
        conditional_probabilities = [
            float(value) / 100.0
            for value in re.findall(r"(\d+(?:\.\d+)?)%概率", description)
        ]
        if conditional_probabilities:
            features["NUMERIC|MAX_CONDITIONAL_PROBABILITY"] = round(
                max(conditional_probabilities), 6
            )

        roles: dict[str, list[str]] = {
            "provides": [],
            "consumes": [],
            "removes": [],
            "immunities": [],
        }
        for status_name, _metadata in status_rows:
            if status_name not in description:
                continue
            for role in _status_roles(description, status_name):
                roles[role].append(status_name)

        # Specific debuffs also satisfy consumers that refer to their broader
        # status class instead of naming the exact effect.
        expanded_providers = set(roles["provides"])
        for status_name in tuple(expanded_providers):
            metadata = status_metadata.get(status_name, {})
            if metadata.get("negative"):
                expanded_providers.update(("负面状态", "异常状态"))
            if metadata.get("controlling"):
                expanded_providers.add("控制状态")
            if status_name in {"洪水", "火攻", "风暴"}:
                expanded_providers.add("属性降低状态")
        roles["provides"] = list(expanded_providers)

        for role, names in roles.items():
            names[:] = sorted(set(names))
            for status_name in names:
                features[f"STATUS|{role}|{status_name}"] = 1.0

        extracted[skill_name] = {
            "probability": round(probability, 6),
            "features": {key: features[key] for key in sorted(features)},
            **roles,
        }

    version_payload = {
        "schema_version": MECHANICS_SCHEMA_VERSION,
        "statuses": status_metadata,
        "skills": extracted,
    }
    encoded = json.dumps(
        version_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        **version_payload,
        "mechanics_version": hashlib.sha256(encoded).hexdigest()[:12],
    }
