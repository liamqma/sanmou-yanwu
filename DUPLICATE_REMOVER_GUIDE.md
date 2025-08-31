# Duplicate Battle Remover Guide

## Overview
The `remove_duplicates.py` script identifies and removes duplicate battle files from the `./battles/` directory based on team compositions (heroes + skills).

## How It Works

### Duplicate Detection Logic
Two battles are considered duplicates if they have:
- **Same heroes** in both teams
- **Same skills** for each hero
- **Same team compositions** (regardless of team order)

### Smart Comparison
- **Normalized sorting**: Heroes and skills are sorted for consistent comparison
- **Team order agnostic**: (Team A vs Team B) = (Team B vs Team A)
- **Exact match required**: All heroes and skills must be identical

## Usage

### 1. Check for Duplicates (Dry Run)
```bash
python remove_duplicates.py
```
- **Safe operation**: Only analyzes, doesn't delete anything
- **Shows detailed analysis**: Lists all duplicate sets found
- **Provides summary**: Number of files that would be removed

### 2. Remove Duplicates
```bash
python remove_duplicates.py --remove
# or
python remove_duplicates.py -r
```
- **Confirmation required**: Asks for user confirmation before deleting
- **Keeps oldest file**: Preserves the first file in each duplicate set
- **Safe deletion**: Error handling for file removal issues

## Example Output

### No Duplicates Found
```
🔍 Battle Duplicate Remover
========================================
Scanning 10 battle files for duplicates...
✅ No duplicates found!
```

### Duplicates Found (Example)
```
🔍 Found 2 sets of duplicate battles:
============================================================

Duplicate Set 1: 3 identical battles
----------------------------------------
Team 1:
  • 诸葛亮: 草船借箭, 同舟共济, 挫锐折锋
  • 姜维: 九伐中原, 胜敌益强, 文武双全
  • 张飞: 万人之敌, 指点乾坤, 锐不可当

Team 2:
  • 司马懿: 鹰视狼顾, 谋而后动, 运智铺谋
  • 孙权: 虎踞江东, 忘私相助, 避其锐气
  • 黄盖: 苦肉计, 青囊急救, 烈火张天

Duplicate Files:
  • IMG_7826.json (855 bytes)
  • IMG_7830.json (855 bytes)
  • battle_001.json (860 bytes)

📊 Summary:
  • Duplicate sets: 2
  • Total files to remove: 3
  • Space savings: ~3 files
```

### Removal Process
```
🗑️ REMOVING DUPLICATES:
============================================================

Duplicate Set 1:
  ✅ KEEP: IMG_7826.json
  ✅ REMOVED: IMG_7830.json
  ✅ REMOVED: battle_001.json

✅ Successfully removed 2 duplicate files!
```

## Safety Features

### 🛡️ Built-in Protections
- **Dry run by default**: Never deletes without explicit `--remove` flag
- **User confirmation**: Requires "yes" confirmation before deletion
- **Error handling**: Graceful handling of file access issues
- **Detailed logging**: Shows exactly what will be/was removed

### 📋 File Preservation Strategy
- **Keeps first file**: Preserves the first file found in each duplicate set
- **Maintains chronology**: Usually keeps the oldest file
- **Preserves metadata**: Original file timestamps and permissions

## When to Use

### ✅ Good Use Cases
- **After batch processing**: Remove duplicates from multiple extraction runs
- **Storage cleanup**: Free up disk space from redundant battle data
- **Data quality**: Ensure clean dataset for AI analysis
- **Before analysis**: Clean data improves AI recommendation accuracy

### ⚠️ Consider Before Using
- **Backup important data**: Always backup before bulk deletion
- **Check file names**: Some "duplicates" might have different contexts
- **Verify results**: Review the analysis before confirming removal

## Integration with AI System

### Impact on Recommendations
- **Cleaner data**: Removes bias from duplicate battles in AI analysis
- **Better statistics**: More accurate win rates and meta analysis
- **Improved recommendations**: AI suggestions based on unique battles only

### Workflow
1. **Extract battles**: `python batch_extract_battles.py`
2. **Remove duplicates**: `python remove_duplicates.py --remove`
3. **Analyze meta**: `python ai_recommendation_system.py`
4. **Get recommendations**: `python game_advisor.py`

## Technical Details

### File Comparison Algorithm
```python
# Normalize team data for comparison
def normalize_team_data(team_data):
    normalized_heroes = []
    for hero in team_data:
        hero_name = hero['name']
        skills = tuple(sorted(hero['skills']))  # Sort skills
        normalized_heroes.append((hero_name, skills))
    
    # Sort heroes by name for consistency
    normalized_heroes.sort(key=lambda x: x[0])
    return tuple(normalized_heroes)
```

### Battle Signature Generation
- **Team normalization**: Both teams normalized independently
- **Team sorting**: Teams sorted to handle order variations
- **Tuple creation**: Immutable signature for dictionary keys
- **Hash comparison**: Fast duplicate detection using signatures

## Troubleshooting

### Common Issues
- **Permission errors**: Ensure write access to `./battles/` directory
- **JSON format errors**: Corrupted files are skipped with error messages
- **Empty directory**: Script handles missing `./battles/` directory gracefully

### Error Messages
- `❌ Error: battles directory not found!` - Create `./battles/` directory
- `Error reading file.json: ...` - Check JSON file format
- `ERROR removing file.json: ...` - Check file permissions