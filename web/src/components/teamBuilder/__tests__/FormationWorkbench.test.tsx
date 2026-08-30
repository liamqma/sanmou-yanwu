import { Profiler, type ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  PairRelationshipAggregatePreview,
  PairRelationshipPreview,
} from '../../../services/relationshipPreview';
import {
  createEmptyTeamBuilderLayout,
  type TeamBuilderLayout,
} from '../../../services/teamBuilderArrangement';

const dndCallbacks = vi.hoisted(() => ({
  onDragStart: undefined as ((event: unknown) => void) | undefined,
  onDragOver: undefined as ((event: unknown) => void) | undefined,
  onDragEnd: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({
    children,
    onDragStart,
    onDragOver,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragStart?: (event: unknown) => void;
    onDragOver?: (event: unknown) => void;
    onDragEnd?: (event: unknown) => void;
  }) => {
    dndCallbacks.onDragStart = onDragStart;
    dndCallbacks.onDragOver = onDragOver;
    dndCallbacks.onDragEnd = onDragEnd;
    return children;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  PointerSensor: class PointerSensor {
    static configure() {
      return PointerSensor;
    }
  },
  useDraggable: () => ({
    ref: vi.fn(),
    handleRef: vi.fn(),
    isDragging: false,
  }),
  useDroppable: () => ({ ref: vi.fn(), isDropTarget: false }),
}));

import FormationWorkbench, {
  RelationshipAggregateScore,
} from '../FormationWorkbench';

const originalElementsFromPoint = Object.getOwnPropertyDescriptor(
  document,
  'elementsFromPoint'
);

const renderWorkbench = (
  {
    layout = createEmptyTeamBuilderLayout(),
    heroes = [],
    skills = [],
    onRender,
  }: {
    layout?: TeamBuilderLayout;
    heroes?: string[];
    skills?: string[];
    onRender?: () => void;
  } = {}
) => {
  const onMove = vi.fn();
  const workbench = (
    <FormationWorkbench
      layout={layout}
      heroes={heroes}
      skills={skills}
      formations={[]}
      supportItems={new Set()}
      onMove={onMove}
      onFormationChange={vi.fn()}
      onRowChange={vi.fn()}
    />
  );
  render(
    onRender ? (
      <Profiler id="formation-workbench" onRender={onRender}>
        {workbench}
      </Profiler>
    ) : (
      workbench
    )
  );
  return onMove;
};

const dragEndEvent = (
  nativeEvent: Event,
  operationTarget: {
    kind: 'hero';
    destination: 'slot';
    teamIndex: number;
    heroIndex: number;
  }
) => ({
  canceled: false,
  nativeEvent,
  operation: {
    source: {
      data: {
        kind: 'hero',
        origin: 'pool',
        hero: '测试武将',
        label: '测试武将',
      },
    },
    target: { data: operationTarget },
  },
});

const setElementsFromPoint = (elements: Element[]) => {
  const elementsFromPoint = vi.fn(() => elements);
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: elementsFromPoint,
  });
  return elementsFromPoint;
};

afterEach(() => {
  dndCallbacks.onDragStart = undefined;
  dndCallbacks.onDragOver = undefined;
  dndCallbacks.onDragEnd = undefined;
  if (originalElementsFromPoint) {
    Object.defineProperty(
      document,
      'elementsFromPoint',
      originalElementsFromPoint
    );
  } else {
    Reflect.deleteProperty(document, 'elementsFromPoint');
  }
});

const relationship = (
  family: PairRelationshipPreview['family'],
  weight: number,
  target: string
): PairRelationshipPreview => ({
  featureId: `${family}|${target}`,
  family,
  detailLabel:
    family === 'HS'
      ? '携带'
      : family === 'HP'
        ? '搭配'
        : family === 'HT'
          ? '精确三人组'
          : '同武将',
  label:
    family === 'HS'
      ? '携带'
      : family === 'HP'
        ? '搭配'
        : family === 'HT'
          ? '精确三人组'
          : '同武将',
  weight,
  support: 10,
  source: { kind: 'skill', name: '来源战法' },
  target: { kind: family === 'SP' ? 'skill' : 'hero', name: target },
  accessibleLabel: `${family}：来源战法与${target}，模型权重 ${weight >= 0 ? '+' : '−'}${Math.abs(weight).toFixed(4)}，参考 10 场`,
});

