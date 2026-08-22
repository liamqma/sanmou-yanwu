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
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

try:
    from build_recommendation_data import (
        F_SKILL_PAIR, F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR, F_HERO_TRIO,
        F_CAMP, F_BOND, F_MECH, F_HERO_MECH, F_TEAM_SKILL_TRIPLE,
        L2_C, MIN_SUPPORT_PAIR, MIN_SUPPORT_SINGLE,
        MIN_SUPPORT_CONTEXT, MIN_SUPPORT_HIGH_ORDER, PRODUCTION_ENABLED_FAMILIES,
        SELECTION_PRIOR_HERO_STRENGTH,
        SELECTION_PRIOR_LOG_RATIO_CLIP,
        SELECTION_PRIOR_SKILL_STRENGTH,
        SELECTION_PRIOR_SMOOTHING,
        Battle,
        InvalidBattleError,
        _CatalogSeasons,
        _load_catalog_context,
        _selection_prior_atomic_components,
        _sigmoid,
        build_design_matrix,
        compute_corpus_version,
        compute_evaluation_version,
        compute_support,
        fit_model,
        load_battles,
        load_yanwu_battles,
        select_features,
        validate_training_duplicate_policy,
    )
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
        F_SKILL_PAIR, F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR, F_HERO_TRIO,
        F_CAMP, F_BOND, F_MECH, F_HERO_MECH, F_TEAM_SKILL_TRIPLE,
        L2_C, MIN_SUPPORT_PAIR, MIN_SUPPORT_SINGLE,
        MIN_SUPPORT_CONTEXT, MIN_SUPPORT_HIGH_ORDER, PRODUCTION_ENABLED_FAMILIES,
        SELECTION_PRIOR_HERO_STRENGTH,
        SELECTION_PRIOR_LOG_RATIO_CLIP,
        SELECTION_PRIOR_SKILL_STRENGTH,
        SELECTION_PRIOR_SMOOTHING,
        Battle,
        InvalidBattleError,
        _CatalogSeasons,
        _load_catalog_context,
        _selection_prior_atomic_components,
        _sigmoid,
        build_design_matrix,
        compute_corpus_version,
        compute_evaluation_version,
        compute_support,
        fit_model,
        load_battles,
        load_yanwu_battles,
        select_features,
        validate_training_duplicate_policy,
    )
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
CONTEXT_SUPPORT_CANDIDATES = (8, 12, 20)
HIGH_ORDER_SUPPORT_CANDIDATES = (20, 50)
BASELINE_FAMILIES = ("H", "HP", "HS", "S", "SP")
SELECTION_PRIOR_HERO_STRENGTH_CANDIDATES = (0.0, 0.2, 0.4, 0.6)
SELECTION_PRIOR_SKILL_STRENGTH_CANDIDATES = (0.0, 0.1, 0.2, 0.3)
SELECTION_PRIOR_SMOOTHING_CANDIDATES = (5.0, 20.0, 50.0)
SELECTION_PRIOR_LOG_RATIO_CLIP_CANDIDATES = (1.0, 2.0, 3.0)
PRODUCTION_ARTIFACT_PATH = "web/src/recommendation_data.json"


