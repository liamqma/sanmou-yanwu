import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5001';

const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const api = {
  /**
   * Get all available heroes and skills from database
   * @returns {Promise<{heroes: string[], skills: string[]}>}
   */
  getDatabaseItems: async () => {
    const response = await apiClient.get('/api/get_database_items');
    return response.data;
  },
  
  /**
   * Get AI recommendation for current round
   * @param {string} roundType - 'hero' or 'skill'
   * @param {Array<Array<string>>} availableSets - 3 sets of options
   * @param {Object} gameState - Current game state
   * @returns {Promise<Object>} Recommendation with analysis
   */
  getRecommendation: async (roundType, availableSets, gameState) => {
    const response = await apiClient.post('/api/get_recommendation', {
      round_type: roundType,
      available_sets: availableSets,
      game_state: gameState,
    });
    return response.data;
  },
  
  /**
   * Get analytics data for dashboard
   * @returns {Promise<Object>} Analytics data
   */
  getAnalytics: async () => {
    const response = await apiClient.get('/api/get_analytics');
    return response.data;
  },
  
  /**
   * Get detailed statistics for a specific hero or skill
   * @param {string} name - Name of the hero or skill
   * @param {string} type - 'hero' or 'skill'
   * @param {Array<string>} currentHeroes - Current team heroes (optional)
   * @param {Array<string>} currentSkills - Current team skills (optional)
   * @returns {Promise<Object>} Item statistics with synergies
   */
  getItemStats: async (name, type, currentHeroes = [], currentSkills = []) => {
    const response = await apiClient.get('/api/get_item_stats', {
      params: { 
        name, 
        type,
        current_heroes: currentHeroes.join(','),
        current_skills: currentSkills.join(',')
      }
    });
    return response.data;
  },
};
