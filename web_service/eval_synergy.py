#!/usr/bin/env python3
import os
import glob
import json
import math
from typing import List, Tuple, Dict
from datetime import datetime

from ai_recommendation_system import GameAI

# Wilson lower bound helper for this script

def wilson_lower_bound(wins: int, total: int, z: float = 1.96) -> float:
    if total <= 0:
        return 0.0
    phat = wins / total
    denom = 1 + z*z/total
    centre = phat + z*z/(2*total)
    margin = z * math.sqrt((phat*(1 - phat) + z*z/(4*total)) / total)
    return max(0.0, (centre - margin) / denom)


# Simple NDCG implementation for ranked pairs
# rel is the ground-truth relevance (we use validation win rate for the pair)
# We convert a list of predicted partners into an ordered list, then compute DCG against rels

def dcg(relevances: List[float]) -> float:
    return sum((rel / math.log2(i + 2)) for i, rel in enumerate(relevances))

def ndcg(pred_order: List[str], rel_map: Dict[str, float], k: int) -> float:
    # Build relevance list in predicted order
    rels = [rel_map.get(x, 0.0) for x in pred_order[:k]]
    ideal_rels = sorted(rel_map.values(), reverse=True)[:k]
    if not any(ideal_rels):
        return 0.0
    return dcg(rels) / max(dcg(ideal_rels), 1e-9)


def load_battle_files_sorted(pattern: str) -> List[str]:
    files = glob.glob(pattern)
    # Sort by timestamp from filename if present; fallback to mtime
    def sort_key(p):
        base = os.path.basename(p)
        # Expect pattern like YYYY-MM-DD-HHMMSS.json
        try:
            stem = os.path.splitext(base)[0]
            dt = datetime.strptime(stem, "%Y-%m-%d-%H%M%S")
            return dt.timestamp()
        except Exception:
            return os.path.getmtime(p)
    return sorted(files, key=sort_key)


def split_files_timewise(files: List[str], train_ratio=0.8, val_ratio=0.2) -> Tuple[List[str], List[str]]:
    n = len(files)
    n_train = max(1, int(n * train_ratio))
    train_files = files[:n_train]
    val_files = files[n_train:]
    return train_files, val_files


def build_validation_pair_winrates(val_files: List[str]) -> Dict[Tuple[str, str], Tuple[int, int]]:
    # Build pair wins/total on validation set
    pair_stats: Dict[Tuple[str, str], Tuple[int, int]] = {}
    for fp in val_files:
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                battle = json.load(f)
        except Exception:
            continue
        winner = battle.get('winner', 'unknown')
        for tk in ['1', '2']:
            team_won = (tk == winner)
            team = battle.get(tk, [])
            heroes = [h.get('name', '') for h in team]
            n = len(heroes)
            for i in range(n):
                hi = heroes[i]
                for j in range(i+1, n):
                    hj = heroes[j]
                    key = tuple(sorted((hi, hj)))
                    w, l = pair_stats.get(key, (0, 0))
                    if team_won:
                        w += 1
                    else:
                        l += 1
                    pair_stats[key] = (w, l)
    return pair_stats


def build_validation_skill_pair_winrates(val_files: List[str]) -> Dict[Tuple[str, str], Tuple[int, int]]:
    # Aggregate validation skill pair wins/total across teams
    pair_stats: Dict[Tuple[str, str], Tuple[int, int]] = {}
    for fp in val_files:
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                battle = json.load(f)
        except Exception:
            continue
        winner = battle.get('winner', 'unknown')
        for tk in ['1', '2']:
            team_won = (tk == winner)
            team = battle.get(tk, [])
            skills = [s for h in team for s in h.get('skills', [])]
            m = len(skills)
            for i in range(m):
                si = skills[i]
                for j in range(i+1, m):
                    sj = skills[j]
                    key = tuple(sorted((si, sj)))
                    w, l = pair_stats.get(key, (0, 0))
                    if team_won:
                        w += 1
                    else:
                        l += 1
                    pair_stats[key] = (w, l)
    return pair_stats


def build_validation_skill_hero_winrates(val_files: List[str]) -> Dict[Tuple[str, str], Tuple[int, int]]:
    # Aggregate validation (hero, skill) wins/total across teams
    pair_stats: Dict[Tuple[str, str], Tuple[int, int]] = {}
    for fp in val_files:
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                battle = json.load(f)
        except Exception:
            continue
        winner = battle.get('winner', 'unknown')
        for tk in ['1', '2']:
            team_won = (tk == winner)
            team = battle.get(tk, [])
            heroes = [h.get('name', '') for h in team]
            skills = [s for h in team for s in h.get('skills', [])]
            for hero in heroes:
                for skill in skills:
                    key = (hero, skill)
                    w, l = pair_stats.get(key, (0, 0))
                    if team_won:
                        w += 1
                    else:
                        l += 1
                    pair_stats[key] = (w, l)
    return pair_stats


