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
from pypinyin import lazy_pinyin
import os
from typing import Dict, List, Tuple, Optional, Callable

class SkillExtractionSystem:
    """Complete skill extraction system with OCR, fuzzy matching, and hero mapping"""
    
    # Frequently selected skills to always show in the interactive chooser
    # These are commonly missed by OCR; surfaced as quick picks in interactive mode
    PREFERRED_SKILLS = ["战八方", "惩前毖后", "万人之敌", "刚烈", "闭月", "横征暴敛", "十面埋伏", "南疆烈刃", "雄护南疆"]

    def __init__(self, config_path: str = os.path.join('image_extraction', 'extraction_config.json'), 
                 database_path: str = os.path.join('data', 'database.json')):
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
        self.ocr = None

        # Build pinyin index for skills
        self._skill_pinyin: Dict[str, str] = {}
        for s in self.skill_list:
            try:
                self._skill_pinyin[s] = ''.join(lazy_pinyin(s)).lower()
            except Exception:
                self._skill_pinyin[s] = s

        # Output settings
        self.output_settings = self.config.get('output_format', {})
        self.save_cropped_images = bool(self.output_settings.get('save_cropped_images', False))
        self.output_dir = self.output_settings.get('output_directory', 'extracted_results')
        # Interactive crop preview settings
        self.show_ascii_preview = bool(self.output_settings.get('show_ascii_preview', False))
        self.tmp_crops_dir = self.output_settings.get('tmp_crops_directory', 'tmp_crops')
        # Ensure directories exist as needed
        if self.save_cropped_images:
            os.makedirs(self._crops_root_dir(), exist_ok=True)
        os.makedirs(self.tmp_crops_dir, exist_ok=True)
    
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
                
            self.ocr = PaddleOCR(**ocr_params)
            
            # Initialize fallback OCR for challenging cases
            self.fallback_ocr = PaddleOCR(lang='ch')  # No size limit for fallback

    def _enhanced_ocr_predict(self, crop: np.ndarray) -> Tuple[str, float]:
        """
        Enhanced OCR prediction with fallback strategies for challenging images
        
        Args:
            crop: Image crop to perform OCR on
            
        Returns:
            tuple: (extracted_text, confidence_score)
        """
        # Try primary OCR first
        result = self.ocr.predict(crop)
        
        if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
            texts = result[0]['rec_texts']
            scores = result[0].get('rec_scores', [])
            if texts and scores and scores[0] > 0.1:  # Minimum confidence threshold
                return " ".join(texts), max(scores)
        
        # Fallback 1: No size limit OCR
        if not hasattr(self, 'fallback_ocr'):
            self.fallback_ocr = PaddleOCR(lang='ch')
            
        result = self.fallback_ocr.predict(crop)
        if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
            texts = result[0]['rec_texts']
            scores = result[0].get('rec_scores', [])
            if texts and scores and scores[0] > 0.1:
                return " ".join(texts), max(scores)
        
        # Fallback 2: Contrast enhancement + primary OCR
        try:
            enhanced_crop = cv2.convertScaleAbs(crop, alpha=2.0, beta=0)
            result = self.ocr.predict(enhanced_crop)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > 0.1:
                    return " ".join(texts), max(scores)
        except Exception:
            pass
        
        # Fallback 3: Gamma correction preprocessing
        try:
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            gamma_corrected = np.array(255 * (gray / 255) ** 0.5, dtype='uint8')
            gamma_crop = cv2.cvtColor(gamma_corrected, cv2.COLOR_GRAY2BGR)
            
            # Try with aggressive OCR settings
            aggressive_ocr = PaddleOCR(lang='ch', text_det_thresh=0.1, text_det_box_thresh=0.2)
            result = aggressive_ocr.predict(gamma_crop)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > 0.1:
                    return " ".join(texts), max(scores)
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
                    if texts and scores and scores[0] > 0.1:
                        return " ".join(texts), max(scores)
        except Exception:
            pass
        
        # Fallback 5: Padded image
        try:
            padded_crop = cv2.copyMakeBorder(crop, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[0, 0, 0])
            result = self.ocr.predict(padded_crop)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > 0.1:
                    return " ".join(texts), max(scores)
        except Exception:
            pass
        
        # Fallback 6: Unsharp masking with aggressive OCR
        try:
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (0, 0), 1.0)
            unsharp = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)
            unsharp_crop = cv2.cvtColor(unsharp, cv2.COLOR_GRAY2BGR)
            
            aggressive_ocr = PaddleOCR(lang='ch', text_det_unclip_ratio=3.0, text_det_thresh=0.1)
            result = aggressive_ocr.predict(unsharp_crop)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > 0.1:
                    return " ".join(texts), max(scores)
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
            
            enhanced_ocr = PaddleOCR(lang='ch', text_det_thresh=0.05, text_det_box_thresh=0.1)
            result = enhanced_ocr.predict(scaled)
            if result and len(result) > 0 and 'rec_texts' in result[0] and result[0]['rec_texts']:
                texts = result[0]['rec_texts']
                scores = result[0].get('rec_scores', [])
                if texts and scores and scores[0] > 0.1:
                    return " ".join(texts), max(scores)
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

    def top_k_skill_matches(self, extracted_text: str, k: int = 5) -> List[Tuple[str, float]]:
        """Return top-k skill candidates by fuzzy similarity (Chinese query only)"""
        candidates: List[Tuple[str, float]] = []
        if not extracted_text:
            return candidates
        for skill in self.skill_list:
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

    def _is_latin_query(self, s: str) -> bool:
        return s and all(('a' <= c <= 'z') or ('0' <= c <= '9') for c in s.lower())

    def get_skill_suggestions(self, query: str, k: int = 20) -> List[Tuple[str, float]]:
        """
        Suggest skills by fuzzy matching. Supports pinyin queries (latin) and Chinese queries.
        Returns (skill, score). Score prioritizes prefix > substring > similarity.
        """
        q = (query or "").strip().lower()
        if not q:
            return []
        use_pinyin = self._is_latin_query(q)
        suggestions: List[Tuple[str, float]] = []
        for skill in self.skill_list:
            try:
                key = self._skill_pinyin.get(skill, skill).lower() if use_pinyin else skill
            except Exception:
                key = skill
            # basic similarity
            ratio = SequenceMatcher(None, q, key).ratio()
            # prefix/substring boosts
            prefix = key.startswith(q)
            substr = (not prefix) and (q in key)
            score = ratio + (2.0 if prefix else (1.0 if substr else 0.0))
            suggestions.append((skill, score))
        suggestions.sort(key=lambda x: x[1], reverse=True)
        return suggestions[:k]

    def save_database(self):
        """Persist current database (skills and mappings) to disk"""
        try:
            # Ensure database reflects latest in-memory values
            self.database['skill'] = self.skill_list
            self.database['skill_hero_map'] = self.skill_hero_map
            with open(self.database_path, 'w', encoding='utf-8') as f:
                json.dump(self.database, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"⚠️  Warning: Failed to save database: {e}")

    def fuzzy_match_skill(self, extracted_text: str, threshold: Optional[float] = None) -> Tuple[str, float]:
        """
        Find the best matching skill from database using fuzzy string matching
        
        Args:
            extracted_text: OCR extracted text
            threshold: Minimum similarity score (0.0 to 1.0). If None, uses config value.
            
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
    
    def extract_skills_from_image(self, image_path: str, verbose: bool = True, interactive: bool = False,
                                 user_select_skill: Optional[Callable[[str, int, int, str, List[Tuple[str, float]]], str]] = None,
                                 user_select_hero_for_skill: Optional[Callable[[str, int, int, str, List[str]], str]] = None) -> Dict:
        """
        Extract all skills from image and map heroes
        
        Args:
            image_path: Path to the game image
            verbose: Whether to print extraction progress
            
        Returns:
            Dictionary with teams, heroes, and skills, plus failure diagnostics
        """
        # Initialize OCR
        self._initialize_ocr()
        
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        if verbose:
            print(f"Processing image: {image_path} (size: {image.shape})")
        
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
                    
                    # Apply fuzzy matching
                    matched_skill, confidence = self.fuzzy_match_skill(raw_text)
                    
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
                            print("    s. Search by name/pinyin")
                            print("   -1. Enter a custom skill name")
                            choice = input("  Choose [number], or 's' to search, or -1: ").strip()
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
                                        # update pinyin index
                                        try:
                                            self._skill_pinyin[selected] = ''.join(lazy_pinyin(selected)).lower()
                                        except Exception:
                                            self._skill_pinyin[selected] = selected
                                        if verbose:
                                            print(f"  Added custom skill '{selected}' to database skill list")
                                else:
                                    print("  Empty input, try again.")
                                continue
                            elif choice.lower() == "s":
                                # Free-text autosuggest: present top matches and choose by index
                                query = input("  Search query: ").strip()
                                if not query:
                                    continue
                                search_results = self.get_skill_suggestions(query, k=20)
                                if not search_results:
                                    print("  No skills matched your query. Try again.")
                                    continue
                                print("  Suggestions:")
                                for idx, (sk, sc) in enumerate(search_results[:10], 1):
                                    print(f"    {idx}. {sk} ({sc:.3f})")
                                sel = input("  Pick a result [number], or press Enter to refine search: ").strip()
                                if not sel:
                                    continue
                                try:
                                    si = int(sel)
                                    if 1 <= si <= min(10, len(search_results)):
                                        selected = search_results[si - 1][0]
                                    else:
                                        print("  Invalid choice, try again.")
                                        continue
                                except Exception:
                                    print("  Invalid input, try again.")
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
                                            try:
                                                self._skill_pinyin[selected] = ''.join(lazy_pinyin(selected)).lower()
                                            except Exception:
                                                self._skill_pinyin[selected] = selected
                                    else:
                                        print("  Invalid choice, try again.")
                                        continue
                                except Exception:
                                    print("  Invalid input, try again.")
                                    continue
                        if selected:
                            matched_skill = selected
                            confidence = 1.0  # assume manual choice is correct
                    
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
        unmapped_heroes = []
        
        if verbose:
            print("\nMapping heroes using first skills...")
        
        for team_key in ["1", "2"]:
            team_num = int(team_key)
            for hero_num in sorted(all_skills[team_num].keys()):
                skills = all_skills[team_num][hero_num]
                first_skill = skills[0] if skills else ""
                hero_name = self.map_skill_to_hero(first_skill)
                
                # If hero is unknown, optionally ask user to choose and persist mapping
                if isinstance(hero_name, str) and hero_name.startswith("Unknown("):
                    resolved_name: Optional[str] = None
                    if interactive:
                        # Build list of distinct heroes from existing mappings
                        hero_options = sorted({v for v in self.skill_hero_map.values()})
                        if user_select_hero_for_skill is not None:
                            try:
                                resolved_name = user_select_hero_for_skill(image_path, team_num, hero_num, first_skill, hero_options)
                            except Exception as e:
                                if verbose:
                                    print(f"⚠️  Hero select callback failed: {e}")
                        if resolved_name is None:
                            # Try to show preview of first skill crop to aid selection
                            crop_info = crop_cache.get((team_num, hero_num, 1))
                            if crop_info is not None:
                                crop_img, crop_path = crop_info
                                tmp_path3 = self._save_tmp_crop(crop_img, image_path, team_num, hero_num, 1)
                                if self.show_ascii_preview:
                                    self._print_crop_preview(crop_img, label=f"Team {team_num}, Hero {hero_num}, Skill 1 (for hero mapping)", saved_path=tmp_path3)
                                else:
                                    print(f"  [Crop Saved] Team {team_num}, Hero {hero_num}, Skill 1 (for hero mapping) → {tmp_path3 or '(failed to save)'}")
                            # Fallback to simple CLI prompt
                            print("\nManual selection required: unmapped hero for skill")
                            print(f"  Image: {image_path}")
                            print(f"  Team {team_num}, Hero {hero_num}")
                            print(f"  First skill: '{first_skill}' is not mapped to a hero.")
                            print("  Choose the correct hero:")
                            for idx, h in enumerate(hero_options, 1):
                                print(f"    {idx}. {h}")
                            print("    0. Enter a custom hero name")
                            while True:
                                try:
                                    choice = input("  Enter choice [number]: ").strip()
                                    if choice == "0":
                                        custom = input("  Enter hero name: ").strip()
                                        if custom:
                                            resolved_name = custom
                                            break
                                    else:
                                        ci = int(choice)
                                        if 1 <= ci <= len(hero_options):
                                            resolved_name = hero_options[ci - 1]
                                            break
                                except Exception:
                                    pass
                                print("  Invalid choice, please try again.")
                    
                    if resolved_name:
                        hero_name = resolved_name
                        # Persist new mapping for this skill
                        self.skill_hero_map[first_skill] = resolved_name
                        self.save_database()
                        if verbose:
                            print(f"  Mapped skill '{first_skill}' → hero '{resolved_name}' (saved to database)")
                    else:
                        unmapped_heroes.append({
                            'team': team_num,
                            'hero': hero_num,
                            'first_skill': first_skill
                        })
                
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
        
        # Attach diagnostics
        result['fuzzy_match_failures'] = fuzzy_failures
        result['unmapped_heroes'] = unmapped_heroes
        
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