const aggregate = (
  components: PairRelationshipPreview[]
): PairRelationshipAggregatePreview => {
  const total = components.reduce((sum, component) => sum + component.weight, 0);
  return {
    source: components[0].source,
    target: components[0].target,
    total,
    components,
    accessibleLabel: `${components[0].target.name}与来源战法的关系总分 ${total >= 0 ? '+' : '−'}${Math.abs(total).toFixed(4)}，共 ${components.length} 项；查看完整明细`,
  };
};

describe('FormationWorkbench card presentation', () => {
  test('keeps hero art while every assigned and pooled tactic is text-only', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '刘备';
    layout[0].heroes[0].skills = ['避其锐气', null];

    renderWorkbench({
      layout,
      heroes: ['刘备', '曹操'],
      skills: ['避其锐气', '青囊急救'],
    });

    expect(screen.getByTestId('game-card-hero-刘备')).toBeInTheDocument();
    expect(screen.getByTestId('skill-slot-0-0-0')).toHaveTextContent('避其锐气');
    expect(screen.getByTestId('pool-skill-青囊急救')).toHaveTextContent('青囊急救');
    expect(screen.getByTestId('skill-slot-0-0-1')).toHaveTextContent(
      '拖入或点选战法'
    );
    expect(
      within(screen.getByTestId('skill-slot-0-0-0')).queryByText('1', {
        exact: true,
      })
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('skill-slot-0-0-1')).queryByText('2', {
        exact: true,
      })
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('pool-skill-青囊急救')).queryByText('战', {
        exact: true,
      })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-card-tactic-避其锐气')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-card-tactic-青囊急救')).not.toBeInTheDocument();
    expect(getComputedStyle(screen.getByTestId('hero-art-0-0')).alignItems).not.toBe('start');
    expect(getComputedStyle(screen.getByTestId('game-card-hero-刘备')).height).toBe('100%');
    expect(
      getComputedStyle(screen.getByTestId('pool-hero-曹操-primary')).paddingTop
    ).toBe('4px');
  });

  test('uses the same database-quality surfaces for pooled and assigned tactics', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '皇甫嵩2';
    layout[0].heroes[0].skills = ['诛凶殄逆', '任人唯贤'];
    renderWorkbench({
      layout,
      heroes: ['皇甫嵩2'],
      skills: ['诛凶殄逆', '任人唯贤', '烈火张天', '避其锐气'],
    });

    const assignedOrange = screen.getByTestId('skill-slot-0-0-0').parentElement;
    const assignedPurple = screen.getByTestId('skill-slot-0-0-1').parentElement;
    if (!assignedOrange || !assignedPurple) {
      throw new Error('Missing assigned tactic surfaces');
    }
    const pooledOrange = screen.getByTestId('pool-skill-烈火张天');
    const pooledPurple = screen.getByTestId('pool-skill-避其锐气');

    expect(assignedOrange).toHaveAttribute('data-skill-quality', 'orange');
    expect(assignedPurple).toHaveAttribute('data-skill-quality', 'purple');
    expect(getComputedStyle(assignedOrange).backgroundColor).toBe(
      getComputedStyle(pooledOrange).backgroundColor
    );
    expect(getComputedStyle(assignedPurple).backgroundColor).toBe(
      getComputedStyle(pooledPurple).backgroundColor
    );
    expect(getComputedStyle(assignedOrange).color).toBe(
      getComputedStyle(pooledOrange).color
    );
    expect(getComputedStyle(assignedPurple).color).toBe(
      getComputedStyle(pooledPurple).color
    );
    expect(getComputedStyle(assignedOrange).backgroundColor).toBe(
      'rgba(214, 154, 56, 0.22)'
    );
    expect(getComputedStyle(assignedPurple).backgroundColor).toBe(
      'rgba(139, 103, 184, 0.2)'
    );
  });

  test('uses the hero portrait as a tap source without stealing nested controls', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '刘备';
    layout[0].heroes[0].skills = ['避其锐气', null];
    renderWorkbench({
      layout,
      heroes: ['刘备'],
      skills: ['避其锐气'],
    });

    fireEvent.click(screen.getByTestId('hero-art-0-0'));
    expect(screen.getByText('已选择：刘备')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '刘备 前排' }));
    expect(screen.getByText('已选择：刘备')).toBeVisible();

    fireEvent.click(screen.getByTestId('skill-slot-0-0-0'));
    expect(screen.getByText('已选择：避其锐气')).toBeVisible();
    expect(screen.queryByText('已选择：刘备')).not.toBeInTheDocument();
  });
});

