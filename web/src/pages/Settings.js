import React from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControlLabel,
  Switch,
  Stack,
  Divider,
  Button,
  Chip,
} from '@mui/material';
import { useGame } from '../context/GameContext';

/**
 * App-wide settings page.
 *
 * Currently exposes:
 *  - AI 提示词增量模式 (incremental prompt mode)
 *  - A read-only summary of the current AI session "seen" context, with a
 *    button to reset it independently of full game progress.
 */
const Settings = () => {
  const { state, dispatch } = useGame();
  const settings = state.settings || {};
  const seen = state.seenContext || {};

  const handleToggleIncremental = (event) => {
    dispatch({
      type: 'UPDATE_SETTINGS',
      settings: { incrementalPrompt: event.target.checked },
    });
  };

  const handleResetSeen = () => {
    if (window.confirm('确定要重置 AI 会话上下文吗？下一次复制提示词将重新提供完整说明。')) {
      dispatch({ type: 'RESET_SEEN_CONTEXT' });
    }
  };

  const seenHeroCount = (seen.seenHeroes || []).length;
  const seenSkillCount = (seen.seenSkills || []).length;
  const seenBondCount = (seen.seenBondIds || []).length;
  const hasSeenAny = seen.staticShown || seenHeroCount + seenSkillCount + seenBondCount > 0;

  return (
    <Box sx={{ py: 3 }}>
      <Paper sx={{ p: 4, mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          ⚙️ 设置
        </Typography>
        <Typography variant="body2" color="text.secondary">
          自定义 AI 提示词的生成方式和其他应用偏好。
        </Typography>
      </Paper>

      <Paper sx={{ p: 4, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          AI 提示词
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={!!settings.incrementalPrompt}
                onChange={handleToggleIncremental}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="subtitle1">增量模式（节省 token）</Typography>
                <Typography variant="body2" color="text.secondary">
                  开启后，从第二轮开始，复制的提示词将省略前轮已经提供的武将/战法说明、阵型与
                  buff 参考、玩家通用心得以及评估规则，只发送本轮新增的信息。
                  适合在同一个 AI 会话中连续使用，可显著减少 token 开销。
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  提示：点击导航栏的「🔄 重置进度」会同时重置 AI 会话上下文。
                  开启增量模式后请务必在新的 AI 会话开始时重置一次。
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start', m: 0 }}
          />
        </Stack>
      </Paper>

      <Paper sx={{ p: 4 }}>
        <Typography variant="h6" gutterBottom>
          AI 会话上下文
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          已记录在当前 AI 会话中提供过的武将、战法和羁绊。增量模式下，这些条目不会再次发送完整说明。
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
          <Chip label={`已见武将: ${seenHeroCount}`} size="small" />
          <Chip label={`已见战法: ${seenSkillCount}`} size="small" />
          <Chip label={`已见羁绊: ${seenBondCount}`} size="small" />
          <Chip
            label={seen.staticShown ? '已发送过静态参考' : '尚未发送静态参考'}
            color={seen.staticShown ? 'success' : 'default'}
            size="small"
          />
        </Stack>

        <Button
          variant="outlined"
          color="warning"
          onClick={handleResetSeen}
          disabled={!hasSeenAny}
        >
          重置 AI 会话上下文
        </Button>
      </Paper>
    </Box>
  );
};

export default Settings;
