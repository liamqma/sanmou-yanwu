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
  assigned hero-skill, supported within-hero skill-pair, reusable current-catalog
  mechanics, and probability-scaled named-status provider/consumer context.
  Sparse interactions are filtered by a support threshold and shrunk by L2. Atomic
  heroes and standalone skills below the fitting floor receive a bounded,
  season-aware negative popularity prior from a zero fitted baseline. Battles
  with unknown season train the logistic fit but are excluded from this prior's
  observed-support and availability-exposure counts.
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
from pathlib import Path
from types import MappingProxyType
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
    from skill_mechanics import extract_skill_mechanics
    from recommendation_promotion import (
        load_baseline_contract,
        load_json_object,
        select_production_bytes,
    )
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
    from .skill_mechanics import extract_skill_mechanics
    from .recommendation_promotion import (
        load_baseline_contract,
        load_json_object,
        select_production_bytes,
    )

# --------------------------------------------------------------------------- #
# Constants / schema metadata
# --------------------------------------------------------------------------- #

SCHEMA_VERSION = 5
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
F_MECHANIC = "M"       # reusable skill mechanic, with a numeric team value
F_PROVIDER = "MP"      # team provides a named buff/debuff
F_CONSUMER = "MC"      # team contains a skill that consumes that status
F_MECHANIC_INTERACTION = "MX"  # external provider + consumer for a status
F_HERO_MECHANIC_INTERACTION = "HMX"  # beneficiary hero + external provider
F_HERO_META = "HM"      # normalized hero stats, camp, and troop composition
F_CAMP = "HC"           # deterministic same-camp attribute bonus
F_HERO_SCALING_MATCH = "HSM"  # owner stat matched to skill scaling
F_TROOP_MATCH = "HTM"   # team troop members matched by a skill condition
F_BOND = "B"             # activated named hero bond
F_BOND_MECHANIC = "BM"  # reusable mechanics supplied by active bonds

# Support thresholds: interactions seen in fewer battles than this are dropped
# (their signal is too sparse to fit; the constituent single-item features still
# carry them). Single-item features use a lower floor.
MIN_SUPPORT_SINGLE = 5
MIN_SUPPORT_PAIR = 8

# L2 inverse-regularization strength for LogisticRegression (smaller = stronger
# shrinkage toward the neutral prior of 0). Chosen to keep sparse interaction
# weights modest; validated by the held-out backtest.
# The semantic families are deliberately correlated with skill identities;
# stronger shrinkage keeps those shared dimensions from overfitting the small
# corpus. The grouped evaluation harness selected this value after adding them.
L2_C = 0.05

RANDOM_SEED = 0

# Popularity is a weak, one-sided post-fit prior for single heroes and skills,
# including catalog atomics that did not clear the fitting floor. ``q`` is the
# family-specific exposure share below which an item is considered under-used.
# ``tau`` gives recently introduced items a smooth evidence grace period, and
# ``gamma`` bounds the largest subtraction to one quarter of the fitted scale
# for that family.
POPULARITY_TARGET_SHARE_HERO = 0.025
POPULARITY_TARGET_SHARE_SKILL = 0.020
POPULARITY_EXPOSURE_TAU = 600.0
POPULARITY_PENALTY_GAMMA = 0.25

# Raw coefficients below this magnitude are not emitted. The popularity
# transform uses the same threshold so it can never create a new artifact key.
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
    """Validated catalog state used by training and runtime artifact assembly."""

    metadata: dict[str, Any]
    names: CatalogNames
    seasons: _CatalogSeasons
    mechanics: dict[str, Any]


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
        # usable for logistic fitting but do not enter season-aware popularity
        # observed-support or availability-exposure counts.
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


def _probability_union(probabilities: Iterable[float]) -> float:
    unavailable = 1.0
    for probability in probabilities:
        unavailable *= 1.0 - min(1.0, max(0.0, probability))
    return round(1.0 - unavailable, 6)


def _status_scopes(
    row: Mapping[str, Any],
    field: str,
    status: str,
) -> frozenset[str]:
    scope_map = row.get(field, {})
    if not isinstance(scope_map, Mapping):
        return frozenset(("unknown",))
    scopes = scope_map.get(status, ["unknown"])
    if not isinstance(scopes, list):
        return frozenset(("unknown",))
    validated = frozenset(scope for scope in scopes if isinstance(scope, str))
    return validated or frozenset(("unknown",))


