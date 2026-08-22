#!/usr/bin/env python3
"""Deterministic offline builder for the client-side recommendation artifact.

Reads valid per-battle JSON files in ``data/battles/*.json`` and
``data/web-upload/*.json`` plus the verified normalized pinned Yanwu release,
then emits ``web/src/recommendation_data.json`` — a single artifact the fully
client-side web app imports and scores against locally.

Design (see README.md "Recommendation pipeline"):

* **Opponent-aware paired training.** Each complete battle is one paired
  observation: ``x = features(team1) - features(team2)`` with label ``y = 1`` if
  team 1 won, else ``0``. We fit a single regularized logistic regression
  (a Bradley-Terry / paired-comparison model). A positive weight on a feature
  means "having this feature makes a roster relatively stronger against the
  learned metagame".
* **No runtime opponent.** At runtime the user never enters an opponent. A
  team's *relative roster strength* is just ``w · features(team)`` (the opponent
  term cancels to a shared constant across all of a user's options, so it is
  dropped). This is a strength score, NOT a win probability against a specific
  opponent.
* **Features.** hero presence, non-default skill presence, supported hero-pair,
  assigned hero-skill, and supported within-hero skill-pair. Sparse
  interactions are filtered by a support threshold and shrunk by L2. Atomic
  hero and skill weights then receive a bounded, symmetric player-selection
  count prior: season-aware team appearances above uniform expectation add
  strength and appearances below expectation subtract it. Battles with unknown
  season train the logistic fit but cannot affect this availability-based prior.
* **Deterministic.** Fixed feature ordering (sorted), fixed solver + seed, no
  wall-clock anywhere in the artifact. Re-running on the same battles yields a
  byte-identical ``recommendation_data.json`` (verified by a two-build equality
  test). A ``corpus_version`` content hash of the validated battles identifies
  the training data; there is no ``generated_at`` timestamp or ``added_battles``
  delta (both would break byte-determinism and depend on prior output).
* **Fail-closed loading.** The CLI/build aborts *before writing* if any battle
  file is invalid or unreadable, so a corrupt capture can never silently skew or
  partially overwrite the artifact.

The file is import-safe: every stage is a pure function so
``data/test_build_recommendation_data.py`` can exercise them without touching
the real corpus. ``main()`` wires them together for the CLI.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from types import MappingProxyType
import unicodedata
from typing import Any, Iterable, Mapping

import numpy as np
from sklearn.linear_model import LogisticRegression

try:
    from recommendation_evaluation import (
        EVALUATION_PROTOCOL_VERSION,
        GROUP_HOLDOUT_SEED,
        NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS,
        SESSION_GAP_SECONDS,
        SOURCE_CATEGORIES,
        SOURCE_EXTERNAL_YANWU,
        SOURCE_UPLOADED_BY_ME,
        SOURCE_UPLOADED_BY_OTHERS,
        assign_evaluation_groups,
        grouped_hash_split,
        prediction_report,
    )
    from yanwu_corpus import (
        InvalidYanwuCorpus,
        load_manifest,
        load_normalized_corpus,
        normalized_cache_path,
    )
    from skill_mechanics import MechanicsRegistryError, load_validated_registry
except ModuleNotFoundError:  # Support ``import data.build_recommendation_data``.
    from .recommendation_evaluation import (
        EVALUATION_PROTOCOL_VERSION,
        GROUP_HOLDOUT_SEED,
        NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS,
        SESSION_GAP_SECONDS,
        SOURCE_CATEGORIES,
        SOURCE_EXTERNAL_YANWU,
        SOURCE_UPLOADED_BY_ME,
        SOURCE_UPLOADED_BY_OTHERS,
        assign_evaluation_groups,
        grouped_hash_split,
        prediction_report,
    )
    from .yanwu_corpus import (
        InvalidYanwuCorpus,
        load_manifest,
        load_normalized_corpus,
        normalized_cache_path,
    )
    from .skill_mechanics import MechanicsRegistryError, load_validated_registry

# --------------------------------------------------------------------------- #
# Constants / schema metadata
# --------------------------------------------------------------------------- #

SCHEMA_VERSION = 6
MODEL_TYPE = "paired-logistic"

# A skill's first entry (index 0) is the hero's default/signature skill and is
# not a draftable choice, so it is excluded from skill features.
DEFAULT_SKILL_INDEX = 0

# A battle is always two teams of exactly this many heroes; a capture with a
# different count (e.g. OCR dropped or duplicated a hero) is rejected so the
# fail-closed build never trains on a truncated roster.
TEAM_SIZE = 3

# Every captured hero has one signature skill followed by two equipped skills.
# A shorter/longer list is an incomplete or corrupt OCR result and must not be
# allowed into production training.
SKILLS_PER_HERO = 3

# Feature-family prefixes (kept short; they appear as JSON keys).
F_HERO = "H"           # hero present on team
F_SKILL = "S"          # non-default skill present on team
F_HERO_PAIR = "HP"     # unordered hero pair co-present
F_HERO_SKILL = "HS"    # (hero, assigned non-default skill)
F_SKILL_PAIR = "SP"    # unordered non-default skill pair within one hero
F_TEAM_HERO_SKILL = "THS"  # hero and tactic coexist on a concrete team
F_TEAM_SKILL_PAIR = "TSP"  # tactics coexist on a concrete team
F_HERO_TRIO = "HT"         # exact concrete three-hero team
F_CAMP = "HC"              # exclusive same-camp composition
F_BOND = "B"               # validated activated bond
F_MECH = "MX"              # external provider/beneficiary status match
F_HERO_MECH = "HMX"        # benefiting hero plus external provider
F_TEAM_SKILL_TRIPLE = "TS3"  # experimental exact tactic triple

ATOMIC_FAMILIES = frozenset((F_HERO, F_SKILL))
PAIR_CONTEXT_FAMILIES = frozenset((
    F_HERO_PAIR, F_HERO_SKILL, F_SKILL_PAIR, F_TEAM_HERO_SKILL,
    F_TEAM_SKILL_PAIR, F_CAMP, F_BOND, F_MECH, F_HERO_MECH,
))
HIGH_ORDER_FAMILIES = frozenset((F_HERO_TRIO, F_TEAM_SKILL_TRIPLE))
ALL_FEATURE_FAMILIES = ATOMIC_FAMILIES | PAIR_CONTEXT_FAMILIES | HIGH_ORDER_FAMILIES
# Development-selected production subset. Higher-order and MECH experiments
# remain implemented and evaluation-addressable but are not promoted silently.
PRODUCTION_ENABLED_FAMILIES = frozenset((
    F_HERO, F_SKILL, F_HERO_PAIR, F_HERO_SKILL, F_SKILL_PAIR,
    F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR,
))

# Support thresholds: interactions seen in fewer battles than this are dropped
# (their signal is too sparse to fit; the constituent single-item features still
# carry them). Single-item features use a lower floor.
MIN_SUPPORT_SINGLE = 5
MIN_SUPPORT_PAIR = 8
MIN_SUPPORT_CONTEXT = 20
MIN_SUPPORT_HIGH_ORDER = 50

# L2 inverse-regularization strength for LogisticRegression (smaller = stronger
# shrinkage toward the neutral prior of 0). The grouped development evaluation
# strongly preferred 0.05 to the former 0.5, which allowed sparse conditional
# features to receive implausibly large outcome coefficients.
L2_C = 0.05

RANDOM_SEED = 0

# Player selection is information in this draft corpus: a hero or tactic must
# first be offered and deliberately selected before it can appear in a battle
# report. Add a bounded, symmetric post-fit count prior to atomic H/S weights.
# Counts are team appearances (six hero and twelve non-signature tactic slots per
# battle), normalized by season-specific catalog availability. Hero and tactic
# strengths are deliberately separate because their choice pools differ.
SELECTION_PRIOR_HERO_STRENGTH = 0.4
SELECTION_PRIOR_SKILL_STRENGTH = 0.3
SELECTION_PRIOR_SMOOTHING = 20.0
SELECTION_PRIOR_LOG_RATIO_CLIP = 2.0

# Final coefficients below this magnitude are not emitted. The selection prior
# may create an atomic artifact key even when the outcome coefficient is neutral.
WEIGHT_EPSILON = 1e-6

# Semantic duplicate policy shared with the web-upload importer. Hero and skill
# positions remain ordered, the two submitted team sides are canonicalized, and
# the winning lineup plus exact uploader identity remain significant. Manual
# captures use a structured sentinel that no nullable/string web uploader can
# produce.
DUPLICATE_FINGERPRINT_VERSION = 1
DUPLICATE_FINGERPRINT_ALGORITHM = "sha256"
DUPLICATE_FINGERPRINT_SCHEMA = "sanmou-battle-submission-v1"
MAX_DUPLICATE_FINGERPRINT_COUNT = 2
MANUAL_UPLOADER_IDENTITY: Mapping[str, str] = {
    "reserved": "manual-corpus-v1",
}

# A filename like 2025-09-04-174619.json encodes a trustworthy capture time we
# use only for battle/session grouping.
_DATED_FILENAME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-(\d{6})")
_EPOCH_MILLIS_FILENAME = re.compile(r"^screenshot_(\d{13})\.json$")
_MACOS_SCREENSHOT_FILENAME = re.compile(
    r"^Screenshot (\d{4}-\d{2}-\d{2}) at "
    r"(\d{1,2})\.(\d{2})\.(\d{2})[\u202f ]?(am|pm)\.json$",
    re.IGNORECASE,
)


class InvalidBattleError(ValueError):
    """Raised when a battle file cannot be used for training."""


# --------------------------------------------------------------------------- #
# Loading & validation
# --------------------------------------------------------------------------- #

@dataclass
class Battle:
    """A validated battle: two 3-hero teams and a definite winner (1 or 2)."""

    filename: str
    team1: list[dict[str, Any]]
    team2: list[dict[str, Any]]
    winner: int  # 1 or 2
    order_key: str = ""
    season: int | None = None
    source: str = SOURCE_UPLOADED_BY_ME
    captured_at: float | None = None
    # Used only to keep separate contributors' upload sessions apart. It is
    # never serialized into the recommendation artifact or evaluation report.
    uploader_identity: str = ""
    evaluation_identity: str = ""


@dataclass(frozen=True)
class CatalogNames:
    """Exact database names accepted by production battle validation."""

    heroes: frozenset[str]
    skills: frozenset[str]


@dataclass(frozen=True)
class _CatalogSeasons:
    """Private item availability used only while fitting the model.

    ``skills`` includes every catalog skill so observed battle rows can be
    validated. ``draftable_skills`` is narrower: standalone skills that may be
    offered independently, excluding hero signatures and explicit shadow
    skills. Only this narrower set may receive a zero-observation ``S`` prior.
    An observed non-default skill remains eligible regardless of this set.
    """

    heroes: Mapping[str, int]
    skills: Mapping[str, int]
    draftable_skills: frozenset[str] = frozenset()


@dataclass(frozen=True)
class _CatalogContext:
    """Private validated catalog state; only ``metadata`` is serialized."""

    metadata: dict[str, Any]
    names: CatalogNames
    seasons: _CatalogSeasons


def validate_battle(
    raw: dict[str, Any],
    filename: str,
    *,
    catalog_names: CatalogNames | None = None,
    catalog_seasons: _CatalogSeasons | None = None,
    allow_shadow_skills: bool = False,
) -> Battle:
    """Validate a raw battle dict, returning a :class:`Battle`.

    Fails clearly (raising :class:`InvalidBattleError`) on an unknown or invalid
    winner rather than silently counting both teams as losses — this is the bug
    the old exporter had (``winner='unknown'`` → both teams recorded a loss).

    ``catalog_names`` is optional so focused unit callers can validate synthetic
    data without reading repository files. The production build always supplies
    it, which makes hero/skill spelling fail closed against the current
    database. Every key under ``database.skills`` is accepted, including
    transferred/``shadow`` skills marked with ``"shadow": true``.
    """
    if not isinstance(raw, dict):
        raise InvalidBattleError(f"{filename}: battle must be a JSON object")

    winner_raw = raw.get("winner")
    if winner_raw not in ("1", "2", 1, 2):
        raise InvalidBattleError(
            f"{filename}: invalid/unknown winner {winner_raw!r} "
            f"(expected '1' or '2')"
        )
    winner = int(winner_raw)

    season_raw = raw.get("season")
    if season_raw is None:
        # Legacy/manual captures may have genuinely unknown season. They remain
        # usable for logistic fitting but do not enter season-aware selection
        # appearance or expected-count calculations.
        season = None
    elif (
        not isinstance(season_raw, bool)
        and isinstance(season_raw, int)
        and season_raw > 0
    ):
        season = season_raw
    else:
        raise InvalidBattleError(
            f"{filename}: invalid season {season_raw!r} "
            "(expected a positive integer or null)"
        )

    teams: dict[int, list[dict[str, Any]]] = {}
    for team_key in (1, 2):
        team_data = raw.get(str(team_key))
        if not isinstance(team_data, list) or not team_data:
            raise InvalidBattleError(f"{filename}: team {team_key} missing/empty")
        heroes: list[dict[str, Any]] = []
        seen_hero_names: set[str] = set()
        for hero in team_data:
            if not isinstance(hero, dict):
                raise InvalidBattleError(
                    f"{filename}: team {team_key} has an invalid hero"
                )
            name = hero.get("name")
            if not isinstance(name, str) or not name:
                raise InvalidBattleError(f"{filename}: team {team_key} has an unnamed hero")
            if name in seen_hero_names:
                raise InvalidBattleError(
                    f"{filename}: team {team_key} has duplicate hero {name!r}"
                )
            seen_hero_names.add(name)
            if catalog_names is not None and name not in catalog_names.heroes:
                raise InvalidBattleError(
                    f"{filename}: team {team_key} has unknown hero {name!r}"
                )
            if catalog_seasons is not None:
                intro_season = catalog_seasons.heroes.get(name)
                if intro_season is None:
                    raise InvalidBattleError(
                        f"{filename}: team {team_key} hero {name!r} has no "
                        "catalog introduction season"
                    )
                if season is not None and season < intro_season:
                    raise InvalidBattleError(
                        f"{filename}: team {team_key} hero {name!r} was "
                        f"introduced in season {intro_season}, after battle "
                        f"season {season}"
                    )
            skills_raw = hero.get("skills")
            if not isinstance(skills_raw, list):
                raise InvalidBattleError(
                    f"{filename}: team {team_key} hero {name!r} has invalid skills"
                )
            if len(skills_raw) != SKILLS_PER_HERO:
                raise InvalidBattleError(
                    f"{filename}: team {team_key} hero {name!r} has "
                    f"{len(skills_raw)} skills (expected {SKILLS_PER_HERO})"
                )
            for skill in skills_raw:
                if not isinstance(skill, str) or not skill:
                    raise InvalidBattleError(
                        f"{filename}: team {team_key} hero {name!r} has invalid skills"
                    )
                if catalog_names is not None and skill not in catalog_names.skills:
                    raise InvalidBattleError(
                        f"{filename}: team {team_key} hero {name!r} has "
                        f"unknown skill {skill!r}"
                    )
                if catalog_seasons is not None:
                    intro_season = catalog_seasons.skills.get(skill)
                    if intro_season is None:
                        raise InvalidBattleError(
                            f"{filename}: team {team_key} hero {name!r} skill "
                            f"{skill!r} has no catalog introduction season"
                        )
                    if season is not None and season < intro_season:
                        raise InvalidBattleError(
                            f"{filename}: team {team_key} hero {name!r} skill "
                            f"{skill!r} was introduced in season "
                            f"{intro_season}, after battle season {season}"
                        )
            if "shadow_skills" in hero and not allow_shadow_skills:
                raise InvalidBattleError(
                    f"{filename}: team {team_key} hero {name!r} has "
                    "unauthenticated shadow-skill provenance"
                )
            shadow_skills_raw = hero.get("shadow_skills", [])
            if (
                not isinstance(shadow_skills_raw, list)
                or any(
                    not isinstance(skill, str)
                    or not skill
                    for skill in shadow_skills_raw
                )
                or len(set(shadow_skills_raw)) != len(shadow_skills_raw)
                or any(skill not in skills_raw[1:] for skill in shadow_skills_raw)
            ):
                raise InvalidBattleError(
                    f"{filename}: team {team_key} hero {name!r} has invalid "
                    "shadow-skill provenance"
                )
            # Preserve every position. Duplicate fingerprints intentionally
            # distinguish hero/skill reordering, so validation must never
            # collapse falsey entries or otherwise normalize this list.
            normalized_hero = {"name": name, "skills": list(skills_raw)}
            if shadow_skills_raw:
                normalized_hero["shadow_skills"] = list(shadow_skills_raw)
            heroes.append(normalized_hero)
        if len(heroes) != TEAM_SIZE:
            raise InvalidBattleError(
                f"{filename}: team {team_key} has {len(heroes)} heroes "
                f"(expected {TEAM_SIZE})"
            )
        teams[team_key] = heroes

    order_key = _order_key(filename)
    return Battle(
        filename=filename,
        team1=teams[1],
        team2=teams[2],
        winner=winner,
        order_key=order_key,
        season=season,
    )


def _compact_team(team: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the exact ordered team shape used by JavaScript JSON.stringify."""
    return [
        {
            "name": hero["name"],
            "skills": list(hero["skills"]),
        }
        for hero in team
    ]


