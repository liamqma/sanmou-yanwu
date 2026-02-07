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
    stats = {
        'hero_stats': add_wilson_to_stats(dict(ai.hero_stats)),
        'skill_stats': add_wilson_to_stats(dict(ai.skill_stats)),
        'hero_combinations': add_wilson_to_stats({','.join(k): v for k, v in ai.hero_combinations.items()}),
        'hero_pair_stats': add_wilson_to_stats({','.join(k): v for k, v in ai.hero_pair_stats.items()}),
        'skill_pair_stats': add_wilson_to_stats({','.join(k): v for k, v in ai.skill_pair_stats.items()}),
        'skill_hero_pair_stats': add_wilson_to_stats({f"{k[0]},{k[1]}": v for k, v in ai.skill_hero_pair_stats.items()}),
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
    print(f"  - {stats['total_battles']} total battles analyzed")

if __name__ == '__main__':
    output_path = sys.argv[1] if len(sys.argv) > 1 else 'web/src/battle_stats.json'
    export_stats(output_path)