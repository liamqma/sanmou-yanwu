import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { LayoutEvaluation } from '../../../services/lineupProtocol';
import { emptyLayout, type TeamBuilderMode } from '../../../services/teamLayout';

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock('@dnd-kit/dom', () => ({ Accessibility: class Accessibility {} }));

vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({ children, onDragEnd }: { children: ReactNode; onDragEnd?: (event: unknown) => void }) => {
    dnd.onDragEnd = onDragEnd;
    return children;
  },
  PointerSensor: class PointerSensor {
    static configure() {
      return PointerSensor;
    }
  },
  useDraggable: () => ({ ref: vi.fn(), isDragging: false }),
  useDroppable: () => ({ ref: vi.fn(), isDropTarget: false }),
}));

import TeamBuilder, { TeamBuilderDndProvider } from '../TeamBuilder';

function setup({
  mode = 'auto',
  unseenHero = false,
  heroes = ['刘备', '关羽'],
  error = null,
  allocating = false,
}: {
  mode?: TeamBuilderMode;
  unseenHero?: boolean;
  heroes?: string[];
  error?: string | null;
  allocating?: boolean;
} = {}) {
  const layout = emptyLayout();
  layout[0][0] = { hero: '刘备', skills: ['战法甲', null] };
  const evaluation: LayoutEvaluation = {
    strengths: [0.6, null, null],
    unknown: { heroes: unseenHero ? ['刘备'] : [], skills: [] },
  };
  const onMove = vi.fn();
  const onRestoreAuto = vi.fn();
  const onFillRemaining = vi.fn();
  const onRetry = vi.fn();
  render(
    <TeamBuilderDndProvider onMove={onMove}>
      <TeamBuilder
        layout={layout}
        evaluation={evaluation}
        mode={mode}
        allocating={allocating}
        progress={0.5}
        error={error}
        onRetry={onRetry}
        heroes={heroes}
        skills={['战法甲']}
        placed={{ heroes: new Set(['刘备']), skills: new Set(['战法甲']) }}
        supportItems={new Set()}
        defaultSkill={{}}
        onMove={onMove}
        onRestoreAuto={onRestoreAuto}
        onFillRemaining={onFillRemaining}
      />
    </TeamBuilderDndProvider>
  );
  return { onMove, onRestoreAuto, onFillRemaining, onRetry };
}

describe('TeamBuilder', () => {
  test('shows three teams with their predicted win rates', () => {
    setup();
    expect(screen.getByRole('region', { name: '队伍编排' })).toBeVisible();
    const team = within(screen.getByTestId('team-builder-team-1'));
    expect(team.getByText('胜率 60%')).toBeVisible();
    expect(within(screen.getByTestId('team-builder-team-2')).getByText('空')).toBeVisible();
    expect(team.getByRole('button', { name: '队伍一刘备战法1：战法甲' })).toHaveTextContent('战法甲');
    expect(screen.getByText('自动分配')).toBeVisible();
    expect(screen.queryByRole('button', { name: '重置为自动分配' })).not.toBeInTheDocument();
  });

  test('picks an unallocated hero for an empty slot', () => {
    const { onMove } = setup();
    fireEvent.click(screen.getByRole('button', { name: '队伍一第2位武将：空' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: '选择刘备' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '选择关羽' }));
    expect(onMove).toHaveBeenCalledWith(
      { kind: 'hero', name: '关羽', from: null },
      { team: 0, slot: 1, field: 'hero' }
    );
  });

  test('returns a placed skill to 当前阵容 from the picker', () => {
    const { onMove } = setup();
    fireEvent.click(screen.getByRole('button', { name: '队伍一刘备战法1：战法甲' }));
    fireEvent.click(screen.getByRole('button', { name: '移回当前阵容' }));
    expect(onMove).toHaveBeenCalledWith(
      { kind: 'skill', name: '战法甲', from: { team: 0, slot: 0, field: 0 } },
      null
    );
  });

  test('turns a drop into a move', () => {
    const { onMove } = setup();
    const source = { kind: 'hero', name: '关羽', from: null };
    const target = { team: 1, slot: 0, field: 'hero' };
    dnd.onDragEnd?.({ canceled: false, operation: { source: { data: { source } }, target: { data: { target } } } });
    expect(onMove).toHaveBeenCalledWith(source, target);
    onMove.mockClear();
    dnd.onDragEnd?.({ canceled: true, operation: { source: { data: { source } }, target: { data: { target } } } });
    expect(onMove).not.toHaveBeenCalled();
  });

  test('offers 重置为自动分配 in manual mode and marks cards the model has never seen', () => {
    const { onRestoreAuto } = setup({ mode: 'manual', unseenHero: true });
    expect(screen.getByText('已手动调整')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重置为自动分配' }));
    expect(onRestoreAuto).toHaveBeenCalled();
    expect(screen.getByLabelText('模型没见过的卡')).toHaveTextContent('未见过');
    expect(screen.getByRole('note')).toHaveTextContent('按一张普通的未知卡估算');
  });

  test('shows how far an allocation has got', () => {
    setup({ allocating: true });
    expect(screen.getByRole('status')).toHaveTextContent('正在分配 50%');
    expect(screen.getByLabelText('正在分配')).toBeVisible();
  });

  test('reports a failed allocation and retries', () => {
    const { onRetry } = setup({ error: '网络不可用' });
    expect(screen.getByRole('alert')).toHaveTextContent('自动分配失败：网络不可用');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalled();
  });

  test('fills the remaining slots in manual mode', () => {
    const { onFillRemaining } = setup({ mode: 'manual' });
    fireEvent.click(screen.getByRole('button', { name: '自动分配剩余格子' }));
    expect(onFillRemaining).toHaveBeenCalled();
  });

  test('disables the fill when no card is left to place', () => {
    setup({ mode: 'manual', heroes: ['刘备'] });
    expect(screen.getByRole('button', { name: '自动分配剩余格子' })).toHaveAttribute('aria-disabled', 'true');
  });
});
