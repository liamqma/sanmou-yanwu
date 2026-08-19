import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  installSanmouDebug,
  type SanmouDebugSnapshot,
} from '../consoleDebug';

const snapshot = (page: SanmouDebugSnapshot['page']): SanmouDebugSnapshot => ({
  schemaVersion: 1,
  page,
  model: {
    catalogVersion: 'catalog',
    corpusVersion: 'corpus',
    mechanicsVersion: 'mechanics',
    modelType: 'paired-logistic',
    featureCount: 42,
  },
  value: '可复制',
});

afterEach(() => {
  delete window.sanmouDebug;
  vi.restoreAllMocks();
});

describe('installSanmouDebug', () => {
  test('returns formatted agent-ready JSON and logs copy instructions', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const cleanup = installSanmouDebug(snapshot('game-advisor'));

    expect(window.sanmouDebug).toBeTypeOf('function');
    expect(JSON.parse(window.sanmouDebug!())).toEqual(snapshot('game-advisor'));
    expect(info).toHaveBeenCalledWith(
      '[sanmouDebug] Copy for an agent with: copy(sanmouDebug())'
    );

    cleanup();
    expect(window.sanmouDebug).toBeUndefined();
  });

  test('an old route cleanup does not remove the newer route function', () => {
    const firstCleanup = installSanmouDebug(snapshot('game-advisor'));
    const secondCleanup = installSanmouDebug(snapshot('team-builder'));

    firstCleanup();
    expect(JSON.parse(window.sanmouDebug!()).page).toBe('team-builder');

    secondCleanup();
    expect(window.sanmouDebug).toBeUndefined();
  });
});
