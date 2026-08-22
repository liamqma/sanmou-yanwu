"""Tests for the offline recommendation-data builder.

Fast + self-contained: uses synthetic battles written to a tmp dir, so no
PaddleOCR and no dependency on the real corpus. Run with:

    uv run pytest data/test_build_recommendation_data.py -v
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import pytest

# Ensure the builder module (data/build_recommendation_data.py) is importable
# regardless of pytest's rootdir/invocation directory.
sys.path.insert(0, os.path.dirname(__file__))

from build_recommendation_data import (  # noqa: E402
    Battle,
    CatalogNames,
    DUPLICATE_FINGERPRINT_ALGORITHM,
    DUPLICATE_FINGERPRINT_VERSION,
    F_HERO,
    F_HERO_PAIR,
    F_HERO_SKILL,
    F_SKILL,
    F_SKILL_PAIR,
    InvalidBattleError,
    _CatalogSeasons,
    _load_catalog_context,
    _selection_prior_atomic_components,
    apply_selection_prior,
    build,
    build_artifact,
    build_design_matrix,
    compute_analytics,
    compute_corpus_version,
    compute_support,
    duplicate_fingerprint,
    fit_model,
    load_battles,
    load_catalog,
    paired_difference,
    selection_adjusted_atomic_weights,
    select_features,
    team_features,
    validate_battle,
)


def _hero(name, *skills):
    # skills[0] is the default/signature skill (excluded from features).
    return {"name": name, "skills": list(skills)}


def _battle(filename, team1, team2, winner):
    return {"filename": filename, "1": team1, "2": team2, "winner": winner}


def _team(*names):
    """A valid full team: three heroes with signature + two equipped skills."""
    return [_hero(n, "d", "s1", "s2") for n in names]


def _database_for(*raw_battles, skill_overrides=None):
    """Build a minimal exact-name catalog covering the supplied raw battles."""
    heroes = {}
    skills = {}
    for raw in raw_battles:
        for team_key in ("1", "2"):
            for hero in raw[team_key]:
                heroes[hero["name"]] = {
                    "skill": hero["skills"][0],
                    "season": 1,
                }
                for skill in hero["skills"]:
                    skills.setdefault(
                        skill,
                        {"color": "orange", "season": 1},
                    )
    for name, metadata in (skill_overrides or {}).items():
        skills.setdefault(name, {}).update(metadata)
    return {"heroes": heroes, "skills": skills}


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #

def test_validate_battle_accepts_string_and_int_winner():
    raw = _battle("b1.json", _team("A", "B", "C"), _team("D", "E", "F"), "1")
    b = validate_battle(raw, "b1.json")
    assert b.winner == 1
    raw2 = _battle("b2.json", _team("A", "B", "C"), _team("D", "E", "F"), 2)
    assert validate_battle(raw2, "b2.json").winner == 2


@pytest.mark.parametrize("invalid_season", [True, 0, -1, 1.5, "15"])
def test_validate_battle_rejects_invalid_explicit_season(invalid_season):
    raw = _battle(
        "bad-season.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    raw["season"] = invalid_season

    with pytest.raises(InvalidBattleError, match="invalid season"):
        validate_battle(raw, "bad-season.json")


def test_validate_battle_rejects_unknown_winner():
    raw = _battle("bad.json", _team("A", "B", "C"), _team("D", "E", "F"), "unknown")
    with pytest.raises(InvalidBattleError):
        validate_battle(raw, "bad.json")


def test_validate_battle_rejects_wrong_team_size():
    # A truncated capture (OCR dropped a hero) must fail closed, not train on 2.
    raw = _battle("short.json", _team("A", "B"), _team("D", "E", "F"), "1")
    with pytest.raises(InvalidBattleError):
        validate_battle(raw, "short.json")
    # An over-full team is rejected too.
    raw2 = _battle("long.json", _team("A", "B", "C", "D"), _team("E", "F", "G"), "1")
    with pytest.raises(InvalidBattleError):
        validate_battle(raw2, "long.json")


@pytest.mark.parametrize("skill_count", [2, 4])
def test_validate_battle_rejects_non_three_skill_count(skill_count):
    team1 = _team("A", "B", "C")
    team1[0]["skills"] = ["d", "s1", "s2", "s3"][:skill_count]
    raw = _battle("skills.json", team1, _team("D", "E", "F"), "1")

    with pytest.raises(InvalidBattleError, match=rf"{skill_count} skills"):
        validate_battle(raw, "skills.json")


def test_validate_battle_rejects_duplicate_hero_within_team():
    raw = _battle(
        "duplicate.json",
        _team("A", "A", "C"),
        _team("D", "E", "F"),
        "1",
    )

    with pytest.raises(InvalidBattleError, match="duplicate hero 'A'"):
        validate_battle(raw, "duplicate.json")


def test_validate_battle_rejects_names_outside_supplied_catalog():
    catalog_names = CatalogNames(
        heroes=frozenset({"A", "B", "C", "D", "E", "F"}),
        skills=frozenset({"d", "s1", "s2"}),
    )
    unknown_hero = _battle(
        "hero.json",
        _team("A", "B", "unknown"),
        _team("D", "E", "F"),
        "1",
    )
    with pytest.raises(InvalidBattleError, match="unknown hero 'unknown'"):
        validate_battle(
            unknown_hero,
            "hero.json",
            catalog_names=catalog_names,
        )

    team1 = _team("A", "B", "C")
    team1[0]["skills"][2] = "unknown"
    unknown_skill = _battle(
        "skill.json",
        team1,
        _team("D", "E", "F"),
        "1",
    )
    with pytest.raises(InvalidBattleError, match="unknown skill 'unknown'"):
        validate_battle(
            unknown_skill,
            "skill.json",
            catalog_names=catalog_names,
        )


def test_validate_battle_accepts_catalogued_shadow_skill():
    catalog_names = CatalogNames(
        heroes=frozenset({"A", "B", "C", "D", "E", "F"}),
        skills=frozenset({"d", "s1", "s2", "shadow-skill"}),
    )
    team1 = _team("A", "B", "C")
    team1[0]["skills"][1] = "shadow-skill"
    raw = _battle(
        "shadow.json",
        team1,
        _team("D", "E", "F"),
        "1",
    )

    battle = validate_battle(
        raw,
        "shadow.json",
        catalog_names=catalog_names,
    )
    assert battle.team1[0]["skills"][1] == "shadow-skill"


def test_validate_battle_rejects_unauthenticated_shadow_provenance():
    raw = _battle(
        "shadow.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    raw["1"][0]["shadow_skills"] = ["s1"]

    with pytest.raises(InvalidBattleError, match="unauthenticated"):
        validate_battle(raw, "shadow.json")

    battle = validate_battle(
        raw,
        "external-shadow.json",
        allow_shadow_skills=True,
    )
    assert battle.team1[0]["shadow_skills"] == ["s1"]


def test_validate_battle_rejects_missing_winner():
    raw = {"1": [_hero("A", "d")], "2": [_hero("B", "d")]}
    with pytest.raises(InvalidBattleError):
        validate_battle(raw, "nowinner.json")


def test_validate_battle_rejects_empty_team():
    raw = _battle("empty.json", [], [_hero("B", "d")], "1")
    with pytest.raises(InvalidBattleError):
        validate_battle(raw, "empty.json")


def test_load_battles_collects_errors_without_aborting(tmp_path):
    good = tmp_path / "good.json"
    good.write_text(json.dumps(_battle("good.json", _team("A", "B", "C"), _team("D", "E", "F"), "1")), encoding="utf-8")
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(_battle("bad.json", _team("A", "B", "C"), _team("D", "E", "F"), "unknown")), encoding="utf-8")

    battles, errors = load_battles(str(tmp_path))
    assert len(battles) == 1
    assert len(errors) == 1
    assert "unknown" in errors[0]


# --------------------------------------------------------------------------- #
# Feature extraction
# --------------------------------------------------------------------------- #

def test_team_features_excludes_default_skill():
    team = [_hero("A", "sig", "s1", "s2")]
    feats = team_features(team, {"A": "sig"})
    assert "H|A" in feats
    assert "S|s1" in feats
    assert "S|s2" in feats
    assert "S|sig" not in feats  # default skill excluded
    assert "HS|A|s1" in feats
    assert "SP|A|s1|s2" in feats  # within-hero skill pair


def test_team_features_excludes_default_skill_by_name_off_slot():
    # OCR can duplicate the signature into a draft slot or read the draft slot as
    # the signature name. Dropping the default by *name* (not only positionally)
    # keeps it out of the feature space so training stays in lockstep with the
    # client, which never assigns a hero its signature.
    team = [_hero("A", "sig", "sig", "s1")]
    feats = team_features(team, {"A": "sig"})
    assert "S|sig" not in feats
    assert "HS|A|sig" not in feats
    assert "S|s1" in feats
    assert "HS|A|s1" in feats


def test_team_features_pairs_are_order_independent():
    t1 = team_features([_hero("A", "d"), _hero("B", "d")], {})
    t2 = team_features([_hero("B", "d"), _hero("A", "d")], {})
    assert t1 == t2
    assert "HP|A|B" in t1


def test_paired_difference_is_antisymmetric():
    b = Battle("x", [_hero("A", "d")], [_hero("B", "d")], 1)
    diff = paired_difference(b, {})
    assert diff["H|A"] == 1
    assert diff["H|B"] == -1


def test_select_features_respects_support_floor():
    support = {"H|rare": 1, "H|common": 50, "HP|a|b": 4, "HP|c|d": 20}
    kept = select_features(support)
    assert "H|common" in kept
    assert "H|rare" not in kept  # below single floor (5)
    assert "HP|c|d" in kept
    assert "HP|a|b" not in kept  # below pair floor (8)
    assert kept == sorted(kept)  # deterministic order


# --------------------------------------------------------------------------- #
# Model fitting + determinism
# --------------------------------------------------------------------------- #

def _synthetic_battles(n=200):
    """A hero always wins for team1 vs a fixed weak hero, so the model must learn
    a positive weight for the strong hero."""
    battles = []
    for i in range(n):
        # Alternate which team the strong hero is on to avoid team-order bias.
        if i % 2 == 0:
            battles.append(Battle(f"{i:05d}.json", [_hero("strong", "d")], [_hero("weak", "d")], 1))
        else:
            battles.append(Battle(f"{i:05d}.json", [_hero("weak", "d")], [_hero("strong", "d")], 2))
    return battles


def test_fit_model_learns_signal():
    battles = _synthetic_battles()
    support = compute_support(battles, {})
    features = select_features(support)
    index = {f: i for i, f in enumerate(features)}
    X, y = build_design_matrix(battles, index, {})
    coef, intercept = fit_model(X, y)
    w = dict(zip(features, coef))
    assert w["H|strong"] > w["H|weak"]
    assert w["H|strong"] > 0


def test_fit_model_deterministic():
    battles = _synthetic_battles()
    support = compute_support(battles, {})
    features = select_features(support)
    index = {f: i for i, f in enumerate(features)}
    X, y = build_design_matrix(battles, index, {})
    c1 = fit_model(X, y)
    c2 = fit_model(X, y)
    assert (c1[0] == c2[0]).all()
    assert c1[1] == c2[1]


def test_fit_model_handles_single_class():
    # All team1 wins → degenerate; should return a safe zero model.
    battles = [Battle(f"{i}.json", [_hero("A", "d")], [_hero("B", "d")], 1) for i in range(30)]
    support = compute_support(battles, {})
    features = select_features(support)
    index = {f: i for i, f in enumerate(features)}
    X, y = build_design_matrix(battles, index, {})
    coef, intercept = fit_model(X, y)
    assert (coef == 0).all()
    assert intercept == 0.0


def _exposure_battles(seasons, heroes_by_index=None):
    heroes_by_index = heroes_by_index or {}
    return [
        Battle(
            filename=f"exposure-{index}.json",
            team1=[
                _hero(name, f"{name}-signature", *skills)
                for name, skills in heroes_by_index.get(index, [])
            ],
            team2=[],
            winner=1,
            season=season,
        )
        for index, season in enumerate(seasons)
    ]


def _selection_catalog(*, hero_count=100, skill_count=100):
    return _CatalogSeasons(
        heroes={f"hero-{index}": 1 for index in range(hero_count)},
        skills={f"skill-{index}": 1 for index in range(skill_count)},
        draftable_skills=frozenset(
            f"skill-{index}" for index in range(skill_count)
        ),
    )


def test_selection_prior_rewards_frequent_and_penalizes_rare_heroes():
    seasons = _selection_catalog()
    battles = _exposure_battles(
        [1] * 100,
        {
            index: (
                ([('hero-0', ())] if index < 25 else [])
                + ([('hero-1', ())] if index == 0 else [])
            )
            for index in range(100)
        },
    )
    adjusted = selection_adjusted_atomic_weights(
        ["H|hero-0", "H|hero-1"],
        np.asarray([0.0, 0.0]),
        battles,
        seasons,
        hero_strength=0.4,
        skill_strength=0.0,
        smoothing=5.0,
        log_ratio_clip=2.0,
    )

    assert adjusted["H|hero-0"] > 0.0
    assert adjusted["H|hero-1"] < 0.0


def test_selection_prior_applies_to_draftable_skills():
    seasons = _selection_catalog()
    battles = _exposure_battles(
        [1] * 100,
        {
            index: [
                (
                    f"carrier-{index}",
                    ("skill-0",) if index < 30 else (("skill-1",) if index == 99 else ()),
                )
            ]
            for index in range(100)
        },
    )
    adjusted = selection_adjusted_atomic_weights(
        ["S|skill-0", "S|skill-1"],
        np.asarray([0.0, 0.0]),
        battles,
        seasons,
        hero_strength=0.0,
        skill_strength=0.3,
        smoothing=5.0,
        log_ratio_clip=2.0,
    )

    assert adjusted["S|skill-0"] > 0.0
    assert adjusted["S|skill-1"] < 0.0


def test_selection_prior_counts_mirror_appearances_twice():
    seasons = _CatalogSeasons(
        heroes={"popular": 1, **{f"other-{index}": 1 for index in range(5)}},
        skills={},
    )
    battle = Battle(
        filename="mirror.json",
        team1=[_hero("popular", "d")],
        team2=[_hero("popular", "d")],
        winner=1,
        season=1,
    )
    components = _selection_prior_atomic_components(
        ["H|popular"],
        np.asarray([0.0]),
        [battle],
        seasons,
        smoothing=1.0,
    )

    assert components["H|popular"]["appearance_count"] == 2
    assert components["H|popular"]["expected_count"] == 1.0
    assert components["H|popular"]["usage_ratio"] == 2.0


def test_selection_prior_normalizes_new_items_by_available_seasons():
    seasons = _CatalogSeasons(
        heroes={
            "old": 1,
            "new": 10,
            **{f"old-other-{index}": 1 for index in range(5)},
        },
        skills={},
    )
    battles = _exposure_battles(
        [1] * 90 + [10] * 10,
        {
            **{index: [("old", ())] for index in range(100)},
            **{index: [("old", ()), ("new", ())] for index in range(90, 100)},
        },
    )
    components = _selection_prior_atomic_components(
        ["H|old", "H|new"],
        np.asarray([0.0, 0.0]),
        battles,
        seasons,
        smoothing=5.0,
    )

    assert components["H|new"]["expected_count"] < components["H|old"]["expected_count"]
    assert components["H|new"]["appearance_count"] == 10


def test_selection_prior_ignores_unknown_season_rows():
    seasons = _CatalogSeasons(heroes={"known": 1, "unknown-only": 1}, skills={})
    known = _exposure_battles([1] * 10, {0: [("known", ())]})
    unknown = _exposure_battles(
        [None] * 100,
        {index: [("unknown-only", ())] for index in range(100)},
    )
    components = _selection_prior_atomic_components(
        ["H|known", "H|unknown-only"],
        np.asarray([0.0, 0.0]),
        [*known, *unknown],
        seasons,
    )

    assert components["H|unknown-only"]["appearance_count"] == 0
    assert components["H|known"]["appearance_count"] == 1


def test_selection_prior_adjusts_only_observed_non_draftable_shadow_skills():
    seasons = _CatalogSeasons(
        heroes={},
        skills={"draftable": 1, "shadow": 1},
        draftable_skills=frozenset({"draftable"}),
    )
    battles = _exposure_battles(
        [1] * 10,
        {index: [(f"carrier-{index}", ("shadow",))] for index in range(10)},
    )
    components = _selection_prior_atomic_components(
        ["S|draftable", "S|shadow"],
        np.asarray([0.0, 0.75]),
        battles,
        seasons,
    )

    assert components["S|shadow"]["count_adjustment"] < 0.0
    assert components["S|shadow"]["final_weight"] < 0.75
    assert components["S|draftable"]["count_adjustment"] < 0.0


def test_selection_prior_only_changes_atomic_fitted_columns():
    features = [
        f"{F_HERO}|hero-0",
        f"{F_SKILL}|skill-0",
        f"{F_HERO_PAIR}|a|b",
        f"{F_HERO_SKILL}|a|skill-0",
        f"{F_SKILL_PAIR}|a|s1|s2",
    ]
    raw = np.asarray([0.0, 0.0, 2.0, -2.0, 3.0])
    seasons = _selection_catalog()
    adjusted = apply_selection_prior(
        features,
        raw,
        _exposure_battles([1] * 10),
        seasons,
    )

    assert adjusted[0] < 0.0
    assert adjusted[1] < 0.0
    np.testing.assert_array_equal(adjusted[2:], raw[2:])


# --------------------------------------------------------------------------- #
# Analytics + artifact
# --------------------------------------------------------------------------- #

def test_compute_analytics_smoothing_and_sorting():
    battles = _synthetic_battles()
    a = compute_analytics(battles, {})
    names = [r["name"] for r in a["heroes"]]
    assert "strong" in names
    strong = next(r for r in a["heroes"] if r["name"] == "strong")
    weak = next(r for r in a["heroes"] if r["name"] == "weak")
    assert strong["win_rate"] > weak["win_rate"]
    assert 0.0 <= strong["smoothed_win_rate"] <= 1.0
    # Sorted by smoothed rate descending.
    assert a["heroes"][0]["smoothed_win_rate"] >= a["heroes"][-1]["smoothed_win_rate"]


def test_compute_analytics_tracks_only_explicit_shadow_provenance():
    battle = Battle(
        filename="shadow.json",
        team1=[
            {
                "name": "carrier",
                "skills": ["signature", "shadowed", "plain"],
                "shadow_skills": ["shadowed"],
            }
        ],
        team2=[
            {
                "name": "other",
                "skills": ["other-signature", "plain", "innate-looking"],
            }
        ],
        winner=1,
    )

    analytics = compute_analytics([battle], {})
    by_name = {row["name"]: row for row in analytics["skills"]}

    assert by_name["shadowed"]["shadow_total"] == 1
    assert by_name["plain"]["shadow_total"] == 0
    assert by_name["innate-looking"]["shadow_total"] == 0


def test_build_artifact_shape_and_backtest():
    battles = _synthetic_battles(300)
    # Give each observation a distinct roster so the leakage-safe fallback has
    # independent train/test matchups instead of correctly purging every
    # repeated synthetic strong-vs-weak row.
    for index, battle in enumerate(battles):
        battle.team1.append(_hero(f"team1-{index}", "d"))
        battle.team2.append(_hero(f"team2-{index}", "d"))
    catalog = {"catalog_version": "t", "hero_count": 2, "skill_count": 0, "default_skill": {}}
    art = build_artifact(battles, [], catalog)
    assert art["schema"]["version"] == 6
    assert art["schema"]["model_type"] == "paired-logistic"
    assert art["battle_counts"]["total_battles"] == 300
    assert art["battle_counts"]["team1_wins"] + art["battle_counts"]["team2_wins"] == 300
    # No wall-clock/prior-output fields; a deterministic corpus hash instead.
    assert "generated_at" not in art["battle_counts"]
    assert "added_battles" not in art["battle_counts"]
    assert "corpus_version" in art["battle_counts"]
    assert "weights" in art["model"]
    assert "support" in art["model"]
    assert "selection_prior" in art["model"]
    assert "atomic_components" in art["model"]
    assert all(
        component["final_weight"] == art["model"]["weights"][feature_id]
        for feature_id, component in art["model"]["atomic_components"].items()
    )
    raw_support = compute_support(battles, {})
    assert all(
        support == raw_support[feature_id]
        for feature_id, support in art["model"]["support"].items()
    )
    assert set(art["model"]["support"]) == set(art["model"]["weights"])
    bt = art["backtest"]
    # Backtest reports the required metrics.
    for key in ("accuracy", "log_loss", "brier", "n_test"):
        assert key in bt
    assert bt["n_test"] > 0
    assert bt["accuracy"] is not None


def test_build_artifact_deterministic():
    battles = _synthetic_battles(300)
    catalog = {"catalog_version": "t", "hero_count": 2, "skill_count": 0, "default_skill": {}}
    a1 = build_artifact(battles, [], catalog)
    a2 = build_artifact(battles, [], catalog)
    assert a1["model"] == a2["model"]
    assert a1 == a2


def test_build_artifact_adds_count_prior_only_extremely_sparse_atomic_weights():
    battles = _synthetic_battles(300)
    for index, battle in enumerate(battles):
        battle.team1.append(_hero(f"team1-{index}", "d"))
        battle.team2.append(_hero(f"team2-{index}", "d"))
        battle.season = 16 if index >= 290 else 1
        if index < 5:
            battle.team1.append(_hero("rare", "d"))
        if index < 2:
            battle.team1.append(_hero("ultra-rare", "d"))

    catalog = {
        "catalog_version": "t",
        "hero_count": 606,
        "skill_count": 0,
        "default_skill": {},
    }
    catalog_seasons = _CatalogSeasons(
        heroes={
            "strong": 1,
            "weak": 1,
            "rare": 1,
            "ultra-rare": 1,
            "unseen": 1,
            "new-unseen": 16,
        },
        skills={},
    )

    raw = build_artifact(battles, [], catalog)
    adjusted = build_artifact(
        battles,
        [],
        catalog,
        catalog_seasons=catalog_seasons,
    )

    weights = adjusted["model"]["weights"]
    support = adjusted["model"]["support"]
    assert adjusted["model"]["n_features"] == len(weights)
    assert set(raw["model"]["weights"]) < set(weights)
    assert {"H|ultra-rare", "H|unseen", "H|new-unseen"} <= set(weights)
    assert weights["H|ultra-rare"] < 0.0
    assert weights["H|unseen"] < 0.0
    assert 0.0 > weights["H|new-unseen"] > weights["H|unseen"]
    assert support["H|ultra-rare"] == 2
    assert "H|unseen" not in support
    assert "H|new-unseen" not in support
    assert set(support) <= set(weights)
    assert all(
        adjusted["model"]["support"].get(feature_id, 0)
        == compute_support(battles, {}).get(feature_id, 0)
        for feature_id in weights
    )
    assert (
        weights["H|rare"]
        < raw["model"]["weights"]["H|rare"]
    )
    assert all(
        weights[feature_id] == raw_weight
        for feature_id, raw_weight in raw["model"]["weights"].items()
        if feature_id.split("|", 1)[0] not in (F_HERO, F_SKILL)
    )


def test_corpus_version_is_content_addressed():
    a = _synthetic_battles(50)
    b = _synthetic_battles(50)
    # Same content → same hash; deterministic.
    assert compute_corpus_version(a) == compute_corpus_version(b)
    # Any content change → different hash.
    changed = list(a)
    changed[0] = Battle(
        filename=changed[0].filename,
        team1=changed[0].team1,
        team2=changed[0].team2,
        winner=1 if changed[0].winner == 2 else 2,
        order_key=changed[0].order_key,
    )
    assert compute_corpus_version(changed) != compute_corpus_version(a)

    season_changed = list(a)
    original = season_changed[0]
    season_changed[0] = Battle(
        filename=original.filename,
        team1=original.team1,
        team2=original.team2,
        winner=original.winner,
        order_key=original.order_key,
        season=16,
    )
    assert compute_corpus_version(season_changed) != compute_corpus_version(a)


def test_production_build_cannot_disable_reviewed_mechanics(tmp_path):
    repository_root = Path(__file__).resolve().parent.parent
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    source_battle = repository_root / "data/battles/screenshot_1783150552835.json"
    (battles_dir / "battle.json").write_bytes(source_battle.read_bytes())
    output = tmp_path / "recommendation.json"

    artifact = build(
        str(battles_dir),
        str(repository_root / "web/public/game-data/database.json"),
        str(output),
        mechanics_registry_path=None,
    )

    assert artifact["catalog"]["mechanics_version"]
    assert artifact["catalog"]["skill_mechanics"]
    assert artifact["catalog"]["bonds"]
    assert output.exists()


def test_catalog_version_tracks_shadow_without_changing_feature_ids(tmp_path):
    raw = _battle(
        "shadow.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    database = _database_for(
        raw,
        skill_overrides={"s1": {"shadow": False}},
    )
    database_path = tmp_path / "database.json"
    database_path.write_text(json.dumps(database), encoding="utf-8")
    regular_catalog = load_catalog(str(database_path))
    regular_context = _load_catalog_context(str(database_path))
    assert set(regular_catalog) == {
        "catalog_version",
        "hero_count",
        "skill_count",
        "default_skill",
    }
    # Locks the shared canonical payload shape + compact JSON serialization.
    assert regular_catalog["catalog_version"] == "20073c75369f"
    assert "s1" in regular_context.seasons.draftable_skills
    assert "d" not in regular_context.seasons.draftable_skills

    database["skills"]["s1"]["shadow"] = True
    database_path.write_text(json.dumps(database), encoding="utf-8")
    shadow_catalog = load_catalog(str(database_path))
    shadow_context = _load_catalog_context(str(database_path))

    assert regular_catalog["catalog_version"] != shadow_catalog["catalog_version"]
    assert regular_catalog["default_skill"] == shadow_catalog["default_skill"]
    assert "s1" not in shadow_context.seasons.draftable_skills
    team = _team("A", "B", "C")
    assert team_features(team, regular_catalog["default_skill"]) == team_features(
        team,
        shadow_catalog["default_skill"],
    )


@pytest.mark.parametrize(
    ("section", "name", "invalid_season"),
    [
        ("heroes", "A", None),
        ("heroes", "A", True),
        ("heroes", "A", 0),
        ("heroes", "A", -1),
        ("heroes", "A", 1.5),
        ("skills", "s1", None),
        ("skills", "s1", True),
        ("skills", "s1", 0),
    ],
)
def test_catalog_rejects_non_positive_integer_item_seasons(
    tmp_path,
    section,
    name,
    invalid_season,
):
    raw = _battle(
        "catalog.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    database = _database_for(raw)
    database[section][name]["season"] = invalid_season
    database_path = tmp_path / "database.json"
    database_path.write_text(json.dumps(database), encoding="utf-8")

    with pytest.raises(InvalidBattleError, match="positive integer"):
        load_catalog(str(database_path))


@pytest.mark.parametrize(
    ("section", "name"),
    [
        ("heroes", "A"),
        ("skills", "s1"),
    ],
)
def test_build_rejects_known_pre_introduction_item(
    tmp_path,
    section,
    name,
):
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    raw = _battle(
        "pre-intro.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    raw["season"] = 1
    (battles_dir / "pre-intro.json").write_text(
        json.dumps(raw),
        encoding="utf-8",
    )
    database = _database_for(raw)
    database[section][name]["season"] = 2
    database_path = tmp_path / "database.json"
    database_path.write_text(json.dumps(database), encoding="utf-8")
    output = tmp_path / "recommendation.json"

    with pytest.raises(SystemExit, match="invalid battle"):
        build(str(battles_dir), str(database_path), str(output))
    assert not output.exists()


def test_build_accepts_unknown_battle_season_conservatively(tmp_path):
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    raw = _battle(
        "unknown-season.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    (battles_dir / "unknown-season.json").write_text(
        json.dumps(raw),
        encoding="utf-8",
    )
    database = _database_for(raw)
    database["heroes"]["A"]["season"] = 16
    database_path = tmp_path / "database.json"
    database_path.write_text(json.dumps(database), encoding="utf-8")
    output = tmp_path / "recommendation.json"

    artifact = build(str(battles_dir), str(database_path), str(output))

    assert artifact["battle_counts"]["total_battles"] == 1
    assert output.exists()


def test_build_artifact_byte_identical_two_builds(tmp_path):
    """A full end-to-end build twice on the same corpus is byte-for-byte equal."""
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    # Two heroes with a clear signal so a model actually fits.
    raw_battles = []
    for i in range(60):
        winner = "1" if i % 2 == 0 else "2"
        raw = _battle(
            f"2025-01-01-{i:06d}.json",
            [
                _hero("A", "d", "s1", "s2"),
                _hero("B", "d", "s2", "s3"),
                _hero(f"C{i}", "d", "s1", "s3"),
            ],
            [
                _hero("X", "d", "s1", "s2"),
                _hero("Y", "d", "s2", "s3"),
                _hero("Z", "d", "s1", "s3"),
            ],
            winner,
        )
        raw_battles.append(raw)
        (battles_dir / f"2025-01-01-{i:06d}.json").write_text(
            json.dumps(raw), encoding="utf-8"
        )
    db = tmp_path / "database.json"
    db.write_text(
        json.dumps(_database_for(*raw_battles)),
        encoding="utf-8",
    )

    out1 = tmp_path / "out1.json"
    out2 = tmp_path / "out2.json"
    build(str(battles_dir), str(db), str(out1))
    build(str(battles_dir), str(db), str(out2))
    assert out1.read_bytes() == out2.read_bytes()


def test_build_aborts_and_does_not_write_on_invalid_battle(tmp_path):
    """An invalid battle aborts the whole build before any write happens."""
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    good = _battle(
        "good.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    (battles_dir / "good.json").write_text(json.dumps(good), encoding="utf-8")
    bad = _battle(
        "bad.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "unknown",
    )
    (battles_dir / "bad.json").write_text(json.dumps(bad), encoding="utf-8")
    db = tmp_path / "database.json"
    db.write_text(json.dumps(_database_for(good, bad)), encoding="utf-8")

    out = tmp_path / "should_not_exist.json"
    with pytest.raises(SystemExit):
        build(str(battles_dir), str(db), str(out))
    assert not out.exists()


def test_build_aborts_and_does_not_overwrite_on_unreadable_battle(tmp_path):
    """A pre-existing artifact is left untouched when the corpus is invalid."""
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    good = _battle(
        "good.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    (battles_dir / "good.json").write_text(json.dumps(good), encoding="utf-8")
    # Corrupt/unreadable JSON.
    (battles_dir / "broken.json").write_text("{not json", encoding="utf-8")
    db = tmp_path / "database.json"
    db.write_text(json.dumps(_database_for(good)), encoding="utf-8")

    out = tmp_path / "out.json"
    out.write_text("SENTINEL", encoding="utf-8")
    with pytest.raises(SystemExit):
        build(str(battles_dir), str(db), str(out))
    assert out.read_text(encoding="utf-8") == "SENTINEL"


def test_build_does_not_overwrite_complete_artifact_when_sources_shrink(tmp_path):
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    raw = _battle(
        "capture.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    first = battles_dir / "first.json"
    second = battles_dir / "second.json"
    first.write_text(json.dumps(raw), encoding="utf-8")
    second.write_text(json.dumps(raw), encoding="utf-8")
    database = tmp_path / "database.json"
    database.write_text(json.dumps(_database_for(raw)), encoding="utf-8")
    output = tmp_path / "recommendation.json"

    build(str(battles_dir), str(database), str(output))
    complete_artifact = output.read_bytes()
    second.unlink()

    with pytest.raises(SystemExit, match="refusing to replace.*2-battle.*only 1"):
        build(str(battles_dir), str(database), str(output))
    assert output.read_bytes() == complete_artifact


def test_build_rejects_battle_name_missing_from_database(tmp_path):
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    raw = _battle(
        "unknown.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    (battles_dir / "unknown.json").write_text(
        json.dumps(raw),
        encoding="utf-8",
    )
    database = _database_for(raw)
    del database["heroes"]["F"]
    database_path = tmp_path / "database.json"
    database_path.write_text(json.dumps(database), encoding="utf-8")
    output = tmp_path / "recommendation.json"

    with pytest.raises(SystemExit, match="invalid battle"):
        build(str(battles_dir), str(database_path), str(output))
    assert not output.exists()


def test_build_trains_from_manual_and_web_upload_directories(tmp_path):
    manual_dir = tmp_path / "battles"
    web_dir = tmp_path / "web-upload"
    manual_dir.mkdir()
    web_dir.mkdir()
    manual = _battle(
        "manual.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    uploaded = _battle(
        "web-battle-00000001.json",
        _team("G", "H", "I"),
        _team("J", "K", "L"),
        "2",
    )
    (manual_dir / "manual.json").write_text(json.dumps(manual), encoding="utf-8")
    (web_dir / "web-battle-00000001.json").write_text(
        json.dumps(uploaded),
        encoding="utf-8",
    )
    uploaded_battle = validate_battle(uploaded, "uploaded.json")
    state = {
        "fingerprints": {
            "version": DUPLICATE_FINGERPRINT_VERSION,
            "algorithm": DUPLICATE_FINGERPRINT_ALGORITHM,
            "web": {duplicate_fingerprint(uploaded_battle, "exact"): 1},
        }
    }
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    database = tmp_path / "database.json"
    database.write_text(
        json.dumps(
            _database_for(
                manual,
                uploaded,
                skill_overrides={"s1": {"shadow": True}},
            )
        ),
        encoding="utf-8",
    )
    output = tmp_path / "recommendation.json"

    artifact = build(
        str(manual_dir),
        str(database),
        str(output),
        web_upload_dir=str(web_dir),
        web_upload_state_path=str(state_path),
    )

    assert artifact["battle_counts"]["total_battles"] == 2


def test_build_rejects_third_semantic_duplicate_before_write(tmp_path):
    manual_dir = tmp_path / "battles"
    manual_dir.mkdir()
    raw = _battle(
        "same.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    for index in range(3):
        (manual_dir / f"{index}.json").write_text(
            json.dumps(raw),
            encoding="utf-8",
        )
    database = tmp_path / "database.json"
    database.write_text(
        json.dumps(_database_for(raw)),
        encoding="utf-8",
    )
    output = tmp_path / "recommendation.json"

    with pytest.raises(SystemExit, match="duplicate cap"):
        build(str(manual_dir), str(database), str(output))
    assert not output.exists()


def test_build_rejects_web_checkpoint_count_above_duplicate_cap(tmp_path):
    manual_dir = tmp_path / "battles"
    web_dir = tmp_path / "web-upload"
    manual_dir.mkdir()
    web_dir.mkdir()
    manual = _battle(
        "manual.json",
        _team("A", "B", "C"),
        _team("D", "E", "F"),
        "1",
    )
    uploaded = _battle(
        "uploaded.json",
        _team("G", "H", "I"),
        _team("J", "K", "L"),
        "2",
    )
    (manual_dir / "manual.json").write_text(json.dumps(manual), encoding="utf-8")
    for index in range(1, 4):
        (web_dir / f"web-battle-{index:08d}.json").write_text(
            json.dumps(uploaded),
            encoding="utf-8",
        )
    fingerprint = duplicate_fingerprint(
        validate_battle(uploaded, "uploaded.json"),
        "same-uploader",
    )
    state = {
        "fingerprints": {
            "version": DUPLICATE_FINGERPRINT_VERSION,
            "algorithm": DUPLICATE_FINGERPRINT_ALGORITHM,
            "web": {fingerprint: 3},
        }
    }
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    database = tmp_path / "database.json"
    database.write_text(
        json.dumps(_database_for(manual, uploaded)),
        encoding="utf-8",
    )
    output = tmp_path / "recommendation.json"

    with pytest.raises(SystemExit, match="duplicate-policy"):
        build(
            str(manual_dir),
            str(database),
            str(output),
            web_upload_dir=str(web_dir),
            web_upload_state_path=str(state_path),
        )
    assert not output.exists()
