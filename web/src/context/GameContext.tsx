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
  maxSeason: 1,
  selectedSeason: 1,
  databaseLoaded: false,
};

const databaseAction = (
  databaseItems: DatabaseItems,
  selectedSeason?: number
): Extract<GameAction, { type: 'LOAD_DATABASE' }> => {
  const maxSeason =
    Number.isInteger(databaseItems.maxSeason) && databaseItems.maxSeason >= 1
      ? databaseItems.maxSeason
      : 1;

  return {
    type: 'LOAD_DATABASE',
    heroes: databaseItems.heroes || [],
    heroMetadata: databaseItems.heroMetadata || {},
    skillMetadata: databaseItems.skillMetadata || {},
    skills: databaseItems.skills || [],
    regularSkills: databaseItems.regularSkills || [],
    orangeRegularSkills: databaseItems.orangeRegularSkills || [],
    heroSkills: databaseItems.heroSkills || [],
    maxSeason,
    selectedSeason,
  };
};

const uniqueItemsExcluding = (
  items: string[],
  excluded: ReadonlySet<string>
): string[] => [...new Set(items)].filter((item) => !excluded.has(item));

const activeOfferItems = (state: ReducerState): Set<string> =>
  new Set(Object.values(state.currentRoundInputs).flat());

const rosterItems = (gameState: NonNullable<ReducerState['gameState']>): Set<string> =>
  new Set([
    ...gameState.current_heroes,
    ...gameState.current_skills,
    ...(gameState.support_hero ? [gameState.support_hero] : []),
    ...gameState.support_skills,
  ]);

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

    case 'RESTORE_PROGRESS': {
      const restoredGameState = action.payload.gameState;
      const restoredInputs = action.payload.currentRoundInputs || {
        set1: [],
        set2: [],
        set3: [],
      };
      const excluded = rosterItems(restoredGameState);
      return {
        ...state,
        gameState: restoredGameState,
        currentRoundInputs: {
          set1: uniqueItemsExcluding(restoredInputs.set1 || [], excluded),
          set2: uniqueItemsExcluding(restoredInputs.set2 || [], excluded),
          set3: uniqueItemsExcluding(restoredInputs.set3 || [], excluded),
        },
      };
    }

    case 'UPDATE_ROUND_INPUT': {
      const excluded = state.gameState
        ? rosterItems(state.gameState)
        : new Set<string>();
      return {
        ...state,
        currentRoundInputs: {
          ...state.currentRoundInputs,
          [action.setName]: uniqueItemsExcluding(action.items, excluded),
        },
        selectedOptionIndex: null,
        currentRecommendation: null,
      };
    }

    case 'SET_RECOMMENDATION':
      return {
        ...state,
        currentRecommendation: action.recommendation,
        selectedOptionIndex: null,
        isLoading: false,
        error: null,
      };

    case 'RESCORE_RECOMMENDATION':
      return {
        ...state,
        currentRecommendation: action.recommendation,
        isLoading: false,
        error: null,
      };

    case 'SELECT_OPTION':
      return {
        ...state,
        selectedOptionIndex: action.index,
      };

    case 'SET_SEASON':
      return {
        ...state,
        selectedSeason:
          Number.isInteger(action.season) &&
          action.season >= 1 &&
          action.season <= state.maxSeason
            ? action.season
            : state.maxSeason,
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
      storage.clearTeamBuilder();
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
        maxSeason: state.maxSeason,
        selectedSeason: state.selectedSeason,
        databaseLoaded: state.databaseLoaded,
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
        isLoading: false,
      };

    case 'LOAD_DATABASE': {
      const maxSeason =
        Number.isInteger(action.maxSeason) && action.maxSeason! >= 1
          ? action.maxSeason!
          : state.maxSeason;
      const selectedSeason =
        Number.isInteger(action.selectedSeason) &&
        action.selectedSeason! >= 1 &&
        action.selectedSeason! <= maxSeason
          ? action.selectedSeason!
          : maxSeason;

      return {
        ...state,
        availableHeroes: action.heroes,
        heroMetadata: action.heroMetadata || {},
        skillMetadata: action.skillMetadata || {},
        availableSkills: action.skills,
        regularSkills: action.regularSkills || [],
        orangeRegularSkills: action.orangeRegularSkills || [],
        heroSkills: action.heroSkills || [],
        maxSeason,
        selectedSeason,
        databaseLoaded: true,
      };
    }

    case 'DISMISS_ROUND_INTERSTITIAL': {
      const dismissedField =
        action.roundNumber === 7
          ? 'round7_interstitial_dismissed'
          : 'round9_interstitial_dismissed';
      return {
        ...state,
        gameState: {
          ...state.gameState!,
          [dismissedField]: true,
        },
      };
    }

    case 'UPDATE_TEAM': {
      if (!state.gameState) return state;
      const offers = activeOfferItems(state);
      const heroExclusions = new Set(offers);
      const skillExclusions = new Set(offers);
      if (state.gameState.support_hero) {
        heroExclusions.add(state.gameState.support_hero);
      }
      for (const skill of state.gameState.support_skills) {
        skillExclusions.add(skill);
      }
      return {
        ...state,
        gameState: {
          ...state.gameState,
          current_heroes: uniqueItemsExcluding(action.heroes, heroExclusions),
          current_skills: uniqueItemsExcluding(action.skills, skillExclusions),
        },
      };
    }

    case 'SET_SUPPORT_HERO': {
      if (!state.gameState) return state;
      if (
        activeOfferItems(state).has(action.hero) ||
        state.gameState.current_heroes.includes(action.hero)
      ) {
        return state;
      }
      return {
        ...state,
        gameState: {
          ...state.gameState,
          support_hero: action.hero,
        },
      };
    }

    case 'SET_SUPPORT_SKILLS': {
      if (!state.gameState) return state;
      const excluded = activeOfferItems(state);
      for (const skill of state.gameState.current_skills) excluded.add(skill);
      return {
        ...state,
        gameState: {
          ...state.gameState,
          support_skills: uniqueItemsExcluding(action.skills, excluded).slice(0, 2),
        },
      };
    }

    case 'REMOVE_SUPPORT_HERO':
      if (!state.gameState) return state;
      return {
        ...state,
        gameState: {
          ...state.gameState,
          support_hero: null,
        },
      };

    case 'REMOVE_SUPPORT_SKILL':
      if (!state.gameState) return state;
      return {
        ...state,
        gameState: {
          ...state.gameState,
          support_skills: state.gameState.support_skills.filter(
            (s) => s !== action.skill
          ),
        },
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
  const [state, dispatch] = useReducer(
    gameReducer,
    databaseItems,
    (items) =>
      items ? gameReducer(initialState, databaseAction(items)) : initialState
  );

  useEffect(() => {
    initializeTelemetry();
    preloadTelemetryData();
  }, []);

  // Load database items from props (passed from index.tsx)
  useEffect(() => {
    if (databaseItems) {
      const maxSeason =
        Number.isInteger(databaseItems.maxSeason) && databaseItems.maxSeason >= 1
          ? databaseItems.maxSeason
          : 1;
      const storedSeason = storage.loadSelectedSeason();
      const selectedSeason =
        storedSeason !== null && storedSeason <= maxSeason
          ? storedSeason
          : maxSeason;

      dispatch(databaseAction(databaseItems, selectedSeason));
    }
  }, [databaseItems]);

  // Keep season preference separate from resettable in-progress game data.
  useEffect(() => {
    if (state.databaseLoaded) {
      storage.saveSelectedSeason(state.selectedSeason);
    }
  }, [state.databaseLoaded, state.selectedSeason]);

  // Auto-save game progress to versioned local storage whenever it changes.
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
