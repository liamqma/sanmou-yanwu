"""Focused tests for the grouped recommendation-evaluation protocol."""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

import numpy as np
import pytest

# Keep imports stable whether pytest is started at the repository root or in
# ``data/``.
sys.path.insert(0, os.path.dirname(__file__))

import build_recommendation_data as builder  # noqa: E402
import evaluate_recommendation_model as evaluator  # noqa: E402
from build_recommendation_data import (  # noqa: E402
    F_SKILL_PAIR,
    Battle,
    backtest,
    compute_corpus_version,
    compute_evaluation_version,
    compute_support,
    load_battles,
    select_features,
)
from recommendation_evaluation import (  # noqa: E402
    SESSION_GAP_SECONDS,
    SOURCE_CATEGORIES,
    SOURCE_UPLOADED_BY_ME,
    SOURCE_UPLOADED_BY_OTHERS,
    assign_evaluation_groups,
    assign_matchup_clusters,
    grouped_chronological_split,
    matchup_skill_replacements,
    prediction_report,
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
    )


def _raw_battle(*, season: int = 15, **metadata: object) -> dict[str, object]:
    team1, team2 = _teams("raw")
    return {
        "1": team1,
        "2": team2,
        "winner": "1",
        "season": season,
        **metadata,
    }


def _database_for(raw: dict[str, object]) -> dict[str, object]:
    heroes: dict[str, object] = {}
    skills: dict[str, object] = {}
    for team_key in ("1", "2"):
        for hero in raw[team_key]:
            hero_name = hero["name"]
            hero_skills = hero["skills"]
            heroes[hero_name] = {
                "skill": hero_skills[0],
                "season": 1,
            }
            for skill in hero_skills:
                skills[skill] = {
                    "color": "orange",
                    "season": 1,
                }
    return {"heroes": heroes, "skills": skills}


def _signal_battle(
    serial: int,
    season: int | None,
    *,
    captured_at: float,
    source: str = SOURCE_UPLOADED_BY_ME,
) -> Battle:
    """Return a unique valid 3v3 matchup with one shared predictive hero."""
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
        winner = 2
    else:
        teams = (strong, weak)
        winner = 1
    return _battle(
        f"battle-{serial:04d}.json",
        season=season,
        captured_at=captured_at,
        source=source,
        uploader=f"contributor-{serial}" if source == SOURCE_UPLOADED_BY_OTHERS else "",
        winner=winner,
        teams=teams,
    )


def _clone_battle(
    battle: Battle,
    filename: str,
    *,
    season: int | None = None,
    captured_at: float | None = None,
    source: str | None = None,
) -> Battle:
    return _battle(
        filename,
        season=battle.season if season is None else season,
        captured_at=battle.captured_at if captured_at is None else captured_at,
        source=battle.source if source is None else source,
        winner=battle.winner,
        teams=(battle.team1, battle.team2),
    )


def test_thirty_minute_inactivity_window_crosses_midnight(tmp_path: Path):
    captures = tmp_path / "battles"
    captures.mkdir()
    filenames = [
        "2025-12-31-235500.json",
        "2026-01-01-001500.json",
        "2026-01-01-004501.json",
    ]
    for filename in filenames:
        (captures / filename).write_text(
            json.dumps(_raw_battle()),
            encoding="utf-8",
        )

    battles, errors = load_battles(str(captures))
    assert errors == []
    assert battles[1].captured_at - battles[0].captured_at == 20 * 60
    assert battles[2].captured_at - battles[1].captured_at == 30 * 60 + 1

    groups = assign_evaluation_groups(
        battles,
        session_gap_seconds=SESSION_GAP_SECONDS,
        cluster_matchups=False,
    )
    assert groups[0] == groups[1]
    assert groups[2] != groups[1]


