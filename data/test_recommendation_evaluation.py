"""Focused tests for the season-independent grouped evaluation protocol."""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(__file__))

import build_recommendation_data as builder  # noqa: E402
import evaluate_recommendation_model as evaluator  # noqa: E402
from build_recommendation_data import (  # noqa: E402
    Battle,
    backtest,
    compute_corpus_version,
    compute_evaluation_version,
    load_battles,
)
from recommendation_evaluation import (  # noqa: E402
    GROUP_HOLDOUT_SEED,
    SESSION_GAP_SECONDS,
    SOURCE_CATEGORIES,
    SOURCE_EXTERNAL_YANWU,
    SOURCE_UPLOADED_BY_ME,
    SOURCE_UPLOADED_BY_OTHERS,
    assign_evaluation_groups,
    grouped_hash_split,
    matchup_skill_replacements,
    prediction_report,
    stable_group_holdout_ids,
)


def _hero(
    name: str,
    first_skill: str | None = None,
    second_skill: str | None = None,
) -> dict[str, object]:
    return {
        "name": name,
        "skills": [
            f"{name}-signature",
            first_skill or f"{name}-one",
            second_skill or f"{name}-two",
        ],
    }


def _teams(tag: str) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    return (
        [_hero(f"{tag}-A"), _hero(f"{tag}-B"), _hero(f"{tag}-C")],
        [_hero(f"{tag}-D"), _hero(f"{tag}-E"), _hero(f"{tag}-F")],
    )


def _battle(
    filename: str,
    *,
    tag: str | None = None,
    season: int | None = None,
    captured_at: float | None = None,
    source: str = SOURCE_UPLOADED_BY_ME,
    uploader: str = "",
    evaluation_identity: str = "",
    winner: int = 1,
    teams: tuple[
        list[dict[str, object]],
        list[dict[str, object]],
    ]
    | None = None,
) -> Battle:
    team1, team2 = copy.deepcopy(teams or _teams(tag or filename))
    return Battle(
        filename=filename,
        team1=team1,
        team2=team2,
        winner=winner,
        order_key=filename,
        season=season,
        source=source,
        captured_at=captured_at,
        uploader_identity=uploader,
        evaluation_identity=evaluation_identity,
    )


def _signal_battle(
    serial: int,
    *,
    season: int | None,
    source: str = SOURCE_UPLOADED_BY_ME,
    winner: int | None = None,
) -> Battle:
    strong = [
        _hero("strong", "shared-one", "shared-two"),
        _hero(f"strong-{serial}-A", "shared-one", "shared-two"),
        _hero(f"strong-{serial}-B", "shared-one", "shared-two"),
    ]
    weak = [
        _hero("weak", "shared-one", "shared-two"),
        _hero(f"weak-{serial}-A", "shared-one", "shared-two"),
        _hero(f"weak-{serial}-B", "shared-one", "shared-two"),
    ]
    if serial % 2:
        teams = (weak, strong)
        expected_winner = 2
    else:
        teams = (strong, weak)
        expected_winner = 1
    return _battle(
        f"{source}-{serial:04d}.json",
        season=season,
        captured_at=float(serial * (SESSION_GAP_SECONDS + 1)),
        source=source,
        uploader=(
            f"contributor-{serial}"
            if source == SOURCE_UPLOADED_BY_OTHERS
            else ""
        ),
        winner=winner or expected_winner,
        teams=teams,
    )


def _catalog_seasons_for(battles: list[Battle]) -> builder._CatalogSeasons:
    heroes: dict[str, int] = {}
    skills: dict[str, int] = {}
    for battle in battles:
        for team in (battle.team1, battle.team2):
            for hero in team:
                heroes[str(hero["name"])] = 1
                for skill in hero["skills"]:
                    skills[str(skill)] = 1
    return builder._CatalogSeasons(heroes=heroes, skills=skills)


def _locked_manifest(battles: list[Battle]) -> dict[str, object]:
    return evaluator.create_locked_test_manifest(battles)


