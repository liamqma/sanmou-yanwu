"""Shared deterministic helpers for recommendation-model evaluation.

The production model builder and the heavier experiment harness both use these
helpers. They deliberately know nothing about model fitting: their job is to
keep capture/upload sessions intact, merge exact and near-duplicate matchups,
create outcome- and season-independent stable-hash holdouts, and report
cluster-aware uncertainty.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

SOURCE_UPLOADED_BY_ME = "uploaded_by_me"
SOURCE_UPLOADED_BY_OTHERS = "uploaded_by_others"
SOURCE_EXTERNAL_YANWU = "external_yanwu"
SOURCE_CATEGORIES = (
    SOURCE_UPLOADED_BY_ME,
    SOURCE_UPLOADED_BY_OTHERS,
    SOURCE_EXTERNAL_YANWU,
)

EVALUATION_PROTOCOL_VERSION = 2
SESSION_GAP_SECONDS = 30 * 60
NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS = 1
GROUP_HOLDOUT_SEED = "sanmou-grouped-holdout-v2"
BOOTSTRAP_SAMPLES = 2_000
BOOTSTRAP_SEED = 0
MIN_BOOTSTRAP_GROUPS = 5


class _DisjointSet:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))

    def find(self, index: int) -> int:
        while self.parent[index] != index:
            self.parent[index] = self.parent[self.parent[index]]
            index = self.parent[index]
        return index

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


def _compact_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _canonical_team(
    team: Iterable[dict[str, Any]],
) -> tuple[tuple[str, ...], tuple[tuple[str, tuple[str, ...]], ...]]:
    """Return hero roster plus equipped-skill state for one team."""
    hero_rows = sorted(
        (
            hero["name"],
            tuple(sorted(hero["skills"][1:])),
        )
        for hero in team
    )
    return (
        tuple(hero for hero, _skills in hero_rows),
        tuple(hero_rows),
    )


def _canonical_matchup(
    battle: Any,
) -> tuple[
    tuple[tuple[str, ...], tuple[str, ...]],
    tuple[tuple[tuple[str, tuple[str, ...]], ...], ...],
]:
    teams = [
        _canonical_team(battle.team1),
        _canonical_team(battle.team2),
    ]
    teams.sort(key=lambda team: (team[0], team[1]))
    return (
        (teams[0][0], teams[1][0]),
        (teams[0][1], teams[1][1]),
    )


def matchup_fingerprint(battle: Any) -> str:
    """Return a side/order-independent matchup fingerprint.

    Source and winner are intentionally excluded. Two reports containing the
    same complete matchup therefore share a fingerprint even when screenshots
    list teams, heroes, or equipped skills in a different order. Excluding the
    winner is essential: held-out outcomes must never influence fold membership.
    """

    _rosters, equipped_skills = _canonical_matchup(battle)
    return hashlib.sha256(
        _compact_json(equipped_skills).encode("utf-8")
    ).hexdigest()


def matchup_skill_replacements(left: Any, right: Any) -> int | None:
    """Count equipped-skill replacements for the same 3v3 hero partition."""
    left_rosters, left_states = _canonical_matchup(left)
    right_rosters, right_states = _canonical_matchup(right)
    if left_rosters != right_rosters:
        return None

    def state_distance(
        first: tuple[tuple[str, tuple[str, ...]], ...],
        second: tuple[tuple[str, tuple[str, ...]], ...],
    ) -> int:
        second_by_hero = dict(second)
        replacements = 0
        for hero, skills in first:
            other = second_by_hero[hero]
            first_set = set(skills)
            other_set = set(other)
            replacements += max(
                len(first_set - other_set),
                len(other_set - first_set),
            )
        return replacements

    direct = state_distance(left_states[0], right_states[0]) + state_distance(
        left_states[1],
        right_states[1],
    )
    if left_rosters[0] != left_rosters[1]:
        return direct
    swapped = state_distance(left_states[0], right_states[1]) + state_distance(
        left_states[1],
        right_states[0],
    )
    return min(direct, swapped)


def _evaluation_identity(battle: Any, fallback: int) -> str | int:
    return (
        getattr(battle, "evaluation_identity", "")
        or getattr(battle, "filename", fallback)
    )


def assign_evaluation_groups(
    battles: Sequence[Any],
    *,
    session_gap_seconds: int = SESSION_GAP_SECONDS,
    cluster_matchups: bool = False,
) -> list[str]:
    """Assign one deterministic leakage group to every battle.

    Consecutive captures/uploads from the same approved source category are one
    session when the inactivity gap is at most thirty minutes. Season is never
    consulted. Web uploads are partitioned by their exact contributor identity
    before applying the gap; this internal value is never reported. Each pinned
    external Yanwu report starts as its own stable report-identity group because
    the release has no trustworthy capture-session provenance; it is never
    collapsed into one release-wide group. Calendar-day boundaries are never
    consulted. Unknown legacy ``IMG_`` captures are joined only when their
    numeric filenames are consecutive.

    When ``cluster_matchups`` is true, exact and one-skill-replacement matchup
    clusters are merged with those session/report groups. Winner/outcome is
    excluded from both grouping relationships.
    """
    if session_gap_seconds < 0:
        raise ValueError("session_gap_seconds must be non-negative")

    dsu = _DisjointSet(len(battles))
    by_session_partition: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, battle in enumerate(battles):
        source = getattr(battle, "source", SOURCE_UPLOADED_BY_ME)
        uploader = (
            getattr(battle, "uploader_identity", "")
            if source == SOURCE_UPLOADED_BY_OTHERS
            else ""
        )
        by_session_partition[(source, uploader)].append(index)

    for partition, indices in by_session_partition.items():
        source, _uploader = partition
        if source == SOURCE_EXTERNAL_YANWU:
            # A report's source-qualified filename contains its immutable
            # source_id. Do not infer sessions from release ordering/timestamps.
            continue
        timestamped = [
            index
            for index in indices
            if getattr(battles[index], "captured_at", None) is not None
        ]
        timestamped.sort(
            key=lambda index: (
                float(battles[index].captured_at),
                getattr(battles[index], "order_key", ""),
                getattr(battles[index], "filename", ""),
            )
        )
        for previous, current in zip(timestamped, timestamped[1:]):
            gap = float(battles[current].captured_at) - float(
                battles[previous].captured_at
            )
            if gap <= session_gap_seconds:
                dsu.union(previous, current)

        legacy_images: list[tuple[int, int]] = []
        for index in indices:
            if getattr(battles[index], "captured_at", None) is not None:
                continue
            match = re.fullmatch(
                r"IMG_(\d+)\.json",
                getattr(battles[index], "filename", ""),
            )
            if match:
                legacy_images.append((int(match.group(1)), index))
        legacy_images.sort()
        for (previous_number, previous), (current_number, current) in zip(
            legacy_images,
            legacy_images[1:],
        ):
            if current_number == previous_number + 1:
                dsu.union(previous, current)

    if cluster_matchups:
        by_roster_partition: dict[tuple[Any, ...], list[int]] = defaultdict(list)
        for index, battle in enumerate(battles):
            rosters, _states = _canonical_matchup(battle)
            by_roster_partition[rosters].append(index)
        for indices in by_roster_partition.values():
            for offset, left in enumerate(indices):
                for right in indices[offset + 1:]:
                    replacements = matchup_skill_replacements(
                        battles[left],
                        battles[right],
                    )
                    if (
                        replacements is not None
                        and replacements
                        <= NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS
                    ):
                        dsu.union(left, right)

    members: dict[int, list[int]] = defaultdict(list)
    for index in range(len(battles)):
        members[dsu.find(index)].append(index)

    group_id_for_root: dict[int, str] = {}
    for root, indices in members.items():
        labels = sorted(
            (
                f"{getattr(battles[index], 'source', SOURCE_UPLOADED_BY_ME)}:"
                f"{_evaluation_identity(battles[index], index)}"
            )
            for index in indices
        )
        digest = hashlib.sha256("\n".join(labels).encode("utf-8")).hexdigest()[:16]
        group_id_for_root[root] = f"group-{digest}"

    return [group_id_for_root[dsu.find(index)] for index in range(len(battles))]


def assign_matchup_clusters(battles: Sequence[Any]) -> list[str]:
    """Assign conservative near-duplicate clusters without joining sessions.

    Session IDs remain the unit used for fold membership and bootstrapping.
    These separate cluster IDs are used to remove an entire training session
    when one of its reports closely matches a held-out report. Keeping the two
    relationships separate avoids one repeated report merging two otherwise
    large capture sessions into a single giant bootstrap cluster.
    """
    dsu = _DisjointSet(len(battles))
    by_roster_partition: dict[tuple[Any, ...], list[int]] = defaultdict(list)
    for index, battle in enumerate(battles):
        rosters, _states = _canonical_matchup(battle)
        by_roster_partition[rosters].append(index)
    for indices in by_roster_partition.values():
        for offset, left in enumerate(indices):
            for right in indices[offset + 1:]:
                replacements = matchup_skill_replacements(
                    battles[left],
                    battles[right],
                )
                if (
                    replacements is not None
                    and replacements <= NEAR_DUPLICATE_MAX_SKILL_REPLACEMENTS
                ):
                    dsu.union(left, right)

    members: dict[int, list[int]] = defaultdict(list)
    for index in range(len(battles)):
        members[dsu.find(index)].append(index)
    cluster_for_root: dict[int, str] = {}
    for root, indices in members.items():
        fingerprints = sorted(matchup_fingerprint(battles[index]) for index in indices)
        digest = hashlib.sha256("\n".join(fingerprints).encode("utf-8")).hexdigest()[:16]
        cluster_for_root[root] = f"matchup-{digest}"
    return [cluster_for_root[dsu.find(index)] for index in range(len(battles))]


def stable_group_holdout_ids(
    group_ids: Sequence[str],
    holdout_frac: float,
    *,
    seed: str = GROUP_HOLDOUT_SEED,
) -> frozenset[str]:
    """Select whole holdout groups by a fixed salted hash order.

    Membership depends only on stable leakage-group identities, the complete
    corpus group set, the documented seed, and the requested fraction. It never
    reads battle season, winner, or an outcome-derived statistic.
    """
    if not 0.0 < holdout_frac < 1.0:
        raise ValueError("holdout_frac must be between 0 and 1")
    if not isinstance(seed, str) or not seed:
        raise ValueError("group holdout seed must be a non-empty string")
    unique_groups = sorted(set(group_ids))
    if len(unique_groups) < 2:
        return frozenset()
    ordered_groups = sorted(
        unique_groups,
        key=lambda group_id: (
            hashlib.sha256(
                f"{seed}\0{group_id}".encode("utf-8")
            ).hexdigest(),
            group_id,
        ),
    )
    holdout_groups = max(1, round(len(ordered_groups) * holdout_frac))
    holdout_groups = min(holdout_groups, len(ordered_groups) - 1)
    return frozenset(ordered_groups[:holdout_groups])


def grouped_hash_split(
    battles: Sequence[Any],
    group_ids: Sequence[str],
    holdout_frac: float,
    *,
    seed: str = GROUP_HOLDOUT_SEED,
) -> tuple[list[Any], list[Any], list[str], list[str]]:
    """Return a deterministic stable-hash holdout of whole leakage groups."""
    if len(battles) != len(group_ids):
        raise ValueError("battles and group_ids must have the same length")
    test_groups = stable_group_holdout_ids(
        group_ids,
        holdout_frac,
        seed=seed,
    )
    train: list[Any] = []
    test: list[Any] = []
    train_groups: list[str] = []
    test_group_ids: list[str] = []
    for battle, group_id in zip(battles, group_ids):
        if group_id in test_groups:
            test.append(battle)
            test_group_ids.append(group_id)
        else:
            train.append(battle)
            train_groups.append(group_id)
    return train, test, train_groups, test_group_ids


def point_metrics(
    outcomes: Sequence[int] | np.ndarray,
    probabilities: Sequence[float] | np.ndarray,
) -> dict[str, float | None]:
    """Compute the three agreed prediction metrics without uncertainty."""
    y = np.asarray(outcomes, dtype=np.int64)
    probs = np.asarray(probabilities, dtype=np.float64)
    if len(y) == 0:
        return {"accuracy": None, "log_loss": None, "brier": None}
    if len(y) != len(probs):
        raise ValueError("outcomes and probabilities must have the same length")

    eps = 1e-12
    predictions = (probs >= 0.5).astype(np.int64)
    return {
        "accuracy": float(np.mean(predictions == y)),
        "log_loss": float(
            -np.mean(
                y * np.log(probs + eps)
                + (1 - y) * np.log(1 - probs + eps)
            )
        ),
        "brier": float(np.mean((probs - y) ** 2)),
    }


def _rounded_metrics(
    metrics: dict[str, float | None],
) -> dict[str, float | None]:
    return {
        name: round(value, 4) if value is not None else None
        for name, value in metrics.items()
    }


def _bootstrap_group_layout(
    group_ids: np.ndarray,
    strata: np.ndarray,
) -> tuple[dict[str, np.ndarray], dict[str, list[str]]]:
    indices_by_group_list: dict[str, list[int]] = defaultdict(list)
    strata_by_group: dict[str, set[str]] = defaultdict(set)
    for index, (group_id, stratum) in enumerate(zip(group_ids, strata)):
        normalized_group = str(group_id)
        indices_by_group_list[normalized_group].append(index)
        strata_by_group[normalized_group].add(str(stratum))

    indices_by_group: dict[str, np.ndarray] = {}
    groups_by_stratum: dict[str, list[str]] = defaultdict(list)
    for group_id in sorted(indices_by_group_list):
        group_strata = sorted(strata_by_group[group_id])
        if len(group_strata) != 1:
            raise ValueError("one evaluation group cannot span bootstrap strata")
        indices_by_group[group_id] = np.asarray(
            indices_by_group_list[group_id],
            dtype=np.int64,
        )
        groups_by_stratum[group_strata[0]].append(group_id)
    return indices_by_group, dict(groups_by_stratum)


def _confidence_interval_status(
    groups_by_stratum: Mapping[str, Sequence[str]],
    bootstrap_samples: int,
) -> str:
    if bootstrap_samples <= 0:
        return "disabled"
    group_counts = [len(groups) for groups in groups_by_stratum.values()]
    minimum_groups = min(group_counts, default=0)
    if minimum_groups < MIN_BOOTSTRAP_GROUPS:
        return "omitted_too_few_groups"
    if minimum_groups < 20:
        return "exploratory_few_groups"
    return "available"


def _cluster_confidence_intervals(
    outcomes: np.ndarray,
    probabilities: np.ndarray,
    group_ids: np.ndarray,
    strata: np.ndarray,
    *,
    bootstrap_samples: int,
    seed: int,
) -> dict[str, dict[str, float] | None]:
    point = point_metrics(outcomes, probabilities)
    indices_by_group, groups_by_stratum = _bootstrap_group_layout(
        group_ids,
        strata,
    )
    if (
        _confidence_interval_status(
            groups_by_stratum,
            bootstrap_samples,
        )
        in {"disabled", "omitted_too_few_groups"}
    ):
        return {name: None for name in point}

    rng = np.random.default_rng(seed)
    samples: dict[str, list[float]] = defaultdict(list)
    for _ in range(bootstrap_samples):
        sampled_indices = []
        for stratum in sorted(groups_by_stratum):
            stratum_groups = sorted(groups_by_stratum[stratum])
            chosen = rng.integers(
                0,
                len(stratum_groups),
                size=len(stratum_groups),
            )
            sampled_indices.extend(
                indices_by_group[stratum_groups[index]]
                for index in chosen
            )
        indices = np.concatenate(sampled_indices)
        metrics = point_metrics(outcomes[indices], probabilities[indices])
        for name, value in metrics.items():
            if value is not None:
                samples[name].append(value)

    intervals: dict[str, dict[str, float] | None] = {}
    for name in point:
        values = samples.get(name, [])
        if not values:
            intervals[name] = None
            continue
        low, high = np.percentile(values, [2.5, 97.5])
        intervals[name] = {
            "low": round(float(low), 4),
            "high": round(float(high), 4),
        }
    return intervals


def prediction_report(
    outcomes: Sequence[int] | np.ndarray,
    probabilities: Sequence[float] | np.ndarray,
    group_ids: Sequence[str] | np.ndarray,
    sources: Sequence[str] | np.ndarray,
    *,
    strata: Sequence[str | int] | np.ndarray | None = None,
    bootstrap_samples: int = BOOTSTRAP_SAMPLES,
    seed: int = BOOTSTRAP_SEED,
    include_source_breakdown: bool = True,
) -> dict[str, Any]:
    """Report metrics plus deterministic session-cluster bootstrap intervals."""
    y = np.asarray(outcomes, dtype=np.int64)
    probs = np.asarray(probabilities, dtype=np.float64)
    groups = np.asarray(group_ids, dtype=object)
    source_values = np.asarray(sources, dtype=object)
    strata_values = (
        np.full(len(y), "all", dtype=object)
        if strata is None
        else np.asarray(strata, dtype=object)
    )
    if not (
        len(y)
        == len(probs)
        == len(groups)
        == len(source_values)
        == len(strata_values)
    ):
        raise ValueError("prediction report inputs must have the same length")

    indices_by_group, groups_by_stratum = _bootstrap_group_layout(
        groups,
        strata_values,
    )
    n_groups = len(indices_by_group)
    confidence_status = _confidence_interval_status(
        groups_by_stratum,
        bootstrap_samples,
    )
    report: dict[str, Any] = {
        "n": int(len(y)),
        "n_groups": n_groups,
        "n_groups_by_stratum": {
            stratum: len(groups_by_stratum[stratum])
            for stratum in sorted(groups_by_stratum)
        },
        **_rounded_metrics(point_metrics(y, probs)),
        "confidence_interval_status": confidence_status,
        "confidence_intervals_95": _cluster_confidence_intervals(
            y,
            probs,
            groups,
            strata_values,
            bootstrap_samples=bootstrap_samples,
            seed=seed,
        ),
    }
    if include_source_breakdown:
        by_source: dict[str, Any] = {}
        for offset, source in enumerate(SOURCE_CATEGORIES):
            mask = source_values == source
            by_source[source] = prediction_report(
                y[mask],
                probs[mask],
                groups[mask],
                source_values[mask],
                strata=strata_values[mask],
                bootstrap_samples=bootstrap_samples,
                seed=seed + offset + 1,
                include_source_breakdown=False,
            )
        report["by_source"] = by_source
    return report


def paired_prediction_delta_report(
    outcomes: Sequence[int] | np.ndarray,
    candidate_probabilities: Sequence[float] | np.ndarray,
    reference_probabilities: Sequence[float] | np.ndarray,
    group_ids: Sequence[str] | np.ndarray,
    *,
    strata: Sequence[str | int] | np.ndarray | None = None,
    bootstrap_samples: int = BOOTSTRAP_SAMPLES,
    seed: int = BOOTSTRAP_SEED,
) -> dict[str, Any]:
    """Return paired candidate-minus-reference metric deltas and intervals."""
    y = np.asarray(outcomes, dtype=np.int64)
    candidate = np.asarray(candidate_probabilities, dtype=np.float64)
    reference = np.asarray(reference_probabilities, dtype=np.float64)
    groups = np.asarray(group_ids, dtype=object)
    strata_values = (
        np.full(len(y), "all", dtype=object)
        if strata is None
        else np.asarray(strata, dtype=object)
    )
    if not (
        len(y)
        == len(candidate)
        == len(reference)
        == len(groups)
        == len(strata_values)
    ):
        raise ValueError("paired prediction inputs must have the same length")

    def deltas(indices: np.ndarray | slice) -> dict[str, float | None]:
        candidate_metrics = point_metrics(y[indices], candidate[indices])
        reference_metrics = point_metrics(y[indices], reference[indices])
        return {
            name: (
                float(candidate_metrics[name] - reference_metrics[name])
                if candidate_metrics[name] is not None
                and reference_metrics[name] is not None
                else None
            )
            for name in candidate_metrics
        }

    point = deltas(slice(None))
    indices_by_group, groups_by_stratum = _bootstrap_group_layout(
        groups,
        strata_values,
    )
    intervals: dict[str, dict[str, float] | None] = {
        name: None
        for name in point
    }
    confidence_status = _confidence_interval_status(
        groups_by_stratum,
        bootstrap_samples,
    )
    if confidence_status not in {"disabled", "omitted_too_few_groups"}:
        rng = np.random.default_rng(seed)
        samples: dict[str, list[float]] = defaultdict(list)
        for _ in range(bootstrap_samples):
            sampled_indices = []
            for stratum in sorted(groups_by_stratum):
                stratum_groups = sorted(groups_by_stratum[stratum])
                chosen = rng.integers(
                    0,
                    len(stratum_groups),
                    size=len(stratum_groups),
                )
                sampled_indices.extend(
                    indices_by_group[stratum_groups[index]]
                    for index in chosen
                )
            indices = np.concatenate(sampled_indices)
            for name, value in deltas(indices).items():
                if value is not None:
                    samples[name].append(value)
        for name, values in samples.items():
            low, high = np.percentile(values, [2.5, 97.5])
            intervals[name] = {
                "low": round(float(low), 4),
                "high": round(float(high), 4),
            }

    return {
        **{
            name: round(value, 4) if value is not None else None
            for name, value in point.items()
        },
        "n": len(y),
        "n_groups": len(indices_by_group),
        "n_groups_by_stratum": {
            stratum: len(groups_by_stratum[stratum])
            for stratum in sorted(groups_by_stratum)
        },
        "confidence_interval_status": confidence_status,
        "confidence_intervals_95": intervals,
    }
