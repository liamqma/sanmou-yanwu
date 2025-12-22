#!/usr/bin/env python3
"""
Remove duplicate battle files from data/battles directory.

A duplicate is defined as having:
- Same heroes for both teams (same position)
- Same skills for each hero (same position)
- Same order/position of heroes
"""

import json
import os
from collections import defaultdict

def find_duplicates(battles_dir: str):
    """Find duplicate battle groups based on hero composition and skills."""
    duplicates = defaultdict(list)
    battle_files = [f for f in os.listdir(battles_dir) if f.endswith('.json')]
    
    for filename in battle_files:
        filepath = os.path.join(battles_dir, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                battle = json.load(f)
            
            # Create a signature based on heroes and skills (by position)
            team1_heroes = []
            team2_heroes = []
            
            for hero in battle.get('1', []):
                hero_signature = {
                    'name': hero.get('name', ''),
                    'skills': hero.get('skills', [])
                }
                team1_heroes.append(hero_signature)
            
            for hero in battle.get('2', []):
                hero_signature = {
                    'name': hero.get('name', ''),
                    'skills': hero.get('skills', [])
                }
                team2_heroes.append(hero_signature)
            
            # Create a unique signature for this battle
            battle_signature = json.dumps({
                'team1': team1_heroes,
                'team2': team2_heroes
            }, sort_keys=False, ensure_ascii=False)
            
            duplicates[battle_signature].append(filename)
            
        except Exception as e:
            print(f"Error reading {filename}: {e}")
    
    # Find duplicate groups (more than 1 file with same signature)
    duplicate_groups = {sig: files for sig, files in duplicates.items() if len(files) > 1}
    return duplicate_groups

def remove_duplicates(battles_dir: str, dry_run: bool = False):
    """Remove duplicate battle files, keeping one file per duplicate group."""
    duplicate_groups = find_duplicates(battles_dir)
    
    if not duplicate_groups:
        print("No duplicates found!")
        return
    
    print(f"Found {len(duplicate_groups)} duplicate groups\n")
    
    total_removed = 0
    files_to_remove = []
    
    for i, (sig, files) in enumerate(duplicate_groups.items(), 1):
        # Sort files to keep the first one (alphabetically)
        sorted_files = sorted(files)
        keep_file = sorted_files[0]
        remove_files = sorted_files[1:]
        
        print(f"Duplicate Group {i} ({len(files)} files):")
        print(f"  ✓ Keeping: {keep_file}")
        for filename in remove_files:
            print(f"  ✗ Removing: {filename}")
            files_to_remove.append(filename)
        print()
        
        total_removed += len(remove_files)
    
    print(f"\nSummary:")
    print(f"  Duplicate groups: {len(duplicate_groups)}")
    print(f"  Files to remove: {total_removed}")
    print(f"  Files to keep: {len(duplicate_groups)}")
    
    if dry_run:
        print("\n[DRY RUN] No files were actually removed.")
        return
    
    # Remove duplicate files
    if files_to_remove:
        confirm = input(f"\nRemove {total_removed} duplicate files? (yes/no): ").strip().lower()
        if confirm == 'yes':
            removed_count = 0
            for filename in files_to_remove:
                filepath = os.path.join(battles_dir, filename)
                try:
                    os.remove(filepath)
                    removed_count += 1
                except Exception as e:
                    print(f"  ✗ Failed to remove {filename}: {e}")
            print(f"\n✓ Successfully removed {removed_count} duplicate files.")
        else:
            print("Cancelled. No files were removed.")

if __name__ == "__main__":
    import sys
    
    battles_dir = 'data/battles'
    dry_run = '--dry-run' in sys.argv or '-n' in sys.argv
    
    if not os.path.exists(battles_dir):
        print(f"Error: {battles_dir} directory not found!")
        sys.exit(1)
    
    if dry_run:
        print("=== DRY RUN MODE ===\n")
    
    remove_duplicates(battles_dir, dry_run=dry_run)

