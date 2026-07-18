#!/usr/bin/env python3
"""Deterministic offline builder for the client-side recommendation artifact.

Reads valid per-battle JSON files in ``data/battles/*.json`` and emits
``web/src/recommendation_data.json`` — a single artifact the fully client-side
web app imports and scores against locally.

Design (see README.md "Recommendation pipeline" and FUTURE_MODEL_LOGGING.md):

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
  interactions are filtered by a support threshold and shrunk by L2; unseen
  items fall back to the prior (weight 0 → neutral).
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
import math
import os
import re
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

import numpy as np
from sklearn.linear_model import LogisticRegression

# --------------------------------------------------------------------------- #
# Constants / schema metadata
# --------------------------------------------------------------------------- #

SCHEMA_VERSION = 2
MODEL_TYPE = "paired-logistic"

# A skill's first entry (index 0) is the hero's default/signature skill and is
# not a draftable choice, so it is excluded from skill features.
DEFAULT_SKILL_INDEX = 0

# A battle is always two teams of exactly this many heroes; a capture with a
# different count (e.g. OCR dropped or duplicated a hero) is rejected so the
# fail-closed build never trains on a truncated roster.
TEAM_SIZE = 3

# Feature-family prefixes (kept short; they appear as JSON keys).
F_HERO = "H"           # hero present on team
F_SKILL = "S"          # non-default skill present on team
F_HERO_PAIR = "HP"     # unordered hero pair co-present
F_HERO_SKILL = "HS"    # (hero, assigned non-default skill)
F_SKILL_PAIR = "SP"    # unordered non-default skill pair within one hero

# Support thresholds: interactions seen in fewer battles than this are dropped
# (their signal is too sparse to fit; the constituent single-item features still
# carry them). Single-item features use a lower floor.
MIN_SUPPORT_SINGLE = 5
MIN_SUPPORT_PAIR = 8

# L2 inverse-regularization strength for LogisticRegression (smaller = stronger
# shrinkage toward the neutral prior of 0). Chosen to keep sparse interaction
# weights modest; validated by the held-out backtest.
L2_C = 0.5

RANDOM_SEED = 0

# --- Neglect penalty (season-aware) -----------------------------------------
# The paired model only sees teams players actually chose, so it can't tell that
# a long-available-but-rarely-picked hero/skill is probably weak (players avoided
# it). We subtract a penalty from each single-item weight (H|, S|) proportional
# to how *under-appearing* the item is relative to its eligible exposure
# (neglect), gated so it only bites *old* items — a NEW item's low count just
# means "not enough time yet", not "bad", so season forgiveness cancels it.
#
#   penalty(x) = LAMBDA * neglect(x) * (1 - forgive(x))
#   forgive(x) = exp(-(current_season - x.season) / TAU)   # 1 = brand-new
#
# Items with an unknown release season (missing from the catalog, e.g. OCR-only
# "shadow" skills) are treated as season DEFAULT_SEASON (the earliest season):
# "assume it has always been available", so a thin-but-high-weight item cannot
# dodge the penalty simply for lacking metadata.
#
# Validated on human tier/rank correlation (up markedly) and a 6-season rolling
# battle-prediction backtest (pooled accuracy up, no regression). See the
# "Recommendation pipeline" section of the root README.md. LAMBDA=0 disables the
# penalty entirely.
NEGLECT_LAMBDA = 0.5

# Fallback release season for items with no season metadata (unknown => oldest,
# so the neglect penalty applies in full rather than granting a free pass).
DEFAULT_SEASON = 1
NEGLECT_TAU = 2.0

# A filename like 2025-09-04-174619.json encodes a trustworthy capture time we
# use for chronological backtest splits and battle/session grouping.
_DATED_FILENAME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-(\d{6})")


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
    season: int | None = None  # metagame season this battle was captured in


def validate_battle(raw: dict[str, Any], filename: str) -> Battle:
    """Validate a raw battle dict, returning a :class:`Battle`.

    Fails clearly (raising :class:`InvalidBattleError`) on an unknown or invalid
    winner rather than silently counting both teams as losses — this is the bug
    the old exporter had (``winner='unknown'`` → both teams recorded a loss).
    """
    winner_raw = raw.get("winner")
    if winner_raw not in ("1", "2", 1, 2):
        raise InvalidBattleError(
            f"{filename}: invalid/unknown winner {winner_raw!r} "
            f"(expected '1' or '2')"
        )
    winner = int(winner_raw)

    teams: dict[int, list[dict[str, Any]]] = {}
    for team_key in (1, 2):
        team_data = raw.get(str(team_key))
        if not isinstance(team_data, list) or not team_data:
            raise InvalidBattleError(f"{filename}: team {team_key} missing/empty")
        heroes: list[dict[str, Any]] = []
        for hero in team_data:
            name = (hero or {}).get("name")
            if not name:
                raise InvalidBattleError(f"{filename}: team {team_key} has an unnamed hero")
            skills = [s for s in (hero.get("skills") or []) if s]
            heroes.append({"name": name, "skills": skills})
        if len(heroes) != TEAM_SIZE:
            raise InvalidBattleError(
                f"{filename}: team {team_key} has {len(heroes)} heroes "
                f"(expected {TEAM_SIZE})"
            )
        teams[team_key] = heroes

    season_raw = raw.get("season")
    season: int | None
    try:
        season = int(season_raw) if season_raw is not None else None
    except (TypeError, ValueError):
        season = None

    order_key = _order_key(filename)
    return Battle(
        filename=filename,
        team1=teams[1],
        team2=teams[2],
        winner=winner,
        order_key=order_key,
        season=season,
    )


def _order_key(filename: str) -> str:
    """Chronological sort key.

    Dated captures (``YYYY-MM-DD-HHMMSS.json``) sort by their timestamp; other
    filenames sort lexicographically after all dated ones so the split stays
    deterministic. This gives a leak-free chronological backtest when the
    filenames carry trustworthy dates.
    """
    m = _DATED_FILENAME.match(filename)
    if m:
        return f"0-{m.group(1)}{m.group(2)}{m.group(3)}{m.group(4)}"
    return f"1-{filename}"


def load_battles(
    battles_dir: str = "data/battles",
    battle_files: Iterable[str] | None = None,
) -> tuple[list[Battle], list[str]]:
    """Load and validate all battle files.

    Returns ``(valid_battles, errors)``. Battles are sorted by ``order_key`` so
    downstream splits are chronological and deterministic. Invalid/unreadable
    battles are collected here as human-readable diagnostics; loading itself does
    not abort. ``build`` (and therefore the CLI) treats any diagnostic as fatal
    and refuses to write, so an invalid corpus can never partially overwrite the
    artifact.
    """
    if battle_files is None:
        battle_files = sorted(glob.glob(os.path.join(battles_dir, "*.json")))

    battles: list[Battle] = []
    errors: list[str] = []
    for path in battle_files:
        filename = os.path.basename(path)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{filename}: unreadable ({exc})")
            continue
        try:
            battles.append(validate_battle(raw, filename))
        except InvalidBattleError as exc:
            errors.append(str(exc))

    battles.sort(key=lambda b: b.order_key)
    return battles, errors


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


def team_features(
    team: list[dict[str, Any]], default_skill: Mapping[str, str]
) -> dict[str, int]:
    """Binary feature counts for one team.

    Returns a ``{feature_id: 1}`` map (presence-encoded — a feature is on or off
    regardless of how many times it appears, which suits the small 3-hero teams
    and keeps the paired difference in ``{-1, 0, 1}``).

    Feature ids (all name components are the raw CJK strings; pairs are sorted so
    the id is order-independent):

    * ``H|<hero>``                         hero present
    * ``S|<skill>``                        non-default skill present
    * ``HP|<heroA>|<heroB>``               unordered hero pair co-present
    * ``HS|<hero>|<skill>``                hero assigned a non-default skill
    * ``SP|<hero>|<skillA>|<skillB>``      within-hero non-default skill pair
    """
    feats: dict[str, int] = {}

    heroes = [h.get("name", "") for h in team if h.get("name")]
    for hero in heroes:
        feats[f"{F_HERO}|{hero}"] = 1

    # Unordered hero pairs.
    uniq_heroes = sorted(set(heroes))
    for i in range(len(uniq_heroes)):
        for j in range(i + 1, len(uniq_heroes)):
            feats[f"{F_HERO_PAIR}|{uniq_heroes[i]}|{uniq_heroes[j]}"] = 1

    for hero_data in team:
        hero = hero_data.get("name", "")
        if not hero:
            continue
        skills = _non_default_skills(hero_data, default_skill)
        for skill in skills:
            feats[f"{F_SKILL}|{skill}"] = 1
            feats[f"{F_HERO_SKILL}|{hero}|{skill}"] = 1
        # Within-hero skill pairs (sorted for order independence).
        s_sorted = sorted(set(skills))
        for i in range(len(s_sorted)):
            for j in range(i + 1, len(s_sorted)):
                feats[f"{F_SKILL_PAIR}|{hero}|{s_sorted[i]}|{s_sorted[j]}"] = 1

    return feats


def paired_difference(b: Battle, default_skill: Mapping[str, str]) -> dict[str, int]:
    """team1 features minus team2 features for a battle (values in {-1,0,1})."""
    f1 = team_features(b.team1, default_skill)
    f2 = team_features(b.team2, default_skill)
    diff: dict[str, int] = {}
    for key in set(f1) | set(f2):
        val = f1.get(key, 0) - f2.get(key, 0)
        if val != 0:
            diff[key] = val
    return diff


def compute_support(
    battles: list[Battle], default_skill: Mapping[str, str]
) -> dict[str, int]:
    """How many battles each feature appears in (on either team).

    Support = evidence count for shrinking/dropping sparse interactions and for
    reporting per-recommendation evidence in the UI.
    """
    support: dict[str, int] = defaultdict(int)
    for b in battles:
        seen = set(team_features(b.team1, default_skill)) | set(
            team_features(b.team2, default_skill)
        )
        for key in seen:
            support[key] += 1
    return dict(support)


def _min_support_for(feature_id: str) -> int:
    family = feature_id.split("|", 1)[0]
    if family in (F_HERO, F_SKILL):
        return MIN_SUPPORT_SINGLE
    return MIN_SUPPORT_PAIR


def select_features(support: dict[str, int]) -> list[str]:
    """Deterministic sorted list of features that clear their support floor.

    Selection depends only on support counts (never on outcomes), so it cannot
    leak held-out labels.
    """
    kept = [fid for fid, n in support.items() if n >= _min_support_for(fid)]
    kept.sort()
    return kept


# --------------------------------------------------------------------------- #
# Design matrix + model fitting
# --------------------------------------------------------------------------- #

def build_design_matrix(
    battles: list[Battle],
    feature_index: dict[str, int],
    default_skill: Mapping[str, str],
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
        for key, val in paired_difference(b, default_skill).items():
            col = feature_index.get(key)
            if col is not None:
                X[i, col] = val
        y[i] = 1 if b.winner == 1 else 0
    return X, y


def fit_model(X: np.ndarray, y: np.ndarray, c: float = L2_C) -> tuple[np.ndarray, float]:
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
    clf.fit(X, y)
    return clf.coef_[0].astype(np.float64), float(clf.intercept_[0])


# --------------------------------------------------------------------------- #
# Backtest (leak-free, grouped + chronological)
# --------------------------------------------------------------------------- #

def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


def backtest(
    battles: list[Battle],
    default_skill: Mapping[str, str],
    holdout_frac: float = 0.2,
    c: float = L2_C,
) -> dict[str, Any]:
    """Chronological held-out backtest with no leakage.

    Battles are already sorted chronologically (``order_key``); the last
    ``holdout_frac`` become the test set. Feature *selection*, *design*, and
    *fitting* all happen on the train split only, so the held-out outcomes never
    influence the model or the feature space. Reports accuracy, log loss, Brier
    score, and sample count.
    """
    n = len(battles)
    if n < 20:
        return {
            "n_test": 0,
            "accuracy": None,
            "log_loss": None,
            "brier": None,
            "note": "insufficient battles for a backtest",
            "holdout_frac": holdout_frac,
        }

    split = int(round(n * (1.0 - holdout_frac)))
    split = max(1, min(split, n - 1))
    train, test = battles[:split], battles[split:]

    support = compute_support(train, default_skill)
    features = select_features(support)
    feature_index = {fid: i for i, fid in enumerate(features)}

    X_train, y_train = build_design_matrix(train, feature_index, default_skill)
    coef, intercept = fit_model(X_train, y_train, c=c)

    X_test, y_test = build_design_matrix(test, feature_index, default_skill)
    logits = X_test @ coef + intercept
    probs = _sigmoid(logits)

    eps = 1e-12
    preds = (probs >= 0.5).astype(np.int64)
    accuracy = float(np.mean(preds == y_test))
    log_loss = float(
        -np.mean(y_test * np.log(probs + eps) + (1 - y_test) * np.log(1 - probs + eps))
    )
    brier = float(np.mean((probs - y_test) ** 2))

    return {
        "n_train": len(train),
        "n_test": len(test),
        "accuracy": round(accuracy, 4),
        "log_loss": round(log_loss, 4),
        "brier": round(brier, 4),
        "holdout_frac": holdout_frac,
        "baseline_accuracy": round(float(max(np.mean(y_test), 1 - np.mean(y_test))), 4),
    }


# --------------------------------------------------------------------------- #
# Smoothed analytics (for the Analytics page — descriptive, not the model)
# --------------------------------------------------------------------------- #

def _smoothed_rate(wins: int, total: int, prior: float, strength: float = 5.0) -> float:
    """Additive (Beta) smoothing toward ``prior`` with pseudo-count ``strength``."""
    if total <= 0:
        return prior
    return (wins + prior * strength) / (total + strength)


# --------------------------------------------------------------------------- #
# Season-aware neglect penalty (applied to single-item H|/S| weights)
# --------------------------------------------------------------------------- #

def _empirical_bayes_k(rates: list[float]) -> float:
    """Auto-derive the Beta smoothing pseudo-count ``expo_k = alpha + beta`` from
    the per-item appearance-rate distribution via method-of-moments.

    Modeling each item's true appearance rate as ``Beta(alpha, beta)``::

        m = mean(rate), v = var(rate);  expo_k = m*(1-m)/v - 1  (= alpha + beta)

    High variance across items -> small k (trust each item's own rate quickly);
    low variance -> large k (shrink harder toward the global average). This
    removes the need to hand-tune the smoothing constant.
    """
    n = len(rates)
    if n < 2:
        return 1.0
    m = sum(rates) / n
    v = sum((r - m) ** 2 for r in rates) / (n - 1)
    if v <= 0 or m <= 0 or m >= 1:
        return 1.0
    # ``common`` can go negative when variance exceeds the Bernoulli ceiling;
    # clamp to a small positive floor so smoothing stays well-defined.
    return max(m * (1.0 - m) / v - 1.0, 1.0)


def compute_neglect(
    appearances: Mapping[str, int],
    item_season: Mapping[str, int | None],
    battle_seasons: list[int | None],
) -> dict[str, float]:
    """Per-item ``neglect`` in ``[0, 1)``: how under-appearing an item is relative
    to its *eligible exposure* (battles whose season >= the item's release
    season). ``0`` means at/above the average appearance rate (never penalized);
    values approaching ``1`` mean "available for a long time yet rarely chosen".

    The appearance rate is Beta-smoothed toward the global average with an
    auto-derived (empirical-Bayes) pseudo-count so thin-exposure items are not
    judged on noise. Depends only on counts + seasons, so it is deterministic.
    """
    seasoned = [s for s in battle_seasons if s is not None]

    def eligible(item_s: int | None) -> int:
        # Unknown season => oldest (DEFAULT_SEASON): eligible for every battle.
        s0 = DEFAULT_SEASON if item_s is None else item_s
        return sum(1 for s in seasoned if s >= s0)

    # Consider every item that actually appears, even ones absent from the
    # catalog's season map (e.g. OCR-only "shadow" skills) — they default to
    # DEFAULT_SEASON rather than being skipped.
    items = set(item_season) | set(appearances)

    rates: list[float] = []
    elig: dict[str, int] = {}
    for item in items:
        e = eligible(item_season.get(item))
        elig[item] = e
        if e > 0 and item in appearances:
            rates.append(appearances[item] / e)
    global_rate = (sum(rates) / len(rates)) if rates else 0.01
    expo_k = _empirical_bayes_k(rates)

    neglect: dict[str, float] = {}
    for item in items:
        e = elig[item]
        ap = appearances.get(item, 0)
        sm_rate = (ap + global_rate * expo_k) / (e + expo_k) if (e + expo_k) > 0 else global_rate
        ratio = sm_rate / global_rate if global_rate > 0 else 1.0
        neglect[item] = max(0.0, 1.0 - min(1.0, ratio))
    return neglect


def _forgive(item_s: int | None, current_season: int | None, tau: float) -> float:
    """Season forgiveness in ``(0, 1]``: ``1`` for a brand-new item (recency 0),
    decaying toward ``0`` for older items. An unknown item season defaults to
    ``DEFAULT_SEASON`` (oldest), so a missing release season yields ~no
    forgiveness and never *cancels* a deserved penalty."""
    if current_season is None:
        return 0.0
    s0 = DEFAULT_SEASON if item_s is None else item_s
    recency = max(0, current_season - s0)
    return math.exp(-recency / tau)


def neglect_penalties(
    appearances: Mapping[str, int],
    item_season: Mapping[str, int | None],
    battle_seasons: list[int | None],
    current_season: int | None,
    lam: float = NEGLECT_LAMBDA,
    tau: float = NEGLECT_TAU,
) -> dict[str, float]:
    """Per-item penalty ``lam * neglect * (1 - forgive)`` (always ``>= 0``)."""
    if lam <= 0:
        return {}
    neglect = compute_neglect(appearances, item_season, battle_seasons)
    out: dict[str, float] = {}
    for item, neg in neglect.items():
        if neg <= 0:
            continue
        pen = lam * neg * (1.0 - _forgive(item_season.get(item), current_season, tau))
        if pen > 0:
            out[item] = pen
    return out


def count_appearances(
    battles: list[Battle], default_skill: Mapping[str, str]
) -> tuple[dict[str, int], dict[str, int]]:
    """Battles each hero / non-default skill appears in (either team).

    This is the ``neglect`` numerator: how often players actually chose the item
    when it was available. Signature skills are excluded (they are not drafted).
    """
    hero_ap: dict[str, int] = defaultdict(int)
    skill_ap: dict[str, int] = defaultdict(int)
    for b in battles:
        for team in (b.team1, b.team2):
            for hero in team:
                name = hero.get("name", "")
                if not name:
                    continue
                hero_ap[name] += 1
                for skill in _non_default_skills(hero, default_skill):
                    skill_ap[skill] += 1
    return dict(hero_ap), dict(skill_ap)


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
                for skill in _non_default_skills(hero_data, default_skill):
                    skill_total[skill] += 1
                    skill_wins[skill] += won

    prior = (global_wins / global_total) if global_total else 0.5

    def rows(wins: dict[str, int], total: dict[str, int]) -> list[dict[str, Any]]:
        out = []
        for name, tot in total.items():
            w = wins[name]
            out.append({
                "name": name,
                "wins": w,
                "losses": tot - w,
                "total": tot,
                "win_rate": round(w / tot, 4) if tot else 0.0,
                "smoothed_win_rate": round(_smoothed_rate(w, tot, prior), 4),
            })
        # Deterministic: smoothed rate desc, then total desc, then name.
        out.sort(key=lambda r: (-r["smoothed_win_rate"], -r["total"], r["name"]))
        return out

    return {
        "prior_win_rate": round(prior, 4),
        "heroes": rows(hero_wins, hero_total),
        "skills": rows(skill_wins, skill_total),
    }


# --------------------------------------------------------------------------- #
# Catalog (from database.json) + artifact assembly
# --------------------------------------------------------------------------- #

def load_catalog(database_path: str) -> dict[str, Any]:
    """Extract catalog metadata from database.json.

    The client needs the hero→default-skill map to reproduce the exact
    non-default-skill feature extraction used at train time. ``catalog_version``
    is a content hash so the client can detect a mismatched database at runtime.
    """
    with open(database_path, "r", encoding="utf-8") as fh:
        db = json.load(fh)
    heroes = db.get("heroes", {})
    skills = db.get("skills", {})
    default_skill = {
        name: hero.get("skill")
        for name, hero in heroes.items()
        if hero.get("skill")
    }

    def _season(meta: dict[str, Any]) -> int | None:
        raw = meta.get("season")
        try:
            return int(raw) if raw is not None else None
        except (TypeError, ValueError):
            return None

    hero_season = {name: _season(meta) for name, meta in heroes.items()}
    skill_season = {name: _season(meta) for name, meta in skills.items()}

    # Release seasons feed the neglect penalty, so they are part of the catalog's
    # identity — include them in the version hash so a season edit re-hashes.
    payload = json.dumps(
        {
            "heroes": sorted(heroes),
            "skills": sorted(skills),
            "default_skill": default_skill,
            "hero_season": hero_season,
            "skill_season": skill_season,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    catalog_version = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
    return {
        "catalog_version": catalog_version,
        "hero_count": len(heroes),
        "skill_count": len(skills),
        "default_skill": default_skill,
        "hero_season": hero_season,
        "skill_season": skill_season,
    }


def compute_corpus_version(battles: list[Battle]) -> str:
    """Deterministic content hash of the validated battles used for training.

    Depends only on battle content (teams + winner + season, in the
    deterministic ``order_key`` order), never on wall-clock time or prior
    output, so the same corpus always yields the same ``corpus_version`` and
    therefore a byte-identical artifact. Season is hashed because the neglect
    penalty depends on it (via ``current_season`` and each item's eligible
    exposure), so two corpora that differ only in season labels must get
    different hashes. Two corpora that differ in any battle content get
    different hashes.
    """
    payload = json.dumps(
        [
            {
                "order_key": b.order_key,
                "winner": b.winner,
                "team1": b.team1,
                "team2": b.team2,
                "season": b.season,
            }
            for b in sorted(battles, key=lambda b: (b.order_key, b.filename))
        ],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def build_artifact(
    battles: list[Battle],
    errors: list[str],
    catalog: dict[str, Any],
) -> dict[str, Any]:
    """Assemble the full ``recommendation_data.json`` artifact.

    The model here is fit on *all* valid battles (the backtest, computed
    separately on a chronological holdout, is what estimates generalization).

    The result is a pure function of ``battles`` + ``catalog`` (``errors`` is
    only used for the invalid-count) — no wall-clock, no prior-output dependence
    — so re-running on the same inputs is byte-identical.
    """
    default_skill: Mapping[str, str] = catalog.get("default_skill", {})
    support_all = compute_support(battles, default_skill)
    features = select_features(support_all)
    feature_index = {fid: i for i, fid in enumerate(features)}

    X, y = build_design_matrix(battles, feature_index, default_skill)
    coef, intercept = fit_model(X, y)

    # --- Season-aware neglect penalty on single-item (H|/S|) weights ---------
    # The paired model can't see that a long-available-but-rarely-picked item is
    # weak; subtract a penalty from its raw weight, forgiving genuinely new items
    # (see NEGLECT_LAMBDA/NEGLECT_TAU). Combos (HP/HS/SP) are left untouched.
    battle_seasons = [b.season for b in battles]
    current_season = max((s for s in battle_seasons if s is not None), default=None)
    hero_ap, skill_ap = count_appearances(battles, default_skill)
    hero_pen = neglect_penalties(
        hero_ap, catalog.get("hero_season", {}), battle_seasons, current_season
    )
    skill_pen = neglect_penalties(
        skill_ap, catalog.get("skill_season", {}), battle_seasons, current_season
    )

    def penalty_for(fid: str) -> float:
        prefix, _, name = fid.partition("|")
        if prefix == F_HERO:
            return hero_pen.get(name, 0.0)
        if prefix == F_SKILL:
            return skill_pen.get(name, 0.0)
        return 0.0

    # Emit weights + evidence keyed by feature id, sorted deterministically.
    # The exported weight is the penalty-adjusted value so both the engine's team
    # scoring and per-item displays use one consistent number.
    weights: dict[str, float] = {}
    support_out: dict[str, int] = {}
    for fid, col in feature_index.items():
        w = float(coef[col]) - penalty_for(fid)
        # Drop weights shrunk essentially to zero to keep the artifact compact
        # (the client treats a missing feature as the neutral prior of 0).
        if abs(w) < 1e-6:
            continue
        weights[fid] = round(w, 6)
        support_out[fid] = support_all[fid]

    team1_wins = sum(1 for b in battles if b.winner == 1)
    team2_wins = len(battles) - team1_wins

    bt = backtest(battles, default_skill)
    analytics = compute_analytics(battles, default_skill)

    # Attach the penalty-adjusted single-item strength to each analytics row and
    # re-rank hero/skill tables by it (this is the value the Analytics page sorts
    # on). Missing feature => neutral 0 (dropped as ~zero above).
    def _attach_adjusted(rows: list[dict[str, Any]], prefix: str) -> list[dict[str, Any]]:
        for row in rows:
            fid = f"{prefix}|{row['name']}"
            row["adjusted_strength"] = weights.get(fid, 0.0)
        rows.sort(
            key=lambda r: (-r["adjusted_strength"], -r["smoothed_win_rate"], -r["total"], r["name"])
        )
        return rows

    analytics["heroes"] = _attach_adjusted(analytics["heroes"], F_HERO)
    analytics["skills"] = _attach_adjusted(analytics["skills"], F_SKILL)

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
            "neglect_lambda": NEGLECT_LAMBDA,
            "neglect_tau": NEGLECT_TAU,
            "current_season": current_season,
            "n_features": len(weights),
            "weights": weights,
            "support": support_out,
        },
        "analytics": analytics,
        "backtest": bt,
    }


def build(
    battles_dir: str = "data/battles",
    database_path: str = "web/src/database.json",
    output_path: str = "web/src/recommendation_data.json",
) -> dict[str, Any]:
    """End-to-end build; writes ``output_path`` and returns the artifact.

    Fail-closed: if *any* battle file is invalid or unreadable, this aborts
    (raising ``SystemExit``) *before* writing, so a corrupt capture can never
    silently skew the model or partially overwrite the artifact.
    """
    battles, errors = load_battles(battles_dir)
    if errors:
        print(f"✗ {len(errors)} invalid/unreadable battle file(s):", file=sys.stderr)
        for err in errors[:20]:
            print(f"   - {err}", file=sys.stderr)
        if len(errors) > 20:
            print(f"   ... and {len(errors) - 20} more", file=sys.stderr)
        raise SystemExit(
            "Aborting before write: fix or remove the invalid battle file(s) above."
        )
    if not battles:
        raise SystemExit("No valid battles found — nothing to build.")

    catalog = load_catalog(database_path)
    artifact = build_artifact(battles, errors, catalog)

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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="web/src/recommendation_data.json")
    parser.add_argument("--battles-dir", default="data/battles")
    parser.add_argument("--database", default="web/src/database.json")
    args = parser.parse_args(argv)
    build(
        battles_dir=args.battles_dir,
        database_path=args.database,
        output_path=args.output,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