describe('FormationWorkbench drag resolution', () => {
  const staleTarget = {
    kind: 'hero' as const,
    destination: 'slot' as const,
    teamIndex: 0,
    heroIndex: 0,
  };

  test('previews the physical pointer target without waiting for drag-over dispatch', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '曹操';
    renderWorkbench({ layout, heroes: ['张昭', '陆逊', '曹操', '黄盖'] });
    const physicalTarget = screen
      .getByTestId('hero-slot-0-2')
      .closest('[data-team-builder-drop-target]');
    if (!physicalTarget) throw new Error('Missing physical target');
    const elementsFromPoint = setElementsFromPoint([physicalTarget]);

    expect(dndCallbacks.onDragStart).toBeTypeOf('function');
    act(() => {
      dndCallbacks.onDragStart?.({
        nativeEvent: new MouseEvent('pointermove', {
          clientX: 10,
          clientY: 20,
        }),
        operation: {
          source: {
            data: {
              kind: 'hero',
              origin: 'pool',
              hero: '黄盖',
              label: '黄盖',
            },
          },
        },
      });
    });
    act(() => {
      window.dispatchEvent(
        new MouseEvent('pointermove', { clientX: 42, clientY: 84 })
      );
    });

    expect(elementsFromPoint).toHaveBeenCalledWith(42, 84);
    expect(screen.queryByTestId('team-relationship-badges')).not.toBeInTheDocument();
    for (const transientScore of screen.queryAllByTestId('relationship-score')) {
      expect(transientScore).not.toHaveAccessibleName(/同阵营|缘分/);
    }
  });

  test('uses the release coordinates instead of a stale operation target', () => {
    const onMove = renderWorkbench();
    const releaseTarget = screen
      .getByTestId('hero-slot-1-2')
      .closest('[data-team-builder-drop-target]');
    if (!releaseTarget) throw new Error('Missing release target');
    const elementsFromPoint = setElementsFromPoint([releaseTarget]);

    expect(dndCallbacks.onDragEnd).toBeTypeOf('function');
    act(() => {
      dndCallbacks.onDragEnd?.(
        dragEndEvent(
          new MouseEvent('pointerup', { clientX: 42, clientY: 84 }),
          staleTarget
        )
      );
    });

    expect(elementsFromPoint).toHaveBeenCalledWith(42, 84);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'hero',
        origin: 'pool',
        hero: '测试武将',
      }),
      {
        kind: 'hero',
        destination: 'slot',
        teamIndex: 1,
        heroIndex: 2,
      }
    );
  });

  test('passes a drop through an aggregate relationship control to its card', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    const onMove = renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖', '曹操'],
    });

    const sourceSurface = screen
      .getByTestId('hero-slot-0-0')
      .closest('[data-team-builder-preview-context="true"]');
    if (!sourceSurface) throw new Error('Missing hero source surface');
    fireEvent.pointerMove(sourceSurface, { pointerType: 'mouse' });
    const score = within(screen.getByTestId('hero-card-0-1')).getByTestId(
      'relationship-score'
    );
    const elementsFromPoint = setElementsFromPoint([score]);

    act(() => {
      dndCallbacks.onDragEnd?.(
        dragEndEvent(
          new MouseEvent('pointerup', { clientX: 32, clientY: 64 }),
          staleTarget
        )
      );
    });

    expect(elementsFromPoint).toHaveBeenCalledWith(32, 64);
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'hero', origin: 'pool' }),
      {
        kind: 'hero',
        destination: 'slot',
        teamIndex: 0,
        heroIndex: 1,
      }
    );
  });

  test('accepts hero drops on the card body while excluding nested controls', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills = ['风助火势', '烈火焚营'];
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    const onMove = renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
      skills: ['风助火势', '烈火焚营'],
    });

    setElementsFromPoint([screen.getByTestId('hero-art-0-1')]);
    act(() => {
      dndCallbacks.onDragEnd?.(
        dragEndEvent(
          new MouseEvent('pointerup', { clientX: 32, clientY: 64 }),
          staleTarget
        )
      );
    });
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'hero', origin: 'pool' }),
      {
        kind: 'hero',
        destination: 'slot',
        teamIndex: 0,
        heroIndex: 1,
      }
    );
    onMove.mockClear();

    for (const nestedControl of [
      screen.getByRole('button', { name: '张昭 前排' }),
      screen.getByTestId('skill-slot-0-0-1'),
    ]) {
      setElementsFromPoint([nestedControl]);
      act(() => {
        dndCallbacks.onDragEnd?.(
          dragEndEvent(
            new MouseEvent('pointerup', { clientX: 32, clientY: 64 }),
            staleTarget
          )
        );
      });
    }

    fireEvent.pointerMove(screen.getByTestId('skill-slot-0-0-0'), {
      pointerType: 'mouse',
    });
    const skillScore = within(
      screen.getByTestId('skill-slot-0-0-1').parentElement as HTMLElement
    ).getByTestId('relationship-score');
    setElementsFromPoint([skillScore]);
    act(() => {
      dndCallbacks.onDragEnd?.(
        dragEndEvent(
          new MouseEvent('pointerup', { clientX: 32, clientY: 64 }),
          staleTarget
        )
      );
    });

    expect(onMove).not.toHaveBeenCalled();
  });

  test('does not use a stale operation target when released outside targets', () => {
    const onMove = renderWorkbench();
    const elementsFromPoint = setElementsFromPoint([]);

    expect(dndCallbacks.onDragEnd).toBeTypeOf('function');
    act(() => {
      dndCallbacks.onDragEnd?.(
        dragEndEvent(
          new MouseEvent('pointerup', { clientX: 12, clientY: 24 }),
          staleTarget
        )
      );
    });

    expect(elementsFromPoint).toHaveBeenCalledWith(12, 24);
    expect(onMove).not.toHaveBeenCalled();
  });

  test('falls back to the operation target without client coordinates', () => {
    const onMove = renderWorkbench();

    expect(dndCallbacks.onDragEnd).toBeTypeOf('function');
    act(() => {
      dndCallbacks.onDragEnd?.(dragEndEvent(new Event('dragend'), staleTarget));
    });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'hero',
        origin: 'pool',
        hero: '测试武将',
      }),
      staleTarget
    );
  });
});

