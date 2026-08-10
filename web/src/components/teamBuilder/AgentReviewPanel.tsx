import CloseIcon from '@mui/icons-material/Close';
import UndoIcon from '@mui/icons-material/Undo';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type {
  TeamAgentAssignment,
  TeamAgentResult,
  TeamAgentReviewWarning,
  TeamAgentVerdict,
} from '../../services/localTeamAgent';

export type TeamAgentRunMode = 'recommend' | 'review';

interface AgentReviewPanelProps {
  result: TeamAgentResult;
  mode: TeamAgentRunMode;
  canUndo: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}

const verdictText: Record<TeamAgentVerdict, string> = {
  sound: '整体合理',
  workable: '可用但可改进',
  needs_changes: '建议调整',
};

const stoppedAtText = {
  heroes: '武将补全',
  formations: '阵型与站位补全',
  skills: '战法补全',
} as const;

const assignmentTitle = (assignment: TeamAgentAssignment): string => {
  const location = `第 ${assignment.teamIndex + 1} 队`;
  if (assignment.hero) return `${location} · ${assignment.hero}`;
  if (assignment.formation) return `${location} · ${assignment.formation}`;
  if (assignment.skill) return `${location} · ${assignment.skill}`;
  return location;
};

const WarningList = ({
  warnings,
}: {
  warnings: TeamAgentReviewWarning[];
}) => (
  <Stack spacing={1}>
    {warnings.map((warning, index) => (
      <Alert
        severity={warning.severity === 'critical' ? 'error' : 'warning'}
        key={`${warning.category}-${warning.message}-${index}`}
      >
        <Typography variant="body2" fontWeight={800}>
          {warning.message}
        </Typography>
        <Typography variant="body2">建议：{warning.suggestedAction}</Typography>
        {warning.teamIndexes && (
          <Typography variant="caption" color="text.secondary">
            涉及队伍：{warning.teamIndexes.map((item) => item + 1).join('、')}
          </Typography>
        )}
      </Alert>
    ))}
  </Stack>
);

const AssignmentDetails = ({ result }: { result: TeamAgentResult }) => {
  const assignments = [
    ...result.heroAssignments,
    ...result.formationDecisions,
    ...result.skillAssignments,
  ];
  if (assignments.length === 0) return null;

  return (
    <Accordion disableGutters elevation={0}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography fontWeight={800}>
          Agent 选择依据（{assignments.length} 项）
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.25} divider={<Divider flexItem />}>
          {assignments.map((assignment, index) => (
            <Box key={`${assignmentTitle(assignment)}-${index}`}>
              <Typography variant="body2" fontWeight={800}>
                {assignmentTitle(assignment)}
              </Typography>
              <Typography variant="body2">{assignment.reason}</Typography>
              {assignment.evidence.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  证据：{assignment.evidence.join('、')}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
};

const AgentReviewPanel = ({
  result,
  mode,
  canUndo,
  onUndo,
  onDismiss,
}: AgentReviewPanelProps) => {
  const review = result.review;
  const crossWarnings = review
    ? [...review.deterministicRuleWarnings, ...review.crossTeamWarnings]
    : [];

  return (
    <Paper
      component="section"
      aria-label={mode === 'recommend' ? '智能补全结果' : '智能复盘结果'}
      aria-live="polite"
      data-testid="local-agent-result"
      sx={{ mt: 2, border: '1px solid', borderColor: 'divider', p: 2 }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="flex-start" gap={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={900}>
              {mode === 'recommend' ? '智能补全结果' : '智能复盘结果'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              调用次数：武将 {result.attempts.heroes} · 阵型{' '}
              {result.attempts.formations} · 战法 {result.attempts.skills} · 复盘{' '}
              {result.attempts.review}
            </Typography>
          </Box>
          <Chip
            size="small"
            color={result.status === 'complete' ? 'success' : 'warning'}
            label={result.status === 'complete' ? '已完成' : '未完整补全'}
          />
          {canUndo && (
            <Button size="small" startIcon={<UndoIcon />} onClick={onUndo}>
              撤销智能补全
            </Button>
          )}
          <IconButton size="small" aria-label="关闭智能结果" onClick={onDismiss}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {result.status === 'incomplete' && result.stoppedAt && (
          <Alert severity="warning">
            Agent 在“{stoppedAtText[result.stoppedAt]}”阶段没有得到通过校验的答案。
            已保留能够验证的结果，其余位置继续留空。
          </Alert>
        )}

        {result.warnings.map((warning, index) => (
          <Alert severity="warning" key={`${warning}-${index}`}>
            {warning}
          </Alert>
        ))}

        <AssignmentDetails result={result} />

        {review?.status === 'unavailable' && (
          <Alert severity="warning">
            阵容补全结果已保留，但本次复盘没有得到通过校验的模型输出。
          </Alert>
        )}

        {review?.status === 'complete' && review.verdict && (
          <>
            <Alert
              severity={
                review.verdict === 'sound'
                  ? 'success'
                  : review.verdict === 'workable'
                    ? 'info'
                    : 'warning'
              }
            >
              总体结论：{verdictText[review.verdict]}
            </Alert>

            {review.teams.map((team) => (
              <Accordion
                disableGutters
                elevation={0}
                key={team.teamIndex}
                defaultExpanded={team.warnings.length > 0}
                sx={{ border: '1px solid', borderColor: 'divider' }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography fontWeight={900}>
                      队伍 {team.teamIndex + 1}
                    </Typography>
                    <Chip size="small" label={verdictText[team.verdict]} />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.25}>
                    {team.strengths.map((strength, index) => (
                      <Alert
                        severity="success"
                        key={`${strength.category}-${strength.message}-${index}`}
                      >
                        {strength.message}
                      </Alert>
                    ))}
                    <WarningList warnings={team.warnings} />
                    {team.strengths.length === 0 && team.warnings.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        本队没有额外提示。
                      </Typography>
                    )}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}

            {crossWarnings.length > 0 && (
              <Box>
                <Typography fontWeight={900} sx={{ mb: 1 }}>
                  跨队与资源规则提醒
                </Typography>
                <WarningList warnings={crossWarnings} />
              </Box>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
};

export default AgentReviewPanel;