def _protocol_corpus() -> list[Battle]:
    pre = [
        _signal_battle(
            serial,
            season=10 + serial % 6,
            source=(
                SOURCE_UPLOADED_BY_OTHERS
                if serial % 5 == 0
                else SOURCE_UPLOADED_BY_ME
            ),
        )
        for serial in range(100)
    ]
    yanwu = [
        _signal_battle(
            1_000 + serial,
            season=None,
            source=SOURCE_EXTERNAL_YANWU,
        )
        for serial in range(80)
    ]
    return [*pre, *yanwu]


def test_thirty_minute_session_window_crosses_midnight(tmp_path: Path):
    captures = tmp_path / "battles"
    captures.mkdir()
    raw = {
        "1": _teams("raw")[0],
        "2": _teams("raw")[1],
        "winner": "1",
        "season": 15,
    }
    for filename in (
        "2025-12-31-235500.json",
        "2026-01-01-001500.json",
        "2026-01-01-004501.json",
    ):
        (captures / filename).write_text(json.dumps(raw), encoding="utf-8")

    battles, errors = load_battles(str(captures))
    groups = assign_evaluation_groups(battles, cluster_matchups=False)

    assert errors == []
    assert groups[0] == groups[1]
    assert groups[2] != groups[1]


def test_session_grouping_is_independent_of_season():
    battles = [
        _battle("a.json", season=14, captured_at=100),
        _battle("b.json", season=None, captured_at=110),
        _battle("c.json", season=15, captured_at=120),
    ]

    groups = assign_evaluation_groups(battles, cluster_matchups=False)

    assert len(set(groups)) == 1


def test_source_and_exact_contributor_keep_sessions_separate():
    battles = [
        _battle("manual.json", captured_at=100),
        _battle(
            "alice-1.json",
            captured_at=100,
            source=SOURCE_UPLOADED_BY_OTHERS,
            uploader="Alice",
        ),
        _battle(
            "alice-2.json",
            captured_at=200,
            source=SOURCE_UPLOADED_BY_OTHERS,
            uploader="Alice",
        ),
        _battle(
            "bob.json",
            captured_at=100,
            source=SOURCE_UPLOADED_BY_OTHERS,
            uploader="Bob",
        ),
    ]

    groups = assign_evaluation_groups(battles, cluster_matchups=False)

    assert groups[1] == groups[2]
    assert len({groups[0], groups[1], groups[3]}) == 3


def test_external_reports_start_as_stable_individual_groups():
    battles = [
        _battle(
            f"external-{index}.json",
            tag=f"unique-{index}",
            source=SOURCE_EXTERNAL_YANWU,
            season=None,
            captured_at=float(index),
        )
        for index in range(3)
    ]

    groups = assign_evaluation_groups(battles, cluster_matchups=False)
    clustered = assign_evaluation_groups(battles, cluster_matchups=True)

    assert len(set(groups)) == 3
    assert len(set(clustered)) == 3


def test_external_group_membership_uses_immutable_evaluation_identity():
    original = _battle(
        "external-yanwu/00000001-report.json",
        source=SOURCE_EXTERNAL_YANWU,
        evaluation_identity="external-yanwu/00000001-report.json",
    )
    changed = copy.deepcopy(original)
    changed.filename = "external-yanwu/S7/99999999-report.json"
    changed.order_key = "2-0007-99999999-report"
    changed.season = 7

    assert assign_evaluation_groups([original]) == assign_evaluation_groups([changed])


def test_exact_and_near_duplicate_matchups_merge_without_using_winner():
    original = _battle("original.json", tag="same", winner=1)
    exact = _battle(
        "exact.json",
        winner=2,
        teams=(original.team2, original.team1),
    )
    near_teams = copy.deepcopy((original.team1, original.team2))
    near_teams[0][0]["skills"][1] = "one-replacement"
    near = _battle("near.json", winner=2, teams=near_teams)
    different_teams = copy.deepcopy((original.team1, original.team2))
    different_teams[0][0]["skills"][1] = "replacement-one"
    different_teams[0][0]["skills"][2] = "replacement-two"
    different = _battle("different.json", teams=different_teams)
    battles = [original, exact, near, different]

    groups = assign_evaluation_groups(battles, cluster_matchups=True)

    assert matchup_skill_replacements(original, near) == 1
    assert matchup_skill_replacements(original, different) == 2
    assert groups[0] == groups[1] == groups[2]
    assert groups[3] != groups[0]


