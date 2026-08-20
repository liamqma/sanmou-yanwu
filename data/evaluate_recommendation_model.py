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
        F_SKILL_PAIR,
        L2_C,
        MIN_SUPPORT_PAIR,
        MIN_SUPPORT_SINGLE,
        POPULARITY_EXPOSURE_TAU,
        POPULARITY_PENALTY_GAMMA,
        Battle,
        InvalidBattleError,
        _CatalogSeasons,
        _load_catalog_context,
        _sigmoid,
        build_artifact,
        build_design_matrix,
        compute_corpus_version,
        compute_evaluation_version,
        compute_support,
        fit_model,
        load_battles,
        load_yanwu_battles,
        popularity_adjusted_atomic_weights,
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
    from recommendation_promotion import (
        BASELINE_SPEC_PATH,
        CANDIDATE_FEATURE_FAMILIES,
        PROMOTION_EVIDENCE_PATH,
        builder_source_identity,
        candidate_algorithm_identity,
        candidate_identity,
        load_baseline_contract,
        mapping_identity,
        sha256_bytes,
    )
except ModuleNotFoundError:  # Support ``python -m data.evaluate_recommendation_model``.
    from .build_recommendation_data import (
        F_SKILL_PAIR,
        L2_C,
        MIN_SUPPORT_PAIR,
        MIN_SUPPORT_SINGLE,
        POPULARITY_EXPOSURE_TAU,
        POPULARITY_PENALTY_GAMMA,
        Battle,
        InvalidBattleError,
        _CatalogSeasons,
        _load_catalog_context,
        _sigmoid,
        build_artifact,
        build_design_matrix,
        compute_corpus_version,
        compute_evaluation_version,
        compute_support,
        fit_model,
        load_battles,
        load_yanwu_battles,
        popularity_adjusted_atomic_weights,
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
    from .recommendation_promotion import (
        BASELINE_SPEC_PATH,
        CANDIDATE_FEATURE_FAMILIES,
        PROMOTION_EVIDENCE_PATH,
        builder_source_identity,
        candidate_algorithm_identity,
        candidate_identity,
        load_baseline_contract,
        mapping_identity,
        sha256_bytes,
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
POPULARITY_PENALTY_GAMMA_CANDIDATES = (0.0, 0.125, 0.25, 0.5)
POPULARITY_EXPOSURE_TAU_CANDIDATES = (300.0, 600.0, 1200.0)
PRODUCTION_ARTIFACT_PATH = "web/src/recommendation_data.json"


@dataclass(frozen=True)
class EvaluationConfig:
    """One season-independent evaluation-only model configuration."""

    c: float = L2_C
    min_support_single: int = MIN_SUPPORT_SINGLE
    min_support_pair: int = MIN_SUPPORT_PAIR
    include_sp: bool = True
    include_semantic_mechanics: bool = True
    popularity_penalty_gamma: float = POPULARITY_PENALTY_GAMMA
    popularity_exposure_tau: float = POPULARITY_EXPOSURE_TAU

    def __post_init__(self) -> None:
        if self.c <= 0:
            raise ValueError("C must be positive")
        if self.min_support_single < 1 or self.min_support_pair < 1:
            raise ValueError("support thresholds must be positive")
        if (
            isinstance(self.popularity_penalty_gamma, bool)
            or not isinstance(self.popularity_penalty_gamma, (int, float))
            or not math.isfinite(self.popularity_penalty_gamma)
            or not 0.0 <= self.popularity_penalty_gamma <= 1.0
        ):
            raise ValueError("popularity penalty gamma must be between 0 and 1")
        if (
            isinstance(self.popularity_exposure_tau, bool)
            or not isinstance(self.popularity_exposure_tau, (int, float))
            or not math.isfinite(self.popularity_exposure_tau)
            or self.popularity_exposure_tau < 0.0
        ):
            raise ValueError("popularity exposure tau must be non-negative")

    def as_dict(self) -> dict[str, Any]:
        return {
            "C": self.c,
            "min_support_single": self.min_support_single,
            "min_support_pair": self.min_support_pair,
            "include_sp": self.include_sp,
            "include_semantic_mechanics": self.include_semantic_mechanics,
            "popularity_penalty_gamma": self.popularity_penalty_gamma,
            "popularity_exposure_tau": self.popularity_exposure_tau,
        }

    def selection_key(self) -> tuple[Any, ...]:
        return (
            0 if not self.include_sp else 1,
            0 if not self.include_semantic_mechanics else 1,
            -self.min_support_single,
            -self.min_support_pair,
            0 if self.popularity_penalty_gamma == 0.0 else 1,
            self.popularity_penalty_gamma,
            -self.popularity_exposure_tau,
            self.c,
        )


def _configuration_from_contract(value: Mapping[str, Any]) -> EvaluationConfig:
    return EvaluationConfig(
        c=float(value["C"]),
        min_support_single=int(value["min_support_single"]),
        min_support_pair=int(value["min_support_pair"]),
        include_sp=bool(value["include_sp"]),
        include_semantic_mechanics=bool(value["include_semantic_mechanics"]),
        popularity_penalty_gamma=float(value["popularity_penalty_gamma"]),
        popularity_exposure_tau=float(value["popularity_exposure_tau"]),
    )


def _configuration_from_artifact(
    artifact: Mapping[str, Any],
) -> EvaluationConfig:
    model = artifact.get("model", {})
    families = artifact.get("schema", {}).get("feature_families", {})
    return EvaluationConfig(
        c=float(model["l2_C"]),
        min_support_single=int(model["min_support_single"]),
        min_support_pair=int(model["min_support_pair"]),
        include_sp="SP" in families,
        include_semantic_mechanics="M" in families,
        popularity_penalty_gamma=float(
            model.get("popularity_penalty_gamma", POPULARITY_PENALTY_GAMMA)
        ),
        popularity_exposure_tau=float(
            model.get("popularity_exposure_tau", POPULARITY_EXPOSURE_TAU)
        ),
    )


def _candidate_algorithm_contract(
    catalog: Mapping[str, Any],
    mechanics: Mapping[str, Any],
    corpus_version: str,
) -> dict[str, Any]:
    return {
        "schema": {
            "feature_families": {
                family: family for family in CANDIDATE_FEATURE_FAMILIES
            }
        },
        "catalog": {
            "catalog_version": catalog["catalog_version"],
            "mechanics_version": mechanics["mechanics_version"],
            "default_skill": dict(catalog.get("default_skill", {})),
        },
        "battle_counts": {"corpus_version": corpus_version},
        "model": {
            "l2_C": L2_C,
            "min_support_single": MIN_SUPPORT_SINGLE,
            "min_support_pair": MIN_SUPPORT_PAIR,
            "popularity_penalty_gamma": POPULARITY_PENALTY_GAMMA,
            "popularity_exposure_tau": POPULARITY_EXPOSURE_TAU,
            "mechanics": {"schema_version": mechanics.get("schema_version")},
        },
    }


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


def _load_evaluation_corpus(
    battles_dir: str,
    web_upload_dir: str,
    web_upload_state_path: str,
    database_path: str,
    yanwu_corpus_path: str | None = None,
    yanwu_manifest_path: str = "data/external/yanwu-release.json",
) -> tuple[list[Battle], dict[str, Any], _CatalogSeasons, dict[str, Any]]:
    catalog_context = _load_catalog_context(database_path)
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
        catalog_context.mechanics,
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
    mechanics: Mapping[str, Any] | None = None,
    *,
    test_group_ids: Sequence[str] | None = None,
) -> PredictionRows:
    train = [battles[index] for index in train_indices]
    test = [battles[index] for index in test_indices]
    active_mechanics = mechanics if config.include_semantic_mechanics else None
    support = compute_support(train, default_skill, active_mechanics)
    features = select_features(
        support,
        min_support_single=config.min_support_single,
        min_support_pair=config.min_support_pair,
        excluded_families=() if config.include_sp else (F_SKILL_PAIR,),
    )
    feature_index = {
        feature_id: index
        for index, feature_id in enumerate(features)
    }
    X_train, y_train = build_design_matrix(
        train, feature_index, default_skill, active_mechanics
    )
    X_test, y_test = build_design_matrix(
        test, feature_index, default_skill, active_mechanics
    )
    coef, intercept = fit_model(X_train, y_train, c=config.c)
    atomic_weights = popularity_adjusted_atomic_weights(
        features,
        coef,
        support,
        train,
        catalog_seasons,
        default_skill=default_skill,
        exposure_tau=config.popularity_exposure_tau,
        gamma=config.popularity_penalty_gamma,
        min_support_single=config.min_support_single,
    )
    scoring_coef = coef.copy()
    for feature_id, column in feature_index.items():
        adjusted_weight = atomic_weights.get(feature_id)
        if adjusted_weight is not None:
            scoring_coef[column] = adjusted_weight

    penalty_only_weights = {
        feature_id: weight
        for feature_id, weight in atomic_weights.items()
        if feature_id not in feature_index
    }
    logits = X_test @ scoring_coef + intercept
    nonzero_test_rows = np.any(X_test != 0.0, axis=1)
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
            active_mechanics,
        )
        penalty_coef = np.asarray(
            [penalty_only_weights[feature_id] for feature_id in penalty_features],
            dtype=np.float64,
        )
        logits = logits + X_test_penalty @ penalty_coef
        nonzero_test_rows = nonzero_test_rows | np.any(
            X_test_penalty != 0.0,
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
    return PredictionRows(
        outcomes=y_test.astype(int).tolist(),
        probabilities=probabilities.astype(float).tolist(),
        baseline_probabilities=[baseline_probability] * len(test),
        group_ids=row_group_ids,
        sources=[battle.source for battle in test],
        n_features=len(features) + len(penalty_only_weights),
        nonzero_rows=int(np.count_nonzero(nonzero_test_rows)),
    )


def _predict_artifact(
    artifact: Mapping[str, Any],
    test_indices: Sequence[int],
    battles: Sequence[Battle],
    group_ids: Sequence[str],
    *,
    test_group_ids: Sequence[str] | None = None,
) -> PredictionRows:
    model = artifact.get("model")
    catalog = artifact.get("catalog")
    if not isinstance(model, Mapping) or not isinstance(catalog, Mapping):
        raise ValueError("model artifact is missing model or catalog data")
    weights = model.get("weights")
    default_skill = catalog.get("default_skill")
    intercept = model.get("intercept")
    if (
        not isinstance(weights, Mapping)
        or not isinstance(default_skill, Mapping)
        or isinstance(intercept, bool)
        or not isinstance(intercept, (int, float))
    ):
        raise ValueError("model artifact has invalid scoring data")
    feature_ids = sorted(weights)
    if any(
        not isinstance(feature_id, str)
        or isinstance(weights[feature_id], bool)
        or not isinstance(weights[feature_id], (int, float))
        for feature_id in feature_ids
    ):
        raise ValueError("model artifact has invalid serialized weights")
    mechanics = model.get("mechanics")
    if mechanics is not None and not isinstance(mechanics, Mapping):
        raise ValueError("model artifact has invalid mechanics")
    test = [battles[index] for index in test_indices]
    feature_index = {
        feature_id: index for index, feature_id in enumerate(feature_ids)
    }
    X_test, y_test = build_design_matrix(
        test,
        feature_index,
        default_skill,
        mechanics,
    )
    coefficients = np.asarray(
        [float(weights[feature_id]) for feature_id in feature_ids],
        dtype=np.float64,
    )
    probabilities = _sigmoid(X_test @ coefficients + float(intercept))
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
        baseline_probabilities=[float(_sigmoid(np.asarray([intercept]))[0])]
        * len(test),
        group_ids=row_group_ids,
        sources=[battle.source for battle in test],
        n_features=len(feature_ids),
        nonzero_rows=int(np.count_nonzero(np.any(X_test != 0.0, axis=1))),
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
    mechanics: Mapping[str, Any] | None = None,
    production_config: EvaluationConfig,
    baseline_artifact: Mapping[str, Any],
    candidate_artifact: Mapping[str, Any],
    baseline_metadata: Mapping[str, Any] | None = None,
    c_candidates: Sequence[float] = C_CANDIDATES,
    single_support_candidates: Sequence[int] = SINGLE_SUPPORT_CANDIDATES,
    pair_support_candidates: Sequence[int] = PAIR_SUPPORT_CANDIDATES,
    popularity_penalty_gamma_candidates: Sequence[float] = (
        POPULARITY_PENALTY_GAMMA_CANDIDATES
    ),
    popularity_exposure_tau_candidates: Sequence[float] = (
        POPULARITY_EXPOSURE_TAU_CANDIDATES
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
    gamma_candidates = sorted(
        {
            *popularity_penalty_gamma_candidates,
            0.0,
            POPULARITY_PENALTY_GAMMA,
        }
    )
    tau_candidates = sorted(
        {
            *popularity_exposure_tau_candidates,
            POPULARITY_EXPOSURE_TAU,
        }
    )
    popularity_configs = [
        replace(
            best_structural_config,
            popularity_penalty_gamma=gamma,
            popularity_exposure_tau=tau,
        )
        for gamma in gamma_candidates
        for tau in (
            (POPULARITY_EXPOSURE_TAU,)
            if gamma == 0.0
            else tau_candidates
        )
    ]
    selected_config = min(
        popularity_configs,
        key=lambda config: _selection_sort_key(
            config,
            development_rows(config),
        ),
    )
    no_penalty_config = next(
        config
        for config in popularity_configs
        if config.popularity_penalty_gamma == 0.0
    )
    mild_penalty_config = next(
        config
        for config in popularity_configs
        if config.popularity_penalty_gamma == POPULARITY_PENALTY_GAMMA
        and config.popularity_exposure_tau == POPULARITY_EXPOSURE_TAU
    )

    final_train_indices = tuple(
        sorted((*split.train_indices, *split.development_indices))
    )
    candidate_config = _configuration_from_artifact(candidate_artifact)
    selected_test = _fit_and_predict(
        selected_config,
        final_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        mechanics,
        test_group_ids=split.test_group_ids,
    )
    candidate_test = _fit_and_predict(
        candidate_config,
        final_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        mechanics,
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
        mechanics,
        test_group_ids=split.test_group_ids,
    )

    pre_yanwu_train_indices = tuple(
        index
        for index in final_train_indices
        if battles[index].source != SOURCE_EXTERNAL_YANWU
    )
    controlled_config = candidate_config
    controlled_baseline = _fit_and_predict(
        controlled_config,
        pre_yanwu_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        mechanics,
        test_group_ids=split.test_group_ids,
    )
    controlled_candidate = _fit_and_predict(
        controlled_config,
        final_train_indices,
        split.test_indices,
        battles,
        group_ids,
        default_skill,
        catalog_seasons,
        mechanics,
        test_group_ids=split.test_group_ids,
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

    no_penalty_rows = development_rows(no_penalty_config)
    mild_penalty_rows = development_rows(mild_penalty_config)
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
            "popularity_penalty_exposure": (
                "computed from known-season training rows only; unknown-season "
                "rows train the logistic model but are excluded from both "
                "popularity observed-support and availability-exposure counts"
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
            "baseline": dict(baseline_metadata or {}),
            "current_config": production_config.as_dict(),
            "candidate_config": candidate_config.as_dict(),
            "comparison_policy": "algorithm_configuration_refit",
            "comparison_training_population": "identical training plus development rows",
            "note": (
                "the frozen legacy and candidate algorithms are refit on the "
                "same non-test population; neither fit observes locked-test rows"
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
            "popularity_penalty": {
                "selected": selected_config.as_dict(),
                "candidates": [
                    _selection_summary(config, development_rows(config))
                    for config in sorted(
                        popularity_configs,
                        key=lambda config: _selection_sort_key(
                            config,
                            development_rows(config),
                        ),
                    )
                ],
                "none": _selection_summary(
                    no_penalty_config,
                    no_penalty_rows,
                ),
                "mild": _selection_summary(
                    mild_penalty_config,
                    mild_penalty_rows,
                ),
                "mild_minus_none": _paired_delta_report(
                    mild_penalty_rows,
                    no_penalty_rows,
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
            "production_candidate": {
                "config": candidate_config.as_dict(),
                "metrics": _full_report(
                    candidate_test,
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
            "candidate_minus_current": (
                candidate_vs_production := _paired_delta_report(
                    candidate_test,
                    production_test,
                    bootstrap_samples=bootstrap_samples,
                )
            ),
            "promotion_gate": {
                "supported": _comparison_conclusion(candidate_vs_production)
                == "candidate_improvement_supported_on_all_three_metrics",
                "conclusion": _comparison_conclusion(candidate_vs_production),
                "required_metrics": ["accuracy", "brier", "log_loss"],
            },
        },
        "controlled_yanwu_comparison": {
            "config": controlled_config.as_dict(),
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


def _promotion_evidence(
    report: Mapping[str, Any],
    baseline_spec: Mapping[str, Any],
    baseline_bytes: bytes,
    candidate_algorithm: Mapping[str, Any],
    candidate_artifact: Mapping[str, Any] | None,
    candidate_bytes: bytes | None,
) -> dict[str, Any]:
    baseline_artifact = baseline_spec["artifact"]
    locked_test = report["locked_test"]

    def metrics(value: Mapping[str, Any]) -> dict[str, Any]:
        return {
            key: value[key]
            for key in (
                "accuracy",
                "brier",
                "log_loss",
                "feature_coverage",
                "n",
                "n_features",
                "n_groups",
            )
        }

    def paired_delta(value: Mapping[str, Any]) -> dict[str, Any]:
        return {
            key: value[key]
            for key in (
                "accuracy",
                "brier",
                "log_loss",
                "confidence_interval_status",
                "confidence_intervals_95",
                "n",
                "n_groups",
            )
        }

    return {
        "schema_version": 3,
        "comparison_policy": "algorithm_configuration_refit_on_identical_non_test_population",
        "baseline": {
            "specification_sha256": mapping_identity(baseline_spec),
            "fallback_artifact_sha256": sha256_bytes(baseline_bytes),
            "configuration": report["production_model"]["current_config"],
            "feature_families": baseline_spec["feature_families"],
            "source_commit": baseline_artifact["source_commit"],
            "source_ref": baseline_artifact["source_ref"],
        },
        "candidate_algorithm": candidate_algorithm_identity(candidate_algorithm),
        "evaluation_context": {
            "builder_source": builder_source_identity(),
            "catalog_version": report["corpus"]["catalog_version"],
            "corpus_version": report["corpus"]["corpus_version"],
            "evaluation_version": report["corpus"]["evaluation_version"],
            "training_battles": (
                report["split_balance"]["train"]["n_battles"]
                + report["split_balance"]["development"]["n_battles"]
            ),
            "training_groups": (
                report["split_balance"]["train"]["n_groups"]
                + report["split_balance"]["development"]["n_groups"]
            ),
            "locked_test_group_set_hash": report["protocol"][
                "locked_test_group_set_hash"
            ],
        },
        "final_production_artifact": (
            {
                "selection": "candidate",
                "sha256": sha256_bytes(candidate_bytes),
                "identity": candidate_identity(candidate_artifact, candidate_bytes),
                "fit_population": "full validated corpus after promotion decision",
            }
            if candidate_artifact is not None and candidate_bytes is not None
            else {
                "selection": "baseline",
                "sha256": sha256_bytes(baseline_bytes),
                "fit_population": "frozen reviewed production artifact",
            }
        ),
        "locked_test": {
            "group_set_hash": report["protocol"]["locked_test_group_set_hash"],
            "manifest_source_battles": report["protocol"][
                "locked_test_selection_source_battles"
            ],
            "manifest_source_groups": report["protocol"][
                "locked_test_selection_source_groups"
            ],
            "baseline_metrics": metrics(
                locked_test["current_production_configuration"]["metrics"]
            ),
            "candidate_metrics": metrics(
                locked_test["production_candidate"]["metrics"]
            ),
            "candidate_minus_baseline": paired_delta(
                locked_test["candidate_minus_current"]
            ),
        },
        "promotion_gate": report["locked_test"]["promotion_gate"],
    }


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
    parser.add_argument(
        "--promotion-evidence",
        default=str(root / PROMOTION_EVIDENCE_PATH),
    )
    parser.add_argument(
        "--baseline-spec",
        type=Path,
        default=root / BASELINE_SPEC_PATH,
    )
    parser.add_argument(
        "--baseline-artifact",
        type=Path,
        default=root / "data/evaluation/production-baseline-artifact.json",
    )
    parser.add_argument("--candidate-artifact", type=Path)
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
        if _targets_production_artifact(args.output) or _targets_production_artifact(
            args.promotion_evidence
        ):
            raise ValueError(
                "evaluation output must not target "
                f"{PRODUCTION_ARTIFACT_PATH}"
            )
        locked_test_manifest = load_locked_test_manifest(
            args.locked_test_manifest
        )
        baseline_spec, baseline_bytes, baseline_artifact = load_baseline_contract(
            args.baseline_spec,
            args.baseline_artifact,
        )
        production_config = _configuration_from_contract(
            baseline_spec["configuration"]
        )
        manifest = load_manifest(args.yanwu_manifest)
        yanwu_corpus = args.yanwu_corpus or normalized_cache_path(
            manifest,
            args.yanwu_cache_dir,
        )
        battles, catalog, catalog_seasons, mechanics = _load_evaluation_corpus(
            args.battles_dir,
            args.web_upload_dir,
            args.web_upload_state,
            args.database,
            str(yanwu_corpus),
            str(args.yanwu_manifest),
        )
        corpus_version = compute_corpus_version(battles)
        supplied_candidate_artifact: dict[str, Any] | None = None
        supplied_candidate_bytes: bytes | None = None
        if args.candidate_artifact is None:
            candidate_algorithm = _candidate_algorithm_contract(
                catalog,
                mechanics,
                corpus_version,
            )
        else:
            supplied_candidate_bytes = args.candidate_artifact.read_bytes()
            supplied_candidate_artifact = json.loads(supplied_candidate_bytes)
            if not isinstance(supplied_candidate_artifact, dict):
                raise ValueError("candidate artifact must be a JSON object")
            candidate_algorithm = supplied_candidate_artifact
        algorithm_descriptor = candidate_identity(
            candidate_algorithm,
            (
                json.dumps(
                    candidate_algorithm,
                    ensure_ascii=False,
                    sort_keys=True,
                    allow_nan=False,
                )
                + "\n"
            ).encode("utf-8"),
        )
        expected_candidate_identity = {
            "catalog_version": catalog["catalog_version"],
            "corpus_version": corpus_version,
            "mechanics_version": mechanics["mechanics_version"],
        }
        if any(
            algorithm_descriptor.get(field) != value
            for field, value in expected_candidate_identity.items()
        ):
            raise ValueError(
                "candidate algorithm does not match the immutable evaluation corpus"
            )
        report = evaluate_protocol(
            battles,
            catalog["default_skill"],
            catalog_seasons,
            locked_test_manifest,
            catalog_version=catalog["catalog_version"],
            mechanics=mechanics,
            production_config=production_config,
            baseline_artifact=baseline_artifact,
            candidate_artifact=candidate_algorithm,
            baseline_metadata={
                "artifact_sha256": sha256_bytes(baseline_bytes),
                "source_commit": baseline_spec["artifact"]["source_commit"],
                "source_ref": baseline_spec["artifact"]["source_ref"],
                "feature_families": baseline_spec["feature_families"],
            },
            bootstrap_samples=args.bootstrap_samples,
        )
        gate_supported = report["locked_test"]["promotion_gate"]["supported"] is True
        candidate_artifact: dict[str, Any] | None = None
        candidate_bytes: bytes | None = None
        if gate_supported:
            if supplied_candidate_artifact is not None:
                candidate_artifact = supplied_candidate_artifact
                candidate_bytes = supplied_candidate_bytes
            else:
                candidate_artifact = build_artifact(
                    battles,
                    [],
                    catalog,
                    catalog_seasons=catalog_seasons,
                    mechanics=mechanics,
                )
                candidate_bytes = (
                    json.dumps(
                        candidate_artifact,
                        ensure_ascii=False,
                        indent=2,
                        sort_keys=True,
                        allow_nan=False,
                    )
                    + "\n"
                ).encode("utf-8")
            if candidate_bytes is None:
                raise ValueError("supported candidate has no serialized artifact")
            final_descriptor = candidate_identity(candidate_artifact, candidate_bytes)
            if any(
                final_descriptor.get(field) != value
                for field, value in expected_candidate_identity.items()
            ):
                raise ValueError(
                    "final candidate artifact does not match the evaluated corpus"
                )
    except (InvalidBattleError, InvalidYanwuCorpus, ValueError) as exc:
        print(f"Evaluation failed: {exc}", file=sys.stderr)
        return 1

    _write_json_atomic(args.output, report)
    _write_json_atomic(
        args.promotion_evidence,
        _promotion_evidence(
            report,
            baseline_spec,
            baseline_bytes,
            candidate_algorithm,
            candidate_artifact,
            candidate_bytes,
        ),
    )
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
