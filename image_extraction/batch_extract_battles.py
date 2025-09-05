#!/usr/bin/env python3
"""
Batch process images from ./data/images directory and save results to ./data/battles
Only saves battles with successful fuzzy matches, reports and removes processed images
"""

import os
import glob
from skill_extraction_system import SkillExtractionSystem

import argparse

def batch_extract_battles(interactive: bool = True):
    """Extract skills from all images in ./data/images and save to ./data/battles
    If interactive=True, prompts user to resolve unmapped heroes and low-confidence skills.
    """
    
    # Initialize the extraction system
    print("Initializing Skill Extraction System...")
    extractor = SkillExtractionSystem()

    # Control whether to delete images that had issues (fuzzy/unmapped). Default: keep them for rerun.
    remove_images_with_issues = False
    
    # Find all images in ./data/images directory
    image_extensions = ['*.jpg', '*.jpeg', '*.png', '*.PNG', '*.JPG', '*.JPEG']
    image_files = []
    
    for ext in image_extensions:
        image_files.extend(glob.glob(os.path.join('data', 'images', ext)))
    
    image_files.sort()  # Sort for consistent processing order
    
    print(f"Found {len(image_files)} images to process:")
    for img in image_files:
        print(f"  - {img}")
    
    print("\n" + "="*60)
    print("BATCH EXTRACTION STARTED")
    print("="*60)
    
    # Process each image
    results_summary = []
    successfully_saved_images = []
    unsaved_images = []
    images_to_remove = []  # images that should be removed due to failures or unmapped skills
    
    for i, image_path in enumerate(image_files, 1):
        try:
            # Generate output filename
            image_name = os.path.basename(image_path)
            name_without_ext = os.path.splitext(image_name)[0]
            os.makedirs(os.path.join('data', 'battles'), exist_ok=True)
            output_path = os.path.join('data', 'battles', f'{name_without_ext}.json')
            
            print(f"\n[{i}/{len(image_files)}] Processing: {image_path}")
            print("-" * 50)
            
            # Extract skills, heroes, and winner (but don't save yet)
            results = extractor.extract_skills_from_image(image_path, verbose=True, interactive=interactive)
            
            # Check for fuzzy match failures and unmapped heroes
            fuzzy_failures = results.get('fuzzy_match_failures', [])
            unmapped_heroes = results.get('unmapped_heroes', [])
            
            if fuzzy_failures or unmapped_heroes:
                reasons = []
                if fuzzy_failures:
                    reasons.append(f"{len(fuzzy_failures)} fuzzy match failures")
                if unmapped_heroes:
                    reasons.append(f"{len(unmapped_heroes)} unmapped heroes (first skills not in hero map)")
                reason_text = ", ".join(reasons)
                
                # Don't save if there are issues; mark for removal
                print(f"✗ Skipping save due to: {reason_text}")
                unsaved_images.append({
                    'image': image_name,
                    'path': image_path,
                    'reason': reason_text,
                    'failures': fuzzy_failures,
                    'unmapped_heroes': unmapped_heroes
                })
                images_to_remove.append(image_path)
                
                results_summary.append({
                    'image': image_name,
                    'output': 'skipped',
                    'skills': 0,
                    'heroes': 0,
                    'winner': 'unknown',
                    'status': f'skipped: {reason_text}'
                })
            else:
                # Save the results since all fuzzy matches succeeded and heroes are mapped
                extractor.save_results(results, output_path)
                
                # Summary for this image
                total_skills = sum(len(hero['skills']) for team in results.values() if isinstance(team, list) for hero in team)
                total_heroes = sum(len(team) for team in results.values() if isinstance(team, list))
                winner = results.get('winner', 'unknown')
                
                successfully_saved_images.append(image_path)
                
                results_summary.append({
                    'image': image_name,
                    'output': output_path,
                    'skills': total_skills,
                    'heroes': total_heroes,
                    'winner': winner,
                    'status': 'success'
                })
                
                print(f"✓ Successfully processed and saved: {total_skills} skills, {total_heroes} heroes, winner: Team {winner}")
            
        except Exception as e:
            print(f"✗ Error processing {image_path}: {e}")
            unsaved_images.append({
                'image': os.path.basename(image_path),
                'path': image_path,
                'reason': f'error: {str(e)}',
                'failures': []
            })
            images_to_remove.append(image_path)
            
            results_summary.append({
                'image': os.path.basename(image_path),
                'output': 'failed',
                'skills': 0,
                'heroes': 0,
                'winner': 'unknown',
                'status': f'error: {str(e)}'
            })
    
    # Final summary
    print("\n" + "="*60)
    print("BATCH EXTRACTION COMPLETE")
    print("="*60)
    
    successful = len(successfully_saved_images)
    skipped = sum(1 for r in results_summary if r['status'].startswith('skipped:'))
    failed = len(results_summary) - successful - skipped
    
    print(f"Total images processed: {len(results_summary)}")
    print(f"Successfully saved: {successful}")
    print(f"Skipped (issues): {skipped}")
    print(f"Failed (errors): {failed}")
    
    if successful > 0:
        print(f"\nResults saved to ./data/battles/ directory:")
        for result in results_summary:
            if result['status'] == 'success':
                print(f"  ✓ {result['image']} → {result['output']} (Team {result['winner']} wins)")
    
    # Report unsaved images with details
    if unsaved_images:
        print(f"\n⚠ UNSAVED IMAGES ({len(unsaved_images)}):")
        for unsaved in unsaved_images:
            print(f"  ✗ {unsaved['image']}: {unsaved['reason']}")
            if unsaved['failures']:
                for failure in unsaved['failures']:
                    print(f"      - Team {failure['team']}, Hero {failure['hero']}, Skill {failure['skill']}: '{failure['raw_text']}' (confidence: {failure['confidence']:.3f})")
    
    # Remove images with issues (unmapped or fuzzy failures) if configured
    if remove_images_with_issues and images_to_remove:
        print(f"\n🗑️  REMOVING IMAGES WITH ISSUES ({len(images_to_remove)}):")
        for image_path in images_to_remove:
            try:
                os.remove(image_path)
                print(f"  ✓ Removed (issue): {image_path}")
            except Exception as e:
                print(f"  ✗ Failed to remove {image_path}: {e}")
    else:
        if images_to_remove:
            print(f"\n🗂️  Keeping {len(images_to_remove)} images with issues so you can fix mappings and rerun.")
    
    # Remove successfully saved images
    if successfully_saved_images:
        print(f"\n🗑️  REMOVING SUCCESSFULLY PROCESSED IMAGES ({len(successfully_saved_images)}):")
        for image_path in successfully_saved_images:
            try:
                os.remove(image_path)
                print(f"  ✓ Removed: {image_path}")
            except Exception as e:
                print(f"  ✗ Failed to remove {image_path}: {e}")
    
    return {
        'summary': results_summary,
        'successfully_saved': successfully_saved_images,
        'unsaved': unsaved_images
    }

if __name__ == "__main__":
    batch_extract_battles()