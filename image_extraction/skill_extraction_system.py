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
import glob
import hashlib
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Callable

class SkillExtractionSystem:
    """Complete skill extraction system with OCR, fuzzy matching, and hero mapping"""
    
    # Frequently selected skills to always show in the interactive chooser
    # These are commonly missed by OCR; surfaced as quick picks in interactive mode
    PREFERRED_SKILLS = ["战八方", "惩前毖后", "万人之敌", "刚烈", "闭月", "横征暴敛", "十面埋伏", "南疆烈刃", "雄护南疆"]
    
    def __init__(self, config_path: str = os.path.join('image_extraction', 'extraction_config.json'), 
                 database_path: str = os.path.join('web', 'public', 'database.json')):
        """
        Initialize the extraction system
        
        Args:
            config_path: Path to extraction configuration JSON
            database_path: Path to skill database JSON
        """
        self.config_path = config_path
        self.database_path = database_path
        self.config = self._load_config(config_path)
        self.database = self._load_database(database_path)
        self.skill_list = self.database['skill']
        self.skill_hero_map = self.database['skill_hero_map']

        # Output settings
        self.output_settings = self.config.get('output_format', {})
        self.save_cropped_images = bool(self.output_settings.get('save_cropped_images', False))
        self.output_dir = self.output_settings.get('output_directory', 'extracted_results')
        # Interactive crop preview settings
        self.show_ascii_preview = bool(self.output_settings.get('show_ascii_preview', False))
        self.tmp_crops_dir = self.output_settings.get('tmp_crops_directory', 'tmp_crops')
        # OCR correction/training data settings
        self.save_ocr_corrections = bool(self.output_settings.get('save_ocr_corrections', True))
        self.ocr_corrections_dir = self.output_settings.get('ocr_corrections_directory', 'ocr_corrections')
        self.use_ocr_corrections = bool(self.output_settings.get('use_ocr_corrections', True))
        # Ensure directories exist as needed
        if self.save_cropped_images:
            os.makedirs(self._crops_root_dir(), exist_ok=True)
        os.makedirs(self.tmp_crops_dir, exist_ok=True)
        if self.save_ocr_corrections:
            os.makedirs(self.ocr_corrections_dir, exist_ok=True)
        
        # OCR confidence thresholds
        ocr_settings = self.config.get('ocr_settings', {})
        self.ocr_confidence_threshold = ocr_settings.get('confidence_threshold', 0.5)
        self.ocr_fallback_threshold = 0.3  # Lower threshold for fallback attempts (still filters noise)
        
        # Load OCR corrections for lookup
        self._ocr_corrections_cache = None
        self._ocr_error_patterns = {}  # Maps OCR text → correct text
        self._ocr_image_hash_lookup = {}  # Maps image hash → correct text
        if self.use_ocr_corrections:
            self._load_ocr_corrections()
        
        # Initialize PaddleOCR at startup (not lazy loading)
        self._initialize_ocr()
    
    def _load_config(self, config_path: str) -> Dict:
        """Load extraction configuration"""
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _load_database(self, database_path: str) -> Dict:
        """Load skill database"""
        with open(database_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _load_ocr_corrections(self):
        """
        Load OCR corrections from saved JSON files to build lookup tables.
        Creates two lookup systems:
        1. Image hash → correct text (for exact image matches)
        2. OCR text → correct text (for error pattern matching)
        """
        if not os.path.exists(self.ocr_corrections_dir):
            return
        
        try:
            correction_files = glob.glob(os.path.join(self.ocr_corrections_dir, '*.json'))
            loaded_count = 0
            
            for json_path in correction_files:
                try:
                    with open(json_path, 'r', encoding='utf-8') as f:
                        correction = json.load(f)
                    
                    ocr_text = correction.get('ocr_text', '').strip()
                    correct_text = correction.get('correct_text', '').strip()
                    
                    if not ocr_text or not correct_text:
                        continue
                    
                    # Build error pattern mapping (OCR text → correct text)
                    # Count occurrences to prioritize common corrections
                    if ocr_text not in self._ocr_error_patterns:
                        self._ocr_error_patterns[ocr_text] = {}
                    if correct_text not in self._ocr_error_patterns[ocr_text]:
                        self._ocr_error_patterns[ocr_text][correct_text] = 0
                    self._ocr_error_patterns[ocr_text][correct_text] += 1
                    
                    # Build image hash lookup (derive image filename from JSON filename)
                    # Try explicit image_file field first, then derive from JSON filename
                    image_file = correction.get('image_file', '')
                    if not image_file:
                        # Derive image filename from JSON filename (same base, .png extension)
                        json_basename = os.path.basename(json_path)
                        image_file = os.path.splitext(json_basename)[0] + '.png'
                    
                    image_path = os.path.join(self.ocr_corrections_dir, image_file)
                    if os.path.exists(image_path):
                        try:
                            img = cv2.imread(image_path)
                            if img is not None:
                                img_hash = hashlib.md5(img.tobytes()).hexdigest()
                                self._ocr_image_hash_lookup[img_hash] = correct_text
                        except Exception:
                            pass
                    
                    loaded_count += 1
                except Exception:
                    continue
            
            # Normalize error patterns: keep only the most common correction for each OCR text
            normalized_patterns = {}
            for ocr_text, corrections in self._ocr_error_patterns.items():
                # Get the most common correction
                most_common = max(corrections.items(), key=lambda x: x[1])
                normalized_patterns[ocr_text] = most_common[0]
            self._ocr_error_patterns = normalized_patterns
            
            if loaded_count > 0:
                print(f"Loaded {loaded_count} OCR corrections: {len(self._ocr_error_patterns)} error patterns, {len(self._ocr_image_hash_lookup)} image hashes")
        except Exception as e:
            print(f"⚠️  Warning: Failed to load OCR corrections: {e}")
    
    def _initialize_ocr(self):
        """Initialize PaddleOCR at startup"""
        # Read OCR settings from config
        ocr_settings = self.config.get('ocr_settings', {})
        
        # Build PaddleOCR parameters from config
        ocr_params = {
            'lang': ocr_settings.get('language', 'ch')
        }
        
        # Add optional parameters if present in config
        if 'text_det_limit_side_len' in ocr_settings:
            ocr_params['text_det_limit_side_len'] = ocr_settings['text_det_limit_side_len']
        if 'use_textline_orientation' in ocr_settings:
            ocr_params['use_textline_orientation'] = ocr_settings['use_textline_orientation']
        if 'text_det_thresh' in ocr_settings:
            ocr_params['text_det_thresh'] = ocr_settings['text_det_thresh']
        if 'text_det_box_thresh' in ocr_settings:
            ocr_params['text_det_box_thresh'] = ocr_settings['text_det_box_thresh']
        if 'text_rec_score_thresh' in ocr_settings:
            ocr_params['text_rec_score_thresh'] = ocr_settings['text_rec_score_thresh']
        
        # Initialize all PaddleOCR instances at startup to avoid warnings
        self.ocr = PaddleOCR(**ocr_params)
        # Initialize fallback OCR for challenging cases
        self.fallback_ocr = PaddleOCR(lang='ch')  # No size limit for fallback
        # Initialize aggressive OCR instances for fallback strategies
        self.aggressive_ocr_1 = PaddleOCR(lang='ch', text_det_thresh=0.1, text_det_box_thresh=0.2)
        self.aggressive_ocr_2 = PaddleOCR(lang='ch', text_det_unclip_ratio=3.0, text_det_thresh=0.1)
        # Initialize enhanced OCR for complex preprocessing
        self.enhanced_ocr = PaddleOCR(lang='ch', text_det_thresh=0.05, text_det_box_thresh=0.1)
    
    def _apply_ocr_corrections(self, ocr_text: str) -> str:
        """
        Apply OCR error pattern corrections to OCR text.
        
        Args:
            ocr_text: Text extracted by OCR
            
        Returns:
            Corrected text if pattern found, otherwise original text
        """
        if self.use_ocr_corrections and self._ocr_error_patterns:
            if ocr_text in self._ocr_error_patterns:
                return self._ocr_error_patterns[ocr_text]
        return ocr_text

    def _enhanced_ocr_predict(self, crop: np.ndarray) -> Tuple[str, float]:
        """
        Enhanced OCR prediction with fallback strategies for challenging images.
        Uses saved OCR corrections to improve accuracy.
        
        Args:
            crop: Image crop to perform OCR on
            
        Returns:
            tuple: (extracted_text, confidence_score)
        """
        # Check OCR corrections: First try exact image hash match
        if self.use_ocr_corrections and self._ocr_image_hash_lookup:
            try:
                crop_hash = hashlib.md5(crop.tobytes()).hexdigest()
                if crop_hash in self._ocr_image_hash_lookup:
                    correct_text = self._ocr_image_hash_lookup[crop_hash]
                    return correct_text, 1.0  # High confidence for exact match
            except Exception:
                pass
        
        # Try primary OCR first
        result = self.ocr.predict(crop)
        
        if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
            texts = result[0]['rec_texts']
            scores = result[0].get('rec_scores', [])
            if texts and scores and scores[0] > self.ocr_confidence_threshold:
                ocr_text = "".join(texts)
                corrected_text = self._apply_ocr_corrections(ocr_text)
                return corrected_text, max(scores)
        
        # Fallback 1: No size limit OCR (already initialized at startup)
        result = self.fallback_ocr.predict(crop)
        if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
            texts = result[0]['rec_texts']
            scores = result[0].get('rec_scores', [])
            if texts and scores and scores[0] > self.ocr_fallback_threshold:
                ocr_text = "".join(texts)
                corrected_text = self._apply_ocr_corrections(ocr_text)
                return corrected_text, max(scores)
        
        # Fallback 2: Contrast enhancement + primary OCR
        try:
            enhanced_crop = cv2.convertScaleAbs(crop, alpha=2.0, beta=0)
            result = self.ocr.predict(enhanced_crop)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > self.ocr_fallback_threshold:
                    ocr_text = "".join(texts)
                    corrected_text = self._apply_ocr_corrections(ocr_text)
                    return corrected_text, max(scores)
        except Exception:
            pass
        
        # Fallback 3: Gamma correction preprocessing
        try:
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            gamma_corrected = np.array(255 * (gray / 255) ** 0.5, dtype='uint8')
            gamma_crop = cv2.cvtColor(gamma_corrected, cv2.COLOR_GRAY2BGR)
            
            # Try with aggressive OCR settings (pre-initialized)
            result = self.aggressive_ocr_1.predict(gamma_crop)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > self.ocr_fallback_threshold:
                    ocr_text = "".join(texts)
                    corrected_text = self._apply_ocr_corrections(ocr_text)
                    return corrected_text, max(scores)
        except Exception:
            pass
        
        # Fallback 4: Image scaling (downscale for very small text)
        try:
            height, width = crop.shape[:2]
            if height <= 50 and width <= 200:  # Only for small images
                # Try downscaling
                scaled_crop = cv2.resize(crop, (int(width * 0.5), int(height * 0.5)), interpolation=cv2.INTER_AREA)
                result = self.ocr.predict(scaled_crop)
                if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                    texts = result[0]['rec_texts']
                    scores = result[0].get('rec_scores', [])
                    if texts and scores and scores[0] > self.ocr_fallback_threshold:
                        ocr_text = "".join(texts)
                    corrected_text = self._apply_ocr_corrections(ocr_text)
                    return corrected_text, max(scores)
        except Exception:
            pass
        
        # Fallback 5: Padded image
        try:
            padded_crop = cv2.copyMakeBorder(crop, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[0, 0, 0])
            result = self.ocr.predict(padded_crop)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > self.ocr_fallback_threshold:
                    ocr_text = "".join(texts)
                    corrected_text = self._apply_ocr_corrections(ocr_text)
                    return corrected_text, max(scores)
        except Exception:
            pass
        
        # Fallback 6: Unsharp masking with aggressive OCR
        try:
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (0, 0), 1.0)
            unsharp = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)
            unsharp_crop = cv2.cvtColor(unsharp, cv2.COLOR_GRAY2BGR)
            
            # Use pre-initialized aggressive OCR
            result = self.aggressive_ocr_2.predict(unsharp_crop)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > self.ocr_fallback_threshold:
                    ocr_text = "".join(texts)
                    corrected_text = self._apply_ocr_corrections(ocr_text)
                    return corrected_text, max(scores)
        except Exception:
            pass
        
        # Fallback 7: Complex preprocessing (bilateral + gamma + scale)
        try:
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            bilateral = cv2.bilateralFilter(gray, 9, 75, 75)
            gamma_corrected = np.array(255 * (bilateral / 255) ** 0.4, dtype='uint8')
            height, width = gamma_corrected.shape
            scaled = cv2.resize(cv2.cvtColor(gamma_corrected, cv2.COLOR_GRAY2BGR), 
                              (width * 3, height * 3), interpolation=cv2.INTER_CUBIC)
            
            # Use pre-initialized enhanced OCR
            result = self.enhanced_ocr.predict(scaled)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > self.ocr_fallback_threshold:
                    ocr_text = "".join(texts)
                    corrected_text = self._apply_ocr_corrections(ocr_text)
                    return corrected_text, max(scores)
        except Exception:
            pass
        
        # Return empty if all methods fail
        return "", 0.0

    # ----------------------
    # Cropped image utilities
    # ----------------------
    def _crops_root_dir(self) -> str:
        return os.path.join(self.output_dir, 'crops')

    def _crops_dir_for_image(self, image_path: str) -> str:
        base = os.path.splitext(os.path.basename(image_path))[0]
        return os.path.join(self._crops_root_dir(), base)

    def _save_crop(self, crop: np.ndarray, image_path: str, team: int, hero: int, skill: int) -> Optional[str]:
        if not self.save_cropped_images:
            return None
        out_dir = self._crops_dir_for_image(image_path)
        os.makedirs(out_dir, exist_ok=True)
        fname = f"t{team}_h{hero}_s{skill}.png"
        out_path = os.path.join(out_dir, fname)
        try:
            cv2.imwrite(out_path, crop)
            return out_path
        except Exception:
            return None

    def _render_ascii_preview(self, crop: np.ndarray, max_width: int = 48) -> str:
        """Render a small ASCII-art preview for terminal display."""
        if crop is None or crop.size == 0:
            return "(no preview)"
        try:
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
            h, w = gray.shape[:2]
            if w == 0 or h == 0:
                return "(empty)"
            # Character cells are roughly 2:1 height:width; adjust aspect
            target_w = max(8, min(max_width, w))
            target_h = max(1, int(h * (target_w / w) * 0.55))
            resized = cv2.resize(gray, (target_w, target_h), interpolation=cv2.INTER_AREA)
            chars = " .:-=+*#%@"
            scale = (len(chars) - 1) / 255.0
            lines = []
            for r in resized:
                line = ''.join(chars[int(px * scale)] for px in r)
                lines.append(line)
            return "\n".join(lines)
        except Exception:
            return "(preview failed)"

    def _print_crop_preview(self, crop: np.ndarray, label: str, saved_path: Optional[str] = None):
        print(f"\n  [Crop Preview] {label}")
        ascii_art = self._render_ascii_preview(crop)
        for line in ascii_art.split('\n'):
            print(f"    {line}")
        if saved_path:
            print(f"  Saved crop image: {saved_path}")

    def _save_tmp_crop(self, crop: np.ndarray, image_path: str, team: int, hero: int, skill: int) -> Optional[str]:
        """Save a crop associated with an interactive prompt into a temporary folder."""
        try:
            base = os.path.splitext(os.path.basename(image_path))[0]
            out_dir = os.path.join(self.tmp_crops_dir, base)
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, f"t{team}_h{hero}_s{skill}.png")
            cv2.imwrite(out_path, crop)
            return out_path
        except Exception:
            return None
    
    def _save_ocr_correction(self, crop: np.ndarray, ocr_text: str, correct_text: str, 
                             image_path: str, team: int, hero: int, skill: int) -> Optional[str]:
        """
        Save OCR correction data (image crop + OCR text + correct text) for future OCR improvement.
        
        Args:
            crop: Image crop that was OCR'd
            ocr_text: Text extracted by OCR (incorrect)
            correct_text: Correct text selected by user
            image_path: Original image path
            team: Team number (1 or 2)
            hero: Hero number (1-indexed)
            skill: Skill number (1-indexed)
            
        Returns:
            Path to saved correction data JSON file, or None if failed
        """
        if not self.save_ocr_corrections:
            return None
        
        try:
            # Create unique filename based on timestamp and content hash
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            content_hash = hashlib.md5(crop.tobytes()).hexdigest()[:8]
            filename_base = f"{timestamp}_{content_hash}_t{team}_h{hero}_s{skill}"
            
            # Save image crop
            image_filename = f"{filename_base}.png"
            image_path_full = os.path.join(self.ocr_corrections_dir, image_filename)
            cv2.imwrite(image_path_full, crop)
            
            # Save metadata JSON (minimal - only what's needed for lookup)
            metadata = {
                "ocr_text": ocr_text,
                "correct_text": correct_text
            }
            
            json_filename = f"{filename_base}.json"
            json_path = os.path.join(self.ocr_corrections_dir, json_filename)
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            return json_path
        except Exception as e:
            if hasattr(self, 'verbose') and self.verbose:
                print(f"⚠️  Failed to save OCR correction: {e}")
            return None
    
    def _save_fixture(self, image_path: str, image: np.ndarray, result: Dict, verbose: bool = True) -> Optional[str]:
        """
        Save image and extraction result as a fixture for testing.
        
        Args:
            image_path: Original image path
            image: Loaded image array
            result: Extraction result dictionary
            verbose: Whether to print status messages
            
        Returns:
            Path to saved fixture JSON file, or None if failed
        """
        try:
            fixtures_dir = os.path.join('image_extraction', 'fixtures')
            os.makedirs(fixtures_dir, exist_ok=True)
            
            # Generate unique fixture name based on timestamp and image hash
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            image_hash = hashlib.md5(image.tobytes()).hexdigest()[:8]
            fixture_base = f"{timestamp}_{image_hash}"
            
            # Determine image extension from original file
            _, ext = os.path.splitext(image_path)
            if not ext:
                ext = '.png'
            # Normalize extension to lowercase for consistency
            ext = ext.lower()
            if ext not in ['.jpg', '.jpeg', '.png']:
                ext = '.png'
            
            # Save image
            fixture_image_path = os.path.join(fixtures_dir, f"{fixture_base}{ext}")
            cv2.imwrite(fixture_image_path, image)
            
            # Prepare result for fixture (remove diagnostics, keep only test-relevant fields)
            fixture_result = {
                "1": result.get("1", []),
                "2": result.get("2", []),
                "winner": result.get("winner", "unknown")
            }
            
            # Save JSON fixture
            fixture_json_path = os.path.join(fixtures_dir, f"{fixture_base}.json")
            with open(fixture_json_path, 'w', encoding='utf-8') as f:
                json.dump(fixture_result, f, ensure_ascii=False, indent=2)
            
            if verbose:
                print(f"  💾 Saved fixture: {fixture_base}{ext} + {fixture_base}.json")
            
            return fixture_json_path
        except Exception as e:
            if verbose:
                print(f"⚠️  Failed to save fixture: {e}")
            return None

    def top_k_skill_matches(self, extracted_text: str, k: int = 5) -> List[Tuple[str, float]]:
        """Return top-k skill candidates by fuzzy similarity (Chinese query only)"""
        candidates: List[Tuple[str, float]] = []
        if not extracted_text:
            return candidates
        # Combine skill_list and skill_hero_map keys to search all available skills
        all_skills = set(self.skill_list)
        if self.skill_hero_map:
            all_skills.update(self.skill_hero_map.keys())
        for skill in all_skills:
            similarity = SequenceMatcher(None, extracted_text, skill).ratio()
            if extracted_text in skill:
                substring_bonus = len(extracted_text) / len(skill)
                similarity = max(similarity, substring_bonus)
            if skill in extracted_text:
                substring_bonus = len(skill) / len(extracted_text)
                similarity = max(similarity, substring_bonus)
            candidates.append((skill, similarity))
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[:k]

    def fuzzy_match_skill(self, extracted_text: str, threshold: Optional[float] = None, is_hero_skill: bool = False) -> Tuple[str, float]:
        """
        Find the best matching skill from database using fuzzy string matching
        
        Args:
            extracted_text: OCR extracted text
            threshold: Minimum similarity score (0.0 to 1.0). If None, uses config value.
            is_hero_skill: Whether this is the first skill (hero skill) of a hero. If True,
                          prefers skills in skill_hero_map when there's ambiguity.
            
        Returns:
            tuple: (best_match, confidence_score)
        """
        if not extracted_text or not extracted_text.strip():
            return "", 0.0
        
        # Use configured threshold if not provided
        if threshold is None:
            threshold = (
                self.config.get("fuzzy_matching", {}).get("threshold", 0.5)
                if hasattr(self, "config") else 0.5
            )
        
        # For hero skills, only consider skills in skill_hero_map
        # For other skills, consider all skills from skill_list and skill_hero_map
        if is_hero_skill:
            if not self.skill_hero_map:
                return "", 0.0
            all_skills = set(self.skill_hero_map.keys())
        else:
            all_skills = set(self.skill_list)
            if self.skill_hero_map:
                all_skills.update(self.skill_hero_map.keys())
        
        # Track all candidates with their scores
        candidates = []
        
        for skill in all_skills:
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
            
            candidates.append((skill, similarity))
        
        # Sort by score (descending)
        candidates.sort(key=lambda x: x[1], reverse=True)
        
        if not candidates:
            return "", 0.0
        
        best_match, best_score = candidates[0]
        
        # Tie-breaking for similar skills: when scores are very close, use preference rules
        # Threshold for considering scores "too close" (within 0.02)
        tie_breaking_threshold = 0.02
        
        # Check if there are multiple candidates with very similar scores
        if len(candidates) > 1:
            second_best_score = candidates[1][1]
            score_diff = best_score - second_best_score
            
            # If scores are very close, apply tie-breaking logic
            # Note: For hero skills, candidates are already filtered to skill_hero_map only,
            # so no special tie-breaking is needed. For non-hero skills, prefer skills in skill_list.
            if score_diff <= tie_breaking_threshold and best_score >= threshold and not is_hero_skill:
                # Find all candidates within the tie-breaking threshold
                top_candidates = [c for c in candidates if best_score - c[1] <= tie_breaking_threshold]
                
                # For non-hero skills: prefer skills in skill_list (not in skill_hero_map)
                regular_skill_candidates = [c for c in top_candidates if c[0] in self.skill_list and c[0] not in self.skill_hero_map]
                if regular_skill_candidates:
                    # Use the one with highest score among regular skills
                    best_match, best_score = max(regular_skill_candidates, key=lambda x: x[1])
        
        # Return match if above threshold
        if best_score >= threshold:
            return best_match, best_score
        else:
            # Return original text to signal no confident match
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
        Detect winner using Chinese characters (胜 = team 1, 败 = team 2, 平 = draw - battle should be discarded)
        
        Args:
            image_path: Path to the game image
            
        Returns:
            tuple: (winner_team, confidence, detected_text)
            - winner_team: "1" (team 1 wins), "2" (team 2 wins), "draw" (平 - battle should be discarded), or "unknown"
        """
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
        
        # Use enhanced OCR with corrections applied (already includes OCR corrections)
        detected_text, confidence = self._enhanced_ocr_predict(crop)
        
        # Extract winner
        winner = "unknown"
        final_text = ""
        
        if detected_text and confidence >= threshold:
            # Apply OCR corrections (may be redundant but ensures corrections are applied)
            corrected_text = self._apply_ocr_corrections(detected_text)
            
            # Check for draw character (平) first - battle should be discarded
            if "平" in corrected_text:
                return "draw", confidence, "平"
            
            # Check each character in corrected text
            for char in corrected_text:
                if char in char_mapping:
                    winner = char_mapping[char]
                    final_text = char
                    break
            
            # Check direct mapping
            if corrected_text in char_mapping:
                winner = char_mapping[corrected_text]
                final_text = corrected_text
            elif not final_text:
                # If no mapping found, use the corrected text
                final_text = corrected_text
        
        return winner, confidence, final_text
    
    def extract_skills_from_image(self, image_path: str, verbose: bool = True, interactive: bool = False,
                                 user_select_skill: Optional[Callable[[str, int, int, str, List[Tuple[str, float]]], str]] = None) -> Dict:
        """
        Extract all skills from image and map heroes
        
        Args:
            image_path: Path to the game image
            verbose: Whether to print extraction progress
            
        Returns:
            Dictionary with teams, heroes, and skills, plus failure diagnostics
        """
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        if verbose:
            print(f"Processing image: {image_path} (size: {image.shape})")
        
        # Detect winner early - if it's a draw, discard the battle before processing skills
        if verbose:
            print("\nDetecting winner...")
        
        winner, winner_confidence, winner_text = self.detect_winner(image_path)
        
        if winner == "draw":
            if verbose:
                print(f"  Winner: Draw detected (平) - discarding battle (confidence: {winner_confidence:.3f})")
            raise ValueError(f"Battle is a draw (平) - battle discarded. Image: {image_path}")
        
        if verbose:
            if winner != "unknown":
                print(f"  Winner: Team {winner} (detected '{winner_text}', confidence: {winner_confidence:.3f})")
            else:
                print(f"  Winner: Could not detect winner (confidence: {winner_confidence:.3f})")
        
        # Cache for first-skill crops per hero for later hero mapping preview
        crop_cache: Dict[Tuple[int, int, int], Tuple[np.ndarray, Optional[str]]] = {}
        
        # Get coordinates from config
        skills_grid = self.config['skills_grid']
        heroes_x = skills_grid['heroes_x_positions']
        top_y = skills_grid['top_team']['skills_y_positions']
        bottom_y = skills_grid['bottom_team']['skills_y_positions']
        width = skills_grid['skill_dimensions']['width']
        height = skills_grid['skill_dimensions']['height']
        fuzzy_threshold = self.config.get('fuzzy_matching', {}).get('threshold', 0.5)
        
        # Extract all skills first
        all_skills = {}  # {team: {hero: [skills]}}
        fuzzy_failures = []
        user_interference_occurred = False  # Track if user manually intervened
        
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

                    # Save crop if enabled and keep for previews
                    saved_path = self._save_crop(crop, image_path, team_num, hero_idx + 1, skill_idx + 1)
                    crop_cache[(team_num, hero_idx + 1, skill_idx + 1)] = (crop, saved_path)
                    
                    # Perform enhanced OCR with fallbacks
                    raw_text, ocr_confidence = self._enhanced_ocr_predict(crop)
                    raw_text = (raw_text or "").strip()
                    
                    # Discard battle if OCR returns empty text (indicates coordinate mismatch or image issue)
                    if not raw_text:
                        raise ValueError(
                            f"OCR returned empty text for Team {team_num}, Hero {hero_idx + 1}, Skill {skill_idx + 1} - "
                            f"battle discarded. This may indicate coordinate mismatch with image dimensions. "
                            f"Image: {image_path}"
                        )
                    
                    # Discard battle if OCR returns "进攻" (indicates incorrect image or coordinate mismatch)
                    if raw_text == "进攻":
                        raise ValueError(
                            f"OCR returned '进攻' for Team {team_num}, Hero {hero_idx + 1}, Skill {skill_idx + 1} - "
                            f"battle discarded. This may indicate incorrect image or coordinate mismatch. "
                            f"Image: {image_path}"
                        )
                    
                    # Apply fuzzy matching
                    # First skill (skill_idx == 0) is always the hero skill
                    is_hero_skill = (skill_idx == 0)
                    matched_skill, confidence = self.fuzzy_match_skill(raw_text, is_hero_skill=is_hero_skill)

                    
                    # Interactive resolution for low-confidence or unknown match
                    if interactive and ((not matched_skill) or (matched_skill == raw_text and confidence < fuzzy_threshold)):
                        # Save a temp crop to help user verify visually; optionally print ASCII preview
                        tmp_path = self._save_tmp_crop(crop, image_path, team_num, hero_idx + 1, skill_idx + 1)
                        if self.show_ascii_preview:
                            self._print_crop_preview(crop, label=f"Team {team_num}, Hero {hero_idx+1}, Skill {skill_idx+1}", saved_path=tmp_path)
                        else:
                            print(f"\n  [Crop Saved] Team {team_num}, Hero {hero_idx+1}, Skill {skill_idx+1} → {tmp_path or '(failed to save)'}")

                        # Build full candidate list (ranked) and paginate
                        candidates_full = self.top_k_skill_matches(raw_text, k=len(self.skill_list))
                        # Ensure preferred/common skills are surfaced at the top of the chooser
                        try:
                            preferred = [s for s in self.PREFERRED_SKILLS if s in self.skill_list]
                        except Exception:
                            preferred = []
                        if preferred:
                            existing = set(sk for sk, _ in candidates_full)
                            # Move existing preferred to front, and add any missing preferred with a high score
                            reordered = []
                            for s in preferred:
                                if s in existing:
                                    # Remove existing occurrence
                                    candidates_full = [(sk, sc) for (sk, sc) in candidates_full if sk != s]
                                    reordered.append((s, 1.0))
                                else:
                                    reordered.append((s, 1.0))
                            candidates_full = reordered + candidates_full
                        page_size = 10
                        page = 0
                        selected = None
                        # Callback (if provided) gets the top-k from current page first
                        if user_select_skill is not None:
                            try:
                                selected = user_select_skill(
                                    image_path, team_num, hero_idx + 1, raw_text,
                                    candidates_full[:page_size]
                                )
                            except Exception as e:
                                selected = None
                                if verbose:
                                    print(f"⚠️  Skill select callback failed: {e}")
                        while selected is None:
                            start = page * page_size
                            end = min(start + page_size, len(candidates_full))
                            page_candidates = candidates_full[start:end]
                            # CLI prompt fallback with quick picks and custom/search entry
                            print("\nManual selection required: unrecognized/low-confidence skill")
                            print(f"  Image: {image_path}")
                            print(f"  Team {team_num}, Hero {hero_idx+1}, Skill {skill_idx+1}")
                            print(f"  OCR: '{raw_text}'  (best guess '{matched_skill}', {confidence:.3f})")
                            # Quick picks: commonly missed by OCR
                            quick_picks = [s for s in self.PREFERRED_SKILLS if s]
                            if quick_picks:
                                print("  Quick picks:")
                                for i, s in enumerate(quick_picks, 1):
                                    print(f"    {i}. {s}")
                            print("  Commands:")
                            print("   -1. Enter a custom skill name")
                            choice = input("  Choose [number], or -1: ").strip()
                            if choice == "-1":
                                # Re-emit the saved path for convenience before custom input
                                tmp_path2 = self._save_tmp_crop(crop, image_path, team_num, hero_idx + 1, skill_idx + 1)
                                if self.show_ascii_preview:
                                    self._print_crop_preview(crop, label=f"Team {team_num}, Hero {hero_idx+1}, Skill {skill_idx+1}", saved_path=tmp_path2)
                                else:
                                    print(f"  Crop path: {tmp_path2 or '(failed to save)'}")
                                custom = input("  Enter custom skill: ").strip()
                                if custom:
                                    selected = custom
                                    # If custom not in list, add it
                                    if selected not in self.skill_list:
                                        self.skill_list.append(selected)
                                        if verbose:
                                            print(f"  Added custom skill '{selected}' to database skill list")
                                else:
                                    print("  Empty input, try again.")
                                continue
                            else:
                                # Numeric quick-pick selection
                                try:
                                    ci = int(choice)
                                    if 1 <= ci <= len(quick_picks):
                                        selected = quick_picks[ci - 1]
                                        # If selected not in skill list, add it
                                        if selected not in self.skill_list:
                                            self.skill_list.append(selected)
                                    else:
                                        print("  Invalid choice, try again.")
                                        continue
                                except Exception:
                                    print("  Invalid input, try again.")
                                    continue
                        if selected:
                            matched_skill = selected
                            confidence = 1.0  # assume manual choice is correct
                            user_interference_occurred = True  # Mark that user intervention occurred
                            # Save OCR correction data for future improvement
                            if raw_text != matched_skill:  # Only save if OCR was wrong
                                correction_path = self._save_ocr_correction(
                                    crop, raw_text, matched_skill, 
                                    image_path, team_num, hero_idx + 1, skill_idx + 1
                                )
                                if correction_path and verbose:
                                    print(f"  💾 Saved OCR correction: '{raw_text}' → '{matched_skill}'")
                    
                    hero_skills.append(matched_skill)
                    
                    # Record fuzzy failures (no confident mapping)
                    if (not matched_skill) or (matched_skill == raw_text and confidence < fuzzy_threshold):
                        fuzzy_failures.append({
                            'team': team_num,
                            'hero': hero_idx + 1,
                            'skill': skill_idx + 1,
                            'raw_text': raw_text,
                            'confidence': float(confidence)
                        })
                    
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
                first_skill = skills[0] if skills else ""
                hero_name = self.map_skill_to_hero(first_skill)
                
                # If hero is unknown, error out - this indicates a data integrity issue
                if isinstance(hero_name, str) and hero_name.startswith("Unknown("):
                    raise ValueError(
                        f"Unknown hero mapping for skill '{first_skill}' (Team {team_num}, Hero {hero_num}). "
                        f"This indicates the skill is not in the database mapping. "
                        f"Image: {image_path}"
                    )
                
                result[team_key].append({
                    "name": hero_name,
                    "skills": skills
                })
                
                if verbose:
                    print(f"  Team {team_num}, Hero {hero_num}: '{first_skill}' → '{hero_name}'")
        
        # Winner was already detected at the start - add it to result
        result["winner"] = winner
        
        # Attach diagnostics
        result['fuzzy_match_failures'] = fuzzy_failures
        
        # Save fixture if user interference occurred
        if user_interference_occurred:
            self._save_fixture(image_path, image, result, verbose)
        
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
