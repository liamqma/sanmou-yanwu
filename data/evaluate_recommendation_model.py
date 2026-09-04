#!/usr/bin/env python3
"""Run the locked, grouped evaluation for the recommendation model.

This command is deliberately separate from the production artifact builder.
It may recommend a candidate configuration, but it never rewrites
``web/src/recommendation_data.json`` or changes production weights.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import numpy as np

try:
    from build_recommendation_data import (
        ATOMIC_FAMILIES,
        HIGH_ORDER_SHRINKAGE,
        MECHANIC_SHRINKAGE,
        PAIR_FAMILIES,
        PRODUCTION_ENABLED_FAMILIES,
        PRODUCTION_MECH_CERTAINTY_MODE,
        RELATIONSHIP_FAMILIES,
        TEAM_CONTEXT_FAMILIES,
        TEAM_CONTEXT_SHRINKAGE,
        F_HERO_TRIO,
        F_MECHANIC,
        F_SKILL_PAIR,
        F_TEAM_SKILL_TRIO,
        L2_C,
        MIN_MECHANIC_PAIR_DIVERSITY,
        MIN_SUPPORT_HIGH_ORDER,
        MIN_SUPPORT_MECHANIC,
        MIN_SUPPORT_PAIR,
        MIN_SUPPORT_RELATIONSHIP,
        MIN_SUPPORT_SINGLE,
        MIN_SUPPORT_TEAM_CONTEXT,
        SELECTION_PRIOR_HERO_PAIR_STRENGTH,
        SELECTION_PRIOR_HERO_SKILL_STRENGTH,
        SELECTION_PRIOR_HERO_STRENGTH,
        SELECTION_PRIOR_LOG_RATIO_CLIP,
        SELECTION_PRIOR_SKILL_STRENGTH,
        SELECTION_PRIOR_SMOOTHING,
        Battle,
        CatalogRelationships,
        InvalidBattleError,
        _CatalogSeasons,
        _load_catalog_context,
        _selection_prior_atomic_components,
        _selection_prior_relationship_components,
        _sigmoid,
        active_mechanic_skill_instances,
        apply_family_shrinkage,
        build_design_matrix,
        compute_corpus_version,
        compute_evaluation_version,
        compute_mechanic_witness_pair_counts,
        compute_support,
        fit_model,
        load_battles,
        load_yanwu_battles,
        mechanic_feature_witnesses,
        mechanic_id,
        select_features,
        team_features,
        validate_training_duplicate_policy,
    )
    from mechanics_contract import MechanicsContract, load_mechanics_contract
    from recommendation_evaluation import (
        BOOTSTRAP_SAMPLES,
        EVALUATION_PROTOCOL_VERSION,
        GROUP_HOLDOUT_SEED,
        NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS,
        SESSION_GAP_SECONDS,
        SOURCE_CATEGORIES,
        SOURCE_EXTERNAL_YANWU,
        SOURCE_UPLOADED_BY_ME,
        SOURCE_UPLOADED_BY_OTHERS,
        assign_evaluation_groups,
        paired_prediction_delta_report,
        point_metrics,
        prediction_report,
        stable_group_holdout_ids,
    )
    from yanwu_corpus import (
        InvalidYanwuCorpus,
        load_manifest,
        normalized_cache_path,
    )
except ModuleNotFoundError:  # Support ``python -m data.evaluate_recommendation_model``.
    from .build_recommendation_data import (
        ATOMIC_FAMILIES,
        HIGH_ORDER_SHRINKAGE,
        MECHANIC_SHRINKAGE,
        PAIR_FAMILIES,
        PRODUCTION_ENABLED_FAMILIES,
        PRODUCTION_MECH_CERTAINTY_MODE,
        RELATIONSHIP_FAMILIES,
        TEAM_CONTEXT_FAMILIES,
        TEAM_CONTEXT_SHRINKAGE,
        F_HERO_TRIO,
        F_MECHANIC,
        F_SKILL_PAIR,
        F_TEAM_SKILL_TRIO,
        L2_C,
        MIN_MECHANIC_PAIR_DIVERSITY,
        MIN_SUPPORT_HIGH_ORDER,
        MIN_SUPPORT_MECHANIC,
        MIN_SUPPORT_PAIR,
        MIN_SUPPORT_RELATIONSHIP,
        MIN_SUPPORT_SINGLE,
        MIN_SUPPORT_TEAM_CONTEXT,
        SELECTION_PRIOR_HERO_PAIR_STRENGTH,
        SELECTION_PRIOR_HERO_SKILL_STRENGTH,
        SELECTION_PRIOR_HERO_STRENGTH,
        SELECTION_PRIOR_LOG_RATIO_CLIP,
        SELECTION_PRIOR_SKILL_STRENGTH,
        SELECTION_PRIOR_SMOOTHING,
        Battle,
        CatalogRelationships,
        InvalidBattleError,
        _CatalogSeasons,
        _load_catalog_context,
        _selection_prior_atomic_components,
        _selection_prior_relationship_components,
        _sigmoid,
        active_mechanic_skill_instances,
        apply_family_shrinkage,
        build_design_matrix,
        compute_corpus_version,
        compute_evaluation_version,
        compute_mechanic_witness_pair_counts,
        compute_support,
        fit_model,
        load_battles,
        load_yanwu_battles,
        mechanic_feature_witnesses,
        mechanic_id,
        select_features,
        team_features,
        validate_training_duplicate_policy,
    )
    from .mechanics_contract import MechanicsContract, load_mechanics_contract
    from .recommendation_evaluation import (
        BOOTSTRAP_SAMPLES,
        EVALUATION_PROTOCOL_VERSION,
        GROUP_HOLDOUT_SEED,
        NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS,
        SESSION_GAP_SECONDS,
        SOURCE_CATEGORIES,
        SOURCE_EXTERNAL_YANWU,
        SOURCE_UPLOADED_BY_ME,
        SOURCE_UPLOADED_BY_OTHERS,
        assign_evaluation_groups,
        paired_prediction_delta_report,
        point_metrics,
        prediction_report,
        stable_group_holdout_ids,
    )
    from .yanwu_corpus import (
        InvalidYanwuCorpus,
        load_manifest,
        normalized_cache_path,
    )

MIN_TRAIN_BATTLES = 20
MIN_DEVELOPMENT_BATTLES = 20
MIN_TEST_BATTLES = 20
LOCKED_TEST_FRACTION = 0.2
DEVELOPMENT_FRACTION = 0.2
LOCKED_TEST_SEED = f"{GROUP_HOLDOUT_SEED}:pre-yanwu-locked-test"
DEVELOPMENT_SEED = f"{GROUP_HOLDOUT_SEED}:development"
LOCKED_TEST_MANIFEST_SCHEMA_VERSION = 1
LOCKED_TEST_MANIFEST_PATH = "data/evaluation/locked-pre-yanwu-test.json"
LEGACY_UNTIMED_OWNER_FILENAMES = frozenset(
    {
        "IMG_7825.json",
        "IMG_7826.json",
        "IMG_7827.json",
        "IMG_7828.json",
    }
)

C_CANDIDATES = (0.05, 0.1, 0.2, 0.5)
SINGLE_SUPPORT_CANDIDATES = (3, 5, 8)
PAIR_SUPPORT_CANDIDATES = (5, 8, 12)
TEAM_CONTEXT_SUPPORT_CANDIDATES = (8, 12, 20)
TEAM_CONTEXT_SHRINKAGE_CANDIDATES = (0.25, 0.5, 0.75, 1.0)
RELATIONSHIP_SUPPORT_CANDIDATES = (8, 12, 20)
MECH_CERTAINTY_CANDIDATES = ("explicit_only", "all_reviewed")
MECH_SUPPORT_CANDIDATES = (12, 20, 30)
MECH_SHRINKAGE_CANDIDATES = (0.25, 0.5, 0.75)
MECH_TOP_WITNESS_PAIRS = 5
HERO_TRIO_SUPPORT_CANDIDATES = (20, 50)
TEAM_SKILL_TRIO_SUPPORT_CANDIDATES = (50,)
SELECTION_PRIOR_HERO_STRENGTH_CANDIDATES = (0.0, 0.2, 0.4, 0.6)
SELECTION_PRIOR_SKILL_STRENGTH_CANDIDATES = (0.0, 0.1, 0.2, 0.3)
SELECTION_PRIOR_HERO_PAIR_STRENGTH_CANDIDATES = (0.0, 0.1, 0.2, 0.3)
SELECTION_PRIOR_HERO_SKILL_STRENGTH_CANDIDATES = (0.0, 0.05, 0.15, 0.25)
SELECTION_PRIOR_SMOOTHING_CANDIDATES = (5.0, 20.0, 50.0)
SELECTION_PRIOR_LOG_RATIO_CLIP_CANDIDATES = (1.0, 2.0, 3.0)
PRODUCTION_ARTIFACT_PATH = "web/src/recommendation_data.json"


@dataclass(frozen=True)
class EvaluationConfig:
    """One season-independent evaluation-only model configuration."""

    c: float = L2_C
    min_support_single: int = MIN_SUPPORT_SINGLE
    min_support_pair: int = MIN_SUPPORT_PAIR
    min_support_team_context: int = MIN_SUPPORT_TEAM_CONTEXT
    min_support_relationship: int = MIN_SUPPORT_RELATIONSHIP
    min_support_high_order: int = MIN_SUPPORT_HIGH_ORDER
    include_sp: bool = True
    include_ths_tsp: bool = TEAM_CONTEXT_FAMILIES <= PRODUCTION_ENABLED_FAMILIES
    include_hc_b: bool = RELATIONSHIP_FAMILIES <= PRODUCTION_ENABLED_FAMILIES
    include_mech: bool = F_MECHANIC in PRODUCTION_ENABLED_FAMILIES
    mech_certainty_mode: str = PRODUCTION_MECH_CERTAINTY_MODE
    min_support_mechanic: int = MIN_SUPPORT_MECHANIC
    mechanic_shrinkage: float = MECHANIC_SHRINKAGE
    min_mechanic_pair_diversity: int = MIN_MECHANIC_PAIR_DIVERSITY
    include_ht: bool = F_HERO_TRIO in PRODUCTION_ENABLED_FAMILIES
    include_ts3: bool = F_TEAM_SKILL_TRIO in PRODUCTION_ENABLED_FAMILIES
    team_context_shrinkage: float = TEAM_CONTEXT_SHRINKAGE
    high_order_shrinkage: float = HIGH_ORDER_SHRINKAGE
    selection_prior_hero_strength: float = SELECTION_PRIOR_HERO_STRENGTH
    selection_prior_skill_strength: float = SELECTION_PRIOR_SKILL_STRENGTH
    selection_prior_hero_pair_strength: float = SELECTION_PRIOR_HERO_PAIR_STRENGTH
    selection_prior_hero_skill_strength: float = SELECTION_PRIOR_HERO_SKILL_STRENGTH
    selection_prior_smoothing: float = SELECTION_PRIOR_SMOOTHING
    selection_prior_log_ratio_clip: float = SELECTION_PRIOR_LOG_RATIO_CLIP

    def __post_init__(self) -> None:
        if self.c <= 0:
            raise ValueError("C must be positive")
        if any(
            value < 1
            for value in (
                self.min_support_single,
                self.min_support_pair,
                self.min_support_team_context,
                self.min_support_relationship,
                self.min_support_high_order,
                self.min_support_mechanic,
                self.min_mechanic_pair_diversity,
            )
        ):
            raise ValueError("support thresholds must be positive")
        if not 0.0 <= self.team_context_shrinkage <= 1.0:
            raise ValueError("team-context shrinkage must be between zero and one")
        if not 0.0 <= self.high_order_shrinkage <= 1.0:
            raise ValueError("higher-order shrinkage must be between zero and one")
        if not 0.0 <= self.mechanic_shrinkage <= 1.0:
            raise ValueError("MECH shrinkage must be between zero and one")
        if self.mech_certainty_mode not in MECH_CERTAINTY_CANDIDATES:
            raise ValueError("unsupported MECH certainty mode")
        for name, value in (
            ("hero strength", self.selection_prior_hero_strength),
            ("skill strength", self.selection_prior_skill_strength),
            ("hero-pair strength", self.selection_prior_hero_pair_strength),
            ("hero-skill strength", self.selection_prior_hero_skill_strength),
        ):
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0.0
            ):
                raise ValueError(f"selection-prior {name} must be non-negative")
        for name, value in (
            ("smoothing", self.selection_prior_smoothing),
            ("log-ratio clip", self.selection_prior_log_ratio_clip),
        ):
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value <= 0.0
            ):
                raise ValueError(f"selection-prior {name} must be positive")

    def as_dict(self) -> dict[str, Any]:
        return {
            "C": self.c,
            "min_support_single": self.min_support_single,
            "min_support_pair": self.min_support_pair,
            "min_support_team_context": self.min_support_team_context,
            "min_support_relationship": self.min_support_relationship,
            "min_support_high_order": self.min_support_high_order,
            "include_sp": self.include_sp,
            "include_ths_tsp": self.include_ths_tsp,
            "include_hc_b": self.include_hc_b,
            "include_mech": self.include_mech,
            "mech_certainty_mode": self.mech_certainty_mode,
            "min_support_mechanic": self.min_support_mechanic,
            "mechanic_shrinkage": self.mechanic_shrinkage,
            "min_mechanic_pair_diversity": self.min_mechanic_pair_diversity,
            "include_ht": self.include_ht,
            "include_ts3": self.include_ts3,
            "team_context_shrinkage": self.team_context_shrinkage,
            "high_order_shrinkage": self.high_order_shrinkage,
            "selection_prior_hero_strength": self.selection_prior_hero_strength,
            "selection_prior_skill_strength": self.selection_prior_skill_strength,
            "selection_prior_hero_pair_strength": (
                self.selection_prior_hero_pair_strength
            ),
            "selection_prior_hero_skill_strength": (
                self.selection_prior_hero_skill_strength
            ),
            "selection_prior_smoothing": self.selection_prior_smoothing,
            "selection_prior_log_ratio_clip": self.selection_prior_log_ratio_clip,
        }

    def selection_key(self) -> tuple[Any, ...]:
        return (
            0 if not self.include_ts3 else 1,
            0 if not self.include_ht else 1,
            0 if not self.include_mech else 1,
            0 if not self.include_hc_b else 1,
            0 if not self.include_ths_tsp else 1,
            0 if not self.include_sp else 1,
            -self.min_support_single,
            -self.min_support_pair,
            -self.min_support_team_context,
            -self.min_support_relationship,
            -self.min_support_high_order,
            0 if self.mech_certainty_mode == "explicit_only" else 1,
            -self.min_support_mechanic,
            self.mechanic_shrinkage,
            -self.min_mechanic_pair_diversity,
            self.team_context_shrinkage,
            self.selection_prior_hero_strength,
            self.selection_prior_skill_strength,
            self.selection_prior_hero_pair_strength,
            self.selection_prior_hero_skill_strength,
            -self.selection_prior_smoothing,
            self.selection_prior_log_ratio_clip,
            self.c,
        )


@dataclass(frozen=True)
class EvaluationSplit:
    """Whole-group train/development/locked-test membership."""

    train_indices: tuple[int, ...]
    development_indices: tuple[int, ...]
    test_indices: tuple[int, ...]
    excluded_indices: tuple[int, ...]
    group_ids: tuple[str, ...]
    test_group_ids: tuple[str, ...]
    locked_test_group_set_hash: str
    removed_yanwu_battles: int
    removed_yanwu_groups: int


@dataclass
class PredictionRows:
    outcomes: list[int]
    probabilities: list[float]
    baseline_probabilities: list[float]
    group_ids: list[str]
    sources: list[str]
    n_features: int
    nonzero_rows: int
    atomic_diagnostics: dict[str, Any]
    relationship_diagnostics: dict[str, Any] = field(default_factory=dict)
    mechanic_diagnostics: dict[str, Any] = field(default_factory=dict)


def _component_diagnostics(
    components: Mapping[str, Mapping[str, float | int]],
    families: Sequence[str],
) -> dict[str, Any]:
    """Summarize appearance effects without relying on named-item fixtures."""
    buckets = (
        ("0-19", 0, 20),
        ("20-99", 20, 100),
        ("100-499", 100, 500),
        ("500+", 500, None),
    )
    result: dict[str, Any] = {}
    for family in families:
        rows = [
            (feature_id, component)
            for feature_id, component in components.items()
            if feature_id.startswith(f"{family}|")
        ]
        family_buckets: dict[str, Any] = {}
        for label, low, high in buckets:
            selected = [
                (feature_id, component)
                for feature_id, component in rows
                if int(component["appearance_count"]) >= low
                and (high is None or int(component["appearance_count"]) < high)
            ]
            family_buckets[label] = {
                "item_count": len(selected),
                "mean_abs_outcome_weight": round(
                    float(np.mean([
                        abs(float(component["outcome_weight"]))
                        for _, component in selected
                    ])) if selected else 0.0,
                    6,
                ),
                "mean_abs_count_adjustment": round(
                    float(np.mean([
                        abs(float(component["count_adjustment"]))
                        for _, component in selected
                    ])) if selected else 0.0,
                    6,
                ),
                "max_abs_final_weight": round(
                    max(
                        (abs(float(component["final_weight"])) for _, component in selected),
                        default=0.0,
                    ),
                    6,
                ),
            }
        result[family] = family_buckets
    return result


def _atomic_diagnostics(
    components: Mapping[str, Mapping[str, float | int]],
) -> dict[str, Any]:
    return _component_diagnostics(components, ("H", "S"))


def _relationship_diagnostics(
    components: Mapping[str, Mapping[str, float | int]],
) -> dict[str, Any]:
    return _component_diagnostics(components, ("HP", "HS"))


def _load_evaluation_corpus(
    battles_dir: str,
    web_upload_dir: str,
    web_upload_state_path: str,
    database_path: str,
    mech_catalog_path: str,
    yanwu_corpus_path: str | None = None,
    yanwu_manifest_path: str = "data/external/yanwu-release.json",
) -> tuple[
    list[Battle],
    dict[str, Any],
    _CatalogSeasons,
    CatalogRelationships,
    MechanicsContract,
]:
    catalog_context = _load_catalog_context(database_path)
    mechanics = load_mechanics_contract(database_path, mech_catalog_path)
    manual_battles, errors = load_battles(
        battles_dir,
        catalog_names=catalog_context.names,
        catalog_seasons=catalog_context.seasons,
        source=SOURCE_UPLOADED_BY_ME,
    )
    web_battles, web_errors = load_battles(
        web_upload_dir,
        filename_prefix="web-upload/",
        catalog_names=catalog_context.names,
        catalog_seasons=catalog_context.seasons,
        source=SOURCE_UPLOADED_BY_OTHERS,
    )
    errors.extend(web_errors)
    yanwu_battles: list[Battle] = []
    if yanwu_corpus_path is not None:
        yanwu_battles, yanwu_errors = load_yanwu_battles(
            yanwu_corpus_path,
            yanwu_manifest_path,
            catalog_version=catalog_context.metadata["catalog_version"],
            catalog_names=catalog_context.names,
            catalog_seasons=catalog_context.seasons,
        )
        errors.extend(yanwu_errors)
    if errors:
        detail = "\n".join(f"  - {error}" for error in errors[:20])
        raise InvalidBattleError(
            f"{len(errors)} invalid/unreadable battle file(s):\n{detail}"
        )
    validate_training_duplicate_policy(
        manual_battles,
        web_battles,
        web_upload_state_path,
    )
    battles = sorted(
        [*manual_battles, *web_battles, *yanwu_battles],
        key=lambda battle: (battle.order_key, battle.filename),
    )
    missing_timestamps = [
        battle.filename
        for battle in battles
        if battle.captured_at is None
        and not (
            battle.source == SOURCE_UPLOADED_BY_ME
            and battle.filename in LEGACY_UNTIMED_OWNER_FILENAMES
        )
    ]
    if missing_timestamps:
        raise InvalidBattleError(
            "evaluation cannot infer a capture/upload session for "
            f"{missing_timestamps[0]!r}; add an explicit timestamp parser or "
            "a reviewed legacy manifest entry"
        )
    return (
        battles,
        catalog_context.metadata,
        catalog_context.seasons,
        catalog_context.relationships,
        mechanics,
    )


def _battle_identity(battle: Battle) -> str:
    return f"{battle.source}:{battle.filename}"


def _validate_locked_test_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "fraction",
        "groups",
        "protocol_version",
        "schema_version",
        "seed",
        "source_battle_count",
        "source_group_count",
    }:
        raise InvalidBattleError("locked-test manifest contract is invalid")
    if (
        value["schema_version"] != LOCKED_TEST_MANIFEST_SCHEMA_VERSION
        or value["protocol_version"] != EVALUATION_PROTOCOL_VERSION
        or value["seed"] != LOCKED_TEST_SEED
        or value["fraction"] != LOCKED_TEST_FRACTION
        or isinstance(value["source_battle_count"], bool)
        or not isinstance(value["source_battle_count"], int)
        or value["source_battle_count"] < 1
        or isinstance(value["source_group_count"], bool)
        or not isinstance(value["source_group_count"], int)
        or value["source_group_count"] < 2
        or not isinstance(value["groups"], list)
        or not value["groups"]
    ):
        raise InvalidBattleError("locked-test manifest metadata is invalid")

    seen_groups: set[str] = set()
    seen_battles: set[str] = set()
    groups: list[dict[str, Any]] = []
    allowed_prefixes = (
        f"{SOURCE_UPLOADED_BY_ME}:",
        f"{SOURCE_UPLOADED_BY_OTHERS}:",
    )
    for raw_group in value["groups"]:
        if not isinstance(raw_group, dict) or set(raw_group) != {
            "battle_identities",
            "group_id",
        }:
            raise InvalidBattleError("locked-test manifest group is invalid")
        group_id = raw_group["group_id"]
        identities = raw_group["battle_identities"]
        if (
            not isinstance(group_id, str)
            or not group_id
            or group_id in seen_groups
            or not isinstance(identities, list)
            or not identities
            or identities != sorted(identities)
        ):
            raise InvalidBattleError("locked-test manifest group is invalid")
        seen_groups.add(group_id)
        normalized_identities: list[str] = []
        for identity in identities:
            if (
                not isinstance(identity, str)
                or not identity.startswith(allowed_prefixes)
                or identity in seen_battles
            ):
                raise InvalidBattleError(
                    "locked-test manifest battle identity is invalid"
                )
            seen_battles.add(identity)
            normalized_identities.append(identity)
        groups.append(
            {
                "battle_identities": normalized_identities,
                "group_id": group_id,
            }
        )
    if groups != sorted(groups, key=lambda group: group["group_id"]):
        raise InvalidBattleError("locked-test manifest groups are not sorted")
    if len(seen_groups) >= value["source_group_count"]:
        raise InvalidBattleError("locked-test manifest group counts are invalid")
    return dict(value)


def load_locked_test_manifest(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise InvalidBattleError(
            f"cannot read locked-test manifest {path}: {exc}"
        ) from exc
    return _validate_locked_test_manifest(value)


def create_locked_test_manifest(
    battles: Sequence[Battle],
    *,
    locked_test_fraction: float = LOCKED_TEST_FRACTION,
    locked_test_seed: str = LOCKED_TEST_SEED,
) -> dict[str, Any]:
    pre_battles = [
        battle
        for battle in battles
        if battle.source != SOURCE_EXTERNAL_YANWU
    ]
    pre_groups = assign_evaluation_groups(
        pre_battles,
        session_gap_seconds=SESSION_GAP_SECONDS,
        cluster_matchups=True,
    )
    selected_groups = stable_group_holdout_ids(
        pre_groups,
        locked_test_fraction,
        seed=locked_test_seed,
    )
    groups = [
        {
            "battle_identities": sorted(
                _battle_identity(battle)
                for battle, candidate_group in zip(pre_battles, pre_groups)
                if candidate_group == group_id
            ),
            "group_id": group_id,
        }
        for group_id in sorted(selected_groups)
    ]
    return _validate_locked_test_manifest(
        {
            "fraction": locked_test_fraction,
            "groups": groups,
            "protocol_version": EVALUATION_PROTOCOL_VERSION,
            "schema_version": LOCKED_TEST_MANIFEST_SCHEMA_VERSION,
            "seed": locked_test_seed,
            "source_battle_count": len(pre_battles),
            "source_group_count": len(set(pre_groups)),
        }
    )


def build_grouped_split(
    battles: Sequence[Battle],
    locked_test_manifest: Mapping[str, Any],
    *,
    development_fraction: float = DEVELOPMENT_FRACTION,
    development_seed: str = DEVELOPMENT_SEED,
    minimum_train_battles: int = MIN_TRAIN_BATTLES,
    minimum_development_battles: int = MIN_DEVELOPMENT_BATTLES,
    minimum_test_battles: int = MIN_TEST_BATTLES,
) -> EvaluationSplit:
    """Build the season-independent split used by tuning and final evaluation.

    The checked-in manifest freezes whole pre-Yanwu leakage groups by stable
    source-qualified battle identity. New reports can therefore neither enter
    nor displace the locked test. All-corpus groups still merge sessions with
    exact and near-duplicate matchups so any non-test row touching a locked row
    is excluded before the remaining groups receive the train/development split.
    No membership decision reads season or winner/outcome.
    """
    if len(battles) < 3:
        raise InvalidBattleError("evaluation requires at least three battles")
    manifest = _validate_locked_test_manifest(locked_test_manifest)
    locked_group_by_identity = {
        identity: group["group_id"]
        for group in manifest["groups"]
        for identity in group["battle_identities"]
    }
    current_index_by_identity: dict[str, int] = {}
    for index, battle in enumerate(battles):
        identity = _battle_identity(battle)
        if identity in current_index_by_identity:
            raise InvalidBattleError(
                f"duplicate evaluation battle identity {identity!r}"
            )
        current_index_by_identity[identity] = index
    missing_identities = sorted(
        set(locked_group_by_identity) - set(current_index_by_identity)
    )
    if missing_identities:
        raise InvalidBattleError(
            "locked-test battle is missing from the pre-Yanwu corpus: "
            f"{missing_identities[0]!r}"
        )
    test_indices = tuple(
        index
        for index, battle in enumerate(battles)
        if _battle_identity(battle) in locked_group_by_identity
    )
    if any(
        battles[index].source == SOURCE_EXTERNAL_YANWU
        for index in test_indices
    ):
        raise InvalidBattleError("locked test must contain only pre-Yanwu battles")
    test_group_ids = tuple(
        locked_group_by_identity[_battle_identity(battles[index])]
        for index in test_indices
    )
    if len(test_indices) < minimum_test_battles:
        raise InvalidBattleError(
            f"locked test has only {len(test_indices)} battles; "
            f"at least {minimum_test_battles} are required"
        )

    group_ids = tuple(
        assign_evaluation_groups(
            battles,
            session_gap_seconds=SESSION_GAP_SECONDS,
            cluster_matchups=True,
        )
    )
    test_index_set = set(test_indices)
    held_global_groups = {group_ids[index] for index in test_indices}
    excluded_indices = tuple(
        index
        for index in range(len(battles))
        if index not in test_index_set
        and group_ids[index] in held_global_groups
    )
    excluded_set = set(excluded_indices)
    eligible_indices = [
        index
        for index in range(len(battles))
        if index not in test_index_set
        and index not in excluded_set
        and group_ids[index] not in held_global_groups
    ]
    eligible_groups = [group_ids[index] for index in eligible_indices]
    development_groups = stable_group_holdout_ids(
        eligible_groups,
        development_fraction,
        seed=development_seed,
    )
    development_indices = tuple(
        index
        for index in eligible_indices
        if group_ids[index] in development_groups
    )
    train_indices = tuple(
        index
        for index in eligible_indices
        if group_ids[index] not in development_groups
    )
    if len(train_indices) < minimum_train_battles:
        raise InvalidBattleError(
            f"training split has only {len(train_indices)} battles; "
            f"at least {minimum_train_battles} are required"
        )
    if len(development_indices) < minimum_development_battles:
        raise InvalidBattleError(
            f"development split has only {len(development_indices)} battles; "
            f"at least {minimum_development_battles} are required"
        )

    for left, right in (
        (train_indices, development_indices),
        (train_indices, test_indices),
        (development_indices, test_indices),
    ):
        if {group_ids[index] for index in left} & {
            group_ids[index] for index in right
        }:
            raise InvalidBattleError("a leakage group crosses evaluation splits")

    locked_hash = hashlib.sha256(
        json.dumps(
            manifest["groups"],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:16]
    removed_yanwu_indices = [
        index
        for index in excluded_indices
        if battles[index].source == SOURCE_EXTERNAL_YANWU
    ]
    removed_yanwu_groups = len({
        group_ids[index] for index in removed_yanwu_indices
    })
    return EvaluationSplit(
        train_indices=train_indices,
        development_indices=development_indices,
        test_indices=test_indices,
        excluded_indices=excluded_indices,
        group_ids=group_ids,
        test_group_ids=test_group_ids,
        locked_test_group_set_hash=locked_hash,
        removed_yanwu_battles=len(removed_yanwu_indices),
        removed_yanwu_groups=removed_yanwu_groups,
    )


def _fit_and_predict(
    config: EvaluationConfig,
    train_indices: Sequence[int],
    test_indices: Sequence[int],
    battles: Sequence[Battle],
    group_ids: Sequence[str],
    default_skill: Mapping[str, str],
    catalog_seasons: _CatalogSeasons,
    relationships: CatalogRelationships | None,
    mechanics: MechanicsContract | None = None,
    *,
    test_group_ids: Sequence[str] | None = None,
    mechanic_selection_indices: Sequence[int] | None = None,
) -> PredictionRows:
    train = [battles[index] for index in train_indices]
    test = [battles[index] for index in test_indices]
    if config.include_mech and mechanics is None:
        raise ValueError("enabled MECH evaluation requires a validated contract")
    active_mechanics = mechanics if config.include_mech else None
    support = compute_support(
        train,
        default_skill,
        relationships,
        mechanics=active_mechanics,
        mech_certainty_mode=config.mech_certainty_mode,
    )
    mechanic_evidence = (
        [battles[index] for index in mechanic_selection_indices]
        if mechanic_selection_indices is not None
        else train
    )
    mechanic_support: dict[str, int] = {}
    mechanic_pair_counts: dict[str, dict[tuple[str, str], int]] = {}
    mechanic_pair_diversity: dict[str, int] = {}
    if active_mechanics is not None:
        evidence_support = compute_support(
            mechanic_evidence,
            default_skill,
            relationships,
            mechanics=active_mechanics,
            mech_certainty_mode=config.mech_certainty_mode,
        )
        mechanic_support = {
            feature_id: count
            for feature_id, count in evidence_support.items()
            if feature_id.startswith(f"{F_MECHANIC}|")
        }
        # M support and diversity remain frozen to original training rows even
        # when the final coefficients are refit on training plus development.
        support = {
            feature_id: count
            for feature_id, count in support.items()
            if not feature_id.startswith(f"{F_MECHANIC}|")
        }
        support.update(mechanic_support)
        mechanic_pair_counts = compute_mechanic_witness_pair_counts(
            mechanic_evidence,
            default_skill,
            active_mechanics,
            certainty_mode=config.mech_certainty_mode,
        )
        mechanic_pair_diversity = {
            feature_id: len(pair_counts)
            for feature_id, pair_counts in mechanic_pair_counts.items()
        }
    enabled_families = set(ATOMIC_FAMILIES | PAIR_FAMILIES)
    if not config.include_sp:
        enabled_families.discard(F_SKILL_PAIR)
    if config.include_ths_tsp:
        enabled_families.update(TEAM_CONTEXT_FAMILIES)
    if config.include_hc_b:
        enabled_families.update(RELATIONSHIP_FAMILIES)
    if config.include_mech:
        enabled_families.add(F_MECHANIC)
    if config.include_ht:
        enabled_families.add(F_HERO_TRIO)
    if config.include_ts3:
        enabled_families.add(F_TEAM_SKILL_TRIO)
    features = select_features(
        support,
        min_support_single=config.min_support_single,
        min_support_pair=config.min_support_pair,
        min_support_team_context=config.min_support_team_context,
        min_support_relationship=config.min_support_relationship,
        min_support_high_order=config.min_support_high_order,
        min_support_mechanic=config.min_support_mechanic,
        min_mechanic_pair_diversity=config.min_mechanic_pair_diversity,
        mechanic_pair_diversity=mechanic_pair_diversity,
        enabled_families=enabled_families,
    )
    feature_index = {
        feature_id: index
        for index, feature_id in enumerate(features)
    }
    X_train, y_train = build_design_matrix(
        train,
        feature_index,
        default_skill,
        relationships,
        mechanics=active_mechanics,
        mech_certainty_mode=config.mech_certainty_mode,
    )
    X_test, y_test = build_design_matrix(
        test,
        feature_index,
        default_skill,
        relationships,
        mechanics=active_mechanics,
        mech_certainty_mode=config.mech_certainty_mode,
    )
    fitted_coef, intercept = fit_model(X_train, y_train, c=config.c)
    coef = apply_family_shrinkage(
        features,
        fitted_coef,
        team_context_shrinkage=config.team_context_shrinkage,
        high_order_shrinkage=config.high_order_shrinkage,
        mechanic_shrinkage=config.mechanic_shrinkage,
    )
    atomic_components = _selection_prior_atomic_components(
        features,
        coef,
        train,
        catalog_seasons,
        default_skill=default_skill,
        hero_strength=config.selection_prior_hero_strength,
        skill_strength=config.selection_prior_skill_strength,
        smoothing=config.selection_prior_smoothing,
        log_ratio_clip=config.selection_prior_log_ratio_clip,
    )
    relationship_components = _selection_prior_relationship_components(
        features,
        coef,
        train,
        default_skill=default_skill,
        hero_pair_strength=config.selection_prior_hero_pair_strength,
        hero_skill_strength=config.selection_prior_hero_skill_strength,
        smoothing=config.selection_prior_smoothing,
        log_ratio_clip=config.selection_prior_log_ratio_clip,
    )
    atomic_weights = {
        feature_id: float(component["final_weight"])
        for feature_id, component in atomic_components.items()
    }
    adjusted_weights = {
        **atomic_weights,
        **{
            feature_id: float(component["final_weight"])
            for feature_id, component in relationship_components.items()
        },
    }
    scoring_coef = coef.copy()
    for feature_id, column in feature_index.items():
        adjusted_weight = adjusted_weights.get(feature_id)
        if adjusted_weight is not None:
            scoring_coef[column] = adjusted_weight

    prior_only_weights = {
        feature_id: weight
        for feature_id, weight in atomic_weights.items()
        if feature_id not in feature_index and abs(weight) >= 1e-6
    }
    logits = X_test @ scoring_coef + intercept
    nonzero_test_rows = np.any(X_test != 0.0, axis=1)
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
            relationships,
        )
        prior_coef = np.asarray(
            [prior_only_weights[feature_id] for feature_id in prior_features],
            dtype=np.float64,
        )
        logits = logits + X_test_prior @ prior_coef
        nonzero_test_rows = nonzero_test_rows | np.any(
            X_test_prior != 0.0,
            axis=1,
        )
    probabilities = _sigmoid(logits)
    selected_mechanic_features = [
        feature_id
        for feature_id in features
        if feature_id.startswith(f"{F_MECHANIC}|")
    ]
    mechanic_diagnostics: dict[str, Any] = {}
    if active_mechanics is not None:
        supported = [
            feature_id
            for feature_id, count in sorted(mechanic_support.items())
            if count >= config.min_support_mechanic
        ]
        diversity_qualified = [
            feature_id
            for feature_id in sorted(mechanic_support)
            if mechanic_pair_diversity.get(feature_id, 0)
            >= config.min_mechanic_pair_diversity
        ]
        selected_set = set(selected_mechanic_features)
        mechanic_diagnostics = {
            "emitted_feature_count": len(mechanic_support),
            "supported_feature_count": len(supported),
            "diversity_qualified_feature_count": len(diversity_qualified),
            "selected_feature_count": len(selected_mechanic_features),
            "features": {
                feature_id: {
                    "training_battle_support": mechanic_support[feature_id],
                    "distinct_ordered_skill_pair_count": (
                        mechanic_pair_diversity.get(feature_id, 0)
                    ),
                    "selected": feature_id in selected_set,
                    "weight_after_shrinkage": (
                        round(float(coef[feature_index[feature_id]]), 9)
                        if feature_id in selected_set
                        else None
                    ),
                    "top_witness_pairs": [
                        {
                            "provider_skill": pair[0],
                            "consumer_skill": pair[1],
                            "training_battle_count": count,
                        }
                        for pair, count in sorted(
                            mechanic_pair_counts.get(feature_id, {}).items(),
                            key=lambda item: (-item[1], item[0][0], item[0][1]),
                        )[:MECH_TOP_WITNESS_PAIRS]
                    ] if feature_id in selected_set else [],
                }
                for feature_id in sorted(mechanic_support)
            },
        }
    baseline_probability = float(np.mean(y_train)) if len(y_train) else 0.5
    row_group_ids = (
        list(test_group_ids)
        if test_group_ids is not None
        else [group_ids[index] for index in test_indices]
    )
    if len(row_group_ids) != len(test):
        raise ValueError("test group IDs must match test rows")
    return PredictionRows(
        outcomes=y_test.astype(int).tolist(),
        probabilities=probabilities.astype(float).tolist(),
        baseline_probabilities=[baseline_probability] * len(test),
        group_ids=row_group_ids,
        sources=[battle.source for battle in test],
        n_features=len(features) + len(prior_only_weights),
        nonzero_rows=int(np.count_nonzero(nonzero_test_rows)),
        atomic_diagnostics=_atomic_diagnostics(atomic_components),
        relationship_diagnostics=_relationship_diagnostics(
            relationship_components
        ),
        mechanic_diagnostics=mechanic_diagnostics,
    )


def _selection_summary(
    config: EvaluationConfig,
    rows: PredictionRows,
) -> dict[str, Any]:
    metrics = point_metrics(rows.outcomes, rows.probabilities)
    return {
        "config": config.as_dict(),
        "n": len(rows.outcomes),
        "n_groups": len(set(rows.group_ids)),
        "accuracy": (
            round(float(metrics["accuracy"]), 6)
            if metrics["accuracy"] is not None
            else None
        ),
        "log_loss": (
            round(float(metrics["log_loss"]), 6)
            if metrics["log_loss"] is not None
            else None
        ),
        "brier": (
            round(float(metrics["brier"]), 6)
            if metrics["brier"] is not None
            else None
        ),
        "n_features": rows.n_features,
        "feature_coverage": (
            round(rows.nonzero_rows / len(rows.outcomes), 4)
            if rows.outcomes
            else None
        ),
    }


def _selection_sort_key(
    config: EvaluationConfig,
    rows: PredictionRows,
) -> tuple[Any, ...]:
    metrics = point_metrics(rows.outcomes, rows.probabilities)
    return (
        float(metrics["log_loss"])
        if metrics["log_loss"] is not None
        else float("inf"),
        float(metrics["brier"])
        if metrics["brier"] is not None
        else float("inf"),
        -float(metrics["accuracy"])
        if metrics["accuracy"] is not None
        else float("inf"),
        config.selection_key(),
    )


def _improves_development_calibration(
    candidate: PredictionRows,
    reference: PredictionRows,
) -> bool:
    """Conservative gate for optional correlated higher-order families."""
    candidate_metrics = point_metrics(candidate.outcomes, candidate.probabilities)
    reference_metrics = point_metrics(reference.outcomes, reference.probabilities)
    return (
        candidate_metrics["log_loss"] is not None
        and reference_metrics["log_loss"] is not None
        and candidate_metrics["brier"] is not None
        and reference_metrics["brier"] is not None
        and float(candidate_metrics["log_loss"])
        < float(reference_metrics["log_loss"])
        and float(candidate_metrics["brier"])
        < float(reference_metrics["brier"])
    )


def _select_calibrated_optional_config(
    reference: EvaluationConfig,
    enabled_candidates: Sequence[EvaluationConfig],
    development_rows: Callable[[EvaluationConfig], PredictionRows],
) -> EvaluationConfig:
    best_enabled = min(
        enabled_candidates,
        key=lambda config: _selection_sort_key(config, development_rows(config)),
    )
    if _improves_development_calibration(
        development_rows(best_enabled),
        development_rows(reference),
    ):
        return best_enabled
    return reference


def _full_report(
    rows: PredictionRows,
    *,
    bootstrap_samples: int,
) -> dict[str, Any]:
    report = prediction_report(
        rows.outcomes,
        rows.probabilities,
        rows.group_ids,
        rows.sources,
        bootstrap_samples=bootstrap_samples,
    )
    report["feature_coverage"] = (
        round(rows.nonzero_rows / len(rows.outcomes), 4)
        if rows.outcomes
        else None
    )
    report["n_features"] = rows.n_features
    report["baseline"] = prediction_report(
        rows.outcomes,
        rows.baseline_probabilities,
        rows.group_ids,
        rows.sources,
        bootstrap_samples=bootstrap_samples,
    )
    return report


def _paired_delta_report(
    candidate: PredictionRows,
    reference: PredictionRows,
    *,
    bootstrap_samples: int,
) -> dict[str, Any]:
    if (
        candidate.outcomes != reference.outcomes
        or candidate.group_ids != reference.group_ids
        or candidate.sources != reference.sources
    ):
        raise ValueError("metric deltas require paired prediction rows")
    report = paired_prediction_delta_report(
        candidate.outcomes,
        candidate.probabilities,
        reference.probabilities,
        candidate.group_ids,
        bootstrap_samples=bootstrap_samples,
    )
    by_source: dict[str, Any] = {}
    outcomes = np.asarray(candidate.outcomes)
    candidate_probabilities = np.asarray(candidate.probabilities)
    reference_probabilities = np.asarray(reference.probabilities)
    groups = np.asarray(candidate.group_ids, dtype=object)
    sources = np.asarray(candidate.sources, dtype=object)
    for offset, source in enumerate(SOURCE_CATEGORIES):
        mask = sources == source
        by_source[source] = paired_prediction_delta_report(
            outcomes[mask],
            candidate_probabilities[mask],
            reference_probabilities[mask],
            groups[mask],
            bootstrap_samples=bootstrap_samples,
            seed=offset + 1,
        )
    report["by_source"] = by_source
    return report


def _split_balance(
    battles: Sequence[Battle],
    indices: Sequence[int],
    group_ids: Sequence[str],
) -> dict[str, Any]:
    rows = [battles[index] for index in indices]
    row_groups = [group_ids[index] for index in indices]
    by_source: dict[str, Any] = {}
    for source in SOURCE_CATEGORIES:
        source_positions = [
            position
            for position, battle in enumerate(rows)
            if battle.source == source
        ]
        source_rows = [rows[position] for position in source_positions]
        by_source[source] = {
            "n_battles": len(source_rows),
            "n_groups": len({row_groups[position] for position in source_positions}),
            "team1_wins": sum(battle.winner == 1 for battle in source_rows),
            "team2_wins": sum(battle.winner == 2 for battle in source_rows),
            "team1_win_rate": (
                round(
                    sum(battle.winner == 1 for battle in source_rows)
                    / len(source_rows),
                    4,
                )
                if source_rows
                else None
            ),
        }
    return {
        "n_battles": len(rows),
        "n_groups": len(set(row_groups)),
        "team1_wins": sum(battle.winner == 1 for battle in rows),
        "team2_wins": sum(battle.winner == 2 for battle in rows),
        "team1_win_rate": (
            round(sum(battle.winner == 1 for battle in rows) / len(rows), 4)
            if rows
            else None
        ),
        "by_source": by_source,
    }


def _comparison_conclusion(delta: Mapping[str, Any]) -> str:
    intervals = delta.get("confidence_intervals_95", {})
    accuracy = intervals.get("accuracy")
    brier = intervals.get("brier")
    log_loss = intervals.get("log_loss")
    if (
        isinstance(accuracy, dict)
        and isinstance(brier, dict)
        and isinstance(log_loss, dict)
        and accuracy["low"] > 0
        and brier["high"] < 0
        and log_loss["high"] < 0
    ):
        return "candidate_improvement_supported_on_all_three_metrics"
    return "inconclusive_no_improvement_claim"


def _targeted_context_diagnostics(
    battles: Sequence[Battle],
    training_indices: Sequence[int],
    default_skill: Mapping[str, str],
    relationships: CatalogRelationships | None,
) -> dict[str, Any]:
    carried = 0
    carried_with_lu_xun = 0
    teammate_carried = 0
    for battle in battles:
        for team in (battle.team1, battle.team2):
            heroes = {str(hero.get("name", "")) for hero in team}
            if "张昭" not in heroes:
                continue
            zhang_zhao = next(
                (hero for hero in team if hero.get("name") == "张昭"),
                None,
            )
            if zhang_zhao is not None and "烈火张天" in zhang_zhao.get("skills", [])[1:]:
                carried += 1
                if "陆逊" in heroes:
                    carried_with_lu_xun += 1
            elif "陆逊" in heroes and any(
                hero.get("name") != "张昭"
                and "烈火张天" in hero.get("skills", [])[1:]
                for hero in team
            ):
                teammate_carried += 1

    train = [battles[index] for index in training_indices]
    support = compute_support(train, default_skill, relationships)
    tsp_rows = {
        feature_id: count
        for feature_id, count in sorted(support.items())
        if feature_id.startswith("TSP|") and "烈火张天" in feature_id.split("|")[1:]
    }
    ht_rows = {
        feature_id: count
        for feature_id, count in sorted(support.items())
        if feature_id.startswith("HT|")
        and {"张昭", "陆逊"}.issubset(feature_id.split("|")[1:])
    }
    named = (
        "HP|张昭|陆逊",
        "HS|张昭|烈火张天",
        "THS|陆逊|烈火张天",
        "THS|张昭|烈火张天",
    )
    return {
        "observed_team_counts_full_corpus": {
            "张昭_carried_烈火张天": carried,
            "those_teams_also_containing_陆逊": carried_with_lu_xun,
            "additional_张昭_陆逊_teams_with_烈火张天_on_another_hero": teammate_carried,
        },
        "final_training_support": {
            feature_id: support.get(feature_id, 0) for feature_id in named
        },
        "tsp_involving_烈火张天": tsp_rows,
        "ht_containing_张昭_and_陆逊": ht_rows,
        "interpretation": (
            "These observational co-occurrences support team-context modeling "
            "but do not establish that 张昭, 陆逊, or any carrier causally requires 烈火张天."
        ),
    }


def _mechanic_training_coverage(
    training_battles: Sequence[Battle],
    default_skill: Mapping[str, str],
    mechanics: MechanicsContract,
) -> dict[str, Any]:
    """Compare certainty-mode coverage using original training rows only."""
    coverage: dict[str, Any] = {}
    for certainty_mode in MECH_CERTAINTY_CANDIDATES:
        support = compute_support(
            list(training_battles),
            default_skill,
            mechanics=mechanics,
            mech_certainty_mode=certainty_mode,
        )
        mechanic_support = {
            feature_id: count
            for feature_id, count in sorted(support.items())
            if feature_id.startswith(f"{F_MECHANIC}|")
        }
        pair_counts = compute_mechanic_witness_pair_counts(
            training_battles,
            default_skill,
            mechanics,
            certainty_mode=certainty_mode,
        )
        activated_teams = 0
        activated_battles = 0
        for battle in training_battles:
            team_flags = [
                bool(
                    mechanic_feature_witnesses(
                        team,
                        default_skill,
                        mechanics,
                        certainty_mode=certainty_mode,
                    )
                )
                for team in (battle.team1, battle.team2)
            ]
            activated_teams += sum(team_flags)
            activated_battles += any(team_flags)
        coverage[certainty_mode] = {
            "emitted_feature_count": len(mechanic_support),
            "activated_training_battles": activated_battles,
            "activated_training_teams": activated_teams,
            "features": {
                feature_id: {
                    "training_battle_support": count,
                    "distinct_ordered_skill_pair_count": len(
                        pair_counts.get(feature_id, {})
                    ),
                }
                for feature_id, count in mechanic_support.items()
            },
        }
    return coverage


def _fire_mechanic_audit(
    battles: Sequence[Battle],
    default_skill: Mapping[str, str],
    mechanics: MechanicsContract,
) -> dict[str, Any]:
    """Audit the motivating 火攻 relationship without causal interpretation."""
    fire_mechanic = "debuff:huo_gong"
    fire_feature = mechanic_id(fire_mechanic, "benefits_from", "enemy")
    if (
        default_skill.get("陆逊") != "火烧连营"
        or "火烧连营" not in mechanics.skill_relationships
        or "烈火张天" not in mechanics.skill_relationships
    ):
        return {
            "feature_id": fire_feature,
            "status": "unavailable_in_synthetic_contract",
            "interpretation": "The motivating fire audit requires the production catalog.",
        }

    def matching_relationships(skill_name: str, relation_name: str) -> list[dict[str, str]]:
        return [
            {
                "relation": relation.relation,
                "mechanic": relation.mechanic,
                "subject": relation.subject,
                "certainty": relation.certainty,
            }
            for relation in mechanics.skill_relationships[skill_name]
            if relation.relation == relation_name
            and relation.mechanic == fire_mechanic
        ]

    carrier_counts: dict[str, dict[str, int]] = {}
    lu_xun_liehuo_teams = 0
    lu_xun_liehuo_activated = 0
    zhang_without_consumer_teams = 0
    zhang_without_consumer_activated = 0
    lu_xun_without_distinct_provider_teams = 0
    lu_xun_without_distinct_provider_activated = 0
    example: dict[str, Any] | None = None

    for battle in battles:
        for team_number, team in enumerate((battle.team1, battle.team2), start=1):
            heroes = {str(hero.get("name", "")) for hero in team}
            instances = active_mechanic_skill_instances(
                team,
                default_skill,
                mechanics,
            )
            witnesses = mechanic_feature_witnesses(
                team,
                default_skill,
                mechanics,
                certainty_mode="explicit_only",
            )
            feature_witnesses = witnesses.get(fire_feature, ())
            activated = bool(feature_witnesses)
            liehuo_instances = [
                instance
                for instance in instances
                if instance.skill_name == "烈火张天"
                and instance.origin == "equipped"
            ]
            if "陆逊" in heroes and liehuo_instances:
                lu_xun_liehuo_teams += 1
                lu_xun_liehuo_activated += activated
                for carrier in sorted(
                    {instance.carrier for instance in liehuo_instances}
                ):
                    row = carrier_counts.setdefault(
                        carrier,
                        {"observed_teams": 0, "activated_teams": 0},
                    )
                    row["observed_teams"] += 1
                    row["activated_teams"] += activated
                if example is None and activated:
                    example = {
                        "battle": battle.filename,
                        "team": team_number,
                        "witnesses": [
                            {
                                "provider_skill": witness.provider_skill,
                                "provider_carrier": witness.provider_carrier,
                                "provider_origin": witness.provider_origin,
                                "provider_slot_index": witness.provider_slot_index,
                                "consumer_skill": witness.consumer_skill,
                                "consumer_carrier": witness.consumer_carrier,
                                "consumer_origin": witness.consumer_origin,
                                "consumer_slot_index": witness.consumer_slot_index,
                            }
                            for witness in feature_witnesses
                            if witness.provider_skill == "烈火张天"
                            and witness.consumer_skill == "火烧连营"
                        ],
                    }

            fire_consumers = [
                instance
                for instance in instances
                if any(
                    relation.relation in ("benefits_from", "requires", "consumes")
                    and relation.mechanic == fire_mechanic
                    and relation.certainty == "explicit"
                    for relation in mechanics.skill_relationships[
                        instance.skill_name
                    ]
                )
            ]
            if (
                "张昭" in heroes
                and "陆逊" not in heroes
                and liehuo_instances
                and not fire_consumers
            ):
                zhang_without_consumer_teams += 1
                zhang_without_consumer_activated += activated

            if "陆逊" in heroes:
                lu_xun_signature = next(
                    (
                        instance
                        for instance in instances
                        if instance.carrier == "陆逊"
                        and instance.skill_name == "火烧连营"
                        and instance.origin == "signature"
                    ),
                    None,
                )
                distinct_fire_providers = [
                    instance
                    for instance in instances
                    if (
                        lu_xun_signature is None
                        or (
                            instance.carrier,
                            instance.slot_index,
                        ) != (
                            lu_xun_signature.carrier,
                            lu_xun_signature.slot_index,
                        )
                    )
                    and any(
                        relation.relation == "provides"
                        and relation.mechanic == fire_mechanic
                        and relation.certainty == "explicit"
                        for relation in mechanics.skill_relationships[
                            instance.skill_name
                        ]
                    )
                ]
                if lu_xun_signature is not None and not distinct_fire_providers:
                    lu_xun_without_distinct_provider_teams += 1
                    lu_xun_without_distinct_provider_activated += activated

    return {
        "feature_id": fire_feature,
        "contract_chain": {
            "陆逊_canonical_signature": default_skill.get("陆逊"),
            "烈火张天_provider_relationships": matching_relationships(
                "烈火张天", "provides"
            ),
            "火烧连营_consumer_relationships": matching_relationships(
                "火烧连营", "benefits_from"
            ),
            "activates_expected_feature": (
                default_skill.get("陆逊") == "火烧连营"
                and bool(matching_relationships("烈火张天", "provides"))
                and bool(matching_relationships("火烧连营", "benefits_from"))
            ),
        },
        "observational_counts_full_corpus": {
            "陆逊_plus_烈火张天": {
                "observed_teams": lu_xun_liehuo_teams,
                "activated_teams": lu_xun_liehuo_activated,
                "by_烈火张天_carrier": {
                    carrier: carrier_counts[carrier]
                    for carrier in sorted(carrier_counts)
                },
            },
            "张昭_plus_烈火张天_without_陆逊_or_other_fire_consumer": {
                "observed_teams": zhang_without_consumer_teams,
                "activated_teams": zhang_without_consumer_activated,
            },
            "陆逊_without_distinct_fire_provider": {
                "observed_teams": lu_xun_without_distinct_provider_teams,
                "activated_teams": lu_xun_without_distinct_provider_activated,
            },
        },
        "first_observed_陆逊_烈火张天_witness": example,
        "interpretation": (
            "MECH attributes the indirect team relationship through 陆逊's "
            "canonical 火烧连营 signature. It does not claim 张昭 personally "
            "requires 烈火张天, and the fitted coefficient is an observational "
            "residual association rather than causal proof or a hard rule."
        ),
    }


def evaluate_protocol(
    battles: Sequence[Battle],
    default_skill: Mapping[str, str],
    catalog_seasons: _CatalogSeasons,
    locked_test_manifest: Mapping[str, Any],
    *,
    relationships: CatalogRelationships | None = None,
    mechanics: MechanicsContract | None = None,
    catalog_version: str,
    c_candidates: Sequence[float] = C_CANDIDATES,
    single_support_candidates: Sequence[int] = SINGLE_SUPPORT_CANDIDATES,
    pair_support_candidates: Sequence[int] = PAIR_SUPPORT_CANDIDATES,
    mech_certainty_candidates: Sequence[str] = MECH_CERTAINTY_CANDIDATES,
    mech_support_candidates: Sequence[int] = MECH_SUPPORT_CANDIDATES,
    mech_shrinkage_candidates: Sequence[float] = MECH_SHRINKAGE_CANDIDATES,
    selection_prior_hero_strength_candidates: Sequence[float] = (
        SELECTION_PRIOR_HERO_STRENGTH_CANDIDATES
    ),
    selection_prior_skill_strength_candidates: Sequence[float] = (
        SELECTION_PRIOR_SKILL_STRENGTH_CANDIDATES
    ),
    selection_prior_hero_pair_strength_candidates: Sequence[float] = (
        SELECTION_PRIOR_HERO_PAIR_STRENGTH_CANDIDATES
    ),
    selection_prior_hero_skill_strength_candidates: Sequence[float] = (
        SELECTION_PRIOR_HERO_SKILL_STRENGTH_CANDIDATES
    ),
    selection_prior_smoothing_candidates: Sequence[float] = (
        SELECTION_PRIOR_SMOOTHING_CANDIDATES
    ),
    selection_prior_log_ratio_clip_candidates: Sequence[float] = (
        SELECTION_PRIOR_LOG_RATIO_CLIP_CANDIDATES
    ),
    bootstrap_samples: int = BOOTSTRAP_SAMPLES,
) -> dict[str, Any]:
    """Tune on train/development groups and score the locked test once."""
    if not isinstance(catalog_version, str) or not catalog_version:
        raise ValueError("catalog_version must be a non-empty string")
    split = build_grouped_split(battles, locked_test_manifest)
    group_ids = split.group_ids

    cache: dict[EvaluationConfig, PredictionRows] = {}

    def development_rows(config: EvaluationConfig) -> PredictionRows:
        rows = cache.get(config)
        if rows is None:
            rows = _fit_and_predict(
                config,
                split.train_indices,
                split.development_indices,
                battles,
                group_ids,
                default_skill,
                catalog_seasons,
                relationships,
                mechanics,
            )
            cache[config] = rows
        return rows

    c_configs = [
        EvaluationConfig(c=candidate)
        for candidate in sorted(set(c_candidates))
    ]
    best_c_config = min(
        c_configs,
        key=lambda config: _selection_sort_key(
            config,
            development_rows(config),
        ),
    )
    support_configs = [
        EvaluationConfig(
            c=best_c_config.c,
            min_support_single=single,
            min_support_pair=pair,
        )
        for single in sorted(set(single_support_candidates))
        for pair in sorted(set(pair_support_candidates))
    ]
    best_support_config = min(
        support_configs,
        key=lambda config: _selection_sort_key(
            config,
            development_rows(config),
        ),
    )
    sp_configs = [
        replace(best_support_config, include_sp=include_sp)
        for include_sp in (True, False)
    ]
    best_structural_config = min(
        sp_configs,
        key=lambda config: _selection_sort_key(
            config,
            development_rows(config),
        ),
    )
    hero_strengths = sorted({
        *selection_prior_hero_strength_candidates,
        0.0,
        SELECTION_PRIOR_HERO_STRENGTH,
    })
    skill_strengths = sorted({
        *selection_prior_skill_strength_candidates,
        0.0,
        SELECTION_PRIOR_SKILL_STRENGTH,
    })
    hero_pair_strengths = sorted({
        *selection_prior_hero_pair_strength_candidates,
        0.0,
        SELECTION_PRIOR_HERO_PAIR_STRENGTH,
    })
    hero_skill_strengths = sorted({
        *selection_prior_hero_skill_strength_candidates,
        0.0,
        SELECTION_PRIOR_HERO_SKILL_STRENGTH,
    })
    smoothing_candidates = sorted({
        *selection_prior_smoothing_candidates,
        SELECTION_PRIOR_SMOOTHING,
    })
    clip_candidates = sorted({
        *selection_prior_log_ratio_clip_candidates,
        SELECTION_PRIOR_LOG_RATIO_CLIP,
    })
    strength_configs = [
        replace(
            best_structural_config,
            selection_prior_hero_strength=hero_strength,
            selection_prior_skill_strength=skill_strength,
        )
        for hero_strength in hero_strengths
        for skill_strength in skill_strengths
    ]
    best_strength_config = min(
        strength_configs,
        key=lambda config: _selection_sort_key(
            config,
            development_rows(config),
        ),
    )
    # H/S behavior is fixed for the HP/HS decision. Compare relationship
    # strengths against the reviewed production atomic prior rather than the
    # independently reported H/S tuning winner.
    relationship_strength_base_config = replace(
        best_structural_config,
        selection_prior_hero_strength=SELECTION_PRIOR_HERO_STRENGTH,
        selection_prior_skill_strength=SELECTION_PRIOR_SKILL_STRENGTH,
        selection_prior_hero_pair_strength=0.0,
        selection_prior_hero_skill_strength=0.0,
        selection_prior_smoothing=SELECTION_PRIOR_SMOOTHING,
        selection_prior_log_ratio_clip=SELECTION_PRIOR_LOG_RATIO_CLIP,
    )
    relationship_strength_configs = [
        replace(
            relationship_strength_base_config,
            selection_prior_hero_pair_strength=hero_pair_strength,
            selection_prior_hero_skill_strength=hero_skill_strength,
        )
        for hero_pair_strength in hero_pair_strengths
        for hero_skill_strength in hero_skill_strengths
    ]
    best_relationship_strength_config = min(
        relationship_strength_configs,
        key=lambda config: _selection_sort_key(
            config,
            development_rows(config),
        ),
    )
    shape_configs = [
        replace(
            best_relationship_strength_config,
            selection_prior_smoothing=smoothing,
            selection_prior_log_ratio_clip=log_ratio_clip,
        )
        for smoothing in smoothing_candidates
        for log_ratio_clip in clip_candidates
    ]
    prior_selected_config = min(
        shape_configs,
        key=lambda config: _selection_sort_key(
            config,
            development_rows(config),
        ),
    )
    no_prior_config = replace(
        best_structural_config,
        selection_prior_hero_strength=0.0,
        selection_prior_skill_strength=0.0,
        selection_prior_hero_pair_strength=0.0,
        selection_prior_hero_skill_strength=0.0,
    )
    atomic_only_prior_config = relationship_strength_base_config
    production_prior_config = replace(
        best_structural_config,
        selection_prior_hero_strength=SELECTION_PRIOR_HERO_STRENGTH,
        selection_prior_skill_strength=SELECTION_PRIOR_SKILL_STRENGTH,
        selection_prior_hero_pair_strength=SELECTION_PRIOR_HERO_PAIR_STRENGTH,
        selection_prior_hero_skill_strength=SELECTION_PRIOR_HERO_SKILL_STRENGTH,
        selection_prior_smoothing=SELECTION_PRIOR_SMOOTHING,
        selection_prior_log_ratio_clip=SELECTION_PRIOR_LOG_RATIO_CLIP,
    )

    # Staged context ablation. Each stage varies one bounded family/support
    # decision on development rows only; the locked test is not touched until
    # every stage, including the historical PR-A MECH grid, has been selected.
    pre_context_baseline_config = EvaluationConfig(
        include_ths_tsp=False,
        include_hc_b=False,
        include_mech=False,
        include_ht=False,
        include_ts3=False,
    )
    context_configs = [
        replace(
            pre_context_baseline_config,
            include_ths_tsp=True,
            min_support_team_context=support_floor,
            team_context_shrinkage=shrinkage,
        )
        for support_floor in TEAM_CONTEXT_SUPPORT_CANDIDATES
        for shrinkage in TEAM_CONTEXT_SHRINKAGE_CANDIDATES
    ]
    best_context_config = min(
        context_configs,
        key=lambda config: _selection_sort_key(config, development_rows(config)),
    )
    relationship_configs = [
        replace(
            best_context_config,
            include_hc_b=True,
            min_support_relationship=support_floor,
        )
        for support_floor in RELATIONSHIP_SUPPORT_CANDIDATES
    ]
    best_relationship_config = min(
        relationship_configs,
        key=lambda config: _selection_sort_key(config, development_rows(config)),
    )
    mech_enabled_configs = [
        replace(
            best_relationship_config,
            include_mech=True,
            mech_certainty_mode=certainty_mode,
            min_support_mechanic=support_floor,
            mechanic_shrinkage=shrinkage,
            min_mechanic_pair_diversity=MIN_MECHANIC_PAIR_DIVERSITY,
        )
        for certainty_mode in sorted(set(mech_certainty_candidates))
        for support_floor in sorted(set(mech_support_candidates))
        for shrinkage in sorted(set(mech_shrinkage_candidates))
    ] if mechanics is not None else []
    best_enabled_mech_config = (
        min(
            mech_enabled_configs,
            key=lambda config: _selection_sort_key(
                config,
                development_rows(config),
            ),
        )
        if mech_enabled_configs
        else None
    )
    best_mech_config = (
        _select_calibrated_optional_config(
            best_relationship_config,
            mech_enabled_configs,
            development_rows,
        )
        if mech_enabled_configs
        else best_relationship_config
    )
    ht_enabled_configs = [
        replace(
            best_mech_config,
            include_ht=True,
            min_support_high_order=support_floor,
        )
        for support_floor in HERO_TRIO_SUPPORT_CANDIDATES
    ]
    best_ht_config = _select_calibrated_optional_config(
        best_mech_config,
        ht_enabled_configs,
        development_rows,
    )
    ts3_enabled_configs = [
        replace(
            best_ht_config,
            include_ts3=True,
            min_support_high_order=support_floor,
        )
        for support_floor in TEAM_SKILL_TRIO_SUPPORT_CANDIDATES
    ]
    selected_config = _select_calibrated_optional_config(
        best_ht_config,
        ts3_enabled_configs,
        development_rows,
    )

    final_train_indices = tuple(
        sorted((*split.train_indices, *split.development_indices))
    )
    # The locked comparison is final selected versus the actual reviewed
    # production configuration. After PR B both should agree on M settings.
    production_config = EvaluationConfig()
    selected_test = _fit_and_predict(
        selected_config,
        final_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        relationships,
        mechanics,
        test_group_ids=split.test_group_ids,
        mechanic_selection_indices=split.train_indices,
    )
    production_test = _fit_and_predict(
        production_config,
        final_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        relationships,
        mechanics,
        test_group_ids=split.test_group_ids,
        mechanic_selection_indices=split.train_indices,
    )

    pre_yanwu_train_indices = tuple(
        index
        for index in final_train_indices
        if battles[index].source != SOURCE_EXTERNAL_YANWU
    )
    pre_yanwu_mechanic_selection_indices = tuple(
        index
        for index in split.train_indices
        if battles[index].source != SOURCE_EXTERNAL_YANWU
    )
    controlled_baseline = _fit_and_predict(
        production_config,
        pre_yanwu_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        relationships,
        mechanics,
        test_group_ids=split.test_group_ids,
        mechanic_selection_indices=pre_yanwu_mechanic_selection_indices,
    )
    controlled_candidate = production_test
    controlled_delta = _paired_delta_report(
        controlled_candidate,
        controlled_baseline,
        bootstrap_samples=bootstrap_samples,
    )

    source_counts = Counter(battle.source for battle in battles)
    known_season_counts = Counter(
        int(battle.season)
        for battle in battles
        if battle.season is not None
    )
    development_report = _full_report(
        development_rows(selected_config),
        bootstrap_samples=bootstrap_samples,
    )
    development_report["status"] = "post_selection_apparent_not_confirmatory"
    development_report["note"] = (
        "the candidate was selected on these development groups; the locked "
        "test below was not used for selection"
    )

    no_prior_rows = development_rows(no_prior_config)
    atomic_only_prior_rows = development_rows(atomic_only_prior_config)
    production_prior_rows = development_rows(production_prior_config)
    training_battles = [battles[index] for index in split.train_indices]
    if mechanics is None or best_enabled_mech_config is None:
        mechanic_report: dict[str, Any] = {
            "decision": "disabled_no_validated_mechanics_contract",
            "selected_configuration": None,
            "candidates": [],
        }
    else:
        baseline_mech_rows = development_rows(best_relationship_config)
        best_enabled_mech_rows = development_rows(best_enabled_mech_config)
        selected_mech_rows = development_rows(best_mech_config)
        mechanic_report = {
            "decision": (
                "enabled_by_development_calibration_gate"
                if best_mech_config.include_mech
                else "disabled_by_development_calibration_gate"
            ),
            "gate": (
                "MECH may be enabled only when both development log loss and "
                "Brier score improve; accuracy is descriptive only"
            ),
            "catalog_sha256": mechanics.catalog_sha256,
            "selected_configuration": (
                {
                    "certainty_mode": best_mech_config.mech_certainty_mode,
                    "min_support_mechanic": best_mech_config.min_support_mechanic,
                    "mechanic_shrinkage": best_mech_config.mechanic_shrinkage,
                    "min_mechanic_pair_diversity": (
                        best_mech_config.min_mechanic_pair_diversity
                    ),
                }
                if best_mech_config.include_mech
                else None
            ),
            "best_enabled_configuration": {
                "certainty_mode": best_enabled_mech_config.mech_certainty_mode,
                "min_support_mechanic": (
                    best_enabled_mech_config.min_support_mechanic
                ),
                "mechanic_shrinkage": (
                    best_enabled_mech_config.mechanic_shrinkage
                ),
                "min_mechanic_pair_diversity": (
                    best_enabled_mech_config.min_mechanic_pair_diversity
                ),
            },
            "baseline_development": _selection_summary(
                best_relationship_config,
                baseline_mech_rows,
            ),
            "selected_development": _selection_summary(
                best_mech_config,
                selected_mech_rows,
            ),
            "selected_minus_baseline_development": _paired_delta_report(
                selected_mech_rows,
                baseline_mech_rows,
                bootstrap_samples=bootstrap_samples,
            ),
            "best_enabled_minus_baseline_development": _paired_delta_report(
                best_enabled_mech_rows,
                baseline_mech_rows,
                bootstrap_samples=bootstrap_samples,
            ),
            "candidates": [
                {
                    "certainty_mode": config.mech_certainty_mode,
                    "min_support_mechanic": config.min_support_mechanic,
                    "mechanic_shrinkage": config.mechanic_shrinkage,
                    "min_mechanic_pair_diversity": (
                        config.min_mechanic_pair_diversity
                    ),
                    "development": _selection_summary(
                        config,
                        development_rows(config),
                    ),
                    "feature_counts": {
                        key: value
                        for key, value in development_rows(
                            config
                        ).mechanic_diagnostics.items()
                        if key != "features"
                    },
                }
                for config in mech_enabled_configs
            ],
            "training_only_certainty_coverage": _mechanic_training_coverage(
                training_battles,
                default_skill,
                mechanics,
            ),
            "best_enabled_feature_diagnostics": (
                best_enabled_mech_rows.mechanic_diagnostics
            ),
            "final_selected_development_feature_diagnostics": (
                development_rows(selected_config).mechanic_diagnostics
            ),
            "final_refit_feature_diagnostics": (
                selected_test.mechanic_diagnostics
            ),
            "火攻_audit": _fire_mechanic_audit(
                battles,
                default_skill,
                mechanics,
            ),
            "interpretation": (
                "A positive M coefficient is an average residual observational "
                "association after existing identity features. It is not causal "
                "proof and is not a hard recommendation rule."
            ),
        }
    report = {
        "protocol": {
            "version": EVALUATION_PROTOCOL_VERSION,
            "name": "grouped-stable-hash-locked-holdout",
            "locked_test_population": "pre-Yanwu corpus only",
            "locked_test_fraction": LOCKED_TEST_FRACTION,
            "development_fraction": DEVELOPMENT_FRACTION,
            "locked_test_seed": LOCKED_TEST_SEED,
            "development_seed": DEVELOPMENT_SEED,
            "locked_test_group_set_hash": split.locked_test_group_set_hash,
            "locked_test_lock": "persisted source-qualified battle identities",
            "locked_test_selection_source_battles": locked_test_manifest[
                "source_battle_count"
            ],
            "locked_test_selection_source_groups": locked_test_manifest[
                "source_group_count"
            ],
            "split_unit": (
                "capture/upload sessions and stable external report identities, "
                "merged through exact/near-duplicate matchup clusters"
            ),
            "split_membership_excludes": ["season", "winner", "outcome"],
            "selection_data": (
                "configuration choice uses development metrics; feature support, "
                "MECH pair diversity, and witness ranking use training rows only"
            ),
            "locked_test_use": "one final evaluation after configuration selection",
            "session_gap_seconds": SESSION_GAP_SECONDS,
            "calendar_day_grouping": False,
            "external_initial_group": "stable report identity",
            "near_duplicate_max_skill_replacements": (
                NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS
            ),
            "source_categories": list(SOURCE_CATEGORIES),
            "confidence_intervals": (
                "deterministic 95% percentile bootstrap over whole locked-test "
                "leakage groups; intervals are omitted below five groups and "
                "marked exploratory below twenty"
            ),
            "selection_count_prior_exposure": (
                "H/S catalog exposure and HP/HS marginal co-selection expectations "
                "are computed from known-season training rows only; HP uses "
                "2*hA*hB/(3*N concrete teams), HS uses hHero*sSkill/(3*N), and "
                "unknown-season rows train the logistic outcome model but cannot "
                "affect either appearance calculation"
            ),
        },
        "corpus": {
            "corpus_version": compute_corpus_version(list(battles)),
            "evaluation_version": compute_evaluation_version(list(battles)),
            "catalog_version": catalog_version,
            "relationship_version": (
                relationships.relationship_version if relationships is not None else None
            ),
            "mech_catalog_sha256_evaluation_only": (
                mechanics.catalog_sha256 if mechanics is not None else None
            ),
            "n_battles": len(battles),
            "n_groups": len(set(group_ids)),
            "unknown_season_battles": sum(
                battle.season is None for battle in battles
            ),
            "known_season_counts_descriptive_only": {
                str(season): known_season_counts[season]
                for season in sorted(known_season_counts)
            },
            "by_source": {
                source: source_counts.get(source, 0)
                for source in SOURCE_CATEGORIES
            },
        },
        "split_balance": {
            "train": _split_balance(
                battles,
                split.train_indices,
                group_ids,
            ),
            "development": _split_balance(
                battles,
                split.development_indices,
                group_ids,
            ),
            "locked_test": _split_balance(
                battles,
                split.test_indices,
                group_ids,
            ),
            "excluded_test_duplicate_groups": _split_balance(
                battles,
                split.excluded_indices,
                group_ids,
            ),
        },
        "production_model": {
            "changed": EvaluationConfig().as_dict() != production_config.as_dict(),
            "current_production_config": production_config.as_dict(),
            "reviewed_code_config": EvaluationConfig().as_dict(),
            "development_selected_config": selected_config.as_dict(),
            "atomic_support_buckets": production_test.atomic_diagnostics,
            "relationship_appearance_support_buckets": (
                production_test.relationship_diagnostics
            ),
            "note": (
                "development selection is reported for review and never writes "
                "builder settings; the production subset is the explicit constants "
                "visible in build_recommendation_data.py"
            ),
        },
        "tuning": {
            "selection_metric": (
                "development log loss, then Brier, accuracy, and deterministic "
                "simplicity"
            ),
            "regularization": {
                "selected_C": best_c_config.c,
                "candidates": [
                    _selection_summary(config, development_rows(config))
                    for config in sorted(
                        c_configs,
                        key=lambda config: _selection_sort_key(
                            config,
                            development_rows(config),
                        ),
                    )
                ],
            },
            "support": {
                "selected": {
                    "min_support_single": best_support_config.min_support_single,
                    "min_support_pair": best_support_config.min_support_pair,
                },
                "candidates": [
                    _selection_summary(config, development_rows(config))
                    for config in sorted(
                        support_configs,
                        key=lambda config: _selection_sort_key(
                            config,
                            development_rows(config),
                        ),
                    )
                ],
            },
        },
        "experiments": {
            "selected_candidate": selected_config.as_dict(),
            "staged_team_context_ablations": {
                "selection_data": "development rows only",
                "stage_1_pre_context_baseline": _selection_summary(
                    pre_context_baseline_config,
                    development_rows(pre_context_baseline_config),
                ),
                "stage_2_plus_ths_tsp": {
                    "selected": _selection_summary(
                        best_context_config,
                        development_rows(best_context_config),
                    ),
                    "candidates": [
                        _selection_summary(config, development_rows(config))
                        for config in context_configs
                    ],
                    "selected_minus_previous": _paired_delta_report(
                        development_rows(best_context_config),
                        development_rows(pre_context_baseline_config),
                        bootstrap_samples=bootstrap_samples,
                    ),
                },
                "stage_3_plus_hc_b": {
                    "selected": _selection_summary(
                        best_relationship_config,
                        development_rows(best_relationship_config),
                    ),
                    "candidates": [
                        _selection_summary(config, development_rows(config))
                        for config in relationship_configs
                    ],
                    "selected_minus_previous": _paired_delta_report(
                        development_rows(best_relationship_config),
                        development_rows(best_context_config),
                        bootstrap_samples=bootstrap_samples,
                    ),
                },
                "stage_4_mech": {
                    "selected": _selection_summary(
                        best_mech_config,
                        development_rows(best_mech_config),
                    ),
                    "disabled": _selection_summary(
                        best_relationship_config,
                        development_rows(best_relationship_config),
                    ),
                    "enabled_candidates": [
                        _selection_summary(config, development_rows(config))
                        for config in mech_enabled_configs
                    ],
                    "selected_minus_previous": _paired_delta_report(
                        development_rows(best_mech_config),
                        development_rows(best_relationship_config),
                        bootstrap_samples=bootstrap_samples,
                    ),
                },
                "stage_5_ht": {
                    "selected": _selection_summary(
                        best_ht_config,
                        development_rows(best_ht_config),
                    ),
                    "disabled": _selection_summary(
                        best_mech_config,
                        development_rows(best_mech_config),
                    ),
                    "enabled_candidates": [
                        _selection_summary(config, development_rows(config))
                        for config in ht_enabled_configs
                    ],
                    "selected_minus_previous": _paired_delta_report(
                        development_rows(best_ht_config),
                        development_rows(best_mech_config),
                        bootstrap_samples=bootstrap_samples,
                    ),
                },
                "stage_6_ts3": {
                    "selected": _selection_summary(
                        selected_config,
                        development_rows(selected_config),
                    ),
                    "disabled": _selection_summary(
                        best_ht_config,
                        development_rows(best_ht_config),
                    ),
                    "enabled_candidates": [
                        _selection_summary(config, development_rows(config))
                        for config in ts3_enabled_configs
                    ],
                    "selected_minus_previous": _paired_delta_report(
                        development_rows(selected_config),
                        development_rows(best_ht_config),
                        bootstrap_samples=bootstrap_samples,
                    ),
                },
                "higher_order_policy": (
                    "HT/TS3 use a separate support floor and coefficient multiplier "
                    f"{HIGH_ORDER_SHRINKAGE}; TS3 additionally requires every "
                    "constituent TSP pair to clear the team-context support floor"
                ),
            },
            "sp_ablation": {
                "enabled": _selection_summary(
                    sp_configs[0],
                    development_rows(sp_configs[0]),
                ),
                "disabled": _selection_summary(
                    sp_configs[1],
                    development_rows(sp_configs[1]),
                ),
                "disabled_minus_enabled": _paired_delta_report(
                    development_rows(sp_configs[1]),
                    development_rows(sp_configs[0]),
                    bootstrap_samples=bootstrap_samples,
                ),
            },
            "selection_count_prior": {
                "selected": prior_selected_config.as_dict(),
                "atomic_strength_candidates": [
                    _selection_summary(config, development_rows(config))
                    for config in sorted(
                        strength_configs,
                        key=lambda config: _selection_sort_key(
                            config,
                            development_rows(config),
                        ),
                    )
                ],
                "relationship_strength_candidates": [
                    _selection_summary(config, development_rows(config))
                    for config in sorted(
                        relationship_strength_configs,
                        key=lambda config: _selection_sort_key(
                            config,
                            development_rows(config),
                        ),
                    )
                ],
                "shape_candidates": [
                    _selection_summary(config, development_rows(config))
                    for config in sorted(
                        shape_configs,
                        key=lambda config: _selection_sort_key(
                            config,
                            development_rows(config),
                        ),
                    )
                ],
                "none": _selection_summary(no_prior_config, no_prior_rows),
                "atomic_only_production_baseline": _selection_summary(
                    atomic_only_prior_config,
                    atomic_only_prior_rows,
                ),
                "production": _selection_summary(
                    production_prior_config,
                    production_prior_rows,
                ),
                "production_minus_none": _paired_delta_report(
                    production_prior_rows,
                    no_prior_rows,
                    bootstrap_samples=bootstrap_samples,
                ),
                "production_relationship_lift_minus_atomic_only": (
                    _paired_delta_report(
                        production_prior_rows,
                        atomic_only_prior_rows,
                        bootstrap_samples=bootstrap_samples,
                    )
                ),
            },
        },
        "mechanic_evaluation": mechanic_report,
        "targeted_diagnostics": _targeted_context_diagnostics(
            battles,
            final_train_indices,
            default_skill,
            relationships,
        ),
        "development_validation": development_report,
        "locked_test": {
            "selected_candidate": {
                "config": selected_config.as_dict(),
                "metrics": _full_report(
                    selected_test,
                    bootstrap_samples=bootstrap_samples,
                ),
            },
            "current_production_configuration": {
                "config": production_config.as_dict(),
                "metrics": _full_report(
                    production_test,
                    bootstrap_samples=bootstrap_samples,
                ),
            },
            "candidate_minus_current": _paired_delta_report(
                selected_test,
                production_test,
                bootstrap_samples=bootstrap_samples,
            ),
        },
        "controlled_yanwu_comparison": {
            "config": production_config.as_dict(),
            "test_population": "identical locked pre-Yanwu test rows",
            "baseline_training": {
                "n_battles": len(pre_yanwu_train_indices),
                "n_groups": len({
                    group_ids[index] for index in pre_yanwu_train_indices
                }),
                "metrics": _full_report(
                    controlled_baseline,
                    bootstrap_samples=bootstrap_samples,
                ),
            },
            "candidate_training": {
                "n_battles": len(final_train_indices),
                "n_groups": len({
                    group_ids[index] for index in final_train_indices
                }),
                "yanwu_battles_added": sum(
                    battles[index].source == SOURCE_EXTERNAL_YANWU
                    for index in final_train_indices
                ),
                "yanwu_groups_added": len({
                    group_ids[index]
                    for index in final_train_indices
                    if battles[index].source == SOURCE_EXTERNAL_YANWU
                }),
                "metrics": _full_report(
                    controlled_candidate,
                    bootstrap_samples=bootstrap_samples,
                ),
            },
            "locked_test": {
                "n_battles": len(split.test_indices),
                "n_groups": len(set(split.test_group_ids)),
            },
            "removed_yanwu_test_duplicates": {
                "n_battles": split.removed_yanwu_battles,
                "n_groups": split.removed_yanwu_groups,
            },
            "candidate_minus_baseline": controlled_delta,
            "conclusion": _comparison_conclusion(controlled_delta),
        },
    }
    return report


def _write_json_atomic(path: str, value: dict[str, Any]) -> None:
    output_dir = os.path.dirname(os.path.abspath(path))
    os.makedirs(output_dir, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(
        dir=output_dir,
        prefix=".recommendation_evaluation.",
        suffix=".json.tmp",
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(
                value,
                handle,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
                allow_nan=False,
            )
            handle.write("\n")
        os.replace(temporary_path, path)
    except BaseException:
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
        raise


def _targets_production_artifact(path: str) -> bool:
    candidate = os.path.realpath(os.path.abspath(path))
    repository_root = os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    production = os.path.realpath(
        os.path.join(repository_root, PRODUCTION_ARTIFACT_PATH)
    )
    if candidate == production:
        return True
    try:
        return os.path.samefile(candidate, production)
    except FileNotFoundError:
        return False


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default="results_recommendation_evaluation.json",
    )
    parser.add_argument("--battles-dir", default="data/battles")
    parser.add_argument("--web-upload-dir", default="data/web-upload")
    parser.add_argument(
        "--web-upload-state",
        default="data/web_upload_state.json",
    )
    parser.add_argument(
        "--database",
        default="web/public/game-data/database.json",
    )
    parser.add_argument(
        "--mech-catalog",
        default="web/public/game-data/mech.json",
    )
    parser.add_argument(
        "--yanwu-manifest",
        type=Path,
        default=root / "data/external/yanwu-release.json",
    )
    parser.add_argument(
        "--locked-test-manifest",
        type=Path,
        default=root / LOCKED_TEST_MANIFEST_PATH,
    )
    parser.add_argument(
        "--yanwu-cache-dir",
        type=Path,
        default=root / ".cache/yanwu",
    )
    parser.add_argument("--yanwu-corpus", type=Path)
    parser.add_argument(
        "--bootstrap-samples",
        type=int,
        default=BOOTSTRAP_SAMPLES,
    )
    args = parser.parse_args(argv)

    try:
        if _targets_production_artifact(args.output):
            raise ValueError(
                "evaluation output must not target "
                f"{PRODUCTION_ARTIFACT_PATH}"
            )
        locked_test_manifest = load_locked_test_manifest(
            args.locked_test_manifest
        )
        manifest = load_manifest(args.yanwu_manifest)
        yanwu_corpus = args.yanwu_corpus or normalized_cache_path(
            manifest,
            args.yanwu_cache_dir,
        )
        (
            battles,
            catalog,
            catalog_seasons,
            relationships,
            mechanics,
        ) = _load_evaluation_corpus(
            args.battles_dir,
            args.web_upload_dir,
            args.web_upload_state,
            args.database,
            args.mech_catalog,
            str(yanwu_corpus),
            str(args.yanwu_manifest),
        )
        report = evaluate_protocol(
            battles,
            catalog["default_skill"],
            catalog_seasons,
            locked_test_manifest,
            relationships=relationships,
            mechanics=mechanics,
            catalog_version=catalog["catalog_version"],
            bootstrap_samples=args.bootstrap_samples,
        )
    except (InvalidBattleError, InvalidYanwuCorpus, ValueError) as exc:
        print(f"Evaluation failed: {exc}", file=sys.stderr)
        return 1

    _write_json_atomic(args.output, report)
    selected = report["experiments"]["selected_candidate"]
    development = report["development_validation"]
    locked = report["locked_test"]["selected_candidate"]["metrics"]
    controlled = report["controlled_yanwu_comparison"]
    print(
        f"✓ Wrote {args.output}: selected {selected}; "
        f"development logloss={development['log_loss']}, "
        f"locked accuracy={locked['accuracy']}, "
        f"controlled Yanwu conclusion={controlled['conclusion']}."
    )
    print("  Production weights were not changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
