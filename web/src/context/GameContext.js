import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { storage } from '../utils/storage';
import { createInitialGameState, updateGameState } from '../services/gameLogic';

const GameContext = createContext();

const initialState = {
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
  databaseLoaded: false,
};

const gameReducer = (state, action) => {
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
      // Preserve database state when resetting - it doesn't need to be reloaded
      return {
        ...initialState,
        availableHeroes: state.availableHeroes,
        availableSkills: state.availableSkills,
        databaseLoaded: state.databaseLoaded,
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
        databaseLoaded: true,
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
        skills: databaseItems.skills || [] 
      });
    }
  }, [databaseItems]);

  // Auto-save game progress to cookies whenever it changes
  useEffect(() => {
    if (state.gameState) {
      storage.saveGameProgress(state.gameState, state.currentRoundInputs);
    }
  }, [state.gameState, state.currentRoundInputs]);

  // Load saved progress on mount
  useEffect(() => {
    const savedProgress = storage.loadGameProgress();
    if (savedProgress?.gameState) {
      dispatch({ type: 'RESTORE_PROGRESS', payload: savedProgress });
    }
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
