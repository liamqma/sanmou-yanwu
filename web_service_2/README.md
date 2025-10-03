# Game Advisor - React Application

A modern React application for game team composition analysis and AI-powered recommendations.

## Features

- **Setup Phase**: Select 4 heroes and 4 skills with pinyin search support
- **Game Flow**: 6-round game with AI recommendations for optimal team building
- **Manual Editing**: Edit team composition manually at any time
- **Analytics Dashboard**: Comprehensive statistics, top performers, and winning combinations
- **Auto-save**: Progress automatically saved to cookies
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## Tech Stack

- **React** 18 - UI framework
- **Material-UI (MUI)** - Component library and styling
- **React Router** - Client-side routing
- **Axios** - HTTP client for API calls
- **pinyin-pro** - Chinese pinyin search support
- **js-cookie** - Cookie-based persistence

## Getting Started

### Prerequisites

- Node.js 16+ and npm
- Backend Flask server running on port 5001

### Installation

```bash
# Install dependencies
npm install

# Create .env file (optional)
cp .env.example .env
```

### Development

```bash
# Start development server on http://localhost:3000
npm start

# Build for production
npm run build

# Run tests
npm test
```

### Environment Variables

Create a `.env` file in the project root:

```env
# API Configuration
REACT_APP_API_URL=http://localhost:5001
```

## Project Structure

```
web_service_2/
├── public/              # Static assets
├── src/
│   ├── components/      # React components
│   │   ├── common/      # Reusable components (AutocompleteInput, TagList, etc.)
│   │   ├── game/        # Game-related components (GameBoard, RoundInfo, etc.)
│   │   ├── layout/      # Layout components (AppLayout, Header)
│   │   └── setup/       # Setup phase components
│   ├── context/         # React Context (GameContext for state management)
│   ├── hooks/           # Custom React hooks (usePinyin)
│   ├── pages/           # Page components (GameAdvisor, Analytics)
│   ├── services/        # API and game logic services
│   ├── theme/           # MUI theme configuration
│   ├── utils/           # Utility functions (storage)
│   ├── App.js           # Main application component
│   └── index.js         # Application entry point
├── .env                 # Environment variables
├── package.json         # Dependencies and scripts
└── README.md           # This file
```

## Key Components

### Setup Phase
- **SetupForm**: Select initial 4 heroes and 4 skills
- **AutocompleteInput**: Search with Chinese and pinyin support
- **TagList**: Display and manage selected items

### Game Phase
- **GameBoard**: Main game container managing 6 rounds
- **RoundInfo**: Display current round information with stepper
- **CurrentTeam**: Show current team with manual edit capability
- **OptionSetInput**: Input 3 option sets (3 items each)
- **RecommendationPanel**: Display AI recommendation with reasoning
- **AnalysisGrid**: Show 3 option sets with scores and analysis

### Analytics
- **Analytics**: Comprehensive dashboard with battle statistics
- Summary stats, top performers, usage statistics, and winning combinations

### Common
- **ErrorBoundary**: Global error handling
- **LoadingSkeleton**: Loading states for better UX

## API Integration

The application connects to a Flask backend API on port 5001:

- `GET /api/get_database_items` - Fetch all heroes and skills
- `POST /api/get_recommendation` - Get AI recommendation for current round
- `GET /api/get_analytics` - Fetch analytics data

## State Management

Uses React Context API with useReducer for global state:

- Game state (current round, heroes, skills)
- Round inputs (3 option sets)
- Recommendations and selections
- Auto-save to cookies on every state change

## Persistence

Game progress is automatically saved to cookies with a 1-year expiry:
- Current game state
- Round inputs
- Automatically restored on page load

## Development Notes

### CORS
The backend Flask server uses Flask-CORS to allow cross-origin requests from the React dev server.

### Pinyin Search
Chinese hero and skill names can be searched using pinyin romanization for easier input.

### MUI Theme
Uses Material-UI's default theme for consistency and accessibility.

## Troubleshooting

### Backend Connection Issues
- Ensure Flask backend is running on http://localhost:5001
- Check CORS is enabled in backend with Flask-CORS
- Verify REACT_APP_API_URL in .env matches backend URL

### Build Issues
- Delete `node_modules` and `package-lock.json`, then run `npm install`
- Clear browser cache and cookies
- Try `npm run build` to check for build errors

## Contributing

1. Create feature branch from main
2. Make changes with proper commit messages
3. Test thoroughly (setup, game flow, analytics)
4. Submit pull request

## License

Proprietary - Internal use only
