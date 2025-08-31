#!/usr/bin/env python3
"""
Remove duplicate battle files from ./battles directory
Files are considered duplicates if they have the same heroes and skills for both teams
"""

import json
import os
import glob
from collections import defaultdict
from typing import Dict, List, Tuple, Set

def normalize_team_data(team_data: List[Dict]) -> Tuple:
    """
    Convert team data to a normalized tuple for comparison
    
    Args:
        team_data: List of hero dictionaries with name and skills
        
    Returns:
        Sorted tuple of (hero_name, sorted_skills_tuple) for consistent comparison
    """
    normalized_heroes = []
    
    for hero in team_data:
        hero_name = hero['name']
        skills = tuple(sorted(hero['skills']))  # Sort skills for consistent comparison
        normalized_heroes.append((hero_name, skills))
    
    # Sort heroes by name for consistent comparison
    normalized_heroes.sort(key=lambda x: x[0])
    
    return tuple(normalized_heroes)

def get_battle_signature(battle_data: Dict) -> Tuple:
    """
    Create a unique signature for a battle based on teams composition
    
    Args:
        battle_data: Battle JSON data
        
    Returns:
        Tuple representing the unique battle composition
    """
    team1_signature = normalize_team_data(battle_data['1'])
    team2_signature = normalize_team_data(battle_data['2'])
    
    # Sort teams to handle cases where team positions might be swapped
    # This ensures (TeamA vs TeamB) is same as (TeamB vs TeamA)
    teams = sorted([team1_signature, team2_signature])
    
    return tuple(teams)

def find_duplicates(battles_dir: str = 'battles') -> Dict[Tuple, List[str]]:
    """
    Find duplicate battle files
    
    Args:
        battles_dir: Directory containing battle JSON files
        
    Returns:
        Dictionary mapping battle signatures to list of file paths
    """
    battle_signatures = defaultdict(list)
    
    # Find all JSON files
    json_files = glob.glob(os.path.join(battles_dir, '*.json'))
    
    print(f"Scanning {len(json_files)} battle files for duplicates...")
    
    for file_path in json_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                battle_data = json.load(f)
            
            # Generate signature for this battle
            signature = get_battle_signature(battle_data)
            battle_signatures[signature].append(file_path)
            
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
    
    # Filter to only duplicates (signatures with multiple files)
    duplicates = {sig: files for sig, files in battle_signatures.items() if len(files) > 1}
    
    return duplicates

def analyze_duplicates(duplicates: Dict[Tuple, List[str]]) -> None:
    """
    Print detailed analysis of found duplicates
    
    Args:
        duplicates: Dictionary of duplicate battle signatures and their files
    """
    if not duplicates:
        print("✅ No duplicates found!")
        return
    
    print(f"\n🔍 Found {len(duplicates)} sets of duplicate battles:")
    print("=" * 60)
    
    total_duplicates = 0
    
    for i, (signature, files) in enumerate(duplicates.items(), 1):
        print(f"\nDuplicate Set {i}: {len(files)} identical battles")
        print("-" * 40)
        
        # Show team composition
        team1, team2 = signature
        
        print("Team 1:")
        for hero_name, skills in team1:
            skills_str = ", ".join(skills)
            print(f"  • {hero_name}: {skills_str}")
        
        print("Team 2:")
        for hero_name, skills in team2:
            skills_str = ", ".join(skills)
            print(f"  • {hero_name}: {skills_str}")
        
        print("\nDuplicate Files:")
        for file_path in files:
            file_size = os.path.getsize(file_path)
            print(f"  • {os.path.basename(file_path)} ({file_size} bytes)")
        
        total_duplicates += len(files) - 1  # Keep one, remove others
    
    print(f"\n📊 Summary:")
    print(f"  • Duplicate sets: {len(duplicates)}")
    print(f"  • Total files to remove: {total_duplicates}")
    print(f"  • Space savings: ~{total_duplicates} files")

def remove_duplicates(duplicates: Dict[Tuple, List[str]], dry_run: bool = True) -> int:
    """
    Remove duplicate files, keeping the first one in each set
    
    Args:
        duplicates: Dictionary of duplicate battle signatures and their files
        dry_run: If True, only show what would be removed without actually deleting
        
    Returns:
        Number of files removed
    """
    if not duplicates:
        return 0
    
    removed_count = 0
    
    print(f"\n{'🔍 DRY RUN - ' if dry_run else '🗑️  '}REMOVING DUPLICATES:")
    print("=" * 60)
    
    for i, (signature, files) in enumerate(duplicates.items(), 1):
        # Keep the first file (usually the oldest), remove the rest
        keep_file = files[0]
        remove_files = files[1:]
        
        print(f"\nDuplicate Set {i}:")
        print(f"  ✅ KEEP: {os.path.basename(keep_file)}")
        
        for file_path in remove_files:
            if dry_run:
                print(f"  🗑️  WOULD REMOVE: {os.path.basename(file_path)}")
            else:
                try:
                    os.remove(file_path)
                    print(f"  ✅ REMOVED: {os.path.basename(file_path)}")
                    removed_count += 1
                except Exception as e:
                    print(f"  ❌ ERROR removing {os.path.basename(file_path)}: {e}")
    
    if dry_run:
        print(f"\n💡 This was a dry run. Use --remove to actually delete files.")
        return len([f for files in duplicates.values() for f in files[1:]])
    else:
        print(f"\n✅ Successfully removed {removed_count} duplicate files!")
        return removed_count

def main():
    """Main function with command line interface"""
    import sys
    
    print("🔍 Battle Duplicate Remover")
    print("=" * 40)
    
    # Check if battles directory exists
    battles_dir = 'battles'
    if not os.path.exists(battles_dir):
        print(f"❌ Error: {battles_dir} directory not found!")
        return
    
    # Find duplicates
    duplicates = find_duplicates(battles_dir)
    
    # Analyze and show duplicates
    analyze_duplicates(duplicates)
    
    if not duplicates:
        return
    
    # Check command line arguments
    remove_flag = '--remove' in sys.argv or '-r' in sys.argv
    
    if remove_flag:
        # Confirm before removing
        print(f"\n⚠️  WARNING: This will permanently delete duplicate files!")
        confirm = input("Are you sure you want to continue? (yes/no): ").strip().lower()
        
        if confirm in ['yes', 'y']:
            removed = remove_duplicates(duplicates, dry_run=False)
            print(f"\n🎉 Cleanup complete! Removed {removed} duplicate files.")
        else:
            print("❌ Operation cancelled.")
    else:
        # Dry run by default
        would_remove = remove_duplicates(duplicates, dry_run=True)
        print(f"\n💡 Use 'python remove_duplicates.py --remove' to actually delete {would_remove} files.")

if __name__ == "__main__":
    main()