import { describe, expect, test } from 'vitest';
import {
  applyMove,
  emptyLayout,
  layoutPoolKey,
  normalizeLayout,
  parseStoredTeamBuilder,
  placedItems,
  type TeamLayout,
} from '../teamLayout';

const SIGNATURES = { A: 'sigA', B: 'sigB' };

function sample(): TeamLayout {
  const layout = emptyLayout();
  layout[0][0] = { hero: 'A', skills: ['x', 'y'] };
  layout[1][0] = { hero: 'B', skills: ['z', null] };
  return layout;
}

describe('applyMove', () => {
  test('places a roster hero and returns the displaced one', () => {
    const next = applyMove(sample(), { kind: 'hero', name: 'C', from: null }, { team: 0, slot: 0, field: 'hero' }, SIGNATURES);
    expect(next[0][0]).toEqual({ hero: 'C', skills: ['x', 'y'] });
    expect(placedItems(next).heroes.has('A')).toBe(false);
  });

  test('swaps two hero slots together with their skills', () => {
    const next = applyMove(
      sample(),
      { kind: 'hero', name: 'A', from: { team: 0, slot: 0, field: 'hero' } },
      { team: 1, slot: 0, field: 'hero' },
      SIGNATURES
    );
    expect(next[0][0]).toEqual({ hero: 'B', skills: ['z', null] });
    expect(next[1][0]).toEqual({ hero: 'A', skills: ['x', 'y'] });
  });

  test('moves a placed item when it is dragged from 当前阵容 again', () => {
    const next = applyMove(sample(), { kind: 'skill', name: 'x', from: null }, { team: 1, slot: 0, field: 1 }, SIGNATURES);
    expect(next[0][0].skills).toEqual([null, 'y']);
    expect(next[1][0].skills).toEqual(['z', 'x']);
  });

  test('swaps skills between slots', () => {
    const next = applyMove(
      sample(),
      { kind: 'skill', name: 'x', from: { team: 0, slot: 0, field: 0 } },
      { team: 1, slot: 0, field: 0 },
      SIGNATURES
    );
    expect(next[0][0].skills).toEqual(['z', 'y']);
    expect(next[1][0].skills).toEqual(['x', null]);
  });

  test('rejects a skill on an empty hero slot or on its own signature hero', () => {
    const layout = sample();
    expect(applyMove(layout, { kind: 'skill', name: 'w', from: null }, { team: 2, slot: 0, field: 0 }, SIGNATURES)).toBe(layout);
    expect(applyMove(layout, { kind: 'skill', name: 'sigA', from: null }, { team: 0, slot: 0, field: 0 }, SIGNATURES)).toBe(layout);
  });

  test('returns a hero with its skills to 当前阵容', () => {
    const next = applyMove(sample(), { kind: 'hero', name: 'A', from: { team: 0, slot: 0, field: 'hero' } }, null, SIGNATURES);
    expect(next[0][0]).toEqual({ hero: null, skills: [null, null] });
    expect(placedItems(next).skills.has('x')).toBe(false);
  });
});

describe('normalizeLayout', () => {
  test('keeps only pool items once, never a skill without a hero or a signature on its hero', () => {
    const raw = [
      [
        { hero: 'A', skills: ['sigA', 'x'] },
        { hero: 'A', skills: ['y', null] },
        { hero: 'gone', skills: ['z', null] },
      ],
      [{ hero: null, skills: ['x', null] }],
    ];
    const layout = normalizeLayout(raw, ['A', 'B'], ['sigA', 'x', 'y', 'z'], SIGNATURES);
    expect(layout[0][0]).toEqual({ hero: 'A', skills: [null, 'x'] });
    expect(placedItems(layout)).toEqual({ heroes: new Set(['A']), skills: new Set(['x']) });
  });
});

describe('storage helpers', () => {
  test('pool key ignores order and parse rejects other versions', () => {
    expect(layoutPoolKey(['B', 'A'], ['y', 'x'])).toBe(layoutPoolKey(['A', 'B'], ['x', 'y']));
    const stored = { version: 3, mode: 'manual', poolKey: 'k', layout: emptyLayout() };
    expect(parseStoredTeamBuilder(stored)).toEqual(stored);
    expect(parseStoredTeamBuilder({ ...stored, version: 2 })).toBeNull();
  });
});
