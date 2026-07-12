import { Paper, Typography, Box, Grid, Alert } from '@mui/material';
import AutocompleteInput from '../common/AutocompleteInput';
import TagList from '../common/TagList';
import type { CurrentRoundInputs, SetName, RoundType, HeroMeta, SkillMeta } from '../../types/game';

interface OptionSetInputProps {
  roundType: RoundType;
  availableItems: string[];
  sets: CurrentRoundInputs;
  onUpdateSet: (setName: SetName, items: string[]) => void;
  disabled?: boolean;
  itemsPerSet?: number;
  heroMetadata?: Record<string, HeroMeta> | null;
  skillMetadata?: Record<string, SkillMeta> | null;
}

/**
 * Input for 3 option sets (each with 3 items)
 */
const OptionSetInput = ({
  roundType,
  availableItems,
  sets,
  onUpdateSet,
  disabled = false,
  itemsPerSet = 3,
  heroMetadata = null,
  skillMetadata = null
}: OptionSetInputProps) => {
  const itemColor = roundType === 'hero' ? 'primary' : 'secondary';

  const handleAddItem = (setName: SetName, item: string) => {
    const currentSet = sets[setName] || [];
    if (currentSet.length < itemsPerSet && !currentSet.includes(item)) {
      onUpdateSet(setName, [...currentSet, item]);
    }
  };

  const handleRemoveItem = (setName: SetName, item: string) => {
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

  const renderSetInput = (setName: SetName, setLabel: string) => {
    const currentSet = sets[setName] || [];
    const allSelected = getAllSelectedItems();

    return (
      <Grid size={{ xs: 12 }} key={setName}>
        <Box sx={{ 
          p: { xs: 1.75, sm: 2.25 },
          border: '1px solid',
          borderColor: 'divider',
          borderLeft: '4px solid',
          borderLeftColor: 'primary.main',
          height: '100%',
          display: { sm: 'grid' },
          gridTemplateColumns: { sm: '160px minmax(240px, 0.75fr) minmax(0, 1.25fr)' },
          alignItems: 'center',
          gap: 2,
          bgcolor: 'rgba(251,248,239,0.58)',
        }}>
          <Typography variant="h6" sx={{ mb: { xs: 1.5, sm: 0 } }}>
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
            heroMetadata={roundType === 'hero' ? heroMetadata : null}
            skillMetadata={roundType === 'skill' ? skillMetadata : null}
          />
          
          <TagList
            items={currentSet}
            onRemove={(item) => handleRemoveItem(setName, item)}
            color={itemColor}
            heroMetadata={roundType === 'hero' ? heroMetadata : null}
            skillMetadata={roundType === 'skill' ? skillMetadata : null}
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
    <Paper sx={{ p: { xs: 2.25, sm: 3 }, mb: 3, borderTop: '3px solid', borderTopColor: 'text.primary' }}>
      <Typography variant="overline" color="error.main">
        本轮候选
      </Typography>
      <Typography variant="h5" gutterBottom>
        填写三组选项
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        每组需恰好包含 {itemsPerSet} 个{roundType === 'hero' ? '武将' : '战法'}。将从这三组中选定一组。
      </Typography>
      
      {!allSetsComplete && (
        <Alert severity="info" sx={{ mb: 2 }}>
          请先完成三组选项，每组恰好 {itemsPerSet} 个{roundType === 'hero' ? '武将' : '战法'}，再获取推荐。
        </Alert>
      )}
      
      <Grid container spacing={1.5}>
        {renderSetInput('set1', '第 1 组')}
        {renderSetInput('set2', '第 2 组')}
        {renderSetInput('set3', '第 3 组')}
      </Grid>
    </Paper>
  );
};

export default OptionSetInput;
