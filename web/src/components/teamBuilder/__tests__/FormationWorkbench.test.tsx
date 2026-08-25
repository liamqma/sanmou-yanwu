import type { ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PairRelationshipPreview } from '../../../services/relationshipPreview';
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
  PointerSensor: class PointerSensor {},
  useDraggable: () => ({
    ref: vi.fn(),
    handleRef: vi.fn(),
    isDragging: false,
  }),
  useDroppable: () => ({ ref: vi.fn(), isDropTarget: false }),
}));

import FormationWorkbench, { RelationshipBadges } from '../FormationWorkbench';

const originalElementsFromPoint = Object.getOwnPropertyDescriptor(
  document,
  'elementsFromPoint'
);

const renderWorkbench = (
  {
    layout = createEmptyTeamBuilderLayout(),
    heroes = [],
    skills = [],
  }: {
    layout?: TeamBuilderLayout;
    heroes?: string[];
    skills?: string[];
  } = {}
) => {
  const onMove = vi.fn();
  render(
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
  label:
    family === 'HS'
      ? '携带'
      : family === 'THS'
        ? '同队'
        : family === 'M'
          ? '机制'
          : '战法搭配',
  weight,
  support: 10,
  source: { kind: 'skill', name: '来源战法' },
  target: { kind: family === 'TSP' ? 'skill' : 'hero', name: target },
  accessibleLabel: `${family}：来源战法与${target}，模型权重 ${weight >= 0 ? '+' : '−'}${Math.abs(weight).toFixed(4)}，参考 10 场`,
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
    const badges = screen
      .getByTestId('team-card-0')
      .querySelector('[data-testid="team-relationship-badges"]');
    expect(badges).toHaveTextContent('新激活·3人同阵营 +0.6591');
    expect(badges).toHaveTextContent('保留·缘分·柱石之臣 +0.2438');
    expect(badges).toHaveTextContent('将移除·2人同阵营 +0.1647');
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
  test('does not render empty relationship rails and keeps the card surface selectable', () => {
    renderWorkbench({ heroes: ['张昭'] });

    expect(screen.queryByTestId('relationship-badges')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('team-relationship-badges')
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId('pool-hero-张昭')).getByRole('button')
    );
    expect(screen.getByText('已选择：张昭')).toBeVisible();
  });

  test('replaces matching B/HC evidence with one contextual presentation', () => {
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

    const scoreBefore = screen.getAllByTestId('team-strength')[0].textContent;
    fireEvent.click(screen.getByTestId('hero-slot-0-0'));

    const team = screen.getByTestId('team-card-0');
    expect(within(team).getByTestId('team-relationship-badges')).toHaveTextContent(
      '3人同阵营 +0.6591'
    );
    expect(within(team).getByTestId('team-relationship-badges')).toHaveTextContent(
      '缘分·柱石之臣 +0.2438'
    );
    const evidenceText = within(team)
      .getAllByTestId('team-evidence')
      .map((row) => row.textContent)
      .join('；');
    expect(evidenceText).not.toContain('3人同阵营');
    expect(evidenceText).not.toContain('缘分 · 柱石之臣');
    expect(within(team).getAllByTestId('team-evidence')).toHaveLength(3);
    expect(screen.getAllByTestId('team-strength')[0]).toHaveTextContent(
      scoreBefore ?? ''
    );
  });

  test('does not turn a closed pair detail lock into hover state', () => {
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
    fireEvent.click(source);
    expect(source).toHaveAttribute('data-preview-state', 'selected');

    const target = screen.getByTestId('skill-slot-0-0-1').parentElement;
    if (!target) throw new Error('Missing relationship target');
    const more = within(target).getByRole('button', {
      name: '显示另有 1 项关系',
    });
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(document.querySelectorAll('[data-preview-state]')).toHaveLength(0);
  });
});

describe('RelationshipBadges', () => {
  test('keeps three compact weights and exposes hidden support details from +N', () => {
    render(
      <div style={{ position: 'relative', width: 180, height: 48 }}>
        <RelationshipBadges
          relationships={[
            relationship('HS', 0.4, '甲'),
            relationship('THS', -0.3, '乙'),
            relationship('M', 0.2, '丙'),
            relationship('TSP', -0.1, '丁'),
          ]}
        />
      </div>
    );

    expect(screen.getByText('携带 +0.4000')).toBeInTheDocument();
    expect(screen.getByText('同队 −0.3000')).toBeInTheDocument();
    expect(screen.getByText('机制 +0.2000')).toBeInTheDocument();
    expect(screen.queryByText('战法搭配 −0.1000')).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: '显示另有 1 项关系' });
    more.focus();
    expect(more).toHaveFocus();
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);

    expect(more).toHaveAttribute('aria-expanded', 'true');
    const details = screen.getByRole('list', { name: '其余关系' });
    expect(details).toHaveTextContent('战法搭配 −0.1000');
    expect(details).toHaveTextContent('参考 10 场');
    expect(screen.getByRole('listitem')).toHaveAccessibleName(
      'TSP：来源战法与丁，模型权重 −0.1000，参考 10 场'
    );
  });

  test('restores the relationship rail drag handle after explicit controls', () => {
    const dragHandleRef = vi.fn();
    render(
      <RelationshipBadges
        relationships={[
          relationship('HS', 0.4, '甲'),
          relationship('THS', -0.3, '乙'),
          relationship('M', 0.2, '丙'),
          relationship('TSP', -0.1, '丁'),
        ]}
        dragHandleRef={dragHandleRef}
      />
    );

    const rail = screen.getByTestId('relationship-badges');
    const badge = screen.getByText('携带 +0.4000');
    const more = screen.getByRole('button', { name: '显示另有 1 项关系' });

    fireEvent.pointerOver(badge);
    expect(dragHandleRef).toHaveBeenLastCalledWith(rail);
    fireEvent.pointerOver(more);
    expect(dragHandleRef).toHaveBeenLastCalledWith(null);
    fireEvent.pointerOver(badge);
    expect(dragHandleRef).toHaveBeenLastCalledWith(rail);

    fireEvent.click(more);
    const details = screen.getByRole('list', { name: '其余关系' });
    fireEvent.pointerOver(details);
    expect(dragHandleRef).toHaveBeenLastCalledWith(null);
    fireEvent.pointerOver(badge);
    expect(dragHandleRef).toHaveBeenLastCalledWith(rail);
  });
});