def test_session_grouping_partitions_seasons_before_scanning_timestamps():
    battles = [
        _battle("season-14-a.json", season=14, captured_at=100),
        _battle("unknown.json", season=None, captured_at=110),
        _battle("season-15.json", season=15, captured_at=120),
        _battle("season-14-b.json", season=14, captured_at=130),
    ]

    groups = assign_evaluation_groups(battles, cluster_matchups=False)

    # Unknown cannot bridge S14 to S15, while the interleaved S15 capture
    # cannot split two nearby S14 captures.
    assert groups[0] == groups[3]
    assert groups[1] not in {groups[0], groups[2]}
    assert groups[2] != groups[0]


def test_source_and_exact_contributor_keep_upload_sessions_separate():
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
            captured_at=200,
            source=SOURCE_UPLOADED_BY_OTHERS,
            uploader="Bob",
        ),
    ]

    groups = assign_evaluation_groups(battles, cluster_matchups=False)

    assert groups[1] == groups[2]
    assert groups[0] != groups[1]
    assert groups[3] not in {groups[0], groups[1]}


def test_load_battles_records_only_the_two_approved_source_categories(
    tmp_path: Path,
):
    uploads = tmp_path / "web-upload"
    uploads.mkdir()
    raw = _raw_battle(
        season=16,
        uploader_name="Exact Contributor",
        uploaded_at="2026-01-02T03:04:05Z",
    )
    (uploads / "web-battle-00000001.json").write_text(
        json.dumps(raw),
        encoding="utf-8",
    )

    battles, errors = load_battles(
        str(uploads),
        filename_prefix="web-upload/",
        source=SOURCE_UPLOADED_BY_OTHERS,
    )

    assert errors == []
    assert SOURCE_CATEGORIES == (
        "uploaded_by_me",
        "uploaded_by_others",
    )
    assert battles[0].source == SOURCE_UPLOADED_BY_OTHERS
    assert battles[0].uploader_identity == "Exact Contributor"
    assert battles[0].captured_at is not None
    assert battles[0].season == 16
    assert battles[0].filename == "web-upload/web-battle-00000001.json"

    with pytest.raises(ValueError, match="unknown battle source"):
        load_battles(str(uploads), source="some-third-source")


def test_evaluation_loader_maps_the_two_corpus_directories_to_sources(
    tmp_path: Path,
):
    manual_dir = tmp_path / "battles"
    upload_dir = tmp_path / "web-upload"
    manual_dir.mkdir()
    upload_dir.mkdir()
    manual = _raw_battle(season=14)
    uploaded = _raw_battle(
        season=16,
        uploader_name="Contributor",
        uploaded_at="2026-01-02T03:04:05Z",
    )
    (manual_dir / "2025-12-31-235500.json").write_text(
        json.dumps(manual),
        encoding="utf-8",
    )
    (upload_dir / "web-battle-00000001.json").write_text(
        json.dumps(uploaded),
        encoding="utf-8",
    )
    database_path = tmp_path / "database.json"
    database_path.write_text(
        json.dumps(_database_for(manual)),
        encoding="utf-8",
    )
    state_path = tmp_path / "web_upload_state.json"
    state_path.write_text(
        json.dumps(
            {
                "fingerprints": {
                    "version": builder.DUPLICATE_FINGERPRINT_VERSION,
                    "algorithm": builder.DUPLICATE_FINGERPRINT_ALGORITHM,
                    "web": {"0" * 64: 1},
                }
            }
        ),
        encoding="utf-8",
    )

    battles, _catalog = evaluator._load_evaluation_corpus(
        str(manual_dir),
        str(upload_dir),
        str(state_path),
        str(database_path),
    )

    assert [battle.source for battle in battles] == [
        SOURCE_UPLOADED_BY_ME,
        SOURCE_UPLOADED_BY_OTHERS,
    ]
    assert battles[1].uploader_identity == "Contributor"


