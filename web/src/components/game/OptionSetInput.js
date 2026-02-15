import React from 'react';
import { Paper, Typography, Box, Grid, Alert } from '@mui/material';
import AutocompleteInput from '../common/AutocompleteInput';
import TagList from '../common/TagList';

/**
 * Input for 3 option sets (each with 3 items)
 */
const OptionSetInput = ({ 
  roundType, 
  availableItems, 
  sets, 
  onUpdateSet,
  disabled = false,
  itemsPerSet = 3
}) => {
  const itemColor = roundType === 'hero' ? 'primary' : 'secondary';
  
  const handleAddItem = (setName, item) => {
    const currentSet = sets[setName] || [];
    if (currentSet.length < itemsPerSet && !currentSet.includes(item)) {
      onUpdateSet(setName, [...currentSet, item]);
    }
  };
  
  const handleRemoveItem = (setName, item) => {
    const currentSet = sets[setName] || [];
    onUpdateSet(setName, currentSet.filter(i => i !== item));
  };
  
  // Get all selected items across all sets to filter out from autocomplete
  const getAllSelectedItems = () => {
    return [
      ...(sets.set1 || []),
      ...(sets.set2 || []),
      ...(sets.set3 || []),
    ];
  };

  const renderSetInput = (setName, setLabel) => {
    const currentSet = sets[setName] || [];
    const allSelected = getAllSelectedItems();
    
    return (
      <Grid item size={{ xs: 12, md: 4 }} key={setName}>
        <Box sx={{ 
          p: 2, 
          border: '2px solid',
          borderColor: 'divider',
          borderRadius: 2,
          height: '100%',
        }}>
          <Typography variant="h6" gutterBottom>
            {setLabel} ({currentSet.length}/{itemsPerSet})
          </Typography>
          
          <AutocompleteInput
            items={availableItems.filter(item => !allSelected.includes(item))}
            selectedItems={currentSet}
            onAdd={(item) => handleAddItem(setName, item)}
            label={roundType === 'hero' ? '添加武将...' : '添加战法...'}
            placeholder={roundType === 'hero' ? '搜索武将...' : '搜索战法...'}
            maxItems={itemsPerSet}
            disabled={disabled || currentSet.length >= itemsPerSet}
          />
          
          <TagList
            items={currentSet}
            onRemove={(item) => handleRemoveItem(setName, item)}
            color={itemColor}
          />
        </Box>
      </Grid>
    );
  };
  
  const allSetsComplete = 
    (sets.set1?.length === itemsPerSet) && 
    (sets.set2?.length === itemsPerSet) && 
    (sets.set3?.length === itemsPerSet);
  
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        🎯 填写三组选项
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        每组需恰好包含 {itemsPerSet} 个{roundType === 'hero' ? '武将' : '战法'}。将从这三组中选定一组。
      </Typography>
      
      {!allSetsComplete && (
        <Alert severity="info" sx={{ mb: 2 }}>
          请先完成三组选项，每组恰好 {itemsPerSet} 个{roundType === 'hero' ? '武将' : '战法'}，再获取推荐。
        </Alert>
      )}
      
      <Grid container spacing={2}>
        {renderSetInput('set1', '第 1 组')}
        {renderSetInput('set2', '第 2 组')}
        {renderSetInput('set3', '第 3 组')}
      </Grid>
    </Paper>
  );
};

export default OptionSetInput;
