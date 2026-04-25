import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { storage, DEFAULT_SETTINGS, DEFAULT_SEEN_CONTEXT } from '../utils/storage';
import { createInitialGameState, updateGameState } from '../services/gameLogic';

const GameContext = createContext();

export const initialState = {
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
  availableSkills: [],
  regularSkills: [],
  orangeRegularSkills: [],
  heroSkills: [],
  databaseLoaded: false,
  settings: { ...DEFAULT_SETTINGS },
  seenContext: { ...DEFAULT_SEEN_CONTEXT },
};

export const gameReducer = (state, action) => {
  switch (action.type) {
    case 'START_GAME':
      const newGameState = createInitialGameState(action.heroes, action.skills);
      return {
        ...state,
        gameState: newGameState,
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
        error: null,
      };
    
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
    
    case 'RECORD_CHOICE':
      const { roundType, chosenSet, setIndex } = action;
      const result = updateGameState(state.gameState, roundType, chosenSet, setIndex);
      return {
        ...state,
        gameState: result.gameState,
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
        gameComplete: result.gameComplete,
      };
    
    case 'NEXT_ROUND':
      return {
        ...state,
        currentRoundInputs: { set1: [], set2: [], set3: [] },
        selectedOptionIndex: null,
        currentRecommendation: null,
      };
    
    case 'RESET_GAME':
      storage.clearGameProgress();
      storage.clearSeenContext();
      // Preserve database state and user settings when resetting -
      // they don't need to be reloaded.
      return {
        ...initialState,
        availableHeroes: state.availableHeroes,
        availableSkills: state.availableSkills,
        regularSkills: state.regularSkills,
        orangeRegularSkills: state.orangeRegularSkills,
        heroSkills: state.heroSkills,
        databaseLoaded: state.databaseLoaded,
        settings: state.settings,
        seenContext: { ...DEFAULT_SEEN_CONTEXT },
      };

    case 'HYDRATE_SETTINGS':
      // Loads previously persisted settings into state without writing back
      // to cookies. Used during initial app mount.
      return {
        ...state,
        settings: { ...DEFAULT_SETTINGS, ...(action.settings || {}) },
      };

    case 'UPDATE_SETTINGS': {
      const newSettings = { ...state.settings, ...action.settings };
      storage.saveSettings(newSettings);
      // If the user just turned incremental mode OFF, the existing
      // seen-context is now stale (it referred to a previous AI session that
      // is no longer being kept in sync). Clear it so re-enabling later
      // starts fresh.
      const turnedOffIncremental =
        Object.prototype.hasOwnProperty.call(action.settings || {}, 'incrementalPrompt') &&
        action.settings.incrementalPrompt === false &&
        state.settings.incrementalPrompt === true;
      if (turnedOffIncremental) {
        storage.clearSeenContext();
        return {
          ...state,
          settings: newSettings,
          seenContext: { ...DEFAULT_SEEN_CONTEXT },
        };
      }
      return {
        ...state,
        settings: newSettings,
      };
    }

    case 'HYDRATE_SEEN_CONTEXT':
      // Loads previously persisted seen-context into state without writing
      // back to cookies. Used during initial app mount.
      return {
        ...state,
        seenContext: { ...DEFAULT_SEEN_CONTEXT, ...(action.seenContext || {}) },
      };

    case 'MARK_SEEN': {
      const { heroes = [], skills = [], bondIds = [] } = action.payload || {};
      const newSeen = {
        seenHeroes: Array.from(new Set([...(state.seenContext.seenHeroes || []), ...heroes])),
        seenSkills: Array.from(new Set([...(state.seenContext.seenSkills || []), ...skills])),
        seenBondIds: Array.from(new Set([...(state.seenContext.seenBondIds || []), ...bondIds])),
        staticShown: true,
      };
      storage.saveSeenContext(newSeen);
      return {
        ...state,
        seenContext: newSeen,
      };
    }

    case 'RESET_SEEN_CONTEXT':
      storage.clearSeenContext();
      return {
        ...state,
        seenContext: { ...DEFAULT_SEEN_CONTEXT },
      };
    
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.isLoading,
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
          ...state.gameState,
          round7_interstitial_dismissed: true,
        },
      };

    case 'UPDATE_TEAM':
      return {
        ...state,
        gameState: {
          ...state.gameState,
          current_heroes: action.heroes,
          current_skills: action.skills,
        },
      };
    
    case 'SET_SUPPORT_HERO':
      return {
        ...state,
        gameState: {
          ...state.gameState,
          support_hero: action.hero,
        },
      };
    
    case 'SET_SUPPORT_SKILLS':
      return {
        ...state,
        gameState: {
          ...state.gameState,
          support_skills: action.skills,
        },
      };
    
    case 'REMOVE_SUPPORT_HERO':
      return {
        ...state,
        gameState: {
          ...state.gameState,
          support_hero: null,
        },
      };
    
    case 'REMOVE_SUPPORT_SKILL':
      return {
        ...state,
        gameState: {
          ...state.gameState,
          support_skills: (state.gameState.support_skills || []).filter(s => s !== action.skill),
        },
      };
    
    case 'ADD_TEAM_MEMBER':
      const updatedGameState = { ...state.gameState };
      if (action.memberType === 'hero') {
        updatedGameState.current_heroes = [...updatedGameState.current_heroes, action.member];
      } else {
        updatedGameState.current_skills = [...updatedGameState.current_skills, action.member];
      }
      return {
        ...state,
        gameState: updatedGameState,
      };
    
    case 'REMOVE_TEAM_MEMBER':
      const newState = { ...state.gameState };
      if (action.memberType === 'hero') {
        newState.current_heroes = newState.current_heroes.filter(h => h !== action.member);
      } else {
        newState.current_skills = newState.current_skills.filter(s => s !== action.member);
      }
      return {
        ...state,
        gameState: newState,
      };
    
    default:
      return state;
  }
};

export const GameProvider = ({ children, databaseItems }) => {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  // Load database items from props (passed from index.js)
  useEffect(() => {
    if (databaseItems) {
      dispatch({ 
        type: 'LOAD_DATABASE', 
        heroes: databaseItems.heroes || [], 
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

  // Load saved progress, settings, and AI seen-context on mount.
  // We use HYDRATE_* actions (which do not write back to cookies) so that
  // simply loading the app does not produce redundant cookie writes.
  useEffect(() => {
    const savedProgress = storage.loadGameProgress();
    if (savedProgress?.gameState) {
      dispatch({ type: 'RESTORE_PROGRESS', payload: savedProgress });
    }
    dispatch({ type: 'HYDRATE_SETTINGS', settings: storage.loadSettings() });
    dispatch({ type: 'HYDRATE_SEEN_CONTEXT', seenContext: storage.loadSeenContext() });
  }, []);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within GameProvider');
  }
  return context;
};
