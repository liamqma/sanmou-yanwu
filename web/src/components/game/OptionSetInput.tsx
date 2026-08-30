import { Paper, Typography, Box, Grid } from '@mui/material';
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
      <Grid size={{ xs: 12, md: 4 }} key={setName}>
        <Box sx={{ 
          p: { xs: 1.75, sm: 2.25 },
          border: '1px solid',
          borderColor: 'divider',
          borderLeft: '4px solid',
          borderLeftColor: roundType === 'hero' ? 'primary.main' : '#8b67b8',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 1.25,
          bgcolor: 'rgba(6,12,11,0.34)',
        }}>
          <Typography component="h3" variant="h6">
            {setLabel} ({currentSet.length}/{itemsPerSet})
          </Typography>
          
          <AutocompleteInput
            items={availableItems.filter(item => !allSelected.includes(item))}
            selectedItems={currentSet}
            onAdd={(item) => handleAddItem(setName, item)}
            label={roundType === 'hero' ? '输入武将名或拼音搜索武将' : '输入战法名或拼音搜索战法'}
            placeholder={roundType === 'hero' ? '输入武将名或拼音搜索武将' : '输入战法名或拼音搜索战法'}
            maxItems={itemsPerSet}
            disabled={disabled || currentSet.length >= itemsPerSet}
            heroMetadata={roundType === 'hero' ? heroMetadata : null}
            skillMetadata={roundType === 'skill' ? skillMetadata : null}
          />
          
          {currentSet.length > 0 && (
            <TagList
              items={currentSet}
              onRemove={(item) => handleRemoveItem(setName, item)}
              color={itemColor}
              heroMetadata={roundType === 'hero' ? heroMetadata : null}
              skillMetadata={roundType === 'skill' ? skillMetadata : null}
              columns={itemsPerSet}
            />
          )}
        </Box>
      </Grid>
    );
  };

  return (
    <Paper
      component="section"
      aria-label="本轮三组选项"
      sx={{
        p: { xs: 1.5, sm: 2 },
        mb: 2,
        bgcolor: 'rgba(10,15,14,.92)',
        boxShadow: 'inset 0 0 40px rgba(0,0,0,.28)',
      }}
    >
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="overline" color="error.main">本轮牌面</Typography>
        <Typography component="h2" variant="h5">录入三组选项</Typography>
      </Box>
      <Grid container spacing={1.5}>
        {renderSetInput('set1', '第 1 组')}
        {renderSetInput('set2', '第 2 组')}
        {renderSetInput('set3', '第 3 组')}
      </Grid>
    </Paper>
  );
};

export default OptionSetInput;
