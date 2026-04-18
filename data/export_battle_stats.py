#!/usr/bin/env python3
"""
Export battle statistics to JSON for client-side use.

This script analyzes all battles and exports the computed statistics
that the JavaScript client needs for recommendations and analytics.
Includes precomputed Wilson lower bound scores to avoid runtime calculation.
"""

import glob
import json
import math
import os
import sys
from collections import defaultdict


def wilson_lower_bound(wins: int, total: int, z: float = 1.96) -> float:
    """Wilson score interval lower bound (95% default)."""
    if total <= 0:
        return 0.0
    phat = wins / total
    denom = 1 + z * z / total
    centre = phat + z * z / (2 * total)
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total)
    return max(0.0, (centre - margin) / denom)


# ---------------------------------------------------------------------------
# Battle data loading & analysis
# ---------------------------------------------------------------------------

def load_battles(battles_dir: str = 'data/battles', battle_files: list = None) -> list:
    """Load battle JSON files from a directory or explicit list.

    Returns a list of battle dicts (each augmented with a 'filename' key).
    """
    battles = []
    if battle_files is None:
        if os.path.exists(battles_dir):
            battle_files = glob.glob(os.path.join(battles_dir, '*.json'))
        else:
            battle_files = []
    for file_path in battle_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                battle = json.load(f)
                battle['filename'] = os.path.basename(file_path)
                battles.append(battle)
        except Exception as e:
            print(f"Error loading {file_path}: {e}")
    return battles


def analyze_battles(battles: list) -> dict:
    """Analyze battle data and return all computed statistics.

    Returns a dict with keys:
        hero_stats, skill_stats, hero_combinations,
        skill_combinations, hero_pair_stats, skill_pair_stats,
        skill_hero_pair_stats
    """
    hero_stats = defaultdict(lambda: {'wins': 0, 'losses': 0, 'total': 0})
    skill_stats = defaultdict(lambda: {'wins': 0, 'losses': 0, 'total': 0})
    hero_combinations = defaultdict(lambda: {'wins': 0, 'losses': 0})
    skill_combinations = defaultdict(lambda: {'wins': 0, 'losses': 0})
    hero_pair_stats = defaultdict(lambda: {'wins': 0, 'losses': 0})
    skill_pair_stats = defaultdict(lambda: {'wins': 0, 'losses': 0})
    skill_hero_pair_stats = defaultdict(lambda: {'wins': 0, 'losses': 0})

    for battle in battles:
        winner = battle.get('winner', 'unknown')

        for team_key in ['1', '2']:
            team_won = (team_key == winner)
            team_data = battle.get(team_key, [])

            # Individual heroes and skills
            for hero_data in team_data:
                hero_name = hero_data.get('name', '')
                skills = hero_data.get('skills', [])

                hero_stats[hero_name]['total'] += 1
                if team_won:
                    hero_stats[hero_name]['wins'] += 1
                else:
                    hero_stats[hero_name]['losses'] += 1

                # Skip the first skill (index 0) — it is the hero's default
                for skill in skills[1:]:
                    skill_stats[skill]['total'] += 1
                    if team_won:
                        skill_stats[skill]['wins'] += 1
                    else:
                        skill_stats[skill]['losses'] += 1

            # Team-level combinations
            heroes = [hero.get('name', '') for hero in team_data]
            all_skills = [skill for hero in team_data for skill in hero.get('skills', [])]

            hero_combo = tuple(sorted(heroes))
            if team_won:
                hero_combinations[hero_combo]['wins'] += 1
            else:
                hero_combinations[hero_combo]['losses'] += 1

            # Pairwise hero stats
            n = len(heroes)
            for i in range(n):
                for j in range(i + 1, n):
                    key = tuple(sorted((heroes[i], heroes[j])))
                    if team_won:
                        hero_pair_stats[key]['wins'] += 1
                    else:
                        hero_pair_stats[key]['losses'] += 1

            # Skill combination patterns
            skill_combo = tuple(sorted(all_skills))
            if team_won:
                skill_combinations[skill_combo]['wins'] += 1
            else:
                skill_combinations[skill_combo]['losses'] += 1

            # Pairwise skill stats (within each hero, excluding default skill)
            for hero_data in team_data:
                additional_skills = hero_data.get('skills', [])[1:]
                m = len(additional_skills)
                for i in range(m):
                    for j in range(i + 1, m):
                        key = tuple(sorted((additional_skills[i], additional_skills[j])))
                        if team_won:
                            skill_pair_stats[key]['wins'] += 1
                        else:
                            skill_pair_stats[key]['losses'] += 1

            # Cross skill-hero stats (excluding default skill)
            for hero_data in team_data:
                hero_name = hero_data.get('name', '')
                for skill in hero_data.get('skills', [])[1:]:
                    key = (hero_name, skill)
                    if team_won:
                        skill_hero_pair_stats[key]['wins'] += 1
                    else:
                        skill_hero_pair_stats[key]['losses'] += 1

    return {
        'hero_stats': hero_stats,
        'skill_stats': skill_stats,
        'hero_combinations': hero_combinations,
        'skill_combinations': skill_combinations,
        'hero_pair_stats': hero_pair_stats,
        'skill_pair_stats': skill_pair_stats,
        'skill_hero_pair_stats': skill_hero_pair_stats,
    }


