import { pinyin } from 'pinyin-pro';

/**
 * Hook for pinyin conversion and filtering
 */
export const usePinyin = () => {
  /**
   * Convert Chinese text to pinyin
   * @param {string} text - Chinese text
   * @returns {string} Pinyin representation
   */
  const toPinyin = (text) => {
    try {
      return pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase();
    } catch (e) {
      return text.toLowerCase();
    }
  };
  
  /**
   * Filter items by query (supports both Chinese and pinyin)
   * @param {string[]} items - Items to filter
   * @param {string} query - Search query
   * @param {string[]} excludeItems - Items to exclude from results
   * @returns {string[]} Filtered items
   */
  const filterByPinyin = (items, query, excludeItems = []) => {
    if (!query) return [];
    
    const lowerQuery = query.toLowerCase().trim();
    const excludeSet = new Set(excludeItems);
    
    return items.filter(item => {
      // Skip excluded items
      if (excludeSet.has(item)) return false;
      
      const name = item.toLowerCase();
      const py = toPinyin(item);
      
      // Match if query is in name or pinyin
      return name.includes(lowerQuery) || 
             py.includes(lowerQuery) || 
             name.startsWith(lowerQuery) || 
             py.startsWith(lowerQuery);
    });
  };
  
  return { toPinyin, filterByPinyin };
};
