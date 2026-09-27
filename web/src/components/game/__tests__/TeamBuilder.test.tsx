import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { LayoutEvaluation } from '../../../services/teamAllocation';
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

function setup({ mode = 'auto', unseenHero = false }: { mode?: TeamBuilderMode; unseenHero?: boolean } = {}) {
  const layout = emptyLayout();
  layout[0][0] = { hero: '刘备', skills: ['战法甲', null] };
  const evaluation: LayoutEvaluation = {
    teams: [
      { score: 0.52, winChance: 0.6 },
      { score: null, winChance: 0 },
      { score: null, winChance: 0 },
    ],
    twoOfThree: 0,
    unseenHeroes: new Set(unseenHero ? ['刘备'] : []),
    unseenSkills: new Set(),
  };
  const onMove = vi.fn();
  const onRestoreAuto = vi.fn();
  render(
    <TeamBuilderDndProvider onMove={onMove}>
      <TeamBuilder
        layout={layout}
        evaluation={evaluation}
        mode={mode}
        allocating={false}
        heroes={['刘备', '关羽']}
        skills={['战法甲', '战法乙']}
        placed={{ heroes: new Set(['刘备']), skills: new Set(['战法甲']) }}
        supportItems={new Set()}
        defaultSkill={{}}
        onMove={onMove}
        onRestoreAuto={onRestoreAuto}
      />
    </TeamBuilderDndProvider>
  );
  return { onMove, onRestoreAuto };
}

describe('TeamBuilder', () => {
  test('shows three teams with their scores', () => {
    setup();
    expect(screen.getByRole('region', { name: '队伍编排' })).toBeVisible();
    const team = within(screen.getByTestId('team-builder-team-1'));
    expect(team.getByText('评分 5.2')).toBeVisible();
    expect(team.getByText('胜率 60%')).toBeVisible();
    expect(team.getByRole('button', { name: '队伍一刘备战法1：战法甲' })).toHaveTextContent('战法甲');
    expect(screen.getByText('自动分配')).toBeVisible();
    expect(screen.queryByRole('button', { name: '恢复自动分配' })).not.toBeInTheDocument();
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

  test('offers 恢复自动分配 in manual mode and marks combos without a weight', () => {
    const { onRestoreAuto } = setup({ mode: 'manual', unseenHero: true });
    expect(screen.getByText('已手动调整')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '恢复自动分配' }));
    expect(onRestoreAuto).toHaveBeenCalled();
    expect(screen.getByLabelText('未经验证的组合')).toHaveTextContent('未经验证');
  });
});
