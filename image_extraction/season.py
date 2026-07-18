"""Pure, import-light season helpers shared by the extraction system.

Kept free of heavy dependencies (PaddleOCR, cv2) so the season logic can be
unit-tested without initialising OCR."""

from typing import Dict, Optional


def latest_season(database: Dict) -> Optional[int]:
    """Return the highest integer `season` value found on any hero or skill in
    the database, or None if no season is labelled. Used as the default season
    for freshly extracted battles."""
    seasons = []
    for group in ('heroes', 'skills'):
        for entry in database.get(group, {}).values():
            if isinstance(entry, dict):
                season = entry.get('season')
                if isinstance(season, int):
                    seasons.append(season)
    return max(seasons) if seasons else None
