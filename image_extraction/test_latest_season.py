"""Unit tests for the pure season helper.

These import only `image_extraction.season`, which has no heavy dependencies
(no PaddleOCR / cv2), so they run in CI even when OCR is not installed."""

from image_extraction.season import latest_season


def test_latest_season_takes_max_across_heroes_and_skills():
    db = {
        "heroes": {"甲": {"season": 12}, "乙": {"season": 15}, "丙": {}},
        "skills": {"x": {"season": 14}, "y": {"season": 16}, "z": {}},
    }
    assert latest_season(db) == 16


def test_latest_season_ignores_non_int_and_missing():
    db = {
        "heroes": {"甲": {"season": "15"}, "乙": {"season": None}, "丙": {"season": 9}},
        "skills": {"x": {"season": 13}},
    }
    assert latest_season(db) == 13


def test_latest_season_none_when_unlabelled():
    db = {"heroes": {"甲": {}}, "skills": {"x": {}}}
    assert latest_season(db) is None
