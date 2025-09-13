#!/usr/bin/env python3
"""
Web-based Game Advisor
Flask web interface for real-time game recommendations
"""

from flask import Flask, render_template, request, jsonify, session
import json
import os
from ai_recommendation_system import GameAI
import uuid

app = Flask(__name__)
app.secret_key = 'game_advisor_secret_key_' + str(uuid.uuid4())

# Development settings for template auto-reloading
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Global AI instance
game_ai = None

def get_ai():
    """Get or initialize the AI system"""
    global game_ai
    if game_ai is None:
        game_ai = GameAI()
    return game_ai

# Route: GET /
# Purpose: Serve the main Game Advisor UI (index.html) used to run interactive recommendations.
# Used by: Browser navigation to the root path.
@app.route('/')
def index():
    """Main game advisor page"""
    return render_template('index.html')

# Route: GET /analytics
# Purpose: Serve the Analytics dashboard (analytics.html) that visualizes aggregated battle data.
# Used by: Browser navigation to /analytics.
@app.route('/analytics')
def analytics():
    """Battle data analytics page"""
    return render_template('analytics.html')

# API: POST /api/start_game (REMOVED)
# Purpose: No longer needed - client handles game state creation locally

# API: POST /api/get_recommendation
# Purpose: Provide the AI recommendation for the current round given three option sets.
# Used by: templates/index.html (getRecommendation)
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

# API: POST /api/sync_session (DEPRECATED)
# Purpose: This endpoint is no longer needed since we moved to stateless backend.
# The endpoints now accept game_state directly in requests.
@app.route('/api/sync_session', methods=['POST'])
def sync_session():
    """DEPRECATED: No longer needed with stateless backend"""
    return jsonify({
        'success': True,
        'message': 'Session sync not needed - backend is now stateless'
    })

# API: POST /api/record_choice (REMOVED)
# Purpose: No longer needed - client handles game state updates locally

# API: GET /api/get_database_items
# Purpose: Return the available heroes and skills for autocomplete inputs.
# Used by: templates/index.html (loadDatabaseItems) and analytics.html autocomplete.
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

# API: POST /api/get_synergy
# Purpose: Return partner rankings for a hero or skill using Wilson score (pairwise and cross pairs).
# Used by: templates/analytics.html (Synergy Explorer)
# Request JSON: { type: 'hero'|'skill', name: string, limit?: number, min_games?: number }
# Response JSON: { success: bool, type, name, hero_partners: [...], skill_partners: [...] }
@app.route('/api/get_synergy', methods=['POST'])
def get_synergy():
    """Get synergy rankings for a hero or skill.
    Request JSON: { type: 'hero'|'skill', name: string, limit?: int, min_games?: int }
    Response JSON: { hero_partners: [...], skill_partners: [...] } where items are sorted by Wilson LB desc.
    """
    data = request.json or {}
    item_type = data.get('type')
    name = data.get('name')
    limit = int(data.get('limit', 20))
    min_games = int(data.get('min_games', 2))

    if not item_type or not name:
        return jsonify({'error': 'type and name are required'}), 400
    if item_type not in ('hero', 'skill'):
        return jsonify({'error': "type must be 'hero' or 'skill'"}), 400

    ai = get_ai()

    hero_partners = []
    skill_partners = []

    if item_type == 'hero':
        # Hero -> hero partners
        for (h1, h2), st in ai.hero_pair_stats.items():
            if name == h1 or name == h2:
                other = h2 if name == h1 else h1
                total = st['wins'] + st['losses']
                if total < min_games:
                    continue
                wil = ai._wilson_lower_bound(st['wins'], total)
                hero_partners.append({'name': other, 'wilson': wil, 'wins': st['wins'], 'losses': st['losses'], 'total': total})
        # Hero -> skills by cross pairs
        for (hero, skill), st in ai.skill_hero_pair_stats.items():
            if hero == name:
                total = st['wins'] + st['losses']
                if total < min_games:
                    continue
                wil = ai._wilson_lower_bound(st['wins'], total)
                skill_partners.append({'name': skill, 'wilson': wil, 'wins': st['wins'], 'losses': st['losses'], 'total': total})
    else:
        # Skill -> skill partners
        for (s1, s2), st in ai.skill_pair_stats.items():
            if name == s1 or name == s2:
                other = s2 if name == s1 else s1
                total = st['wins'] + st['losses']
                if total < min_games:
                    continue
                wil = ai._wilson_lower_bound(st['wins'], total)
                skill_partners.append({'name': other, 'wilson': wil, 'wins': st['wins'], 'losses': st['losses'], 'total': total})
        # Skill -> heroes by cross pairs
        for (hero, skill), st in ai.skill_hero_pair_stats.items():
            if skill == name:
                total = st['wins'] + st['losses']
                if total < min_games:
                    continue
                wil = ai._wilson_lower_bound(st['wins'], total)
                hero_partners.append({'name': hero, 'wilson': wil, 'wins': st['wins'], 'losses': st['losses'], 'total': total})

    hero_partners.sort(key=lambda x: x['wilson'], reverse=True)
    skill_partners.sort(key=lambda x: x['wilson'], reverse=True)

    return jsonify({
        'success': True,
        'type': item_type,
        'name': name,
        'hero_partners': hero_partners[:limit],
        'skill_partners': skill_partners[:limit]
    })

# API: GET /api/get_analytics
# Purpose: Provide aggregated analytics for the Analytics dashboard.
# Used by: templates/analytics.html (loadAnalytics -> displayAnalytics)
# Response JSON: { summary: {...}, top_heroes, top_skills, hero_usage, skill_usage, winning_combos, recent_battles, win_rate_stats }
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
    
    # Recent battles
    recent_battles = []
    for battle in ai.battles[-10:]:  # Last 10 battles
        battle_info = {
            'filename': battle.get('filename', 'Unknown'),
            'winner': battle.get('winner', 'unknown'),
            'team1_heroes': [hero.get('name', '') for hero in battle.get('1', [])],
            'team2_heroes': [hero.get('name', '') for hero in battle.get('2', [])]
        }
        recent_battles.append(battle_info)
    
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
        'recent_battles': recent_battles,
        'win_rate_stats': {
            'hero_avg_winrate': sum(rate for _, rate in hero_win_rates) / len(hero_win_rates) if hero_win_rates else 0,
            'skill_avg_winrate': sum(rate for _, rate in skill_win_rates) / len(skill_win_rates) if skill_win_rates else 0,
            'heroes_above_50': sum(1 for _, rate in hero_win_rates if rate > 0.5),
            'skills_above_50': sum(1 for _, rate in skill_win_rates if rate > 0.5)
        }
    })

if __name__ == '__main__':
    print("Starting Game AI Advisor Web Service...")
    print("Access the web interface at: http://localhost:5000")
    print("Analytics dashboard at: http://localhost:5000/analytics")
    print("Running in DEBUG mode - templates will auto-reload on changes")
    print("Press Ctrl+C to stop the server")
    
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=True)