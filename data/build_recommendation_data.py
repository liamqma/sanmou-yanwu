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
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Iterable

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
        teams[team_key] = heroes

    order_key = _order_key(filename)
    return Battle(
        filename=filename,
        team1=teams[1],
        team2=teams[2],
        winner=winner,
        order_key=order_key,
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

def _non_default_skills(hero: dict[str, Any]) -> list[str]:
    """The draftable (non-default) skills for a hero, order-preserved & unique."""
    skills = hero.get("skills") or []
    out: list[str] = []
    seen: set[str] = set()
    for skill in skills[DEFAULT_SKILL_INDEX + 1:]:
        if skill and skill not in seen:
            seen.add(skill)
            out.append(skill)
    return out


def team_features(team: list[dict[str, Any]]) -> dict[str, int]:
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
        skills = _non_default_skills(hero_data)
        for skill in skills:
            feats[f"{F_SKILL}|{skill}"] = 1
            feats[f"{F_HERO_SKILL}|{hero}|{skill}"] = 1
        # Within-hero skill pairs (sorted for order independence).
        s_sorted = sorted(set(skills))
        for i in range(len(s_sorted)):
            for j in range(i + 1, len(s_sorted)):
                feats[f"{F_SKILL_PAIR}|{hero}|{s_sorted[i]}|{s_sorted[j]}"] = 1

    return feats


def paired_difference(b: Battle) -> dict[str, int]:
    """team1 features minus team2 features for a battle (values in {-1,0,1})."""
    f1 = team_features(b.team1)
    f2 = team_features(b.team2)
    diff: dict[str, int] = {}
    for key in set(f1) | set(f2):
        val = f1.get(key, 0) - f2.get(key, 0)
        if val != 0:
            diff[key] = val
    return diff


def compute_support(battles: list[Battle]) -> dict[str, int]:
    """How many battles each feature appears in (on either team).

    Support = evidence count for shrinking/dropping sparse interactions and for
    reporting per-recommendation evidence in the UI.
    """
    support: dict[str, int] = defaultdict(int)
    for b in battles:
        seen = set(team_features(b.team1)) | set(team_features(b.team2))
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
    battles: list[Battle], feature_index: dict[str, int]
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
        for key, val in paired_difference(b).items():
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
    battles: list[Battle], holdout_frac: float = 0.2, c: float = L2_C
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

    support = compute_support(train)
    features = select_features(support)
    feature_index = {fid: i for i, fid in enumerate(features)}

    X_train, y_train = build_design_matrix(train, feature_index)
    coef, intercept = fit_model(X_train, y_train, c=c)

    X_test, y_test = build_design_matrix(test, feature_index)
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


def compute_analytics(battles: list[Battle]) -> dict[str, Any]:
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
                for skill in _non_default_skills(hero_data):
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
    payload = json.dumps(
        {"heroes": sorted(heroes), "skills": sorted(skills), "default_skill": default_skill},
        ensure_ascii=False,
        sort_keys=True,
    )
    catalog_version = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
    return {
        "catalog_version": catalog_version,
        "hero_count": len(heroes),
        "skill_count": len(skills),
        "default_skill": default_skill,
    }


def compute_corpus_version(battles: list[Battle]) -> str:
    """Deterministic content hash of the validated battles used for training.

    Depends only on battle content (teams + winner, in the deterministic
    ``order_key`` order), never on wall-clock time or prior output, so the same
    corpus always yields the same ``corpus_version`` and therefore a
    byte-identical artifact. Two corpora that differ in any battle content get
    different hashes.
    """
    payload = json.dumps(
        [
            {
                "order_key": b.order_key,
                "winner": b.winner,
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
    support_all = compute_support(battles)
    features = select_features(support_all)
    feature_index = {fid: i for i, fid in enumerate(features)}

    X, y = build_design_matrix(battles, feature_index)
    coef, intercept = fit_model(X, y)

    # Emit weights + evidence keyed by feature id, sorted deterministically.
    weights: dict[str, float] = {}
    support_out: dict[str, int] = {}
    for fid, col in feature_index.items():
        w = float(coef[col])
        # Drop weights shrunk essentially to zero to keep the artifact compact
        # (the client treats a missing feature as the neutral prior of 0).
        if abs(w) < 1e-6:
            continue
        weights[fid] = round(w, 6)
        support_out[fid] = support_all[fid]

    team1_wins = sum(1 for b in battles if b.winner == 1)
    team2_wins = len(battles) - team1_wins

    bt = backtest(battles)
    analytics = compute_analytics(battles)

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

    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(artifact, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")

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