def test_legacy_img_files_group_only_consecutive_numbers():
    battles = [
        _battle("IMG_0099.json"),
        _battle("IMG_0100.json"),
        _battle("IMG_0102.json"),
        _battle("unreviewed-name.json"),
    ]

    groups = assign_evaluation_groups(battles, cluster_matchups=False)

    assert groups[0] == groups[1]
    assert groups[2] != groups[1]
    assert groups[3] not in set(groups[:3])


def test_legacy_unknown_season_cannot_bridge_known_seasons():
    battles = [
        _battle("IMG_0099.json", season=14),
        _battle("IMG_0100.json", season=None),
        _battle("IMG_0101.json", season=15),
    ]

    groups = assign_evaluation_groups(battles, cluster_matchups=False)

    assert len(set(groups)) == 3


def test_near_duplicate_clusters_use_inclusive_threshold_and_transitivity():
    base = _battle("base.json", tag="same", captured_at=0)
    one_change = _clone_battle(base, "one.json", captured_at=2_000)
    one_change.team1[0]["skills"][2] = "replacement-A"
    two_changes = _clone_battle(one_change, "two.json", captured_at=4_000)
    two_changes.team1[1]["skills"][2] = "replacement-B"

    assert matchup_skill_replacements(base, one_change) == 1
    assert matchup_skill_replacements(one_change, two_changes) == 1
    assert matchup_skill_replacements(base, two_changes) == 2

    # Capture sessions remain independent; near duplicates have their own
    # transitive relationship for train/test contamination checks.
    sessions = assign_evaluation_groups(
        [base, one_change, two_changes],
        cluster_matchups=False,
    )
    clusters = assign_matchup_clusters([base, one_change, two_changes])
    assert len(set(sessions)) == 3
    assert len(set(clusters)) == 1

    beyond_threshold = assign_matchup_clusters([base, two_changes])
    assert beyond_threshold[0] != beyond_threshold[1]


def test_matchup_clusters_ignore_side_hero_skill_order_and_heldout_winner():
    base = _battle("base.json", tag="ordered", winner=1)
    swapped_teams = (
        list(reversed(copy.deepcopy(base.team2))),
        list(reversed(copy.deepcopy(base.team1))),
    )
    for team in swapped_teams:
        for hero in team:
            hero["skills"][1], hero["skills"][2] = (
                hero["skills"][2],
                hero["skills"][1],
            )
    reordered = _battle(
        "reordered.json",
        teams=swapped_teams,
        winner=2,
    )
    opposite_result = _clone_battle(base, "opposite.json")
    opposite_result.winner = 2

    clusters = assign_matchup_clusters(
        [base, reordered, opposite_result],
    )

    assert clusters[0] == clusters[1]
    assert clusters[2] == clusters[0]


def test_grouped_chronological_split_never_splits_the_latest_session():
    battles = [
        _battle(f"{index}.json", captured_at=float(index))
        for index in range(5)
    ]
    group_ids = ["early", "middle", "latest", "latest", "latest"]

    train, test, train_groups, test_groups = grouped_chronological_split(
        battles,
        group_ids,
        holdout_frac=0.2,
    )

    assert [battle.filename for battle in train] == ["0.json", "1.json"]
    assert [battle.filename for battle in test] == [
        "2.json",
        "3.json",
        "4.json",
    ]
    assert set(train_groups).isdisjoint(test_groups)


