import React, { useState } from 'react';
import { Box, Chip, Typography, Tooltip, ClickAwayListener } from '@mui/material';

/**
 * Display selected items as chips with remove functionality and optional tooltips
 */
const TagList = ({ items, onRemove, label, color = 'primary', editable = true, showTooltips = false, getTooltipContent, tooltipTrigger = 'hover' }) => {
  const [openTooltip, setOpenTooltip] = useState(null);

  const handleTooltipToggle = (item) => {
    setOpenTooltip(openTooltip === item ? null : item);
  };

  const handleTooltipClose = () => {
    setOpenTooltip(null);
  };

  const renderChip = (item, index) => {
    const chip = (
      <Chip
        key={`${item}-${index}`}
        label={item}
        color={color}
        onDelete={editable && onRemove ? () => onRemove(item) : undefined}
        onClick={tooltipTrigger === 'click' && showTooltips && getTooltipContent ? () => handleTooltipToggle(item) : undefined}
        sx={{
          fontWeight: 500,
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
            No items selected
          </Typography>
        ) : (
          items.map((item, index) => renderChip(item, index))
        )}
      </Box>
    </Box>
  );
};

export default TagList;
