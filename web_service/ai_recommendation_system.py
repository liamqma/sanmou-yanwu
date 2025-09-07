#!/usr/bin/env python3
"""
AI Recommendation System for Game Strategy
Analyzes battle data to provide optimal hero/skill recommendations for each round
"""

import json
import os
import glob
from collections import defaultdict, Counter
from typing import Dict, List, Tuple, Set
import statistics
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

    def get_hero_synergies(self, hero_name: str, top_k: int = 5, min_games: int = 1) -> List[Tuple[str, float]]:
        """Find heroes that work well with the given hero using pairwise stats and Wilson ranking.
        Returns a list of (other_hero, score) where score is the Wilson lower bound.
        """
        results = []
        for (h1, h2), stats in self.hero_pair_stats.items():
            if hero_name == h1 or hero_name == h2:
                other = h2 if hero_name == h1 else h1
                total = stats['wins'] + stats['losses']
                if total >= min_games:
                    score = self._wilson_lower_bound(stats['wins'], total)
                    results.append((other, score))
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]
    
    def get_skill_synergies(self, skill_name: str, current_heroes: List[str] = None, top_k: int = 8, min_games: int = 1) -> List[Tuple[str, float]]:
        """Find skills that work well with the given skill using pairwise stats and Wilson ranking.
        Considers both skill-skill and skill-hero signals by returning skills whose pairwise skill score or
        cross skill-hero score (with already chosen heroes) is strong.
        Returns a list of (other_skill, wilson_score).
        """
        if current_heroes is None:
            current_heroes = []
        # Aggregate candidate scores: take the max Wilson score from skill-skill or skill-hero evidence
        cand: Dict[str, float] = {}
        # Skill-skill pairwise
        for (s1, s2), stats in self.skill_pair_stats.items():
            if skill_name == s1 or skill_name == s2:
                other = s2 if skill_name == s1 else s1
                total = stats['wins'] + stats['losses']
                if total >= min_games:
                    score = self._wilson_lower_bound(stats['wins'], total)
                    cand[other] = max(cand.get(other, 0.0), score)
        # Skill-hero cross signal promotes skills linked with current heroes
        for hero in current_heroes:
            for (h, s), stats in self.skill_hero_pair_stats.items():
                if h == hero and s != skill_name:
                    total = stats['wins'] + stats['losses']
                    if total >= min_games:
                        score = self._wilson_lower_bound(stats['wins'], total)
                        cand[s] = max(cand.get(s, 0.0), score)
        # Build ranked list
        results = sorted(cand.items(), key=lambda x: x[1], reverse=True)
        return results[:top_k]

    def get_skill_hero_synergy(self, hero_name: str, skill_name: str, min_games: int = 1) -> float:
        """Wilson lower bound for a specific (hero, skill) pair."""
        stats = self.skill_hero_pair_stats.get((hero_name, skill_name))
        if not stats:
            return 0.0
        total = stats['wins'] + stats['losses']
        if total < min_games:
            return 0.0
        return self._wilson_lower_bound(stats['wins'], total)
    
    def recommend_hero_set(self, available_sets: List[List[str]], current_team: List[str] = None, min_wilson: float = 0.50) -> Dict:
        """Recommend the best hero set from available options
        Args:
            available_sets: candidate hero sets to choose from
            current_team: heroes already on your team
            min_wilson: minimum Wilson lower bound required for a pair to count toward synergy bonus
        """
        if current_team is None:
            current_team = []
        
        recommendations = []
        
        for i, hero_set in enumerate(available_sets):
            score = 0
            analysis = {
                'set_index': i,
                'heroes': hero_set,
                'individual_scores': {},
                'synergy_bonus': 0,
                'total_score': 0
            }
            
            # Individual hero scores
            for hero in hero_set:
                hero_score = self.get_hero_win_rate(hero) * 100
                analysis['individual_scores'][hero] = hero_score
                score += hero_score
            
            # Synergy bonus with current team
            synergy_bonus = 0
            for current_hero in current_team:
                for new_hero in hero_set:
                    synergies = self.get_hero_synergies(current_hero, top_k=10, min_games=1)
                    for synergy_hero, wilson in synergies:
                        if synergy_hero == new_hero and wilson >= min_wilson:
                            synergy_bonus += wilson * 20
            
            analysis['synergy_bonus'] = synergy_bonus
            analysis['total_score'] = score + synergy_bonus
            recommendations.append(analysis)
        
        recommendations.sort(key=lambda x: x['total_score'], reverse=True)
        
        return {
            'recommended_set': recommendations[0]['set_index'],
            'analysis': recommendations,
            'reasoning': self._generate_hero_reasoning(recommendations[0])
        }
    
    def recommend_skill_set(self, available_sets: List[List[str]], current_heroes: List[str] = None, current_skills: List[str] = None, min_wilson: float = 0.50) -> Dict:
        """Recommend the best skill set from available options
        Args:
            available_sets: candidate skill sets to choose from
            current_heroes: heroes already on your team (used for skill-hero synergy)
            current_skills: skills already chosen (used for skill-skill synergy)
            min_wilson: minimum Wilson lower bound required for a pair to count toward skill synergy bonus (0 disables)
        """
        if current_heroes is None:
            current_heroes = []
        if current_skills is None:
            current_skills = []
        
        recommendations = []
        
        for i, skill_set in enumerate(available_sets):
            score = 0
            analysis = {
                'set_index': i,
                'skills': skill_set,
                'individual_scores': {},
                'skill_synergy': 0,
                'total_score': 0
            }
            
            # Individual skill scores
            for skill in skill_set:
                skill_score = self.get_skill_win_rate(skill) * 100
                analysis['individual_scores'][skill] = skill_score
                score += skill_score
            
            # Hero-skill synergy removed: skills are chosen independent of heroes
            
            # Skill-skill synergy
            skill_synergy = 0
            for current_skill in current_skills:
                for new_skill in skill_set:
                    synergies = self.get_skill_synergies(current_skill, current_heroes=current_heroes)
                    for synergy_skill, wilson in synergies:
                        if synergy_skill == new_skill and wilson >= min_wilson:
                            skill_synergy += wilson * 15
            
            analysis['skill_synergy'] = skill_synergy
            analysis['total_score'] = score + skill_synergy
            recommendations.append(analysis)
        
        recommendations.sort(key=lambda x: x['total_score'], reverse=True)
        
        return {
            'recommended_set': recommendations[0]['set_index'],
            'analysis': recommendations,
            'reasoning': self._generate_skill_reasoning(recommendations[0])
        }
    
    def _get_hero_signature_skills(self, hero_name: str) -> List[str]:
        """Get skills associated with a hero from database"""
        signature_skills = []
        skill_hero_map = self.database.get('skill_hero_map', {})
        for skill, hero in skill_hero_map.items():
            if hero == hero_name:
                signature_skills.append(skill)
        return signature_skills
    
    def _generate_hero_reasoning(self, analysis: Dict) -> str:
        """Generate human-readable reasoning for hero recommendation"""
        heroes = analysis['heroes']
        scores = analysis['individual_scores']
        
        if not scores:
            return f"Recommended set with total score: {analysis['total_score']:.1f}"
        
        best_hero = max(scores.keys(), key=lambda x: scores[x])
        best_score = scores[best_hero]
        
        reasoning = f"Recommended hero set contains {best_hero} with {best_score:.1f}% win rate. "
        
        if analysis['synergy_bonus'] > 0:
            reasoning += f"Pairwise synergy (Wilson) adds {analysis['synergy_bonus']:.1f} bonus points. "
        
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
        
        if analysis['skill_synergy'] > 0:
            reasoning += f"Skill synergy (pairwise, Wilson) adds {analysis['skill_synergy']:.1f} points. "
        
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