#!/usr/bin/env python3
"""
Export battle statistics to JSON for client-side use
This script analyzes all battles and exports the computed statistics
that the JavaScript client needs for recommendations and analytics.
Includes precomputed Wilson lower bound scores to avoid runtime calculation.
"""

import json
import math
import os
import sys
from ai_recommendation_system import GameAI


def wilson_lower_bound(wins: int, total: int, z: float = 1.96) -> float:
    """Wilson score interval lower bound (95% default)."""
    if total <= 0:
        return 0.0
    phat = wins / total
    denom = 1 + z * z / total
    centre = phat + z * z / (2 * total)
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total)
    return max(0.0, (centre - margin) / denom)


def add_wilson_to_stats(stats_dict: dict) -> dict:
    """Add wilson score to each stats entry {wins, losses, total}."""
    result = {}
    for key, val in stats_dict.items():
        entry = dict(val)
        total = entry.get('wins', 0) + entry.get('losses', 0)
        entry['wilson'] = round(wilson_lower_bound(entry.get('wins', 0), total), 6)
        result[key] = entry
    return result


def compute_hero_synergy_stats(
    hero_stats: dict,
    hero_pair_stats: dict,
    min_pair_games: int = 3,
    synergy_threshold: float = 0.08,
) -> dict:
    """
    Precompute synergy dependency data for each hero.

    For every hero, find the partner that produces the largest "synergy boost"
    (pair_wilson − without_partner_wilson).  Store enough info so the client
    can decide Case 1 / Case 2 / Case 3 with pure lookups.

    Returns a dict keyed by hero name:
      {
        "best_partner":             str | null,
        "best_partner_pair_wilson": float,
        "without_best_partner_wilson": float,
        "synergy_boost":            float,     # pair_wilson − without_wilson
        "partner_game_share":       float,     # pair_games / hero_total_games
        "has_significant_synergy":  bool,       # boost > threshold
      }
    """
    result = {}

    for hero, h_stats in hero_stats.items():
        hero_wins = h_stats.get('wins', 0)
        hero_losses = h_stats.get('losses', 0)
        hero_total = hero_wins + hero_losses
        if hero_total <= 0:
            result[hero] = {
                'best_partner': None,
                'best_partner_pair_wilson': 0.0,
                'without_best_partner_wilson': 0.0,
                'synergy_boost': 0.0,
                'partner_game_share': 0.0,
                'has_significant_synergy': False,
            }
            continue

        best = None  # (partner, pair_wilson, without_wilson, boost, pair_games)

        for pair_key, p_stats in hero_pair_stats.items():
            heroes_in_pair = pair_key.split(',')
            if hero not in heroes_in_pair:
                continue
            partner = heroes_in_pair[0] if heroes_in_pair[1] == hero else heroes_in_pair[1]

            pair_wins = p_stats.get('wins', 0)
            pair_losses = p_stats.get('losses', 0)
            pair_total = pair_wins + pair_losses
            if pair_total < min_pair_games:
                continue

            pair_wilson = p_stats.get('wilson', 0.0)

            without_wins = max(0, hero_wins - pair_wins)
            without_losses = max(0, hero_losses - pair_losses)
            without_total = without_wins + without_losses
            without_wilson = wilson_lower_bound(without_wins, without_total)

            boost = pair_wilson - without_wilson
            if best is None or boost > best[3]:
                best = (partner, pair_wilson, without_wilson, boost, pair_total)

        if best is not None and best[3] > synergy_threshold:
            partner, pair_wilson, without_wilson, boost, pair_total = best
            result[hero] = {
                'best_partner': partner,
                'best_partner_pair_wilson': round(pair_wilson, 6),
                'without_best_partner_wilson': round(without_wilson, 6),
                'synergy_boost': round(boost, 6),
                'partner_game_share': round(pair_total / hero_total, 6),
                'has_significant_synergy': True,
            }
        else:
            result[hero] = {
                'best_partner': None,
                'best_partner_pair_wilson': 0.0,
                'without_best_partner_wilson': 0.0,
                'synergy_boost': 0.0,
                'partner_game_share': 0.0,
                'has_significant_synergy': False,
            }

    return result


