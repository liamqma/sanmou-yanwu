#!/usr/bin/env python3
"""
Web-based Game Advisor
Flask web interface for real-time game recommendations
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
from ai_recommendation_system import GameAI
import uuid

app = Flask(__name__)
# Enable CORS for API routes
CORS(app, resources={r"/api/*": {"origins": "*"}})
app.secret_key = 'game_advisor_secret_key_' + str(uuid.uuid4())

# Development settings
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Global AI instance
game_ai = None

def get_ai():
    """Get or initialize the AI system"""
    global game_ai
    if game_ai is None:
        game_ai = GameAI()
    return game_ai

# API: POST /api/get_recommendation
# Purpose: Provide the AI recommendation for the current round given three option sets.
# Used by: React frontend (GameBoard component)
# Request JSON: { round_type: 'hero'|'skill', available_sets: List[List[str]], game_state: {...} }
# Response JSON: { success: bool, recommendation: { recommended_set_index, recommended_set, reasoning, analysis: [...] }, round_info: {...} }
@app.route('/api/get_recommendation', methods=['POST'])
def get_recommendation():
    """Get AI recommendation for current round"""
    data = request.json
    round_type = data.get('round_type')  # 'hero' or 'skill'
    available_sets = data.get('available_sets', [])
    game_state = data.get('game_state', {})
    
    # Validate game state is provided
    if not game_state:
        return jsonify({'error': 'Game state is required. Please provide current heroes and skills.'}), 400
    
    # Validate required fields in game state
    current_heroes = game_state.get('current_heroes', [])
    current_skills = game_state.get('current_skills', [])
    
    if not current_heroes:
        return jsonify({'error': 'Current heroes are required in game state.'}), 400
    
    ai = get_ai()
    
    try:
        if round_type == 'hero':
            recommendation = ai.recommend_hero_set(
                available_sets,
                current_heroes,
                # Tunables for synergy behavior
                min_wilson=0.50,
                min_games=2,
                include_intra_set=True,
                weight_current_pair=20.0,
                weight_intra_pair=15.0,
                normalize=True,
                unknown_pair_penalty=2.0,
                low_count_penalty=0.5,
            )
        else:  # skill
            recommendation = ai.recommend_skill_set(
                available_sets,
                current_heroes,
                current_skills,
                # Tunables for skill synergy
                min_wilson=0.50,
                min_games=2,
                include_intra_set=True,
                weight_current_skill_pair=15.0,
                weight_intra_skill_pair=12.0,
                weight_skill_hero_pair=8.0,
                normalize=True,
                unknown_pair_penalty=1.5,
                low_count_penalty=0.4,
            )
        
        # Format recommendation for web display
        formatted_rec = {
            'recommended_set_index': recommendation['recommended_set'],
            'recommended_set': available_sets[recommendation['recommended_set']],
            'reasoning': recommendation['reasoning'],
            'analysis': []
        }
        
        # Format detailed analysis
        for i, analysis in enumerate(recommendation['analysis']):
            formatted_analysis = {
                'set_index': analysis['set_index'],
                'items': analysis.get('heroes', analysis.get('skills', [])),
                'total_score': round(analysis['total_score'], 1),
                'rank': i + 1,
                'individual_scores': {k: round(v, 1) for k, v in analysis['individual_scores'].items()}
            }
            
            if round_type == 'hero':
                formatted_analysis['synergy_bonus'] = round(analysis.get('synergy_bonus', 0), 1)
            else:
                formatted_analysis['hero_synergy'] = round(analysis.get('hero_synergy', 0), 1)
                formatted_analysis['skill_synergy'] = round(analysis.get('skill_synergy', 0), 1)
            
            formatted_rec['analysis'].append(formatted_analysis)
        
        return jsonify({
            'success': True,
            'recommendation': formatted_rec,
            'round_info': {
                'round_number': game_state.get('round_number', 1),
                'round_type': round_type,
                'current_heroes': current_heroes,
                'current_skills': current_skills
            }
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# API: GET /api/get_database_items
# Purpose: Return the available heroes and skills for autocomplete inputs.
# Used by: React frontend (AutocompleteInput component)
# Response JSON: { heroes: string[], skills: string[] }
@app.route('/api/get_database_items', methods=['GET'])
def get_database_items():
    """Get all available heroes and skills from database"""
    ai = get_ai()
    
    # Get all heroes from skill_hero_map
    all_heroes = list(set(ai.database['skill_hero_map'].values()))
    all_heroes.sort()
    
    # Get all skills
    all_skills = ai.database['skill']
    
    return jsonify({
        'heroes': all_heroes,
        'skills': all_skills
    })


# API: GET /api/get_analytics
# Purpose: Provide aggregated analytics for the Analytics dashboard.
# Used by: React frontend (Analytics page)
# Response JSON: { summary: {...}, top_heroes, top_skills, hero_usage, skill_usage, winning_combos, win_rate_stats }
@app.route('/api/get_analytics', methods=['GET'])
def get_analytics():
    """Get comprehensive analytics data"""
    ai = get_ai()
    
    # Basic stats
    total_battles = len(ai.battles)
    total_heroes = len(ai.hero_stats)
    total_skills = len(ai.skill_stats)
    
    # Top performers
    top_heroes = ai.get_top_heroes(20)
    top_skills = ai.get_top_skills(30)
    
    # Win rate distributions
    hero_win_rates = [(hero, stats['wins'] / stats['total'] if stats['total'] > 0 else 0) 
                      for hero, stats in ai.hero_stats.items() if stats['total'] > 0]
    skill_win_rates = [(skill, stats['wins'] / stats['total'] if stats['total'] > 0 else 0) 
                       for skill, stats in ai.skill_stats.items() if stats['total'] > 0]
    
    # Team compositions analysis
    winning_combos = []
    for combo, stats in ai.hero_combinations.items():
        if stats['wins'] > 0:
            total_games = stats['wins'] + stats['losses']
            win_rate = stats['wins'] / total_games
            winning_combos.append({
                'heroes': list(combo),
                'wins': stats['wins'],
                'losses': stats['losses'],
                'total_games': total_games,
                'win_rate': win_rate
            })
    
    winning_combos.sort(key=lambda x: (x['wins'], x['win_rate']), reverse=True)
    
    # Battle outcomes
    team1_wins = sum(1 for battle in ai.battles if battle.get('winner') == '1')
    team2_wins = sum(1 for battle in ai.battles if battle.get('winner') == '2')
    unknown_wins = total_battles - team1_wins - team2_wins
    
    # Most used heroes/skills
    hero_usage = [(hero, stats['total']) for hero, stats in ai.hero_stats.items()]
    hero_usage.sort(key=lambda x: x[1], reverse=True)
    
    skill_usage = [(skill, stats['total']) for skill, stats in ai.skill_stats.items()]
    skill_usage.sort(key=lambda x: x[1], reverse=True)
    
    
    return jsonify({
        'summary': {
            'total_battles': total_battles,
            'total_heroes': total_heroes,
            'total_skills': total_skills,
            'team1_wins': team1_wins,
            'team2_wins': team2_wins,
            'unknown_wins': unknown_wins
        },
        'top_heroes': [(hero, f"{rate:.1%}", games) for hero, rate, games in top_heroes],
        'top_skills': [(skill, f"{rate:.1%}", games) for skill, rate, games in top_skills],
        'hero_usage': hero_usage[:20],
        'skill_usage': skill_usage[:30],
        'winning_combos': winning_combos[:15],
        'win_rate_stats': {
            'hero_avg_winrate': sum(rate for _, rate in hero_win_rates) / len(hero_win_rates) if hero_win_rates else 0,
            'skill_avg_winrate': sum(rate for _, rate in skill_win_rates) / len(skill_win_rates) if skill_win_rates else 0,
            'heroes_above_50': sum(1 for _, rate in hero_win_rates if rate > 0.5),
            'skills_above_50': sum(1 for _, rate in skill_win_rates if rate > 0.5)
        }
    })

if __name__ == '__main__':
    # Get port from environment variable for production deployment
    port = int(os.environ.get('PORT', 5000))
    # Check if running in production
    is_production = os.environ.get('FLASK_ENV') == 'production'
    
    if is_production:
        print("Starting Game AI Advisor API Service (Production Mode)...")
        print(f"API available at: http://0.0.0.0:{port}")
        print("Press Ctrl+C to stop the server")
        # Production mode: no debug, no reloader
        app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)
    else:
        print("Starting Game AI Advisor API Service...")
        print(f"API available at: http://localhost:{port}")
        print("Running in DEBUG mode")
        print("Press Ctrl+C to stop the server")
        # Development mode
        app.run(debug=True, host='0.0.0.0', port=port, use_reloader=True)