@dataclass(frozen=True)
class EvaluationConfig:
    """One season-independent evaluation-only model configuration."""

    c: float = L2_C
    min_support_single: int = MIN_SUPPORT_SINGLE
    min_support_pair: int = MIN_SUPPORT_PAIR
    min_support_context: int = MIN_SUPPORT_CONTEXT
    min_support_high_order: int = MIN_SUPPORT_HIGH_ORDER
    families: tuple[str, ...] = tuple(sorted(PRODUCTION_ENABLED_FAMILIES))
    include_sp: bool = True
    selection_prior_hero_strength: float = SELECTION_PRIOR_HERO_STRENGTH
    selection_prior_skill_strength: float = SELECTION_PRIOR_SKILL_STRENGTH
    selection_prior_smoothing: float = SELECTION_PRIOR_SMOOTHING
    selection_prior_log_ratio_clip: float = SELECTION_PRIOR_LOG_RATIO_CLIP

    def __post_init__(self) -> None:
        if self.c <= 0:
            raise ValueError("C must be positive")
        if any(value < 1 for value in (
            self.min_support_single, self.min_support_pair,
            self.min_support_context, self.min_support_high_order,
        )):
            raise ValueError("support thresholds must be positive")
        if tuple(sorted(set(self.families))) != self.families:
            raise ValueError("evaluation families must be unique and sorted")
        for name, value in (
            ("hero strength", self.selection_prior_hero_strength),
            ("skill strength", self.selection_prior_skill_strength),
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
            "min_support_context": self.min_support_context,
            "min_support_high_order": self.min_support_high_order,
            "families": list(self.families),
            "include_sp": self.include_sp,
            "selection_prior_hero_strength": self.selection_prior_hero_strength,
            "selection_prior_skill_strength": self.selection_prior_skill_strength,
            "selection_prior_smoothing": self.selection_prior_smoothing,
            "selection_prior_log_ratio_clip": self.selection_prior_log_ratio_clip,
        }

    def selection_key(self) -> tuple[Any, ...]:
        return (
            0 if not self.include_sp else 1,
            -self.min_support_single,
            -self.min_support_pair,
            -self.min_support_context,
            -self.min_support_high_order,
            self.families,
            self.selection_prior_hero_strength,
            self.selection_prior_skill_strength,
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
    feature_diagnostics: dict[str, dict[str, float | int | bool]]


def _atomic_diagnostics(
    components: Mapping[str, Mapping[str, float | int]],
) -> dict[str, Any]:
    """Summarize sparse/count effects without relying on named-item fixtures."""
    buckets = (
        ("0-19", 0, 20),
        ("20-99", 20, 100),
        ("100-499", 100, 500),
        ("500+", 500, None),
    )
    result: dict[str, Any] = {}
    for family in ("H", "S"):
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


def _load_evaluation_corpus(
    battles_dir: str,
    web_upload_dir: str,
    web_upload_state_path: str,
    database_path: str,
    yanwu_corpus_path: str | None = None,
    yanwu_manifest_path: str = "data/external/yanwu-release.json",
    mechanics_registry_path: str | None = None,
) -> tuple[list[Battle], dict[str, Any], _CatalogSeasons]:
    catalog_context = _load_catalog_context(database_path, mechanics_registry_path)
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
    return battles, catalog_context.metadata, catalog_context.seasons


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
    feature_catalog: Mapping[str, Any],
    *,
    test_group_ids: Sequence[str] | None = None,
) -> PredictionRows:
    train = [battles[index] for index in train_indices]
    test = [battles[index] for index in test_indices]
    support = compute_support(
        train,
        default_skill,
        feature_catalog,
        enabled_families=config.families,
    )
    features = select_features(
        support,
        min_support_single=config.min_support_single,
        min_support_pair=config.min_support_pair,
        min_support_context=config.min_support_context,
        min_support_high_order=config.min_support_high_order,
        excluded_families=() if config.include_sp else (F_SKILL_PAIR,),
        enabled_families=config.families,
    )
    feature_index = {
        feature_id: index
        for index, feature_id in enumerate(features)
    }
    X_train, y_train = build_design_matrix(
        train, feature_index, default_skill, feature_catalog,
        enabled_families=config.families,
    )
    X_test, y_test = build_design_matrix(
        test, feature_index, default_skill, feature_catalog,
        enabled_families=config.families,
    )
    coef, intercept = fit_model(X_train, y_train, c=config.c)
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
    atomic_weights = {
        feature_id: float(component["final_weight"])
        for feature_id, component in atomic_components.items()
    }
    scoring_coef = coef.copy()
    for feature_id, column in feature_index.items():
        adjusted_weight = atomic_weights.get(feature_id)
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
            feature_catalog,
            enabled_families=config.families,
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
    baseline_probability = float(np.mean(y_train)) if len(y_train) else 0.5
    row_group_ids = (
        list(test_group_ids)
        if test_group_ids is not None
        else [group_ids[index] for index in test_indices]
    )
    if len(row_group_ids) != len(test):
        raise ValueError("test group IDs must match test rows")
    diagnostic_ids = (
        "HP|张昭|陆逊",
        "HS|张昭|烈火张天",
        "THS|陆逊|烈火张天",
        "MX|火攻",
        "HMX|陆逊|火攻",
    )
    feature_diagnostics = {
        feature_id: {
            "selected": feature_id in feature_index,
            "support": support.get(feature_id, 0),
            "coefficient": (
                round(float(scoring_coef[feature_index[feature_id]]), 6)
                if feature_id in feature_index else 0.0
            ),
        }
        for feature_id in diagnostic_ids
    }
    return PredictionRows(
        outcomes=y_test.astype(int).tolist(),
        probabilities=probabilities.astype(float).tolist(),
        baseline_probabilities=[baseline_probability] * len(test),
        group_ids=row_group_ids,
        sources=[battle.source for battle in test],
        n_features=len(features) + len(prior_only_weights),
        nonzero_rows=int(np.count_nonzero(nonzero_test_rows)),
        atomic_diagnostics=_atomic_diagnostics(atomic_components),
        feature_diagnostics=feature_diagnostics,
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


def evaluate_protocol(
    battles: Sequence[Battle],
    default_skill: Mapping[str, str],
    catalog_seasons: _CatalogSeasons,
    locked_test_manifest: Mapping[str, Any],
    *,
    catalog_version: str,
    feature_catalog: Mapping[str, Any] | None = None,
    c_candidates: Sequence[float] = C_CANDIDATES,
    single_support_candidates: Sequence[int] = SINGLE_SUPPORT_CANDIDATES,
    pair_support_candidates: Sequence[int] = PAIR_SUPPORT_CANDIDATES,
    selection_prior_hero_strength_candidates: Sequence[float] = (
        SELECTION_PRIOR_HERO_STRENGTH_CANDIDATES
    ),
    selection_prior_skill_strength_candidates: Sequence[float] = (
        SELECTION_PRIOR_SKILL_STRENGTH_CANDIDATES
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
    feature_catalog = feature_catalog or {}
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
                feature_catalog,
            )
            cache[config] = rows
        return rows

    c_configs = [
        EvaluationConfig(c=candidate, families=BASELINE_FAMILIES)
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
    baseline_structural_config = min(
        sp_configs,
        key=lambda config: _selection_sort_key(
            config,
            development_rows(config),
        ),
    )

    stage_specs = (
        ("1_legacy_identity_free_baseline", BASELINE_FAMILIES, (baseline_structural_config.min_support_context,), (baseline_structural_config.min_support_high_order,)),
        ("2_plus_THS_TSP", tuple(sorted((*BASELINE_FAMILIES, F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR))), CONTEXT_SUPPORT_CANDIDATES, (baseline_structural_config.min_support_high_order,)),
        ("3_plus_HC_B", tuple(sorted((*BASELINE_FAMILIES, F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR, F_CAMP, F_BOND))), CONTEXT_SUPPORT_CANDIDATES, (baseline_structural_config.min_support_high_order,)),
        ("4_plus_MX", tuple(sorted((*BASELINE_FAMILIES, F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR, F_CAMP, F_BOND, F_MECH))), CONTEXT_SUPPORT_CANDIDATES, (baseline_structural_config.min_support_high_order,)),
        ("5_plus_HMX", tuple(sorted((*BASELINE_FAMILIES, F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR, F_CAMP, F_BOND, F_MECH, F_HERO_MECH))), CONTEXT_SUPPORT_CANDIDATES, (baseline_structural_config.min_support_high_order,)),
        ("6_plus_HT", tuple(sorted((*BASELINE_FAMILIES, F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR, F_CAMP, F_BOND, F_MECH, F_HERO_MECH, F_HERO_TRIO))), CONTEXT_SUPPORT_CANDIDATES, HIGH_ORDER_SUPPORT_CANDIDATES),
        ("7_plus_TS3", tuple(sorted((*BASELINE_FAMILIES, F_TEAM_HERO_SKILL, F_TEAM_SKILL_PAIR, F_CAMP, F_BOND, F_MECH, F_HERO_MECH, F_HERO_TRIO, F_TEAM_SKILL_TRIPLE))), CONTEXT_SUPPORT_CANDIDATES, (50,)),
    )
    stage_candidates: dict[str, list[EvaluationConfig]] = {}
    stage_selected: dict[str, EvaluationConfig] = {}
    for name, families, context_floors, high_floors in stage_specs:
        candidates = [
            replace(
                baseline_structural_config,
                families=families,
                min_support_context=context_floor,
                min_support_high_order=high_floor,
            )
            for context_floor in context_floors
            for high_floor in high_floors
        ]
        stage_candidates[name] = candidates
        stage_selected[name] = min(
            candidates,
            key=lambda config: _selection_sort_key(config, development_rows(config)),
        )
    stage_order = [name for name, *_ in stage_specs]
    stage_deltas = {
        stage_order[index]: _paired_delta_report(
            development_rows(stage_selected[stage_order[index]]),
            development_rows(stage_selected[stage_order[index - 1]]),
            bootstrap_samples=bootstrap_samples,
        )
        for index in range(1, len(stage_order))
    }
    # TS3 has a mandatory floor of 50. If HT selected 20 in the preceding
    # stage, compare TS3 against the otherwise-identical HT-only floor-50
    # candidate so the reported delta never removes HT while adding TS3.
    ts3_config = stage_selected["7_plus_TS3"]
    ts3_baseline = next(
        config for config in stage_candidates["6_plus_HT"]
        if config.min_support_context == ts3_config.min_support_context
        and config.min_support_high_order == ts3_config.min_support_high_order
    )
    stage_deltas["7_plus_TS3"] = _paired_delta_report(
        development_rows(ts3_config),
        development_rows(ts3_baseline),
        bootstrap_samples=bootstrap_samples,
    )

    # Identity context is the reviewed production candidate; later semantic and
    # higher-order stages remain experiments unless their development evidence
    # and provider-held-out diagnostic justify promotion.
    best_structural_config = stage_selected["2_plus_THS_TSP"]
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
    shape_configs = [
        replace(
            best_strength_config,
            selection_prior_smoothing=smoothing,
            selection_prior_log_ratio_clip=log_ratio_clip,
        )
        for smoothing in smoothing_candidates
        for log_ratio_clip in clip_candidates
    ]
    selected_config = min(
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
    )
    production_prior_config = replace(
        best_structural_config,
        selection_prior_hero_strength=SELECTION_PRIOR_HERO_STRENGTH,
        selection_prior_skill_strength=SELECTION_PRIOR_SKILL_STRENGTH,
        selection_prior_smoothing=SELECTION_PRIOR_SMOOTHING,
        selection_prior_log_ratio_clip=SELECTION_PRIOR_LOG_RATIO_CLIP,
    )

    final_train_indices = tuple(
        sorted((*split.train_indices, *split.development_indices))
    )
    production_config = EvaluationConfig()
    selected_test = _fit_and_predict(
        selected_config,
        final_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        feature_catalog,
        test_group_ids=split.test_group_ids,
    )
    production_test = _fit_and_predict(
        production_config,
        final_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        feature_catalog,
        test_group_ids=split.test_group_ids,
    )

    pre_yanwu_train_indices = tuple(
        index
        for index in final_train_indices
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
        feature_catalog,
        test_group_ids=split.test_group_ids,
    )
    controlled_candidate = production_test

    def battle_has_assigned_skill(battle: Battle, skill: str) -> bool:
        return any(
            skill in (hero.get("skills") or [])[1:]
            for team in (battle.team1, battle.team2)
            for hero in team
        )

    held_out_provider_indices = tuple(
        index for index in split.development_indices
        if battle_has_assigned_skill(battles[index], "烈火张天")
    )
    provider_training_indices = tuple(
        index for index in split.train_indices
        if not battle_has_assigned_skill(battles[index], "烈火张天")
    )
    provider_config = replace(
        baseline_structural_config,
        families=tuple(sorted((*BASELINE_FAMILIES, F_MECH, F_HERO_MECH))),
    )
    provider_rows = (
        _fit_and_predict(
            provider_config,
            provider_training_indices,
            held_out_provider_indices,
            battles,
            group_ids,
            default_skill,
            catalog_seasons,
            feature_catalog,
        )
        if held_out_provider_indices and provider_training_indices
        else None
    )
    provider_baseline_rows = (
        _fit_and_predict(
            replace(provider_config, families=BASELINE_FAMILIES),
            provider_training_indices,
            held_out_provider_indices,
            battles,
            group_ids,
            default_skill,
            catalog_seasons,
            feature_catalog,
        )
        if provider_rows is not None else None
    )
    provider_generalization = (
        {
            "provider": "烈火张天",
            "training_policy": "exclude every 烈火张天 observation",
            "evaluation_population": "development rows containing 烈火张天 only",
            "config": provider_config.as_dict(),
            "metrics": _full_report(provider_rows, bootstrap_samples=bootstrap_samples),
            "baseline_without_MECH": _full_report(provider_baseline_rows, bootstrap_samples=bootstrap_samples),
            "MECH_minus_baseline": _paired_delta_report(
                provider_rows,
                provider_baseline_rows,
                bootstrap_samples=bootstrap_samples,
            ),
            "feature_diagnostics": provider_rows.feature_diagnostics,
        }
        if provider_rows is not None
        else {"provider": "烈火张天", "status": "insufficient_development_rows"}
    )

    zhangzhao_assignments = [
        team
        for battle in battles
        for team in (battle.team1, battle.team2)
        if any(
            hero.get("name") == "张昭" and "烈火张天" in (hero.get("skills") or [])[1:]
            for hero in team
        )
    ]
    zhangzhao_nested = sum(
        any(hero.get("name") == "陆逊" for hero in team)
        for team in zhangzhao_assignments
    )

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
    production_prior_rows = development_rows(production_prior_config)
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
            "selection_data": "training and development groups only",
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
                "team-appearance counts and season-aware expected counts are "
                "computed from known-season training rows only; unknown-season "
                "rows train the logistic outcome model but cannot affect the prior"
            ),
        },
        "corpus": {
            "corpus_version": compute_corpus_version(list(battles)),
            "evaluation_version": compute_evaluation_version(list(battles)),
            "catalog_version": catalog_version,
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
            "changed": False,
            "current_config": production_config.as_dict(),
            "atomic_support_buckets": production_test.atomic_diagnostics,
            "note": (
                "candidate results are evaluation-only and are not fed into "
                "the production artifact builder"
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
            "staged_team_context": {
                name: {
                    "selected": _selection_summary(stage_selected[name], development_rows(stage_selected[name])),
                    "minus_previous": stage_deltas.get(name),
                    "candidates": [
                        _selection_summary(config, development_rows(config))
                        for config in sorted(
                            stage_candidates[name],
                            key=lambda candidate: _selection_sort_key(candidate, development_rows(candidate)),
                        )
                    ],
                }
                for name, *_ in stage_specs
            },
            "leave_one_provider_out": provider_generalization,
            "named_diagnostics": {
                "development_selected_identity_model": development_rows(best_structural_config).feature_diagnostics,
                "locked_selected_candidate": selected_test.feature_diagnostics,
                "zhangzhao_liehuo_assignments": len(zhangzhao_assignments),
                "nested_with_luxun": zhangzhao_nested,
                "all_nested_with_luxun": zhangzhao_nested == len(zhangzhao_assignments),
                "interpretation": (
                    "observational assignments cannot identify direct carrier causality; "
                    "MECH is reviewed compatibility, not causal strength"
                ),
            },
            "combined_ablations": {
                "THS_without_MECH": _selection_summary(
                    stage_selected["2_plus_THS_TSP"],
                    development_rows(stage_selected["2_plus_THS_TSP"]),
                ),
                "MECH_without_THS": _selection_summary(
                    replace(
                        baseline_structural_config,
                        families=tuple(sorted((*BASELINE_FAMILIES, F_MECH, F_HERO_MECH))),
                    ),
                    development_rows(replace(
                        baseline_structural_config,
                        families=tuple(sorted((*BASELINE_FAMILIES, F_MECH, F_HERO_MECH))),
                    )),
                ),
                "THS_plus_MECH": _selection_summary(
                    stage_selected["5_plus_HMX"],
                    development_rows(stage_selected["5_plus_HMX"]),
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
                "selected": selected_config.as_dict(),
                "strength_candidates": [
                    _selection_summary(config, development_rows(config))
                    for config in sorted(
                        strength_configs,
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
                "production": _selection_summary(
                    production_prior_config,
                    production_prior_rows,
                ),
                "production_minus_none": _paired_delta_report(
                    production_prior_rows,
                    no_prior_rows,
                    bootstrap_samples=bootstrap_samples,
                ),
            },
        },
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
    parser.add_argument("--mechanics-registry", default="data/skill_mechanics.json")
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
        battles, catalog, catalog_seasons = _load_evaluation_corpus(
            args.battles_dir,
            args.web_upload_dir,
            args.web_upload_state,
            args.database,
            yanwu_corpus_path=str(yanwu_corpus),
            mechanics_registry_path=args.mechanics_registry,
            yanwu_manifest_path=str(args.yanwu_manifest),
        )
        report = evaluate_protocol(
            battles,
            catalog["default_skill"],
            catalog_seasons,
            locked_test_manifest,
            catalog_version=catalog["catalog_version"],
            feature_catalog=catalog,
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
