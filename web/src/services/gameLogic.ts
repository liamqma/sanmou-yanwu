/**
 * Client-side game state management logic
 */
import type { GameState, RoundType } from '../types/game';

export const TOTAL_ROUNDS = 10;
export const ROUND_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

interface RoundDefinition {
  roundType: RoundType;
  itemsPerSet: number;
  cycleNumber: number;
  roundInCycle: number;
}

const ROUND_DEFINITIONS: Record<number, RoundDefinition> = {
  1: { roundType: 'hero', itemsPerSet: 3, cycleNumber: 1, roundInCycle: 1 },
  2: { roundType: 'skill', itemsPerSet: 3, cycleNumber: 1, roundInCycle: 2 },
  3: { roundType: 'skill', itemsPerSet: 3, cycleNumber: 1, roundInCycle: 3 },
  4: { roundType: 'hero', itemsPerSet: 3, cycleNumber: 2, roundInCycle: 1 },
  5: { roundType: 'skill', itemsPerSet: 3, cycleNumber: 2, roundInCycle: 2 },
  6: { roundType: 'skill', itemsPerSet: 3, cycleNumber: 2, roundInCycle: 3 },
  7: { roundType: 'hero', itemsPerSet: 2, cycleNumber: 3, roundInCycle: 1 },
  8: { roundType: 'skill', itemsPerSet: 3, cycleNumber: 3, roundInCycle: 2 },
  9: { roundType: 'hero', itemsPerSet: 2, cycleNumber: 4, roundInCycle: 1 },
  10: { roundType: 'skill', itemsPerSet: 3, cycleNumber: 4, roundInCycle: 2 },
};

const getRoundDefinition = (roundNumber: number): RoundDefinition => {
  const definition = ROUND_DEFINITIONS[roundNumber];
  if (!definition) {
    throw new RangeError(`Unsupported round number: ${roundNumber}`);
  }
  return definition;
};

/**
 * Create initial game state from starting heroes and skills.
 */
export const createInitialGameState = (heroes: string[], skills: string[]): GameState => {
  return {
    current_heroes: [...heroes],
    current_skills: [...skills],
    support_hero: null,
    support_skills: [],
    round_number: 1,
    round_history: [],
  };
};

/**
 * Update game state with the chosen set. Returns the new state and whether the
 * game is now complete.
 */
export const updateGameState = (
  gameState: GameState,
  roundType: RoundType,
  chosenSet: string[],
  setIndex: number
): { gameState: GameState; gameComplete: boolean } => {
  const newState: GameState = {
    ...gameState,
    current_heroes: [...gameState.current_heroes],
    current_skills: [...gameState.current_skills],
    round_history: [...gameState.round_history],
  };

  // Add chosen items to appropriate list
  if (roundType === 'hero') {
    newState.current_heroes.push(...chosenSet);
  } else {
    newState.current_skills.push(...chosenSet);
  }

  // Record history
  newState.round_history.push({
    round_number: newState.round_number,
    round_type: roundType,
    chosen_set: chosenSet,
    set_index: setIndex,
  });

  // Check if game is complete before advancing round
  const gameComplete = newState.round_number >= TOTAL_ROUNDS;

  // Advance round
  newState.round_number += 1;

  return { gameState: newState, gameComplete };
};

/**
 * Get round type based on the canonical round definition.
 */
export const getRoundType = (roundNumber: number): RoundType => {
  return getRoundDefinition(roundNumber).roundType;
};

/**
 * Get items per set based on round number.
 */
export const getItemsPerSet = (roundNumber: number): number => {
  return getRoundDefinition(roundNumber).itemsPerSet;
};

export interface RoundInfo {
  roundType: RoundType;
  roundNumber: number;
  cycleNumber: number;
  roundInCycle: number;
  itemsPerSet: number;
  title: string;
  description: string;
}

/**
 * Get round information for display.
 */
export const getRoundInfo = (roundNumber: number): RoundInfo => {
  const {
    roundType,
    itemsPerSet,
    cycleNumber,
    roundInCycle,
  } = getRoundDefinition(roundNumber);

  const typeText = roundType === 'hero' ? '武将' : '战法';

  return {
    roundType,
    roundNumber,
    cycleNumber,
    roundInCycle,
    itemsPerSet,
    title: `第 ${roundNumber} 轮：选择${typeText}`,
    description: `第 ${cycleNumber} 周期，第 ${roundInCycle} 步：从 3 组选项中选 1 组（每组 ${itemsPerSet} 个${roundType === 'hero' ? '武将' : '战法'}）`,
  };
};

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate game input: exactly 4 heroes and 8 skills.
 */
export const validateGameInput = (heroes: string[], skills: string[]): ValidationResult => {
  if (!Array.isArray(heroes) || heroes.length !== 4) {
    return { valid: false, error: `需要恰好 4 个武将，当前为 ${heroes?.length || 0} 个` };
  }

  if (!Array.isArray(skills) || skills.length !== 8) {
    return { valid: false, error: `需要恰好 8 个战法，当前为 ${skills?.length || 0} 个` };
  }

  return { valid: true };
};
