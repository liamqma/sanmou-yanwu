# Game Strategy System - Local Development Guide

A comprehensive AI-powered game strategy advisor with image extraction, recommendation system, and web interface.

## 📋 Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Development Workflow](#development-workflow)
- [Available Commands](#available-commands)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## 🎮 Overview

This system helps players make optimal decisions in a hero-based strategy game:

- **Start**: 4 heroes + 4 skills
- **6 Rounds**: Pick hero sets and skill sets (3 options × 3 items each)
- **Finish**: Pick 1 unchosen hero and 2 unchosen skills
- **AI**: Provides recommendations based on winning combos, synergies, and meta trends

### Key Features

- 🖼️ **Image Extraction**: OCR-based battle data extraction from screenshots
- 🤖 **AI Recommendations**: ML-powered suggestions for optimal team building
- 🌐 **Web Interface**: React frontend with Material-UI for game guidance
- 📊 **Analytics**: Battle statistics and winning combination analysis

## 📁 Project Structure

```
.
├── api/                      # Flask backend API
│   ├── ai_recommendation_system.py  # Core AI logic
│   ├── web_advisor.py        # Flask routes and endpoints
│   ├── start_web_advisor.py  # Startup script
│   └── requirements.txt      # Python dependencies
│
├── image_extraction/         # OCR and data extraction
│   ├── skill_extraction_system.py  # Image processing logic
│   ├── batch_extract_battles.py    # Batch extraction tool
│   ├── extraction_config.json      # OCR configuration
│   ├── fixtures/             # Test images and data
│   └── requirements.txt      # PaddleOCR dependencies
│
├── web/                      # React frontend
│   ├── src/                  # React source code
│   ├── public/               # Static assets
│   ├── package.json          # Node dependencies
│   └── .env.example          # Environment template
│
├── data/                     # Game data and battle results
│   ├── database.json         # Hero/skill mapping
│   └── battles/              # Extracted battle JSON files
│
├── Makefile                  # Common development commands
└── GAME.md                   # Game rules documentation
```

## ⚙️ Prerequisites

### Required

- **Python 3.8+** - For backend API and image extraction
- **Node.js 16+** and **npm** - For React frontend
- **pip** - Python package manager

### Optional

- **Virtual environment** - Recommended for Python isolation
- **Make** - For using convenience commands (optional, can run commands manually)

## 🚀 Quick Start

### Option 1: Using Make (Recommended)

```bash
# 1. Create virtual environment and install all dependencies
make venv

# 2. Start both API and frontend
make web
```

The services will be available at:
- **Frontend**: http://localhost:3000
- **API**: http://localhost:5001

### Option 2: Manual Setup

```bash
# 1. Set up Python environment
python3 -m venv paddleocr_env
source paddleocr_env/bin/activate  # On Windows: paddleocr_env\Scripts\activate

# 2. Install Python dependencies
pip install -r image_extraction/requirements.txt
pip install -r api/requirements.txt

# 3. Set up React frontend
cd web
npm install
cp .env.example .env
cd ..

# 4. Start backend API (in terminal 1)
python3 api/start_web_advisor.py

# 5. Start frontend (in terminal 2)
cd web
npm start
```

## 📖 Detailed Setup

### 1. Python Backend Setup

#### Create Virtual Environment

```bash
# Create environment
python3 -m venv paddleocr_env

# Activate environment
source paddleocr_env/bin/activate  # Linux/Mac
# OR
paddleocr_env\Scripts\activate     # Windows
```

#### Install Dependencies

```bash
# Install image extraction dependencies (PaddleOCR, OpenCV)
pip install -r image_extraction/requirements.txt

# Install API dependencies (Flask, Flask-CORS)
pip install -r api/requirements.txt

# Optional: Install test runner
pip install pytest
```

#### Verify Installation

```bash
# Test Python imports
python3 -c "import flask; import paddleocr; print('✅ All imports successful')"
```

### 2. Frontend Setup

```bash
cd web

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Verify .env configuration
cat .env
# Should contain: REACT_APP_API_URL=http://localhost:5001
```

### 3. Data Setup

The project requires two data files:

- `data/database.json` - Hero and skill mappings (required)
- `data/battles/` - Battle results for AI training (optional but recommended)

These files should already exist in the repository. If not, contact the project maintainer.

## 🔧 Development Workflow

### Starting Development

```bash
# Start both services with one command
make web

# OR start separately:

# Terminal 1 - Backend API
python3 api/start_web_advisor.py

# Terminal 2 - React Frontend
cd web && npm start
```

### Image Extraction Workflow

If you have battle screenshots to extract:

```bash
# 1. Place images in a folder (e.g., images/)

# 2. Run batch extraction
make extract
# OR
python3 image_extraction/batch_extract_battles.py

# 3. Extracted JSON files will be saved to data/battles/
```

### Testing

```bash
# Run Python tests
make test
# OR
python3 -m pytest -q

# Run React tests
cd web
npm test
```

### Code Changes

- **Backend changes**: Flask auto-reloads on save (debug mode enabled)
- **Frontend changes**: React hot-reloads automatically
- **Data changes**: Restart backend to reload battle data

## 📝 Available Commands

### Makefile Commands

```bash
make help           # Show all available commands
make venv           # Create virtual environment and install dependencies
make install        # Install all Python dependencies
make web            # Start both API (5001) and frontend (3000)
make extract        # Run batch image extraction
make test           # Run pytest test suite
make clean          # Remove temporary files and caches
make eval-synergy   # Run synergy parameter evaluation
```

### Manual Commands

#### Backend

```bash
# Start API server
python3 api/start_web_advisor.py

# Run specific AI evaluation
python3 api/eval_synergy.py
```

#### Frontend

```bash
cd web

npm start           # Start development server (port 3000)
npm run build       # Build production bundle
npm test            # Run tests
npm test -- --coverage  # Run tests with coverage
```

#### Image Extraction

```bash
# Batch extract from images folder
python3 image_extraction/batch_extract_battles.py

# Test extraction system
python3 image_extraction/test_image_extraction.py
```

## 🔌 API Documentation

### Base URL

```
http://localhost:5001
```

### Endpoints

#### Get Database Items

```http
GET /api/get_database_items
```

Returns all available heroes and skills.

**Response:**
```json
{
  "heroes": ["英雄1", "英雄2", ...],
  "skills": ["技能1", "技能2", ...],
  "skill_hero_map": {"技能1": "英雄1", ...}
}
```

#### Get Recommendation

```http
POST /api/get_recommendation
Content-Type: application/json

{
  "current_heroes": ["英雄1", "英雄2"],
  "current_skills": ["技能1", "技能2"],
  "round": 1,
  "round_type": "hero",
  "option_sets": [
    ["选项1", "选项2", "选项3"],
    ["选项4", "选项5", "选项6"],
    ["选项7", "选项8", "选项9"]
  ]
}
```

Returns AI recommendation for the current round.

**Response:**
```json
{
  "recommended_set_index": 0,
  "reasoning": "推荐理由...",
  "set_scores": [85, 72, 68],
  "set_analyses": ["分析1", "分析2", "分析3"]
}
```

#### Get Analytics

```http
GET /api/get_analytics
```

Returns battle statistics and analytics data.

**Response:**
```json
{
  "total_battles": 250,
  "win_rate": 0.65,
  "top_heroes": [...],
  "top_skills": [...],
  "winning_combos": [...]
}
```

## 🐛 Troubleshooting

### Backend Issues

#### Import Error: No module named 'flask'

```bash
# Ensure you're in the virtual environment
source paddleocr_env/bin/activate

# Reinstall dependencies
pip install -r api/requirements.txt
```

#### Import Error: No module named 'paddleocr'

```bash
# Install image extraction dependencies
pip install -r image_extraction/requirements.txt
```

#### Missing database.json

The `data/database.json` file is required. Contact the project maintainer if missing.

#### No battle data warning

This is non-critical. The API will work but recommendations may be limited. Add battle data by extracting screenshots or contact the maintainer for existing data.

### Frontend Issues

#### Cannot connect to API

1. Verify backend is running on port 5001
2. Check `web/.env` has correct API URL:
   ```
   REACT_APP_API_URL=http://localhost:5001
   ```
3. Ensure Flask-CORS is enabled (already configured)

#### npm install fails

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Port 3000 already in use

```bash
# Kill process on port 3000
# Linux/Mac:
lsof -ti:3000 | xargs kill -9

# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Image Extraction Issues

#### PaddleOCR model download slow

PaddleOCR downloads models on first run. This can take time depending on your connection. The models are cached for future use.

#### Low OCR accuracy

1. Check image quality (should be clear screenshots)
2. Adjust `extraction_config.json` parameters
3. See fixtures folder for example images

### General Issues

#### Make command not found

You can run commands manually without Make. See the Makefile for the actual commands.

#### Virtual environment not activating

```bash
# Linux/Mac
source paddleocr_env/bin/activate

# Windows Command Prompt
paddleocr_env\Scripts\activate.bat

# Windows PowerShell
paddleocr_env\Scripts\Activate.ps1
```

## 🔍 Development Tips

### Hot Reloading

- **Backend**: Flask runs in debug mode with auto-reload
- **Frontend**: React hot-reloads on file save
- **Data**: Backend needs restart to reload battle data

### Code Organization

- **API logic**: `api/ai_recommendation_system.py`
- **API routes**: `api/web_advisor.py`
- **React components**: `web/src/components/`
- **Game logic**: `web/src/services/gameLogic.js`

### Adding Battle Data

1. Take clear screenshots of battle results
2. Place in `images/` folder (create if needed)
3. Run `make extract` or `python3 image_extraction/batch_extract_battles.py`
4. Verify JSON files in `data/battles/`
5. Restart backend to load new data

### Debugging

```bash
# Backend logs
python3 api/start_web_advisor.py
# Watch console for errors

# Frontend logs
cd web && npm start
# Check browser console (F12)

# Test AI directly
python3 -c "from api.ai_recommendation_system import GameAI; ai = GameAI(); print(f'{len(ai.battles)} battles loaded')"
```

## 🤝 Contributing

### Workflow

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and test thoroughly
3. Run tests: `make test` and `cd web && npm test`
4. Commit with clear messages
5. Push and create a pull request

### Code Style

- **Python**: Follow PEP 8
- **JavaScript**: Follow Airbnb style guide
- **Commits**: Use conventional commits (feat:, fix:, docs:, etc.)

### Testing Requirements

- Add tests for new features
- Ensure existing tests pass
- Test on both backend and frontend where applicable

## 📄 License

Proprietary - Internal use only

## 📞 Support

For questions or issues:
1. Check this README first
2. Review existing battle data and configurations
3. Contact the project maintainer

---

**Happy coding! 🎮🚀**
