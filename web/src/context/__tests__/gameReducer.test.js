/**
 * Unit tests for the gameReducer focused on:
 *  - HYDRATE_SETTINGS / HYDRATE_SEEN_CONTEXT (no cookie writes)
 *  - UPDATE_SETTINGS auto-clears seenContext when incrementalPrompt
 *    transitions true -> false
 *  - MARK_SEEN writes cookies and merges sets without duplicates
 *  - RESET_SEEN_CONTEXT and RESET_GAME interaction with seenContext
 */
jest.mock('../../utils/storage', () => {
  const saveSettings = jest.fn();
  const saveSeenContext = jest.fn();
  const clearSeenContext = jest.fn();
  const clearGameProgress = jest.fn();
  return {
    __esModule: true,
    DEFAULT_SETTINGS: { incrementalPrompt: false },
    DEFAULT_SEEN_CONTEXT: {
      seenHeroes: [],
      seenSkills: [],
      seenBondIds: [],
      staticShown: false,
    },
    storage: {
      saveSettings,
      loadSettings: jest.fn(() => ({ incrementalPrompt: false })),
      saveSeenContext,
      loadSeenContext: jest.fn(() => ({
        seenHeroes: [],
        seenSkills: [],
        seenBondIds: [],
        staticShown: false,
      })),
      clearSeenContext,
      saveGameProgress: jest.fn(),
      loadGameProgress: jest.fn(() => null),
      clearGameProgress,
    },
  };
});

import { gameReducer, initialState } from '../GameContext';
import { storage } from '../../utils/storage';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('HYDRATE_SETTINGS', () => {
  test('loads settings into state without writing to cookies', () => {
    const next = gameReducer(initialState, {
      type: 'HYDRATE_SETTINGS',
      settings: { incrementalPrompt: true },
    });
    expect(next.settings.incrementalPrompt).toBe(true);
    expect(storage.saveSettings).not.toHaveBeenCalled();
  });

  test('merges with defaults when partial settings are provided', () => {
    const next = gameReducer(initialState, {
      type: 'HYDRATE_SETTINGS',
      settings: {}, // no fields
    });
    expect(next.settings).toEqual({ incrementalPrompt: false });
    expect(storage.saveSettings).not.toHaveBeenCalled();
  });

  test('handles missing settings payload gracefully', () => {
    const next = gameReducer(initialState, { type: 'HYDRATE_SETTINGS' });
    expect(next.settings).toEqual({ incrementalPrompt: false });
    expect(storage.saveSettings).not.toHaveBeenCalled();
  });
});

describe('HYDRATE_SEEN_CONTEXT', () => {
  test('loads seenContext into state without writing to cookies', () => {
    const seen = {
      seenHeroes: ['张三', '李四'],
      seenSkills: ['火攻'],
      seenBondIds: ['桃园结义'],
      staticShown: true,
    };
    const next = gameReducer(initialState, {
      type: 'HYDRATE_SEEN_CONTEXT',
      seenContext: seen,
    });
    expect(next.seenContext).toEqual(seen);
    expect(storage.saveSeenContext).not.toHaveBeenCalled();
    expect(storage.clearSeenContext).not.toHaveBeenCalled();
  });

  test('falls back to defaults when no payload is provided', () => {
    const next = gameReducer(initialState, { type: 'HYDRATE_SEEN_CONTEXT' });
    expect(next.seenContext).toEqual({
      seenHeroes: [],
      seenSkills: [],
      seenBondIds: [],
      staticShown: false,
    });
    expect(storage.saveSeenContext).not.toHaveBeenCalled();
  });
});

describe('UPDATE_SETTINGS - persistence', () => {
  test('writes new settings to cookie', () => {
    const next = gameReducer(initialState, {
      type: 'UPDATE_SETTINGS',
      settings: { incrementalPrompt: true },
    });
    expect(next.settings.incrementalPrompt).toBe(true);
    expect(storage.saveSettings).toHaveBeenCalledTimes(1);
    expect(storage.saveSettings).toHaveBeenCalledWith({ incrementalPrompt: true });
  });
});

