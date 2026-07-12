import { pinyin } from 'pinyin-pro';

// The pinyin transliteration of a given string never changes, so cache it
// module-wide. Without this, every keystroke re-transliterated the entire
// hero/skill list (and renderOption re-transliterated each visible row again).
const pinyinCache = new Map();

export const toPinyin = (text) => {
  const key = String(text ?? '');
  const cached = pinyinCache.get(key);
  if (cached !== undefined) return cached;

  let result;
  try {
    result = pinyin(key, { toneType: 'none', type: 'array' }).join('').toLowerCase();
  } catch (e) {
    result = key.toLowerCase();
  }
  pinyinCache.set(key, result);
  return result;
};

/**
 * Hook for pinyin conversion and filtering
 */
export const usePinyin = () => {
  
  /**
   * Filter items by query (supports both Chinese and pinyin)
   * @param {string[]} items - Items to filter
   * @param {string} query - Search query
   * @param {string[]} excludeItems - Items to exclude from results
   * @returns {string[]} Filtered items
   */
  const filterByPinyin = (items, query, excludeItems = [], getSearchText = (item) => item) => {
    if (!query) return [];
    
    const lowerQuery = query.toLowerCase().trim();
    const excludeSet = new Set(excludeItems);
    
    return items.filter(item => {
      // Skip excluded items
      if (excludeSet.has(item)) return false;
      
      const searchText = String(getSearchText(item) || item);
      const name = searchText.toLowerCase();
      const py = toPinyin(searchText);
      
      // Match if query is in name or pinyin
      return name.includes(lowerQuery) || 
             py.includes(lowerQuery) || 
             name.startsWith(lowerQuery) || 
             py.startsWith(lowerQuery);
    });
  };
  
  return { toPinyin, filterByPinyin };
};
