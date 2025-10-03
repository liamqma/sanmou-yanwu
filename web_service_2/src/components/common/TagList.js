import React from 'react';
import { Box, Chip, Typography } from '@mui/material';

/**
 * Display selected items as chips with remove functionality
 */
const TagList = ({ items, onRemove, label, color = 'primary', editable = true }) => {
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
          items.map((item, index) => (
            <Chip
              key={`${item}-${index}`}
              label={item}
              color={color}
              onDelete={editable && onRemove ? () => onRemove(item) : undefined}
              sx={{
                fontWeight: 500,
              }}
            />
          ))
        )}
      </Box>
    </Box>
  );
};

export default TagList;
