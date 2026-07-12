import { renderHook } from '@testing-library/react';
import { usePinyin, toPinyin } from '../usePinyin';

/**
 * Acceptance tests for pinyin conversion + filtering. Covers the module-level
 * memoization added for performance (same input -> same cached output) and the
 * Chinese/pinyin matching behavior of filterByPinyin.
 */
describe('toPinyin', () => {
  test('transliterates Chinese to lowercase pinyin', () => {
    expect(toPinyin('孙权')).toBe('sunquan');
    expect(toPinyin('诸葛亮')).toBe('zhugeliang');
  });

  test('is stable/cached across repeated calls (same result each time)', () => {
    const a = toPinyin('陆逊');
    const b = toPinyin('陆逊');
    expect(a).toBe(b);
    expect(a).toBe('luxun');
  });

  test('handles non-Chinese and empty input gracefully', () => {
    expect(toPinyin('ABC')).toBe('abc');
    expect(toPinyin('')).toBe('');
    expect(toPinyin(null)).toBe('');
  });
});

describe('usePinyin().filterByPinyin', () => {
  const items = ['孙权', '陆逊', '诸葛亮'];

  const filter = (...args) => {
    const { result } = renderHook(() => usePinyin());
    return result.current.filterByPinyin(...args);
  };

  test('returns [] for an empty query', () => {
    expect(filter(items, '')).toEqual([]);
  });

  test('matches by Chinese substring', () => {
    expect(filter(items, '孙权')).toEqual(['孙权']);
  });

  test('matches by pinyin prefix', () => {
    expect(filter(items, 'sun')).toEqual(['孙权']);
    expect(filter(items, 'zhuge')).toEqual(['诸葛亮']);
  });

  test('excludes items passed in excludeItems', () => {
    expect(filter(items, 'lu', ['陆逊'])).toEqual([]);
  });

  test('supports a custom getSearchText accessor', () => {
    const objs = [{ name: '孙权' }, { name: '陆逊' }];
    const result = filter(objs, 'sun', [], (o) => o.name);
    expect(result).toEqual([{ name: '孙权' }]);
  });
});
