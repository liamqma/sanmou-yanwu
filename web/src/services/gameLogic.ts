/**
 * Client-side game state management logic
 */
import type { GameState, RoundType } from '../types/game';

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
  const gameComplete = newState.round_number >= 8;

  // Advance round
  newState.round_number += 1;

  return { gameState: newState, gameComplete };
};

/**
 * Get round type based on round number. Rounds 1/4/7 = hero; the rest = skill.
 */
export const getRoundType = (roundNumber: number): RoundType => {
  return roundNumber === 1 || roundNumber === 4 || roundNumber === 7 ? 'hero' : 'skill';
};

/**
 * Get items per set based on round number.
 */
export const getItemsPerSet = (roundNumber: number): number => {
  // Round 7: 2 heroes per set, Round 8: 3 skills per set
  if (roundNumber === 7) return 2;
  if (roundNumber === 8) return 3;
  return 3; // Default for rounds 1-6
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
  const roundType = getRoundType(roundNumber);
  const itemsPerSet = getItemsPerSet(roundNumber);

  let cycleNumber: number;
  let roundInCycle: number;
  if (roundNumber <= 3) {
    cycleNumber = 1;
    roundInCycle = roundNumber;
  } else if (roundNumber <= 6) {
    cycleNumber = 2;
    roundInCycle = roundNumber - 3;
  } else {
    cycleNumber = 3;
    roundInCycle = roundNumber - 6;
  }

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