describe('UPDATE_SETTINGS - auto-reset seen context on incremental toggle OFF', () => {
  const stateWithSeen = {
    ...initialState,
    settings: { incrementalPrompt: true },
    seenContext: {
      seenHeroes: ['张三'],
      seenSkills: ['火攻'],
      seenBondIds: ['桃园结义'],
      staticShown: true,
    },
  };

  test('clears seenContext when incrementalPrompt transitions true -> false', () => {
    const next = gameReducer(stateWithSeen, {
      type: 'UPDATE_SETTINGS',
      settings: { incrementalPrompt: false },
    });
    expect(next.settings.incrementalPrompt).toBe(false);
    expect(next.seenContext).toEqual({
      seenHeroes: [],
      seenSkills: [],
      seenBondIds: [],
      staticShown: false,
    });
    expect(storage.clearSeenContext).toHaveBeenCalledTimes(1);
    expect(storage.saveSettings).toHaveBeenCalledTimes(1);
  });

  test('does NOT clear seenContext when toggling false -> true', () => {
    const stateOff = {
      ...initialState,
      settings: { incrementalPrompt: false },
      seenContext: {
        seenHeroes: ['张三'],
        seenSkills: [],
        seenBondIds: [],
        staticShown: true,
      },
    };
    const next = gameReducer(stateOff, {
      type: 'UPDATE_SETTINGS',
      settings: { incrementalPrompt: true },
    });
    expect(next.settings.incrementalPrompt).toBe(true);
    expect(next.seenContext.seenHeroes).toEqual(['张三']);
    expect(storage.clearSeenContext).not.toHaveBeenCalled();
  });

  test('does NOT clear seenContext when updating other settings while incremental stays ON', () => {
    const stateOn = {
      ...initialState,
      settings: { incrementalPrompt: true, somethingElse: 'a' },
      seenContext: {
        seenHeroes: ['张三'],
        seenSkills: [],
        seenBondIds: [],
        staticShown: true,
      },
    };
    const next = gameReducer(stateOn, {
      type: 'UPDATE_SETTINGS',
      settings: { somethingElse: 'b' },
    });
    expect(next.seenContext.seenHeroes).toEqual(['张三']);
    expect(storage.clearSeenContext).not.toHaveBeenCalled();
  });

  test('does NOT clear seenContext when explicitly setting incrementalPrompt to true (no transition)', () => {
    const stateOn = {
      ...initialState,
      settings: { incrementalPrompt: true },
      seenContext: {
        seenHeroes: ['张三'],
        seenSkills: [],
        seenBondIds: [],
        staticShown: true,
      },
    };
    const next = gameReducer(stateOn, {
      type: 'UPDATE_SETTINGS',
      settings: { incrementalPrompt: true },
    });
    expect(next.seenContext.seenHeroes).toEqual(['张三']);
    expect(storage.clearSeenContext).not.toHaveBeenCalled();
  });
});

describe('MARK_SEEN', () => {
  test('merges new entities, dedupes, sets staticShown=true, persists once', () => {
    const start = {
      ...initialState,
      seenContext: {
        seenHeroes: ['张三'],
        seenSkills: ['火攻'],
        seenBondIds: [],
        staticShown: false,
      },
    };
    const next = gameReducer(start, {
      type: 'MARK_SEEN',
      payload: {
        heroes: ['李四', '张三'], // duplicate '张三' should not appear twice
        skills: ['连击'],
        bondIds: ['桃园结义'],
      },
    });
    expect(next.seenContext).toEqual({
      seenHeroes: ['张三', '李四'],
      seenSkills: ['火攻', '连击'],
      seenBondIds: ['桃园结义'],
      staticShown: true,
    });
    expect(storage.saveSeenContext).toHaveBeenCalledTimes(1);
    expect(storage.saveSeenContext).toHaveBeenCalledWith(next.seenContext);
  });

  test('handles missing payload fields safely', () => {
    const next = gameReducer(initialState, { type: 'MARK_SEEN', payload: {} });
    expect(next.seenContext).toEqual({
      seenHeroes: [],
      seenSkills: [],
      seenBondIds: [],
      staticShown: true,
    });
    expect(storage.saveSeenContext).toHaveBeenCalledTimes(1);
  });
});

describe('RESET_SEEN_CONTEXT', () => {
  test('clears seen-context state and storage', () => {
    const start = {
      ...initialState,
      seenContext: {
        seenHeroes: ['张三'],
        seenSkills: [],
        seenBondIds: [],
        staticShown: true,
      },
    };
    const next = gameReducer(start, { type: 'RESET_SEEN_CONTEXT' });
    expect(next.seenContext).toEqual({
      seenHeroes: [],
      seenSkills: [],
      seenBondIds: [],
      staticShown: false,
    });
    expect(storage.clearSeenContext).toHaveBeenCalledTimes(1);
  });
});

describe('RESET_GAME interaction with seen-context and settings', () => {
  test('clears seen-context but preserves user settings', () => {
    const start = {
      ...initialState,
      settings: { incrementalPrompt: true },
      seenContext: {
        seenHeroes: ['张三'],
        seenSkills: ['火攻'],
        seenBondIds: ['桃园结义'],
        staticShown: true,
      },
    };
    const next = gameReducer(start, { type: 'RESET_GAME' });
    expect(next.settings).toEqual({ incrementalPrompt: true });
    expect(next.seenContext).toEqual({
      seenHeroes: [],
      seenSkills: [],
      seenBondIds: [],
      staticShown: false,
    });
    expect(storage.clearSeenContext).toHaveBeenCalledTimes(1);
    expect(storage.clearGameProgress).toHaveBeenCalledTimes(1);
  });
});