# ---------------------------------------------------------------------------
# Wilson-enrichment & synergy helpers
# ---------------------------------------------------------------------------

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
    top_n: int = 2,
) -> dict:
    """Precompute synergy dependency data for each hero.

    For every hero, find the top-N partners that produce the largest
    "synergy boost" (pair_wilson - without_partner_wilson).

    Returns a dict keyed by hero name with 'synergy_partners' and
    'has_significant_synergy'.
    """
    result = {}

    for hero, h_stats in hero_stats.items():
        hero_wins = h_stats.get('wins', 0)
        hero_losses = h_stats.get('losses', 0)
        hero_total = hero_wins + hero_losses
        if hero_total <= 0:
            result[hero] = {
                'synergy_partners': [],
                'has_significant_synergy': False,
            }
            continue

        candidates = []

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
            if boost > synergy_threshold:
                candidates.append({
                    'partner': partner,
                    'pair_wilson': round(pair_wilson, 6),
                    'without_wilson': round(without_wilson, 6),
                    'synergy_boost': round(boost, 6),
                    'game_share': round(pair_total / hero_total, 6),
                })

        candidates.sort(key=lambda x: x['synergy_boost'], reverse=True)
        top = candidates[:top_n]

        result[hero] = {
            'synergy_partners': top,
            'has_significant_synergy': len(top) > 0,
        }

    return result


def compute_skill_synergy_stats(
    skill_stats: dict,
    skill_hero_pair_stats: dict,
    min_pair_games: int = 3,
    synergy_threshold: float = 0.08,
    top_n: int = 2,
) -> dict:
    """Precompute synergy dependency data for each skill to its best heroes.

    Returns a dict keyed by skill name with 'synergy_heroes' and
    'has_significant_synergy'.
    """
    result = {}

    for skill, s_stats in skill_stats.items():
        skill_wins = s_stats.get('wins', 0)
        skill_losses = s_stats.get('losses', 0)
        skill_total = skill_wins + skill_losses
        if skill_total <= 0:
            result[skill] = {
                'synergy_heroes': [],
                'has_significant_synergy': False,
            }
            continue

        candidates = []

        for pair_key, p_stats in skill_hero_pair_stats.items():
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
            if boost > synergy_threshold:
                candidates.append({
                    'hero': hero,
                    'pair_wilson': round(pair_wilson, 6),
                    'without_wilson': round(without_wilson, 6),
                    'synergy_boost': round(boost, 6),
                    'game_share': round(pair_total / skill_total, 6),
                })

        candidates.sort(key=lambda x: x['synergy_boost'], reverse=True)
        top = candidates[:top_n]

        result[skill] = {
            'synergy_heroes': top,
            'has_significant_synergy': len(top) > 0,
        }

    return result


# ---------------------------------------------------------------------------
# Main export
# ---------------------------------------------------------------------------

def export_stats(output_path: str = 'web/src/battle_stats.json'):
    """Export all battle statistics to JSON."""
    print("Loading and analyzing battles...")
    battles = load_battles()
    print(f"Loaded {len(battles)} battles for analysis")
    analysis = analyze_battles(battles)

    # Count team wins
    team1_wins = sum(1 for b in battles if b.get('winner') == '1')
    team2_wins = sum(1 for b in battles if b.get('winner') == '2')
    unknown_wins = len(battles) - team1_wins - team2_wins

    # Convert defaultdicts and tuples to JSON-serializable format
    # Add precomputed Wilson scores to avoid runtime calculation in client
    hero_stats_export = add_wilson_to_stats(dict(analysis['hero_stats']))
    hero_pair_stats_export = add_wilson_to_stats(
        {','.join(k): v for k, v in analysis['hero_pair_stats'].items()}
    )

    # Precompute hero synergy dependency data
    hero_synergy_stats = compute_hero_synergy_stats(hero_stats_export, hero_pair_stats_export)

    skill_stats_export = add_wilson_to_stats(dict(analysis['skill_stats']))
    skill_hero_pair_stats_export = add_wilson_to_stats(
        {f"{k[0]},{k[1]}": v for k, v in analysis['skill_hero_pair_stats'].items()}
    )

    # Precompute skill synergy dependency data
    skill_synergy_stats = compute_skill_synergy_stats(skill_stats_export, skill_hero_pair_stats_export)

    stats = {
        'hero_stats': hero_stats_export,
        'skill_stats': skill_stats_export,
        'hero_combinations': add_wilson_to_stats(
            {','.join(k): v for k, v in analysis['hero_combinations'].items()}
        ),
        'hero_pair_stats': hero_pair_stats_export,
        'skill_pair_stats': add_wilson_to_stats(
            {','.join(k): v for k, v in analysis['skill_pair_stats'].items()}
        ),
        'skill_hero_pair_stats': skill_hero_pair_stats_export,
        'hero_synergy_stats': hero_synergy_stats,
        'skill_synergy_stats': skill_synergy_stats,
        'total_battles': len(battles),
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
