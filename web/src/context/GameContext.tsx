import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import { storage } from '../utils/storage';
import { createInitialGameState, updateGameState } from '../services/gameLogic';
import type {
  ReducerState,
  GameAction,
  GameContextValue,
  DatabaseItems,
} from '../types/game';
import { initializeTelemetry } from '../services/telemetry';
import { preloadTelemetryData } from '../services/telemetryData';

const GameContext = createContext<GameContextValue | undefined>(undefined);

export const initialState: ReducerState = {
  gameState: null,
  currentRoundInputs: {
    set1: [],
    set2: [],
    set3: [],
  },
  selectedOptionIndex: null,
  currentRecommendation: null,
  isLoading: false,
  error: null,
  availableHeroes: [],
  heroMetadata: {},
  skillMetadata: {},
  availableSkills: [],
  regularSkills: [],
  orangeRegularSkills: [],
  heroSkills: [],
  databaseLoaded: false,
};

export const gameReducer = (state: ReducerState, action: GameAction): ReducerState => {
  switch (action.type) {
    case 'START_GAME': {
      const newGameState = createInitialGameState(action.heroes, action.skills);
      return {
        ...state,
        gameState: newGameState,
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
        error: null,
      };
    }

    case 'RESTORE_PROGRESS':
      return {
        ...state,
        gameState: action.payload.gameState,
        currentRoundInputs: action.payload.currentRoundInputs || { set1: [], set2: [], set3: [] },
      };

    case 'UPDATE_ROUND_INPUT':
      return {
        ...state,
        currentRoundInputs: {
          ...state.currentRoundInputs,
          [action.setName]: action.items,
        },
        selectedOptionIndex: null,
        currentRecommendation: null,
      };

    case 'SET_RECOMMENDATION':
      return {
        ...state,
        currentRecommendation: action.recommendation,
        selectedOptionIndex: null,
        isLoading: false,
        error: null,
      };

    case 'SELECT_OPTION':
      return {
        ...state,
        selectedOptionIndex: action.index,
      };

    case 'RECORD_CHOICE': {
      const { roundType, chosenSet, setIndex } = action;
      const result = updateGameState(state.gameState!, roundType, chosenSet, setIndex);
      return {
        ...state,
        gameState: result.gameState,
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
        gameComplete: result.gameComplete,
      };
    }

    case 'RESET_GAME':
      storage.clearGameProgress();
      // Preserve database state when resetting - it doesn't need to be reloaded.
      return {
        ...initialState,
        availableHeroes: state.availableHeroes,
        heroMetadata: state.heroMetadata,
        skillMetadata: state.skillMetadata,
        availableSkills: state.availableSkills,
        regularSkills: state.regularSkills,
        orangeRegularSkills: state.orangeRegularSkills,
        heroSkills: state.heroSkills,
        databaseLoaded: state.databaseLoaded,
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
        isLoading: false,
      };

    case 'LOAD_DATABASE':
      return {
        ...state,
        availableHeroes: action.heroes,
        heroMetadata: action.heroMetadata || {},
        skillMetadata: action.skillMetadata || {},
        availableSkills: action.skills,
        regularSkills: action.regularSkills || [],
        orangeRegularSkills: action.orangeRegularSkills || [],
        heroSkills: action.heroSkills || [],
        databaseLoaded: true,
      };

    case 'DISMISS_ROUND7_INTERSTITIAL':
      return {
        ...state,
        gameState: {
          ...state.gameState!,
          round7_interstitial_dismissed: true,
        },
      };

    case 'UPDATE_TEAM':
      return {
        ...state,
        gameState: {
          ...state.gameState!,
          current_heroes: action.heroes,
          current_skills: action.skills,
        },
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
      };

    case 'SET_SUPPORT_HERO':
      return {
        ...state,
        gameState: {
          ...state.gameState!,
          support_hero: action.hero,
        },
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
      };

    case 'SET_SUPPORT_SKILLS':
      return {
        ...state,
        gameState: {
          ...state.gameState!,
          support_skills: action.skills,
        },
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
      };

    case 'REMOVE_SUPPORT_HERO':
      return {
        ...state,
        gameState: {
          ...state.gameState!,
          support_hero: null,
        },
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
      };

    case 'REMOVE_SUPPORT_SKILL':
      return {
        ...state,
        gameState: {
          ...state.gameState!,
          support_skills: (state.gameState!.support_skills || []).filter(
            (s) => s !== action.skill
          ),
        },
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
      };

    default:
      return state;
  }
};

interface GameProviderProps {
  children: ReactNode;
  databaseItems?: DatabaseItems | null;
}

export const GameProvider = ({ children, databaseItems }: GameProviderProps) => {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  useEffect(() => {
    initializeTelemetry();
    preloadTelemetryData();
  }, []);

  // Load database items from props (passed from index.tsx)
  useEffect(() => {
    if (databaseItems) {
      dispatch({
        type: 'LOAD_DATABASE',
        heroes: databaseItems.heroes || [],
        heroMetadata: databaseItems.heroMetadata || {},
        skillMetadata: databaseItems.skillMetadata || {},
        skills: databaseItems.skills || [],
        regularSkills: databaseItems.regularSkills || [],
        orangeRegularSkills: databaseItems.orangeRegularSkills || [],
        heroSkills: databaseItems.heroSkills || [],
      });
    }
  }, [databaseItems]);

  // Auto-save game progress to cookies whenever it changes
  useEffect(() => {
    if (state.gameState) {
      storage.saveGameProgress(state.gameState, state.currentRoundInputs);
    }
  }, [state.gameState, state.currentRoundInputs]);

  // Load saved progress on mount.
  useEffect(() => {
    const savedProgress = storage.loadGameProgress();
    if (savedProgress?.gameState) {
      dispatch({ type: 'RESTORE_PROGRESS', payload: savedProgress });
    }
  }, []);

  return <GameContext.Provider value={{ state, dispatch }}>{children}</GameContext.Provider>;
};

export const useGame = (): GameContextValue => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within GameProvider');
  }
  return context;
};
