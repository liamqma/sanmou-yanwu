import { act, renderHook, waitFor } from '@testing-library/react';
import { useTeamBuilder } from '../useTeamBuilder';

const mocks = vi.hoisted(() => ({ runLineup: vi.fn() }));

vi.mock('../../services/lineupClient', () => ({
  LineupSuperseded: class LineupSuperseded extends Error {},
  runLineup: mocks.runLineup,
}));

const SKILLS = ['一', '二'];
const team = (heroes: string[], skills: string[], strength: number | null) => ({
  heroes: [...heroes, '', '', ''].slice(0, 3),
  skills: [...skills, '', '', '', '', '', ''].slice(0, 6),
  strength,
});
/** Model lineup: the weaker team comes first. */
const lineupOf = ([a, b, c]: string[]) => ({
  score: -10,
  teams: [team([a], ['一'], 0.2), team([b, c], ['', '', '二'], 0.6), team([], [], null)],
});
const EVALUATION = { strengths: [0.6, 0.2, null], unknown: { heroes: ['未知'], skills: [] } };

const answer = (allocate: (task: string, input: { heroes: string[] }) => unknown) =>
  mocks.runLineup.mockImplementation((task: string, input: { heroes: string[] }) =>
    task === 'evaluate' ? Promise.resolve(EVALUATION) : Promise.resolve().then(() => allocate(task, input))
  );
const calls = (task: string) => mocks.runLineup.mock.calls.filter(([name]) => name === task);

beforeEach(() => {
  localStorage.clear();
  mocks.runLineup.mockReset();
  answer((_task, { heroes }) => lineupOf(heroes));
});

describe('useTeamBuilder', () => {
  test('allocates the pool with the lineup model, strongest team first', async () => {
    const heroes = ['甲', '乙', '丙', '丁'];
    const { result } = renderHook(() => useTeamBuilder(heroes, SKILLS));
    expect(result.current.allocating).toBe(true);

    await waitFor(() => expect(result.current.layout[0][0].hero).toBe('乙'));
    expect(calls('lineup')).toEqual([['lineup', { heroes, skills: SKILLS }, expect.any(Function)]]);
    expect(result.current.layout[0][1]).toEqual({ hero: '丙', skills: ['二', null] });
    expect(result.current.layout[1][0]).toEqual({ hero: '甲', skills: ['一', null] });
    expect(result.current.mode).toBe('auto');
    expect(result.current.allocating).toBe(false);
    expect([...result.current.placed.heroes]).toEqual(['乙', '丙', '甲']);
    await waitFor(() => expect(result.current.evaluation).toEqual(EVALUATION));
  });

  test('keeps a manual layout and asks the model to fill around it', async () => {
    const heroes = ['戊', '己', '庚', '辛'];
    const { result } = renderHook(() => useTeamBuilder(heroes, SKILLS));
    await waitFor(() => expect(result.current.layout[0][0].hero).toBe('己'));

    act(() =>
      result.current.move({ kind: 'hero', name: '辛', from: null }, { team: 2, slot: 0, field: 'hero' })
    );
    expect(result.current.mode).toBe('manual');
    expect(result.current.layout[2][0].hero).toBe('辛');

    answer(() => ({
      score: -9,
      teams: [team(['己', '庚'], ['', '', '二'], 0.2), team(['戊'], ['一'], 0.6), team(['辛'], ['新'], 0.1)],
    }));
    act(() => result.current.fillRemaining());
    await waitFor(() => expect(result.current.layout[2][0].skills[0]).toBe('新'));

    const [, input] = calls('fill')[0];
    expect(input.layoutHeroes).toEqual(['己', '庚', '', '戊', '', '', '辛', '', '']);
    expect(input.heroes).toBe(heroes);
    // A fill keeps the user's team order and stays manual.
    expect(result.current.layout.map((slots) => slots[0].hero)).toEqual(['己', '戊', '辛']);
    expect(result.current.mode).toBe('manual');
  });

  test('reports a failed allocation and retries on request', async () => {
    const heroes = ['壬', '癸', '子', '丑'];
    answer(() => Promise.reject(new Error('模型加载失败')));
    const { result } = renderHook(() => useTeamBuilder(heroes, SKILLS));

    await waitFor(() => expect(result.current.error).toBe('模型加载失败'));
    expect(result.current.allocating).toBe(false);

    answer((_task, input) => lineupOf(input.heroes));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.layout[0][0].hero).toBe('癸'));
    expect(result.current.error).toBeNull();
  });

  test('ignores an allocation that finishes after the pool has changed', async () => {
    let finishFirst!: (lineup: unknown) => void;
    mocks.runLineup.mockImplementation((task: string, input: { heroes: string[] }) => {
      if (task === 'evaluate') return Promise.resolve(EVALUATION);
      if (input.heroes[0] === '寅') return new Promise((resolve) => (finishFirst = resolve));
      return Promise.resolve(lineupOf(input.heroes));
    });
    const { result, rerender } = renderHook(({ heroes }) => useTeamBuilder(heroes, SKILLS), {
      initialProps: { heroes: ['寅', '卯', '辰', '巳'] },
    });
    rerender({ heroes: ['午', '未', '申', '酉'] });
    await waitFor(() => expect(result.current.layout[0][0].hero).toBe('未'));

    await act(async () => finishFirst(lineupOf(['寅', '卯', '辰'])));
    expect(result.current.layout[0][0].hero).toBe('未');
  });
});