describe('FormationWorkbench contextual presentation', () => {
  test('does not render empty relationship score lanes and keeps resting lower lanes selectable', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '刘备';
    layout[0].heroes[0].skills[0] = '避其锐气';
    renderWorkbench({ layout, heroes: ['刘备', '张昭'], skills: ['避其锐气'] });

    expect(screen.queryByTestId('relationship-score-lane')).not.toBeInTheDocument();
    const poolHero = screen.getByTestId('pool-hero-张昭');
    fireEvent.click(poolHero);
    expect(screen.getByText('已选择：张昭')).toBeVisible();
    fireEvent.click(poolHero);
    expect(screen.queryByText('已选择：张昭')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('skill-slot-0-0-0').parentElement as HTMLElement);
    expect(screen.getByText('已选择：避其锐气')).toBeVisible();
  });

  test('does not recommit for repeated movement inside one primary', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills = ['风助火势', '烈火焚营'];
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    const onRender = vi.fn();
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
      skills: ['风助火势', '烈火焚营'],
      onRender,
    });

    const source = screen.getByTestId('skill-slot-0-0-0');
    const target = screen.getByTestId('skill-slot-0-0-1');
    const initialCommits = onRender.mock.calls.length;

    fireEvent.pointerMove(source, { pointerType: 'mouse', clientX: 10 });
    expect(source).toHaveAttribute('data-preview-state', 'selected');
    const commitsAfterActivation = onRender.mock.calls.length;
    expect(commitsAfterActivation).toBeGreaterThan(initialCommits);

    for (const clientX of [11, 12, 13, 14]) {
      fireEvent.pointerMove(source, { pointerType: 'mouse', clientX });
    }
    expect(onRender).toHaveBeenCalledTimes(commitsAfterActivation);

    fireEvent.pointerMove(target, { pointerType: 'mouse', clientX: 20 });
    expect(target).toHaveAttribute('data-preview-state', 'selected');
    expect(onRender.mock.calls.length).toBeGreaterThan(commitsAfterActivation);
  });

  test('overlays the 44px relationship control without reserving a second row', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills = ['风助火势', '烈火焚营'];
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
      skills: ['风助火势', '烈火焚营'],
    });

    fireEvent.pointerMove(screen.getByTestId('skill-slot-0-0-0'), {
      pointerType: 'mouse',
    });
    const primary = screen.getByTestId('skill-slot-0-0-1');
    const surface = primary.parentElement;
    if (!surface) throw new Error('Missing tactic surface');
    const score = within(surface).getByTestId('relationship-score');
    const lane = within(surface).getByTestId('relationship-score-lane');
    const remove = within(surface).getByRole('button', {
      name: '移除战法 烈火焚营',
    });

    expect(getComputedStyle(surface).height).toBe('46px');
    expect(getComputedStyle(primary).height).toBe('44px');
    expect(getComputedStyle(remove).height).toBe('44px');
    expect(getComputedStyle(lane).height).toBe('44px');
    expect(getComputedStyle(lane).position).toBe('absolute');
    expect(getComputedStyle(lane).top).toBe('1px');
    expect(getComputedStyle(score).height).toBe('44px');
  });

  test('switches related primary hover while preserving the source on its relationship score', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills = ['风助火势', '烈火焚营'];
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
      skills: ['风助火势', '烈火焚营'],
    });

    const source = screen.getByTestId('skill-slot-0-0-0');
    const target = screen.getByTestId('skill-slot-0-0-1');
    fireEvent.pointerMove(source, { pointerType: 'mouse' });
    expect(source).toHaveAttribute('data-preview-state', 'selected');

    fireEvent.pointerMove(target, { pointerType: 'mouse' });
    expect(target).toHaveAttribute('data-preview-state', 'selected');
    expect(source).not.toHaveAttribute('data-preview-state', 'selected');

    fireEvent.pointerMove(source, { pointerType: 'mouse' });
    const targetSurface = target.parentElement;
    if (!targetSurface) throw new Error('Missing relationship target');
    fireEvent.pointerOver(
      within(targetSurface).getByTestId('relationship-score-lane'),
      { pointerType: 'mouse' }
    );
    expect(source).toHaveAttribute('data-preview-state', 'selected');
  });

  test('keeps unrelated cards visually steady while outlining the source', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills[0] = '烈火张天';
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖', '曹操'],
      skills: ['烈火张天'],
    });

    const source = screen.getByTestId('skill-slot-0-0-0');
    const unrelated = screen.getByTestId('pool-hero-曹操');
    fireEvent.pointerMove(source, { pointerType: 'mouse' });

    expect(source).toHaveAttribute('data-preview-state', 'selected');
    expect(unrelated).toHaveAttribute('data-preview-state', 'unrelated');
    expect(getComputedStyle(unrelated).opacity).toBe('1');
  });

  test('restores primary hover after an excluded remove control', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills[0] = '烈火张天';
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
      skills: ['烈火张天'],
    });

    for (const [primary, remove] of [
      [
        screen.getByTestId('hero-slot-0-0'),
        screen.getByRole('button', { name: '移除武将 张昭' }),
      ],
      [
        screen.getByTestId('skill-slot-0-0-0'),
        screen.getByRole('button', { name: '移除战法 烈火张天' }),
      ],
    ]) {
      fireEvent.pointerMove(primary, { pointerType: 'mouse' });
      expect(primary).toHaveAttribute('data-preview-state', 'selected');
      fireEvent.pointerOver(remove, { pointerType: 'mouse' });
      expect(document.querySelectorAll('[data-preview-state]')).toHaveLength(0);
      fireEvent.pointerMove(primary, { pointerType: 'mouse' });
      expect(primary).toHaveAttribute('data-preview-state', 'selected');
    }
  });

  test('clears pointer-only previews over internal workbench chrome', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills = ['风助火势', '烈火焚营'];
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
      skills: ['风助火势', '烈火焚营'],
    });

    const source = screen.getByTestId('skill-slot-0-0-0');
    fireEvent.pointerMove(source, { pointerType: 'mouse' });
    expect(source).toHaveAttribute('data-preview-state', 'selected');

    fireEvent.pointerOver(screen.getByTestId('formation-workbench-header'));

    expect(document.querySelectorAll('[data-preview-state]')).toHaveLength(0);
  });

  test('clears a skill preview over controls elsewhere in its hero card', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills = ['风助火势', '烈火焚营'];
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
      skills: ['风助火势', '烈火焚营'],
    });

    const source = screen.getByTestId('skill-slot-0-0-0');
    fireEvent.pointerMove(source, { pointerType: 'mouse' });
    expect(source).toHaveAttribute('data-preview-state', 'selected');

    fireEvent.pointerOver(
      screen.getByRole('button', { name: '张昭 前排' })
    );

    expect(document.querySelectorAll('[data-preview-state]')).toHaveLength(0);
  });

  test('keeps scoring stable while presenting only HP, HS, SP, and HT evidence', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[0].skills[0] = '烈火张天';
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
      skills: ['烈火张天'],
    });

    const team = screen.getByTestId('team-card-0');
    const source = screen.getByTestId('hero-slot-0-0');
    const evidenceRows = () =>
      within(team)
        .queryAllByTestId('team-evidence')
        .map((row) => ({ key: row.getAttribute('title'), text: row.textContent }));
    const evidenceBefore = evidenceRows();
    const scoreBefore = within(team).getByTestId('team-strength').textContent;
    expect(evidenceBefore.map(({ text }) => text).join(' ')).not.toMatch(
      /同队|战法搭配|机制|同阵营|缘分/
    );
    expect(team).not.toHaveTextContent(/同队|战法搭配|机制|同阵营|缘分/);

    for (const activate of [
      () => fireEvent.pointerMove(source, { pointerType: 'mouse' }),
      () => fireEvent.focus(source),
      () => fireEvent.click(source),
    ]) {
      activate();
      expect(evidenceRows()).toEqual(evidenceBefore);
      expect(within(team).getByTestId('team-strength')).toHaveTextContent(
        scoreBefore ?? ''
      );
      expect(team).not.toHaveTextContent(/同队|战法搭配|机制|同阵营|缘分/);
      for (const transientScore of screen.queryAllByTestId('relationship-score')) {
        expect(transientScore).not.toHaveAccessibleName(
          /同队|战法搭配|机制|同阵营|缘分/
        );
      }
      expect(screen.queryByTestId('team-relationship-status')).not.toBeInTheDocument();
    }
  });

  test('presents exact HT only in the transient team-level control', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '孟获';
    layout[0].heroes[1].hero = '木鹿大王';
    layout[0].heroes[2].hero = '祝融';
    renderWorkbench({
      layout,
      heroes: ['孟获', '木鹿大王', '祝融'],
    });

    const team = screen.getByTestId('team-card-0');
    const permanentEvidence = within(team)
      .queryAllByTestId('team-evidence')
      .map((row) => row.textContent ?? '');
    expect(permanentEvidence.join(' ')).not.toContain(
      '孟获 + 木鹿大王 + 祝融'
    );

    fireEvent.pointerMove(screen.getByTestId('hero-slot-0-0'), {
      pointerType: 'mouse',
    });
    const trioLane = screen.getByTestId('team-relationship-score-lane-0');
    expect(within(trioLane).getAllByTestId('relationship-score')).toHaveLength(1);
    expect(
      within(trioLane).getByTestId('relationship-score')
    ).toHaveAccessibleName(
      /精确武将三人组孟获、木鹿大王、祝融/
    );
    expect(
      within(team)
        .queryAllByTestId('team-evidence')
        .map((row) => row.textContent ?? '')
    ).toEqual(permanentEvidence);
  });

  test('clears keyboard preview when focus moves to unrelated workbench controls', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '张昭';
    layout[0].heroes[1].hero = '陆逊';
    layout[0].heroes[2].hero = '黄盖';
    renderWorkbench({
      layout,
      heroes: ['张昭', '陆逊', '黄盖'],
    });

    const source = screen.getByTestId('hero-slot-0-0');
    const sourceSurface = source.parentElement;
    if (!sourceSurface) throw new Error('Missing hero surface');
    const teamRegion = screen.getByRole('region', {
      name: '队伍 1 武将配置',
    });
    act(() => teamRegion.focus());
    userEvent.tab();
    expect(sourceSurface).toHaveFocus();
    expect(source).toHaveAttribute('data-preview-state', 'selected');
    expect(screen.queryByTestId('team-relationship-status')).not.toBeInTheDocument();

    userEvent.tab({ shift: true });

    expect(teamRegion).toHaveFocus();
    expect(document.querySelectorAll('[data-preview-state]')).toHaveLength(0);
  });

});

