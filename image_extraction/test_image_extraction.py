import json
import os
import warnings
from typing import Dict, List, Tuple

import pytest

# Skip tests if heavy deps not installed
pytest.importorskip("paddleocr")
pytest.importorskip("cv2")

# Suppress PaddleOCR ccache warning (not relevant to our tests)
warnings.filterwarnings("ignore", message=".*ccache.*", category=UserWarning)

from image_extraction.skill_extraction_system import SkillExtractionSystem

VALIDATE_DIR = os.path.join("image_extraction", "fixtures")
IMAGE_EXTS = [
    ".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"
]


def find_image_for_json(json_path: str) -> str:
    """Find matching image file for a JSON fixture file."""
    stem, _ = os.path.splitext(json_path)
    for ext in IMAGE_EXTS:
        candidate = stem + ext
        if os.path.exists(candidate):
            return candidate
    return ""


def load_expected(json_path: str) -> Dict:
    """Load expected results from JSON fixture file."""
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_result(res: Dict) -> Dict:
    """Keep only comparable fields and ensure consistent structure."""
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


def collect_validation_cases() -> List[Tuple[str, str, str]]:
    """Collect all fixture pairs (image, json, fixture_name)."""
    if not os.path.isdir(VALIDATE_DIR):
        return []
    cases = []
    for fname in sorted(os.listdir(VALIDATE_DIR)):
        if not fname.endswith(".json"):
            continue
        json_path = os.path.join(VALIDATE_DIR, fname)
        img_path = find_image_for_json(json_path)
        fixture_name = os.path.splitext(fname)[0]
        if img_path:
            cases.append((img_path, json_path, fixture_name))
        else:
            # Still include as xfail to surface missing image pairing
            cases.append(("", json_path, fixture_name))
    return cases


@pytest.fixture(scope="session")
def extractor():
    """Shared extractor instance for all tests (PaddleOCR initialization is slow)."""
    return SkillExtractionSystem()


@pytest.mark.parametrize("image_path, json_path, fixture_name", collect_validation_cases())
def test_extraction_matches_expected(image_path: str, json_path: str, fixture_name: str, extractor):
    """Test that extraction results match expected fixture data."""
    expected = load_expected(json_path)

    if not image_path:
        pytest.xfail(f"No matching image found for {json_path}")

    # Run extraction
    results = extractor.extract_skills_from_image(
        image_path=image_path,
        verbose=False,
        interactive=False,
    )

    # Validate structure
    assert "1" in results, f"Fixture {fixture_name}: Missing team 1 in results"
    assert "2" in results, f"Fixture {fixture_name}: Missing team 2 in results"
    assert "winner" in results, f"Fixture {fixture_name}: Missing winner in results"
    
    assert len(results["1"]) == 3, f"Fixture {fixture_name}: Team 1 should have 3 heroes, got {len(results['1'])}"
    assert len(results["2"]) == 3, f"Fixture {fixture_name}: Team 2 should have 3 heroes, got {len(results['2'])}"
    
    # Validate each hero has name and 3 skills
    for team_key in ["1", "2"]:
        for i, hero in enumerate(results[team_key]):
            assert "name" in hero, f"Fixture {fixture_name}: Team {team_key}, Hero {i+1} missing name"
            assert "skills" in hero, f"Fixture {fixture_name}: Team {team_key}, Hero {i+1} missing skills"
            assert len(hero["skills"]) == 3, f"Fixture {fixture_name}: Team {team_key}, Hero {i+1} should have 3 skills, got {len(hero['skills'])}"
            assert hero["name"], f"Fixture {fixture_name}: Team {team_key}, Hero {i+1} has empty name"
            assert all(skill for skill in hero["skills"]), f"Fixture {fixture_name}: Team {team_key}, Hero {i+1} has empty skills"

    # Validate winner
    assert results["winner"] in ["1", "2"], f"Fixture {fixture_name}: Winner should be '1' or '2', got '{results['winner']}'"

    # Compare normalized structures (teams + winner only)
    got = normalize_result(results)
    expected_norm = normalize_result(expected)

    # Detailed comparison with helpful error messages
    if got != expected_norm:
        # Compare teams
        for team_key in ["1", "2"]:
            got_team = got[team_key]
            exp_team = expected_norm[team_key]
            assert len(got_team) == len(exp_team), (
                f"Fixture {fixture_name}: Team {team_key} has {len(got_team)} heroes, expected {len(exp_team)}"
            )
            for i, (got_hero, exp_hero) in enumerate(zip(got_team, exp_team)):
                if got_hero["name"] != exp_hero["name"]:
                    pytest.fail(
                        f"Fixture {fixture_name}: Team {team_key}, Hero {i+1} name mismatch: "
                        f"got '{got_hero['name']}', expected '{exp_hero['name']}'"
                    )
                if got_hero["skills"] != exp_hero["skills"]:
                    pytest.fail(
                        f"Fixture {fixture_name}: Team {team_key}, Hero {i+1} ({got_hero['name']}) skills mismatch:\n"
                        f"  got:      {got_hero['skills']}\n"
                        f"  expected: {exp_hero['skills']}"
                    )
        
        # Compare winner
        if got["winner"] != expected_norm["winner"]:
            pytest.fail(
                f"Fixture {fixture_name}: Winner mismatch: got '{got['winner']}', expected '{expected_norm['winner']}'"
            )
    
    # Final assertion (should always pass if we get here)
    assert got == expected_norm, f"Fixture {fixture_name}: Results don't match expected"