def _status_scopes_compatible(
    provider_hero: str,
    provider_scopes: frozenset[str],
    consumer_hero: str,
    consumer_scopes: frozenset[str],
) -> bool:
    if "unknown" in provider_scopes or "unknown" in consumer_scopes:
        return True
    for provider_scope in provider_scopes:
        for consumer_scope in consumer_scopes:
            if provider_scope == "enemy" and consumer_scope == "enemy":
                return True
            if provider_scope == "self" and consumer_scope == "self":
                return provider_hero == consumer_hero
            if provider_scope == "ally" and consumer_scope == "self":
                return provider_hero != consumer_hero
            if provider_scope == "team" and consumer_scope == "self":
                return True
            if provider_scope in {"ally", "team"} and consumer_scope in {
                "ally",
                "team",
            }:
                return True
    return False


def _add_mechanic_features(
    feats: dict[str, float],
    team: list[dict[str, Any]],
    default_skill: Mapping[str, str],
    mechanics: Mapping[str, Any],
) -> None:
    skills = mechanics.get("skills")
    heroes = mechanics.get("heroes")
    bonds = mechanics.get("bonds")
    if not isinstance(skills, Mapping) or not isinstance(heroes, Mapping):
        return

    providers: dict[
        str,
        list[
            tuple[
                str,
                str,
                float,
                frozenset[str],
                frozenset[str] | None,
            ]
        ],
    ] = defaultdict(list)
    consumers: dict[
        str,
        list[tuple[str, str, float, frozenset[str]]],
    ] = defaultdict(list)
    team_names = [row.get("name", "") for row in team if row.get("name")]
    team_name_set = set(team_names)
    camps: Counter[str] = Counter()
    troops: Counter[str] = Counter()

    for hero in team_names:
        row = heroes.get(hero)
        if not isinstance(row, Mapping):
            continue
        camp = row.get("camp")
        troop = row.get("troop")
        if isinstance(camp, str):
            camps[camp] += 1
            feats[f"{F_HERO_META}|CAMP|{camp}"] = feats.get(
                f"{F_HERO_META}|CAMP|{camp}", 0.0
            ) + 1.0
        if isinstance(troop, str):
            troops[troop] += 1
            feats[f"{F_HERO_META}|TROOP|{troop}"] = feats.get(
                f"{F_HERO_META}|TROOP|{troop}", 0.0
            ) + 1.0
        normalized_stats = row.get("normalized_stats", {})
        if isinstance(normalized_stats, Mapping):
            for attribute, value in normalized_stats.items():
                if isinstance(attribute, str) and isinstance(value, (int, float)):
                    fid = f"{F_HERO_META}|STAT|{attribute}"
                    feats[fid] = round(feats.get(fid, 0.0) + float(value), 6)

    same_camp_count = max(camps.values(), default=0)
    if same_camp_count >= 3:
        feats[f"{F_CAMP}|SAME|3"] = 0.10
    elif same_camp_count == 2:
        feats[f"{F_CAMP}|SAME|2"] = 0.05

    for hero_data in team:
        hero = hero_data.get("name", "")
        if not hero:
            continue
        hero_row = heroes.get(hero, {})
        normalized_stats = (
            hero_row.get("normalized_stats", {})
            if isinstance(hero_row, Mapping)
            else {}
        )
        active_skills = [
            default_skill.get(hero, ""),
            *_non_default_skills(hero_data, default_skill),
        ]
        for skill in dict.fromkeys(skill for skill in active_skills if skill):
            row = skills.get(skill)
            if not isinstance(row, Mapping):
                continue
            probability = float(row.get("probability", 0.0))
            generic = row.get("features", {})
            if isinstance(generic, Mapping):
                for feature, value in generic.items():
                    if (
                        isinstance(feature, str)
                        and isinstance(value, (int, float))
                        and not isinstance(value, bool)
                    ):
                        fid = f"{F_MECHANIC}|{feature}"
                        feats[fid] = round(
                            feats.get(fid, 0.0) + float(value), 6
                        )
                        if feature.startswith("SCALES_WITH|"):
                            attribute = feature.split("|", 1)[1]
                            stat = normalized_stats.get(attribute)
                            if isinstance(stat, (int, float)):
                                match_id = f"{F_HERO_SCALING_MATCH}|{attribute}"
                                feats[match_id] = round(
                                    feats.get(match_id, 0.0)
                                    + probability * float(stat),
                                    6,
                                )
                        if feature.startswith("TROOP_TARGET|"):
                            troop = feature.split("|", 1)[1]
                            matching = troops.get(troop, 0)
                            if matching:
                                match_id = f"{F_TROOP_MATCH}|{troop}"
                                feats[match_id] = round(
                                    feats.get(match_id, 0.0)
                                    + probability * matching / 3.0,
                                    6,
                                )
            for status in row.get("provides", []):
                if isinstance(status, str):
                    providers[status].append(
                        (
                            hero,
                            skill,
                            probability,
                            _status_scopes(row, "provides_scopes", status),
                            None,
                        )
                    )
            for status in row.get("consumes", []):
                if isinstance(status, str):
                    consumers[status].append(
                        (
                            hero,
                            skill,
                            probability,
                            _status_scopes(row, "consumes_scopes", status),
                        )
                    )

    if isinstance(bonds, Mapping):
        for bond_name, row in bonds.items():
            if not isinstance(row, Mapping):
                continue
            members = row.get("members", [])
            required = row.get("required_members")
            if not isinstance(members, list) or not isinstance(required, int):
                continue
            active_members = [member for member in members if member in team_name_set]
            if len(active_members) < required:
                continue
            feats[f"{F_BOND}|{bond_name}"] = 1.0
            member_share = len(active_members) / 3.0
            feats[f"{F_BOND_MECHANIC}|ACTIVE_MEMBER_SHARE"] = round(
                feats.get(f"{F_BOND_MECHANIC}|ACTIVE_MEMBER_SHARE", 0.0)
                + member_share,
                6,
            )
            generic = row.get("features", {})
            if isinstance(generic, Mapping):
                for feature, value in generic.items():
                    if (
                        isinstance(feature, str)
                        and isinstance(value, (int, float))
                        and not isinstance(value, bool)
                    ):
                        fid = f"{F_BOND_MECHANIC}|{feature}"
                        feats[fid] = round(
                            feats.get(fid, 0.0)
                            + float(value) * member_share,
                            6,
                        )
            probability = float(row.get("probability", 1.0))
            source = f"bond:{bond_name}"
            eligible_recipients = (
                frozenset(active_members)
                if row.get("recipient_scope") == "active_members"
                else None
            )
            for member in active_members:
                for status in row.get("provides", []):
                    if isinstance(status, str):
                        providers[status].append(
                            (
                                member,
                                source,
                                probability,
                                _status_scopes(row, "provides_scopes", status),
                                eligible_recipients,
                            )
                        )
                for status in row.get("consumes", []):
                    if isinstance(status, str):
                        consumers[status].append(
                            (
                                member,
                                source,
                                probability,
                                _status_scopes(row, "consumes_scopes", status),
                            )
                        )

    for status, instances in providers.items():
        feats[f"{F_PROVIDER}|{status}"] = _probability_union(
            probability
            for _hero, _source, probability, _scopes, _recipients in instances
        )
    for status, instances in consumers.items():
        feats[f"{F_CONSUMER}|{status}"] = _probability_union(
            probability for _hero, _source, probability, _scopes in instances
        )

    for status in sorted(set(providers) & set(consumers)):
        beneficiary_values: dict[str, list[float]] = defaultdict(list)
        all_pair_values: list[float] = []
        for (
            consumer_hero,
            consumer_source,
            consumer_probability,
            consumer_scopes,
        ) in consumers[status]:
            external_probability = _probability_union(
                provider_probability
                for (
                    provider_hero,
                    provider_source,
                    provider_probability,
                    provider_scopes,
                    eligible_recipients,
                ) in providers[status]
                if (
                    (provider_hero, provider_source)
                    != (consumer_hero, consumer_source)
                    and (
                        eligible_recipients is None
                        or consumer_hero in eligible_recipients
                    )
                    and _status_scopes_compatible(
                        provider_hero,
                        provider_scopes,
                        consumer_hero,
                        consumer_scopes,
                    )
                )
            )
            if external_probability <= 0.0:
                continue
            pair_value = round(external_probability * consumer_probability, 6)
            all_pair_values.append(pair_value)
            beneficiary_values[consumer_hero].append(pair_value)
        if all_pair_values:
            feats[f"{F_MECHANIC_INTERACTION}|{status}"] = _probability_union(
                all_pair_values
            )
        for hero, values in beneficiary_values.items():
            feats[f"{F_HERO_MECHANIC_INTERACTION}|{hero}|{status}"] = (
                _probability_union(values)
            )


