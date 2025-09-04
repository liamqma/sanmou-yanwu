#!/usr/bin/env python3
"""
Startup script for the Web Game Advisor
Handles environment setup and launches the Flask application
"""

import os
import sys
import subprocess
import webbrowser
import time
from threading import Timer

def check_dependencies():
    """Check if required dependencies are installed"""
    try:
        import flask
        from ai_recommendation_system import GameAI
        return True
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("Please install requirements:")
        print("  pip install -r web_requirements.txt")
        return False

def check_battle_data():
    """Check if battle data exists"""
    battles_dir = 'battles'
    if not os.path.exists(battles_dir):
        print(f"⚠️  Warning: {battles_dir} directory not found!")
        print("The AI will work but recommendations may be limited.")
        print("Add battle data by running: python batch_extract_battles.py")
        return False
    
    battle_files = [f for f in os.listdir(battles_dir) if f.endswith('.json')]
    if len(battle_files) == 0:
        print(f"⚠️  Warning: No battle files found in {battles_dir}/")
        print("Add battle data by running: python batch_extract_battles.py")
        return False
    
    print(f"✅ Found {len(battle_files)} battle files for AI analysis")
    return True

def open_browser():
    """Open web browser to the application"""
    url = "http://localhost:5001"
    print(f"🌐 Opening browser to {url}")
    webbrowser.open(url)

def main():
    """Main startup function"""
    print("🚀 Starting Game AI Web Advisor")
    print("=" * 40)
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Check battle data
    check_battle_data()
    
    # Check if database exists
    if not os.path.exists('database.json'):
        print("❌ Error: database.json not found!")
        print("This file is required for hero/skill mapping.")
        sys.exit(1)
    
    if not os.path.exists(os.path.join('image_extraction', 'extraction_config.json')):
        print("❌ Error: image_extraction/extraction_config.json not found!")
        print("This file is required for AI configuration.")
        sys.exit(1)
    
    print("✅ All requirements satisfied")
    print("\n🤖 Initializing AI system...")
    
    # Test AI initialization
    try:
        from ai_recommendation_system import GameAI
        ai = GameAI()
        print(f"✅ AI system ready with {len(ai.battles)} battles analyzed")
    except Exception as e:
        print(f"❌ Error initializing AI: {e}")
        sys.exit(1)
    
    print("\n🌐 Starting web server...")
    print("📱 Web interface will be available at: http://localhost:5001")
    print("🛑 Press Ctrl+C to stop the server")
    print("\n" + "=" * 40)
    
    # Schedule browser opening
    Timer(2.0, open_browser).start()
    
    # Start Flask app
    try:
        from web_advisor import app
        app.run(debug=False, host='0.0.0.0', port=5001)
    except KeyboardInterrupt:
        print("\n\n👋 Game AI Web Advisor stopped")
    except Exception as e:
        print(f"\n❌ Error starting web server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()