# Game Skill Extraction System

Automated extraction of skills, heroes, and winners from game images using PaddleOCR and fuzzy matching.

## Quick Start

### 1. Setup Environment
```bash
# Create virtual environment
python -m venv paddleocr_env
source paddleocr_env/bin/activate  # On Windows: paddleocr_env\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Coordinates
Edit `extraction_config.json` to set coordinates for your images:
- `skills_grid`: Skill positions (18 skills per image)
- `winner_detection`: Winner indicator area

### 3. Run Extraction

#### Single Image Processing
```python
from skill_extraction_system import SkillExtractionSystem

# Initialize system
extractor = SkillExtractionSystem()

# Extract from single image
results = extractor.extract_and_save('image.jpg', 'output.json')
```

#### Batch Processing (Recommended)
```bash
# Place images in ./images/ directory
# Results will be saved to ./battles/ directory
python batch_extract_battles.py
```

#### Test System
```bash
# Test on sample images
python skill_extraction_system.py
```

## Output Format
```json
{
  "1": [
    {"name": "诸葛亮", "skills": ["草船借箭", "同舟共济", "挫锐折锋"]},
    {"name": "姜维", "skills": ["九伐中原", "胜敌益强", "文武双全"]}
  ],
  "2": [
    {"name": "司马懿", "skills": ["鹰视狼顾", "谋而后动", "运智铺谋"]}
  ],
  "winner": "1"
}
```

## Features
- **OCR**: PaddleOCR for Chinese text extraction
- **Fuzzy Matching**: Auto-corrects OCR errors using skill database
- **Hero Mapping**: Maps first skill to hero name automatically
- **Winner Detection**: Detects '胜' (team 1) or '败' (team 2)
- **AI Recommendations**: Intelligent game strategy advisor using battle data
- **Web Interface**: Beautiful browser-based game advisor

## Directory Structure
```
├── skill_extraction_system.py    # Main extraction system
├── batch_extract_battles.py      # Batch processing script
├── extraction_config.json        # Coordinate configuration
├── database.json                 # Skills and hero mapping database
├── images/                       # Input images for batch processing
├── battles/                      # Output JSON files from batch processing
├── train/                        # Training/sample images
└── test/                         # Test images
```

## Batch Processing Workflow
1. **Add images**: Place game screenshots in `./images/` directory
2. **Run batch script**: `python batch_extract_battles.py`
3. **Check results**: JSON files saved to `./battles/` directory
4. **Review output**: Each image produces one JSON file with complete battle data

## AI Game Advisor

### 🌐 Web Interface (Recommended)
```bash
# Install web dependencies
pip install -r web_requirements.txt

# Launch web interface
python start_web_advisor.py
# Opens browser automatically at http://localhost:5000
```

### 💻 Command Line Interface
```bash
# Interactive game advisor
python game_advisor.py

# View meta analysis and recommendations
python ai_recommendation_system.py
```

### AI Features
- **Web Interface**: Beautiful, intuitive browser-based advisor
- **Meta Analysis**: Top heroes/skills by win rate from battle data
- **Smart Recommendations**: Context-aware suggestions for each round
- **Synergy Detection**: Identifies effective hero/skill combinations
- **Real-time Scoring**: Evaluates all available options

See `WEB_INTERFACE_GUIDE.md` and `AI_USAGE_GUIDE.md` for detailed instructions.

## Key Files
- `skill_extraction_system.py` - Core extraction engine
- `batch_extract_battles.py` - Batch processing for multiple images
- `ai_recommendation_system.py` - AI analysis and recommendation engine
- `game_advisor.py` - Interactive command-line game advisor
- `web_advisor.py` - Flask web application for browser interface
- `start_web_advisor.py` - Easy web interface launcher
- `remove_duplicates.py` - Battle data deduplication tool
- `extraction_config.json` - Coordinate and OCR configuration
- `database.json` - 208 skills and hero mapping database
- `WEB_INTERFACE_GUIDE.md` - Detailed web interface documentation
- `AI_USAGE_GUIDE.md` - AI system usage instructions
- `DUPLICATE_REMOVER_GUIDE.md` - Data cleanup documentation