def team_features(
    team: list[dict[str, Any]],
    default_skill: Mapping[str, str],
    mechanics: Mapping[str, Any] | None = None,
) -> dict[str, float]:
    """Numeric feature values for one team.

    Existing identity/assignment families remain binary. Reusable mechanics and
    provider/consumer interactions carry bounded or normalized numeric values.
    """
    feats: dict[str, float] = {}

    heroes = [h.get("name", "") for h in team if h.get("name")]
    for hero in heroes:
        feats[f"{F_HERO}|{hero}"] = 1.0

    # Unordered hero pairs.
    uniq_heroes = sorted(set(heroes))
    for i in range(len(uniq_heroes)):
        for j in range(i + 1, len(uniq_heroes)):
            feats[f"{F_HERO_PAIR}|{uniq_heroes[i]}|{uniq_heroes[j]}"] = 1.0

    for hero_data in team:
        hero = hero_data.get("name", "")
        if not hero:
            continue
        skills = _non_default_skills(hero_data, default_skill)
        for skill in skills:
            feats[f"{F_SKILL}|{skill}"] = 1.0
            feats[f"{F_HERO_SKILL}|{hero}|{skill}"] = 1.0
        # Within-hero skill pairs (sorted for order independence).
        s_sorted = sorted(set(skills))
        for i in range(len(s_sorted)):
            for j in range(i + 1, len(s_sorted)):
                feats[f"{F_SKILL_PAIR}|{hero}|{s_sorted[i]}|{s_sorted[j]}"] = 1.0

    if mechanics is not None:
        _add_mechanic_features(feats, team, default_skill, mechanics)
    return feats


