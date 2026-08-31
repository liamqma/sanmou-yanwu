import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createEmptyTeamBuilderLayout,
  createStoredTeamBuilderLayout,
  teamBuilderPoolKey,
  type TeamBuilderLayout,
} from '../../../services/teamBuilderArrangement';
import { TEAM_BUILDER_STORAGE_KEY } from '../../../utils/storage';

const mocks = vi.hoisted(() => ({
  state: {
    selectedSeason: 16,
    gameState: {
      current_heroes: ['A', 'B'],
      current_skills: ['s1', 's2'],
      support_hero: null as string | null,
      support_skills: [] as string[],
      round_number: 1,
      round_history: [],
    },
  },
  getCachedTeamFormation: vi.fn(() => null),
  setCachedTeamFormation: vi.fn(),
}));

vi.mock('../../../context/GameContext', () => ({
  useGame: () => ({ state: mocks.state }),
}));

vi.mock('../../../data', () => ({
  database: {
    heroes: {
      A: { camp: '魏' },
      B: { camp: '蜀' },
    },
    formations: {
      一字阵: {},
      鱼鳞阵: {},
    },
    team: [],
  },
  recommendationData: {
    catalog: {},
    model: {},
  },
}));

vi.mock('../../../services/teamFormationCache', () => ({
  getCachedTeamFormation: mocks.getCachedTeamFormation,
  setCachedTeamFormation: mocks.setCachedTeamFormation,
  teamFormationCacheKey: (poolKey: string) => poolKey,
}));

vi.mock('../../../services/recommendationEngine', () => ({
  recommendHybridTeamsCooperatively: vi.fn(),
}));

vi.mock('../../../services/teamBuilderMessaging', () => ({
  summarizeTeamBuilderRecommendation: () => ({
    successMessage: null,
    warningMessage: null,
  }),
}));

vi.mock('../../../services/promptGenerator', () => ({
  generateTeamValidationPrompt: vi.fn(),
}));

vi.mock('../../../services/recommendationDebug', () => ({
  buildTeamFormationDebugContext: () => ({}),
}));

vi.mock('../../../services/localTeamAgent', () => ({
  LocalTeamAgentError: class LocalTeamAgentError extends Error {
    code = 'test';
  },
  createTeamAgentRequest: vi.fn(),
  isTeamBuilderLayoutComplete: () => false,
  layoutFromTeamAgentTeams: vi.fn(),
  requestLocalTeamRecommendation: vi.fn(),
  syncLocalTeamAgentExperiment: () => false,
  teamBuilderLayoutFingerprint: (layout: TeamBuilderLayout) =>
    JSON.stringify(layout),
}));

vi.mock('../FormationWorkbench', () => ({
  default: ({ layout }: { layout: TeamBuilderLayout }) => (
    <output data-testid="rendered-layout">{JSON.stringify(layout)}</output>
  ),
}));

vi.mock('../AgentReviewPanel', () => ({
  default: () => null,
}));

import TeamBuilderPanel from '../TeamBuilderPanel';

class WorkerStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  emitResult(recommendation: unknown) {
    const request = this.postMessage.mock.calls.at(-1)?.[0] as
      | { requestId: string }
      | undefined;
    if (!request) throw new Error('Worker has not received a request');
    this.onmessage?.({
      data: {
        type: 'result',
        requestId: request.requestId,
        recommendation,
      },
    } as MessageEvent);
  }
}

const workers: WorkerStub[] = [];

const readStoredLayout = () =>
  JSON.parse(localStorage.getItem(TEAM_BUILDER_STORAGE_KEY) ?? 'null') as {
    poolKey: string;
    recommendationPoolKey: string | null;
    layout: TeamBuilderLayout;
  };

const recommendation = {
  incomplete: false,
  options: [
    {
      teams: [
        {
          heroes: [{ name: 'B', skills: ['s2'], skillScore: 1 }],
          strength: 1,
          formation: '鱼鳞阵',
          evidence: {
            heroSynergy: [],
            heroSkill: [],
            skillSynergy: [],
          },
        },
      ],
    },
  ],
};

describe('TeamBuilderPanel persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    workers.length = 0;
    mocks.getCachedTeamFormation.mockReturnValue(null);
    vi.stubGlobal(
      'Worker',
      class extends WorkerStub {
        constructor() {
          super();
          workers.push(this);
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test('ignores an unscoped legacy formation-only layout when seeding the current pool', async () => {
    localStorage.setItem(
      TEAM_BUILDER_STORAGE_KEY,
      JSON.stringify([{ formation: '一字阵', heroes: [] }])
    );

    render(<TeamBuilderPanel />);
    await waitFor(() => expect(workers).toHaveLength(1));
    await waitFor(() => expect(workers[0].postMessage).toHaveBeenCalled());
    act(() => workers[0].emitResult(recommendation));

    const renderedLayout = await screen.findByTestId('rendered-layout');
    const layout = JSON.parse(
      renderedLayout.textContent ?? 'null'
    ) as TeamBuilderLayout;
    expect(layout[0].formation).toBe('鱼鳞阵');
    await waitFor(() =>
      expect(readStoredLayout().recommendationPoolKey).toBe(
        teamBuilderPoolKey(['A', 'B'], ['s1', 's2'])
      )
    );
  });

  test('reloads a pending larger pool and merges into formation and headless tactic edits', async () => {
    const oldPoolKey = teamBuilderPoolKey(['A'], ['s1']);
    const newPoolKey = teamBuilderPoolKey(['A', 'B'], ['s1', 's2']);
    const editedLayout = createEmptyTeamBuilderLayout();
    editedLayout[0].formation = '一字阵';
    editedLayout[0].heroes[0] = {
      hero: null,
      row: '后排',
      skills: [null, 's1'],
    };
    localStorage.setItem(
      TEAM_BUILDER_STORAGE_KEY,
      JSON.stringify(
        createStoredTeamBuilderLayout(oldPoolKey, oldPoolKey, editedLayout)
      )
    );

    const firstMount = render(<TeamBuilderPanel />);
    await waitFor(() => expect(workers).toHaveLength(1));
    await waitFor(() => expect(workers[0].postMessage).toHaveBeenCalled());
    await waitFor(() => expect(readStoredLayout().poolKey).toBe(newPoolKey));
    const pendingLayout = readStoredLayout();
    expect(pendingLayout.recommendationPoolKey).toBeNull();
    expect(pendingLayout.layout[0].formation).toBe('一字阵');
    expect(pendingLayout.layout[0].heroes[0]).toEqual({
      hero: null,
      row: '后排',
      skills: [null, 's1'],
    });
    firstMount.unmount();

    render(<TeamBuilderPanel />);
    await waitFor(() => expect(workers).toHaveLength(2));
    await waitFor(() => expect(workers[1].postMessage).toHaveBeenCalled());
    act(() => workers[1].emitResult(recommendation));

    const renderedLayout = await screen.findByTestId('rendered-layout');
    const layout = JSON.parse(
      renderedLayout.textContent ?? 'null'
    ) as TeamBuilderLayout;
    expect(layout[0].formation).toBe('一字阵');
    expect(layout[0].heroes[0]).toEqual({
      hero: 'B',
      row: '后排',
      skills: ['s2', 's1'],
    });
    await waitFor(() =>
      expect(readStoredLayout().recommendationPoolKey).toBe(newPoolKey)
    );
  });
});
