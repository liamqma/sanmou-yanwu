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

class GameAI:
    """AI system for analyzing battle data and providing strategic recommendations"""
    
    def __init__(self, battles_dir: str = 'battles', database_path: str = 'database.json'):
        """
        Initialize the AI system
        
        Args:
            battles_dir: Directory containing battle JSON files
            database_path: Path to skills and hero database
        """
        self.battles_dir = battles_dir
        self.database_path = database_path
        self.battles = []
        self.database = {}
        self.hero_stats = defaultdict(lambda: {'wins': 0, 'losses': 0, 'total': 0})
        self.skill_stats = defaultdict(lambda: {'wins': 0, 'losses': 0, 'total': 0})
        self.hero_combinations = defaultdict(lambda: {'wins': 0, 'losses': 0})
        self.skill_combinations = defaultdict(lambda: {'wins': 0, 'losses': 0})
        
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
        if os.path.exists(self.battles_dir):
            battle_files = glob.glob(os.path.join(self.battles_dir, '*.json'))
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
                
                # Skill combination patterns
                skill_combo = tuple(sorted(all_skills))
                if team_won:
                    self.skill_combinations[skill_combo]['wins'] += 1
                else:
                    self.skill_combinations[skill_combo]['losses'] += 1
    
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
    
    def get_hero_synergies(self, hero_name: str) -> List[Tuple[str, float]]:
        """Find heroes that work well with the given hero"""
        synergies = defaultdict(lambda: {'wins': 0, 'total': 0})
        
        for combo, stats in self.hero_combinations.items():
            if hero_name in combo and len(combo) > 1:
                for other_hero in combo:
                    if other_hero != hero_name:
                        synergies[other_hero]['wins'] += stats['wins']
                        synergies[other_hero]['total'] += stats['wins'] + stats['losses']
        
        synergy_list = []
        for hero, stats in synergies.items():
            if stats['total'] >= 1:
                win_rate = stats['wins'] / stats['total']
                synergy_list.append((hero, win_rate))
        
        synergy_list.sort(key=lambda x: x[1], reverse=True)
        return synergy_list[:5]
    
    def get_skill_synergies(self, skill_name: str) -> List[Tuple[str, float]]:
        """Find skills that work well with the given skill"""
        synergies = defaultdict(lambda: {'wins': 0, 'total': 0})
        
        for combo, stats in self.skill_combinations.items():
            if skill_name in combo and len(combo) > 1:
                for other_skill in combo:
                    if other_skill != skill_name:
                        synergies[other_skill]['wins'] += stats['wins']
                        synergies[other_skill]['total'] += stats['wins'] + stats['losses']
        
        synergy_list = []
        for skill, stats in synergies.items():
            if stats['total'] >= 1:
                win_rate = stats['wins'] / stats['total']
                synergy_list.append((skill, win_rate))
        
        synergy_list.sort(key=lambda x: x[1], reverse=True)
        return synergy_list[:8]
    
    def recommend_hero_set(self, available_sets: List[List[str]], current_team: List[str] = None) -> Dict:
        """Recommend the best hero set from available options"""
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
                    synergies = self.get_hero_synergies(current_hero)
                    for synergy_hero, synergy_rate in synergies:
                        if synergy_hero == new_hero:
                            synergy_bonus += synergy_rate * 20
            
            analysis['synergy_bonus'] = synergy_bonus
            analysis['total_score'] = score + synergy_bonus
            recommendations.append(analysis)
        
        recommendations.sort(key=lambda x: x['total_score'], reverse=True)
        
        return {
            'recommended_set': recommendations[0]['set_index'],
            'analysis': recommendations,
            'reasoning': self._generate_hero_reasoning(recommendations[0])
        }
    
    def recommend_skill_set(self, available_sets: List[List[str]], current_heroes: List[str] = None, current_skills: List[str] = None) -> Dict:
        """Recommend the best skill set from available options"""
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
                'hero_synergy': 0,
                'skill_synergy': 0,
                'total_score': 0
            }
            
            # Individual skill scores
            for skill in skill_set:
                skill_score = self.get_skill_win_rate(skill) * 100
                analysis['individual_scores'][skill] = skill_score
                score += skill_score
            
            # Hero-skill synergy
            hero_synergy = 0
            for hero in current_heroes:
                hero_skills = self._get_hero_signature_skills(hero)
                for skill in skill_set:
                    if skill in hero_skills:
                        hero_synergy += 25
            
            # Skill-skill synergy
            skill_synergy = 0
            for current_skill in current_skills:
                for new_skill in skill_set:
                    synergies = self.get_skill_synergies(current_skill)
                    for synergy_skill, synergy_rate in synergies:
                        if synergy_skill == new_skill:
                            skill_synergy += synergy_rate * 15
            
            analysis['hero_synergy'] = hero_synergy
            analysis['skill_synergy'] = skill_synergy
            analysis['total_score'] = score + hero_synergy + skill_synergy
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
            reasoning += f"Strong team synergy adds {analysis['synergy_bonus']:.1f} bonus points. "
        
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
        
        if analysis['hero_synergy'] > 0:
            reasoning += f"Hero synergy adds {analysis['hero_synergy']:.1f} points. "
        
        if analysis['skill_synergy'] > 0:
            reasoning += f"Skill synergy adds {analysis['skill_synergy']:.1f} points. "
        
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