def test_stable_hash_holdout_ignores_season_and_outcome():
    battles = [
        _battle(
            f"battle-{index}.json",
            tag=f"tag-{index}",
            season=10 + index,
            winner=1 + index % 2,
        )
        for index in range(20)
    ]
    groups = assign_evaluation_groups(battles, cluster_matchups=True)
    original = stable_group_holdout_ids(groups, 0.2, seed=GROUP_HOLDOUT_SEED)
    changed = copy.deepcopy(battles)
    for battle in changed:
        battle.season = None
        battle.winner = 3 - battle.winner
    changed_groups = assign_evaluation_groups(changed, cluster_matchups=True)

    assert groups == changed_groups
    assert original == stable_group_holdout_ids(
        changed_groups,
        0.2,
        seed=GROUP_HOLDOUT_SEED,
    )
    train, test, train_groups, test_groups = grouped_hash_split(
        changed,
        changed_groups,
        0.2,
    )
    assert len(train) == 16
    assert len(test) == 4
    assert set(train_groups).isdisjoint(test_groups)


def test_full_split_locks_pre_yanwu_test_and_removes_matching_yanwu_group():
    original_corpus = _protocol_corpus()
    pre = [
        battle
        for battle in original_corpus
        if battle.source != SOURCE_EXTERNAL_YANWU
    ]
    yanwu = [
        battle
        for battle in original_corpus
        if battle.source == SOURCE_EXTERNAL_YANWU
    ]
    locked_manifest = _locked_manifest(pre)
    pre_split = evaluator.build_grouped_split(
        pre,
        locked_manifest,
        minimum_development_battles=1,
    )
    locked = pre[pre_split.test_indices[0]]
    duplicate = _battle(
        "external-duplicate.json",
        season=None,
        captured_at=999_999,
        source=SOURCE_EXTERNAL_YANWU,
        winner=3 - locked.winner,
        teams=(locked.team1, locked.team2),
    )
    corpus = [*pre, duplicate, *yanwu]

    split = evaluator.build_grouped_split(corpus, locked_manifest)

    assert split.locked_test_group_set_hash == pre_split.locked_test_group_set_hash
    assert [corpus[index].filename for index in split.test_indices] == [
        pre[index].filename for index in pre_split.test_indices
    ]
    assert len(split.excluded_indices) == 1
    assert corpus[split.excluded_indices[0]].filename == "external-duplicate.json"
    assert split.removed_yanwu_battles == 1
    assert split.removed_yanwu_groups == 1
    partitions = [
        {split.group_ids[index] for index in indices}
        for indices in (
            split.train_indices,
            split.development_indices,
            split.test_indices,
        )
    ]
    assert partitions[0].isdisjoint(partitions[1])
    assert partitions[0].isdisjoint(partitions[2])
    assert partitions[1].isdisjoint(partitions[2])


def test_locked_manifest_keeps_test_population_after_new_pre_yanwu_upload():
    battles = _protocol_corpus()
    locked_manifest = _locked_manifest(battles)
    original = evaluator.build_grouped_split(battles, locked_manifest)
    new_upload = _battle(
        "web-upload/new-report.json",
        tag="new-report",
        season=16,
        captured_at=9_999_999,
        source=SOURCE_UPLOADED_BY_OTHERS,
        uploader="new-contributor",
    )
    augmented = [*battles, new_upload]

    changed = evaluator.build_grouped_split(augmented, locked_manifest)

    assert [augmented[index].filename for index in changed.test_indices] == [
        battles[index].filename for index in original.test_indices
    ]
    assert changed.locked_test_group_set_hash == original.locked_test_group_set_hash


