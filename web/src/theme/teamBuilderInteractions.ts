import type { SxProps, Theme } from '@mui/material';

export const TEAM_BUILDER_TOUCH_TARGET_SIZE = 44;

export const teamBuilderInteractionPolicy = {
  '& .MuiButtonBase-root': {
    minWidth: TEAM_BUILDER_TOUCH_TARGET_SIZE,
    minHeight: TEAM_BUILDER_TOUCH_TARGET_SIZE,
  },
  '& .MuiChip-root.MuiChip-deletable': {
    minWidth: TEAM_BUILDER_TOUCH_TARGET_SIZE,
    minHeight: TEAM_BUILDER_TOUCH_TARGET_SIZE,
  },
  '& .MuiChip-deleteIcon': {
    boxSizing: 'content-box',
    width: 18,
    height: 18,
    padding: `${(TEAM_BUILDER_TOUCH_TARGET_SIZE - 18) / 2}px`,
    margin: '0 !important',
    flexShrink: 0,
  },
} satisfies SxProps<Theme>;
