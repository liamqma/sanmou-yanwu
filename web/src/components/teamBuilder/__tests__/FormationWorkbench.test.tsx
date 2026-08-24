import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PairRelationshipPreview } from '../../../services/relationshipPreview';
vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({ children }: { children: ReactNode }) => children,
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  PointerSensor: class PointerSensor {},
  useDraggable: () => ({ ref: vi.fn(), isDragging: false }),
  useDroppable: () => ({ ref: vi.fn(), isDropTarget: false }),
}));

import { RelationshipBadges } from '../FormationWorkbench';

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
  accessibleLabel: `${family}：来源战法与${target}，模型权重 ${weight >= 0 ? '+' : '−'}${Math.abs(weight).toFixed(4)}`,
});

describe('RelationshipBadges', () => {
  test('shows three separate signed weights and an accessible +N summary without layout content', () => {
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
    expect(screen.getByText('+1')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('TSP：来源战法与丁，模型权重 −0.1000')
    );
  });
});
