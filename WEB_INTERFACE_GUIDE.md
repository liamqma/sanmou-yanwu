# Web Interface Guide

## 🌐 Game AI Web Advisor

A beautiful, intuitive web interface for getting real-time AI recommendations during gameplay.

## Quick Start

### 1. Install Web Dependencies
```bash
pip install -r web_requirements.txt
```

### 2. Launch Web Interface
```bash
# Easy startup (recommended)
python start_web_advisor.py

# Manual startup
python web_advisor.py
```

### 3. Open Browser
- **Automatic**: Browser opens automatically at http://localhost:5000
- **Manual**: Navigate to http://localhost:5000 in your browser

## 🎮 How to Use

### Phase 1: Game Setup
1. **Enter Initial Heroes** (4 required)
   - Type hero name and press Enter
   - Remove tags by clicking the × button
   - Must have exactly 4 heroes to proceed

2. **Enter Initial Skills** (4 required)
   - Type skill name and press Enter
   - Must have exactly 4 skills to proceed

3. **View Meta Analysis**
   - See top heroes and skills by win rate
   - Based on your current battle data
   - Updates automatically as you add more battles

4. **Start Game Session**
   - Click "Start Game Session" when ready
   - Transitions to the game interface

### Phase 2: Round-by-Round Gameplay

#### For Each Round (6 total):
1. **View Round Info**
   - Round number and type (Hero/Skill)
   - Current team status
   - Round-specific instructions

2. **Enter Game Options**
   - Input the 3 sets provided by the game
   - Format: `item1, item2, item3` for each set
   - Example: `诸葛亮, 周瑜, 司马懿`

3. **Get AI Recommendation**
   - Click "Get AI Recommendation"
   - View detailed analysis of all options
   - See recommended choice with reasoning

4. **Make Your Choice**
   - Click on your chosen option card
   - Selected option highlights in blue
   - Can choose different from AI recommendation

5. **Record and Continue**
   - Click "Record My Choice"
   - Click "Next Round" to continue
   - Repeat for all 6 rounds

### Phase 3: Final Analysis
- **Team Composition**: Complete hero and skill list
- **Strength Analysis**: Overall team score and breakdown
- **Synergy Detection**: Hero combinations that work well together
- **Start New Game**: Begin another session

## 🎯 Interface Features

### 🤖 AI Recommendations
- **Smart Scoring**: Combines win rates, synergies, and context
- **Clear Reasoning**: Explains why each option is recommended
- **Detailed Analysis**: Shows scores for all 3 options
- **Context Awareness**: Considers your current team composition

### 📊 Visual Feedback
- **Recommended Options**: Highlighted in green with badge
- **Score Display**: Point values for easy comparison
- **Selection Feedback**: Clear visual selection state
- **Progress Tracking**: Round counter and team status

### 🎨 Responsive Design
- **Mobile Friendly**: Works on phones and tablets
- **Clean Interface**: Modern, intuitive design
- **Real-time Updates**: Instant feedback and recommendations
- **Error Handling**: Clear error messages and validation

## 🔧 Technical Features

### Performance Optimizations
- **Caching**: AI analysis cached for faster responses
- **Lazy Loading**: Components load as needed
- **Session Management**: Game state preserved during session
- **Error Recovery**: Graceful handling of network issues

### Data Integration
- **Battle Data**: Uses all battles from `./battles/` directory
- **Database Integration**: Full access to 208 skills and hero mappings
- **Real-time Analysis**: Updates as you add more battle data
- **Export Capability**: Session data available for analysis

## 🎮 Gameplay Tips

### Strategy Recommendations
1. **Follow AI Suggestions**: Based on real battle data analysis
2. **Consider Context**: Early vs late round strategy differences
3. **Balance Team**: Mix offensive, defensive, and utility options
4. **Watch Synergies**: AI highlights effective combinations

### Best Practices
1. **Accurate Input**: Double-check hero/skill names for exact matches
2. **Complete Sessions**: Finish all 6 rounds for full analysis
3. **Review Final Analysis**: Learn from team composition insights
4. **Update Battle Data**: Add new battles to improve recommendations

## 🛠️ Troubleshooting

### Common Issues

#### "No active game session" Error
- **Cause**: Session expired or not started
- **Solution**: Start a new game session

#### "Failed to get recommendation" Error
- **Cause**: Invalid input format or missing data
- **Solution**: Check that each set has exactly 3 items

#### Slow Performance
- **Cause**: Large battle dataset or first-time analysis
- **Solution**: Wait for initial analysis to complete and cache

#### Browser Compatibility
- **Supported**: Chrome, Firefox, Safari, Edge (modern versions)
- **Features**: JavaScript required for full functionality

### Error Messages
- **Red Border**: Input validation errors
- **Error Banner**: System errors with details
- **Loading States**: Shows when processing requests

## 📱 Mobile Usage

### Optimized for Mobile
- **Touch Friendly**: Large buttons and touch targets
- **Responsive Layout**: Adapts to screen size
- **Swipe Navigation**: Natural mobile interactions
- **Offline Capable**: Works without constant internet

### Mobile Tips
- **Portrait Mode**: Recommended for best experience
- **Zoom Support**: Pinch to zoom for detailed analysis
- **Copy/Paste**: Easy input of game options
- **Background Use**: Keeps session active when switching apps

## 🔄 Integration Workflow

### Complete Workflow
1. **Extract Battles**: `python batch_extract_battles.py`
2. **Remove Duplicates**: `python remove_duplicates.py --remove`
3. **Start Web Interface**: `python start_web_advisor.py`
4. **Play Games**: Use web interface for recommendations
5. **Add More Data**: Repeat cycle to improve AI

### Data Flow
```
Game Screenshots → Battle Extraction → AI Analysis → Web Recommendations
       ↓                    ↓              ↓              ↓
   ./images/          ./battles/     Cached Analysis   Real-time UI
```

## 🎯 Advanced Features

### Session Management
- **Auto-save**: Game state preserved automatically
- **Resume Capability**: Continue interrupted sessions
- **History Tracking**: Review past round decisions
- **Export Data**: Download session data for analysis

### Customization Options
- **Theme Support**: Light/dark mode (future feature)
- **Language Support**: Multi-language interface (future feature)
- **Custom Scoring**: Adjust AI weights (future feature)
- **Team Templates**: Save favorite compositions (future feature)

## 🚀 Performance Tips

### For Best Experience
1. **Stable Internet**: Ensure good connection for API calls
2. **Modern Browser**: Use latest browser version
3. **Clear Cache**: Refresh if experiencing issues
4. **Close Tabs**: Free up browser memory for better performance

### Server Optimization
- **Local Hosting**: Runs on your machine for privacy
- **No External Dependencies**: Works completely offline
- **Fast Response**: Cached analysis for instant recommendations
- **Low Resource Usage**: Minimal CPU and memory footprint

The web interface provides the most user-friendly way to access the AI recommendation system during actual gameplay!