def test_rolling_folds_keep_sessions_whole_and_purge_matchup_contamination():
    battles = [
        _battle("seed.json", season=12),
        _battle("contaminated.json", season=13),
        _battle("same-session.json", season=13),
        _battle("development-13.json", season=13),
        _battle("development-14.json", season=14),
        _battle("cross-season-start.json", season=14),
        _battle("cross-season-end.json", season=15),
        _battle("final.json", season=15),
        _battle("future.json", season=16),
    ]
    session_ids = [
        "seed",
        "contaminated-session",
        "contaminated-session",
        "development-13",
        "development-14",
        "cross-final-session",
        "cross-final-session",
        "final-session",
        "future-session",
    ]
    matchup_ids = [
        "seed-matchup",
        "shared-with-final",
        "unrelated-same-session",
        "development-13-matchup",
        "development-14-matchup",
        "cross-start-matchup",
        "cross-end-matchup",
        "shared-with-final",
        "future-matchup",
    ]

    development, final, future, underpowered = evaluator.build_rolling_folds(
        battles,
        session_ids,
        matchup_cluster_ids=matchup_ids,
        final_season=15,
        minimum_train_battles=1,
        minimum_validation_battles=1,
        minimum_train_groups=1,
        minimum_validation_groups=1,
    )

    assert [fold.test_season for fold in development] == [13, 14]
    assert underpowered == []
    # Only actual S15 rows are scored. The S14 companion from the caller's
    # cross-season group is excluded from training instead of relabeled.
    assert final.test_indices == (6, 7)
    # One near duplicate removes its whole earlier session, including index 2.
    assert final.train_indices == (0, 3, 4)
    assert len(future) == 1
    assert future[0].test_indices == (8,)

    for fold in [*development, final, *future]:
        train_sessions = {session_ids[index] for index in fold.train_indices}
        test_sessions = {session_ids[index] for index in fold.test_indices}
        assert train_sessions.isdisjoint(test_sessions)


def test_future_matchup_cannot_bridge_an_earlier_development_fold():
    train_matchup = _battle("train.json", tag="bridge", season=12)
    future_bridge = _clone_battle(
        train_matchup,
        "future.json",
        season=15,
    )
    future_bridge.team1[0]["skills"][2] = "replacement-A"
    development_matchup = _clone_battle(
        future_bridge,
        "development.json",
        season=13,
    )
    development_matchup.team1[1]["skills"][2] = "replacement-B"
    battles = [
        _battle("seed.json", tag="seed", season=12),
        train_matchup,
        development_matchup,
        _battle("final.json", tag="final", season=14),
        future_bridge,
    ]

    (
        development,
        _final,
        _future,
        _underpowered,
    ) = evaluator.build_rolling_folds(
        battles,
        [f"session-{index}" for index in range(len(battles))],
        final_season=14,
        minimum_train_battles=1,
        minimum_validation_battles=1,
        minimum_train_groups=1,
        minimum_validation_groups=1,
    )

    season_13 = next(
        fold
        for fold in development
        if fold.test_season == 13
    )
    # Train↔test distance is two replacements. The later one-replacement
    # bridge must not transitively join them and purge index 1.
    assert season_13.train_indices == (0, 1)
    assert season_13.test_indices == (2,)


def test_rolling_fold_evidence_floor_counts_sessions_not_only_rows():
    battles: list[Battle] = []
    group_ids: list[str] = []
    for season, n_groups in ((12, 5), (13, 5), (14, 4), (15, 5)):
        for offset in range(20):
            battles.append(
                _battle(
                    f"{season}-{offset}.json",
                    tag=f"{season}-{offset}",
                    season=season,
                )
            )
            group_ids.append(f"{season}-group-{offset % n_groups}")

    development, final, future, underpowered = (
        evaluator.build_rolling_folds(
            battles,
            group_ids,
            final_season=15,
        )
    )

    assert [fold.test_season for fold in development] == [13]
    assert [fold.test_season for fold in underpowered] == [14]
    assert final.test_season == 15
    assert future == []


