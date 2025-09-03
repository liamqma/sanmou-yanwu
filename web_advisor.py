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

# Global AI instance
game_ai = None

def get_ai():
    """Get or initialize the AI system"""
    global game_ai
    if game_ai is None:
        game_ai = GameAI()
    return game_ai

@app.route('/')
def index():
    """Main game advisor page"""
    return render_template('index.html')

@app.route('/analytics')
def analytics():
    """Battle data analytics page"""
    return render_template('analytics.html')

@app.route('/api/start_game', methods=['POST'])
def start_game():
    """Initialize a new game session"""
    data = request.json
    
    # Validate input
    initial_heroes = data.get('initial_heroes', [])
    initial_skills = data.get('initial_skills', [])
    
    if len(initial_heroes) != 4:
        return jsonify({'error': f'Need exactly 4 heroes, got {len(initial_heroes)}'}), 400
    
    if len(initial_skills) != 4:
        return jsonify({'error': f'Need exactly 4 skills, got {len(initial_skills)}'}), 400
    
    # Store initial setup in session
    session['game_state'] = {
        'initial_heroes': initial_heroes,
        'initial_skills': initial_skills,
        'current_heroes': initial_heroes.copy(),
        'current_skills': initial_skills.copy(),
        'round_number': 1,
        'round_history': []
    }
    
    
    # Get meta analysis for display
    ai = get_ai()
    top_heroes = ai.get_top_heroes(10)
    top_skills = ai.get_top_skills(15)
    
    return jsonify({
        'success': True,
        'game_state': session['game_state'],
        'meta_analysis': {
            'top_heroes': [(hero, f"{rate:.1%}", games) for hero, rate, games in top_heroes],
            'top_skills': [(skill, f"{rate:.1%}", games) for skill, rate, games in top_skills],
            'total_battles': len(ai.battles)
        }
    })

@app.route('/api/get_recommendation', methods=['POST'])
def get_recommendation():
    """Get AI recommendation for current round"""
    data = request.json
    round_type = data.get('round_type')  # 'hero' or 'skill'
    available_sets = data.get('available_sets', [])
    
    
    if 'game_state' not in session:
        return jsonify({'error': 'No active game session. Please start a game first by selecting 4 heroes and 4 skills.'}), 400
    
    game_state = session['game_state']
    ai = get_ai()
    
    try:
        if round_type == 'hero':
            recommendation = ai.recommend_hero_set(
                available_sets,
                game_state['current_heroes']
            )
        else:  # skill
            recommendation = ai.recommend_skill_set(
                available_sets,
                game_state['current_heroes'],
                game_state['current_skills']
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
                'round_number': game_state['round_number'],
                'round_type': round_type,
                'current_heroes': game_state['current_heroes'],
                'current_skills': game_state['current_skills']
            }
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sync_session', methods=['POST'])
def sync_session():
    """Sync backend session with frontend game state (for session restoration)"""
    data = request.json
    frontend_game_state = data.get('game_state', {})
    
    if 'game_state' not in session:
        return jsonify({'error': 'No active game session to sync'}), 400
    
    # Update the backend session to match the frontend state
    session['game_state'] = frontend_game_state
    
    return jsonify({
        'success': True,
        'message': 'Session synced successfully'
    })

@app.route('/api/record_choice', methods=['POST'])
def record_choice():
    """Record player's choice and update game state"""
    data = request.json
    round_type = data.get('round_type')
    chosen_set = data.get('chosen_set', [])
    set_index = data.get('set_index', 0)
    
    if 'game_state' not in session:
        return jsonify({'error': 'No active game session'}), 400
    
    game_state = session['game_state']
    
    # Update game state
    if round_type == 'hero':
        game_state['current_heroes'].extend(chosen_set)
    else:  # skill
        game_state['current_skills'].extend(chosen_set)
    
    # Record round history
    game_state['round_history'].append({
        'round_number': game_state['round_number'],
        'round_type': round_type,
        'chosen_set': chosen_set,
        'set_index': set_index
    })
    
    # Advance round
    game_state['round_number'] += 1
    
    # Update session
    session['game_state'] = game_state
    
    # Check if game is complete
    game_complete = game_state['round_number'] > 6
    final_analysis = None
    
    if game_complete:
        final_analysis = generate_final_analysis(game_state)
    
    return jsonify({
        'success': True,
        'game_state': game_state,
        'game_complete': game_complete,
        'final_analysis': final_analysis
    })

def generate_final_analysis(game_state):
    """Generate final team analysis"""
    ai = get_ai()
    heroes = game_state['current_heroes']
    skills = game_state['current_skills']
    
    # Calculate team strength
    hero_scores = [ai.get_hero_win_rate(hero) * 100 for hero in heroes]
    skill_scores = [ai.get_skill_win_rate(skill) * 100 for skill in skills]
    
    avg_hero_score = sum(hero_scores) / len(hero_scores) if hero_scores else 0
    avg_skill_score = sum(skill_scores) / len(skill_scores) if skill_scores else 0
    overall_score = (avg_hero_score + avg_skill_score) / 2
    
    # Find synergies
    synergies = []
    for i, hero in enumerate(heroes):
        hero_synergies = ai.get_hero_synergies(hero)
        for synergy_hero, synergy_rate in hero_synergies:
            if synergy_hero in heroes and synergy_hero != hero:
                synergies.append({
                    'hero1': hero,
                    'hero2': synergy_hero,
                    'synergy_rate': f"{synergy_rate:.1%}"
                })
                break  # Only show top synergy per hero
    
    return {
        'final_team': {
            'heroes': heroes,
            'skills': skills
        },
        'team_strength': {
            'avg_hero_score': round(avg_hero_score, 1),
            'avg_skill_score': round(avg_skill_score, 1),
            'overall_score': round(overall_score, 1)
        },
        'synergies': synergies[:5],  # Top 5 synergies
        'round_history': game_state['round_history']
    }

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
    app.run(debug=True, host='0.0.0.0', port=5000)