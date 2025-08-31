#!/usr/bin/env python3
"""
Production-ready skill extraction system with hero mapping
Extracts skills from game images and maps heroes using first skill
"""

import json
import cv2
import numpy as np
from paddleocr import PaddleOCR
from difflib import SequenceMatcher
import os
from typing import Dict, List, Tuple, Optional

class SkillExtractionSystem:
    """Complete skill extraction system with OCR, fuzzy matching, and hero mapping"""
    
    def __init__(self, config_path: str = 'extraction_config.json', 
                 database_path: str = 'database.json'):
        """
        Initialize the extraction system
        
        Args:
            config_path: Path to extraction configuration JSON
            database_path: Path to skill database JSON
        """
        self.config = self._load_config(config_path)
        self.database = self._load_database(database_path)
        self.skill_list = self.database['skill']
        self.skill_hero_map = self.database['skill_hero_map']
        self.ocr = None
        
    def _load_config(self, config_path: str) -> Dict:
        """Load extraction configuration"""
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _load_database(self, database_path: str) -> Dict:
        """Load skill database"""
        with open(database_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _initialize_ocr(self):
        """Initialize PaddleOCR (lazy loading)"""
        if self.ocr is None:
            self.ocr = PaddleOCR(lang='ch')
    
    def fuzzy_match_skill(self, extracted_text: str, threshold: float = 0.5) -> Tuple[str, float]:
        """
        Find the best matching skill from database using fuzzy string matching
        
        Args:
            extracted_text: OCR extracted text
            threshold: Minimum similarity score (0.0 to 1.0)
            
        Returns:
            tuple: (best_match, confidence_score)
        """
        if not extracted_text.strip():
            return None, 0.0
        
        best_match = None
        best_score = 0.0
        
        for skill in self.skill_list:
            # Calculate similarity using SequenceMatcher
            similarity = SequenceMatcher(None, extracted_text, skill).ratio()
            
            # Bonus for substring matches
            if extracted_text in skill:
                substring_bonus = len(extracted_text) / len(skill)
                similarity = max(similarity, substring_bonus)
            
            # Bonus for reverse substring matches
            if skill in extracted_text:
                substring_bonus = len(skill) / len(extracted_text)
                similarity = max(similarity, substring_bonus)
            
            if similarity > best_score:
                best_score = similarity
                best_match = skill
        
        # Return match if above threshold
        if best_score >= threshold:
            return best_match, best_score
        else:
            return extracted_text, best_score
    
    def map_skill_to_hero(self, skill_name: str) -> str:
        """
        Map a skill name to hero name using the database mapping
        
        Args:
            skill_name: Name of the skill
            
        Returns:
            Hero name or Unknown(skill_name) if not found
        """
        return self.skill_hero_map.get(skill_name, f"Unknown({skill_name})")
    
    def detect_winner(self, image_path: str) -> Tuple[str, float, str]:
        """
        Detect winner using Chinese characters (胜 = team 1, 败 = team 2)
        
        Args:
            image_path: Path to the game image
            
        Returns:
            tuple: (winner_team, confidence, detected_text)
        """
        # Initialize OCR if needed
        self._initialize_ocr()
        
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            return "unknown", 0.0, ""
        
        # Get winner coordinates
        winner_config = self.config['winner_detection']
        x = winner_config['coordinates']['x']
        y = winner_config['coordinates']['y']
        width = winner_config['coordinates']['width']
        height = winner_config['coordinates']['height']
        threshold = winner_config['ocr_threshold']
        char_mapping = winner_config['character_mapping']
        
        # Crop winner area
        crop = image[y:y+height, x:x+width]
        
        # Perform OCR
        result = self.ocr.predict(crop)
        
        # Extract winner
        winner = "unknown"
        confidence = 0.0
        detected_text = ""
        
        if result and len(result) > 0 and 'rec_texts' in result[0]:
            texts = result[0]['rec_texts']
            scores = result[0].get('rec_scores', [])
            
            for i, text in enumerate(texts):
                score = scores[i] if i < len(scores) else 0.0
                
                if score >= threshold:
                    # Check each character
                    for char in text:
                        if char in char_mapping:
                            winner = char_mapping[char]
                            confidence = score
                            detected_text = char
                            break
                    
                    # Check direct mapping
                    if text in char_mapping and score > confidence:
                        winner = char_mapping[text]
                        confidence = score
                        detected_text = text
        
        return winner, confidence, detected_text
    
    def extract_skills_from_image(self, image_path: str, verbose: bool = True) -> Dict:
        """
        Extract all skills from image and map heroes
        
        Args:
            image_path: Path to the game image
            verbose: Whether to print extraction progress
            
        Returns:
            Dictionary with teams, heroes, and skills
        """
        # Initialize OCR
        self._initialize_ocr()
        
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        if verbose:
            print(f"Processing image: {image_path} (size: {image.shape})")
        
        # Get coordinates from config
        skills_grid = self.config['skills_grid']
        heroes_x = skills_grid['heroes_x_positions']
        top_y = skills_grid['top_team']['skills_y_positions']
        bottom_y = skills_grid['bottom_team']['skills_y_positions']
        width = skills_grid['skill_dimensions']['width']
        height = skills_grid['skill_dimensions']['height']
        
        # Extract all skills first
        all_skills = {}  # {team: {hero: [skills]}}
        
        for team_num in [1, 2]:
            all_skills[team_num] = {}
            y_positions = top_y if team_num == 1 else bottom_y
            team_name = "top" if team_num == 1 else "bottom"
            
            if verbose:
                print(f"Extracting {team_name} team skills...")
            
            for hero_idx, x in enumerate(heroes_x):
                hero_skills = []
                for skill_idx, y in enumerate(y_positions):
                    # Crop skill area
                    crop = image[y:y+height, x:x+width]
                    
                    # Perform OCR
                    result = self.ocr.predict(crop)
                    
                    # Extract text
                    raw_text = ""
                    if result and len(result) > 0 and 'rec_texts' in result[0]:
                        texts = result[0]['rec_texts']
                        if texts:
                            raw_text = " ".join(texts)
                    
                    raw_text = raw_text.strip()
                    
                    # Apply fuzzy matching
                    matched_skill, confidence = self.fuzzy_match_skill(raw_text)
                    hero_skills.append(matched_skill)
                    
                    if verbose:
                        status = "✓" if confidence >= 0.8 else "~" if confidence >= 0.5 else "?"
                        print(f"  Team {team_num}, Hero {hero_idx+1}, Skill {skill_idx+1}: '{raw_text}' → '{matched_skill}' {status} ({confidence:.3f})")
                
                all_skills[team_num][hero_idx + 1] = hero_skills
        
        # Map heroes using first skills
        result = {"1": [], "2": []}
        
        if verbose:
            print("\nMapping heroes using first skills...")
        
        for team_key in ["1", "2"]:
            team_num = int(team_key)
            for hero_num in sorted(all_skills[team_num].keys()):
                skills = all_skills[team_num][hero_num]
                first_skill = skills[0]
                hero_name = self.map_skill_to_hero(first_skill)
                
                result[team_key].append({
                    "name": hero_name,
                    "skills": skills
                })
                
                if verbose:
                    print(f"  Team {team_num}, Hero {hero_num}: '{first_skill}' → '{hero_name}'")
        
        # Detect winner
        if verbose:
            print("\nDetecting winner...")
        
        winner, winner_confidence, winner_text = self.detect_winner(image_path)
        result["winner"] = winner
        
        if verbose:
            if winner != "unknown":
                print(f"  Winner: Team {winner} (detected '{winner_text}', confidence: {winner_confidence:.3f})")
            else:
                print(f"  Winner: Could not detect winner (confidence: {winner_confidence:.3f})")
        
        return result
    
    def save_results(self, results: Dict, output_path: str):
        """Save extraction results to JSON file"""
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
    
    def extract_and_save(self, image_path: str, output_path: str, verbose: bool = True) -> Dict:
        """
        Extract skills from image and save results
        
        Args:
            image_path: Path to input image
            output_path: Path to save JSON results
            verbose: Whether to print progress
            
        Returns:
            Extraction results dictionary
        """
        results = self.extract_skills_from_image(image_path, verbose)
        self.save_results(results, output_path)
        
        if verbose:
            print(f"\nResults saved to: {output_path}")
            
        return results

def main():
    """Example usage of the skill extraction system"""
    
    # Initialize system
    extractor = SkillExtractionSystem()
    
    # Test on available images
    test_images = [
        ('train/1.jpg', 'results_train1.json'),
        ('train/2.PNG', 'results_train2.json'),
        ('test/1.PNG', 'results_test1.json')
    ]
    
    print("Skill Extraction System - Production Test")
    print("=" * 50)
    
    for image_path, output_path in test_images:
        if os.path.exists(image_path):
            print(f"\nProcessing {image_path}...")
            print("-" * 30)
            
            try:
                results = extractor.extract_and_save(image_path, output_path)
                
                # Summary
                total_skills = sum(len(hero['skills']) for team in results.values() if isinstance(team, list) for hero in team)
                total_heroes = sum(len(team) for team in results.values() if isinstance(team, list))
                
                print(f"✓ Successfully extracted {total_skills} skills from {total_heroes} heroes")
                
            except Exception as e:
                print(f"✗ Error processing {image_path}: {e}")
        else:
            print(f"⚠ Image not found: {image_path}")

if __name__ == "__main__":
    main()