def test_sp_ablation_removes_only_within_hero_skill_pair_features():
    team1, team2 = _teams("sp")
    battles = [
        _battle(
            "train-1.json",
            season=13,
            winner=1,
            teams=(team1, team2),
        ),
        _battle(
            "train-2.json",
            season=13,
            winner=2,
            teams=(team2, team1),
        ),
        _battle(
            "test.json",
            season=14,
            winner=1,
            teams=(team1, team2),
        ),
    ]
    fold = evaluator.RollingFold(14, (0, 1), (2,))
    group_ids = ["train-1", "train-2", "test"]
    support = compute_support(battles[:2], {})
    selected = select_features(
        support,
        min_support_single=1,
        min_support_pair=1,
    )
    expected_sp_count = sum(
        feature.startswith(f"{F_SKILL_PAIR}|")
        for feature in selected
    )

    with_sp = evaluator.evaluate_config(
        evaluator.EvaluationConfig(
            min_support_single=1,
            min_support_pair=1,
            include_sp=True,
        ),
        [fold],
        battles,
        group_ids,
        {},
    )
    without_sp = evaluator.evaluate_config(
        evaluator.EvaluationConfig(
            min_support_single=1,
            min_support_pair=1,
            include_sp=False,
        ),
        [fold],
        battles,
        group_ids,
        {},
    )

    assert expected_sp_count > 0
    assert with_sp.feature_counts[0] - without_sp.feature_counts[0] == (
        expected_sp_count
    )
    assert evaluator.EvaluationConfig().include_sp is True


def test_recency_weighting_only_downweights_older_training_seasons():
    battles = [
        _battle("old.json", season=12),
        _battle("middle.json", season=13),
        _battle("new.json", season=14),
    ]

    weights = evaluator._sample_weights(
        battles,
        evaluator.VARIANT_RECENCY_WEIGHTED,
    )

    assert weights is not None
    assert weights[0] < weights[1] < weights[2]
    assert float(weights.mean()) == pytest.approx(1.0)
    assert evaluator._sample_weights(
        battles,
        evaluator.VARIANT_POOLED,
    ) is None


def test_limited_season_trend_adds_only_hero_and_skill_interactions():
    X_train = np.asarray(
        [[1.0, -1.0, 1.0], [-1.0, 1.0, -1.0]],
    )
    X_test = np.asarray([[1.0, 1.0, -1.0]])
    train = [
        _battle("train-12.json", season=12),
        _battle("train-14.json", season=14),
    ]
    test = [_battle("test-15.json", season=15)]

    expanded_train, expanded_test = evaluator._add_season_trend_columns(
        X_train,
        X_test,
        ["H|hero", "S|skill", "HP|hero|other"],
        train,
        test,
    )

    assert expanded_train.shape == (2, 5)
    assert expanded_test.shape == (1, 5)
    assert (expanded_train[:, :3] == X_train).all()
    assert (expanded_test[:, :3] == X_test).all()
    # S15 is beyond the S12–S14 training range, so its interaction is capped at
    # the newest observed training-season value (0.25 * 1/2), not extrapolated.
    assert expanded_test[0, 3] == pytest.approx(0.125)
    assert expanded_test[0, 4] == pytest.approx(0.125)


def test_cluster_confidence_intervals_and_source_breakdown_are_deterministic():
    outcomes: list[int] = []
    probabilities: list[float] = []
    groups: list[str] = []
    sources: list[str] = []
    for group_index in range(10):
        correct = group_index % 2 == 0
        group_outcomes = [0, 1]
        group_probabilities = [0.1, 0.9] if correct else [0.9, 0.1]
        outcomes.extend(group_outcomes)
        probabilities.extend(group_probabilities)
        groups.extend([f"group-{group_index}"] * 2)
        source = (
            SOURCE_UPLOADED_BY_ME
            if group_index < 5
            else SOURCE_UPLOADED_BY_OTHERS
        )
        sources.extend([source] * 2)

    report = prediction_report(
        outcomes,
        probabilities,
        groups,
        sources,
        bootstrap_samples=128,
        seed=19,
    )
    repeated = prediction_report(
        outcomes,
        probabilities,
        groups,
        sources,
        bootstrap_samples=128,
        seed=19,
    )

    assert report == repeated
    assert report["n"] == 20
    assert report["n_groups"] == 10
    assert report["confidence_intervals_95"]["accuracy"] is not None
    assert list(report["by_source"]) == list(SOURCE_CATEGORIES)
    assert {
        source: report["by_source"][source]["n"]
        for source in SOURCE_CATEGORIES
    } == {
        SOURCE_UPLOADED_BY_ME: 10,
        SOURCE_UPLOADED_BY_OTHERS: 10,
    }
    assert all(
        report["by_source"][source]["n_groups"] == 5
        for source in SOURCE_CATEGORIES
    )


