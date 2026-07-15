"""Tests for the offline recommendation-data builder.

Fast + self-contained: uses synthetic battles written to a tmp dir, so no
PaddleOCR and no dependency on the real corpus. Run with:

    uv run pytest data/test_build_recommendation_data.py -v
"""
from __future__ import annotations

import json
import os
import sys

import pytest

# Ensure the builder module (data/build_recommendation_data.py) is importable
# regardless of pytest's rootdir/invocation directory.
sys.path.insert(0, os.path.dirname(__file__))

from build_recommendation_data import (  # noqa: E402
    Battle,
    InvalidBattleError,
    build,
    build_artifact,
    build_design_matrix,
    compute_analytics,
    compute_corpus_version,
    compute_support,
    fit_model,
    load_battles,
    paired_difference,
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
    """A valid full team of TEAM_SIZE heroes (each with a default skill)."""
    return [_hero(n, "d") for n in names]


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #

def test_validate_battle_accepts_string_and_int_winner():
    raw = _battle("b1.json", _team("A", "B", "C"), _team("D", "E", "F"), "1")
    b = validate_battle(raw, "b1.json")
    assert b.winner == 1
    raw2 = _battle("b2.json", _team("A", "B", "C"), _team("D", "E", "F"), 2)
    assert validate_battle(raw2, "b2.json").winner == 2


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
    feats = team_features(team)
    assert "H|A" in feats
    assert "S|s1" in feats
    assert "S|s2" in feats
    assert "S|sig" not in feats  # default skill excluded
    assert "HS|A|s1" in feats
    assert "SP|A|s1|s2" in feats  # within-hero skill pair


def test_team_features_pairs_are_order_independent():
    t1 = team_features([_hero("A", "d"), _hero("B", "d")])
    t2 = team_features([_hero("B", "d"), _hero("A", "d")])
    assert t1 == t2
    assert "HP|A|B" in t1


def test_paired_difference_is_antisymmetric():
    b = Battle("x", [_hero("A", "d")], [_hero("B", "d")], 1)
    diff = paired_difference(b)
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
    support = compute_support(battles)
    features = select_features(support)
    index = {f: i for i, f in enumerate(features)}
    X, y = build_design_matrix(battles, index)
    coef, intercept = fit_model(X, y)
    w = dict(zip(features, coef))
    assert w["H|strong"] > w["H|weak"]
    assert w["H|strong"] > 0


def test_fit_model_deterministic():
    battles = _synthetic_battles()
    support = compute_support(battles)
    features = select_features(support)
    index = {f: i for i, f in enumerate(features)}
    X, y = build_design_matrix(battles, index)
    c1 = fit_model(X, y)
    c2 = fit_model(X, y)
    assert (c1[0] == c2[0]).all()
    assert c1[1] == c2[1]


def test_fit_model_handles_single_class():
    # All team1 wins → degenerate; should return a safe zero model.
    battles = [Battle(f"{i}.json", [_hero("A", "d")], [_hero("B", "d")], 1) for i in range(30)]
    support = compute_support(battles)
    features = select_features(support)
    index = {f: i for i, f in enumerate(features)}
    X, y = build_design_matrix(battles, index)
    coef, intercept = fit_model(X, y)
    assert (coef == 0).all()
    assert intercept == 0.0


# --------------------------------------------------------------------------- #
# Analytics + artifact
# --------------------------------------------------------------------------- #

def test_compute_analytics_smoothing_and_sorting():
    battles = _synthetic_battles()
    a = compute_analytics(battles)
    names = [r["name"] for r in a["heroes"]]
    assert "strong" in names
    strong = next(r for r in a["heroes"] if r["name"] == "strong")
    weak = next(r for r in a["heroes"] if r["name"] == "weak")
    assert strong["win_rate"] > weak["win_rate"]
    assert 0.0 <= strong["smoothed_win_rate"] <= 1.0
    # Sorted by smoothed rate descending.
    assert a["heroes"][0]["smoothed_win_rate"] >= a["heroes"][-1]["smoothed_win_rate"]


def test_build_artifact_shape_and_backtest():
    battles = _synthetic_battles(300)
    catalog = {"catalog_version": "t", "hero_count": 2, "skill_count": 0, "default_skill": {}}
    art = build_artifact(battles, [], catalog)
    assert art["schema"]["model_type"] == "paired-logistic"
    assert art["battle_counts"]["total_battles"] == 300
    assert art["battle_counts"]["team1_wins"] + art["battle_counts"]["team2_wins"] == 300
    # No wall-clock/prior-output fields; a deterministic corpus hash instead.
    assert "generated_at" not in art["battle_counts"]
    assert "added_battles" not in art["battle_counts"]
    assert "corpus_version" in art["battle_counts"]
    assert "weights" in art["model"]
    assert "support" in art["model"]
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


def test_build_artifact_byte_identical_two_builds(tmp_path):
    """A full end-to-end build twice on the same corpus is byte-for-byte equal."""
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    # Two heroes with a clear signal so a model actually fits.
    for i in range(60):
        winner = "1" if i % 2 == 0 else "2"
        raw = _battle(
            f"2025-01-01-{i:06d}.json",
            [_hero("A", "d", "s1"), _hero("B", "d", "s2"), _hero("C", "d")],
            [_hero("X", "d"), _hero("Y", "d"), _hero("Z", "d")],
            winner,
        )
        (battles_dir / f"2025-01-01-{i:06d}.json").write_text(
            json.dumps(raw), encoding="utf-8"
        )
    db = tmp_path / "database.json"
    db.write_text(
        json.dumps({"heroes": {"A": {"skill": "d"}, "B": {"skill": "d"}}, "skills": {}}),
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
    good = _battle("good.json", [_hero("A", "d")], [_hero("B", "d")], "1")
    (battles_dir / "good.json").write_text(json.dumps(good), encoding="utf-8")
    bad = _battle("bad.json", [_hero("A", "d")], [_hero("B", "d")], "unknown")
    (battles_dir / "bad.json").write_text(json.dumps(bad), encoding="utf-8")
    db = tmp_path / "database.json"
    db.write_text(json.dumps({"heroes": {}, "skills": {}}), encoding="utf-8")

    out = tmp_path / "should_not_exist.json"
    with pytest.raises(SystemExit):
        build(str(battles_dir), str(db), str(out))
    assert not out.exists()


def test_build_aborts_and_does_not_overwrite_on_unreadable_battle(tmp_path):
    """A pre-existing artifact is left untouched when the corpus is invalid."""
    battles_dir = tmp_path / "battles"
    battles_dir.mkdir()
    good = _battle("good.json", [_hero("A", "d")], [_hero("B", "d")], "1")
    (battles_dir / "good.json").write_text(json.dumps(good), encoding="utf-8")
    # Corrupt/unreadable JSON.
    (battles_dir / "broken.json").write_text("{not json", encoding="utf-8")
    db = tmp_path / "database.json"
    db.write_text(json.dumps({"heroes": {}, "skills": {}}), encoding="utf-8")

    out = tmp_path / "out.json"
    out.write_text("SENTINEL", encoding="utf-8")
    with pytest.raises(SystemExit):
        build(str(battles_dir), str(db), str(out))
    assert out.read_text(encoding="utf-8") == "SENTINEL"
