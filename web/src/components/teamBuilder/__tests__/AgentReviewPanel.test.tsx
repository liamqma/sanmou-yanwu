import { fireEvent, render, screen } from '@testing-library/react';
import type { TeamAgentResult } from '../../../services/localTeamAgent';
import AgentReviewPanel from '../AgentReviewPanel';

const result: TeamAgentResult = {
  teams: [],
  status: 'complete',
  stoppedAt: null,
  attempts: { heroes: 1, formations: 1, skills: 2, review: 1 },
  heroAssignments: [
    {
      teamIndex: 0,
      slotIndex: 1,
      hero: '郝昭',
      reason: '补足魏阵营并提供承伤能力',
      evidence: ['campBonus:魏'],
    },
  ],
  formationDecisions: [],
  skillAssignments: [],
  review: {
    status: 'complete',
    verdict: 'workable',
    teams: [
      {
        teamIndex: 0,
        verdict: 'workable',
        strengths: [
          {
            category: 'camp',
            message: '三名魏将获得阵营加成',
            evidence: [{ source: 'campBonus', id: 'camp:魏' }],
          },
        ],
        warnings: [
          {
            severity: 'warning',
            category: 'position',
            message: '后排输出位保护不足',
            suggestedAction: '调整郝昭到前排',
            evidence: [{ source: 'hero', id: '郝昭' }],
          },
        ],
      },
    ],
    crossTeamWarnings: [],
    deterministicRuleWarnings: [],
    attempts: 1,
    warnings: [],
  },
  warnings: [],
};

test('shows recommendation reasoning, review warnings, and undo', () => {
  const onUndo = vi.fn();
  render(
    <AgentReviewPanel
      result={result}
      mode="recommend"
      canUndo
      onUndo={onUndo}
      onDismiss={vi.fn()}
    />
  );

  expect(
    screen.getByRole('region', { name: '智能补全结果' })
  ).toBeVisible();
  expect(screen.getByText('总体结论：可用但可改进')).toBeVisible();
  expect(screen.getByText('后排输出位保护不足')).toBeVisible();
  expect(screen.getByText('建议：调整郝昭到前排')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '撤销智能补全' }));
  expect(onUndo).toHaveBeenCalledTimes(1);
});

test('honestly reports a stopped graph and unavailable review', () => {
  render(
    <AgentReviewPanel
      result={{
        ...result,
        status: 'incomplete',
        stoppedAt: 'skills',
        review: {
          ...result.review!,
          status: 'unavailable',
          verdict: null,
          teams: [],
        },
      }}
      mode="recommend"
      canUndo={false}
      onUndo={vi.fn()}
      onDismiss={vi.fn()}
    />
  );

  expect(screen.getByText(/“战法补全”阶段/)).toBeVisible();
  expect(screen.getByText(/本次复盘没有得到通过校验/)).toBeVisible();
});