def test_bootstrap_status_uses_the_weakest_rolling_fold():
    outcomes = [0, 1] * 9
    probabilities = [0.2, 0.8] * 9
    groups = [
        group_id
        for group_index in range(9)
        for group_id in [f"group-{group_index}"] * 2
    ]
    strata = [10] * 10 + [11] * 8

    report = prediction_report(
        outcomes,
        probabilities,
        groups,
        [SOURCE_UPLOADED_BY_ME] * len(outcomes),
        strata=strata,
        bootstrap_samples=64,
    )

    assert report["n_groups"] == 9
    assert report["n_groups_by_stratum"] == {"10": 5, "11": 4}
    assert report["confidence_interval_status"] == "omitted_too_few_groups"
    assert report["confidence_intervals_95"]["accuracy"] is None


def test_builder_reserved_backtest_excludes_future_and_contaminated_session():
    prior = [
        _signal_battle(
            serial,
            14,
            captured_at=float(serial * 4_000),
        )
        for serial in range(17)
    ]
    final_first = _signal_battle(
        100,
        15,
        captured_at=80_000,
        source=SOURCE_UPLOADED_BY_OTHERS,
    )
    contaminated = _clone_battle(
        final_first,
        "contaminated-prior.json",
        season=14,
        captured_at=70_000,
        source=SOURCE_UPLOADED_BY_ME,
    )
    same_session = _signal_battle(
        200,
        14,
        captured_at=70_100,
    )
    final = [
        final_first,
        *[
            _signal_battle(
                serial,
                15,
                captured_at=float(80_000 + (serial - 99) * 4_000),
                source=(
                    SOURCE_UPLOADED_BY_OTHERS
                    if serial % 2 == 0
                    else SOURCE_UPLOADED_BY_ME
                ),
            )
            for serial in range(101, 104)
        ],
    ]
    future = _signal_battle(300, 16, captured_at=120_000)
    battles = [*prior, contaminated, same_session, *final, future]

    report = backtest(battles, {})

    assert len(battles) == 24
    # The matching prior report and the unrelated report from its same capture
    # session are both removed.
    assert report["n_train"] == 17
    assert report["n_test"] == 4
    assert report["n_test_groups"] == 4
    assert report["protocol"]["name"] == "reserved-season"
    assert report["protocol"]["final_season"] == 15
    assert report["protocol"]["future_seasons_excluded"] == [16]
    assert report["protocol"]["source_categories"] == list(SOURCE_CATEGORIES)
    assert set(report["source_breakdown"]) == set(SOURCE_CATEGORIES)


def test_builder_fallback_purges_near_duplicate_training_sessions():
    battles = [
        _signal_battle(
            serial,
            None,
            captured_at=float(serial * 4_000),
        )
        for serial in range(24)
    ]
    battles[5] = _clone_battle(
        battles[20],
        "contaminated-prior.json",
        captured_at=20_000,
    )
    battles[6] = _signal_battle(
        106,
        None,
        captured_at=20_100,
    )

    report = backtest(battles, {})

    assert report["protocol"]["name"] == "grouped-chronological-fallback"
    assert report["n_test"] == 5
    # The matching prior row and its unrelated same-session companion are both
    # purged from the otherwise 19-row training partition.
    assert report["n_train"] == 17


def test_evaluation_metadata_does_not_relabel_unchanged_production_weights():
    original = _battle(
        "same.json",
        season=14,
        captured_at=100.0,
        source=SOURCE_UPLOADED_BY_ME,
    )
    metadata_change = _clone_battle(
        original,
        "same.json",
        season=15,
        captured_at=200.0,
        source=SOURCE_UPLOADED_BY_OTHERS,
    )

    assert compute_corpus_version([original]) == compute_corpus_version(
        [metadata_change]
    )
    assert compute_evaluation_version([original]) != compute_evaluation_version(
        [metadata_change]
    )


