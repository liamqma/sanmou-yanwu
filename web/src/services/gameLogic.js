/**
 * Client-side game state management logic
 */

/**
 * Create initial game state from starting heroes and skills
 * @param {string[]} heroes - Initial 4 heroes
 * @param {string[]} skills - Initial 4 skills
 * @returns {Object} Initial game state
 */
export const createInitialGameState = (heroes, skills) => {
  return {
    current_heroes: [...heroes],
    current_skills: [...skills],
    round_number: 1,
    round_history: [],
  };
};

/**
 * Update game state with chosen set
 * @param {Object} gameState - Current game state
 * @param {string} roundType - 'hero' or 'skill'
 * @param {string[]} chosenSet - Items chosen in this round
 * @param {number} setIndex - Index of chosen set (0, 1, or 2)
 * @returns {Object} Updated game state and completion status
 */
export const updateGameState = (gameState, roundType, chosenSet, setIndex) => {
  const newState = {
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
 * Get round type based on round number
 * @param {number} roundNumber - Current round (1-8)
 * @returns {string} 'hero' or 'skill'
 */
export const getRoundType = (roundNumber) => {
  // Round 1, 4, 7 = hero; Round 2, 3, 5, 6, 8 = skill
  return (roundNumber === 1 || roundNumber === 4 || roundNumber === 7) ? 'hero' : 'skill';
};

/**
 * Get items per set based on round number
 * @param {number} roundNumber - Current round (1-8)
 * @returns {number} Number of items per set
 */
export const getItemsPerSet = (roundNumber) => {
  // Round 7: 2 heroes per set, Round 8: 3 skills per set
  if (roundNumber === 7) return 2;
  if (roundNumber === 8) return 3;
  return 3; // Default for rounds 1-6
};

/**
 * Get round information for display
 * @param {number} roundNumber - Current round (1-8)
 * @returns {Object} Round info with title and description
 */
export const getRoundInfo = (roundNumber) => {
  const roundType = getRoundType(roundNumber);
  const itemsPerSet = getItemsPerSet(roundNumber);
  
  let cycleNumber, roundInCycle;
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
  
  const typeText = roundType === 'hero' ? 'Hero' : 'Skill';
  
  return {
    roundType,
    roundNumber,
    cycleNumber,
    roundInCycle,
    itemsPerSet,
    title: `Round ${roundNumber}: ${typeText} Selection`,
    description: `Cycle ${cycleNumber}, Step ${roundInCycle}: Choose 1 set from 3 options (each set has ${itemsPerSet} ${roundType === 'hero' ? 'heroes' : 'skills'})`,
  };
};

/**
 * Validate game input
 * @param {string[]} heroes - Heroes list
 * @param {string[]} skills - Skills list
 * @returns {Object} Validation result
 */
export const validateGameInput = (heroes, skills) => {
  if (!Array.isArray(heroes) || heroes.length !== 4) {
    return { valid: false, error: `Need exactly 4 heroes, got ${heroes?.length || 0}` };
  }

  if (!Array.isArray(skills) || skills.length !== 4) {
    return { valid: false, error: `Need exactly 4 skills, got ${skills?.length || 0}` };
  }

  return { valid: true };
};