def compute_skill_synergy_stats(
    skill_stats: dict,
    skill_hero_pair_stats: dict,
    min_pair_games: int = 3,
    synergy_threshold: float = 0.08,
) -> dict:
    """
    Precompute synergy dependency data for each skill to its best hero.

    Mirrors compute_hero_synergy_stats but for the skill→hero relationship.
    For every skill, find the hero that produces the largest "synergy boost"
    (skill_hero_pair_wilson − without_hero_wilson).

    Returns a dict keyed by skill name:
      {
        "best_hero":              str | null,
        "best_hero_pair_wilson":  float,
        "without_best_hero_wilson": float,
        "synergy_boost":          float,
        "hero_game_share":        float,     # pair_games / skill_total_games
        "has_significant_synergy": bool,
      }
    """
    result = {}

    for skill, s_stats in skill_stats.items():
        skill_wins = s_stats.get('wins', 0)
        skill_losses = s_stats.get('losses', 0)
        skill_total = skill_wins + skill_losses
        if skill_total <= 0:
            result[skill] = {
                'best_hero': None,
                'best_hero_pair_wilson': 0.0,
                'without_best_hero_wilson': 0.0,
                'synergy_boost': 0.0,
                'hero_game_share': 0.0,
                'has_significant_synergy': False,
            }
            continue

        best = None  # (hero, pair_wilson, without_wilson, boost, pair_games)

        for pair_key, p_stats in skill_hero_pair_stats.items():
            # Keys are "hero,skill"
            parts = pair_key.split(',', 1)
            if len(parts) != 2 or parts[1] != skill:
                continue
            hero = parts[0]

            pair_wins = p_stats.get('wins', 0)
            pair_losses = p_stats.get('losses', 0)
            pair_total = pair_wins + pair_losses
            if pair_total < min_pair_games:
                continue

            pair_wilson = p_stats.get('wilson', 0.0)

            without_wins = max(0, skill_wins - pair_wins)
            without_losses = max(0, skill_losses - pair_losses)
            without_total = without_wins + without_losses
            without_wilson = wilson_lower_bound(without_wins, without_total)

            boost = pair_wilson - without_wilson
            if best is None or boost > best[3]:
                best = (hero, pair_wilson, without_wilson, boost, pair_total)

        if best is not None and best[3] > synergy_threshold:
            hero, pair_wilson, without_wilson, boost, pair_total = best
            result[skill] = {
                'best_hero': hero,
                'best_hero_pair_wilson': round(pair_wilson, 6),
                'without_best_hero_wilson': round(without_wilson, 6),
                'synergy_boost': round(boost, 6),
                'hero_game_share': round(pair_total / skill_total, 6),
                'has_significant_synergy': True,
            }
        else:
            result[skill] = {
                'best_hero': None,
                'best_hero_pair_wilson': 0.0,
                'without_best_hero_wilson': 0.0,
                'synergy_boost': 0.0,
                'hero_game_share': 0.0,
                'has_significant_synergy': False,
            }

    return result


def export_stats(output_path: str = 'web/src/battle_stats.json'):
    """Export all battle statistics to JSON"""
    print("Loading and analyzing battles...")
    ai = GameAI()
    
    # Count team wins
    team1_wins = sum(1 for battle in ai.battles if battle.get('winner') == '1')
    team2_wins = sum(1 for battle in ai.battles if battle.get('winner') == '2')
    unknown_wins = len(ai.battles) - team1_wins - team2_wins
    
    # Convert defaultdicts and tuples to JSON-serializable format
    # Add precomputed Wilson scores to avoid runtime calculation in client
    hero_stats_export = add_wilson_to_stats(dict(ai.hero_stats))
    hero_pair_stats_export = add_wilson_to_stats({','.join(k): v for k, v in ai.hero_pair_stats.items()})

    # Precompute hero synergy dependency data
    hero_synergy_stats = compute_hero_synergy_stats(hero_stats_export, hero_pair_stats_export)

    skill_stats_export = add_wilson_to_stats(dict(ai.skill_stats))
    skill_hero_pair_stats_export = add_wilson_to_stats({f"{k[0]},{k[1]}": v for k, v in ai.skill_hero_pair_stats.items()})

    # Precompute skill synergy dependency data
    skill_synergy_stats = compute_skill_synergy_stats(skill_stats_export, skill_hero_pair_stats_export)

    stats = {
        'hero_stats': hero_stats_export,
        'skill_stats': skill_stats_export,
        'hero_combinations': add_wilson_to_stats({','.join(k): v for k, v in ai.hero_combinations.items()}),
        'hero_pair_stats': hero_pair_stats_export,
        'skill_pair_stats': add_wilson_to_stats({','.join(k): v for k, v in ai.skill_pair_stats.items()}),
        'skill_hero_pair_stats': skill_hero_pair_stats_export,
        'hero_synergy_stats': hero_synergy_stats,
        'skill_synergy_stats': skill_synergy_stats,
        'total_battles': len(ai.battles),
        'team1_wins': team1_wins,
        'team2_wins': team2_wins,
        'unknown_wins': unknown_wins,
    }
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    # Write to JSON file
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    
    print(f"Exported battle statistics to {output_path}")
    print(f"  - {len(stats['hero_stats'])} heroes")
    print(f"  - {len(stats['skill_stats'])} skills")
    print(f"  - {len(stats['hero_combinations'])} hero combinations")
    print(f"  - {len(stats['hero_pair_stats'])} hero pairs")
    print(f"  - {len(stats['skill_pair_stats'])} skill pairs")
    print(f"  - {len(stats['skill_hero_pair_stats'])} skill-hero pairs")
    synergy_count = sum(1 for v in hero_synergy_stats.values() if v['has_significant_synergy'])
    print(f"  - {len(hero_synergy_stats)} hero synergy entries ({synergy_count} with significant synergy)")
    skill_synergy_count = sum(1 for v in skill_synergy_stats.values() if v['has_significant_synergy'])
    print(f"  - {len(skill_synergy_stats)} skill synergy entries ({skill_synergy_count} with significant synergy)")
    print(f"  - {stats['total_battles']} total battles analyzed")

if __name__ == '__main__':
    output_path = sys.argv[1] if len(sys.argv) > 1 else 'web/src/battle_stats.json'
    export_stats(output_path)