#!/usr/bin/env python3
"""
Batch process images from ./images directory and save results to ./battles
"""

import os
import glob
from skill_extraction_system import SkillExtractionSystem

def batch_extract_battles():
    """Extract skills from all images in ./images and save to ./battles"""
    
    # Initialize the extraction system
    print("Initializing Skill Extraction System...")
    extractor = SkillExtractionSystem()
    
    # Find all images in ./images directory
    image_extensions = ['*.jpg', '*.jpeg', '*.png', '*.PNG', '*.JPG', '*.JPEG']
    image_files = []
    
    for ext in image_extensions:
        image_files.extend(glob.glob(os.path.join('images', ext)))
    
    image_files.sort()  # Sort for consistent processing order
    
    print(f"Found {len(image_files)} images to process:")
    for img in image_files:
        print(f"  - {img}")
    
    print("\n" + "="*60)
    print("BATCH EXTRACTION STARTED")
    print("="*60)
    
    # Process each image
    results_summary = []
    
    for i, image_path in enumerate(image_files, 1):
        try:
            # Generate output filename
            image_name = os.path.basename(image_path)
            name_without_ext = os.path.splitext(image_name)[0]
            output_path = os.path.join('battles', f'{name_without_ext}.json')
            
            print(f"\n[{i}/{len(image_files)}] Processing: {image_path}")
            print("-" * 50)
            
            # Extract skills, heroes, and winner
            results = extractor.extract_and_save(image_path, output_path, verbose=True)
            
            # Summary for this image
            total_skills = sum(len(hero['skills']) for team in results.values() if isinstance(team, list) for hero in team)
            total_heroes = sum(len(team) for team in results.values() if isinstance(team, list))
            winner = results.get('winner', 'unknown')
            
            results_summary.append({
                'image': image_name,
                'output': output_path,
                'skills': total_skills,
                'heroes': total_heroes,
                'winner': winner,
                'status': 'success'
            })
            
            print(f"✓ Successfully processed: {total_skills} skills, {total_heroes} heroes, winner: Team {winner}")
            
        except Exception as e:
            print(f"✗ Error processing {image_path}: {e}")
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
    
    successful = sum(1 for r in results_summary if r['status'] == 'success')
    failed = len(results_summary) - successful
    
    print(f"Total images processed: {len(results_summary)}")
    print(f"Successful: {successful}")
    print(f"Failed: {failed}")
    
    if successful > 0:
        print(f"\nResults saved to ./battles/ directory:")
        for result in results_summary:
            if result['status'] == 'success':
                print(f"  ✓ {result['image']} → {result['output']} (Team {result['winner']} wins)")
    
    if failed > 0:
        print(f"\nFailed extractions:")
        for result in results_summary:
            if result['status'] != 'success':
                print(f"  ✗ {result['image']}: {result['status']}")
    
    return results_summary

if __name__ == "__main__":
    batch_extract_battles()