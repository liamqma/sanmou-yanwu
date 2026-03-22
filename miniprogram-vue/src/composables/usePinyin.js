import { pinyin } from 'pinyin-pro';

export function usePinyin() {
  const toPinyin = (text) => {
    try {
      return pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase();
    } catch (e) {
      return text.toLowerCase();
    }
  };

  const filterByPinyin = (items, query) => {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    return items.filter((item) => {
      const name = item.toLowerCase();
      const py = toPinyin(item);
      return name.includes(q) || py.includes(q);
    });
  };

  return { toPinyin, filterByPinyin };
}