def paired_difference(
    b: Battle,
    default_skill: Mapping[str, str],
    mechanics: Mapping[str, Any] | None = None,
) -> dict[str, float]:
    """Return team1 feature values minus team2 feature values."""
    f1 = team_features(b.team1, default_skill, mechanics)
    f2 = team_features(b.team2, default_skill, mechanics)
    diff: dict[str, float] = {}
    for key in set(f1) | set(f2):
        val = f1.get(key, 0.0) - f2.get(key, 0.0)
        if val != 0:
            diff[key] = round(val, 6)
    return diff


def compute_support(
    battles: list[Battle],
    default_skill: Mapping[str, str],
    mechanics: Mapping[str, Any] | None = None,
) -> dict[str, int]:
    """How many battles each feature appears in (on either team).

    Support = evidence count for shrinking/dropping sparse interactions and for
    reporting per-recommendation evidence in the UI.
    """
    support: dict[str, int] = defaultdict(int)
    for b in battles:
        seen = set(team_features(b.team1, default_skill, mechanics)) | set(
            team_features(b.team2, default_skill, mechanics)
        )
        for key in seen:
            support[key] += 1
    return dict(support)


def _min_support_for(
    feature_id: str,
    *,
    min_support_single: int = MIN_SUPPORT_SINGLE,
    min_support_pair: int = MIN_SUPPORT_PAIR,
) -> int:
    family = feature_id.split("|", 1)[0]
    if family in (F_HERO, F_SKILL):
        return min_support_single
    return min_support_pair


def select_features(
    support: dict[str, int],
    *,
    min_support_single: int = MIN_SUPPORT_SINGLE,
    min_support_pair: int = MIN_SUPPORT_PAIR,
    excluded_families: Iterable[str] = (),
) -> list[str]:
    """Deterministic sorted list of features that clear their support floor.

    Selection depends only on support counts (never on outcomes), so it cannot
    leak held-out labels. Optional thresholds and exclusions are for the
    evaluation harness; production callers deliberately rely on the unchanged
    defaults above.
    """
    if min_support_single < 1 or min_support_pair < 1:
        raise ValueError("feature support thresholds must be positive")
    excluded = frozenset(excluded_families)
    kept = [
        fid
        for fid, n in support.items()
        if fid.split("|", 1)[0] not in excluded
        and n
        >= _min_support_for(
            fid,
            min_support_single=min_support_single,
            min_support_pair=min_support_pair,
        )
    ]
    kept.sort()
    return kept


# --------------------------------------------------------------------------- #
# Design matrix + model fitting
# --------------------------------------------------------------------------- #

