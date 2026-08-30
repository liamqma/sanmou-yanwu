import { useState, type ReactNode } from 'react';
import { Box, ButtonBase, Chip, Typography, Tooltip, ClickAwayListener, type ChipProps } from '@mui/material';
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
  columns?: number;
  leadingAction?: {
    item: string;
    label: string;
    badge: string;
    onClick: () => void;
    disabled?: boolean;
  };
}

/**
 * Display selected items as chips with remove functionality and optional tooltips
 */
const TagList = ({ items, onRemove, label, color = 'primary', editable = true, showTooltips = false, getTooltipContent, tooltipTrigger = 'hover', highlightItems = [], highlightLabel = '⭐支援', highlightColor = 'warning', onRemoveHighlight, heroMetadata = null, skillMetadata = null, horizontal = false, columns, leadingAction }: TagListProps) => {
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const usesCardArt = Boolean(heroMetadata || skillMetadata);

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

    const chip = usesCardArt ? (
      <Box
        key={`${item}-${index}`}
        onClick={tooltipTrigger === 'click' && showTooltips && getTooltipContent ? () => handleTooltipToggle(item) : undefined}
        sx={{ width: '100%', minWidth: 0, position: 'relative' }}
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
              maxWidth: 'calc(100% - 38px)',
              px: 0.5,
              color: '#fffaf0',
              bgcolor: 'rgba(168,57,47,.92)',
              border: '1px solid rgba(255,255,255,.48)',
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
        data-testid={usesCardArt ? 'game-card-list' : undefined}
        data-card-layout={usesCardArt ? 'portrait-grid' : undefined}
        sx={{
          display: usesCardArt ? 'grid' : 'flex',
          gridTemplateColumns: usesCardArt
            ? columns
              ? `repeat(${columns}, minmax(0, 1fr))`
              : horizontal
              ? 'repeat(auto-fill, minmax(64px, 1fr))'
              : 'repeat(auto-fill, minmax(76px, 96px))'
            : undefined,
          '& > *': usesCardArt && columns ? { width: '100%', maxWidth: 96 } : undefined,
          flexWrap: usesCardArt ? undefined : 'wrap',
          alignItems: 'start',
          justifyContent: 'start',
          gap: 1,
          minHeight: 40,
          p: 1,
          border: '1px dashed',
          borderColor: 'divider',
          bgcolor: 'rgba(255,253,247,.72)',
          backgroundImage: usesCardArt
            ? 'linear-gradient(180deg, rgba(163,129,71,.055), transparent)'
            : undefined,
        }}
      >
        {leadingAction && (
          <ButtonBase
            aria-label={leadingAction.label}
            onClick={leadingAction.onClick}
            disabled={leadingAction.disabled}
            sx={{
              width: '100%',
              minWidth: 0,
              display: 'block',
              position: 'relative',
              textAlign: 'inherit',
              opacity: leadingAction.disabled ? 0.55 : 1,
              '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            }}
          >
            <GameCardArt
              name={leadingAction.item}
              kind={heroMetadata ? 'hero' : 'tactic'}
              size="mini"
            />
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                zIndex: 3,
                top: 4,
                left: 4,
                maxWidth: 'calc(100% - 8px)',
                px: 0.5,
                color: '#fffaf0',
                bgcolor: 'rgba(168,57,47,.92)',
                border: '1px solid rgba(255,255,255,.48)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {leadingAction.badge}
            </Typography>
          </ButtonBase>
        )}
        {items.length === 0 && !leadingAction ? (
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