def _protocol_corpus() -> list[Battle]:
    battles: list[Battle] = []
    serial = 0
    for season in (13, 14, 15):
        for offset in range(20):
            source = (
                SOURCE_UPLOADED_BY_OTHERS
                if offset % 4 == 0
                else SOURCE_UPLOADED_BY_ME
            )
            battles.append(
                _signal_battle(
                    serial,
                    season,
                    captured_at=float(serial * (SESSION_GAP_SECONDS + 1)),
                    source=source,
                )
            )
            serial += 1
    return battles


def test_final_outcomes_cannot_change_candidate_selection():
    battles = _protocol_corpus()
    changed_final = copy.deepcopy(battles)
    for battle in changed_final:
        if battle.season == 15:
            battle.winner = 3 - battle.winner

    kwargs = {
        "final_season": 15,
        "c_candidates": (0.1, 0.5),
        "single_support_candidates": (3, 5),
        "pair_support_candidates": (5, 8),
        "bootstrap_samples": 0,
    }
    original_report = evaluator.evaluate_protocol(battles, {}, **kwargs)
    changed_report = evaluator.evaluate_protocol(changed_final, {}, **kwargs)

    assert original_report["tuning"] == changed_report["tuning"]
    assert original_report["experiments"] == changed_report["experiments"]
    assert (
        original_report["rolling_validation"]
        == changed_report["rolling_validation"]
    )


def test_main_runs_tiny_protocol_without_mutating_production_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    battles = _protocol_corpus()
    production_path = tmp_path / "web" / "src" / "recommendation_data.json"
    production_path.parent.mkdir(parents=True)
    production_bytes = b'{"production":"sentinel"}\n'
    production_path.write_bytes(production_bytes)
    output_path = tmp_path / "evaluation.json"

    real_protocol = evaluator.evaluate_protocol

    def tiny_protocol(
        loaded_battles,
        default_skill,
        *,
        final_season,
        bootstrap_samples,
    ):
        return real_protocol(
            loaded_battles,
            default_skill,
            final_season=final_season,
            c_candidates=(0.1,),
            single_support_candidates=(5,),
            pair_support_candidates=(8,),
            bootstrap_samples=bootstrap_samples,
        )

    monkeypatch.setattr(
        evaluator,
        "_load_evaluation_corpus",
        lambda *_args: (battles, {"default_skill": {}}),
    )
    monkeypatch.setattr(evaluator, "evaluate_protocol", tiny_protocol)
    monkeypatch.chdir(tmp_path)

    production_config_before = evaluator.EvaluationConfig().as_dict()
    constants_before = (
        builder.L2_C,
        builder.MIN_SUPPORT_SINGLE,
        builder.MIN_SUPPORT_PAIR,
    )
    result = evaluator.main(
        [
            "--output",
            str(output_path),
            "--final-season",
            "15",
            "--bootstrap-samples",
            "8",
        ]
    )
    report = json.loads(output_path.read_text(encoding="utf-8"))

    assert result == 0
    assert production_path.read_bytes() == production_bytes
    assert (
        builder.L2_C,
        builder.MIN_SUPPORT_SINGLE,
        builder.MIN_SUPPORT_PAIR,
    ) == constants_before
    assert evaluator.EvaluationConfig().as_dict() == production_config_before
    assert report["production_model"] == {
        "changed": False,
        "current_config": production_config_before,
        "note": (
            "candidate results are evaluation-only and are not fed into "
            "the production artifact builder"
        ),
    }
    assert report["protocol"]["development_seasons"] == [14]
    assert report["rolling_validation"]["n"] == 20
    assert report["final_test"]["selected_candidate"]["metrics"]["n"] == 20


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
