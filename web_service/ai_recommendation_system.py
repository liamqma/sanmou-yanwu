#!/usr/bin/env python3
"""
AI Recommendation System for Game Strategy
Analyzes battle data to provide optimal hero/skill recommendations for each round
"""

import json
import os
import glob
from collections import defaultdict
from typing import Dict, List, Tuple
import math

class GameAI:
    """AI system for analyzing battle data and providing strategic recommendations"""
    
    def __init__(self, battles_dir: str = 'data/battles', database_path: str = 'data/database.json', battle_files: List[str] = None):
        """
        Initialize the AI system
        
        Args:
            battles_dir: Directory containing battle JSON files
            database_path: Path to skills and hero database
            battle_files: Optional explicit list of battle file paths to load (overrides battles_dir glob)
        """
        self.battles_dir = battles_dir
        self.database_path = database_path
        self.battle_files = battle_files
        self.battles = []
        self.database = {}
        self.hero_stats = defaultdict(lambda: {'wins': 0, 'losses': 0, 'total': 0})
        self.skill_stats = defaultdict(lambda: {'wins': 0, 'losses': 0, 'total': 0})
        self.hero_combinations = defaultdict(lambda: {'wins': 0, 'losses': 0})
        self.skill_combinations = defaultdict(lambda: {'wins': 0, 'losses': 0})
        # Pairwise hero stats: unordered hero pairs -> wins/losses
        self.hero_pair_stats = defaultdict(lambda: {'wins': 0, 'losses': 0})
        # Pairwise skill stats: unordered skill pairs -> wins/losses
        self.skill_pair_stats = defaultdict(lambda: {'wins': 0, 'losses': 0})
        # Cross pair stats: skill with hero -> wins/losses
        self.skill_hero_pair_stats = defaultdict(lambda: {'wins': 0, 'losses': 0})
        
        self._load_data()
        self._analyze_battles()
    
    def _load_data(self):
        """Load battle data and database"""
        # Load database
        if os.path.exists(self.database_path):
            with open(self.database_path, 'r', encoding='utf-8') as f:
                self.database = json.load(f)
        else:
            print(f"Warning: {self.database_path} not found")
            self.database = {'skill': [], 'skill_hero_map': {}}
        
        # Load all battle files
        battle_files = self.battle_files
        if battle_files is None:
            if os.path.exists(self.battles_dir):
                battle_files = glob.glob(os.path.join(self.battles_dir, '*.json'))
            else:
                battle_files = []
        for file_path in battle_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    battle = json.load(f)
                    battle['filename'] = os.path.basename(file_path)
                    self.battles.append(battle)
            except Exception as e:
                print(f"Error loading {file_path}: {e}")
        
        print(f"Loaded {len(self.battles)} battles for analysis")
    
    def _analyze_battles(self):
        """Analyze battle data to extract patterns and statistics"""
        for battle in self.battles:
            winner = battle.get('winner', 'unknown')
            
            for team_key in ['1', '2']:
                team_won = (team_key == winner)
                team_data = battle.get(team_key, [])
                
                # Analyze individual heroes and skills
                for hero_data in team_data:
                    hero_name = hero_data.get('name', '')
                    skills = hero_data.get('skills', [])
                    
                    # Hero statistics
                    self.hero_stats[hero_name]['total'] += 1
                    if team_won:
                        self.hero_stats[hero_name]['wins'] += 1
                    else:
                        self.hero_stats[hero_name]['losses'] += 1
                    
                    # Skill statistics
                    for skill in skills:
                        self.skill_stats[skill]['total'] += 1
                        if team_won:
                            self.skill_stats[skill]['wins'] += 1
                        else:
                            self.skill_stats[skill]['losses'] += 1
                
                # Analyze team combinations
                heroes = [hero.get('name', '') for hero in team_data]
                all_skills = [skill for hero in team_data for skill in hero.get('skills', [])]
                
                # Hero combination (sorted for consistency)
                hero_combo = tuple(sorted(heroes))
                if team_won:
                    self.hero_combinations[hero_combo]['wins'] += 1
                else:
                    self.hero_combinations[hero_combo]['losses'] += 1

                # Pairwise hero stats
                n = len(heroes)
                for i in range(n):
                    hi = heroes[i]
                    for j in range(i + 1, n):
                        hj = heroes[j]
                        key = tuple(sorted((hi, hj)))
                        if team_won:
                            self.hero_pair_stats[key]['wins'] += 1
                        else:
                            self.hero_pair_stats[key]['losses'] += 1
                
                # Skill combination patterns
                skill_combo = tuple(sorted(all_skills))
                if team_won:
                    self.skill_combinations[skill_combo]['wins'] += 1
                else:
                    self.skill_combinations[skill_combo]['losses'] += 1

                # Pairwise skill stats
                m = len(all_skills)
                for i in range(m):
                    si = all_skills[i]
                    for j in range(i + 1, m):
                        sj = all_skills[j]
                        key = tuple(sorted((si, sj)))
                        if team_won:
                            self.skill_pair_stats[key]['wins'] += 1
                        else:
                            self.skill_pair_stats[key]['losses'] += 1

                # Cross skill-hero stats
                for hero in heroes:
                    for skill in all_skills:
                        key = (hero, skill)
                        if team_won:
                            self.skill_hero_pair_stats[key]['wins'] += 1
                        else:
                            self.skill_hero_pair_stats[key]['losses'] += 1
    
    def get_hero_win_rate(self, hero_name: str) -> float:
        """Calculate win rate for a specific hero"""
        stats = self.hero_stats[hero_name]
        if stats['total'] == 0:
            return 0.0
        return stats['wins'] / stats['total']
    
    def get_skill_win_rate(self, skill_name: str) -> float:
        """Calculate win rate for a specific skill"""
        stats = self.skill_stats[skill_name]
        if stats['total'] == 0:
            return 0.0
        return stats['wins'] / stats['total']
    
    def get_top_heroes(self, limit: int = 10) -> List[Tuple[str, float, int]]:
        """Get top heroes by win rate"""
        hero_rankings = []
        for hero, stats in self.hero_stats.items():
            if stats['total'] >= 1:
                win_rate = stats['wins'] / stats['total']
                hero_rankings.append((hero, win_rate, stats['total']))
        
        hero_rankings.sort(key=lambda x: (x[1], x[2]), reverse=True)
        return hero_rankings[:limit]
    
    def get_top_skills(self, limit: int = 15) -> List[Tuple[str, float, int]]:
        """Get top skills by win rate"""
        skill_rankings = []
        for skill, stats in self.skill_stats.items():
            if stats['total'] >= 1:
                win_rate = stats['wins'] / stats['total']
                skill_rankings.append((skill, win_rate, stats['total']))
        
        skill_rankings.sort(key=lambda x: (x[1], x[2]), reverse=True)
        return skill_rankings[:limit]
    
    def _wilson_lower_bound(self, wins: int, total: int, z: float = 1.96) -> float:
        """Wilson score interval lower bound for a Bernoulli parameter (95% default)."""
        if total == 0:
            return 0.0
        phat = wins / total
        denom = 1 + z*z/total
        centre = phat + z*z/(2*total)
        margin = z * math.sqrt((phat*(1 - phat) + z*z/(4*total)) / total)
        return max(0.0, (centre - margin) / denom)

    
    def _get_skill_pair_wilson(self, s1: str, s2: str, min_games: int = 1) -> Tuple[float, int]:
        """Return (wilson_lower_bound, total_games) for a specific unordered skill pair.
        Returns (0.0, 0) if no stats exist."""
        if not s1 or not s2:
            return 0.0, 0
        key = tuple(sorted((s1, s2)))
        stats = self.skill_pair_stats.get(key)
        if not stats:
            return 0.0, 0
        total = stats['wins'] + stats['losses']
        if total <= 0:
            return 0.0, 0
        return self._wilson_lower_bound(stats['wins'], total), total

    def _get_skill_hero_pair_wilson(self, hero: str, skill: str, min_games: int = 1) -> Tuple[float, int]:
        """Return (wilson_lower_bound, total_games) for a specific (hero, skill) pair."""
        if not hero or not skill:
            return 0.0, 0
        stats = self.skill_hero_pair_stats.get((hero, skill))
        if not stats:
            return 0.0, 0
        total = stats['wins'] + stats['losses']
        if total <= 0:
            return 0.0, 0
        return self._wilson_lower_bound(stats['wins'], total), total
    
    def _get_hero_pair_wilson(self, h1: str, h2: str, min_games: int = 1) -> Tuple[float, int]:
        """Return (wilson_lower_bound, total_games) for a specific unordered hero pair.
        Returns (0.0, 0) if no stats exist."""
        if not h1 or not h2:
            return 0.0, 0
        key = tuple(sorted((h1, h2)))
        stats = self.hero_pair_stats.get(key)
        if not stats:
            return 0.0, 0
        total = stats['wins'] + stats['losses']
        if total <= 0:
            return 0.0, 0
        return self._wilson_lower_bound(stats['wins'], total), total

    def recommend_hero_set(
        self,
        available_sets: List[List[str]],
        current_team: List[str],
        *,
        min_wilson: float = 0.40,
        min_games: int = 2,
        include_intra_set: bool = True,
        weight_current_pair: float = 18.0,
        weight_intra_pair: float = 12.0,
        normalize: bool = True,
        unknown_pair_penalty: float = 1.0,
        low_count_penalty: float = 0.25,
    ) -> Dict:
        """Recommend the best hero set from available options using exact pairwise synergy (no top_k).
        Args:
            available_sets: candidate hero sets to choose from
            current_team: heroes already on your team (required)
            min_wilson: minimum Wilson lower bound required for a pair to count toward synergy bonus
            min_games: minimum number of games for a pair to be considered valid for bonus
            include_intra_set: whether to consider pair synergy among the heroes within the candidate set itself
            weight_current_pair: weight multiplier for synergy with existing team heroes
            weight_intra_pair: weight multiplier for synergy among heroes inside the candidate set
            normalize: if True, divide synergy sums by the number of pairs considered to reduce size bias
            unknown_pair_penalty: penalty applied when a pair has no data at all (per pair)
            low_count_penalty: penalty applied when a pair has data but total < min_games (per pair)
        """
        if current_team is None:
            raise ValueError("current_team is required")
        
        recommendations = []
        
        for i, hero_set in enumerate(available_sets):
            score = 0.0
            analysis = {
                'set_index': i,
                'heroes': hero_set,
                'individual_scores': {},
                'current_team_synergy': 0.0,
                'intra_set_synergy': 0.0,
                'current_pairs': 0,
                'intra_pairs': 0,
                'unknown_current_pairs': 0,
                'lowcount_current_pairs': 0,
                'unknown_intra_pairs': 0,
                'lowcount_intra_pairs': 0,
                'synergy_total': 0.0,
                'total_score': 0.0,
            }
            
            # Individual hero scores
            for hero in hero_set:
                hero_score = self.get_hero_win_rate(hero) * 100
                analysis['individual_scores'][hero] = hero_score
                score += hero_score
            
            # Synergy with current team (exact pairwise)
            current_sum = 0.0
            current_pairs = 0
            unknown_current = 0
            lowcount_current = 0
            for current_hero in current_team:
                for new_hero in hero_set:
                    wilson, total = self._get_hero_pair_wilson(current_hero, new_hero, min_games)
                    current_pairs += 1
                    if total == 0:
                        unknown_current += 1
                        current_sum -= unknown_pair_penalty
                        continue
                    if total < min_games:
                        lowcount_current += 1
                        current_sum -= low_count_penalty
                        continue
                    if wilson >= min_wilson:
                        current_sum += wilson * weight_current_pair
            if normalize and current_pairs > 0:
                current_sum /= current_pairs
            analysis['current_team_synergy'] = current_sum
            analysis['current_pairs'] = current_pairs
            analysis['unknown_current_pairs'] = unknown_current
            analysis['lowcount_current_pairs'] = lowcount_current
            
            # Intra-set synergy among the candidate heroes
            intra_sum = 0.0
            intra_pairs = 0
            unknown_intra = 0
            lowcount_intra = 0
            if include_intra_set:
                n = len(hero_set)
                for a in range(n):
                    for b in range(a + 1, n):
                        h1, h2 = hero_set[a], hero_set[b]
                        wilson, total = self._get_hero_pair_wilson(h1, h2, min_games)
                        intra_pairs += 1
                        if total == 0:
                            unknown_intra += 1
                            intra_sum -= unknown_pair_penalty
                            continue
                        if total < min_games:
                            lowcount_intra += 1
                            intra_sum -= low_count_penalty
                            continue
                        if wilson >= min_wilson:
                            intra_sum += wilson * weight_intra_pair
                if normalize and intra_pairs > 0:
                    intra_sum /= intra_pairs
            analysis['intra_set_synergy'] = intra_sum
            analysis['intra_pairs'] = intra_pairs
            analysis['unknown_intra_pairs'] = unknown_intra
            analysis['lowcount_intra_pairs'] = lowcount_intra
            
            synergy_total = current_sum + intra_sum
            analysis['synergy_total'] = synergy_total
            analysis['total_score'] = score + synergy_total
            recommendations.append(analysis)
        
        recommendations.sort(key=lambda x: x['total_score'], reverse=True)
        
        return {
            'recommended_set': recommendations[0]['set_index'],
            'analysis': recommendations,
            'reasoning': self._generate_hero_reasoning(recommendations[0])
        }
    
    def recommend_skill_set(
        self,
        available_sets: List[List[str]],
        current_heroes: List[str],
        current_skills: List[str],
        *,
        min_wilson: float = 0.40,
        min_games: int = 2,
        include_intra_set: bool = True,
        weight_current_skill_pair: float = 12.0,
        weight_intra_skill_pair: float = 10.0,
        weight_skill_hero_pair: float = 6.0,
        normalize: bool = True,
        unknown_pair_penalty: float = 0.8,
        low_count_penalty: float = 0.25,
    ) -> Dict:
        """Recommend the best skill set from available options using exact pairwise synergy.
        Args:
            available_sets: candidate skill sets to choose from
            current_heroes: heroes already on your team (used for skill-hero synergy) (required)
            current_skills: skills already chosen (used for skill-skill synergy) (required)
            min_wilson: minimum Wilson lower bound required for a pair to count toward synergy bonus
            min_games: minimum number of games for a pair to be considered valid for bonus
            include_intra_set: whether to consider pair synergy among the skills within the candidate set itself
            weight_current_skill_pair: weight for synergy with existing skills
            weight_intra_skill_pair: weight for synergy among skills inside the candidate set
            weight_skill_hero_pair: weight for cross synergy of candidate skills with current team heroes
            normalize: if True, divide synergy sums by the number of pairs considered to reduce size bias
            unknown_pair_penalty: penalty applied when a pair has no data at all (per pair)
            low_count_penalty: penalty applied when a pair has data but total < min_games (per pair)
        """
        if current_heroes is None or current_skills is None:
            raise ValueError("current_heroes and current_skills are required")
        
        recommendations = []
        
        for i, skill_set in enumerate(available_sets):
            score = 0.0
            analysis = {
                'set_index': i,
                'skills': skill_set,
                'individual_scores': {},
                'skill_skill_synergy_current': 0.0,
                'skill_skill_synergy_intra': 0.0,
                'skill_hero_synergy': 0.0,
                'current_skill_pairs': 0,
                'intra_skill_pairs': 0,
                'skill_hero_pairs': 0,
                'unknown_current_skill_pairs': 0,
                'lowcount_current_skill_pairs': 0,
                'unknown_intra_skill_pairs': 0,
                'lowcount_intra_skill_pairs': 0,
                'unknown_skill_hero_pairs': 0,
                'lowcount_skill_hero_pairs': 0,
                'synergy_total': 0.0,
                'total_score': 0.0,
            }
            
            # Individual skill scores
            for skill in skill_set:
                skill_score = self.get_skill_win_rate(skill) * 100
                analysis['individual_scores'][skill] = skill_score
                score += skill_score
            
            # Skill-skill synergy with current skills
            cur_sum = 0.0
            cur_pairs = 0
            unknown_cur = 0
            lowcount_cur = 0
            for cur_skill in current_skills:
                for new_skill in skill_set:
                    wilson, total = self._get_skill_pair_wilson(cur_skill, new_skill, min_games)
                    cur_pairs += 1
                    if total == 0:
                        unknown_cur += 1
                        cur_sum -= unknown_pair_penalty
                        continue
                    if total < min_games:
                        lowcount_cur += 1
                        cur_sum -= low_count_penalty
                        continue
                    if wilson >= min_wilson:
                        cur_sum += wilson * weight_current_skill_pair
            if normalize and cur_pairs > 0:
                cur_sum /= cur_pairs
            analysis['skill_skill_synergy_current'] = cur_sum
            analysis['current_skill_pairs'] = cur_pairs
            analysis['unknown_current_skill_pairs'] = unknown_cur
            analysis['lowcount_current_skill_pairs'] = lowcount_cur
            
            # Intra-set skill-skill synergy among the candidate skills
            intra_sum = 0.0
            intra_pairs = 0
            unknown_intra = 0
            lowcount_intra = 0
            if include_intra_set:
                n = len(skill_set)
                for a in range(n):
                    for b in range(a + 1, n):
                        s1, s2 = skill_set[a], skill_set[b]
                        wilson, total = self._get_skill_pair_wilson(s1, s2, min_games)
                        intra_pairs += 1
                        if total == 0:
                            unknown_intra += 1
                            intra_sum -= unknown_pair_penalty
                            continue
                        if total < min_games:
                            lowcount_intra += 1
                            intra_sum -= low_count_penalty
                            continue
                        if wilson >= min_wilson:
                            intra_sum += wilson * weight_intra_skill_pair
                if normalize and intra_pairs > 0:
                    intra_sum /= intra_pairs
            analysis['skill_skill_synergy_intra'] = intra_sum
            analysis['intra_skill_pairs'] = intra_pairs
            analysis['unknown_intra_skill_pairs'] = unknown_intra
            analysis['lowcount_intra_skill_pairs'] = lowcount_intra
            
            # Cross synergy: candidate skills with current team heroes
            cross_sum = 0.0
            cross_pairs = 0
            unknown_cross = 0
            lowcount_cross = 0
            for hero in current_heroes:
                for skill in skill_set:
                    wilson, total = self._get_skill_hero_pair_wilson(hero, skill, min_games)
                    cross_pairs += 1
                    if total == 0:
                        unknown_cross += 1
                        cross_sum -= unknown_pair_penalty
                        continue
                    if total < min_games:
                        lowcount_cross += 1
                        cross_sum -= low_count_penalty
                        continue
                    if wilson >= min_wilson:
                        cross_sum += wilson * weight_skill_hero_pair
            if normalize and cross_pairs > 0:
                cross_sum /= cross_pairs
            analysis['skill_hero_synergy'] = cross_sum
            analysis['skill_hero_pairs'] = cross_pairs
            analysis['unknown_skill_hero_pairs'] = unknown_cross
            analysis['lowcount_skill_hero_pairs'] = lowcount_cross
            
            synergy_total = cur_sum + intra_sum + cross_sum
            analysis['synergy_total'] = synergy_total
            analysis['total_score'] = score + synergy_total
            recommendations.append(analysis)
        
        recommendations.sort(key=lambda x: x['total_score'], reverse=True)
        
        return {
            'recommended_set': recommendations[0]['set_index'],
            'analysis': recommendations,
            'reasoning': self._generate_skill_reasoning(recommendations[0])
        }

    
    def _generate_hero_reasoning(self, analysis: Dict) -> str:
        """Generate human-readable reasoning for hero recommendation"""
        heroes = analysis['heroes']
        scores = analysis['individual_scores']
        
        if not scores:
            return f"Recommended set with total score: {analysis['total_score']:.1f}"
        
        best_hero = max(scores.keys(), key=lambda x: scores[x])
        best_score = scores[best_hero]
        
        reasoning = f"Recommended hero set contains {best_hero} with {best_score:.1f}% win rate. "
        
        # Use new synergy fields
        synergy_total = analysis.get('synergy_total', 0.0)
        current_synergy = analysis.get('current_team_synergy', 0.0)
        intra_synergy = analysis.get('intra_set_synergy', 0.0)
        if synergy_total != 0:
            reasoning += (
                f"Pairwise synergy adds {synergy_total:.1f} points "
            )
            # Provide a brief breakdown when available
            if current_synergy or intra_synergy:
                reasoning += f"(current-team: {current_synergy:.1f}, intra-set: {intra_synergy:.1f}). "
            else:
                reasoning += ". "
        
        reasoning += f"Total score: {analysis['total_score']:.1f}"
        return reasoning
    
    def _generate_skill_reasoning(self, analysis: Dict) -> str:
        """Generate human-readable reasoning for skill recommendation"""
        skills = analysis['skills']
        scores = analysis['individual_scores']
        
        if not scores:
            return f"Recommended set with total score: {analysis['total_score']:.1f}"
        
        best_skill = max(scores.keys(), key=lambda x: scores[x])
        best_score = scores[best_skill]
        
        reasoning = f"Recommended skill set contains {best_skill} with {best_score:.1f}% win rate. "
        
        synergy_total = analysis.get('synergy_total', 0.0)
        cur = analysis.get('skill_skill_synergy_current', 0.0)
        intra = analysis.get('skill_skill_synergy_intra', 0.0)
        cross = analysis.get('skill_hero_synergy', 0.0)
        if synergy_total != 0:
            reasoning += (
                f"Pairwise synergy adds {synergy_total:.1f} points "
            )
            parts = []
            if cur:
                parts.append(f"with current skills: {cur:.1f}")
            if intra:
                parts.append(f"intra-set: {intra:.1f}")
            if cross:
                parts.append(f"with current heroes: {cross:.1f}")
            if parts:
                reasoning += f"(" + ", ".join(parts) + "). "
            else:
                reasoning += ". "
        
        reasoning += f"Total score: {analysis['total_score']:.1f}"
        return reasoning

def main():
    """Example usage of the AI recommendation system"""
    
    # Initialize AI
    ai = GameAI()
    
    print("=" * 60)
    print("GAME META ANALYSIS")
    print("=" * 60)
    
    print(f"\nBattles Analyzed: {len(ai.battles)}")
    
    print("\nTOP HEROES BY WIN RATE:")
    print("-" * 30)
    top_heroes = ai.get_top_heroes(10)
    for i, (hero, win_rate, games) in enumerate(top_heroes, 1):
        print(f"{i:2d}. {hero:<15} {win_rate:.1%} ({games} games)")
    
    print("\nTOP SKILLS BY WIN RATE:")
    print("-" * 30)
    top_skills = ai.get_top_skills(15)
    for i, (skill, win_rate, games) in enumerate(top_skills, 1):
        print(f"{i:2d}. {skill:<15} {win_rate:.1%} ({games} games)")

if __name__ == "__main__":
    main()