#!/usr/bin/env python3
"""
Batch process images from ./data/images directory and save results to ./data/battles
Only saves battles with successful fuzzy matches, reports and removes processed images
"""

import os
import glob
from skill_extraction_system import SkillExtractionSystem


def batch_extract_battles(interactive: bool = True):
    """Extract skills from all images in ./data/images and save to ./data/battles
    If interactive=True, prompts user to resolve low-confidence skills.
    Raises ValueError if any hero mapping is missing (data integrity issue).
    """
    
    # Initialize the extraction system
    print("Initializing Skill Extraction System...")
    extractor = SkillExtractionSystem()

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
    images_to_remove = []  # images that should be removed due to failures or fuzzy match issues
    
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
            # Note: extract_skills_from_image will raise ValueError if battle is a draw (平)
            results = extractor.extract_skills_from_image(image_path, verbose=True, interactive=interactive)
            
            # Check for fuzzy match failures
            fuzzy_failures = results.get('fuzzy_match_failures', [])
            
            if fuzzy_failures:
                reason_text = f"{len(fuzzy_failures)} fuzzy match failures"
                
                # Don't save if there are issues; mark for removal
                print(f"✗ Skipping save due to: {reason_text}")
                unsaved_images.append({
                    'image': image_name,
                    'path': image_path,
                    'reason': reason_text,
                    'failures': fuzzy_failures
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
                # Save the results since all fuzzy matches succeeded
                extractor.save_results(results, output_path)

                # Immediately remove the image after successful save
                try:
                    os.remove(image_path)
                    print(f"🗑️  Removed source image after save: {image_path}")
                except Exception as re:
                    print(f"⚠️  Saved JSON but failed to remove image {image_path}: {re}")
                
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
            
        except ValueError as e:
            error_msg = str(e)
            # Check if this is a draw (should be discarded)
            if "draw" in error_msg.lower() or "平" in error_msg:
                print(f"✗ Draw detected - discarding battle: {image_path}")
                unsaved_images.append({
                    'image': os.path.basename(image_path),
                    'path': image_path,
                    'reason': 'draw (discarded)',
                    'failures': []
                })
                
                results_summary.append({
                    'image': os.path.basename(image_path),
                    'output': 'discarded',
                    'skills': 0,
                    'heroes': 0,
                    'winner': 'draw',
                    'status': 'draw (discarded)'
                })
                
                # Remove the image immediately
                try:
                    os.remove(image_path)
                    print(f"🗑️  Removed image after draw detection: {image_path}")
                except Exception as re:
                    print(f"⚠️  Failed to remove image {image_path}: {re}")
            elif "普攻" in error_msg:
                # A 普攻 (basic attack) was detected for some skill slot - discard the battle.
                print(f"✗ 普攻 detected - discarding battle: {image_path}")
                unsaved_images.append({
                    'image': os.path.basename(image_path),
                    'path': image_path,
                    'reason': '普攻 detected (discarded)',
                    'failures': []
                })

                results_summary.append({
                    'image': os.path.basename(image_path),
                    'output': 'discarded',
                    'skills': 0,
                    'heroes': 0,
                    'winner': 'unknown',
                    'status': '普攻 (discarded)'
                })

                # Remove the image immediately
                try:
                    os.remove(image_path)
                    print(f"🗑️  Removed image after 普攻 detection: {image_path}")
                except Exception as re:
                    print(f"⚠️  Failed to remove image {image_path}: {re}")
            else:
                # Other ValueError (e.g., image load failure, unknown hero, empty OCR)
                print(f"✗ Error processing {image_path}: {e}")
                unsaved_images.append({
                    'image': os.path.basename(image_path),
                    'path': image_path,
                    'reason': f'error: {error_msg}',
                    'failures': []
                })
                
                results_summary.append({
                    'image': os.path.basename(image_path),
                    'output': 'failed',
                    'skills': 0,
                    'heroes': 0,
                    'winner': 'unknown',
                    'status': f'error: {error_msg}'
                })
                
                # Remove the image immediately
                try:
                    os.remove(image_path)
                    print(f"🗑️  Removed image after error: {image_path}")
                except Exception as re:
                    print(f"⚠️  Failed to remove image {image_path}: {re}")
        except Exception as e:
            print(f"✗ Error processing {image_path}: {e}")
            unsaved_images.append({
                'image': os.path.basename(image_path),
                'path': image_path,
                'reason': f'error: {str(e)}',
                'failures': []
            })
            
            results_summary.append({
                'image': os.path.basename(image_path),
                'output': 'failed',
                'skills': 0,
                'heroes': 0,
                'winner': 'unknown',
                'status': f'error: {str(e)}'
            })
            
            # Remove the image immediately
            try:
                os.remove(image_path)
                print(f"🗑️  Removed image after error: {image_path}")
            except Exception as re:
                print(f"⚠️  Failed to remove image {image_path}: {re}")
    
    # Final summary
    print("\n" + "="*60)
    print("BATCH EXTRACTION COMPLETE")
    print("="*60)
    
    successful = len(successfully_saved_images)
    skipped = sum(1 for r in results_summary if r['status'].startswith('skipped:'))
    discarded_draws = sum(1 for r in results_summary if r['status'] == 'draw (discarded)')
    discarded_basic = sum(1 for r in results_summary if r['status'] == '普攻 (discarded)')
    discarded = discarded_draws + discarded_basic
    failed = len(results_summary) - successful - skipped - discarded
    
    print(f"Total images processed: {len(results_summary)}")
    print(f"Successfully saved: {successful}")
    print(f"Skipped (issues): {skipped}")
    print(f"Discarded (draws): {discarded_draws}")
    print(f"Discarded (普攻): {discarded_basic}")
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
    
    # Images with fuzzy-match issues are kept (not deleted) so you can fix the
    # hero/skill mappings and rerun the extraction against them.
    if images_to_remove:
        print(f"\n🗂️  Keeping {len(images_to_remove)} images with issues so you can fix mappings and rerun.")

    # Images are now removed immediately after successful save, so nothing to do here
    return {
        'summary': results_summary,
        'successfully_saved': successfully_saved_images,
        'unsaved': unsaved_images
    }

if __name__ == "__main__":
    batch_extract_battles()