def _compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _javascript_string_order_key(value: str) -> bytes:
    """Match JavaScript's ordinal UTF-16 string comparison."""
    return value.encode("utf-16-be")


def duplicate_fingerprint(
    battle: Battle,
    uploader_name: str | None = None,
    *,
    manual: bool = False,
) -> str:
    """Return the versioned semantic duplicate fingerprint for one battle.

    Web submissions exactly mirror ``canonicalFingerprintJson`` in the Pages
    Function. Manual captures use a structured reserved uploader identity, so
    they participate in the same global cap without colliding with any exact
    nullable/string web uploader.
    """
    if manual and uploader_name is not None:
        raise ValueError("manual fingerprints do not accept an uploader name")

    team1 = _compact_team(battle.team1)
    team2 = _compact_team(battle.team2)
    team1_json = _compact_json(team1)
    team2_json = _compact_json(team2)
    swap_sides = (
        _javascript_string_order_key(team2_json)
        < _javascript_string_order_key(team1_json)
    )
    teams = [team2, team1] if swap_sides else [team1, team2]
    # When the ordered teams are byte-identical, side labels carry no semantic
    # information. Force one canonical winner so swapping those indistinguish-
    # able sides cannot manufacture a second fingerprint.
    if team1_json == team2_json:
        winner = "1"
    else:
        winner = str(3 - battle.winner) if swap_sides else str(battle.winner)
    payload = {
        "schema": DUPLICATE_FINGERPRINT_SCHEMA,
        "uploader_name": (
            MANUAL_UPLOADER_IDENTITY if manual else uploader_name
        ),
        "teams": teams,
        "winner": winner,
    }
    return hashlib.sha256(_compact_json(payload).encode("utf-8")).hexdigest()


def manual_fingerprint_counts(battles: Iterable[Battle]) -> dict[str, int]:
    """Return sorted fingerprint counts for the reserved manual uploader."""
    counts = Counter(
        duplicate_fingerprint(battle, manual=True)
        for battle in battles
    )
    return dict(sorted(counts.items()))


