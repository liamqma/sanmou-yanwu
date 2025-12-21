#!/usr/bin/env python3
"""
Check for duplicate images in the data/images directory.
Uses image content comparison to detect images with the same content.
"""

import os
import sys
from PIL import Image
import hashlib
from collections import defaultdict

def get_image_signature(image_path):
    """Get a signature of an image by resizing and hashing pixel data."""
    try:
        with Image.open(image_path) as img:
            # Convert to RGB if needed
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            # Resize to a standard size for comparison (faster)
            img = img.resize((256, 256), Image.Resampling.LANCZOS)
            
            # Get pixel data and create hash
            pixel_data = img.tobytes()
            return hashlib.md5(pixel_data).hexdigest()
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def images_are_identical(img1_path, img2_path):
    """Compare two images pixel by pixel to check if they're identical."""
    try:
        with Image.open(img1_path) as img1, Image.open(img2_path) as img2:
            # Check dimensions first
            if img1.size != img2.size:
                return False
            
            # Convert to RGB if needed
            if img1.mode != 'RGB':
                img1 = img1.convert('RGB')
            if img2.mode != 'RGB':
                img2 = img2.convert('RGB')
            
            # Compare pixel by pixel
            return list(img1.getdata()) == list(img2.getdata())
    except Exception as e:
        print(f"Error comparing {img1_path} and {img2_path}: {e}")
        return False

def find_duplicates(image_dir):
    """Find duplicate images based on content comparison."""
    image_files = []
    
    # Get all PNG files
    for filename in os.listdir(image_dir):
        if filename.lower().endswith('.png'):
            image_files.append(os.path.join(image_dir, filename))
    
    print(f"Found {len(image_files)} image files")
    print("Computing image signatures...")
    
    # Compute signatures for all images
    signature_to_files = defaultdict(list)
    
    for i, image_path in enumerate(image_files):
        if (i + 1) % 10 == 0:
            print(f"Processed {i + 1}/{len(image_files)} images...")
        
        signature = get_image_signature(image_path)
        if signature is not None:
            signature_to_files[signature].append(image_path)
    
    print(f"\nCompleted processing {len(image_files)} images")
    print("\nChecking for duplicates...\n")
    
    # Find potential duplicates (same signature)
    potential_duplicates = []
    for signature, files in signature_to_files.items():
        if len(files) > 1:
            potential_duplicates.append(files)
    
    # Verify potential duplicates are actually identical
    duplicates_found = False
    duplicate_groups = []
    
    for files in potential_duplicates:
        # Compare all pairs to confirm they're identical
        confirmed_duplicates = [files[0]]  # Keep first file as reference
        
        for candidate in files[1:]:
            if images_are_identical(files[0], candidate):
                confirmed_duplicates.append(candidate)
        
        if len(confirmed_duplicates) > 1:
            duplicates_found = True
            duplicate_groups.append(confirmed_duplicates)
            print(f"Duplicate group ({len(confirmed_duplicates)} files):")
            for file in confirmed_duplicates:
                filename = os.path.basename(file)
                file_size = os.path.getsize(file) / (1024 * 1024)  # MB
                print(f"  - {filename} ({file_size:.2f} MB)")
            print()
    
    if not duplicates_found:
        print("No duplicate images found!")
    else:
        print(f"\nSummary: Found {len(duplicate_groups)} duplicate group(s)")
        total_duplicates = sum(len(files) - 1 for files in duplicate_groups)
        print(f"Total duplicate files: {total_duplicates}")
    
    return duplicate_groups

if __name__ == "__main__":
    # Get script directory and find images directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    image_dir = os.path.join(script_dir, "images")
    
    if not os.path.exists(image_dir):
        print(f"Error: Images directory not found at {image_dir}")
        sys.exit(1)
    
    find_duplicates(image_dir)

