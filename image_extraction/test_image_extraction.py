import json
import os
from typing import Dict, List, Tuple

import pytest

# Skip tests if heavy deps not installed
pytest.importorskip("paddleocr")
pytest.importorskip("cv2")

from image_extraction.skill_extraction_system import SkillExtractionSystem

VALIDATE_DIR = os.path.join("image_extraction", "fixtures")
IMAGE_EXTS = [
    ".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"
]


def find_image_for_json(json_path: str) -> str:
    stem, _ = os.path.splitext(json_path)
    for ext in IMAGE_EXTS:
        candidate = stem + ext
        if os.path.exists(candidate):
            return candidate
    return ""


def load_expected(json_path: str) -> Dict:
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_result(res: Dict) -> Dict:
    """Keep only comparable fields and ensure consistent structure"""
    out = {
        "1": [],
        "2": [],
        "winner": res.get("winner", "unknown"),
    }
    for team_key in ["1", "2"]:
        team = res.get(team_key, [])
        norm_team = []
        for hero in team:
            norm_team.append({
                "name": hero.get("name", ""),
                "skills": list(hero.get("skills", [])),
            })
        out[team_key] = norm_team
    return out


def collect_validation_cases() -> List[Tuple[str, str]]:
    if not os.path.isdir(VALIDATE_DIR):
        return []
    cases = []
    for fname in sorted(os.listdir(VALIDATE_DIR)):
        if not fname.endswith(".json"):
            continue
        json_path = os.path.join(VALIDATE_DIR, fname)
        img_path = find_image_for_json(json_path)
        if img_path:
            cases.append((img_path, json_path))
        else:
            # Still include as xfail to surface missing image pairing
            cases.append(("", json_path))
    return cases


@pytest.mark.parametrize("image_path, json_path", collect_validation_cases())
def test_extraction_matches_expected(image_path: str, json_path: str):
    expected = load_expected(json_path)

    if not image_path:
        pytest.xfail(f"No matching image found for {json_path}")

    # Initialize extractor (uses data/database.json by default)
    extractor = SkillExtractionSystem()

    # Run extraction
    results = extractor.extract_skills_from_image(
        image_path=image_path,
        verbose=False,
        interactive=False,
    )

    # Compare normalized structures (teams + winner only)
    got = normalize_result(results)

    # Some expected JSON may not include diagnostics; ensure we only compare comparable fields
    expected_norm = normalize_result(expected)

    # Compare entire normalized JSON structures directly
    assert got == expected_norm