def _order_key(filename: str) -> str:
    """Chronological sort key.

    Dated captures (``YYYY-MM-DD-HHMMSS.json``) sort by their timestamp; other
    filenames sort lexicographically after all dated ones so loading stays
    deterministic. Evaluation session timestamps are parsed separately from
    every supported filename/upload format.
    """
    m = _DATED_FILENAME.match(filename)
    if m:
        return f"0-{m.group(1)}{m.group(2)}{m.group(3)}{m.group(4)}"
    return f"1-{filename}"


def _parse_iso_timestamp(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _capture_timestamp(
    basename: str,
    raw: Mapping[str, Any],
    source: str,
) -> float | None:
    """Return the best deterministic observation time for session grouping."""
    if source == SOURCE_UPLOADED_BY_OTHERS:
        return _parse_iso_timestamp(raw.get("uploaded_at"))

    dated = _DATED_FILENAME.match(basename)
    if dated:
        value = (
            f"{dated.group(1)}-{dated.group(2)}-{dated.group(3)}"
            f"{dated.group(4)}"
        )
        parsed = datetime.strptime(value, "%Y-%m-%d%H%M%S").replace(
            tzinfo=timezone.utc
        )
        return parsed.timestamp()

    epoch_millis = _EPOCH_MILLIS_FILENAME.fullmatch(basename)
    if epoch_millis:
        return int(epoch_millis.group(1)) / 1_000.0

    macos = _MACOS_SCREENSHOT_FILENAME.fullmatch(basename)
    if macos:
        hour = int(macos.group(2))
        meridiem = macos.group(5).lower()
        if hour == 12:
            hour = 0
        if meridiem == "pm":
            hour += 12
        parsed = datetime.strptime(macos.group(1), "%Y-%m-%d").replace(
            hour=hour,
            minute=int(macos.group(3)),
            second=int(macos.group(4)),
            tzinfo=timezone.utc,
        )
        return parsed.timestamp()
    return None


def load_battles(
    battles_dir: str = "data/battles",
    battle_files: Iterable[str] | None = None,
    *,
    filename_prefix: str = "",
    catalog_names: CatalogNames | None = None,
    catalog_seasons: _CatalogSeasons | None = None,
    source: str = SOURCE_UPLOADED_BY_ME,
) -> tuple[list[Battle], list[str]]:
    """Load and validate all battle files.

    Returns ``(valid_battles, errors)``. Battles retain the historical
    deterministic ``order_key`` ordering; evaluation uses the separately parsed
    observation time and season. Invalid/unreadable battles are collected here
    as human-readable diagnostics; loading itself does
    not abort. ``build`` (and therefore the CLI) treats any diagnostic as fatal
    and refuses to write, so an invalid corpus can never partially overwrite the
    artifact.
    """
    if source not in SOURCE_CATEGORIES:
        raise ValueError(f"unknown battle source category {source!r}")
    if battle_files is None:
        battle_files = sorted(glob.glob(os.path.join(battles_dir, "*.json")))

    battles: list[Battle] = []
    errors: list[str] = []
    for path in battle_files:
        basename = os.path.basename(path)
        filename = f"{filename_prefix}{basename}"
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{filename}: unreadable ({exc})")
            continue
        try:
            battle = validate_battle(
                raw,
                filename,
                catalog_names=catalog_names,
                catalog_seasons=catalog_seasons,
            )
            # Preserve the historical manual-corpus ordering and artifact
            # bytes: the source-qualified label is diagnostic-only, while the
            # basename remains the chronological key.
            battle.order_key = _order_key(basename)
            battle.source = source
            battle.captured_at = _capture_timestamp(basename, raw, source)
            uploader = raw.get("uploader_name")
            battle.uploader_identity = uploader if isinstance(uploader, str) else ""
            battles.append(battle)
        except InvalidBattleError as exc:
            errors.append(str(exc))

    battles.sort(key=lambda b: b.order_key)
    return battles, errors


def load_yanwu_battles(
    corpus_path: str,
    manifest_path: str,
    *,
    catalog_version: str,
    catalog_names: CatalogNames,
    catalog_seasons: _CatalogSeasons,
) -> tuple[list[Battle], list[str]]:
    """Load a verified normalized Yanwu collection as one external source."""
    try:
        manifest = load_manifest(Path(manifest_path))
        corpus = load_normalized_corpus(
            Path(corpus_path),
            manifest,
            catalog_version=catalog_version,
        )
    except InvalidYanwuCorpus as exc:
        return [], [f"external Yanwu corpus: {exc}"]

    battles: list[Battle] = []
    errors: list[str] = []
    for row in corpus["reports"]:
        source_id = row["source_id"]
        filename = (
            f"external-yanwu/S{row['season']}/"
            f"{row['import_order']:08d}-{source_id}.json"
        )
        try:
            battle = validate_battle(
                row,
                filename,
                catalog_names=catalog_names,
                catalog_seasons=catalog_seasons,
                allow_shadow_skills=True,
            )
        except InvalidBattleError as exc:
            errors.append(str(exc))
            continue
        captured_at = _parse_iso_timestamp(row["captured_at"])
        if captured_at is None:
            errors.append(f"{filename}: invalid normalized capture timestamp")
            continue
        battle.source = SOURCE_EXTERNAL_YANWU
        battle.captured_at = captured_at
        battle.evaluation_identity = row["evaluation_identity"]
        battle.order_key = (
            f"2-{row['season']:04d}-{row['import_order']:08d}-{source_id}"
        )
        battles.append(battle)

    battles.sort(key=lambda battle: (battle.order_key, battle.filename))
    return battles, errors


def _load_json_object(path: str, description: str) -> dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise InvalidBattleError(f"cannot read {description} {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise InvalidBattleError(f"{description} must be a JSON object")
    return value


def _validate_count_map(value: Any, description: str) -> dict[str, int]:
    if not isinstance(value, dict):
        raise InvalidBattleError(f"{description} must be an object")
    counts: dict[str, int] = {}
    for fingerprint, count in value.items():
        if (
            not isinstance(fingerprint, str)
            or not re.fullmatch(r"[0-9a-f]{64}", fingerprint)
            or isinstance(count, bool)
            or not isinstance(count, int)
            or not 1 <= count <= MAX_DUPLICATE_FINGERPRINT_COUNT
        ):
            raise InvalidBattleError(
                f"{description} contains an invalid fingerprint count"
            )
        counts[fingerprint] = count
    return counts


def validate_training_duplicate_policy(
    manual_battles: list[Battle],
    web_battles: list[Battle],
    web_upload_state_path: str | None,
) -> None:
    """Defend the global two-observation cap before model fitting.

    Manual identities are available directly and are recomputed here. Retained
    web records include provenance metadata, but the aggregate checkpoint
    remains the authoritative bounded fingerprint count used by training. Its
    web counts must account for every accepted web file.
    """
    manual_counts = manual_fingerprint_counts(manual_battles)
    over_cap = [
        fingerprint
        for fingerprint, count in manual_counts.items()
        if count > MAX_DUPLICATE_FINGERPRINT_COUNT
    ]
    if over_cap:
        raise InvalidBattleError(
            "manual battle corpus exceeds the semantic duplicate cap of "
            f"{MAX_DUPLICATE_FINGERPRINT_COUNT}"
        )

    if web_upload_state_path is None:
        if web_battles:
            raise InvalidBattleError(
                "web-upload battles require their aggregate fingerprint checkpoint"
            )
        return

    state = _load_json_object(
        web_upload_state_path,
        "web-upload aggregate checkpoint",
    )
    fingerprints = state.get("fingerprints")
    if (
        not isinstance(fingerprints, dict)
        or fingerprints.get("version") != DUPLICATE_FINGERPRINT_VERSION
        or fingerprints.get("algorithm") != DUPLICATE_FINGERPRINT_ALGORITHM
    ):
        raise InvalidBattleError(
            "web-upload fingerprint checkpoint contract is invalid"
        )
    web_counts = _validate_count_map(
        fingerprints.get("web"),
        "web-upload fingerprint counts",
    )
    if sum(web_counts.values()) != len(web_battles):
        raise InvalidBattleError(
            "web-upload fingerprint counts do not match accepted battle files"
        )


# --------------------------------------------------------------------------- #
# Feature extraction (shared by builder + the TS client, kept in lockstep)
# --------------------------------------------------------------------------- #

def _non_default_skills(
    hero: dict[str, Any], default_skill: Mapping[str, str]
) -> list[str]:
    """The draftable (non-default) skills for a hero, order-preserved & unique.

    A hero's signature skill is dropped two ways so training stays in lockstep
    with the TS client regardless of OCR quirks: positionally (the signature
    occupies capture slot ``DEFAULT_SKILL_INDEX``, so a *misread* signature there
    is still excluded) and by *name* against the catalog default (so a correctly
    read signature that OCR duplicated or shifted off slot 0 is never trained as
    a draftable feature the client can't activate).
    """
    skills = hero.get("skills") or []
    signature = default_skill.get(hero.get("name", ""))
    out: list[str] = []
    seen: set[str] = set()
    for skill in skills[DEFAULT_SKILL_INDEX + 1:]:
        if skill and skill != signature and skill not in seen:
            seen.add(skill)
            out.append(skill)
    return out


# Canonical feature-id helpers.  TypeScript mirrors these in exactly one module.
def hero_feature_id(hero: str) -> str:
    return f"{F_HERO}|{hero}"


def skill_feature_id(skill: str) -> str:
    return f"{F_SKILL}|{skill}"


def unordered_feature_id(family: str, *names: str) -> str:
    return "|".join((family, *sorted(names)))


def hero_skill_feature_id(family: str, hero: str, skill: str) -> str:
    return f"{family}|{hero}|{skill}"


def hero_skill_pair_feature_id(hero: str, first: str, second: str) -> str:
    return "|".join((F_SKILL_PAIR, hero, *sorted((first, second))))


def _is_concrete_team(team: list[dict[str, Any]], heroes: list[str]) -> bool:
    return len(team) == TEAM_SIZE and len(heroes) == TEAM_SIZE and len(set(heroes)) == TEAM_SIZE


def team_features(
    team: list[dict[str, Any]],
    default_skill: Mapping[str, str],
    feature_catalog: Mapping[str, Any] | None = None,
    *,
    enabled_families: Iterable[str] | None = None,
) -> dict[str, int]:
    """Presence-encoded features for one team.

    Assignment features (H/S/HP/HS/SP) retain their historical behavior.  Every
    new context family is deferred unless ``team`` is a feasible concrete,
    unique three-hero team, preventing an unpartitioned draft pool from being
    treated as one giant formation.
    """
    enabled = frozenset(enabled_families) if enabled_families is not None else (
        ALL_FEATURE_FAMILIES if feature_catalog is not None else
        frozenset((F_HERO, F_SKILL, F_HERO_PAIR, F_HERO_SKILL, F_SKILL_PAIR))
    )
    feats: dict[str, int] = {}
    heroes = [h.get("name", "") for h in team if h.get("name")]
    if F_HERO in enabled:
        for hero in heroes:
            feats[hero_feature_id(hero)] = 1

    uniq_heroes = sorted(set(heroes))
    if F_HERO_PAIR in enabled:
        for first, second in combinations(uniq_heroes, 2):
            feats[unordered_feature_id(F_HERO_PAIR, first, second)] = 1

    team_skills: set[str] = set()
    non_default_by_hero: dict[str, list[str]] = {}
    for hero_data in team:
        hero = hero_data.get("name", "")
        if not hero:
            continue
        skills = _non_default_skills(hero_data, default_skill)
        non_default_by_hero[hero] = skills
        team_skills.update(skills)
        for skill in skills:
            if F_SKILL in enabled:
                feats[skill_feature_id(skill)] = 1
            if F_HERO_SKILL in enabled:
                feats[hero_skill_feature_id(F_HERO_SKILL, hero, skill)] = 1
        if F_SKILL_PAIR in enabled:
            for first, second in combinations(sorted(set(skills)), 2):
                feats[hero_skill_pair_feature_id(hero, first, second)] = 1

    if feature_catalog is None or not _is_concrete_team(team, heroes):
        return feats

    sorted_skills = sorted(team_skills)
    if F_TEAM_HERO_SKILL in enabled:
        for hero in uniq_heroes:
            for skill in sorted_skills:
                feats[hero_skill_feature_id(F_TEAM_HERO_SKILL, hero, skill)] = 1
    if F_TEAM_SKILL_PAIR in enabled:
        for first, second in combinations(sorted_skills, 2):
            feats[unordered_feature_id(F_TEAM_SKILL_PAIR, first, second)] = 1
    if F_HERO_TRIO in enabled:
        feats[unordered_feature_id(F_HERO_TRIO, *uniq_heroes)] = 1
    if F_TEAM_SKILL_TRIPLE in enabled:
        for triple in combinations(sorted_skills, 3):
            feats[unordered_feature_id(F_TEAM_SKILL_TRIPLE, *triple)] = 1

    if F_CAMP in enabled:
        hero_camp = feature_catalog.get("hero_camp", {})
        camps = [hero_camp.get(hero) for hero in heroes]
        if all(isinstance(camp, str) and camp for camp in camps):
            counts = Counter(camps)
            maximum = max(counts.values())
            if maximum == 3:
                feats[f"{F_CAMP}|3"] = 1
            elif maximum == 2:
                feats[f"{F_CAMP}|2"] = 1

    if F_BOND in enabled:
        hero_set = set(heroes)
        for bond in feature_catalog.get("bonds", []):
            if len(hero_set.intersection(bond["members"])) >= bond["required_members"]:
                feats[f"{F_BOND}|{bond['name']}"] = 1

    if F_MECH in enabled or F_HERO_MECH in enabled:
        mechanics = feature_catalog.get("skill_mechanics", {})
        instances: set[tuple[str, str]] = set()
        for hero in uniq_heroes:
            signature = default_skill.get(hero)
            if signature:
                instances.add((hero, signature))
            for skill in non_default_by_hero.get(hero, []):
                instances.add((hero, skill))
        for owner, beneficiary_skill in sorted(instances):
            beneficiary = mechanics.get(beneficiary_skill, {})
            for status in beneficiary.get("benefitsFrom", []):
                matched = any(
                    (provider_owner, provider_skill) != (owner, beneficiary_skill)
                    and status in mechanics.get(provider_skill, {}).get("provides", [])
                    for provider_owner, provider_skill in instances
                )
                if not matched:
                    continue
                if F_MECH in enabled:
                    feats[f"{F_MECH}|{status}"] = 1
                if F_HERO_MECH in enabled:
                    feats[f"{F_HERO_MECH}|{owner}|{status}"] = 1
    return feats


def paired_difference(
    b: Battle,
    default_skill: Mapping[str, str],
    feature_catalog: Mapping[str, Any] | None = None,
    *,
    enabled_families: Iterable[str] | None = None,
) -> dict[str, int]:
    """team1 features minus team2 features (values in {-1,0,1})."""
    f1 = team_features(b.team1, default_skill, feature_catalog, enabled_families=enabled_families)
    f2 = team_features(b.team2, default_skill, feature_catalog, enabled_families=enabled_families)
    return {
        key: value
        for key in set(f1) | set(f2)
        if (value := f1.get(key, 0) - f2.get(key, 0)) != 0
    }


def compute_support(
    battles: list[Battle],
    default_skill: Mapping[str, str],
    feature_catalog: Mapping[str, Any] | None = None,
    *,
    enabled_families: Iterable[str] | None = None,
) -> dict[str, int]:
    """Literal number of battles where a feature appears on either team."""
    support: dict[str, int] = defaultdict(int)
    for battle in battles:
        seen = set(team_features(battle.team1, default_skill, feature_catalog, enabled_families=enabled_families))
        seen.update(team_features(battle.team2, default_skill, feature_catalog, enabled_families=enabled_families))
        for key in seen:
            support[key] += 1
    return dict(support)


def _min_support_for(
    feature_id: str,
    *,
    min_support_single: int = MIN_SUPPORT_SINGLE,
    min_support_pair: int = MIN_SUPPORT_PAIR,
    min_support_context: int = MIN_SUPPORT_CONTEXT,
    min_support_high_order: int = MIN_SUPPORT_HIGH_ORDER,
) -> int:
    family = feature_id.split("|", 1)[0]
    if family in ATOMIC_FAMILIES:
        return min_support_single
    if family in (F_HERO_PAIR, F_HERO_SKILL, F_SKILL_PAIR):
        return min_support_pair
    if family in HIGH_ORDER_FAMILIES:
        return min_support_high_order
    return min_support_context


def select_features(
    support: dict[str, int],
    *,
    min_support_single: int = MIN_SUPPORT_SINGLE,
    min_support_pair: int = MIN_SUPPORT_PAIR,
    min_support_context: int = MIN_SUPPORT_CONTEXT,
    min_support_high_order: int = MIN_SUPPORT_HIGH_ORDER,
    excluded_families: Iterable[str] = (),
    enabled_families: Iterable[str] | None = None,
) -> list[str]:
    """Select features using support from training rows only.

    TS3 additionally requires each constituent TSP pair to clear the context
    floor.  This support-only rule is deterministic and outcome-independent.
    """
    thresholds = (min_support_single, min_support_pair, min_support_context, min_support_high_order)
    if any(value < 1 for value in thresholds):
        raise ValueError("feature support thresholds must be positive")
    excluded = frozenset(excluded_families)
    allowed = frozenset(enabled_families) if enabled_families is not None else PRODUCTION_ENABLED_FAMILIES
    kept: list[str] = []
    for feature_id, count in support.items():
        family = feature_id.split("|", 1)[0]
        if family in excluded or family not in allowed:
            continue
        if count < _min_support_for(
            feature_id,
            min_support_single=min_support_single,
            min_support_pair=min_support_pair,
            min_support_context=min_support_context,
            min_support_high_order=min_support_high_order,
        ):
            continue
        if family == F_TEAM_SKILL_TRIPLE:
            skills = feature_id.split("|")[1:]
            if any(
                support.get(unordered_feature_id(F_TEAM_SKILL_PAIR, *pair), 0) < min_support_context
                for pair in combinations(skills, 2)
            ):
                continue
        kept.append(feature_id)
    return sorted(kept)


# --------------------------------------------------------------------------- #
# Design matrix + model fitting
# --------------------------------------------------------------------------- #

def build_design_matrix(
    battles: list[Battle],
    feature_index: dict[str, int],
    default_skill: Mapping[str, str],
    feature_catalog: Mapping[str, Any] | None = None,
    *,
    enabled_families: Iterable[str] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(X, y)`` for the paired logistic regression.

    ``X[i]`` is the ``team1 - team2`` feature difference restricted to the
    selected ``feature_index``; ``y[i] = 1`` iff team 1 won. Features outside the
    index are ignored (they were dropped for sparsity).
    """
    n = len(battles)
    d = len(feature_index)
    X = np.zeros((n, d), dtype=np.float64)
    y = np.zeros(n, dtype=np.int64)
    for i, b in enumerate(battles):
        for key, val in paired_difference(
            b,
            default_skill,
            feature_catalog,
            enabled_families=enabled_families,
        ).items():
            col = feature_index.get(key)
            if col is not None:
                X[i, col] = val
        y[i] = 1 if b.winner == 1 else 0
    return X, y


def fit_model(
    X: np.ndarray,
    y: np.ndarray,
    c: float = L2_C,
    *,
    sample_weight: np.ndarray | None = None,
) -> tuple[np.ndarray, float]:
    """Fit a deterministic L2-regularized logistic regression.

    Returns ``(coef, intercept)``. There is no per-item scaling (features are
    already in ``{-1,0,1}``), so nothing about the held-out set can leak through
    a scaler. The paired design means the intercept captures any residual
    "team 1 (screenshot ordering) advantage".

    Degenerate corpora (single class, or no features) yield a zero model, which
    scores every roster equally (a safe neutral prior).
    """
    if X.shape[1] == 0 or len(np.unique(y)) < 2:
        return np.zeros(X.shape[1], dtype=np.float64), 0.0
    # L2 is scikit-learn's default penalty; we pass it implicitly to stay
    # forward-compatible (the explicit ``penalty="l2"`` kwarg is deprecated as of
    # sklearn 1.9). lbfgs + fixed seed keeps the fit deterministic.
    clf = LogisticRegression(
        C=c,
        solver="lbfgs",
        max_iter=2000,
        random_state=RANDOM_SEED,
    )
    clf.fit(X, y, sample_weight=sample_weight)
    return clf.coef_[0].astype(np.float64), float(clf.intercept_[0])


def _selection_prior_atomic_components(
    features: Iterable[str],
    coef: np.ndarray,
    battles: Iterable[Battle],
    catalog_seasons: _CatalogSeasons,
    *,
    default_skill: Mapping[str, str] | None = None,
    hero_strength: float = SELECTION_PRIOR_HERO_STRENGTH,
    skill_strength: float = SELECTION_PRIOR_SKILL_STRENGTH,
    smoothing: float = SELECTION_PRIOR_SMOOTHING,
    log_ratio_clip: float = SELECTION_PRIOR_LOG_RATIO_CLIP,
) -> dict[str, dict[str, float | int]]:
    """Return outcome/count/final components for every eligible atomic item.

    Battle-report frequency is a deliberate player-selection signal, not merely
    confidence. For each catalog hero and ordinary draftable tactic, observed
    team appearances are compared with season-aware uniform expected appearances::

        signal = clip(log((observed + smoothing) / (expected + smoothing)))
        final = fitted_outcome_weight + family_strength * signal

    Each battle contributes six hero slots and twelve non-signature tactic slots.
    A mirror therefore counts twice, correctly representing two player choices.
    Unknown-season rows still fit the outcome model but cannot affect this
    availability-dependent prior. Explicit shadow/non-draftable tactics become
    eligible only when observed in a non-default slot, so unused signatures are
    never synthesized as standalone tactic weights.
    """
    ordered_features = list(features)
    raw_coef = np.asarray(coef, dtype=np.float64)
    if len(raw_coef) < len(ordered_features):
        raise ValueError("coefficient vector is shorter than the feature list")
    if hero_strength < 0.0 or skill_strength < 0.0:
        raise ValueError("selection-prior strengths must be non-negative")
    if smoothing <= 0.0:
        raise ValueError("selection-prior smoothing must be positive")
    if log_ratio_clip <= 0.0:
        raise ValueError("selection-prior log-ratio clip must be positive")

    default = default_skill or {}
    training_battles = tuple(battles)
    known_season_battles = [
        battle for battle in training_battles if battle.season is not None
    ]
    raw_atomic_weights = {
        feature_id: float(raw_coef[index])
        for index, feature_id in enumerate(ordered_features)
        if feature_id.split("|", 1)[0] in (F_HERO, F_SKILL)
    }

    hero_appearances: Counter[str] = Counter()
    skill_appearances: Counter[str] = Counter()
    season_counts: Counter[int] = Counter()
    for battle in known_season_battles:
        assert battle.season is not None
        season_counts[battle.season] += 1
        for team in (battle.team1, battle.team2):
            hero_appearances.update(
                hero["name"] for hero in team if hero.get("name")
            )
            for hero in team:
                skill_appearances.update(_non_default_skills(hero, default))

    # Ordinary draftable tactics are always eligible. A signature/shadow tactic
    # becomes selection-prior eligible only after it is actually observed in a
    # non-default slot; this lets report count regularize transferred tactics
    # without synthesizing standalone weights for every unused signature.
    selection_skills = catalog_seasons.draftable_skills | frozenset(
        skill for skill in skill_appearances if skill in catalog_seasons.skills
    )
    eligible_by_family: Mapping[str, Mapping[str, int]] = {
        F_HERO: catalog_seasons.heroes,
        F_SKILL: {
            skill: catalog_seasons.skills[skill]
            for skill in selection_skills
        },
    }
    slots_by_family = {F_HERO: 6.0, F_SKILL: 12.0}
    strength_by_family = {
        F_HERO: float(hero_strength),
        F_SKILL: float(skill_strength),
    }
    appearances_by_family: Mapping[str, Mapping[str, int]] = {
        F_HERO: hero_appearances,
        F_SKILL: skill_appearances,
    }

    expected_by_family: dict[str, dict[str, float]] = {}
    for family, item_seasons in eligible_by_family.items():
        available_by_season = {
            season: sum(
                1 for intro_season in item_seasons.values()
                if intro_season <= season
            )
            for season in season_counts
        }
        expected_by_family[family] = {
            item_name: sum(
                battle_count
                * slots_by_family[family]
                / available_by_season[season]
                for season, battle_count in season_counts.items()
                if season >= intro_season and available_by_season[season] > 0
            )
            for item_name, intro_season in item_seasons.items()
        }

    candidate_features = set(raw_atomic_weights)
    candidate_features.update(
        f"{F_HERO}|{hero}" for hero in catalog_seasons.heroes
    )
    candidate_features.update(
        f"{F_SKILL}|{skill}" for skill in selection_skills
    )

    components: dict[str, dict[str, float | int]] = {}
    for feature_id in sorted(candidate_features):
        family, separator, item_name = feature_id.partition("|")
        if family not in (F_HERO, F_SKILL) or not separator or not item_name:
            continue
        outcome_weight = raw_atomic_weights.get(feature_id, 0.0)
        eligible_season = eligible_by_family[family].get(item_name)
        expected = expected_by_family[family].get(item_name, 0.0)
        observed = int(appearances_by_family[family].get(item_name, 0))
        count_adjustment = 0.0
        log_ratio = 0.0
        if eligible_season is not None and expected > 0.0:
            log_ratio = float(
                np.log((observed + smoothing) / (expected + smoothing))
            )
            log_ratio = max(-log_ratio_clip, min(log_ratio_clip, log_ratio))
            count_adjustment = strength_by_family[family] * log_ratio
        components[feature_id] = {
            "outcome_weight": outcome_weight,
            "count_adjustment": count_adjustment,
            "final_weight": outcome_weight + count_adjustment,
            "appearance_count": observed,
            "expected_count": expected,
            "usage_ratio": (observed / expected) if expected > 0.0 else 0.0,
        }
    return components


def selection_adjusted_atomic_weights(
    features: Iterable[str],
    coef: np.ndarray,
    battles: Iterable[Battle],
    catalog_seasons: _CatalogSeasons,
    *,
    default_skill: Mapping[str, str] | None = None,
    hero_strength: float = SELECTION_PRIOR_HERO_STRENGTH,
    skill_strength: float = SELECTION_PRIOR_SKILL_STRENGTH,
    smoothing: float = SELECTION_PRIOR_SMOOTHING,
    log_ratio_clip: float = SELECTION_PRIOR_LOG_RATIO_CLIP,
) -> dict[str, float]:
    """Return final outcome-plus-selection weights for atomic H/S items."""
    return {
        feature_id: float(component["final_weight"])
        for feature_id, component in _selection_prior_atomic_components(
            features,
            coef,
            battles,
            catalog_seasons,
            default_skill=default_skill,
            hero_strength=hero_strength,
            skill_strength=skill_strength,
            smoothing=smoothing,
            log_ratio_clip=log_ratio_clip,
        ).items()
    }


def apply_selection_prior(
    features: Iterable[str],
    coef: np.ndarray,
    battles: Iterable[Battle],
    catalog_seasons: _CatalogSeasons,
    *,
    default_skill: Mapping[str, str] | None = None,
    hero_strength: float = SELECTION_PRIOR_HERO_STRENGTH,
    skill_strength: float = SELECTION_PRIOR_SKILL_STRENGTH,
    smoothing: float = SELECTION_PRIOR_SMOOTHING,
    log_ratio_clip: float = SELECTION_PRIOR_LOG_RATIO_CLIP,
) -> np.ndarray:
    """Apply final atomic weights to fitted columns; interactions are unchanged."""
    ordered_features = list(features)
    adjusted = np.asarray(coef, dtype=np.float64).copy()
    atomic_weights = selection_adjusted_atomic_weights(
        ordered_features,
        adjusted,
        battles,
        catalog_seasons,
        default_skill=default_skill,
        hero_strength=hero_strength,
        skill_strength=skill_strength,
        smoothing=smoothing,
        log_ratio_clip=log_ratio_clip,
    )
    for index, feature_id in enumerate(ordered_features):
        if feature_id in atomic_weights:
            adjusted[index] = atomic_weights[feature_id]
    return adjusted


# --------------------------------------------------------------------------- #
# Backtest (season-independent grouped stable-hash holdout)
# --------------------------------------------------------------------------- #

def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


def backtest(
    battles: list[Battle],
    default_skill: Mapping[str, str],
    holdout_frac: float = 0.2,
    c: float = L2_C,
    *,
    catalog_seasons: _CatalogSeasons | None = None,
    feature_catalog: Mapping[str, Any] | None = None,
    enabled_families: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Grouped held-out backtest with train-only model construction.

    Capture/upload sessions are first joined with exact and one-skill-different
    matchup clusters. Whole resulting groups are assigned by a fixed salted
    hash; season and winner/outcome never affect group assignment.
    Feature selection, fitting, selection-count adjustment, and the constant
    baseline use training rows only.
    """
    n = len(battles)
    protocol = {
        "name": "grouped-stable-hash-holdout",
        "version": EVALUATION_PROTOCOL_VERSION,
        "evaluation_version": compute_evaluation_version(battles),
        "seed": GROUP_HOLDOUT_SEED,
        "requested_test_fraction": holdout_frac,
        "split_unit": "capture/upload session plus exact/near-duplicate cluster",
        "split_excludes": ["season", "winner", "outcome"],
        "external_initial_group": "stable report identity",
        "session_gap_seconds": SESSION_GAP_SECONDS,
        "calendar_day_grouping": False,
        "near_duplicate_max_skill_replacements": (
            NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS
        ),
        "source_categories": list(SOURCE_CATEGORIES),
        "baseline": "training-majority class",
    }
    if n < 20:
        return {
            "n_test": 0,
            "accuracy": None,
            "log_loss": None,
            "brier": None,
            "note": "insufficient battles for a backtest",
            "holdout_frac": holdout_frac,
            "protocol": protocol,
        }

    group_ids = assign_evaluation_groups(
        battles,
        session_gap_seconds=SESSION_GAP_SECONDS,
        cluster_matchups=True,
    )
    train, test, train_group_ids, test_group_ids = grouped_hash_split(
        battles,
        group_ids,
        holdout_frac,
        seed=GROUP_HOLDOUT_SEED,
    )

    if not train or not test:
        return {
            "n_train": len(train),
            "n_test": len(test),
            "accuracy": None,
            "log_loss": None,
            "brier": None,
            "note": "insufficient independent groups for a backtest",
            "holdout_frac": holdout_frac,
            "protocol": protocol,
        }

    support = compute_support(
        train, default_skill, feature_catalog, enabled_families=enabled_families
    )
    features = select_features(support, enabled_families=enabled_families)
    feature_index = {fid: i for i, fid in enumerate(features)}

    X_train, y_train = build_design_matrix(
        train, feature_index, default_skill, feature_catalog,
        enabled_families=enabled_families,
    )
    coef, intercept = fit_model(X_train, y_train, c=c)
    prior_only_weights: dict[str, float] = {}
    if catalog_seasons is not None:
        atomic_weights = selection_adjusted_atomic_weights(
            features,
            coef,
            train,
            catalog_seasons,
            default_skill=default_skill,
        )
        coef = coef.copy()
        for feature_id, column in feature_index.items():
            adjusted_weight = atomic_weights.get(feature_id)
            if adjusted_weight is not None:
                coef[column] = adjusted_weight
        prior_only_weights = {
            feature_id: weight
            for feature_id, weight in atomic_weights.items()
            if feature_id not in feature_index
            and abs(weight) >= WEIGHT_EPSILON
        }

    X_test, y_test = build_design_matrix(
        test, feature_index, default_skill, feature_catalog,
        enabled_families=enabled_families,
    )
    logits = X_test @ coef + intercept
    if prior_only_weights:
        prior_features = sorted(prior_only_weights)
        prior_index = {
            feature_id: index
            for index, feature_id in enumerate(prior_features)
        }
        X_test_prior, _ = build_design_matrix(
            test,
            prior_index,
            default_skill,
            feature_catalog,
            enabled_families=enabled_families,
        )
        prior_coef = np.asarray(
            [prior_only_weights[feature_id] for feature_id in prior_features],
            dtype=np.float64,
        )
        logits = logits + X_test_prior @ prior_coef
    probs = _sigmoid(logits)

    report = prediction_report(
        y_test,
        probs,
        test_group_ids,
        [battle.source for battle in test],
    )
    train_majority = 1 if float(np.mean(y_train)) >= 0.5 else 0
    baseline_accuracy = float(np.mean(y_test == train_majority))

    def balance(rows: list[Battle], row_groups: list[str]) -> dict[str, Any]:
        by_source = {
            source: {
                "n_battles": sum(1 for battle in rows if battle.source == source),
                "n_groups": len({
                    group_id
                    for battle, group_id in zip(rows, row_groups)
                    if battle.source == source
                }),
                "team1_wins": sum(
                    1
                    for battle in rows
                    if battle.source == source and battle.winner == 1
                ),
                "team2_wins": sum(
                    1
                    for battle in rows
                    if battle.source == source and battle.winner == 2
                ),
            }
            for source in SOURCE_CATEGORIES
        }
        return {
            "n_battles": len(rows),
            "n_groups": len(set(row_groups)),
            "team1_wins": sum(battle.winner == 1 for battle in rows),
            "team2_wins": sum(battle.winner == 2 for battle in rows),
            "by_source": by_source,
        }

    return {
        "n_train": len(train),
        "n_train_groups": len(set(train_group_ids)),
        "n_test": len(test),
        "n_test_groups": report["n_groups"],
        "accuracy": report["accuracy"],
        "log_loss": report["log_loss"],
        "brier": report["brier"],
        "holdout_frac": round(len(test) / n, 4),
        "baseline_accuracy": round(baseline_accuracy, 4),
        "confidence_interval_status": report["confidence_interval_status"],
        "confidence_intervals_95": report["confidence_intervals_95"],
        "source_breakdown": report["by_source"],
        "split_balance": {
            "train": balance(train, train_group_ids),
            "test": balance(test, test_group_ids),
        },
        "protocol": protocol,
    }


# --------------------------------------------------------------------------- #
# Smoothed analytics (for the Analytics page — descriptive, not the model)
# --------------------------------------------------------------------------- #

def _smoothed_rate(wins: int, total: int, prior: float, strength: float = 5.0) -> float:
    """Additive (Beta) smoothing toward ``prior`` with pseudo-count ``strength``."""
    if total <= 0:
        return prior
    return (wins + prior * strength) / (total + strength)


def compute_analytics(
    battles: list[Battle], default_skill: Mapping[str, str]
) -> dict[str, Any]:
    """Descriptive per-hero / per-skill win-rate + usage stats, smoothed.

    These power the Analytics page's rankings/usage tables. They are separate
    from the paired model (which is what recommendations use) and are smoothed
    toward the global base rate so tiny-sample items do not top the charts.
    """
    hero_wins: dict[str, int] = defaultdict(int)
    hero_total: dict[str, int] = defaultdict(int)
    skill_wins: dict[str, int] = defaultdict(int)
    skill_total: dict[str, int] = defaultdict(int)
    skill_shadow_total: dict[str, int] = defaultdict(int)

    global_wins = 0
    global_total = 0

    for b in battles:
        for team_key, team in ((1, b.team1), (2, b.team2)):
            won = 1 if b.winner == team_key else 0
            for hero_data in team:
                hero = hero_data.get("name", "")
                if not hero:
                    continue
                hero_total[hero] += 1
                hero_wins[hero] += won
                global_total += 1
                global_wins += won
                shadow_skills = set(hero_data.get("shadow_skills", []))
                for skill in _non_default_skills(hero_data, default_skill):
                    skill_total[skill] += 1
                    skill_wins[skill] += won
                    if skill in shadow_skills:
                        skill_shadow_total[skill] += 1

    prior = (global_wins / global_total) if global_total else 0.5

    def rows(
        wins: dict[str, int],
        total: dict[str, int],
        shadow_total: Mapping[str, int] | None = None,
    ) -> list[dict[str, Any]]:
        out = []
        for name, tot in total.items():
            w = wins[name]
            row = {
                "name": name,
                "wins": w,
                "losses": tot - w,
                "total": tot,
                "win_rate": round(w / tot, 4) if tot else 0.0,
                "smoothed_win_rate": round(_smoothed_rate(w, tot, prior), 4),
            }
            if shadow_total is not None:
                row["shadow_total"] = shadow_total.get(name, 0)
            out.append(row)
        # Deterministic: smoothed rate desc, then total desc, then name.
        out.sort(key=lambda r: (-r["smoothed_win_rate"], -r["total"], r["name"]))
        return out

    return {
        "prior_win_rate": round(prior, 4),
        "heroes": rows(hero_wins, hero_total),
        "skills": rows(skill_wins, skill_total, skill_shadow_total),
    }


# --------------------------------------------------------------------------- #
# Catalog (from database.json) + artifact assembly
# --------------------------------------------------------------------------- #

def _validated_catalog_season(value: Any, description: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise InvalidBattleError(
            f"{description} season must be a positive integer"
        )
    return value


_BOND_CONDITION = re.compile(r"缘分关系([23])人在同一部队时激活效果")


def _normalized_bond_content(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def _validated_bonds(raw_bonds: Any, known_heroes: frozenset[str]) -> list[dict[str, Any]]:
    if not isinstance(raw_bonds, Mapping):
        raise InvalidBattleError("database bonds must be an object")
    result: list[dict[str, Any]] = []
    contracts: set[tuple[str, int, tuple[str, ...]]] = set()
    for name in sorted(raw_bonds):
        raw = raw_bonds[name]
        if not isinstance(name, str) or not name or not isinstance(raw, Mapping):
            raise InvalidBattleError("database contains an invalid bond entry")
        condition = raw.get("condition")
        match = _BOND_CONDITION.fullmatch(condition) if isinstance(condition, str) else None
        if match is None:
            raise InvalidBattleError(f"bond {name!r} has a missing or invalid activation condition")
        required = int(match.group(1))
        content = raw.get("content")
        members = raw.get("members")
        if not isinstance(content, str) or not content.strip():
            raise InvalidBattleError(f"bond {name!r} has invalid content")
        if (
            not isinstance(members, list)
            or len(members) < required
            or len(members) != len(set(members))
            or any(not isinstance(member, str) or not member for member in members)
            or sum(member in known_heroes for member in members) < required
        ):
            raise InvalidBattleError(f"bond {name!r} has invalid or unavailable members")
        sorted_members = tuple(sorted(members))
        contract = (_normalized_bond_content(content), required, sorted_members)
        if contract in contracts:
            raise InvalidBattleError(f"bond {name!r} duplicates a normalized bond contract")
        contracts.add(contract)
        result.append({"name": name, "required_members": required, "members": list(sorted_members)})
    return result


def _load_catalog_context(
    database_path: str,
    mechanics_registry_path: str | None = None,
) -> _CatalogContext:
    """Load catalog metadata, including fail-closed reviewed team context."""
    db = _load_json_object(database_path, "database catalog")
    heroes = db.get("heroes")
    skills = db.get("skills")
    if not isinstance(heroes, dict) or not isinstance(skills, dict):
        raise InvalidBattleError(
            "database catalog heroes and skills must both be objects"
        )

    hero_seasons: dict[str, int] = {}
    for name, hero in heroes.items():
        if not isinstance(name, str) or not name or not isinstance(hero, dict):
            raise InvalidBattleError(
                "database catalog contains an invalid hero entry"
            )
        default = hero.get("skill")
        if not isinstance(default, str) or not default:
            raise InvalidBattleError(
                f"database hero {name!r} has no valid default skill"
            )
        if default not in skills:
            raise InvalidBattleError(
                f"database hero {name!r} has uncatalogued default skill {default!r}"
            )
        hero_seasons[name] = _validated_catalog_season(
            hero.get("season"),
            f"database hero {name!r}",
        )

    skill_seasons: dict[str, int] = {}
    for name, skill in skills.items():
        if not isinstance(name, str) or not name or not isinstance(skill, dict):
            raise InvalidBattleError(
                "database catalog contains an invalid skill entry"
            )
        skill_seasons[name] = _validated_catalog_season(
            skill.get("season"),
            f"database skill {name!r}",
        )
        if "shadow" in skill and not isinstance(skill["shadow"], bool):
            raise InvalidBattleError(
                f"database skill {name!r} has a non-boolean shadow marker"
            )

    default_skill = {
        name: hero["skill"]
        for name, hero in heroes.items()
    }
    signature_skills = frozenset(default_skill.values())
    draftable_skills = frozenset(
        name
        for name, skill in skills.items()
        if name not in signature_skills and skill.get("shadow") is not True
    )
    # Version every field that changes draft availability. Missing optional
    # metadata is normalized to JSON null, while a missing shadow marker is the
    # explicit semantic default false. Rows and JSON object keys are sorted so
    # recommendation and telemetry builders can reproduce this hash exactly.
    version_payload = {
        "heroes": [
            {
                "name": name,
                "default_skill": heroes[name].get("skill"),
                "season": hero_seasons[name],
            }
            for name in sorted(heroes)
        ],
        "skills": [
            {
                "name": name,
                "color": skills[name].get("color"),
                "season": skill_seasons[name],
                "shadow": skills[name].get("shadow", False),
            }
            for name in sorted(skills)
        ],
    }
    payload = json.dumps(
        version_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    catalog_version = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
    metadata = {
        "catalog_version": catalog_version,
        "hero_count": len(heroes),
        "skill_count": len(skills),
        "default_skill": default_skill,
    }
    if mechanics_registry_path is not None:
        bonds = _validated_bonds(db.get("bonds"), frozenset(heroes))
        try:
            registry = load_validated_registry(db, mechanics_registry_path)
        except MechanicsRegistryError as exc:
            raise InvalidBattleError(f"reviewed mechanics registry is invalid: {exc}") from exc
        metadata.update({
            "mechanics_version": registry["mechanics_version"],
            "hero_camp": {
                name: heroes[name]["camp"]
                for name in sorted(heroes)
                if isinstance(heroes[name].get("camp"), str) and heroes[name]["camp"]
            },
            "bonds": bonds,
            "skill_mechanics": {
                name: {
                    "provides": registry["skills"][name]["provides"],
                    "benefitsFrom": registry["skills"][name]["benefitsFrom"],
                }
                for name in sorted(registry["skills"])
                if registry["skills"][name]["provides"]
                or registry["skills"][name]["benefitsFrom"]
            },
        })
    names = CatalogNames(
        heroes=frozenset(heroes),
        # Membership deliberately does not filter on color, season, or shadow.
        # A transferred skill marked shadow=true is still a legitimate observed
        # report value even though it is not a normal draft-pool choice.
        skills=frozenset(skills),
    )
    seasons = _CatalogSeasons(
        heroes=MappingProxyType(hero_seasons),
        skills=MappingProxyType(skill_seasons),
        draftable_skills=draftable_skills,
    )
    return _CatalogContext(metadata=metadata, names=names, seasons=seasons)


def _catalog_components(
    database_path: str,
) -> tuple[dict[str, Any], CatalogNames]:
    """Compatibility wrapper returning the historical two public components."""
    context = _load_catalog_context(database_path)
    return context.metadata, context.names


def load_catalog(database_path: str) -> dict[str, Any]:
    """Extract validated catalog metadata from database.json.

    The client needs the hero→default-skill map to reproduce the exact
    non-default-skill feature extraction used at train time. ``catalog_version``
    hashes availability-relevant hero/skill metadata so the client can detect a
    mismatched database at runtime.
    """
    metadata, _ = _catalog_components(database_path)
    return metadata


def compute_corpus_version(battles: list[Battle]) -> str:
    """Deterministic content hash of the validated battles used for training.

    Depends only on model inputs (teams + winner + season, in deterministic
    ``order_key`` order), never on wall-clock time or prior output. A trusted
    known season remains a production input because it affects catalog checks
    and selection-count expectation; unknown-season rows are represented only
    as null and are excluded from that season-dependent adjustment.
    """
    payload = json.dumps(
        [
            {
                "order_key": b.order_key,
                "winner": b.winner,
                "season": b.season,
                "team1": b.team1,
                "team2": b.team2,
            }
            for b in sorted(battles, key=lambda b: (b.order_key, b.filename))
        ],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def compute_evaluation_version(battles: list[Battle]) -> str:
    """Hash model content plus evaluation-only grouping metadata.

    ``corpus_version`` is the runtime scoring-model label and includes trusted
    known season metadata. Source, capture time, and uploader identity affect
    only evaluation grouping, so this protocol carries their separate content
    address. Season itself never affects evaluation-group or split membership.
    """
    payload = json.dumps(
        {
            "corpus_version": compute_corpus_version(battles),
            "protocol_version": EVALUATION_PROTOCOL_VERSION,
            "observations": [
                {
                    "filename": battle.filename,
                    "evaluation_identity": battle.evaluation_identity,
                    "season": battle.season,
                    "source": battle.source,
                    "captured_at": battle.captured_at,
                    # The exact contributor value affects session grouping but
                    # is never emitted; it exists only inside this aggregate
                    # hash preimage.
                    "uploader_identity": battle.uploader_identity,
                }
                for battle in sorted(
                    battles,
                    key=lambda item: (item.order_key, item.filename),
                )
            ],
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def build_artifact(
    battles: list[Battle],
    errors: list[str],
    catalog: dict[str, Any],
    *,
    catalog_seasons: _CatalogSeasons | None = None,
) -> dict[str, Any]:
    """Assemble the full ``recommendation_data.json`` artifact.

    The model here is fit on *all* valid battles (the backtest is computed
    separately on a grouped, season-independent stable-hash holdout).

    The result is a pure function of ``battles`` + ``catalog`` (``errors`` is
    only used for the invalid-count) — no wall-clock, no prior-output dependence
    — so re-running on the same inputs is byte-identical.
    """
    default_skill: Mapping[str, str] = catalog.get("default_skill", {})
    support_all = compute_support(
        battles,
        default_skill,
        catalog,
        enabled_families=PRODUCTION_ENABLED_FAMILIES,
    )
    features = select_features(
        support_all,
        enabled_families=PRODUCTION_ENABLED_FAMILIES,
    )
    feature_index = {fid: i for i, fid in enumerate(features)}

    X, y = build_design_matrix(
        battles,
        feature_index,
        default_skill,
        catalog,
        enabled_families=PRODUCTION_ENABLED_FAMILIES,
    )
    raw_coef, intercept = fit_model(X, y)
    atomic_weights: dict[str, float] = {}
    atomic_components_raw: dict[str, dict[str, float | int]] = {}
    if catalog_seasons is not None:
        atomic_components_raw = _selection_prior_atomic_components(
            features,
            raw_coef,
            battles,
            catalog_seasons,
            default_skill=default_skill,
        )
        atomic_weights = {
            feature_id: float(component["final_weight"])
            for feature_id, component in atomic_components_raw.items()
        }
        coef = raw_coef.copy()
        for feature_id, column in feature_index.items():
            adjusted_weight = atomic_weights.get(feature_id)
            if adjusted_weight is not None:
                coef[column] = adjusted_weight
    else:
        coef = raw_coef

    # Emit weights + literal battle evidence keyed by feature id.
    weights: dict[str, float] = {}
    support_out: dict[str, int] = {}
    for fid, col in feature_index.items():
        w = float(coef[col])
        # Interactions with a numerically neutral fitted coefficient remain
        # absent. Atomic H/S features may still be non-neutral because player
        # selection count is an independent post-fit signal.
        if abs(w) < WEIGHT_EPSILON:
            continue
        weights[fid] = round(w, 6)
        support_out[fid] = support_all[fid]

    # Merge count-prior-only catalog atomics after fitting. Missing support is
    # literal zero; the client already interprets an absent support key as 0.
    for feature_id, weight in sorted(atomic_weights.items()):
        if feature_id in feature_index or abs(weight) < WEIGHT_EPSILON:
            continue
        weights[feature_id] = round(weight, 6)
        observed_support = support_all.get(feature_id, 0)
        if observed_support > 0:
            support_out[feature_id] = observed_support

    atomic_components = {
        feature_id: {
            "outcome_weight": round(float(component["outcome_weight"]), 6),
            "count_adjustment": round(float(component["count_adjustment"]), 6),
            "final_weight": weights[feature_id],
            "appearance_count": int(component["appearance_count"]),
            "expected_count": round(float(component["expected_count"]), 6),
            "usage_ratio": round(float(component["usage_ratio"]), 6),
        }
        for feature_id, component in sorted(atomic_components_raw.items())
        if feature_id in weights
    }

    team1_wins = sum(1 for b in battles if b.winner == 1)
    team2_wins = len(battles) - team1_wins

    bt = backtest(
        battles,
        default_skill,
        catalog_seasons=catalog_seasons,
        feature_catalog=catalog,
        enabled_families=PRODUCTION_ENABLED_FAMILIES,
    )
    analytics = compute_analytics(battles, default_skill)

    return {
        "schema": {
            "version": SCHEMA_VERSION,
            "model_type": MODEL_TYPE,
            "feature_families": {
                F_HERO: "hero present",
                F_SKILL: "non-default skill present",
                F_HERO_PAIR: "unordered hero pair",
                F_HERO_SKILL: "hero-assigned non-default skill",
                F_SKILL_PAIR: "within-hero non-default skill pair",
                F_TEAM_HERO_SKILL: "hero and non-default tactic coexist on concrete team",
                F_TEAM_SKILL_PAIR: "non-default tactics coexist on concrete team",
                F_HERO_TRIO: "exact concrete three-hero team",
                F_CAMP: "exclusive same-camp composition",
                F_BOND: "validated activated bond",
                F_MECH: "external named-status provider/beneficiary match",
                F_HERO_MECH: "beneficiary hero plus external named-status provider",
                F_TEAM_SKILL_TRIPLE: "experimental exact tactic triple",
            },
            "production_enabled_families": sorted(PRODUCTION_ENABLED_FAMILIES),
            "default_skill_index": DEFAULT_SKILL_INDEX,
        },
        "catalog": catalog,
        "battle_counts": {
            "total_battles": len(battles),
            "team1_wins": team1_wins,
            "team2_wins": team2_wins,
            "invalid_battles": len(errors),
            # Deterministic content hash of the training corpus (no timestamp,
            # no prior-output delta) so the artifact is byte-reproducible.
            "corpus_version": compute_corpus_version(battles),
        },
        "model": {
            "intercept": round(intercept, 6),
            "l2_C": L2_C,
            "min_support_single": MIN_SUPPORT_SINGLE,
            "min_support_pair": MIN_SUPPORT_PAIR,
            "min_support_context": MIN_SUPPORT_CONTEXT,
            "min_support_high_order": MIN_SUPPORT_HIGH_ORDER,
            "enabled_families": sorted(PRODUCTION_ENABLED_FAMILIES),
            "n_features": len(weights),
            "weights": weights,
            "support": support_out,
            "selection_prior": {
                "hero_strength": SELECTION_PRIOR_HERO_STRENGTH,
                "skill_strength": SELECTION_PRIOR_SKILL_STRENGTH,
                "smoothing": SELECTION_PRIOR_SMOOTHING,
                "log_ratio_clip": SELECTION_PRIOR_LOG_RATIO_CLIP,
                "hero_slots_per_battle": 6,
                "skill_slots_per_battle": 12,
                "count_unit": "known-season team appearances",
                "expected_count": "season-aware uniform share of draftable or observed transferred catalog items",
            },
            "atomic_components": atomic_components,
        },
        "analytics": analytics,
        "backtest": bt,
    }


def build(
    battles_dir: str = "data/battles",
    database_path: str = "web/public/game-data/database.json",
    output_path: str = "web/src/recommendation_data.json",
    *,
    web_upload_dir: str | None = None,
    web_upload_state_path: str | None = None,
    yanwu_corpus_path: str | None = None,
    yanwu_manifest_path: str = "data/external/yanwu-release.json",
    mechanics_registry_path: str | None = None,
) -> dict[str, Any]:
    """End-to-end build; writes ``output_path`` and returns the artifact.

    Fail-closed: if *any* battle file is invalid or unreadable, this aborts
    (raising ``SystemExit``) *before* writing, so a corrupt capture can never
    silently skew the model or partially overwrite the artifact.
    """
    try:
        catalog_context = _load_catalog_context(
            database_path,
            mechanics_registry_path,
        )
    except InvalidBattleError as exc:
        raise SystemExit(
            f"Aborting before write: invalid database catalog: {exc}"
        ) from exc
    catalog = catalog_context.metadata

    manual_battles, errors = load_battles(
        battles_dir,
        catalog_names=catalog_context.names,
        catalog_seasons=catalog_context.seasons,
    )
    web_battles: list[Battle] = []
    if web_upload_dir is not None:
        loaded_web_battles, web_errors = load_battles(
            web_upload_dir,
            filename_prefix="web-upload/",
            catalog_names=catalog_context.names,
            catalog_seasons=catalog_context.seasons,
            source=SOURCE_UPLOADED_BY_OTHERS,
        )
        web_battles.extend(loaded_web_battles)
        errors.extend(web_errors)
    yanwu_battles: list[Battle] = []
    if yanwu_corpus_path is not None:
        loaded_yanwu_battles, yanwu_errors = load_yanwu_battles(
            yanwu_corpus_path,
            yanwu_manifest_path,
            catalog_version=catalog["catalog_version"],
            catalog_names=catalog_context.names,
            catalog_seasons=catalog_context.seasons,
        )
        yanwu_battles.extend(loaded_yanwu_battles)
        errors.extend(yanwu_errors)
    if errors:
        print(f"✗ {len(errors)} invalid/unreadable battle file(s):", file=sys.stderr)
        for err in errors[:20]:
            print(f"   - {err}", file=sys.stderr)
        if len(errors) > 20:
            print(f"   ... and {len(errors) - 20} more", file=sys.stderr)
        raise SystemExit(
            "Aborting before write: fix or remove the invalid battle file(s) above."
        )
    try:
        validate_training_duplicate_policy(
            manual_battles,
            web_battles,
            web_upload_state_path,
        )
    except InvalidBattleError as exc:
        raise SystemExit(
            f"Aborting before write: duplicate-policy validation failed: {exc}"
        ) from exc

    battles = sorted(
        [*manual_battles, *web_battles, *yanwu_battles],
        key=lambda battle: (battle.order_key, battle.filename),
    )
    if not battles:
        raise SystemExit("No valid battles found — nothing to build.")

    artifact = build_artifact(
        battles,
        errors,
        catalog,
        catalog_seasons=catalog_context.seasons,
    )

    # Serialize to a temp file in the same directory, then atomically replace the
    # existing artifact. This keeps the good artifact intact if serialization
    # fails partway (IO error / process kill), and ``allow_nan=False`` fails loud
    # on any NaN/inf weight instead of emitting JSON the web app's JSON.parse
    # would reject — so a corrupt build can never overwrite a valid artifact.
    output_dir = os.path.dirname(os.path.abspath(output_path))
    fd, tmp_path = tempfile.mkstemp(
        dir=output_dir, prefix=".recommendation_data.", suffix=".json.tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(
                artifact,
                fh,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
                allow_nan=False,
            )
            fh.write("\n")
        os.replace(tmp_path, output_path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    bt = artifact["backtest"]
    print(
        f"✓ Wrote {output_path}: {artifact['battle_counts']['total_battles']} battles, "
        f"{artifact['model']['n_features']} model features."
    )
    if bt.get("accuracy") is not None:
        print(
            f"  Backtest (n={bt['n_test']}): acc={bt['accuracy']} "
            f"(baseline {bt['baseline_accuracy']}), logloss={bt['log_loss']}, "
            f"brier={bt['brier']}"
        )
    return artifact


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="web/src/recommendation_data.json")
    parser.add_argument("--battles-dir", default="data/battles")
    parser.add_argument("--web-upload-dir", default="data/web-upload")
    parser.add_argument(
        "--web-upload-state",
        default="data/web_upload_state.json",
    )
    parser.add_argument("--database", default="web/public/game-data/database.json")
    parser.add_argument("--mechanics-registry", default="data/skill_mechanics.json")
    parser.add_argument(
        "--yanwu-manifest",
        type=Path,
        default=root / "data/external/yanwu-release.json",
    )
    parser.add_argument(
        "--yanwu-cache-dir",
        type=Path,
        default=root / ".cache/yanwu",
    )
    parser.add_argument("--yanwu-corpus", type=Path)
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(args.yanwu_manifest)
    except InvalidYanwuCorpus as exc:
        raise SystemExit(f"Aborting before write: invalid Yanwu manifest: {exc}") from exc
    yanwu_corpus = args.yanwu_corpus or normalized_cache_path(
        manifest,
        args.yanwu_cache_dir,
    )
    build(
        battles_dir=args.battles_dir,
        database_path=args.database,
        output_path=args.output,
        web_upload_dir=args.web_upload_dir,
        web_upload_state_path=args.web_upload_state,
        yanwu_corpus_path=str(yanwu_corpus),
        yanwu_manifest_path=str(args.yanwu_manifest),
        mechanics_registry_path=args.mechanics_registry,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