describe('RelationshipAggregateScore', () => {
  test('shows one total and discloses every signed component with support', async () => {
    const preview = aggregate([
      relationship('HS', 0.4, '甲'),
      relationship('HP', -0.3, '甲'),
      relationship('SP', 0.2, '甲'),
      relationship('HT', -0.1, '甲'),
    ]);
    render(
      <div style={{ position: 'relative', width: 180, height: 48 }}>
        <RelationshipAggregateScore aggregate={preview} />
      </div>
    );

    const score = screen.getByRole('button', { name: /关系总分 \+0\.2000/ });
    expect(score).toHaveTextContent('+0.2000');
    expect(getComputedStyle(score).height).toBe('44px');
    expect(getComputedStyle(score).minHeight).toBe('44px');
    expect(getComputedStyle(score).minWidth).toBe('68px');
    expect(getComputedStyle(screen.getByTestId('relationship-score-lane')).height).toBe('44px');
    expect(screen.queryByRole('list', { name: '全部关系分项' })).not.toBeInTheDocument();

    act(() => score.focus());
    fireEvent.click(score);
    expect(screen.getByRole('dialog')).toHaveTextContent('甲 × 来源战法 +0.2000');
    expect(screen.getAllByTestId('relationship-detail-row')).toHaveLength(4);
    expect(screen.getByText('+0.4000 · 参考 10 场')).toBeVisible();
    expect(screen.getByText('−0.3000 · 参考 10 场')).toBeVisible();
    expect(screen.getByText('+0.2000 · 参考 10 场')).toBeVisible();
    expect(screen.getByText('−0.1000 · 参考 10 场')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '关闭关系分明细' })).toHaveFocus()
    );
    const close = screen.getByRole('button', { name: '关闭关系分明细' });
    expect(getComputedStyle(close).width).toBe('44px');
    expect(getComputedStyle(close).height).toBe('44px');

    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(score).toHaveFocus();
  });

  test('makes a team-owned HT score visually and accessibly unambiguous', async () => {
    const trio = aggregate([relationship('HT', 0.4, '甲、乙、丙')]);
    trio.compactLabel = '三人组';
    trio.detailHeading = '队伍 1 · 精确三人组 甲、乙、丙';
    trio.accessibleLabel =
      '队伍 1，精确武将三人组甲、乙、丙，关系总分 +0.4000，共 1 项；查看完整明细';
    render(<RelationshipAggregateScore aggregate={trio} />);

    const score = screen.getByTestId('relationship-score');
    expect(score).toHaveTextContent('三人组 +0.4000');
    expect(score).toHaveAccessibleName(/精确武将三人组甲、乙、丙/);
    fireEvent.click(score);

    expect(screen.getByRole('dialog')).toHaveTextContent(
      '队伍 1 · 精确三人组 甲、乙、丙 +0.4000'
    );
    expect(screen.getAllByTestId('relationship-detail-row')).toHaveLength(1);
    expect(screen.getByText('+0.4000 · 参考 10 场')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '关闭关系分明细' })).toHaveFocus()
    );
  });

  test('retains an outgoing score for 150ms without pointer ownership', () => {
    vi.useFakeTimers();
    const preview = aggregate([relationship('HS', 0.4, '甲')]);
    const { rerender } = render(
      <RelationshipAggregateScore aggregate={preview} />
    );

    act(() => vi.advanceTimersByTime(20));
    const lane = screen.getByTestId('relationship-score-lane');
    expect(lane).toHaveAttribute('data-relationship-transition-state', 'visible');

    rerender(<RelationshipAggregateScore aggregate={null} />);
    expect(lane).toHaveAttribute('data-relationship-count', '0');
    expect(lane).toHaveAttribute('aria-hidden', 'true');
    expect(getComputedStyle(lane).pointerEvents).toBe('none');

    act(() => vi.advanceTimersByTime(149));
    expect(screen.getByTestId('relationship-score-lane')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('relationship-score-lane')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test('stages identity replacements through an outgoing exit and incoming entry', () => {
    vi.useFakeTimers();
    const first = aggregate([relationship('HS', 0.4, '甲')]);
    const second = aggregate([relationship('HS', 0.3, '乙')]);
    const { rerender } = render(
      <RelationshipAggregateScore aggregate={first} />
    );

    act(() => vi.advanceTimersByTime(20));
    const lane = screen.getByTestId('relationship-score-lane');
    expect(lane).toHaveAttribute('data-relationship-transition-state', 'visible');

    rerender(<RelationshipAggregateScore aggregate={second} />);
    expect(lane).toHaveAttribute('data-relationship-transition-state', 'exiting');
    expect(lane).toHaveAttribute('aria-hidden', 'true');
    expect(getComputedStyle(lane).pointerEvents).toBe('none');
    expect(screen.getByTestId('relationship-score')).toHaveAccessibleName(
      /甲与来源战法/
    );

    act(() => vi.advanceTimersByTime(149));
    expect(screen.getByTestId('relationship-score')).toHaveAccessibleName(
      /甲与来源战法/
    );
    act(() => vi.advanceTimersByTime(1));
    expect(lane).toHaveAttribute('data-relationship-transition-state', 'entering');
    expect(screen.getByTestId('relationship-score')).toHaveAccessibleName(
      /乙与来源战法/
    );
    act(() => vi.advanceTimersByTime(20));
    expect(lane).toHaveAttribute('data-relationship-transition-state', 'visible');
    vi.useRealTimers();
  });

});