def build_design_matrix(
    battles: list[Battle],
    feature_index: dict[str, int],
    default_skill: Mapping[str, str],
    mechanics: Mapping[str, Any] | None = None,
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
        for key, val in paired_difference(b, default_skill, mechanics).items():
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


def popularity_adjusted_atomic_weights(
    features: Iterable[str],
    coef: np.ndarray,
    support: Mapping[str, int],
    battles: Iterable[Battle],
    catalog_seasons: _CatalogSeasons,
    *,
    default_skill: Mapping[str, str] | None = None,
    hero_target_share: float = POPULARITY_TARGET_SHARE_HERO,
    skill_target_share: float = POPULARITY_TARGET_SHARE_SKILL,
    exposure_tau: float = POPULARITY_EXPOSURE_TAU,
    gamma: float = POPULARITY_PENALTY_GAMMA,
    weight_epsilon: float = WEIGHT_EPSILON,
    min_support_single: int = MIN_SUPPORT_SINGLE,
) -> dict[str, float]:
    """Return exposure-aware adjusted weights for every eligible atomic item.

    The transform is deliberately post-fit: feature selection, raw support, L2,
    the intercept, and all interaction families remain unchanged. Existing
    fitted ``H`` / ``S`` features retain their fitted weight as the baseline.
    Catalog heroes and standalone skills that fell below the fitting floor use
    a baseline of zero, allowing extreme under-use to become explicit negative
    evidence without fitting an unstable coefficient from one or two battles.
    For an atomic item in family ``F`` it uses::

        penalty = gamma * m_F * E/(E + tau) * max(0, 1 - n/(q_F * E))

    where ``n`` is union support among *known-season* training rows and ``E``
    counts known-season training battles in which the item was available.
    Unknown-season rows are excluded from both values, so a large untrusted
    corpus cannot distort this season-dependent prior, while those rows still
    contribute to logistic fitting and raw model support. ``m_F`` is the median
    absolute non-negligible fitted coefficient in the same family. The result
    is always ``raw_weight - penalty`` and is bounded by ``gamma * m_F``.

    ``coef`` may contain caller-specific columns after ``features``; only the
    first ``len(features)`` entries are inspected. The returned mapping contains
    adjusted atomic weights only.
    Zero-valued catalog-only candidates are omitted to keep downstream output
    compact. The optional parameters make the exact production transform
    directly testable and reusable by the full evaluation harness.
    """
    ordered_features = list(features)
    raw_coef = np.asarray(coef, dtype=np.float64)
    if len(raw_coef) < len(ordered_features):
        raise ValueError("coefficient vector is shorter than the feature list")
    if not 0.0 < hero_target_share <= 1.0:
        raise ValueError("hero target share must be in (0, 1]")
    if not 0.0 < skill_target_share <= 1.0:
        raise ValueError("skill target share must be in (0, 1]")
    if exposure_tau < 0.0:
        raise ValueError("exposure tau must be non-negative")
    if not 0.0 <= gamma <= 1.0:
        raise ValueError("popularity penalty gamma must be between 0 and 1")
    if weight_epsilon <= 0.0:
        raise ValueError("weight epsilon must be positive")
    if min_support_single < 1:
        raise ValueError("single-feature support threshold must be positive")

    training_battles = tuple(battles)
    known_season_battles = [
        battle
        for battle in training_battles
        if battle.season is not None
    ]
    popularity_support = compute_support(
        known_season_battles,
        default_skill or {},
    )
    target_share = {
        F_HERO: hero_target_share,
        F_SKILL: skill_target_share,
    }
    seasons_by_family: Mapping[str, Mapping[str, int]] = {
        F_HERO: catalog_seasons.heroes,
        F_SKILL: catalog_seasons.skills,
    }

    raw_atomic_weights = {
        feature_id: float(raw_coef[index])
        for index, feature_id in enumerate(ordered_features)
        if feature_id.split("|", 1)[0] in (F_HERO, F_SKILL)
    }

    family_magnitude: dict[str, float] = {}
    for family in (F_HERO, F_SKILL):
        magnitudes = [
            abs(raw_weight)
            for feature_id, raw_weight in raw_atomic_weights.items()
            if feature_id.split("|", 1)[0] == family
            and abs(raw_weight) >= weight_epsilon
        ]
        if magnitudes:
            family_magnitude[family] = float(
                np.median(np.asarray(magnitudes, dtype=np.float64))
            )

    candidate_features = set(raw_atomic_weights)
    candidate_features.update(
        f"{F_HERO}|{hero}"
        for hero in catalog_seasons.heroes
    )
    candidate_features.update(
        f"{F_SKILL}|{skill}"
        for skill in catalog_seasons.draftable_skills
    )
    # Preserve rare observed transferred/shadow skills even though they are not
    # standalone draft-pool choices. Their non-default occurrence proves that
    # the S feature is meaningful for scoring.
    candidate_features.update(
        feature_id
        for feature_id in support
        if feature_id.startswith(f"{F_SKILL}|")
        and feature_id.split("|", 1)[1] in catalog_seasons.skills
    )

    adjusted_atomic_weights: dict[str, float] = {}
    exposure_by_intro: dict[int, int] = {}
    for feature_id in sorted(candidate_features):
        family, separator, item_name = feature_id.partition("|")
        if family not in target_share:
            continue
        raw_weight = raw_atomic_weights.get(feature_id, 0.0)
        fitted_feature = feature_id in raw_atomic_weights
        if fitted_feature and abs(raw_weight) < weight_epsilon:
            # Preserve the established emission rule for a fitted coefficient
            # that is numerically neutral. The new zero baseline is only for an
            # item excluded from fitting because its evidence was below floor.
            adjusted_atomic_weights[feature_id] = raw_weight
            continue
        if not separator or not item_name:
            raise ValueError(f"invalid single-item feature id {feature_id!r}")
        intro_season = seasons_by_family[family].get(item_name)
        if intro_season is None:
            raise ValueError(
                f"{feature_id!r} has no validated catalog introduction season"
            )
        exposure = exposure_by_intro.get(intro_season)
        if exposure is None:
            exposure = sum(
                1
                for battle in known_season_battles
                if battle.season >= intro_season
            )
            exposure_by_intro[intro_season] = exposure
        if exposure <= 0:
            if feature_id in raw_atomic_weights:
                adjusted_atomic_weights[feature_id] = raw_weight
            continue

        observed_support = popularity_support.get(feature_id, 0)
        total_support = support.get(feature_id, 0)
        if (
            isinstance(total_support, bool)
            or not isinstance(total_support, int)
            or total_support < 0
        ):
            raise ValueError(
                f"{feature_id!r} has invalid support {total_support!r}"
            )
        if not fitted_feature and total_support >= min_support_single:
            # An atomic feature with enough evidence should have been fitted;
            # never fabricate a zero-baseline prior for an inconsistent caller.
            continue
        expected_support = target_share[family] * exposure
        penalty = 0.0
        if observed_support < expected_support:
            deficit = max(
                0.0,
                1.0 - (observed_support / expected_support),
            )
            newness_grace = exposure / (exposure + exposure_tau)
            penalty = (
                gamma
                * family_magnitude.get(family, 0.0)
                * newness_grace
                * deficit
            )
        adjusted_weight = raw_weight - penalty
        if (
            fitted_feature
            or abs(adjusted_weight) >= weight_epsilon
        ):
            adjusted_atomic_weights[feature_id] = adjusted_weight

    return adjusted_atomic_weights


def apply_popularity_penalty(
    features: Iterable[str],
    coef: np.ndarray,
    support: Mapping[str, int],
    battles: Iterable[Battle],
    catalog_seasons: _CatalogSeasons,
    *,
    default_skill: Mapping[str, str] | None = None,
    hero_target_share: float = POPULARITY_TARGET_SHARE_HERO,
    skill_target_share: float = POPULARITY_TARGET_SHARE_SKILL,
    exposure_tau: float = POPULARITY_EXPOSURE_TAU,
    gamma: float = POPULARITY_PENALTY_GAMMA,
    weight_epsilon: float = WEIGHT_EPSILON,
    min_support_single: int = MIN_SUPPORT_SINGLE,
) -> np.ndarray:
    """Apply atomic popularity weights to a fitted coefficient vector.

    Evaluation-only columns after ``features`` and every interaction family are
    copied through unchanged. Catalog-only sparse weights are available via
    :func:`popularity_adjusted_atomic_weights` because they have no fitted
    coefficient column to replace here.
    """
    ordered_features = list(features)
    adjusted = np.asarray(coef, dtype=np.float64).copy()
    atomic_weights = popularity_adjusted_atomic_weights(
        ordered_features,
        adjusted,
        support,
        battles,
        catalog_seasons,
        default_skill=default_skill,
        hero_target_share=hero_target_share,
        skill_target_share=skill_target_share,
        exposure_tau=exposure_tau,
        gamma=gamma,
        weight_epsilon=weight_epsilon,
        min_support_single=min_support_single,
    )
    for index, feature_id in enumerate(ordered_features):
        adjusted_weight = atomic_weights.get(feature_id)
        if adjusted_weight is not None:
            adjusted[index] = adjusted_weight

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
    mechanics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Grouped held-out backtest with train-only model construction.

    Capture/upload sessions are first joined with exact and one-skill-different
    matchup clusters. Whole resulting groups are assigned by a fixed salted
    hash; season and winner/outcome never affect group assignment.
    Feature selection, fitting, popularity adjustment, and the constant
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

    support = compute_support(train, default_skill, mechanics)
    features = select_features(support)
    feature_index = {fid: i for i, fid in enumerate(features)}

    X_train, y_train = build_design_matrix(
        train, feature_index, default_skill, mechanics
    )
    coef, intercept = fit_model(X_train, y_train, c=c)
    penalty_only_weights: dict[str, float] = {}
    if catalog_seasons is not None:
        atomic_weights = popularity_adjusted_atomic_weights(
            features,
            coef,
            support,
            train,
            catalog_seasons,
            default_skill=default_skill,
        )
        coef = coef.copy()
        for feature_id, column in feature_index.items():
            adjusted_weight = atomic_weights.get(feature_id)
            if adjusted_weight is not None:
                coef[column] = adjusted_weight
        penalty_only_weights = {
            feature_id: weight
            for feature_id, weight in atomic_weights.items()
            if feature_id not in feature_index
            and abs(weight) >= WEIGHT_EPSILON
        }

    X_test, y_test = build_design_matrix(
        test, feature_index, default_skill, mechanics
    )
    logits = X_test @ coef + intercept
    if penalty_only_weights:
        penalty_features = sorted(penalty_only_weights)
        penalty_index = {
            feature_id: index
            for index, feature_id in enumerate(penalty_features)
        }
        X_test_penalty, _ = build_design_matrix(
            test,
            penalty_index,
            default_skill,
            mechanics,
        )
        penalty_coef = np.asarray(
            [penalty_only_weights[feature_id] for feature_id in penalty_features],
            dtype=np.float64,
        )
        logits = logits + X_test_penalty @ penalty_coef
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


def _load_catalog_context(database_path: str) -> _CatalogContext:
    """Load public catalog metadata plus private names/introduction seasons."""
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
    try:
        mechanics = extract_skill_mechanics(db)
    except ValueError as exc:
        raise InvalidBattleError(f"database mechanics are invalid: {exc}") from exc
    audit = mechanics.get("audit", {})
    for field, item_kind in (
        ("unknown_status_terms", "skill"),
        ("unknown_bond_status_terms", "bond"),
    ):
        unknown_status_terms = audit.get(field, {})
        if unknown_status_terms:
            first_term = next(iter(unknown_status_terms))
            first_item = unknown_status_terms[first_term][0]
            raise InvalidBattleError(
                "database mechanics contain an unreviewed status-like term "
                f"{first_term!r} in {item_kind} {first_item!r}; add it to the "
                "status catalog/ontology or correct the description"
            )

    # Version every field that changes draft availability. Current combat
    # semantics have their independent mechanics_version so telemetry and upload
    # compatibility do not churn on a balance-text edit. Missing optional
    # metadata is normalized to JSON null, while a
    # missing shadow marker is the explicit semantic default false.
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
        "mechanics_version": mechanics["mechanics_version"],
        "hero_count": len(heroes),
        "skill_count": len(skills),
        "default_skill": default_skill,
    }
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
    return _CatalogContext(
        metadata=metadata,
        names=names,
        seasons=seasons,
        mechanics=mechanics,
    )


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
    and popularity exposure; unknown-season rows are represented only as null
    and are excluded from that season-dependent adjustment.
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
    mechanics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble the full ``recommendation_data.json`` artifact.

    The model here is fit on *all* valid battles (the backtest is computed
    separately on a grouped, season-independent stable-hash holdout).

    The result is a pure function of ``battles`` + ``catalog`` (``errors`` is
    only used for the invalid-count) — no wall-clock, no prior-output dependence
    — so re-running on the same inputs is byte-identical.
    """
    default_skill: Mapping[str, str] = catalog.get("default_skill", {})
    support_all = compute_support(battles, default_skill, mechanics)
    features = select_features(support_all)
    feature_index = {fid: i for i, fid in enumerate(features)}

    X, y = build_design_matrix(
        battles, feature_index, default_skill, mechanics
    )
    raw_coef, intercept = fit_model(X, y)
    atomic_weights: dict[str, float] = {}
    if catalog_seasons is not None:
        atomic_weights = popularity_adjusted_atomic_weights(
            features,
            raw_coef,
            support_all,
            battles,
            catalog_seasons,
            default_skill=default_skill,
        )
        coef = raw_coef.copy()
        for feature_id, column in feature_index.items():
            adjusted_weight = atomic_weights.get(feature_id)
            if adjusted_weight is not None:
                coef[column] = adjusted_weight
    else:
        coef = raw_coef

    # Emit weights + evidence keyed by feature id, sorted deterministically.
    weights: dict[str, float] = {}
    support_out: dict[str, int] = {}
    for fid, col in feature_index.items():
        # A fitted coefficient that is numerically neutral remains absent. The
        # zero-baseline popularity prior below is deliberately limited to
        # catalog items that never cleared the fitting floor.
        if abs(float(raw_coef[col])) < WEIGHT_EPSILON:
            continue
        w = float(coef[col])
        # Drop weights shrunk essentially to zero to keep the artifact compact
        # (the client treats a missing feature as the neutral prior of 0).
        if abs(w) < WEIGHT_EPSILON:
            continue
        weights[fid] = round(w, 6)
        support_out[fid] = support_all[fid]

    # Merge penalty-only atomic items after fitting. A missing support entry is
    # the literal zero count (the client already treats missing support as 0),
    # which avoids duplicating zero-evidence names in both client-side maps.
    for feature_id, weight in sorted(atomic_weights.items()):
        if feature_id in feature_index or abs(weight) < WEIGHT_EPSILON:
            continue
        weights[feature_id] = round(weight, 6)
        observed_support = support_all.get(feature_id, 0)
        if observed_support > 0:
            support_out[feature_id] = observed_support

    team1_wins = sum(1 for b in battles if b.winner == 1)
    team2_wins = len(battles) - team1_wins

    bt = backtest(
        battles,
        default_skill,
        catalog_seasons=catalog_seasons,
        mechanics=mechanics,
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
                F_MECHANIC: "reusable skill mechanic value",
                F_PROVIDER: "team provides named status",
                F_CONSUMER: "team consumes named status",
                F_MECHANIC_INTERACTION: "external status provider-consumer match",
                F_HERO_MECHANIC_INTERACTION: "beneficiary hero with external status provider",
                F_HERO_META: "normalized level-50 hero metadata",
                F_CAMP: "same-camp deterministic attribute bonus",
                F_HERO_SCALING_MATCH: "owner stat matched to skill scaling",
                F_TROOP_MATCH: "skill troop condition matched by team members",
                F_BOND: "activated named hero bond",
                F_BOND_MECHANIC: "reusable active-bond mechanic",
            },
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
            "popularity_penalty_gamma": POPULARITY_PENALTY_GAMMA,
            "popularity_exposure_tau": POPULARITY_EXPOSURE_TAU,
            "n_features": len(weights),
            "weights": weights,
            "support": support_out,
            "mechanics": (
                {**mechanics, "default_skill": dict(default_skill)}
                if mechanics is not None
                else None
            ),
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
    promotion_baseline_path: str | None = None,
    promotion_current_path: str | None = None,
    promotion_baseline_spec_path: str = "data/evaluation/production-baseline.json",
    promotion_evidence_path: str = "data/evaluation/recommendation-promotion.json",
) -> dict[str, Any]:
    """End-to-end build; writes ``output_path`` and returns the artifact.

    Fail-closed: if *any* battle file is invalid or unreadable, this aborts
    (raising ``SystemExit``) *before* writing, so a corrupt capture can never
    silently skew the model or partially overwrite the artifact.
    """
    try:
        catalog_context = _load_catalog_context(database_path)
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
        mechanics=catalog_context.mechanics,
    )

    candidate_bytes = (
        json.dumps(
            artifact,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")
    selected_bytes = candidate_bytes
    promoted = True
    if promotion_baseline_path is not None:
        _, baseline_bytes, _ = load_baseline_contract(
            promotion_baseline_spec_path,
            promotion_baseline_path,
        )
        evidence = load_json_object(promotion_evidence_path)
        current_bytes = (
            Path(promotion_current_path).read_bytes()
            if promotion_current_path is not None
            else baseline_bytes
        )
        selected_bytes, promoted = select_production_bytes(
            evidence,
            baseline_bytes,
            current_bytes,
            artifact,
            candidate_bytes,
        )

    output_dir = os.path.dirname(os.path.abspath(output_path))
    fd, tmp_path = tempfile.mkstemp(
        dir=output_dir, prefix=".recommendation_data.", suffix=".json.tmp"
    )
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(selected_bytes)
        os.replace(tmp_path, output_path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    if not promoted:
        print(f"✓ Preserved reviewed production baseline at {output_path}.")
        return json.loads(selected_bytes)

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
        promotion_baseline_path=str(
            root / "data/evaluation/production-baseline-artifact.json"
        ),
        promotion_current_path=args.output,
        promotion_baseline_spec_path=str(
            root / "data/evaluation/production-baseline.json"
        ),
        promotion_evidence_path=str(
            root / "data/evaluation/recommendation-promotion.json"
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