def evaluate(min_games_list: List[int], top_k_list: List[int], min_wilson_list: List[float]) -> None:
    files = load_battle_files_sorted(os.path.join('data', 'battles', '*.json'))
    if len(files) < 10:
        print("Not enough files to evaluate meaningfully.")
        return
    train_files, val_files = split_files_timewise(files, 0.8, 0.2)

    # Train AI on train_files only
    ai = GameAI(battle_files=train_files)

    # Build validation ground truth pair win rates
    val_pair_stats = build_validation_pair_winrates(val_files)
    val_skill_pair_stats = build_validation_skill_pair_winrates(val_files)
    val_skill_hero_stats = build_validation_skill_hero_winrates(val_files)

    # Organize validation partners per hero
    val_per_hero: Dict[str, Dict[str, float]] = {}
    for (h1, h2), (w, l) in val_pair_stats.items():
        total = w + l
        if total == 0:
            continue
        wr = w / total
        val_per_hero.setdefault(h1, {})[h2] = wr
        val_per_hero.setdefault(h2, {})[h1] = wr

    heroes_to_eval = sorted(val_per_hero.keys())
    print(f"Train battles: {len(train_files)}, Val battles: {len(val_files)}, Heroes in val: {len(heroes_to_eval)}")

    results = []
    for min_games in min_games_list:
        for top_k in top_k_list:
            for min_wilson in min_wilson_list:
                # Evaluate hero synergies
                ndcgs = []
                coverage = 0
                for hero in heroes_to_eval:
                    pred = ai.get_hero_synergies(hero, top_k=top_k, min_games=min_games)
                    pred = [(p, s) for (p, s) in pred if s >= min_wilson]
                    pred_partners = [p for p, _ in pred]
                    if pred_partners:
                        coverage += 1
                    rel_map = val_per_hero.get(hero, {})
                    nd = ndcg(pred_partners, rel_map, k=top_k)
                    ndcgs.append(nd)
                avg_ndcg_h = sum(ndcgs) / max(1, len(ndcgs))
                cov_rate_h = coverage / max(1, len(heroes_to_eval))
                print(f"[Hero] min_games={min_games:2d}, top_k={top_k:2d}, min_wilson={min_wilson:.2f} -> NDCG={avg_ndcg_h:.3f}, coverage={cov_rate_h:.2%}")

                # Evaluate skill synergies (skill-skill only, independent of heroes)
                # Build predicted order from AI for each skill in validation, then compare to val_skill_pair_stats
                # Construct validation per-skill relevance map
                val_per_skill: Dict[str, Dict[str, float]] = {}
                for (s1, s2), (w, l) in val_skill_pair_stats.items():
                    total = w + l
                    if total <= 0:
                        continue
                    wr = w / total
                    val_per_skill.setdefault(s1, {})[s2] = wr
                    val_per_skill.setdefault(s2, {})[s1] = wr
                skills_to_eval = sorted(val_per_skill.keys())
                ndcgs_s = []
                coverage_s = 0
                for skill in skills_to_eval:
                    pred = ai.get_skill_synergies(skill, current_heroes=[], top_k=top_k, min_games=min_games)
                    pred = [(p, s) for (p, s) in pred if s >= min_wilson]
                    pred_partners = [p for p, _ in pred]
                    if pred_partners:
                        coverage_s += 1
                    rel_map = val_per_skill.get(skill, {})
                    nd = ndcg(pred_partners, rel_map, k=top_k)
                    ndcgs_s.append(nd)
                avg_ndcg_s = sum(ndcgs_s) / max(1, len(ndcgs_s))
                cov_rate_s = coverage_s / max(1, len(skills_to_eval))
                results.append(((min_games, top_k, min_wilson), avg_ndcg_h, cov_rate_h, avg_ndcg_s, cov_rate_s))
                print(f"[Skill] min_games={min_games:2d}, top_k={top_k:2d}, min_wilson={min_wilson:.2f} -> NDCG={avg_ndcg_s:.3f}, coverage={cov_rate_s:.2%}")

    # Pick best by hero NDCG, with coverage as tie-breaker
    results.sort(key=lambda x: (x[1], x[2]), reverse=True)
    if results:
        (mg, tk, mw), best_ndcg_h, cov_h, best_ndcg_s, cov_s = results[0]
        print("\nBest settings by hero NDCG:")
        print(f"min_games={mg}, top_k={tk}, min_wilson={mw:.2f}, hero_NDCG={best_ndcg_h:.3f}, hero_coverage={cov_h:.2%}")
        print(f"Corresponding skill_NDCG={best_ndcg_s:.3f}, skill_coverage={cov_s:.2%}")

if __name__ == '__main__':
    # Reasonable search grid for this dataset size
    evaluate(min_games_list=[1,2,3,5,8,10], top_k_list=[3,5,8,10,12], min_wilson_list=[0.50, 0.55, 0.60])