def test_builder_backtest_uses_grouped_stable_hash_protocol():
    battles = _protocol_corpus()

    report = backtest(battles, {})

    assert report["protocol"]["name"] == "grouped-stable-hash-holdout"
    assert report["protocol"]["seed"] == GROUP_HOLDOUT_SEED
    assert report["protocol"]["split_excludes"] == [
        "season",
        "winner",
        "outcome",
    ]
    assert report["n_train"] + report["n_test"] == len(battles)
    assert report["n_train_groups"] > 0
    assert report["n_test_groups"] > 0
    assert set(report["source_breakdown"]) == set(SOURCE_CATEGORIES)
    assert set(report["split_balance"]) == {"train", "test"}


def test_cluster_confidence_intervals_and_source_breakdown_are_deterministic():
    outcomes = [0, 1] * 10
    probabilities = [0.1, 0.9] * 10
    groups = [f"group-{index}" for index in range(10) for _ in range(2)]
    sources = [SOURCE_UPLOADED_BY_ME] * 10 + [SOURCE_UPLOADED_BY_OTHERS] * 10

    report = prediction_report(
        outcomes,
        probabilities,
        groups,
        sources,
        bootstrap_samples=64,
        seed=19,
    )
    repeated = prediction_report(
        outcomes,
        probabilities,
        groups,
        sources,
        bootstrap_samples=64,
        seed=19,
    )

    assert report == repeated
    assert report["confidence_intervals_95"]["accuracy"] is not None
    assert list(report["by_source"]) == list(SOURCE_CATEGORIES)


def test_trusted_season_changes_model_version_but_not_group_membership():
    original = _battle("same.json", season=14, captured_at=100)
    changed = copy.deepcopy(original)
    changed.season = 15

    assert compute_corpus_version([original]) != compute_corpus_version([changed])
    assert assign_evaluation_groups([original]) == assign_evaluation_groups([changed])
    assert compute_evaluation_version([original]) != compute_evaluation_version(
        [changed]
    )


def test_locked_test_outcomes_cannot_change_selection_or_split():
    battles = _protocol_corpus()
    locked_manifest = _locked_manifest(battles)
    split = evaluator.build_grouped_split(battles, locked_manifest)
    changed = copy.deepcopy(battles)
    for index in split.test_indices:
        changed[index].winner = 3 - changed[index].winner
    catalog = _catalog_seasons_for(battles)
    kwargs = {
        "catalog_version": "test-catalog",
        "c_candidates": (0.1, 0.5),
        "single_support_candidates": (3, 5),
        "pair_support_candidates": (5, 8),
        "selection_prior_hero_strength_candidates": (0.0, 0.4),
        "selection_prior_skill_strength_candidates": (0.0, 0.3),
        "selection_prior_smoothing_candidates": (20.0,),
        "selection_prior_log_ratio_clip_candidates": (2.0,),
        "bootstrap_samples": 0,
    }

    original_report = evaluator.evaluate_protocol(
        battles,
        {},
        catalog,
        locked_manifest,
        **kwargs,
    )
    changed_report = evaluator.evaluate_protocol(
        changed,
        {},
        catalog,
        locked_manifest,
        **kwargs,
    )

    assert original_report["protocol"] == changed_report["protocol"]
    assert original_report["tuning"] == changed_report["tuning"]
    assert original_report["experiments"] == changed_report["experiments"]
    assert (
        original_report["development_validation"]
        == changed_report["development_validation"]
    )


