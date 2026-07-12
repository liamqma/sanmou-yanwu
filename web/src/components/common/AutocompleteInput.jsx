import React, { useState } from 'react';
import { Autocomplete, TextField, Box } from '@mui/material';
import { usePinyin } from '../../hooks/usePinyin';
import { formatHeroDisplay, formatHeroSearchText, formatSkillDisplay, formatSkillSearchText } from '../../utils/itemMetadata';

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
  heroMetadata = null,
  skillMetadata = null,
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
  const getDisplayText = (item) => {
    if (heroMetadata) return formatHeroDisplay(item, heroMetadata);
    if (skillMetadata) return formatSkillDisplay(item, skillMetadata);
    return item;
  };
  const getSearchText = (item) => {
    if (heroMetadata) return formatHeroSearchText(item, heroMetadata);
    if (skillMetadata) return formatSkillSearchText(item, skillMetadata);
    return item;
  };

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
        return filterByPinyin(options, state.inputValue, [], getSearchText).slice(0, 10);
      }}
      renderOption={(props, option) => {
        const { key, ...otherProps } = props;
        const displayText = getDisplayText(option);
        const py = toPinyin(option);
        const showPinyin = py !== option.toLowerCase();
        
        return (
          <Box component="li" key={key} {...otherProps}>
            <span style={{ fontWeight: 'bold' }}>{displayText}</span>
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
      noOptionsText={inputValue ? "无匹配结果" : "请输入..."}
    />
  );
};

export default AutocompleteInput;
