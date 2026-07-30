#!/usr/bin/env python3
"""Run the locked, grouped rolling evaluation for the recommendation model.

This command is deliberately separate from the production artifact builder.
It may recommend a candidate configuration, but it never rewrites
``web/src/recommendation_data.json`` or changes production weights.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

try:
    from build_recommendation_data import (
        F_HERO,
        F_SKILL,
        F_SKILL_PAIR,
        FINAL_EVALUATION_SEASON,
        L2_C,
        MIN_SUPPORT_PAIR,
        MIN_SUPPORT_SINGLE,
        UNSEEN_WEIGHT_SCALE,
        UNSEEN_WEIGHT_STRATEGY,
        Battle,
        InvalidBattleError,
        _catalog_components,
        _sigmoid,
        build_design_matrix,
        compute_corpus_version,
        compute_evaluation_version,
        compute_support,
        compute_unseen_weights,
        fit_model,
        load_battles,
        select_features,
        unseen_feature_deltas,
        validate_training_duplicate_policy,
    )
    from recommendation_evaluation import (
        BOOTSTRAP_SAMPLES,
        EVALUATION_PROTOCOL_VERSION,
        MIN_BOOTSTRAP_GROUPS,
        NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS,
        SESSION_GAP_SECONDS,
        SOURCE_CATEGORIES,
        SOURCE_UPLOADED_BY_ME,
        SOURCE_UPLOADED_BY_OTHERS,
        assign_evaluation_groups,
        assign_matchup_clusters,
        paired_prediction_delta_report,
        point_metrics,
        prediction_report,
    )
except ModuleNotFoundError:  # Support ``python -m data.evaluate_recommendation_model``.
    from .build_recommendation_data import (
        F_HERO,
        F_SKILL,
        F_SKILL_PAIR,
        FINAL_EVALUATION_SEASON,
        L2_C,
        MIN_SUPPORT_PAIR,
        MIN_SUPPORT_SINGLE,
        UNSEEN_WEIGHT_SCALE,
        UNSEEN_WEIGHT_STRATEGY,
        Battle,
        InvalidBattleError,
        _catalog_components,
        _sigmoid,
        build_design_matrix,
        compute_corpus_version,
        compute_evaluation_version,
        compute_support,
        compute_unseen_weights,
        fit_model,
        load_battles,
        select_features,
        unseen_feature_deltas,
        validate_training_duplicate_policy,
    )
    from .recommendation_evaluation import (
        BOOTSTRAP_SAMPLES,
        EVALUATION_PROTOCOL_VERSION,
        MIN_BOOTSTRAP_GROUPS,
        NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS,
        SESSION_GAP_SECONDS,
        SOURCE_CATEGORIES,
        SOURCE_UPLOADED_BY_ME,
        SOURCE_UPLOADED_BY_OTHERS,
        assign_evaluation_groups,
        assign_matchup_clusters,
        paired_prediction_delta_report,
        point_metrics,
        prediction_report,
    )

MIN_TRAIN_BATTLES = 20
MIN_VALIDATION_BATTLES = 20
MIN_TRAIN_GROUPS = MIN_BOOTSTRAP_GROUPS
MIN_VALIDATION_GROUPS = MIN_BOOTSTRAP_GROUPS
RECENCY_HALF_LIFE_SEASONS = 2.0
SEASON_TREND_SCALE = 0.25
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
PRODUCTION_ARTIFACT_PATH = "web/src/recommendation_data.json"

VARIANT_POOLED = "pooled"
VARIANT_RECENCY_WEIGHTED = "recency_weighted"
VARIANT_SEASON_TREND = "limited_season_trend"
MODEL_VARIANTS = (
    VARIANT_POOLED,
    VARIANT_RECENCY_WEIGHTED,
    VARIANT_SEASON_TREND,
)


@dataclass(frozen=True)
class EvaluationConfig:
    """One evaluation-only model configuration."""

    c: float = L2_C
    min_support_single: int = MIN_SUPPORT_SINGLE
    min_support_pair: int = MIN_SUPPORT_PAIR
    include_sp: bool = True
    variant: str = VARIANT_POOLED

    def __post_init__(self) -> None:
        if self.c <= 0:
            raise ValueError("C must be positive")
        if self.min_support_single < 1 or self.min_support_pair < 1:
            raise ValueError("support thresholds must be positive")
        if self.variant not in MODEL_VARIANTS:
            raise ValueError(f"unknown model variant {self.variant!r}")

    def as_dict(self) -> dict[str, Any]:
        return {
            "C": self.c,
            "min_support_single": self.min_support_single,
            "min_support_pair": self.min_support_pair,
            "include_sp": self.include_sp,
            "variant": self.variant,
            "unseen_weight_strategy": UNSEEN_WEIGHT_STRATEGY,
            "unseen_weight_scale": UNSEEN_WEIGHT_SCALE,
        }

    def selection_key(self) -> tuple[Any, ...]:
        variant_complexity = {
            VARIANT_POOLED: 0,
            VARIANT_RECENCY_WEIGHTED: 1,
            VARIANT_SEASON_TREND: 2,
        }[self.variant]
        return (
            variant_complexity,
            0 if not self.include_sp else 1,
            -self.min_support_single,
            -self.min_support_pair,
            self.c,
        )


@dataclass(frozen=True)
class RollingFold:
    test_season: int
    train_indices: tuple[int, ...]
    test_indices: tuple[int, ...]


@dataclass
class PredictionRows:
    outcomes: list[int]
    probabilities: list[float]
    baseline_probabilities: list[float]
    group_ids: list[str]
    sources: list[str]
    seasons: list[int]
    fold_seasons: list[int]
    feature_counts: list[int]
    nonzero_rows: int = 0

    @classmethod
    def empty(cls) -> "PredictionRows":
        return cls([], [], [], [], [], [], [], [])

    def extend(self, other: "PredictionRows") -> None:
        self.outcomes.extend(other.outcomes)
        self.probabilities.extend(other.probabilities)
        self.baseline_probabilities.extend(other.baseline_probabilities)
        self.group_ids.extend(other.group_ids)
        self.sources.extend(other.sources)
        self.seasons.extend(other.seasons)
        self.fold_seasons.extend(other.fold_seasons)
        self.feature_counts.extend(other.feature_counts)
        self.nonzero_rows += other.nonzero_rows


def _load_evaluation_corpus(
    battles_dir: str,
    web_upload_dir: str,
    web_upload_state_path: str,
    database_path: str,
) -> tuple[list[Battle], dict[str, Any]]:
    catalog, catalog_names = _catalog_components(database_path)
    manual_battles, errors = load_battles(
        battles_dir,
        catalog_names=catalog_names,
        source=SOURCE_UPLOADED_BY_ME,
    )
    web_battles, web_errors = load_battles(
        web_upload_dir,
        filename_prefix="web-upload/",
        catalog_names=catalog_names,
        source=SOURCE_UPLOADED_BY_OTHERS,
    )
    errors.extend(web_errors)
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
        [*manual_battles, *web_battles],
        key=lambda battle: (
            battle.season if battle.season is not None else -1,
            battle.captured_at if battle.captured_at is not None else -1.0,
            battle.order_key,
            battle.filename,
        ),
    )
    missing_seasons = [
        battle.filename
        for battle in battles
        if battle.season is None
    ]
    if missing_seasons:
        raise InvalidBattleError(
            "rolling evaluation requires a positive season on every battle; "
            f"missing on {missing_seasons[0]!r}"
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
            "rolling evaluation cannot infer a capture/upload session for "
            f"{missing_timestamps[0]!r}; add an explicit timestamp parser or "
            "a reviewed legacy manifest entry"
        )
    return battles, catalog


def build_rolling_folds(
    battles: Sequence[Battle],
    group_ids: Sequence[str],
    *,
    matchup_cluster_ids: Sequence[str] | None = None,
    final_season: int = FINAL_EVALUATION_SEASON,
    minimum_train_battles: int = MIN_TRAIN_BATTLES,
    minimum_validation_battles: int = MIN_VALIDATION_BATTLES,
    minimum_train_groups: int = MIN_TRAIN_GROUPS,
    minimum_validation_groups: int = MIN_VALIDATION_GROUPS,
) -> tuple[
    list[RollingFold],
    RollingFold,
    list[RollingFold],
    list[RollingFold],
]:
    """Create development, locked-final, and later descriptive folds.

    A row is scored only in its actual season. If a caller supplies a group that
    spans seasons, every companion row in that group is excluded from that
    fold's training, so a later observation cannot relabel an earlier locked
    test. The normal evaluator also caps inferred sessions at season boundaries.
    """
    if len(battles) != len(group_ids):
        raise ValueError("battles and group_ids must have the same length")
    if matchup_cluster_ids is not None and len(battles) != len(matchup_cluster_ids):
        raise ValueError(
            "battles and matchup_cluster_ids must have the same length"
        )
    indices_by_season: dict[int, list[int]] = defaultdict(list)
    for index, battle in enumerate(battles):
        if battle.season is None:
            raise ValueError("rolling folds require a season on every battle")
        indices_by_season[int(battle.season)].append(index)

    available_seasons = sorted(indices_by_season)

    def make_fold(test_season: int) -> RollingFold:
        test_indices = tuple(indices_by_season.get(test_season, []))
        test_groups = {
            group_ids[index]
            for index in test_indices
        }
        candidate_train_indices = tuple(
            index
            for index, battle in enumerate(battles)
            if int(battle.season) < test_season
            and group_ids[index] not in test_groups
        )
        if matchup_cluster_ids is None:
            # Build near-duplicate relationships only from observations
            # available through this fold. Later/final covariates must not
            # change earlier development membership through a transitive bridge.
            relevant_indices = (*candidate_train_indices, *test_indices)
            relevant_clusters = assign_matchup_clusters(
                [battles[index] for index in relevant_indices]
            )
            cluster_for_index = dict(
                zip(relevant_indices, relevant_clusters)
            )
        else:
            cluster_for_index = {
                index: matchup_cluster_ids[index]
                for index in (*candidate_train_indices, *test_indices)
            }

        contaminated_train_groups: set[str] = set()
        if test_indices:
            test_matchups = {
                cluster_for_index[index]
                for index in test_indices
            }
            contaminated_train_groups = {
                group_ids[index]
                for index in candidate_train_indices
                if cluster_for_index[index] in test_matchups
            }
        train_indices = tuple(
            index
            for index in candidate_train_indices
            if group_ids[index] not in contaminated_train_groups
        )
        return RollingFold(test_season, train_indices, test_indices)

    def n_groups(indices: Sequence[int]) -> int:
        return len({group_ids[index] for index in indices})

    final_fold = make_fold(final_season)
    if (
        len(final_fold.train_indices) < minimum_train_battles
        or n_groups(final_fold.train_indices) < minimum_train_groups
    ):
        raise InvalidBattleError(
            f"season {final_season} has fewer than "
            f"{minimum_train_battles} prior training battles or "
            f"{minimum_train_groups} prior training sessions"
        )
    if (
        len(final_fold.test_indices) < minimum_validation_battles
        or n_groups(final_fold.test_indices) < minimum_validation_groups
    ):
        raise InvalidBattleError(
            f"season {final_season} has only {len(final_fold.test_indices)} "
            f"battles across {n_groups(final_fold.test_indices)} sessions; "
            "final evaluation is underpowered"
        )

    development: list[RollingFold] = []
    underpowered_development: list[RollingFold] = []
    descriptive_future: list[RollingFold] = []
    for season in available_seasons:
        fold = make_fold(season)
        if season < final_season:
            has_training_evidence = (
                len(fold.train_indices) >= minimum_train_battles
                and n_groups(fold.train_indices) >= minimum_train_groups
            )
            has_validation_evidence = (
                len(fold.test_indices) >= minimum_validation_battles
                and n_groups(fold.test_indices) >= minimum_validation_groups
            )
            if has_training_evidence and has_validation_evidence:
                development.append(fold)
            elif has_training_evidence and fold.test_indices:
                underpowered_development.append(fold)
        elif season > final_season and fold.test_indices:
            descriptive_future.append(fold)
    if not development:
        raise InvalidBattleError("no rolling development folds meet the evidence floor")
    return (
        development,
        final_fold,
        descriptive_future,
        underpowered_development,
    )


def _sample_weights(
    train_battles: Sequence[Battle],
    variant: str,
) -> np.ndarray | None:
    if variant != VARIANT_RECENCY_WEIGHTED:
        return None
    seasons = np.asarray(
        [int(battle.season) for battle in train_battles],
        dtype=np.float64,
    )
    newest = float(np.max(seasons))
    weights = np.power(
        0.5,
        (newest - seasons) / RECENCY_HALF_LIFE_SEASONS,
    )
    return weights / float(np.mean(weights))


def _add_season_trend_columns(
    X_train: np.ndarray,
    X_test: np.ndarray,
    features: Sequence[str],
    train_battles: Sequence[Battle],
    test_battles: Sequence[Battle],
) -> tuple[np.ndarray, np.ndarray]:
    item_columns = [
        index
        for index, feature_id in enumerate(features)
        if feature_id.split("|", 1)[0] in (F_HERO, F_SKILL)
    ]
    if not item_columns:
        return X_train, X_test

    train_seasons = np.asarray(
        [int(battle.season) for battle in train_battles],
        dtype=np.float64,
    )
    test_seasons = np.asarray(
        [int(battle.season) for battle in test_battles],
        dtype=np.float64,
    )
    center = float(np.mean(train_seasons))
    spread = max(float(np.max(train_seasons) - np.min(train_seasons)), 1.0)
    train_trend = ((train_seasons - center) / spread) * SEASON_TREND_SCALE
    test_trend = ((test_seasons - center) / spread) * SEASON_TREND_SCALE
    # The limited interaction may represent the newest era seen in training,
    # but it must not grow without bound when a caller evaluates a non-adjacent
    # future season.
    test_trend = np.clip(
        test_trend,
        float(np.min(train_trend)),
        float(np.max(train_trend)),
    )
    train_interactions = X_train[:, item_columns] * train_trend[:, None]
    test_interactions = X_test[:, item_columns] * test_trend[:, None]
    return (
        np.concatenate([X_train, train_interactions], axis=1),
        np.concatenate([X_test, test_interactions], axis=1),
    )


def _evaluate_fold(
    config: EvaluationConfig,
    fold: RollingFold,
    battles: Sequence[Battle],
    group_ids: Sequence[str],
    default_skill: Mapping[str, str],
) -> PredictionRows:
    train = [battles[index] for index in fold.train_indices]
    test = [battles[index] for index in fold.test_indices]
    support = compute_support(train, default_skill)
    excluded = () if config.include_sp else (F_SKILL_PAIR,)
    features = select_features(
        support,
        min_support_single=config.min_support_single,
        min_support_pair=config.min_support_pair,
        excluded_families=excluded,
    )
    feature_index = {
        feature_id: index
        for index, feature_id in enumerate(features)
    }
    X_train, y_train = build_design_matrix(train, feature_index, default_skill)
    X_test, y_test = build_design_matrix(test, feature_index, default_skill)
    if config.variant == VARIANT_SEASON_TREND:
        X_train, X_test = _add_season_trend_columns(
            X_train,
            X_test,
            features,
            train,
            test,
        )
    coef, intercept = fit_model(
        X_train,
        y_train,
        c=config.c,
        sample_weight=_sample_weights(train, config.variant),
    )
    unseen_weights = compute_unseen_weights(features, coef)
    unseen_deltas = unseen_feature_deltas(
        test,
        feature_index,
        default_skill,
        unseen_weights,
    )
    probabilities = _sigmoid(X_test @ coef + unseen_deltas + intercept)
    baseline_probability = float(np.mean(y_train)) if len(y_train) else 0.5
    return PredictionRows(
        outcomes=y_test.astype(int).tolist(),
        probabilities=probabilities.astype(float).tolist(),
        baseline_probabilities=[baseline_probability] * len(test),
        group_ids=[group_ids[index] for index in fold.test_indices],
        sources=[battle.source for battle in test],
        seasons=[int(battle.season) for battle in test],
        fold_seasons=[fold.test_season] * len(test),
        feature_counts=[X_train.shape[1]],
        nonzero_rows=int(
            np.count_nonzero(
                np.any(X_test != 0.0, axis=1) | (unseen_deltas != 0.0)
            )
        ),
    )


def evaluate_config(
    config: EvaluationConfig,
    folds: Iterable[RollingFold],
    battles: Sequence[Battle],
    group_ids: Sequence[str],
    default_skill: Mapping[str, str],
) -> PredictionRows:
    rows = PredictionRows.empty()
    for fold in folds:
        rows.extend(
            _evaluate_fold(
                config,
                fold,
                battles,
                group_ids,
                default_skill,
            )
        )
    return rows


def _selection_summary(
    config: EvaluationConfig,
    rows: PredictionRows,
) -> dict[str, Any]:
    metrics = point_metrics(rows.outcomes, rows.probabilities)
    return {
        "config": config.as_dict(),
        "n": len(rows.outcomes),
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
        "mean_n_features": (
            round(float(np.mean(rows.feature_counts)), 1)
            if rows.feature_counts
            else 0.0
        ),
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
        float(metrics["log_loss"]) if metrics["log_loss"] is not None else float("inf"),
        float(metrics["brier"]) if metrics["brier"] is not None else float("inf"),
        -float(metrics["accuracy"]) if metrics["accuracy"] is not None else float("inf"),
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
        strata=rows.fold_seasons,
        bootstrap_samples=bootstrap_samples,
    )
    report["feature_coverage"] = (
        round(rows.nonzero_rows / len(rows.outcomes), 4)
        if rows.outcomes
        else None
    )
    report["baseline"] = prediction_report(
        rows.outcomes,
        rows.baseline_probabilities,
        rows.group_ids,
        rows.sources,
        strata=rows.fold_seasons,
        bootstrap_samples=bootstrap_samples,
    )
    by_season: dict[str, Any] = {}
    for season in sorted(set(rows.fold_seasons)):
        mask = np.asarray(rows.fold_seasons) == season
        by_season[str(season)] = prediction_report(
            np.asarray(rows.outcomes)[mask],
            np.asarray(rows.probabilities)[mask],
            np.asarray(rows.group_ids, dtype=object)[mask],
            np.asarray(rows.sources, dtype=object)[mask],
            bootstrap_samples=bootstrap_samples,
            seed=season,
        )
    report["by_season"] = by_season
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
        or candidate.fold_seasons != reference.fold_seasons
    ):
        raise ValueError("metric deltas require paired prediction rows")
    return paired_prediction_delta_report(
        candidate.outcomes,
        candidate.probabilities,
        reference.probabilities,
        candidate.group_ids,
        strata=candidate.fold_seasons,
        bootstrap_samples=bootstrap_samples,
    )


def evaluate_protocol(
    battles: Sequence[Battle],
    default_skill: Mapping[str, str],
    *,
    final_season: int = FINAL_EVALUATION_SEASON,
    c_candidates: Sequence[float] = C_CANDIDATES,
    single_support_candidates: Sequence[int] = SINGLE_SUPPORT_CANDIDATES,
    pair_support_candidates: Sequence[int] = PAIR_SUPPORT_CANDIDATES,
    bootstrap_samples: int = BOOTSTRAP_SAMPLES,
) -> dict[str, Any]:
    """Tune on rolling development folds and evaluate the locked final once."""
    group_ids = assign_evaluation_groups(
        battles,
        session_gap_seconds=SESSION_GAP_SECONDS,
        cluster_matchups=False,
    )
    (
        development_folds,
        final_fold,
        future_folds,
        underpowered_development_folds,
    ) = build_rolling_folds(
        battles,
        group_ids,
        final_season=final_season,
    )

    cache: dict[EvaluationConfig, PredictionRows] = {}

    def rows_for(config: EvaluationConfig) -> PredictionRows:
        rows = cache.get(config)
        if rows is None:
            rows = evaluate_config(
                config,
                development_folds,
                battles,
                group_ids,
                default_skill,
            )
            cache[config] = rows
        return rows

    # Coordinate search keeps the explicit experiment affordable and auditable:
    # first regularization at production support floors, then support floors at
    # the selected regularization, then feature/temporal variants.
    c_configs = [
        EvaluationConfig(c=candidate)
        for candidate in sorted(set(c_candidates))
    ]
    best_c_config = min(
        c_configs,
        key=lambda config: _selection_sort_key(config, rows_for(config)),
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
        key=lambda config: _selection_sort_key(config, rows_for(config)),
    )

    experiment_configs = [
        EvaluationConfig(
            c=best_support_config.c,
            min_support_single=best_support_config.min_support_single,
            min_support_pair=best_support_config.min_support_pair,
            include_sp=include_sp,
            variant=variant,
        )
        for variant in MODEL_VARIANTS
        for include_sp in (True, False)
    ]
    selected_config = min(
        experiment_configs,
        key=lambda config: _selection_sort_key(config, rows_for(config)),
    )
    selected_development_rows = rows_for(selected_config)
    pooled_sp_enabled = next(
        config
        for config in experiment_configs
        if config.variant == VARIANT_POOLED and config.include_sp
    )
    pooled_sp_disabled = next(
        config
        for config in experiment_configs
        if config.variant == VARIANT_POOLED and not config.include_sp
    )

    production_config = EvaluationConfig()
    final_selected = evaluate_config(
        selected_config,
        [final_fold],
        battles,
        group_ids,
        default_skill,
    )
    final_production = evaluate_config(
        production_config,
        [final_fold],
        battles,
        group_ids,
        default_skill,
    )

    future_reports = []
    for fold in future_folds:
        rows = evaluate_config(
            selected_config,
            [fold],
            battles,
            group_ids,
            default_skill,
        )
        future_reports.append(
            {
                "season": fold.test_season,
                "status": (
                    "descriptive_only_insufficient"
                    if (
                        len(fold.test_indices) < MIN_VALIDATION_BATTLES
                        or len(
                            {
                                group_ids[index]
                                for index in fold.test_indices
                            }
                        )
                        < MIN_VALIDATION_GROUPS
                    )
                    else "descriptive_only_protocol_future"
                ),
                "metrics": _full_report(
                    rows,
                    bootstrap_samples=bootstrap_samples,
                ),
            }
        )

    underpowered_development_reports = []
    for fold in underpowered_development_folds:
        rows = evaluate_config(
            selected_config,
            [fold],
            battles,
            group_ids,
            default_skill,
        )
        underpowered_development_reports.append(
            {
                "season": fold.test_season,
                "status": "descriptive_only_insufficient_sessions",
                "metrics": _full_report(
                    rows,
                    bootstrap_samples=bootstrap_samples,
                ),
            }
        )

    source_counts = Counter(battle.source for battle in battles)
    season_counts = Counter(int(battle.season) for battle in battles)
    source_season_counts = {
        source: Counter(
            int(battle.season)
            for battle in battles
            if battle.source == source
        )
        for source in SOURCE_CATEGORIES
    }
    owner_seasons = set(source_season_counts[SOURCE_UPLOADED_BY_ME])
    other_seasons = set(source_season_counts[SOURCE_UPLOADED_BY_OTHERS])
    if not other_seasons:
        source_comparison_note = (
            "there are no uploaded-by-others observations in this corpus"
        )
    elif not owner_seasons:
        source_comparison_note = (
            "there are no uploaded-by-me observations in this corpus"
        )
    elif owner_seasons.isdisjoint(other_seasons):
        source_comparison_note = (
            "the two sources occur in disjoint seasons, so source and season "
            "effects cannot be separated"
        )
    else:
        source_comparison_note = (
            "source metrics are descriptive; compare within overlapping "
            "seasons before attributing differences to source"
        )

    rolling_validation = _full_report(
        selected_development_rows,
        bootstrap_samples=bootstrap_samples,
    )
    rolling_validation["status"] = (
        "post_selection_apparent_not_confirmatory"
    )
    rolling_validation["note"] = (
        "this candidate was selected on these same development folds; its "
        "interval describes session variation for the chosen predictions but "
        "does not account for configuration-selection optimism"
    )

    report = {
        "protocol": {
            "version": EVALUATION_PROTOCOL_VERSION,
            "name": "grouped-rolling-season-evaluation",
            "final_season": final_season,
            "final_status": (
                "locked within this protocol, but not guaranteed historically "
                "unseen because earlier evaluation work examined this corpus"
            ),
            "development_seasons": [
                fold.test_season
                for fold in development_folds
            ],
            "underpowered_development_seasons": [
                fold.test_season
                for fold in underpowered_development_folds
            ],
            "minimum_fold_evidence": {
                "train_battles": MIN_TRAIN_BATTLES,
                "train_sessions": MIN_TRAIN_GROUPS,
                "validation_battles": MIN_VALIDATION_BATTLES,
                "validation_sessions": MIN_VALIDATION_GROUPS,
            },
            "selection_metric": (
                "micro-pooled out-of-fold log loss, then Brier, accuracy, "
                "and deterministic simplicity"
            ),
            "session_gap_seconds": SESSION_GAP_SECONDS,
            "calendar_day_grouping": False,
            "session_season_boundary": True,
            "near_duplicate_max_skill_replacements": (
                NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS
            ),
            "source_categories": list(SOURCE_CATEGORIES),
            "source_comparison_note": source_comparison_note,
            "confidence_intervals": (
                "deterministic 95% percentile bootstrap over whole "
                "capture/upload sessions, stratified by rolling season fold "
                "for pooled development metrics; status and eligibility use "
                "the weakest stratum, with intervals omitted below five "
                "sessions and marked exploratory below twenty"
            ),
        },
        "corpus": {
            "corpus_version": compute_corpus_version(list(battles)),
            "evaluation_version": compute_evaluation_version(list(battles)),
            "n_battles": len(battles),
            "n_groups": len(set(group_ids)),
            "by_season": {
                str(season): season_counts[season]
                for season in sorted(season_counts)
            },
            "by_source": {
                source: source_counts.get(source, 0)
                for source in SOURCE_CATEGORIES
            },
            "by_source_and_season": {
                source: {
                    str(season): source_season_counts[source][season]
                    for season in sorted(source_season_counts[source])
                }
                for source in SOURCE_CATEGORIES
            },
        },
        "production_model": {
            "changed": False,
            "current_config": production_config.as_dict(),
            "note": (
                "candidate results are evaluation-only and are not fed into "
                "the production artifact builder"
            ),
        },
        "tuning": {
            "regularization": {
                "selected_C": best_c_config.c,
                "candidates": [
                    _selection_summary(config, rows_for(config))
                    for config in sorted(
                        c_configs,
                        key=lambda config: _selection_sort_key(
                            config,
                            rows_for(config),
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
                    _selection_summary(config, rows_for(config))
                    for config in sorted(
                        support_configs,
                        key=lambda config: _selection_sort_key(
                            config,
                            rows_for(config),
                        ),
                    )
                ],
            },
        },
        "experiments": {
            "selected_candidate": selected_config.as_dict(),
            "sp_ablation": {
                "enabled": _selection_summary(
                    pooled_sp_enabled,
                    rows_for(pooled_sp_enabled),
                ),
                "disabled": _selection_summary(
                    pooled_sp_disabled,
                    rows_for(pooled_sp_disabled),
                ),
                "disabled_minus_enabled": _paired_delta_report(
                    rows_for(pooled_sp_disabled),
                    rows_for(pooled_sp_enabled),
                    bootstrap_samples=bootstrap_samples,
                ),
            },
            "temporal_variants": {
                variant: [
                    _selection_summary(config, rows_for(config))
                    for config in experiment_configs
                    if config.variant == variant
                ]
                for variant in MODEL_VARIANTS
            },
            "candidates": [
                _selection_summary(config, rows_for(config))
                for config in sorted(
                    experiment_configs,
                    key=lambda config: _selection_sort_key(
                        config,
                        rows_for(config),
                    ),
                )
            ],
        },
        "rolling_validation": rolling_validation,
        "underpowered_development": underpowered_development_reports,
        "final_test": {
            "season": final_season,
            "selected_candidate": {
                "config": selected_config.as_dict(),
                "metrics": _full_report(
                    final_selected,
                    bootstrap_samples=bootstrap_samples,
                ),
            },
            "current_production_configuration": {
                "config": production_config.as_dict(),
                "metrics": _full_report(
                    final_production,
                    bootstrap_samples=bootstrap_samples,
                ),
            },
            "candidate_minus_current": _paired_delta_report(
                final_selected,
                final_production,
                bootstrap_samples=bootstrap_samples,
            ),
        },
        "future_seasons": future_reports,
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
        "--final-season",
        type=int,
        default=FINAL_EVALUATION_SEASON,
    )
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
        battles, catalog = _load_evaluation_corpus(
            args.battles_dir,
            args.web_upload_dir,
            args.web_upload_state,
            args.database,
        )
        report = evaluate_protocol(
            battles,
            catalog["default_skill"],
            final_season=args.final_season,
            bootstrap_samples=args.bootstrap_samples,
        )
    except (InvalidBattleError, ValueError) as exc:
        print(f"Evaluation failed: {exc}", file=sys.stderr)
        return 1

    _write_json_atomic(args.output, report)
    selected = report["experiments"]["selected_candidate"]
    validation = report["rolling_validation"]
    final = report["final_test"]["selected_candidate"]["metrics"]
    print(
        f"✓ Wrote {args.output}: selected {selected}; "
        f"rolling logloss={validation['log_loss']}, "
        f"final S{args.final_season} accuracy={final['accuracy']}, "
        f"logloss={final['log_loss']}."
    )
    print("  Production weights were not changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
