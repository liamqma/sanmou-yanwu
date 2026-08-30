import { useState, type ReactNode } from 'react';
import { Box, Chip, Typography, Tooltip, ClickAwayListener, type ChipProps } from '@mui/material';
import { formatHeroDisplay, formatSkillDisplay } from '../../utils/itemMetadata';
import type { HeroMeta, SkillMeta } from '../../types/game';
import GameCardArt from './GameCardArt';

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
  horizontal?: boolean;
}

/**
 * Display selected items as chips with remove functionality and optional tooltips
 */
const TagList = ({ items, onRemove, label, color = 'primary', editable = true, showTooltips = false, getTooltipContent, tooltipTrigger = 'hover', highlightItems = [], highlightLabel = '⭐支援', highlightColor = 'warning', onRemoveHighlight, heroMetadata = null, skillMetadata = null, horizontal = false }: TagListProps) => {
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

    const usesCardArt = Boolean(heroMetadata || skillMetadata);
    const chip = usesCardArt ? (
      <Box
        key={`${item}-${index}`}
        onClick={tooltipTrigger === 'click' && showTooltips && getTooltipContent ? () => handleTooltipToggle(item) : undefined}
        sx={{ width: horizontal ? 148 : { xs: 'calc(50% - 4px)', sm: 154 }, flex: horizontal ? '0 0 148px' : undefined, minWidth: 0, position: 'relative' }}
      >
        <GameCardArt
          name={item}
          kind={heroMetadata ? 'hero' : 'tactic'}
          size="mini"
          support={isHighlighted}
          onRemove={chipOnDelete}
        />
        {isHighlighted && (
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              zIndex: 3,
              top: 4,
              left: 4,
              maxWidth: 'calc(100% - 42px)',
              px: 0.5,
              color: '#ffe0a6',
              bgcolor: 'rgba(73,43,22,.9)',
              border: '1px solid #bd7b3d',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {chipLabel}
          </Typography>
        )}
      </Box>
    ) : (
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
          flexWrap: horizontal ? 'nowrap' : 'wrap',
          overflowX: horizontal ? 'auto' : 'visible',
          scrollSnapType: horizontal ? 'x proximity' : 'none',
          '& > *': { scrollSnapAlign: 'start' },
          gap: 1,
          minHeight: 40,
          p: 1,
          border: '1px dashed',
          borderColor: 'divider',
          bgcolor: 'rgba(4,10,9,0.28)',
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