def test_protocol_reports_controlled_yanwu_comparison_and_no_temporal_variants():
    battles = _protocol_corpus()
    report = evaluator.evaluate_protocol(
        battles,
        {},
        _catalog_seasons_for(battles),
        _locked_manifest(battles),
        catalog_version="test-catalog",
        c_candidates=(0.5,),
        single_support_candidates=(5,),
        pair_support_candidates=(8,),
        selection_prior_hero_strength_candidates=(0.0, 0.4),
        selection_prior_skill_strength_candidates=(0.0, 0.3),
        selection_prior_smoothing_candidates=(20.0,),
        selection_prior_log_ratio_clip_candidates=(2.0,),
        bootstrap_samples=32,
    )

    controlled = report["controlled_yanwu_comparison"]
    assert set(report["production_model"]["atomic_support_buckets"]) == {"H", "S"}
    assert report["production_model"]["atomic_support_buckets"]["H"]["0-19"][
        "item_count"
    ] >= 0
    assert report["protocol"]["split_membership_excludes"] == [
        "season",
        "winner",
        "outcome",
    ]
    assert report["corpus"]["unknown_season_battles"] == 80
    assert set(report["split_balance"]) == {
        "train",
        "development",
        "locked_test",
        "excluded_test_duplicate_groups",
    }
    assert controlled["baseline_training"]["n_battles"] == 80
    assert controlled["candidate_training"]["yanwu_battles_added"] == 80
    assert controlled["locked_test"]["n_battles"] == 20
    assert set(controlled["candidate_minus_baseline"]["by_source"]) == set(
        SOURCE_CATEGORIES
    )
    assert controlled["conclusion"] in {
        "candidate_improvement_supported_on_all_three_metrics",
        "inconclusive_no_improvement_claim",
    }
    assert "temporal_variants" not in report["experiments"]
    assert "rolling_validation" not in report
    assert "future_seasons" not in report


def test_main_runs_tiny_protocol_without_mutating_production_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    battles = _protocol_corpus()
    catalog_seasons = _catalog_seasons_for(battles)
    production_path = tmp_path / "web" / "src" / "recommendation_data.json"
    production_path.parent.mkdir(parents=True)
    production_bytes = b'{"production":"sentinel"}\n'
    production_path.write_bytes(production_bytes)
    output_path = tmp_path / "evaluation.json"
    locked_manifest_path = tmp_path / "locked-test.json"
    locked_manifest_path.write_text(
        json.dumps(_locked_manifest(battles)),
        encoding="utf-8",
    )

    real_protocol = evaluator.evaluate_protocol

    def tiny_protocol(
        loaded_battles,
        default_skill,
        loaded_catalog_seasons,
        locked_test_manifest,
        *,
        catalog_version,
        feature_catalog,
        bootstrap_samples,
    ):
        return real_protocol(
            loaded_battles,
            default_skill,
            loaded_catalog_seasons,
            locked_test_manifest,
            catalog_version=catalog_version,
            feature_catalog=feature_catalog,
            c_candidates=(0.5,),
            single_support_candidates=(5,),
            pair_support_candidates=(8,),
            selection_prior_hero_strength_candidates=(0.0, 0.4),
            selection_prior_skill_strength_candidates=(0.0, 0.3),
            selection_prior_smoothing_candidates=(20.0,),
            selection_prior_log_ratio_clip_candidates=(2.0,),
            bootstrap_samples=bootstrap_samples,
        )

    monkeypatch.setattr(
        evaluator,
        "_load_evaluation_corpus",
        lambda *_args, **_kwargs: (
            battles,
            {"catalog_version": "test-catalog", "default_skill": {}},
            catalog_seasons,
        ),
    )
    monkeypatch.setattr(evaluator, "evaluate_protocol", tiny_protocol)
    monkeypatch.chdir(tmp_path)

    result = evaluator.main(
        [
            "--output",
            str(output_path),
            "--bootstrap-samples",
            "8",
            "--locked-test-manifest",
            str(locked_manifest_path),
        ]
    )
    report = json.loads(output_path.read_text(encoding="utf-8"))

    assert result == 0
    assert production_path.read_bytes() == production_bytes
    assert report["production_model"]["changed"] is False
    assert report["development_validation"]["n"] > 0
    assert report["locked_test"]["selected_candidate"]["metrics"]["n"] == 20


def test_main_rejects_a_symlink_to_the_production_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    production_path = tmp_path / "web" / "src" / "recommendation_data.json"
    production_path.parent.mkdir(parents=True)
    production_bytes = b'{"production":"sentinel"}\n'
    production_path.write_bytes(production_bytes)
    output_alias = tmp_path / "evaluation.json"
    output_alias.symlink_to(production_path)
    monkeypatch.setattr(
        evaluator,
        "PRODUCTION_ARTIFACT_PATH",
        str(production_path),
    )
    monkeypatch.chdir(tmp_path)

    result = evaluator.main(["--output", str(output_alias)])

    assert result == 1
    assert production_path.read_bytes() == production_bytes
