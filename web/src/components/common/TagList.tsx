import { useState, type ReactNode } from 'react';
import { Box, Chip, Typography, Tooltip, ClickAwayListener, type ChipProps } from '@mui/material';
import { formatHeroDisplay, formatSkillDisplay } from '../../utils/itemMetadata';
import type { HeroMeta, SkillMeta } from '../../types/game';

interface TagListProps {
  items: string[];
  onRemove?: (item: string) => void;
  label?: string;
  color?: ChipProps['color'];
  editable?: boolean;
  showTooltips?: boolean;
  getTooltipContent?: (item: string) => ReactNode;
  tooltipTrigger?: 'hover' | 'click';
  highlightItems?: string[];
  highlightLabel?: string;
  highlightColor?: ChipProps['color'];
  onRemoveHighlight?: (item: string) => void;
  heroMetadata?: Record<string, HeroMeta> | null;
  skillMetadata?: Record<string, SkillMeta> | null;
}

/**
 * Display selected items as chips with remove functionality and optional tooltips
 */
const TagList = ({ items, onRemove, label, color = 'primary', editable = true, showTooltips = false, getTooltipContent, tooltipTrigger = 'hover', highlightItems = [], highlightLabel = '⭐支援', highlightColor = 'warning', onRemoveHighlight, heroMetadata = null, skillMetadata = null }: TagListProps) => {
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  const handleTooltipToggle = (item: string) => {
    setOpenTooltip(openTooltip === item ? null : item);
  };

  const handleTooltipClose = () => {
    setOpenTooltip(null);
  };

  const highlightSet = new Set(Array.isArray(highlightItems) ? highlightItems : []);

  const renderChip = (item: string, index: number) => {
    const isHighlighted = highlightSet.has(item);
    const chipColor = isHighlighted ? highlightColor : color;
    const displayText = heroMetadata
      ? formatHeroDisplay(item)
      : skillMetadata
        ? formatSkillDisplay(item)
        : item;
    const chipLabel = isHighlighted ? `${highlightLabel} ${displayText}` : displayText;
    const chipOnDelete = isHighlighted
      ? (onRemoveHighlight ? () => onRemoveHighlight(item) : undefined)
      : (editable && onRemove ? () => onRemove(item) : undefined);

    const chip = (
      <Chip
        key={`${item}-${index}`}
        label={chipLabel}
        color={chipColor}
        variant={isHighlighted ? 'outlined' : 'filled'}
        onDelete={chipOnDelete}
        onClick={tooltipTrigger === 'click' && showTooltips && getTooltipContent ? () => handleTooltipToggle(item) : undefined}
        sx={{
          fontWeight: isHighlighted ? 700 : 500,
          borderStyle: isHighlighted ? 'dashed' : 'solid',
          borderWidth: isHighlighted ? 2 : undefined,
          cursor: tooltipTrigger === 'click' && showTooltips && getTooltipContent ? 'pointer' : 'default',
        }}
      />
    );

    // Wrap with tooltip if enabled and content provider is available
    if (showTooltips && getTooltipContent) {
      if (tooltipTrigger === 'click') {
        return (
          <ClickAwayListener key={`${item}-${index}`} onClickAway={handleTooltipClose}>
            <Tooltip
              title={getTooltipContent(item)}
              arrow
              placement="top"
              open={openTooltip === item}
              disableFocusListener
              disableHoverListener
              disableTouchListener
            >
              {chip}
            </Tooltip>
          </ClickAwayListener>
        );
      } else {
        return (
          <Tooltip
            key={`${item}-${index}`}
            title={getTooltipContent(item)}
            arrow
            placement="top"
            enterDelay={200}
            leaveDelay={100}
          >
            {chip}
          </Tooltip>
        );
      }
    }

    return chip;
  };

  return (
    <Box sx={{ mt: 1 }}>
      {label && (
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {label}
        </Typography>
      )}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          minHeight: 40,
          p: 1,
          border: '2px dashed',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        {items.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ p: 1 }}>
            未选择任何内容
          </Typography>
        ) : (
          items.map((item, index) => renderChip(item, index))
        )}
      </Box>
    </Box>
  );
};

export default TagList;
