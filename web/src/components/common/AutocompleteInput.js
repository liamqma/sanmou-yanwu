import React, { useState } from 'react';
import { Autocomplete, TextField, Box } from '@mui/material';
import { usePinyin } from '../../hooks/usePinyin';

/**
 * Reusable autocomplete input with pinyin support
 */
const AutocompleteInput = ({
  items = [],
  selectedItems = [],
  onAdd,
  label,
  placeholder,
  disabled = false,
  maxItems = null,
}) => {
  const [inputValue, setInputValue] = useState('');
  const { toPinyin, filterByPinyin } = usePinyin();

  const handleSelect = (event, value) => {
    if (value && !selectedItems.includes(value)) {
      if (maxItems && selectedItems.length >= maxItems) {
        return; // Don't add if max reached
      }
      onAdd(value);
      setInputValue('');
    }
  };

  const availableItems = items.filter(item => !selectedItems.includes(item));

  return (
    <Autocomplete
      options={availableItems}
      value={null}
      inputValue={inputValue}
      onInputChange={(event, newInputValue) => {
        setInputValue(newInputValue);
      }}
      onChange={handleSelect}
      disabled={disabled || (maxItems && selectedItems.length >= maxItems)}
      filterOptions={(options, state) => {
        if (!state.inputValue) return [];
        return filterByPinyin(options, state.inputValue).slice(0, 10);
      }}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        const py = toPinyin(option);
        const showPinyin = py !== option.toLowerCase();
        
        return (
          <Box component="li" key={key} {...otherProps}>
            <span style={{ fontWeight: 'bold' }}>{option}</span>
            {showPinyin && (
              <span style={{ marginLeft: 8, fontSize: '0.85rem', color: '#718096' }}>
                ({py})
              </span>
            )}
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          variant="outlined"
          fullWidth
          sx={{ minWidth: 250 }}
        />
      )}
      noOptionsText={inputValue ? "No matches found" : "Start typing..."}
    />
  );
};

export default AutocompleteInput;
